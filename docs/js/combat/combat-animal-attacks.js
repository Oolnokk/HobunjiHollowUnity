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
  const COMPANION_LUNGE_MAX_TILES = 2.6; // Shared attack engagement budget used by game.js and the named-attack dispatcher.
  const COMPANION_LUNGE_DURATION_S = 0.12; // Combat-burst duration, matching Guard Charge and Voorg-Ass Rear Kick.

  function companionEngagementRangePx(creature, tilePx) {
    const attackReach = Number(creature?.def?.attackRangePx); // Baseline reach before adding one committed burst.
    return Number.isFinite(attackReach) && attackReach > 0 && Number.isFinite(tilePx) && tilePx > 0
      ? attackReach + tilePx * COMPANION_LUNGE_MAX_TILES : attackReach;
  }

  function register(id, def) { ATTACKS[id] = def; }

  // ctx: { target } — the creature/player object this attack was aimed at
  // when triggered (player for a hostile, nearest hostile for a companion).
  function start(c, id, ctx) {
    const def = ATTACKS[id];
    if (!def) return false;
    const deps = window.Combat.deps;
    // game.js pays each species' generic attackStaminaCost immediately before
    // calling start(). Named attacks can top that payment up here without
    // making the generic bite/Guard Charge share their larger specialty cost.
    const additionalStaminaCost = Math.max(0, Number(def.additionalStaminaCost?.(c, ctx, deps)) || 0);
    if (additionalStaminaCost > 0) window.ResourceSystem?.spendStamina(c, additionalStaminaCost, def.label || id);
    const state = {};
    const target = ctx?.target; // Original companion decision remains locked during the opening charge.
    const reach = Number(c.def?.attackRangePx) || 0; // Ordinary attack reach controls where the opening charge stops.
    const distance = target && Number.isFinite(target.x) && Number.isFinite(target.y)
      ? Math.hypot(target.x - c.x, target.y - c.y) : 0; // Only eligible targets outside melee reach need the burst.
    let approach = null;
    if (c.isCompanion && !def.ownsApproach && reach > 0 && distance > reach && distance <= companionEngagementRangePx(c, deps.TILE)) { // A named move with its own charge, leap, burrow or attachment approach must not lunge twice.
      approach = {}; // Separate shared-lunge state never leaks into a signature attack's own state machine.
      beginConeLunge(c, approach, ctx, deps, {
        targets: [target], rangePx: reach, halfConeRad: Math.PI / 3, // Only the committed forward attack cone stops the charge; targets behind it must not trigger phantom contact.
        maxDistancePx: deps.TILE * COMPANION_LUNGE_MAX_TILES,
        speedPxS: deps.TILE * COMPANION_LUNGE_MAX_TILES / COMPANION_LUNGE_DURATION_S,
      });
      window.__farmLog?.('[companion-lunge] ' + (c.id || c.creatureKey || 'animal') + ' charging for ' + id, 'wildlife');
    } else {
      def.start(c, state, ctx, deps);
    }
    c._animalAttack = { id, def, state, approach, ctx };
    deps?.requestThreatGrowl?.(c, `attack:${id}`);
    return true;
  }

  function update(c, dt) {
    const aa = c._animalAttack;
    if (!aa) return false;
    if (aa.approach) {
      const reason = advanceConeLunge(c, aa.approach, dt, window.Combat.deps); // Uses the same collision substeps as every other animal attack lunge.
      if (!reason) return true;
      window.__farmLog?.('[companion-lunge] ' + (c.id || c.creatureKey || 'animal') + ' stopped: ' + reason + ' after ' + (aa.approach.lungeTraveledPx / Math.max(1, window.Combat.deps.TILE)).toFixed(2) + ' tiles', 'wildlife');
      aa.approach = null;
      aa.def.start(c, aa.state, aa.ctx, window.Combat.deps); // One committed original attack, without paying its Stamina/cooldown twice.
      return true;
    }
    const busy = aa.def.update(c, aa.state, dt, window.Combat.deps);
    if (!busy) endAttackPresentation(c);
    return busy;
  }

  // Every way an attack ends (finished, hit landed, cancelled) puts the body back
  // on the ground at full height. A leap that lands its hit mid-arc otherwise
  // left the creature drawn (and colliding) in mid-air until its next leap.
  function endAttackPresentation(c) {
    c._animalAttack = null;
    c.scaleY = 1;
    c._banditLungeHopCurrent = 0;
  }

  function isBusy(c) { return !!c._animalAttack; }

  // Quick Attack condition checks use this instead of guessing at private
  // named-attack stage strings. Each attack can declare exactly which part
  // is its committed/strike window; Pounce's is the whole leap.
  function isStriking(c) {
    const aa = c?._animalAttack;
    return !aa?.approach && !!(aa?.def?.isStriking?.(aa.state, c));
  }

  function isWindingUp(c) {
    const aa = c?._animalAttack; // Named attacks declare preparation windows without leaking private stage names to Quick Attacks.
    return !aa?.approach && !!(aa?.def?.isWindingUp?.(aa.state, c));
  }

  function cancel(c) {
    const aa = c._animalAttack;
    if (!aa) return;
    if (aa.approach) { c.vx = 0; c.vy = 0; } // Cancel an unstarted signature attack without calling its stage-specific cleanup.
    else if (aa.def.cancel) aa.def.cancel(c, aa.state, window.Combat.deps);
    endAttackPresentation(c);
  }

  // A selected named attack owns this forward charge until its own cone sees a
  // target, its travel budget expires, or terrain stops it. No AI re-selection.
  function beginConeLunge(c, state, context, deps, options) {
    const target = context?.target; // Original decision target supplies the committed bearing.
    state.lungeAngle = target && Number.isFinite(target.x) && Number.isFinite(target.y)
      ? Math.atan2(target.y - c.y, target.x - c.x) : (Number(c.facing) || 0);
    state.lungeTargets = options.targets || (target ? [target] : []); // Eligible actors sampled against the moving cone.
    state.lungeRangePx = Math.max(0, Number(options.rangePx) || 0); // Cone reach used only for stopping the charge.
    state.lungeHalfConeRad = Math.max(0, Number(options.halfConeRad) || 0); // Cone width shared with the eventual special.
    state.lungeMaxDistancePx = Math.max(0, Number(options.maxDistancePx) || 0); // Finite movement budget after commitment.
    state.lungeSpeedPxS = Math.max(1, Number(options.speedPxS) || 1); // Movement rate independent of the normal chase AI.
    state.lungeCollideRadiusPx = Math.max(0, Number(options.collideRadiusPx) || (deps.TILE || 32) * 0.32);
    state.lungeTraveledPx = 0; // Integrates the actual traversed distance, not target distance.
    state.lungeDetect = options.detect || null; // Optional 3D-specific collision test supplied by the named attack.
    c.facing = state.lungeAngle;
    c.vx = 0;
    c.vy = 0;
  }

  function coneLungeContact(c, state, deps) {
    for (const target of state.lungeTargets) {
      if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)
          || target._downed || (Number.isFinite(target.health) && target.health <= 0)
          || (target.areaId != null && c.areaId != null && target.areaId !== c.areaId)) continue;
      if (state.lungeDetect) {
        if (state.lungeDetect(c, target, state, deps)) return target;
      } else if (deps.inCone?.(c.x, c.y, state.lungeAngle, target.x, target.y, state.lungeRangePx, state.lungeHalfConeRad)) {
        return target;
      } else if (!deps.inCone) {
        const dx = target.x - c.x, dy = target.y - c.y; // Fallback for lightweight tests without engine collision helpers.
        const delta = Math.atan2(Math.sin(Math.atan2(dy, dx) - state.lungeAngle), Math.cos(Math.atan2(dy, dx) - state.lungeAngle));
        if (Math.hypot(dx, dy) <= state.lungeRangePx && Math.abs(delta) <= state.lungeHalfConeRad) return target;
      }
    }
    return null;
  }

  function advanceConeLunge(c, state, dt, deps) {
    const initialContact = coneLungeContact(c, state, deps); // Detect a target already within the actual attack cone.
    if (initialContact) { state.lungeContact = initialContact; return 'target'; }
    let remaining = Math.min(Math.max(0, Number(dt) || 0), 0.2) * state.lungeSpeedPxS;
    remaining = Math.min(remaining, Math.max(0, state.lungeMaxDistancePx - state.lungeTraveledPx));
    const maxStep = Math.max(1, (deps.TILE || 32) * 0.2); // Substeps prevent skipping thin targets or running through walls on slow frames.
    while (remaining > 0.0001) {
      const step = Math.min(remaining, maxStep);
      const nx = c.x + Math.cos(state.lungeAngle) * step;
      const ny = c.y + Math.sin(state.lungeAngle) * step;
      if (deps.canOccupyAt && !deps.canOccupyAt(nx, ny, state.lungeCollideRadiusPx)) return 'blocked';
      c.x = nx;
      c.y = ny;
      state.lungeTraveledPx += step;
      remaining -= step;
      deps.tickCreatureFootsteps?.(c, step);
      const contact = coneLungeContact(c, state, deps);
      if (contact) { state.lungeContact = contact; return 'target'; }
    }
    return state.lungeTraveledPx + 0.0001 >= state.lungeMaxDistancePx ? 'range' : null;
  }

  window.Combat.animalAttacks = {
    register, start, update, isBusy, isStriking, isWindingUp, cancel,
    beginConeLunge, advanceConeLunge, leapConeDetect, advanceLeap,
    companionEngagementRangePx,
    companionLungeTuning: Object.freeze({ maxTiles: COMPANION_LUNGE_MAX_TILES, durationS: COMPANION_LUNGE_DURATION_S }), // Mobile-accessible inspection of shared engagement timing.
  };

  // ── Pounce ──────────────────────────────────────────────────────────
  //
  // windup: locked in place, crouches by lerping scaleY down (bottom-edge
  // anchored — see updateCreatureMesh) toward POUNCE_CROUCH_SCALE_Y.
  // uncrouch: a quick lerp of scaleY back to 1 before the leap actually
  // starts ("lerp back to normal scale then zip forward").
  // leap: zips forward at fixed speed along the angle locked in at trigger
  // time — direction can't change once committed, so a player who's moved
  // out of the line by the time the leap starts simply isn't hit. The shared
  // pitched pie-prism collider stays centered on the creature's body and sweeps
  // with it every frame; the first living target (the original target, or
  // anything else that happens to be in the way) it catches takes damage and
  // knockback and ends the leap on the spot. If nothing's caught, the leap
  // keeps going — well past the original target's distance — until it
  // collides with solid terrain or the map edge.
  let POUNCE_WINDUP_S = 0.5;
  let POUNCE_UNCROUCH_S = 0.1;
  let POUNCE_CROUCH_SCALE_Y = 0.55;
  let POUNCE_LEAP_SPEED_PX_S = 480;
  let POUNCE_KNOCKBACK_PX_S = 320;
  let POUNCE_STAMINA_COST_MAX_FRACTION = 0.4; // Pounce total cost scales with the creature's own stamina pool.
  let POUNCE_STAMINA_COST_MIN = 18; // Keeps ordinary 30–40 Stamina animals meaningfully above their old 12–14 generic attack cost.

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function pounceAdditionalStaminaCost(c) {
    const maxStamina = Math.max(0, Number(c?.maxStamina) || 0);
    const genericCost = Math.max(0, Number(c?.def?.attackStaminaCost) || 0); // Already paid by game.js before animalAttacks.start().
    const totalPounceCost = Math.max(POUNCE_STAMINA_COST_MIN, maxStamina * POUNCE_STAMINA_COST_MAX_FRACTION);
    return Math.max(0, totalPounceCost - genericCost);
  }

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
        // A shoulder pet rides on the player's own body, not a separate
        // ground position — never a legitimate independent target for a
        // leap/charge cone (see combat-drenkirra-pellet.js's gatherTargets
        // for the same exclusion and reasoning).
        if (comp.stableRole === 'shoulderPet') continue;
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
    state.aimPitch = window.Combat?.meleeAimSolution?.(c, ctx.target, state.angle, 0)?.pitch || 0; // Used by the pounce's real 3D pie-prism collider.
    state.targets = gatherTargets(c, deps);
    state.rangePx = c.def.attackRangePx;
    state.halfConeRad = c.def.attackHalfConeRad;
    state.damage = c.def.attackDamage;
    // Preserve pounce's existing target-reaching travel budget, then let
    // the angled profile shorten/extend that budget from the species height.
    const baseLungeDistancePx = Math.max(
      state.rangePx,
      Math.hypot((ctx.target?.x ?? c.x) - c.x, (ctx.target?.y ?? c.y) - c.y),
    );
    state.lungeProfile = window.Combat?.meleeLungeProfile?.(
      baseLungeDistancePx,
      state.aimPitch,
      0,
      c.def.lungeHeightUnits ?? 1,
    ) || { distancePx: baseLungeDistancePx, hopUnits: 0, pitch: state.aimPitch };
    // The leap itself is the shared sub-stepped cone lunge (also Rear Kick's), committed now so its bearing is the
    // trigger-time bearing; it only starts moving once the crouch ends.
    beginConeLunge(c, state, ctx, deps, {
      targets: state.targets.map(target => target.ref),
      rangePx: state.rangePx,
      halfConeRad: state.halfConeRad,
      maxDistancePx: Math.max(0, state.lungeProfile.distancePx),
      speedPxS: c.isCompanion ? Math.max(POUNCE_LEAP_SPEED_PX_S, state.lungeProfile.distancePx / COMPANION_LUNGE_DURATION_S) : POUNCE_LEAP_SPEED_PX_S, // Keep wild pounce pacing; companion pounces leap at weapon-attack speed.
      collideRadiusPx: deps.TILE * 0.32,
      detect: leapConeDetect(),
    });
    c.facing = state.angle;
    c.scaleY = 1;
    c._banditLungeHopCurrent = 0; // Shared creature renderer slot for the pounce's vertical arc.
  }

  // The pounce's pitched pie-prism collider (Combat.meleeHit) as a cone-lunge
  // contact test; null falls back to advanceConeLunge's flat cone check.
  function leapConeDetect() {
    if (!window.Combat?.meleeHit) return null;
    return (c, target, state) => window.Combat.meleeHit(c, target, {
      rangePx: state.lungeRangePx,
      halfConeRad: state.lungeHalfConeRad,
      yaw: state.lungeAngle,
      pitch: state.aimPitch || 0,
    });
  }

  // One frame of a committed leap: sub-stepped travel (dt capped, so a frame
  // hitch can't carry it through a thin wall or past its target), the hop arc
  // from the distance actually covered, and the lunge trail. Returns
  // advanceConeLunge's stop reason ('target' | 'blocked' | 'range' | null).
  function advanceLeap(c, state, dt, deps, afflictionBonuses) {
    const traveledBefore = state.lungeTraveledPx;
    const stopReason = advanceConeLunge(c, state, dt, deps);
    const leapProgress = state.lungeMaxDistancePx > 0.001 ? Math.min(1, state.lungeTraveledPx / state.lungeMaxDistancePx) : 1;
    c._banditLungeHopCurrent = (state.lungeProfile?.hopUnits || 0) * Math.sin(leapProgress * Math.PI);
    const movedPx = state.lungeTraveledPx - traveledBefore;
    if (movedPx > 0) deps.tickCreatureLungeTrail?.(c, movedPx, afflictionBonuses);
    return stopReason;
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
    const dmgTag = c.def.attackTag || 'sharp';
    const afflictionBonuses = window.ResourceSystem?.afflictionBonusesForTag(dmgTag);
    const stopReason = advanceLeap(c, state, dt, deps, afflictionBonuses);
    if (!stopReason) return true;
    const ref = stopReason === 'target' ? state.lungeContact : null; // The first living target the moving cone caught.
    if (!ref) return false; // Ran out of travel or hit terrain: stop in place.
    const isPlayer = state.targets.some(target => target.isPlayer && target.ref === ref);
    if (isPlayer) deps.damagePlayer(state.damage, c.x, c.y, POUNCE_KNOCKBACK_PX_S, { tag: dmgTag, afflictionBonuses, attacker: c });
    else if (window.CompanionOffense) window.CompanionOffense.damageCreature(deps.damageCreature, c, ref, state.damage, c.x, c.y, POUNCE_KNOCKBACK_PX_S, { tag: dmgTag, afflictionBonuses, attacker: c }); // Whistle/Sicced empowerment for player companions; wild attackers pass through unchanged.
    else deps.damageCreature(ref, state.damage, c.x, c.y, POUNCE_KNOCKBACK_PX_S, { tag: dmgTag, afflictionBonuses });
    deps.playCreatureClawHit?.(c);
    return false; // hit landed; stop in place (update() lowers the hop)
  }

  function pounceCancel(c) {
    c.scaleY = 1;
    c._banditLungeHopCurrent = 0;
  }

  register('pounce', {
    label: 'Pounce',
    ownsApproach: true, // Its existing crouch-to-leap sequence already commits to a single attack lunge.
    start: pounceStart,
    update: pounceUpdate,
    cancel: pounceCancel,
    additionalStaminaCost: pounceAdditionalStaminaCost,
    isStriking: state => state?.stage === 'leap',
    isWindingUp: state => state?.stage === 'windup' || state?.stage === 'uncrouch',
  });

  // ── Guard Charge ────────────────────────────────────────────────────
  let GUARD_CHARGE_DURATION_S = 0.12;
  let GUARD_CHARGE_KNOCKBACK_PX_S = 450;
  let GUARD_CHARGE_TARGET_ANGLE_WEIGHT = 0.55;
  let GUARD_CHARGE_AWAY_FROM_MASTER_WEIGHT = 0.45;

  function guardChargeStart(c, state, ctx, deps) {
    state.t = 0;
    const directAngle = Math.atan2(ctx.target.y - c.y, ctx.target.x - c.x);
    const master = c.master || deps.player;
    const awayFromMasterAngle = Math.atan2(c.y - master.y, c.x - master.x);
    const targetDistancePx = Math.hypot(ctx.target.x - c.x, ctx.target.y - c.y); // Checks whether an extended-range companion charge should commit directly toward its enemy.
    const extendingCharge = c.isCompanion && targetDistancePx > (Number(c.def.attackRangePx) || 0); // Preserves the old master-defensive blend for attacks already within melee reach.
    state.angle = extendingCharge ? directAngle : Math.atan2(
      Math.sin(directAngle) * GUARD_CHARGE_TARGET_ANGLE_WEIGHT + Math.sin(awayFromMasterAngle) * GUARD_CHARGE_AWAY_FROM_MASTER_WEIGHT,
      Math.cos(directAngle) * GUARD_CHARGE_TARGET_ANGLE_WEIGHT + Math.cos(awayFromMasterAngle) * GUARD_CHARGE_AWAY_FROM_MASTER_WEIGHT,
    );
    state.aimPitch = window.Combat?.meleeAimSolution?.(c, ctx.target, state.angle, 0)?.pitch || 0; // Used by the guard charge's shared 3D collider.
    const halfSize = (c.visualModelWidth || c.def.modelWidth || 2) * deps.TILE / 2;
    const pounceReachPx = halfSize + halfSize * 2 * 1.5;
    state.distancePx = pounceReachPx / 3;
    state.rangePx = c.def.attackRangePx;
    if (extendingCharge) {
      state.distancePx = Math.min(COMPANION_LUNGE_MAX_TILES * deps.TILE, Math.max(state.distancePx, targetDistancePx - state.rangePx + deps.TILE * 0.08)); // Extend the ONE native charge, not a second generic approach.
    }
    state.halfConeRad = c.def.attackHalfConeRad;
    state.targets = gatherTargets(c, deps);
    // The same sub-stepped cone lunge as Pounce, on the blended guard bearing rather than straight at the target.
    beginConeLunge(c, state, ctx, deps, {
      targets: state.targets.map(target => target.ref),
      rangePx: state.rangePx,
      halfConeRad: state.halfConeRad,
      maxDistancePx: state.distancePx,
      speedPxS: state.distancePx / GUARD_CHARGE_DURATION_S,
      collideRadiusPx: deps.TILE * 0.32,
      detect: leapConeDetect(),
    });
    state.lungeAngle = state.angle;
    c.facing = state.angle;
  }

  function guardChargeUpdate(c, state, dt, deps) {
    state.t += dt;
    const stopReason = advanceConeLunge(c, state, dt, deps);
    if (!stopReason) return true;
    const ref = stopReason === 'target' ? state.lungeContact : null;
    if (!ref) return false; // Covered its distance or hit terrain.
    const dmgTag = c.def.attackTag || 'blunt';
    const afflictionBonuses = window.ResourceSystem?.afflictionBonusesForTag(dmgTag);
    const isPlayer = state.targets.some(target => target.isPlayer && target.ref === ref);
    if (isPlayer) deps.damagePlayer(0, c.x, c.y, GUARD_CHARGE_KNOCKBACK_PX_S, { tag: dmgTag, afflictionBonuses });
    else if (window.CompanionOffense) window.CompanionOffense.damageCreature(deps.damageCreature, c, ref, 0, c.x, c.y, GUARD_CHARGE_KNOCKBACK_PX_S, { tag: dmgTag, afflictionBonuses }); // Scales the charge's affliction buildup for player companions.
    else deps.damageCreature(ref, 0, c.x, c.y, GUARD_CHARGE_KNOCKBACK_PX_S, { tag: dmgTag, afflictionBonuses });
    deps.playCreatureClawHit?.(c);
    return false;
  }

  register('guardCharge', { start: guardChargeStart, update: guardChargeUpdate, ownsApproach: true }); // This move already performs its own 0.12-second collision-aware charge.

  window.Combat.animalAttacks.applyConfig = function (cfg) {
    if (!cfg) return;
    const p = cfg.pounce;
    if (p) {
      if (p.WINDUP_S != null) POUNCE_WINDUP_S = p.WINDUP_S;
      if (p.UNCROUCH_S != null) POUNCE_UNCROUCH_S = p.UNCROUCH_S;
      if (p.CROUCH_SCALE_Y != null) POUNCE_CROUCH_SCALE_Y = p.CROUCH_SCALE_Y;
      if (p.LEAP_SPEED_PX_S != null) POUNCE_LEAP_SPEED_PX_S = p.LEAP_SPEED_PX_S;
      if (p.KNOCKBACK_PX_S != null) POUNCE_KNOCKBACK_PX_S = p.KNOCKBACK_PX_S;
      if (p.STAMINA_COST_MAX_FRACTION != null) POUNCE_STAMINA_COST_MAX_FRACTION = Math.max(0, Number(p.STAMINA_COST_MAX_FRACTION) || 0);
      if (p.STAMINA_COST_MIN != null) POUNCE_STAMINA_COST_MIN = Math.max(0, Number(p.STAMINA_COST_MIN) || 0);
    }
    window.Combat.attach?.applyConfig?.(cfg); // Attach attacks (Swarm) read their own sections of the same creatureAttacks block.
    const g = cfg.guardCharge;
    if (g) {
      if (g.DURATION_S != null) GUARD_CHARGE_DURATION_S = g.DURATION_S;
      if (g.KNOCKBACK_PX_S != null) GUARD_CHARGE_KNOCKBACK_PX_S = g.KNOCKBACK_PX_S;
      if (g.TARGET_ANGLE_WEIGHT != null) GUARD_CHARGE_TARGET_ANGLE_WEIGHT = g.TARGET_ANGLE_WEIGHT;
      if (g.AWAY_FROM_MASTER_WEIGHT != null) GUARD_CHARGE_AWAY_FROM_MASTER_WEIGHT = g.AWAY_FROM_MASTER_WEIGHT;
    }
  };
})();
