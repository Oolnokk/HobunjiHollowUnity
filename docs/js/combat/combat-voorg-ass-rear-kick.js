// Voorg-Ass rear kick: a one-shot defensive response for wild herds and
// a cooldown-limited special move for stable companions. Rendering uses the
// Animal Head Rigger's authored separatorPolygon, not a second split mask.
(() => {
  'use strict';

  const ATTACK_ID = 'rearKick'; // Shared by both Voorg-Ass and Herd-Mother creature definitions.
  const LUNGE_MAX_TILES = 2.6; // Maximum forward charge before the kick executes even on a miss.
  const LUNGE_DURATION_S = 0.12; // Matches Guard Charge's near-instant attack burst rather than ordinary chase movement.
  const LUNGE_SPEED_TILES_S = LUNGE_MAX_TILES / LUNGE_DURATION_S; // Finite burst speed used by beginConeLunge over the existing 2.6-tile travel budget.
  const KICK_HALF_CONE_RAD = Math.PI / 3; // Shared by the lunge stopping detector and the eventual rear hoof strike.
  const WINDUP_S = 0.32; // Holds the stationary, reversed pose long enough to telegraph the kick.
  const STRIKE_S = 0.26; // The hoof connects 48% into this strike beat; the split pose is already visible by then.
  const KICK_POSE_HOLD_S = 1.0; // Hold the idle-head/run1-legs kick silhouette completely still for one second AFTER hoof contact, hit or miss.
  const RECOVERY_S = 0.24; // Brief stationary recovery before escape or companion movement resumes.
  const DAMAGE = 1; // Health damage is intentionally negligible; the kick is a Footing/knockback attack.
  const KNOCKBACK_PX_S = 1900; // Four times Guard Charge's 450 px/s; collision physics still constrain the throw.
  const FOOTING_MULTIPLIER_MIN = 80; // Ensures a genuinely severe Footing hit even on low-Footing actors.
  const FOOTING_MAX_FRACTION = 1.35; // Target-specific minimum Footing depletion, before normal defenses.
  const DEFAULT_COOLDOWN_MS = 9000; // Companion special cooldown; ordinary guard charges remain available.
  const MAX_CACHED_KICK_FRAMES = 24; // Upper limit used to bound data-URL memory for many different herd genotypes.
  const COMPOSITE_GRACE_S = 2.0; // Lets the shared serial frame compositor finish on slower mobile hardware before resorting to run1.
  const REAR_LIFT_DEG = 30; // Rear half pivots upward opposite the Grehlr's nose-down burrow tilt; the front half never moves.
  const REAR_LIFT_STEPS = 6; // Five-degree native-PNG composites permit smooth low-cost recovery without resampling a canvas every frame.
  const IMPACT_PARTICLE_COUNT = 18; // A small dust burst makes the heavy backward hoof strike read as forceful.
  const IMPACT_PARTICLE_LIFE_S = 0.42; // Short, fading kicked-up dirt behind the hind hooves.
  let impactGeometry = null; // Reused by every kick impact; never rebuilt for individual motes.
  let impactMaterials = null; // Two reusable earthen shades add readable layered oomph without unique per-particle materials.
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
      image.crossOrigin = 'anonymous';
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Voorg-Ass frame missing: ' + url));
      image.src = url;
    });
  }

  function clipFrame(ctx, source, width, height, rest, keepRight, rearLiftDeg = 0) {
    const polygon = window.AnimalShoulderSpline?.separatorPolygon?.(width, height, rest, keepRight);
    if (!polygon?.length) throw new Error('Animal Head Rigger separator unavailable');
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(polygon[0].x, polygon[0].y);
    for (let i = 1; i < polygon.length; i++) ctx.lineTo(polygon[i].x, polygon[i].y);
    ctx.closePath();
    ctx.clip();
    if (keepRight && rearLiftDeg) {
      const hingeX = width * (Number(rest?.frameShiftX) || 0.48); // Shared shoulder separator anchors the hindquarter rotation in native PNG coordinates.
      const hingeY = height * 0.54; // Rear/body hinge sits below the spine, preventing the back legs from orbiting the head.
      ctx.translate?.(hingeX, hingeY);
      ctx.rotate?.(-rearLiftDeg * Math.PI / 180); // Canvas Y points downward: counterclockwise lifts the right/rear end.
      ctx.translate?.(-hingeX, -hingeY);
    }
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
    const canvas = document.createElement('canvas'); // One native-resolution canvas reused to pre-render the rear-only lift and recovery silhouettes.
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const frames = []; // Six five-degree steps + fully lowered frame, shared across all kicks with the same coat.
    for (let step = 0; step <= REAR_LIFT_STEPS; step++) {
      ctx.clearRect?.(0, 0, width, height);
      clipFrame(ctx, run1, width, height, rest, true, (REAR_LIFT_DEG * step) / REAR_LIFT_STEPS); // Hindquarters tilt, preserving run1's hoof-extension pose.
      clipFrame(ctx, idle, width, height, rest, false); // Front/head remains visually anchored throughout recovery.
      frames.push(canvas.toDataURL('image/png'));
    }
    return frames;
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
    const promise = buildKickFrame(creature, rest).then(frames => {
      if (frames?.length) {
        spriteCache.set(key, frames);
        while (spriteCache.size > MAX_CACHED_KICK_FRAMES) spriteCache.delete(spriteCache.keys().next().value); // Evicts stale data URLs, never live avatar textures.
      }
      return frames;
    }).catch(error => {
      window.__farmLog?.('[voorg-kick] combined sprite failed: ' + error.message, 'warn');
      return null;
    }).finally(() => spritePromises.delete(key));
    spritePromises.set(key, promise);
    return promise;
  }

  function start(creature, state, context, deps) {
    const target = context?.target;
    state.target = target; // Strike is committed to the original target, even if it subsequently evades.
    state.stage = 'lunge'; // Selection commits immediately: no separate attack-range or AI retry gate.
    state.t = 0;
    state.lungeElapsedS = 0; // Logs the actual time spent moving when the committed charge stops.
    state.struck = false;
    state.frame = null;
    state.frames = null; // Array of native-resolution rear-tilt angles, used during the 0.24s recovery interpolation.
    state.frameIndex = -1; // Tracks which quantized tilt was last shown, avoiding needless texture rebinds.
    state.frameApplied = false;
    state.kickParticles = []; // Transient scene-owned dust motes cleaned on recovery/cancellation.
    state.kickParticleBatch = null; // Optional GPU-instanced draw owner for this one attack.
    const reach = Math.max(Number(creature.def?.attackRangePx) || 0, deps.TILE * 1.18); // Same cone reach used later by strike().
    window.Combat.animalAttacks.beginConeLunge(creature, state, context, deps, {
      rangePx: reach,
      halfConeRad: KICK_HALF_CONE_RAD,
      maxDistancePx: deps.TILE * LUNGE_MAX_TILES,
      speedPxS: deps.TILE * LUNGE_SPEED_TILES_S,
      targets: target ? [target] : [],
      detect: (source, victim, lunge) => {
        const aim = window.Combat?.meleeAimSolution?.(source, victim, lunge.lungeAngle, 0);
        return window.Combat?.meleeHit
          ? window.Combat.meleeHit(source, victim, { rangePx: reach, halfConeRad: KICK_HALF_CONE_RAD, yaw: lunge.lungeAngle, pitch: aim?.pitch || 0 })
          : Math.hypot(victim.x - source.x, victim.y - source.y) <= reach
            && Math.abs(Math.atan2(Math.sin(Math.atan2(victim.y - source.y, victim.x - source.x) - lunge.lungeAngle), Math.cos(Math.atan2(victim.y - source.y, victim.x - source.x) - lunge.lungeAngle))) <= KICK_HALF_CONE_RAD;
      },
    });
    state.angleToward = state.lungeAngle; // Remains locked through charge, turn, and strike.
    creature.scaleY = 1;
    if (creature.isCompanion) {
      const duration = Math.max(1000, Number(creature.def?.rearKickCooldownS || 9) * 1000);
      creature._voorgRearKickCooldownUntil = performance.now() + (Number.isFinite(duration) ? duration : DEFAULT_COOLDOWN_MS);
    }
    requestKickFrame(creature).then(frames => { if (state.stage) { state.frames = frames; state.frame = frames?.[REAR_LIFT_STEPS] || null; } }); // Native artwork is cached; the fully lifted frame stays fixed for the one-second impact hold.
    window.__farmLog?.('[voorg-kick] ' + (creature.id || 'voorg-ass') + ' rear kick lunge', 'wildlife');
  }

  function isHoldingKickPose(creature) {
    const attack = creature?._animalAttack; // Used by companion target-loss handling to preserve an already-fired kick through its pose hold and recovery.
    return attack?.id === ATTACK_ID && (attack.state?.stage === 'kickHold' || attack.state?.stage === 'recovery');
  }

  function applyKickSprite(creature, state, deps, liftDeg = REAR_LIFT_DEG) {
    if (!state.frame || !creature.avatarRef) return;
    const frameIndex = Math.max(0, Math.min(REAR_LIFT_STEPS, Math.round(liftDeg / REAR_LIFT_DEG * REAR_LIFT_STEPS))); // Uses pre-rendered five-degree steps for fast, deterministic easing.
    const url = state.frames?.[frameIndex] || state.frame;
    if (state.frameApplied && state.frameIndex === frameIndex) return; // Hold is perfectly still until recovery actually begins.
    deps.setCreatureFrame?.(creature.avatarRef, url, null, 'idle', null);
    creature.currentFrameUrl = url; // The normal idle/run animator restores the next frame after the move.
    state.frameIndex = frameIndex;
    state.frameApplied = true;
  }

  function syncKickParticleBatch(state) {
    state.kickParticleBatch?.sync(state.kickParticles, (transform, mote) => {
      transform.position.set(mote.x, mote.y, mote.z);
      transform.rotation.set(mote.rx, 0, mote.rz);
      transform.scale.setScalar(mote.scale);
    }); // Both dirt shades keep their original per-mote motion with two draw calls total.
  }

  function emitKickParticles(creature, state, deps) {
    const THREE = window.THREE; // No WebGL needed in the attack logic or isolated headless fixtures.
    const parent = creature.avatarRef?.group?.parent;
    if (!parent || !THREE?.Mesh || !THREE?.TetrahedronGeometry || !THREE?.MeshBasicMaterial) return;
    if (!impactGeometry) impactGeometry = new THREE.TetrahedronGeometry(0.045, 0);
    if (!impactMaterials) impactMaterials = [0x9a8468, 0xd2c29b].map(color => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }));
    const batch = window.Combat?.animalAttacks?.createParticleBatch?.(THREE, parent, impactGeometry, impactMaterials, IMPACT_PARTICLE_COUNT) || null; // GPU instancing is optional, with identical legacy motes as fallback.
    state.kickParticleBatch = batch; // Owned by this attack; clear on recovery, death, or cancellation.
    const yaw = Number(state.angleToward) || 0;
    const surfaceY = (Number(creature.avatarRef.group?.position?.y) || 0) - Math.max(0.2, Number(creature.halfHeight) || 0.35);
    for (let index = 0; index < IMPACT_PARTICLE_COUNT; index++) {
      const spread = (index / IMPACT_PARTICLE_COUNT - 0.5) * Math.PI * 1.25;
      const angle = yaw + spread;
      const speed = 1.5 + (index % 5) * 0.28; // Preserve deterministic impact scatter and gameplay RNG independence.
      const x = creature.x / deps.TILE + Math.cos(yaw) * 0.35;
      const y = surfaceY + 0.09;
      const z = creature.y / deps.TILE + Math.sin(yaw) * 0.35;
      const mote = {
        vx: Math.cos(angle) * speed, vz: Math.sin(angle) * speed,
        vy: 0.65 + (index % 6) * 0.19, life: IMPACT_PARTICLE_LIFE_S,
      }; // One simulation record per mote regardless of draw strategy.
      if (batch) {
        Object.assign(mote, { x, y, z, rx: 0, rz: 0, scale: 0.65 + (index % 4) * 0.2, materialIndex: index % impactMaterials.length });
      } else {
        const mesh = new THREE.Mesh(impactGeometry, impactMaterials[index % impactMaterials.length]);
        mesh.position.set(x, y, z);
        mesh.scale.setScalar(0.65 + (index % 4) * 0.2);
        parent.add(mesh);
        mote.mesh = mesh; // Existing non-instanced path remains available to browser/fixture renderers.
      }
      state.kickParticles.push(mote);
    }
    syncKickParticleBatch(state); // Show the hit burst on its first frame, not one update after hoof contact.
  }

  function tickKickParticles(state, dt) {
    const batch = state.kickParticleBatch; // Reused instanced geometry for this impact's entire 0.42-second lifetime.
    for (let i = (state.kickParticles?.length || 0) - 1; i >= 0; i--) {
      const mote = state.kickParticles[i];
      mote.life -= dt;
      mote.vy -= 8.5 * dt;
      if (batch) {
        mote.x += mote.vx * dt;
        mote.z += mote.vz * dt;
        mote.y += mote.vy * dt;
        mote.rx += dt * 6;
        mote.rz += dt * 4;
        mote.scale *= Math.max(0.75, 1 - dt * 2);
      } else {
        mote.mesh.position.x += mote.vx * dt;
        mote.mesh.position.z += mote.vz * dt;
        mote.mesh.position.y += mote.vy * dt;
        mote.mesh.rotation.x += dt * 6;
        mote.mesh.rotation.z += dt * 4;
        mote.mesh.scale.multiplyScalar(Math.max(0.75, 1 - dt * 2));
      }
      if (mote.life <= 0) {
        mote.mesh?.parent?.remove(mote.mesh);
        state.kickParticles.splice(i, 1);
      }
    }
    syncKickParticleBatch(state);
  }

  function clearKickParticles(state) {
    for (const mote of state?.kickParticles || []) mote.mesh?.parent?.remove(mote.mesh);
    state?.kickParticleBatch?.dispose(); // Reclaims per-impact instance buffers; shared dust geometry/material stay cached.
    if (state) { state.kickParticleBatch = null; state.kickParticles = []; }
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
    emitKickParticles(creature, state, deps); // A miss still kicks up dirt; the dust proves contact with the ground rather than with the victim.
    const target = state.target;
    if (!target || target.health <= 0 || (target.areaId != null && target.areaId !== creature.areaId)) return; // The player has no guaranteed areaId field; creatures do.
    const reach = Math.max(Number(creature.def?.attackRangePx) || 0, deps.TILE * 1.18);
    const yaw = state.angleToward; // Hit collider aims behind the animal; the actual visible facing stays reversed.
    const aim = window.Combat?.meleeAimSolution?.(creature, target, yaw, 0);
    const hit = window.Combat?.meleeHit
      ? window.Combat.meleeHit(creature, target, { rangePx: reach, halfConeRad: KICK_HALF_CONE_RAD, yaw, pitch: aim?.pitch || 0 })
      : Math.hypot(target.x - creature.x, target.y - creature.y) <= reach;
    if (!hit) return; // Sidestepping or moving out of reach during the tell avoids the kick.
    const stagger = window.SCRATCHBONES_CONFIG?.game?.combat?.stagger;
    const footScale = (Number(stagger?.footingLossPerDamage) || 1) * (Number(stagger?.damageTypeMultipliers?.blunt?.footingDamage) || 1);
    const footingMultiplier = Math.max(FOOTING_MULTIPLIER_MIN, ((Number(target.maxFooting) || 50) * FOOTING_MAX_FRACTION) / Math.max(0.001, DAMAGE * footScale));
    const hitOptions = { tag: 'blunt', attacker: creature, footingDamageMultiplier: footingMultiplier };
    const isPlayer = target === deps.player || (deps.players || []).includes(target);
    if (isPlayer) deps.damagePlayer(DAMAGE, creature.x, creature.y, KNOCKBACK_PX_S, hitOptions);
    else if (creature.isCompanion && window.CompanionOffense) window.CompanionOffense.damageCreature(deps.damageCreature, creature, target, DAMAGE, creature.x, creature.y, KNOCKBACK_PX_S, hitOptions);
    else deps.damageCreature(target, DAMAGE, creature.x, creature.y, KNOCKBACK_PX_S, hitOptions);
    deps.playCreatureClawHit?.(creature);
    window.__farmLog?.('[voorg-kick] hit ' + (target.id || 'target') + ' knockback=' + KNOCKBACK_PX_S + ' footingMultiplier=' + footingMultiplier.toFixed(1), 'combat');
  }

  function update(creature, state, dt, deps) {
    state.t += Math.max(0, dt);
    tickKickParticles(state, Math.max(0, Number(dt) || 0)); // Cosmetic effects expire even during the locked one-second kick pose.
    if (state.stage === 'lunge') {
      state.lungeElapsedS += Math.max(0, Number(dt) || 0); // Single scalar keeps mobile diagnostics cheap without per-frame DOM/log updates.
      const stopReason = window.Combat.animalAttacks.advanceConeLunge(creature, state, dt, deps); // Contact, maximum travel, or terrain all commit to the kick.
      if (!stopReason) return true;
      state.lungeStopReason = stopReason; // In-game diagnostics distinguish range exhaustion from target contact.
      state.stage = 'windup';
      state.t = 0;
      window.__farmLog?.('[voorg-kick] ' + (creature.id || 'voorg-ass') + ' lunge stopped: ' + stopReason + ' after ' + (state.lungeTraveledPx / Math.max(1, deps.TILE)).toFixed(2) + ' tiles / ' + state.lungeElapsedS.toFixed(3) + 's', 'wildlife');
    }
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
      if (state.t >= STRIKE_S * 0.48) {
        strike(creature, state, deps); // The kick has fired even if its target dodged or was already defeated.
        state.stage = 'kickHold'; // Keep the visible kick pose fixed instead of immediately unwinding into recovery.
        state.t = 0;
      }
      return true;
    }
    if (state.stage === 'kickHold') {
      if (state.t >= KICK_POSE_HOLD_S) { state.stage = 'recovery'; state.t = 0; }
      return true; // Creature remains combat-busy, so neither wild nor companion idle/run animations can replace the kick sprite.
    }
    const easing = 1 - Math.pow(1 - Math.min(1, state.t / RECOVERY_S), 2); // Ease-out rear lift settles gently back onto the four-leg neutral silhouette.
    applyKickSprite(creature, state, deps, REAR_LIFT_DEG * (1 - easing));
    if (state.t >= RECOVERY_S) {
      clearKickParticles(state);
      finish(creature);
      return false;
    }
    return true;
  }

  function cancel(creature) {
    clearKickParticles(creature?._animalAttack?.state); // External death/cancel cannot leave orphaned dust in the scene.
    creature.vx = 0;
    creature.vy = 0;
    // Genuine external interruption (e.g. death) still performs the existing retreat cleanup.
    if (!creature.isCompanion && isVoorgAss(creature) && creature._voorgRearKickThreat) finish(creature);
  }

  window.Combat?.animalAttacks?.register?.(ATTACK_ID, {
    label: 'Rear Kick', start, update, cancel,
    ownsApproach: true, // Begin its own near-instant charge directly; companions must not prepend a second 2.6-tile lunge.
    isStriking: state => state?.stage === 'lunge' || state?.stage === 'strike',
    isWindingUp: state => state?.stage === 'windup',
  });
  window.VoorgAssRearKick = Object.freeze({ isVoorgAss, canUse, isHoldingKickPose, tuning: { LUNGE_MAX_TILES, LUNGE_DURATION_S, LUNGE_SPEED_TILES_S, WINDUP_S, STRIKE_S, KICK_POSE_HOLD_S, RECOVERY_S, DAMAGE, KNOCKBACK_PX_S, DEFAULT_COOLDOWN_MS, MAX_CACHED_KICK_FRAMES, COMPOSITE_GRACE_S, REAR_LIFT_DEG, REAR_LIFT_STEPS, IMPACT_PARTICLE_COUNT }, cacheSize: () => spriteCache.size }); // Mobile console-free diagnostics.
})();
