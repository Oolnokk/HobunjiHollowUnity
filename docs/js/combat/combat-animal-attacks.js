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

  function mostExpensiveCompanionSpecial(c, ctx) {
    const deps = window.Combat.deps; // Shared combat context owns the local player and species attack costs.
    if (!c?.isCompanion || c.banditCompanion || c.stableRole !== 'companion' || !deps?.player || (c.master || deps.player) !== deps.player) return null; // Legacy companions missing a master still belong to the local player.
    const enabledIds = window.StableAnimalTrainingRefinements?.enabledSpecialAttackIds?.(c) || c.def?.attacks || []; // Stable tactics exclude deliberately disabled special attacks.
    const tempo = window.StableAnimalTrainingRefinements?.combatTempo?.(c); // Matches the ordinary companion attack's tempo-adjusted base cost.
    const costTax = Math.max(0, Number(window.ResourceSystem?.timedDebuffModifier?.(c, 'staminaCost') ?? 1)); // Includes Taxed just as spendStamina does.
    const genericCost = Math.max(0, Number(c.def?.attackStaminaCost) || 0) * (tempo?.stamina || 1);
    let best = null; // The most expensive registered special is the automatic Furious attack.
    for (const id of enabledIds) {
      const def = ATTACKS[id];
      if (!def || id === 'guardCharge') continue;
      const extra = Math.max(0, Number(def.additionalStaminaCost?.(c, ctx, deps)) || 0);
      const cost = Math.round((genericCost + extra) * costTax * 10) / 10;
      if (cost > 0 && (!best || cost > best.cost)) best = { id, cost };
    }
    return best;
  }

  function startFuriousSpecial(c, ctx) {
    if (!ctx?.target || c?._animalAttack || !window.ResourceSystem?.removeAffliction) return false;
    const available = window.ResourceSystem.getAffliction?.(c, 'furiousStamina') ?? c.afflictions?.furiousStamina ?? 0;
    if (!(available > 0)) return false; // Do not normalize Stable tactics or enumerate special costs for the common unbuffed companion.
    const special = mostExpensiveCompanionSpecial(c, ctx); // No species special means Furious Stamina waits rather than forcing Guard Charge.
    if (!special) return false;
    if (available + 0.0001 < special.cost) return false;
    const now = performance.now(); // Snapshots a real-time signature cooldown that normally uses performance.now rather than attackCooldownT.
    const cooldownBefore = Math.max(0, Number(c.attackCooldownT) || 0);
    const hadRearKickCooldown = Object.hasOwn(c, '_voorgRearKickCooldownUntil');
    const rearKickRemainingMs = Math.max(0, (Number(c._voorgRearKickCooldownUntil) || 0) - now);
    if (!start(c, special.id, { ...ctx, furiousSpecial: true })) return false;
    window.StableAnimalTrainingRefinements?.prepareFuriousSpecial?.(c, special.id); // The forced move uses its existing Stable damage/affliction focus.
    const paid = window.ResourceSystem.removeAffliction(c, 'furiousStamina', special.cost); // Consume ONLY Furious; ordinary/black Stamina and Moralized are untouched.
    if (paid + 0.0001 < special.cost) { cancel(c); return false; }
    c._furiousSpecial = { id: special.id, cost: paid, cooldownBefore, hadRearKickCooldown, rearKickRemainingMs };
    c._lastFuriousSpecial = { id: special.id, cost: paid, speedMultiplier: 2, state: 'active' }; // Mobile-readable combat diagnostic survives after the move ends.
    window.__farmLog?.('[furious-companion] ' + (c.id || c.creatureKey || 'animal') + ' triggered ' + special.id + ' at 2x for ' + paid + ' Furious Stamina', 'combat');
    return true;
  }

  function finishFuriousSpecial(c) {
    const special = c?._furiousSpecial;
    if (!special) return;
    c.attackCooldownT = special.cooldownBefore; // Resume the exact ordinary cooldown remaining before the interrupt.
    if (special.hadRearKickCooldown) c._voorgRearKickCooldownUntil = performance.now() + special.rearKickRemainingMs; // Pause the independently timestamped Rear Kick cooldown too.
    else delete c._voorgRearKickCooldownUntil; // An auto-triggered Rear Kick must not silently start a new ordinary special cooldown.
    c._lastFuriousSpecial = { ...c._lastFuriousSpecial, state: 'finished', remainingCooldownS: c.attackCooldownT };
    c._furiousSpecial = null;
  }

  // An already-funded special reuses its authored def.start/def.update. No
  // duplicate creature AI, animation player, or stamina payment is introduced.
  function beginSpecialPhase(c, def, ctx, deps, echoRatio = null) {
    const state = echoRatio == null ? {} : { feyHypedEchoRatio: echoRatio }; // Shared cone-lunge owner scales only the second physical movement effect.
    const target = ctx?.target; // Original target stays committed; each special's own live collision checks can still miss it.
    const reach = Number(c.def?.attackRangePx) || 0;
    const distance = target && Number.isFinite(target.x) && Number.isFinite(target.y)
      ? Math.hypot(target.x - c.x, target.y - c.y) : 0;
    let approach = null; // Optional native companion opening lunge, never a second extra approach for a special that owns one.
    if (c.isCompanion && !def.ownsApproach && reach > 0 && distance > reach && distance <= companionEngagementRangePx(c, deps.TILE)) {
      approach = echoRatio == null ? {} : { feyHypedEchoRatio: echoRatio };
      beginConeLunge(c, approach, ctx, deps, {
        targets: [target], rangePx: reach, halfConeRad: Math.PI / 3,
        maxDistancePx: deps.TILE * COMPANION_LUNGE_MAX_TILES,
        speedPxS: deps.TILE * COMPANION_LUNGE_MAX_TILES / COMPANION_LUNGE_DURATION_S,
      });
      window.__farmLog?.('[companion-lunge] ' + (c.id || c.creatureKey || 'animal') + ' charging for ' + def.label, 'wildlife');
    } else def.start(c, state, ctx, deps);
    return { state, approach };
  }

  function targetPresent(c, target) {
    return !target || ((Number(target.health) > 0 || !Number.isFinite(Number(target.health)))
      && (!c.areaId || !target.areaId || c.areaId === target.areaId)); // A vanished/moved foe cannot be hit by a new second special.
  }

  // In the first pass, all dependencies are unchanged. A replay receives one
  // actor-local view of the real damage owner; other creatures attacking in
  // the same frame are entirely unaffected by the currently Hyped animal.
  function specialDeps(c, aa, deps) {
    const hype = aa.hyped;
    if (!hype || hype.phase !== 1) return deps;
    if (hype.deps) return hype.deps;
    const view = Object.create(deps); // Preserve Combat.deps lookups, live LOS, map height and target services without cloning the whole context.
    const effects = window.FeyHypedAttacks;
    if (typeof deps.damagePlayer === 'function') view.damagePlayer = (amount, x, y, knockback, opts = {}) => {
      const player = deps.player; // Actual player damage authority retains its own dodge, i-frame and injury rules.
      if (player && (!targetPresent(c, player) || Number(player.health) <= 0)) return false;
      const payload = effects?.creatureDamagePayload?.(c, amount, knockback, opts);
      if (!payload) return deps.damagePlayer(amount, x, y, knockback, opts);
      const applied = deps.damagePlayer(payload.damage, x, y, payload.knockback, payload.opts);
      if (applied !== false) hype.hits++; // Count independently resolved secondary contacts, not precomputed victim copies.
      return applied;
    };
    if (typeof deps.damageCreature === 'function') view.damageCreature = (target, amount, x, y, knockback, opts = {}) => {
      if (!targetPresent(c, target) || Number(target?.health) <= 0) return false;
      const payload = effects?.creatureDamagePayload?.(c, amount, knockback, opts);
      if (!payload) return deps.damageCreature(target, amount, x, y, knockback, opts);
      const applied = deps.damageCreature(target, payload.damage, x, y, payload.knockback, payload.opts);
      if (applied !== false) hype.hits++;
      return applied;
    };
    hype.deps = view; // One wrapper per paid creature special, allocated only for the second stage.
    return view;
  }

  function replaySpecial(c, aa, deps) {
    const hype = aa.hyped;
    if (!hype || hype.phase !== 0 || (Number.isFinite(Number(c.health)) && Number(c.health) <= 0) || !targetPresent(c, aa.ctx?.target)
      || (hype.area && c.areaId !== hype.area)) return false;
    c.scaleY = 1; c._banditLungeHopCurrent = 0; // The first leap/burrow cannot leave a vertical offset behind before the new authored stage starts.
    hype.phase = 1;
    hype.hits = 0;
    const ctx = { ...aa.ctx, feyHypedEcho: true }; // Attack-specific target, training and pose data are unchanged.
    const phase = beginSpecialPhase(c, aa.def, ctx, deps, hype.ratio);
    aa.state = phase.state;
    aa.approach = phase.approach;
    aa.ctx = ctx;
    c._lastHypedCreatureAttack = { id: aa.id, used: hype.used, ratio: hype.ratio, stage: 'echo' }; // Mobile-readable status without holding a target reference.
    return true;
  }

  // ctx: { target } — the creature/player object this attack was aimed at
  // when triggered (player for a hostile, nearest hostile for a companion).
  function start(c, id, ctx) {
    const def = ATTACKS[id];
    if (!def || !c || c._animalAttack || (Number.isFinite(c.health) && c.health <= 0)) return false;
    const deps = window.Combat.deps;
    const additionalStaminaCost = Math.max(0, Number(def.additionalStaminaCost?.(c, ctx, deps)) || 0);
    if (additionalStaminaCost > 0 && !ctx?.furiousSpecial) {
      const taxed = Number(window.ResourceSystem?.timedDebuffModifier?.(c, 'staminaCost') ?? 1);
      const required = additionalStaminaCost * (Number.isFinite(taxed) && taxed >= 0 ? taxed : 1);
      if (c.isCompanion && !c.banditCompanion && Number.isFinite(c.stamina) && c.stamina + 0.0001 < required) {
        window.FeyHypedAttacks?.clearCredit?.(c, 'creatureSpecial'); // A rejected top-up cannot give a later unpaid special a stale echo.
        return false;
      }
      window.ResourceSystem?.spendStamina(c, additionalStaminaCost, def.label || id, {
        actionKind: 'combatCreatureSpecial', abilityId: 'creatureSpecial',
      }); // Pounce's actual top-up may also spend Hyped; the entire paid amount funds one double attack.
    }
    const phase = beginSpecialPhase(c, def, ctx, deps);
    const hype = ctx?.furiousSpecial ? null : window.FeyHypedAttacks?.claimCreatureSpecial?.(c);
    c._animalAttack = { id, def, state: phase.state, approach: phase.approach, ctx,
      hyped: hype ? { ...hype, phase: 0, hits: 0, area: c.areaId, deps: null } : null };
    if (hype) {
      c._lastHypedCreatureAttack = { id, used: hype.used, ratio: hype.ratio, stage: 'first' };
      window.__farmLog?.('[fey-hyped-creature] ' + (c.id || c.creatureKey || 'creature') + ' ' + id + ' two attacks at x2, second effect x' + hype.ratio.toFixed(2), 'combat');
    }
    deps?.requestThreatGrowl?.(c, 'attack:' + id);
    return true;
  }

  function update(c, dt) {
    const aa = c?._animalAttack;
    if (!aa) return false;
    if ((Number.isFinite(Number(c.health)) && Number(c.health) <= 0) || (aa.hyped?.area && c.areaId !== aa.hyped.area)) { cancel(c); return false; } // Health-less editor/test actors remain active; only explicit death or map departure cancels.
    // Hyped and Furious each mean 2x speed; these are exclusive commitments,
    // never a 4x compound tempo or a free third attack.
    const speed = (aa.hyped || c._furiousSpecial) ? 2 : 1;
    const elapsed = Math.max(0, Number(dt) || 0) * speed;
    const deps = window.Combat.deps;
    if (aa.approach) {
      const reason = advanceConeLunge(c, aa.approach, elapsed, deps);
      if (!reason) return true;
      window.__farmLog?.('[companion-lunge] ' + (c.id || c.creatureKey || 'animal') + ' stopped: ' + reason + ' after ' + (aa.approach.lungeTraveledPx / Math.max(1, deps.TILE)).toFixed(2) + ' tiles', 'wildlife');
      aa.approach = null;
      aa.def.start(c, aa.state, aa.ctx, deps);
      return true;
    }
    const busy = aa.def.update(c, aa.state, elapsed, specialDeps(c, aa, deps));
    if (busy) return true;
    if (aa.hyped?.phase === 0 && replaySpecial(c, aa, deps)) return true;
    endAttackPresentation(c);
    return false;
  }

  function endAttackPresentation(c, status = 'finished') {
    const aa = c?._animalAttack;
    if (aa?.hyped) {
      const hype = aa.hyped;
      window.FeyHypedAttacks?.noteCreatureEcho?.(c, status, aa.id, hype, hype.hits);
      c._lastHypedCreatureAttack = { id: aa.id, used: hype.used, ratio: hype.ratio, stage: status, hits: hype.hits };
      hype.deps = null; // Release the actor-local damage wrappers when the attack's final state completes.
    }
    finishFuriousSpecial(c);
    c._animalAttack = null;
    c.scaleY = 1;
    c._banditLungeHopCurrent = 0;
  }

  function isBusy(c) { return !!c?._animalAttack; }

  function isStriking(c) {
    const aa = c?._animalAttack;
    return !aa?.approach && !!(aa?.def?.isStriking?.(aa.state, c));
  }

  function isWindingUp(c) {
    const aa = c?._animalAttack;
    return !aa?.approach && !!(aa?.def?.isWindingUp?.(aa.state, c));
  }

  function cancel(c) {
    const aa = c?._animalAttack;
    if (!aa) return;
    if (aa.approach) { c.vx = 0; c.vy = 0; }
    else aa.def.cancel?.(c, aa.state, window.Combat.deps);
    endAttackPresentation(c, 'cancelled');
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
    const echoRatio = Number.isFinite(state.feyHypedEchoRatio) ? Math.max(0, state.feyHypedEchoRatio) : 1; // The second creature special's physical burst has 2%-per-point reach; its hit cone remains authoritative.
    const mobility = window.ResourceSystem?.movementMultiplier?.(c, 'lunge') ?? 1; // All creature special lunges share the same scalar movement budget.
    state.lungeMaxDistancePx = Math.max(0, Number(options.maxDistancePx) || 0) * echoRatio * mobility; // Finite movement budget after commitment.
    state.lungeSpeedPxS = Math.max(1, Number(options.speedPxS) || 1) * echoRatio * mobility; // A reduced second lunge cannot travel its full original budget on a slow frame.
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
          || target._downed || target._denHidden || target._deathTransitionStarted || (Number.isFinite(target.health) && target.health <= 0)
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
      const rs = window.ResourceSystem; // Composes each bounded terrain substep, preserving contact tests along the actual drifted route.
      const motion = rs?.composeMovement?.(c, Math.cos(state.lungeAngle) * step, Math.sin(state.lungeAngle) * step, { mode: 'lunge', scalarApplied: true, rotationApplied: true, reference: step, airborne: state.airborne === true, dt: step / Math.max(.001, state.lungeSpeedPxS) });
      const dx = motion?.x ?? Math.cos(state.lungeAngle) * step, dy = motion?.y ?? Math.sin(state.lungeAngle) * step;
      // Wind can enlarge an airborne substep by up to three quarters; subdivide the composed path
      // again so the original maximum collision interval remains authoritative.
      const splits = Math.max(1, Math.ceil(Math.hypot(dx, dy) / maxStep));
      for (let i = 0; i < splits; i++) {
        const nx = c.x + dx / splits, ny = c.y + dy / splits;
        if (deps.canOccupyAt && !deps.canOccupyAt(nx, ny, state.lungeCollideRadiusPx)) {
          if (motion?.wind) rs.commitMovement?.(c, motion, i / splits, window.Combat?.deps?.movementFootingDepleted);
          return 'blocked';
        }
        c.x = nx; c.y = ny;
        state.lungeTraveledPx += step / splits; // Authored progress, not extra wind distance: assisted lunges keep their original duration.
        deps.tickCreatureFootsteps?.(c, Math.hypot(dx, dy) / splits);
        const hit = coneLungeContact(c, state, deps);
        if (hit) {
          if (motion?.wind) rs.commitMovement?.(c, motion, (i + 1) / splits, window.Combat?.deps?.movementFootingDepleted);
          if (c.prone) return 'range';
          state.lungeContact = hit; return 'target';
        }
      }
      if (motion?.wind) rs.commitMovement?.(c, motion, 1, window.Combat?.deps?.movementFootingDepleted);
      if (c.prone) return 'range';
      remaining -= step;
      const contact = coneLungeContact(c, state, deps);
      if (contact) { state.lungeContact = contact; return 'target'; }
    }
    return state.lungeTraveledPx + 0.0001 >= state.lungeMaxDistancePx ? 'range' : null;
  }

  // Each short-lived attack burst is normally one draw per visible mote. Batch
  // same-material tetrahedra into one instanced draw, while retaining the
  // original attack-owned simulation, timing and visual transforms.
  function createParticleBatch(THREE, parent, geometry, materials, capacity) {
    if (!THREE?.InstancedMesh || !THREE?.Object3D || !parent?.add || !geometry || !materials?.length) return null;
    const limit = Math.max(1, Math.min(1024, Math.ceil(Number(capacity) || 1))); // Hard GPU allocation ceiling for malformed authored rates.
    const meshes = []; // Owned scene nodes: one per color/material, never one per particle.
    const positions = new Uint16Array(materials.length); // Reused per-material instance offsets on every frame.
    const transform = new THREE.Object3D(); // One reusable transform/matrix scratch for the whole burst.
    let pendingGeometry = null; // Disposed if constructing or attaching an instanced mesh throws.
    try {
      for (const material of materials) {
        pendingGeometry = geometry.clone(); // Each batch owns the tiny tetra geometry and can release its instance GPU buffer without invalidating the shared source.
        const mesh = new THREE.InstancedMesh(pendingGeometry, material, limit);
        mesh.count = 0;
        mesh.frustumCulled = false; // Burst particles move independently of the static instance bounding sphere.
        mesh.instanceMatrix?.setUsage?.(THREE.DynamicDrawUsage);
        parent.add(mesh);
        meshes.push(mesh);
        pendingGeometry = null;
      }
    } catch (error) {
      pendingGeometry?.dispose?.();
      for (const mesh of meshes) {
        mesh.parent?.remove?.(mesh);
        if (mesh.geometry !== geometry) mesh.geometry?.dispose?.();
      }
      return null; // Older or incomplete renderers keep the existing per-mote fallback.
    }
    let disposed = false; // Prevent a cancelled attack from updating removed scene nodes.
    return {
      meshes,
      capacity: limit,
      sync(particles, writeTransform) {
        if (disposed) return;
        positions.fill(0);
        for (const particle of particles) {
          const materialIndex = Math.max(0, Math.min(meshes.length - 1, particle.materialIndex || 0)); // Visual shade chosen by the owning attack.
          const index = positions[materialIndex]++;
          if (index >= limit) { positions[materialIndex] = limit; continue; }
          writeTransform(transform, particle);
          transform.updateMatrix();
          meshes[materialIndex].setMatrixAt(index, transform.matrix);
        }
        for (let i = 0; i < meshes.length; i++) {
          const mesh = meshes[i];
          const count = positions[i];
          if (count || mesh.count !== count) mesh.instanceMatrix.needsUpdate = true;
          mesh.count = count;
        }
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const mesh of meshes) {
          mesh.parent?.remove?.(mesh);
          if (mesh.geometry !== geometry) mesh.geometry?.dispose?.();
        }
      },
    };
  }

  window.Combat.animalAttacks = {
    register, start, update, isBusy, isStriking, isWindingUp, cancel,
    mostExpensiveCompanionSpecial, startFuriousSpecial,
    hypedDebug: c => ({ active: !!c?._animalAttack?.hyped, last: c?._lastHypedCreatureAttack || null }), // Pixel Probe and mobile creature diagnostics without a new widget.
    furiousDebug: c => ({ active: !!c?._furiousSpecial, threshold: mostExpensiveCompanionSpecial(c, { target: c })?.cost ?? null, last: c?._lastFuriousSpecial || null }),
    beginConeLunge, advanceConeLunge, leapConeDetect, advanceLeap,
    companionEngagementRangePx, createParticleBatch,
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
    if (c.isCompanion && !c.banditCompanion) {
      for (const h of deps.hostileObjects) {
        if (h !== c && h.health > 0 && h.areaId === c.areaId && !h._downed && !h._denHidden && !h._deathTransitionStarted) out.push({ isPlayer: false, ref: h });
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
        if (comp.stableRole === 'shoulderPet' || (c.banditCompanion && comp.banditCompanion)) continue; // Enemy pets can strike player companions, never their allied Beastmaster pets.
        if (comp !== c && comp.health > 0 && comp.areaId === c.areaId && !comp._downed && !comp._denHidden && !comp._deathTransitionStarted) out.push({ isPlayer: false, ref: comp });
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
    state.airborne = true; // Even a level-target pounce leaves the ground and collides like every aerial attack.
  }

  // The pounce's pitched pie-prism collider (Combat.meleeHit) as a cone-lunge
  // contact test; null falls back to advanceConeLunge's flat cone check.
  function leapConeDetect() {
    if (!window.Combat?.meleeHit) return null;
    const probe = { debug: false }; // Reused substep options select the existing scratch collider rather than recording diagnostic geometry for every candidate.
    return (c, target, state) => {
      probe.rangePx = state.lungeRangePx;
      probe.halfConeRad = state.lungeHalfConeRad;
      probe.yaw = state.lungeAngle;
      probe.pitch = state.aimPitch || 0;
      return window.Combat.meleeHit(c, target, probe);
    };
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
    if (stopReason === 'blocked') {
      window.KnockbackCollisionImpact?.resolveAerialLunge?.(c, state,
        { kind: 'stone', label: 'Pounce into terrain' }, deps.TILE, {
          dealHealthDamage: (entity, amount) => {
            const before = Math.max(0, Number(entity.health) || 0);
            deps.damageCreature?.(entity, amount, entity.x, entity.y, 0,
              { tag: 'blunt', environmentalImpact: true, attacker: entity });
            return { applied: Math.max(0, before - Math.max(0, Number(entity.health) || 0)), lethal: entity.health <= 0 };
          },
        }); // Shares the rock/resource collision rules, including a lethal creature-to-corpse transition.
    }
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
    state.angle = !c.isCompanion || extendingCharge ? directAngle : Math.atan2(
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
    const chargeDamage = Math.max(0, Number(c.def?.guardChargeDamage) || 0); // Wild Moot and defending nest adults can inflict blunt Health damage; existing companion Guard Charge stays knockback-only.
    const chargeOptions = { tag: dmgTag, afflictionBonuses, attacker: c }; // Shared damage attribution for both player and creature charge contacts.
    const isPlayer = state.targets.some(target => target.isPlayer && target.ref === ref);
    if (isPlayer) deps.damagePlayer(chargeDamage, c.x, c.y, GUARD_CHARGE_KNOCKBACK_PX_S, chargeOptions);
    else if (window.CompanionOffense) window.CompanionOffense.damageCreature(deps.damageCreature, c, ref, chargeDamage, c.x, c.y, GUARD_CHARGE_KNOCKBACK_PX_S, chargeOptions); // Scales charge afflictions for player companions.
    else deps.damageCreature(ref, chargeDamage, c.x, c.y, GUARD_CHARGE_KNOCKBACK_PX_S, chargeOptions);
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
