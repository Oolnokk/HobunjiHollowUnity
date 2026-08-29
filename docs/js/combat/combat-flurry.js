// Combat accelerating flurry — the weapon tool's other hold-slot heavy
// option, ported from the sandbox's beginPowerHold()/updatePowerHold()
// acceleratingFlurry branch. While held, strikes fire automatically on a
// timer that speeds up and grows stronger (and pricier) with each hit,
// until stamina runs out or the button's released. Registers under the
// 'hold' slot family alongside combat-charged-breaker.js so either can
// occupy hold1 or hold2.
(() => {
  "use strict";
  if (!window.Combat?.abilities) { console.error('combat-flurry.js requires combat-core.js + combat-loadout.js to load first'); return; }

  let FIRST_STRIKE_DELAY_S = 0.38;
  let COST_BASE = 5, COST_PER_STRIKE = 1.5;
  let DAMAGE_MUL_BASE = 0.43, DAMAGE_MUL_PER_STRIKE = 0.17; // ~6/14 base, +2.4/14 per strike
  // x1.5 on top of the global knockback-base doubling — flurry is one of the
  // four attacks called out for an extra "even more" bump, and this curve is
  // also how its knockback keeps growing alongside its own attack speed.
  let KNOCKBACK_MUL_BASE = 0.255, KNOCKBACK_MUL_PER_STRIKE = 0.054;
  let HALF_CONE_DEG_BASE = 29, HALF_CONE_DEG_MAX_GROWTH = 22;
  let HALF_CONE_DEG_GROWTH_PER_STRIKE = 1.4;
  let SIDE_OFFSET_DEG = 15; // alternates left/right each strike, mirrors the demo's swing-side wobble
  let WINDUP_S = 0.035, STRIKE_S = 0.085;
  let NEXT_STRIKE_MIN_S = 0.10, NEXT_STRIKE_BASE_S = 0.42, NEXT_STRIKE_DECAY_PER_STRIKE = 0.026;
  // Flurry has no automatic forward lunge (unlike every other attack) — in
  // its place, holding it grants a movement-speed bonus that ramps up with
  // the same strike count that drives its attack-speed/knockback curves.
  let MOVE_SPEED_MUL_BASE = 1.15, MOVE_SPEED_MUL_PER_STRIKE = 0.05, MOVE_SPEED_MUL_MAX = 1.9;
  // Post-strike pause before easing back to neutral — irrelevant for all but
  // the flurry's last strike, since every earlier one gets pre-empted by the
  // next strike's trigger before its hold would ever show.
  let HOLD_S = 1;

  function now() { return performance.now() / 1000; }

  function register() {
    let active = false;
    let count = 0;
    let nextStrikeAt = -99;

    function speedMul() {
      return active ? Math.min(MOVE_SPEED_MUL_MAX, MOVE_SPEED_MUL_BASE + count * MOVE_SPEED_MUL_PER_STRIKE) : 1;
    }

    function fireStrike(deps) {
      // Footing/impact stagger lockout — see combat-combo.js's matching
      // guard. Leaves `active`/nextStrikeAt untouched so the flurry just
      // pauses (no strike, no stamina spent) and resumes on its own once
      // the stagger clears, rather than needing onHoldEnd to be called.
      if (window.Combat.isStaggered(deps.player)) return;
      // Every affliction this strike can inflict, and every stat bonus on
      // top of the base numbers below, comes from the player's own chosen
      // upgrades (see combat-progression.js) — a fresh, unleveled flurry
      // deals plain damage with no afflictions at all.
      const effects = window.CombatProgression?.getEffects(deps.currentWeaponKey(), 'acceleratingFlurry') || { afflictions: {}, stats: {} };
      const cost = (COST_BASE + count * COST_PER_STRIKE) * (1 + (effects.stats.staminaCostMul || 0));
      // Never refuses for lack of stamina — overspending pushes into
      // Exhausted instead of hard-stopping the flurry (see resource-
      // system.js's spendStamina). Exhausted's reduced speed slows this
      // strike's own windup/strike *and* the delay before the next one
      // (see onHoldUpdate/nextStrikeAt below), so a flurry pushed deep into
      // debt grinds down toward a crawl instead of looping forever for free.
      window.ResourceSystem?.spendStamina(deps.player, cost, 'Accelerating Flurry');
      const timeScale = 1 / (window.ResourceSystem?.getExhaustionSpeed(deps.player) ?? 1);
      const windupS = WINDUP_S * timeScale;
      const strikeS = STRIKE_S * timeScale;
      // Alternates side every strike — mirror the hatchet's sweep, flipping
      // direction in sync with the existing left/right hit-cone wobble.
      const dirSign = count % 2 === 0 ? -1 : 1;

      const baseAbil = deps.weaponAbility('cut') || { damage: 14, rangePx: deps.TILE * 1.05, knockbackPxS: 360 };
      const damage = Math.round(baseAbil.damage * (DAMAGE_MUL_BASE + count * DAMAGE_MUL_PER_STRIKE) * (1 + (effects.stats.damageMul || 0)));
      const rangePx = baseAbil.rangePx * (1 + (effects.stats.rangeMul || 0));
      const halfConeDeg = HALF_CONE_DEG_BASE + Math.min(HALF_CONE_DEG_MAX_GROWTH, count * HALF_CONE_DEG_GROWTH_PER_STRIKE);
      const halfConeRad = halfConeDeg * Math.PI / 180;
      const knockbackPxS = baseAbil.knockbackPxS * (KNOCKBACK_MUL_BASE + count * KNOCKBACK_MUL_PER_STRIKE) * (1 + (effects.stats.knockbackMul || 0));
      const sideDeg = dirSign * SIDE_OFFSET_DEG;
      const strikeAngle = deps.player.angle + sideDeg * Math.PI / 180;
      const strikeIndex = count + 1;
      const dmgType = deps.currentWeaponDamageType(); // Keeps flurry afflictions and impact audio tied to the equipped weapon material.
      const impactSize = strikeIndex <= 2 ? 'small' : strikeIndex <= 5 ? 'medium' : 'large'; // Grows with the flurry without consuming the heavy-only huge tier.

      deps.triggerWeaponSwingVisual(windupS + strikeS, {
        anim: 'sweep',
        dirSign,
        windupFrac: windupS / (windupS + strikeS),
        strikeFrac: 1,
        // Same authored pose as the hatchet's Forehand/Backhand Swing combo
        // steps, so every sweep-style attack reads as the same swing.
        pose: window.Combat.poses.SWEEP_POSE,
        holdS: HOLD_S,
        afflictionIds: Object.keys(effects.afflictions),
        coneRangePx: rangePx,
        coneHalfConeRad: halfConeRad,
        coneAngle: strikeAngle,
      });

      window.Combat.beginStagedAction({
        windupS,
        strikeS,
        recoverS: 0,
        onStrike: () => {
          deps.clearVegetationInAttackCone?.(deps.player.x, deps.player.y, strikeAngle, rangePx, halfConeRad);
          let hits = 0, lastName = '';
          for (const c of deps.hostileObjects) {
            if (c.health <= 0 || c.areaId !== deps.getCurrentArea()) continue;
            if (!deps.inCone(deps.player.x, deps.player.y, strikeAngle, c.x, c.y, rangePx, halfConeRad)) continue;
            deps.damageCreature(c, damage, deps.player.x, deps.player.y, knockbackPxS, { tag: dmgType, afflictionBonuses: effects.afflictions });
            deps.playWeaponHitSfx?.(dmgType, c.x, c.y, c.areaId, undefined, impactSize);
            hits++;
            lastName = c.def.label;
          }
          if (hits > 0) {
            deps.showToast(`Flurry Strike ${strikeIndex}: hit ${hits > 1 ? hits + ' creatures' : 'the ' + lastName}!`, true);
            deps.awardWeaponMasteryXp();
          }
        },
      });

      count += 1;
      nextStrikeAt = now() + Math.max(NEXT_STRIKE_MIN_S, NEXT_STRIKE_BASE_S - count * NEXT_STRIKE_DECAY_PER_STRIKE) * timeScale;
    }

    function onHoldStart() {
      active = true;
      count = 0;
      nextStrikeAt = now() + FIRST_STRIKE_DELAY_S;
      window.Combat.setMovementSpeedMul(speedMul);
      window.Combat.deps.showToast('Accelerating Flurry started.', true);
    }

    function onHoldUpdate() {
      if (!active) return;
      if (now() < nextStrikeAt) return;
      fireStrike(window.Combat.deps);
    }

    function onHoldEnd() {
      if (!active) return;
      active = false;
      window.Combat.setMovementSpeedMul(null);
      const n = count;
      window.Combat.deps.showToast(`Accelerating Flurry ended after ${n} strike${n === 1 ? '' : 's'}.`, false);
      count = 0;
    }

    window.Combat.abilities.register('acceleratingFlurry', { label: 'Accelerating Flurry', slotFamily: 'hold', category: 'offensiveHold', onHoldStart, onHoldUpdate, onHoldEnd });
  }

  register();

  // Read-only data export — no bandit currently uses flurry (see the module
  // header), kept for parity with the other abilities' exports and in case
  // that changes later.
  window.Combat.flurryData = {
    FIRST_STRIKE_DELAY_S, COST_BASE, COST_PER_STRIKE, DAMAGE_MUL_BASE, DAMAGE_MUL_PER_STRIKE,
    KNOCKBACK_MUL_BASE, KNOCKBACK_MUL_PER_STRIKE, HALF_CONE_DEG_BASE, HALF_CONE_DEG_MAX_GROWTH,
    HALF_CONE_DEG_GROWTH_PER_STRIKE, SIDE_OFFSET_DEG, WINDUP_S, STRIKE_S, NEXT_STRIKE_MIN_S,
    NEXT_STRIKE_BASE_S, NEXT_STRIKE_DECAY_PER_STRIKE, MOVE_SPEED_MUL_BASE, MOVE_SPEED_MUL_PER_STRIKE,
    MOVE_SPEED_MUL_MAX, HOLD_S,
  };

  // Applies docs/config/combat/attack-values.json's `flurry` section — see
  // combat-combo.js's applyComboConfig for the general pattern.
  window.Combat.applyFlurryConfig = function (cfg) {
    if (!cfg) return;
    if (cfg.FIRST_STRIKE_DELAY_S != null) FIRST_STRIKE_DELAY_S = cfg.FIRST_STRIKE_DELAY_S;
    if (cfg.COST_BASE != null) COST_BASE = cfg.COST_BASE;
    if (cfg.COST_PER_STRIKE != null) COST_PER_STRIKE = cfg.COST_PER_STRIKE;
    if (cfg.DAMAGE_MUL_BASE != null) DAMAGE_MUL_BASE = cfg.DAMAGE_MUL_BASE;
    if (cfg.DAMAGE_MUL_PER_STRIKE != null) DAMAGE_MUL_PER_STRIKE = cfg.DAMAGE_MUL_PER_STRIKE;
    if (cfg.KNOCKBACK_MUL_BASE != null) KNOCKBACK_MUL_BASE = cfg.KNOCKBACK_MUL_BASE;
    if (cfg.KNOCKBACK_MUL_PER_STRIKE != null) KNOCKBACK_MUL_PER_STRIKE = cfg.KNOCKBACK_MUL_PER_STRIKE;
    if (cfg.HALF_CONE_DEG_BASE != null) HALF_CONE_DEG_BASE = cfg.HALF_CONE_DEG_BASE;
    if (cfg.HALF_CONE_DEG_MAX_GROWTH != null) HALF_CONE_DEG_MAX_GROWTH = cfg.HALF_CONE_DEG_MAX_GROWTH;
    if (cfg.HALF_CONE_DEG_GROWTH_PER_STRIKE != null) HALF_CONE_DEG_GROWTH_PER_STRIKE = cfg.HALF_CONE_DEG_GROWTH_PER_STRIKE;
    if (cfg.SIDE_OFFSET_DEG != null) SIDE_OFFSET_DEG = cfg.SIDE_OFFSET_DEG;
    if (cfg.WINDUP_S != null) WINDUP_S = cfg.WINDUP_S;
    if (cfg.STRIKE_S != null) STRIKE_S = cfg.STRIKE_S;
    if (cfg.NEXT_STRIKE_MIN_S != null) NEXT_STRIKE_MIN_S = cfg.NEXT_STRIKE_MIN_S;
    if (cfg.NEXT_STRIKE_BASE_S != null) NEXT_STRIKE_BASE_S = cfg.NEXT_STRIKE_BASE_S;
    if (cfg.NEXT_STRIKE_DECAY_PER_STRIKE != null) NEXT_STRIKE_DECAY_PER_STRIKE = cfg.NEXT_STRIKE_DECAY_PER_STRIKE;
    if (cfg.MOVE_SPEED_MUL_BASE != null) MOVE_SPEED_MUL_BASE = cfg.MOVE_SPEED_MUL_BASE;
    if (cfg.MOVE_SPEED_MUL_PER_STRIKE != null) MOVE_SPEED_MUL_PER_STRIKE = cfg.MOVE_SPEED_MUL_PER_STRIKE;
    if (cfg.MOVE_SPEED_MUL_MAX != null) MOVE_SPEED_MUL_MAX = cfg.MOVE_SPEED_MUL_MAX;
    if (cfg.HOLD_S != null) HOLD_S = cfg.HOLD_S;
    Object.assign(window.Combat.flurryData, {
      FIRST_STRIKE_DELAY_S, COST_BASE, COST_PER_STRIKE, DAMAGE_MUL_BASE, DAMAGE_MUL_PER_STRIKE,
      KNOCKBACK_MUL_BASE, KNOCKBACK_MUL_PER_STRIKE, HALF_CONE_DEG_BASE, HALF_CONE_DEG_MAX_GROWTH,
      HALF_CONE_DEG_GROWTH_PER_STRIKE, SIDE_OFFSET_DEG, WINDUP_S, STRIKE_S, NEXT_STRIKE_MIN_S,
      NEXT_STRIKE_BASE_S, NEXT_STRIKE_DECAY_PER_STRIKE, MOVE_SPEED_MUL_BASE, MOVE_SPEED_MUL_PER_STRIKE,
      MOVE_SPEED_MUL_MAX, HOLD_S,
    });
  };
})();
