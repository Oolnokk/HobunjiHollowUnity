// Combat animal attacks — named, modular attacks for non-player creatures,
// the creature-side counterpart to the player's loadout abilities
// (combat-loadout.js + combat-combo.js etc). Where combat-enemy-telegraph.js
// gives every hostile/companion the same generic windup→strike "bite", this
// module lets CREATURE_DB list specific named attacks per species
// (def.attacks: ['pounce', ...]) so different creatures can share some
// attacks and not others. Each registered attack owns its creature's
// position, facing, sprite frame, and scaleY for its full duration — the AI
// loop in game.js just calls start()/update()/isBusy()/cancel() and leaves
// movement/animation alone while busy, the same way it already treats
// telegraph.isBusy(c).
(() => {
  "use strict";
  if (!window.Combat) { console.error('combat-animal-attacks.js requires combat-core.js to load first'); return; }

  const ATTACKS = {};

  function register(id, def) { ATTACKS[id] = def; }

  // ctx: { target } — the creature/player object this attack was aimed at
  // when triggered (player for a hostile, nearest hostile for a companion).
  function start(c, id, ctx) {
    const def = ATTACKS[id];
    if (!def) return false;
    const state = {};
    def.start(c, state, ctx, window.Combat.deps);
    c._animalAttack = { def, state };
    window.Combat.deps?.playCreatureBark?.(c);
    return true;
  }

  function update(c, dt) {
    const aa = c._animalAttack;
    if (!aa) return false;
    const busy = aa.def.update(c, aa.state, dt, window.Combat.deps);
    if (!busy) {
      c._animalAttack = null;
      c.scaleY = 1;
    }
    return busy;
  }

  function isBusy(c) { return !!c._animalAttack; }

  function cancel(c) {
    const aa = c._animalAttack;
    if (!aa) return;
    if (aa.def.cancel) aa.def.cancel(c, aa.state, window.Combat.deps);
    c._animalAttack = null;
    c.scaleY = 1;
  }

  window.Combat.animalAttacks = { register, start, update, isBusy, cancel };

  // ── Pounce ──────────────────────────────────────────────────────────
  //
  // windup: locked in place, crouches by lerping scaleY down (bottom-edge
  // anchored — see updateCreatureMesh) toward POUNCE_CROUCH_SCALE_Y.
  // uncrouch: a quick lerp of scaleY back to 1 before the leap actually
  // starts ("lerp back to normal scale then zip forward").
  // leap: zips forward at fixed speed along the angle locked in at trigger
  // time — direction can't change once committed, so a player who's moved
  // out of the line by the time the leap starts simply isn't hit. A cone
  // collider anchored just ahead of the creature ("the head") sweeps along
  // with it every frame; the first living target (the original target, or
  // anything else that happens to be in the way) it catches takes damage and
  // knockback and ends the leap on the spot. If nothing's caught, the leap
  // keeps going — well past the original target's distance — until it
  // collides with solid terrain or the map edge.
  const POUNCE_WINDUP_S = 0.5;
  const POUNCE_UNCROUCH_S = 0.1;
  const POUNCE_CROUCH_SCALE_Y = 0.55;
  const POUNCE_LEAP_SPEED_PX_S = 480;
  const POUNCE_KNOCKBACK_PX_S = 640;

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  // Every other living thing the leap's cone could plausibly catch: the
  // creature's intended target plus anyone on the "other side" who might
  // wander into the cone by accident. Hostiles can accidentally clip a
  // companion; companions can accidentally clip any hostile (not just the
  // one they were chasing).
  function gatherTargets(c, deps) {
    const out = [];
    if (c.isCompanion) {
      for (const h of deps.hostileObjects) {
        if (h.health > 0 && h.areaId === c.areaId) out.push({ isPlayer: false, ref: h });
      }
    } else {
      // deps.players is the full player list (see game.js's `players` array)
      // — falls back to just deps.player for any older/ad-hoc deps object
      // that doesn't set it. A hostile's leap/charge can clip whichever of
      // them it actually catches in its cone, not only the local player.
      for (const p of deps.players || [deps.player]) out.push({ isPlayer: true, ref: p });
      for (const comp of deps.companionObjects) {
        if (comp.health > 0 && comp.areaId === c.areaId) out.push({ isPlayer: false, ref: comp });
      }
    }
    return out;
  }

  function pounceStart(c, state, ctx, deps) {
    state.stage = 'windup';
    state.t = 0;
    // Direction locks the instant the pounce is triggered — nothing during
    // windup/uncrouch/leap re-aims it, which is what makes the leap
    // genuinely dodgeable.
    state.angle = Math.atan2(ctx.target.y - c.y, ctx.target.x - c.x);
    state.targets = gatherTargets(c, deps);
    state.rangePx = c.def.attackRangePx;
    state.halfConeRad = c.def.attackHalfConeRad;
    state.damage = c.def.attackDamage;
    state.headOffsetPx = deps.TILE * 0.3;
    state.collideRadiusPx = deps.TILE * 0.32;
    c.facing = state.angle;
    c.scaleY = 1;
  }

  function pounceUpdate(c, state, dt, deps) {
    state.t += dt;

    if (state.stage === 'windup') {
      const t = Math.min(1, state.t / POUNCE_WINDUP_S);
      c.scaleY = 1 - (1 - POUNCE_CROUCH_SCALE_Y) * easeOutCubic(t);
      if (t >= 1) { state.stage = 'uncrouch'; state.t = 0; }
      return true;
    }

    if (state.stage === 'uncrouch') {
      const t = Math.min(1, state.t / POUNCE_UNCROUCH_S);
      c.scaleY = POUNCE_CROUCH_SCALE_Y + (1 - POUNCE_CROUCH_SCALE_Y) * easeOutCubic(t);
      if (t >= 1) {
        c.scaleY = 1;
        state.stage = 'leap';
        state.t = 0;
        // Lock the sprite onto a single non-idle (mid-stride) frame for the
        // whole leap instead of letting the default run-cycle keep ticking.
        // Must still pass genotype info through — this bypasses game.js's
        // normal updateCreatureAnimFrame retry loop entirely for the whole
        // leap (isBusy() suppresses it), so a plain 2-arg setCreatureFrame
        // call here would silently stomp a gar-wolf/dabinggi-hound's
        // composited base-color/pattern texture back to the un-recolored
        // fallback sprite for the leap's full duration (which, if it never
        // connects with a target, can run until it hits terrain or the map
        // edge — i.e. a long time).
        // Portrait-avatar combatants (bandits — see game.js's buildBanditAvatar)
        // have no sprite sheet to lock a frame from; the leap's movement,
        // scaling and damage all still apply, there's just no frame to swap.
        if (c.def.sprites) {
          const frameUrl = c.def.sprites.run[0];
          const genotypeKind = deps.genotypeKindFor ? deps.genotypeKindFor(c) : null;
          deps.setCreatureFrame(c.avatarRef, frameUrl, genotypeKind, 'run1', c.genotype);
          c.currentFrameUrl = frameUrl;
        }
      }
      return true;
    }

    // stage === 'leap'
    const dirX = Math.cos(state.angle), dirY = Math.sin(state.angle);
    const stepPx = POUNCE_LEAP_SPEED_PX_S * dt;
    const nx = c.x + dirX * stepPx, ny = c.y + dirY * stepPx;
    if (!deps.canOccupyAt(nx, ny, state.collideRadiusPx)) return false; // collided; stop in place

    c.x = nx;
    c.y = ny;
    // The leap covers real ground at a real speed (POUNCE_LEAP_SPEED_PX_S) —
    // same footstep hook as ordinary movement, so a pouncing creature is
    // still audible instead of silently gliding in for the hit.
    deps.tickCreatureFootsteps?.(c, stepPx);

    // Species-specific — see CREATURE_DB's attackTag (gar-wolves 'sharp',
    // dabinggi-hounds 'poison', Uumkao'ii 'blunt') — so every one of a
    // creature's slottable attacks (this leap, the plain bite telegraph,
    // guardCharge) afflicts consistently with its species instead of
    // Pounce hardcoding 'sharp'. afflictionBonusesForTag turns that tag
    // into the actual bleed/bruise/poison application (resource-system.js).
    // Computed once per leap frame (not per target below) since it's the
    // same value regardless of who gets hit — also feeds the leap's own
    // onion-ring ground trail, same treatment the player's attack lunges
    // get (see game.js's beginCombatLunge/spawnLungeTrailStamp).
    const dmgTag = c.def.attackTag || 'sharp';
    const afflictionBonuses = window.ResourceSystem?.afflictionBonusesForTag(dmgTag);
    deps.tickCreatureLungeTrail?.(c, stepPx, afflictionBonuses);

    const headX = c.x + dirX * state.headOffsetPx, headY = c.y + dirY * state.headOffsetPx;
    for (const target of state.targets) {
      const ref = target.ref;
      if (ref.health <= 0) continue;
      if (!deps.inCone(headX, headY, state.angle, ref.x, ref.y, state.rangePx, state.halfConeRad)) continue;
      if (target.isPlayer) deps.damagePlayer(state.damage, headX, headY, POUNCE_KNOCKBACK_PX_S, { tag: dmgTag, afflictionBonuses });
      else deps.damageCreature(ref, state.damage, headX, headY, POUNCE_KNOCKBACK_PX_S, { tag: dmgTag, afflictionBonuses });
      deps.playCreatureClawHit?.(c);
      return false; // hit landed; stop in place
    }
    return true;
  }

  function pounceCancel(c) {
    c.scaleY = 1;
  }

  register('pounce', { start: pounceStart, update: pounceUpdate, cancel: pounceCancel });

  // ── Guard Charge ────────────────────────────────────────────────────
  //
  // Companions' common (3-of-4) attack action: an instant, zero-damage
  // shove rather than a real bite. Travels only ~1/3rd of pounce's reach
  // and lands in a blink (no windup/uncrouch stages to read), but carries
  // high knockback — it's a positioning tool, not a damage source. Aimed
  // off a blend of "straight at the target" and "away from the
  // companion's own master" so the shove also tends to put daylight
  // between the companion and the player it's guarding, rather than
  // charging in along the same line the player might be standing on.
  const GUARD_CHARGE_DURATION_S = 0.12;
  const GUARD_CHARGE_KNOCKBACK_PX_S = 900;
  const GUARD_CHARGE_TARGET_ANGLE_WEIGHT = 0.55;
  const GUARD_CHARGE_AWAY_FROM_MASTER_WEIGHT = 0.45;

  function guardChargeStart(c, state, ctx, deps) {
    state.t = 0;
    const directAngle = Math.atan2(ctx.target.y - c.y, ctx.target.x - c.x);
    // guardCharge only ever fires from a companion's own behavior loop (see
    // updateCompanions in game.js), so c.master is normally already set to
    // whoever it's guarding — the deps.player fallback only covers a
    // companion caught mid-save-migration without the field yet.
    const master = c.master || deps.player;
    const awayFromMasterAngle = Math.atan2(c.y - master.y, c.x - master.x);
    state.angle = Math.atan2(
      Math.sin(directAngle) * GUARD_CHARGE_TARGET_ANGLE_WEIGHT + Math.sin(awayFromMasterAngle) * GUARD_CHARGE_AWAY_FROM_MASTER_WEIGHT,
      Math.cos(directAngle) * GUARD_CHARGE_TARGET_ANGLE_WEIGHT + Math.cos(awayFromMasterAngle) * GUARD_CHARGE_AWAY_FROM_MASTER_WEIGHT,
    );
    // Same aim-collider-reach formula as the AI's pounce-range check
    // (game.js's creatureAimColliderReachPx) — duplicated here since that
    // helper isn't exposed via deps — divided down to a third of pounce's
    // own travel distance.
    const halfSize = (c.def.modelWidth || 2) * deps.TILE / 2;
    const pounceReachPx = halfSize + halfSize * 2 * 1.5;
    state.distancePx = pounceReachPx / 3;
    state.traveledPx = 0;
    state.speedPxS = state.distancePx / GUARD_CHARGE_DURATION_S;
    state.rangePx = c.def.attackRangePx;
    state.halfConeRad = c.def.attackHalfConeRad;
    state.headOffsetPx = deps.TILE * 0.3;
    state.collideRadiusPx = deps.TILE * 0.32;
    state.targets = gatherTargets(c, deps);
    c.facing = state.angle;
  }

  function guardChargeUpdate(c, state, dt, deps) {
    state.t += dt;
    const dirX = Math.cos(state.angle), dirY = Math.sin(state.angle);
    const stepPx = Math.min(state.speedPxS * dt, state.distancePx - state.traveledPx);
    if (stepPx > 0) {
      const nx = c.x + dirX * stepPx, ny = c.y + dirY * stepPx;
      if (!deps.canOccupyAt(nx, ny, state.collideRadiusPx)) return false; // collided; stop in place
      c.x = nx;
      c.y = ny;
      state.traveledPx += stepPx;
    }

    const headX = c.x + dirX * state.headOffsetPx, headY = c.y + dirY * state.headOffsetPx;
    for (const target of state.targets) {
      const ref = target.ref;
      if (ref.health <= 0) continue;
      if (!deps.inCone(headX, headY, state.angle, ref.x, ref.y, state.rangePx, state.halfConeRad)) continue;
      // 0 damage today (a pure knockback tackle), so the affliction is
      // currently inert too (finalDamage * mul === 0) — kept consistent
      // with Pounce/bite anyway (see CREATURE_DB's attackTag) in case that
      // ever changes.
      const dmgTag = c.def.attackTag || 'blunt';
      const afflictionBonuses = window.ResourceSystem?.afflictionBonusesForTag(dmgTag);
      if (target.isPlayer) deps.damagePlayer(0, headX, headY, GUARD_CHARGE_KNOCKBACK_PX_S, { tag: dmgTag, afflictionBonuses });
      else deps.damageCreature(ref, 0, headX, headY, GUARD_CHARGE_KNOCKBACK_PX_S, { tag: dmgTag, afflictionBonuses });
      deps.playCreatureClawHit?.(c);
      return false; // hit landed; stop in place
    }
    return state.traveledPx < state.distancePx;
  }

  register('guardCharge', { start: guardChargeStart, update: guardChargeUpdate });
})();
