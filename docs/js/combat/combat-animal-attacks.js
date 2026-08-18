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
    def.start(c, state, ctx, deps);
    c._animalAttack = { id, def, state };
    deps?.playCreatureBark?.(c);
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

  // Quick Attack condition checks use this instead of guessing at private
  // named-attack stage strings. Each attack can declare exactly which part
  // is its committed/strike window; Pounce's is the whole leap.
  function isStriking(c) {
    const aa = c?._animalAttack;
    return !!(aa?.def?.isStriking?.(aa.state, c));
  }

  function cancel(c) {
    const aa = c._animalAttack;
    if (!aa) return;
    if (aa.def.cancel) aa.def.cancel(c, aa.state, window.Combat.deps);
    c._animalAttack = null;
    c.scaleY = 1;
  }

  window.Combat.animalAttacks = { register, start, update, isBusy, isStriking, cancel };

  // ── Pounce ──────────────────────────────────────────────────────────
  let POUNCE_WINDUP_S = 0.5;
  let POUNCE_UNCROUCH_S = 0.1;
  let POUNCE_CROUCH_SCALE_Y = 0.55;
  let POUNCE_LEAP_SPEED_PX_S = 480;
  let POUNCE_KNOCKBACK_PX_S = 640;
  let POUNCE_STAMINA_COST_MAX_FRACTION = 0.4; // Pounce total cost scales with the creature's own stamina pool.
  let POUNCE_STAMINA_COST_MIN = 18; // Keeps ordinary 30–40 Stamina animals meaningfully above their old 12–14 generic attack cost.

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function pounceAdditionalStaminaCost(c) {
    const maxStamina = Math.max(0, Number(c?.maxStamina) || 0);
    const genericCost = Math.max(0, Number(c?.def?.attackStaminaCost) || 0); // Already paid by game.js before animalAttacks.start().
    const totalPounceCost = Math.max(POUNCE_STAMINA_COST_MIN, maxStamina * POUNCE_STAMINA_COST_MAX_FRACTION);
    return Math.max(0, totalPounceCost - genericCost);
  }

  function gatherTargets(c, deps) {
    const out = [];
    if (c.isCompanion) {
      for (const h of deps.hostileObjects) {
        if (h.health > 0 && h.areaId === c.areaId) out.push({ isPlayer: false, ref: h });
      }
    } else {
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
        if (c.def.sprites) {
          const frameUrl = c.def.sprites.run[0];
          const genotypeKind = deps.genotypeKindFor ? deps.genotypeKindFor(c) : null;
          deps.setCreatureFrame(c.avatarRef, frameUrl, genotypeKind, 'run1', c.genotype);
          c.currentFrameUrl = frameUrl;
        }
      }
      return true;
    }

    const dirX = Math.cos(state.angle), dirY = Math.sin(state.angle);
    const stepPx = POUNCE_LEAP_SPEED_PX_S * dt;
    const nx = c.x + dirX * stepPx, ny = c.y + dirY * stepPx;
    if (!deps.canOccupyAt(nx, ny, state.collideRadiusPx)) return false;

    c.x = nx;
    c.y = ny;
    deps.tickCreatureFootsteps?.(c, stepPx);

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
      return false;
    }
    return true;
  }

  function pounceCancel(c) {
    c.scaleY = 1;
  }

  register('pounce', {
    label: 'Pounce',
    start: pounceStart,
    update: pounceUpdate,
    cancel: pounceCancel,
    additionalStaminaCost: pounceAdditionalStaminaCost,
    isStriking: state => state?.stage === 'leap',
  });

  // ── Guard Charge ────────────────────────────────────────────────────
  let GUARD_CHARGE_DURATION_S = 0.12;
  let GUARD_CHARGE_KNOCKBACK_PX_S = 900;
  let GUARD_CHARGE_TARGET_ANGLE_WEIGHT = 0.55;
  let GUARD_CHARGE_AWAY_FROM_MASTER_WEIGHT = 0.45;

  function guardChargeStart(c, state, ctx, deps) {
    state.t = 0;
    const directAngle = Math.atan2(ctx.target.y - c.y, ctx.target.x - c.x);
    const master = c.master || deps.player;
    const awayFromMasterAngle = Math.atan2(c.y - master.y, c.x - master.x);
    state.angle = Math.atan2(
      Math.sin(directAngle) * GUARD_CHARGE_TARGET_ANGLE_WEIGHT + Math.sin(awayFromMasterAngle) * GUARD_CHARGE_AWAY_FROM_MASTER_WEIGHT,
      Math.cos(directAngle) * GUARD_CHARGE_TARGET_ANGLE_WEIGHT + Math.cos(awayFromMasterAngle) * GUARD_CHARGE_AWAY_FROM_MASTER_WEIGHT,
    );
    const halfSize = (c.visualModelWidth || c.def.modelWidth || 2) * deps.TILE / 2;
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
      if (!deps.canOccupyAt(nx, ny, state.collideRadiusPx)) return false;
      c.x = nx;
      c.y = ny;
      state.traveledPx += stepPx;
    }

    const headX = c.x + dirX * state.headOffsetPx, headY = c.y + dirY * state.headOffsetPx;
    for (const target of state.targets) {
      const ref = target.ref;
      if (ref.health <= 0) continue;
      if (!deps.inCone(headX, headY, state.angle, ref.x, ref.y, state.rangePx, state.halfConeRad)) continue;
      const dmgTag = c.def.attackTag || 'blunt';
      const afflictionBonuses = window.ResourceSystem?.afflictionBonusesForTag(dmgTag);
      if (target.isPlayer) deps.damagePlayer(0, headX, headY, GUARD_CHARGE_KNOCKBACK_PX_S, { tag: dmgTag, afflictionBonuses });
      else deps.damageCreature(ref, 0, headX, headY, GUARD_CHARGE_KNOCKBACK_PX_S, { tag: dmgTag, afflictionBonuses });
      deps.playCreatureClawHit?.(c);
      return false;
    }
    return state.traveledPx < state.distancePx;
  }

  register('guardCharge', { start: guardChargeStart, update: guardChargeUpdate });

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
    const g = cfg.guardCharge;
    if (g) {
      if (g.DURATION_S != null) GUARD_CHARGE_DURATION_S = g.DURATION_S;
      if (g.KNOCKBACK_PX_S != null) GUARD_CHARGE_KNOCKBACK_PX_S = g.KNOCKBACK_PX_S;
      if (g.TARGET_ANGLE_WEIGHT != null) GUARD_CHARGE_TARGET_ANGLE_WEIGHT = g.TARGET_ANGLE_WEIGHT;
      if (g.AWAY_FROM_MASTER_WEIGHT != null) GUARD_CHARGE_AWAY_FROM_MASTER_WEIGHT = g.AWAY_FROM_MASTER_WEIGHT;
    }
  };
})();
