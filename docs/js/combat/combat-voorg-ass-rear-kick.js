// Voorg-Ass rear kick: a one-shot defensive response for wild herds and
// a cooldown-limited special move for stable companions. Rendering uses the
// Animal Head Rigger's authored separatorPolygon, not a second split mask.
(() => {
  'use strict';

  const ATTACK_ID = 'rearKick'; // Shared by both Voorg-Ass and Herd-Mother creature definitions.
  const WINDUP_S = 0.32; // Holds the stationary, reversed pose long enough to telegraph the kick.
  const STRIKE_S = 0.26; // Displays the combined idle-head/run1-hindlegs sprite while the hoof connects.
  const RECOVERY_S = 0.24; // Brief stationary recovery before escape or companion movement resumes.
  const DAMAGE = 1; // Health damage is intentionally negligible; the kick is a Footing/knockback attack.
  const KNOCKBACK_PX_S = 1900; // Four times Guard Charge's 450 px/s; collision physics still constrain the throw.
  const FOOTING_MULTIPLIER_MIN = 80; // Ensures a genuinely severe Footing hit even on low-Footing actors.
  const FOOTING_MAX_FRACTION = 1.35; // Target-specific minimum Footing depletion, before normal defenses.
  const DEFAULT_COOLDOWN_MS = 9000; // Companion special cooldown; ordinary guard charges remain available.
  const MAX_CACHED_KICK_FRAMES = 24; // Upper limit used to bound data-URL memory for many different herd genotypes.
  const COMPOSITE_GRACE_S = 2.0; // Lets the shared serial frame compositor finish on slower mobile hardware before resorting to run1.
  const spriteCache = new Map(); // Reuses a genotype's two-frame composite across kicks without recompositing each frame.
  const spritePromises = new Map(); // Deduplicates concurrent requests from animals of the same genotype.

  function isVoorgAss(creature) {
    const kind = String(creature?.creatureKey || creature?.kind || '');
    return kind === 'voorg-ass' || kind === 'voorg-ass-herd-mother';
  }

  function canUse(creature, now = performance.now()) {
    return isVoorgAss(creature) && now >= (Number(creature?._voorgRearKickCooldownUntil) || 0);
  }

  function frameKey(creature, rest) {
    const kind = 'voorg-ass'; // Both the herd mother and the adult use exactly the same keyed coat art.
    const signature = window.CreatureGeneticsRender?.genotypeSignature?.(kind, creature.genotype) || JSON.stringify(creature.genotype || null);
    return kind + '|' + signature + '|' + (Number(rest?.frameShiftX) || 0.5).toFixed(4) + '|' + (Number(rest?.separatorRotationDeg) || 0).toFixed(3);
  }

  function imageFor(url) {
    return new Promise((resolve, reject) => {
      const image = new Image(); // Fallback for non-genotype specimens when composeFrame cannot supply canvases.
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Voorg-Ass frame missing: ' + url));
      image.src = url;
    });
  }

  function clipFrame(ctx, source, width, height, rest, keepRight) {
    const polygon = window.AnimalShoulderSpline?.separatorPolygon?.(width, height, rest, keepRight);
    if (!polygon?.length) throw new Error('Animal Head Rigger separator unavailable');
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(polygon[0].x, polygon[0].y);
    for (let i = 1; i < polygon.length; i++) ctx.lineTo(polygon[i].x, polygon[i].y);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(source, 0, 0, width, height);
    ctx.restore();
  }

  async function buildKickFrame(creature, rest) {
    const renderer = window.CreatureGeneticsRender;
    let idle = null, run1 = null;
    if (typeof renderer?.composeFrame === 'function') {
      try {
        [idle, run1] = await Promise.all([
          renderer.composeFrame('voorg-ass', 'idle', creature.genotype, false),
          renderer.composeFrame('voorg-ass', 'run1', creature.genotype, false),
        ]);
      } catch (_) { idle = null; run1 = null; }
    }
    if (!idle || !run1) {
      const sprites = creature.def?.sprites;
      if (!sprites?.idle || !sprites?.run?.[0]) return null;
      [idle, run1] = await Promise.all([imageFor(sprites.idle), imageFor(sprites.run[0])]);
    }
    const width = Number(idle.width || idle.naturalWidth) || 1;
    const height = Number(idle.height || idle.naturalHeight) || 1;
    const canvas = document.createElement('canvas'); // One native-resolution canvas keeps the existing rigger's split exact.
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    clipFrame(ctx, run1, width, height, rest, true); // Rear/right section: kicked-out run1 legs.
    clipFrame(ctx, idle, width, height, rest, false); // Front/left section: still, idle head.
    return canvas.toDataURL('image/png');
  }

  function requestKickFrame(creature) {
    const rest = window.CreatureGeneticsRender?.headRigForKind?.('voorg-ass')?.shoulderRest || { frameShiftX: 0.48 };
    const key = frameKey(creature, rest);
    if (spriteCache.has(key)) {
      const cached = spriteCache.get(key); // Refresh LRU order for frequently used family/genotype textures.
      spriteCache.delete(key);
      spriteCache.set(key, cached);
      return Promise.resolve(cached);
    }
    if (spritePromises.has(key)) return spritePromises.get(key);
    const promise = buildKickFrame(creature, rest).then(url => {
      if (url) {
        spriteCache.set(key, url);
        while (spriteCache.size > MAX_CACHED_KICK_FRAMES) spriteCache.delete(spriteCache.keys().next().value); // Evicts stale data URLs, never live avatar textures.
      }
      return url;
    }).catch(error => {
      window.__farmLog?.('[voorg-kick] combined sprite failed: ' + error.message, 'warn');
      return null;
    }).finally(() => spritePromises.delete(key));
    spritePromises.set(key, promise);
    return promise;
  }

  function start(creature, state, context) {
    const target = context?.target;
    state.target = target; // Strike is committed to the original target, even if it subsequently evades.
    state.stage = 'windup';
    state.t = 0;
    state.struck = false;
    state.frame = null;
    state.frameApplied = false;
    state.angleToward = target
      ? Math.atan2(target.y - creature.y, target.x - creature.x)
      : creature.facing || 0;
    creature.facing = state.angleToward + Math.PI; // The head faces away while the hindquarters point toward the threat.
    creature.scaleY = 1;
    creature.vx = 0;
    creature.vy = 0;
    if (creature.isCompanion) {
      const duration = Math.max(1000, Number(creature.def?.rearKickCooldownS || 9) * 1000);
      creature._voorgRearKickCooldownUntil = performance.now() + (Number.isFinite(duration) ? duration : DEFAULT_COOLDOWN_MS);
    }
    requestKickFrame(creature).then(url => { state.frame = url; }); // Async native-resolution image build; cancellation cannot resurrect the attack.
    window.__farmLog?.('[voorg-kick] ' + (creature.id || 'voorg-ass') + ' rear kick windup', 'wildlife');
  }

  function applyKickSprite(creature, state, deps) {
    if (state.frameApplied || !state.frame || !creature.avatarRef) return;
    deps.setCreatureFrame?.(creature.avatarRef, state.frame, null, 'idle', null);
    creature.currentFrameUrl = state.frame; // The normal idle/run animator restores the next frame after the move.
    state.frameApplied = true;
  }

  function finish(creature) {
    if (!creature.isCompanion && isVoorgAss(creature)) {
      creature._voorgRearKickSpent = true; // Prevents repeated defensive kicks while this wild animal escapes.
      creature._voorgRearKickThreat = null;
      creature.targetPlayer = null;
      creature.targetCreature = null;
      creature.state = 'fleeing-low-health'; // Existing wilderness AI runs home and applies its re-aggro grace period.
      creature._animalSleeping = false;
    }
  }

  function strike(creature, state, deps) {
    if (state.struck) return;
    state.struck = true;
    const target = state.target;
    if (!target || target.health <= 0 || (target.areaId != null && target.areaId !== creature.areaId)) return; // The player has no guaranteed areaId field; creatures do.
    const reach = Math.max(Number(creature.def?.attackRangePx) || 0, deps.TILE * 1.18);
    const yaw = state.angleToward; // Hit collider aims behind the animal; the actual visible facing stays reversed.
    const aim = window.Combat?.meleeAimSolution?.(creature, target, yaw, 0);
    const hit = window.Combat?.meleeHit
      ? window.Combat.meleeHit(creature, target, { rangePx: reach, halfConeRad: Math.PI / 3, yaw, pitch: aim?.pitch || 0 })
      : Math.hypot(target.x - creature.x, target.y - creature.y) <= reach;
    if (!hit) return; // Sidestepping or moving out of reach during the tell avoids the kick.
    const stagger = window.SCRATCHBONES_CONFIG?.game?.combat?.stagger;
    const footScale = (Number(stagger?.footingLossPerDamage) || 1) * (Number(stagger?.damageTypeMultipliers?.blunt?.footingDamage) || 1);
    const footingMultiplier = Math.max(FOOTING_MULTIPLIER_MIN, ((Number(target.maxFooting) || 50) * FOOTING_MAX_FRACTION) / Math.max(0.001, DAMAGE * footScale));
    const hitOptions = { tag: 'blunt', attacker: creature, footingDamageMultiplier: footingMultiplier };
    const isPlayer = target === deps.player || (deps.players || []).includes(target);
    if (isPlayer) deps.damagePlayer(DAMAGE, creature.x, creature.y, KNOCKBACK_PX_S, hitOptions);
    else if (window.CompanionOffense) window.CompanionOffense.damageCreature(deps.damageCreature, creature, target, DAMAGE, creature.x, creature.y, KNOCKBACK_PX_S, hitOptions);
    else deps.damageCreature(target, DAMAGE, creature.x, creature.y, KNOCKBACK_PX_S, hitOptions);
    deps.playCreatureClawHit?.(creature);
    window.__farmLog?.('[voorg-kick] hit ' + (target.id || 'target') + ' knockback=' + KNOCKBACK_PX_S + ' footingMultiplier=' + footingMultiplier.toFixed(1), 'combat');
  }

  function update(creature, state, dt, deps) {
    state.t += Math.max(0, dt);
    creature.facing = state.angleToward + Math.PI;
    creature.vx = 0;
    creature.vy = 0;
    if (state.stage === 'windup') {
      if (state.t >= WINDUP_S) { state.stage = 'strike'; state.t = 0; }
      return true;
    }
    if (state.stage === 'strike') {
      if (!state.frame && !state.spriteFallback && state.t < COMPOSITE_GRACE_S) {
        state.waitedForFrame = true; // Deferred presentation needs a full visible strike beat once the combined image becomes ready.
        return true;
      } // First-time genotype composites may still be rendering; allow the proper split head/leg art to finish first.
      if (state.frame && state.waitedForFrame) {
        state.waitedForFrame = false;
        state.t = 0; // Don't hit instantly when the delayed frame arrives: display the authored pose before hoof contact.
        applyKickSprite(creature, state, deps);
        return true;
      }
      if (!state.frame && !state.spriteFallback) {
        state.spriteFallback = true;
        state.t = 0;
        const fallback = creature.def?.sprites?.run?.[0]; // Missing/failed compositing cannot prevent a combat strike indefinitely.
        if (fallback && creature.avatarRef) {
          deps.setCreatureFrame?.(creature.avatarRef, fallback, creature.genotype ? 'voorg-ass' : null, 'run1', creature.genotype);
          creature.currentFrameUrl = fallback;
        }
      }
      applyKickSprite(creature, state, deps);
      if (state.t >= STRIKE_S * 0.48) strike(creature, state, deps);
      if (state.t >= STRIKE_S) { state.stage = 'recovery'; state.t = 0; }
      return true;
    }
    if (state.t >= RECOVERY_S) {
      finish(creature);
      return false;
    }
    return true;
  }

  function cancel(creature) {
    // Damage interruption must not turn a retreating wild animal into a permanently hostile pursuer.
    if (!creature.isCompanion && isVoorgAss(creature) && creature._voorgRearKickThreat) finish(creature);
  }

  window.Combat?.animalAttacks?.register?.(ATTACK_ID, {
    label: 'Rear Kick', start, update, cancel,
    isStriking: state => state?.stage === 'strike',
    isWindingUp: state => state?.stage === 'windup',
  });
  window.VoorgAssRearKick = Object.freeze({ isVoorgAss, canUse, tuning: { WINDUP_S, STRIKE_S, RECOVERY_S, DAMAGE, KNOCKBACK_PX_S, DEFAULT_COOLDOWN_MS, MAX_CACHED_KICK_FRAMES, COMPOSITE_GRACE_S }, cacheSize: () => spriteCache.size }); // Mobile console-free diagnostics.
})();
