// Combat Accelerating Flurry — repeated hold-slot heavy strikes. Its old
// player-heavy fire particles have been replaced by the same weapon-silhouette
// glow language Counter Shield uses, ramping continuously with hold duration.
(() => {
  "use strict";
  if (!window.Combat?.abilities) {
    console.error('combat-flurry.js requires combat-core.js + combat-loadout.js to load first');
    return;
  }

  let FIRST_STRIKE_DELAY_S = 0.38;
  let COST_BASE = 5, COST_PER_STRIKE = 1.5;
  let DAMAGE_MUL_BASE = 0.43, DAMAGE_MUL_PER_STRIKE = 0.17;
  let KNOCKBACK_MUL_BASE = 0.255, KNOCKBACK_MUL_PER_STRIKE = 0.054;
  let HALF_CONE_DEG_BASE = 29, HALF_CONE_DEG_MAX_GROWTH = 22;
  let HALF_CONE_DEG_GROWTH_PER_STRIKE = 1.4;
  let SIDE_OFFSET_DEG = 15;
  let WINDUP_S = 0.035, STRIKE_S = 0.085;
  let NEXT_STRIKE_MIN_S = 0.10, NEXT_STRIKE_BASE_S = 0.42, NEXT_STRIKE_DECAY_PER_STRIKE = 0.026;
  let MOVE_SPEED_MUL_BASE = 1.15, MOVE_SPEED_MUL_PER_STRIKE = 0.05, MOVE_SPEED_MUL_MAX = 1.9;
  let HOLD_S = 1;
  let GLOW_FULL_S = 3.0; // Used to expand/brighten the Counter-Shield-style weapon glow while the button remains held.
  const GLOW_COLOR = 0xc7a7ff;

  let debugState = { active: false, heldSeconds: 0, glowIntensity: 0, strikes: 0 }; // Used by mobile-friendly diagnostics.

  function now() { return performance.now() / 1000; }
  function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }

  function glowIntensityForHold(heldSeconds) {
    return GLOW_FULL_S > 0 ? clamp01(heldSeconds / GLOW_FULL_S) : 1;
  }

  function setGlow(heldSeconds) {
    const intensity = glowIntensityForHold(heldSeconds);
    window.Combat.weaponChargeGlow?.set?.('acceleratingFlurry', Math.max(0.025, intensity), {
      expansion: intensity,
      color: GLOW_COLOR,
      label: 'Accelerating Flurry',
    });
    debugState.heldSeconds = heldSeconds;
    debugState.glowIntensity = intensity;
  }

  function clearGlow() {
    window.Combat.weaponChargeGlow?.clear?.('acceleratingFlurry');
  }

  function register() {
    let active = false;
    let count = 0;
    let nextStrikeAt = -99;
    let startedAt = -1;

    function speedMul() {
      return active
        ? Math.min(MOVE_SPEED_MUL_MAX, MOVE_SPEED_MUL_BASE + count * MOVE_SPEED_MUL_PER_STRIKE)
        : 1;
    }

    function fireStrike(deps) {
      // A stagger pauses the flurry without consuming a strike/cost. The held
      // glow continues to reflect how long the stance itself has been held.
      if (window.Combat.isStaggered(deps.player)) return;

      const effects = window.CombatProgression?.getEffects(
        deps.currentWeaponKey(), 'acceleratingFlurry',
      ) || { afflictions: {}, stats: {} };
      const cost = (COST_BASE + count * COST_PER_STRIKE)
        * (1 + (effects.stats.staminaCostMul || 0));
      window.ResourceSystem?.spendStamina(deps.player, cost, 'Accelerating Flurry');

      const timeScale = 1 / (window.ResourceSystem?.getExhaustionSpeed(deps.player) ?? 1);
      const windupS = WINDUP_S * timeScale;
      const strikeS = STRIKE_S * timeScale;
      const dirSign = count % 2 === 0 ? -1 : 1;

      const baseAbil = deps.weaponAbility('cut')
        || { damage: 14, rangePx: deps.TILE * 1.05, knockbackPxS: 360 };
      const damage = Math.round(
        baseAbil.damage * (DAMAGE_MUL_BASE + count * DAMAGE_MUL_PER_STRIKE)
        * (1 + (effects.stats.damageMul || 0))
      );
      const rangePx = baseAbil.rangePx * (1 + (effects.stats.rangeMul || 0));
      const halfConeDeg = HALF_CONE_DEG_BASE
        + Math.min(HALF_CONE_DEG_MAX_GROWTH, count * HALF_CONE_DEG_GROWTH_PER_STRIKE);
      const halfConeRad = halfConeDeg * Math.PI / 180;
      const knockbackPxS = baseAbil.knockbackPxS
        * (KNOCKBACK_MUL_BASE + count * KNOCKBACK_MUL_PER_STRIKE)
        * (1 + (effects.stats.knockbackMul || 0));
      const strikeAngle = deps.player.angle + dirSign * SIDE_OFFSET_DEG * Math.PI / 180;
      const strikeIndex = count + 1;
      const dmgType = deps.currentWeaponDamageType();
      const impactSize = strikeIndex <= 2 ? 'small' : strikeIndex <= 5 ? 'medium' : 'large';

      deps.triggerWeaponSwingVisual(windupS + strikeS, {
        anim: 'sweep',
        dirSign,
        windupFrac: windupS / (windupS + strikeS),
        strikeFrac: 1,
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
          deps.clearVegetationInAttackCone?.(
            deps.player.x, deps.player.y, strikeAngle, rangePx, halfConeRad,
          );
          let hits = 0, lastName = '';
          for (const c of deps.hostileObjects) {
            if (c.health <= 0 || c.areaId !== deps.getCurrentArea()) continue;
            if (!deps.inCone(
              deps.player.x, deps.player.y, strikeAngle, c.x, c.y, rangePx, halfConeRad,
            )) continue;

            deps.damageCreature(c, damage, deps.player.x, deps.player.y, knockbackPxS, {
              tag: dmgType,
              heavy: true,
              afflictionBonuses: effects.afflictions,
            });
            deps.playWeaponHitSfx?.(dmgType, c.x, c.y, c.areaId, undefined, impactSize);
            hits++;
            lastName = c.def.label;
          }
          if (hits > 0) {
            deps.showToast(
              `Flurry Strike ${strikeIndex}: hit ${hits > 1 ? hits + ' creatures' : 'the ' + lastName}!`,
              true,
            );
            deps.awardWeaponMasteryXp();
          }
        },
        data: {
          meleeThreat: window.Combat.playerMeleeThreat(rangePx, halfConeRad, {
            yaw: strikeAngle,
            source: `Flurry Strike ${strikeIndex}`,
          }),
        },
      });

      count += 1;
      debugState.strikes = count;
      nextStrikeAt = now()
        + Math.max(NEXT_STRIKE_MIN_S, NEXT_STRIKE_BASE_S - count * NEXT_STRIKE_DECAY_PER_STRIKE)
        * timeScale;
    }

    function onHoldStart() {
      active = true;
      count = 0;
      startedAt = now();
      nextStrikeAt = startedAt + FIRST_STRIKE_DELAY_S;
      debugState = { active: true, heldSeconds: 0, glowIntensity: 0, strikes: 0 };
      setGlow(0);
      window.Combat.setMovementSpeedMul(speedMul);
      window.Combat.deps.showToast('Accelerating Flurry started.', true);
    }

    function onHoldUpdate() {
      if (!active) return;
      const heldSeconds = Math.max(0, now() - startedAt);
      setGlow(heldSeconds);
      if (now() < nextStrikeAt) return;
      fireStrike(window.Combat.deps);
    }

    function onHoldEnd() {
      if (!active) return;
      active = false;
      startedAt = -1;
      clearGlow();
      window.Combat.setMovementSpeedMul(null);
      const n = count;
      debugState.active = false;
      debugState.strikes = n;
      window.Combat.deps.showToast(
        `Accelerating Flurry ended after ${n} strike${n === 1 ? '' : 's'}.`,
        false,
      );
      count = 0;
    }

    window.Combat.abilities.register('acceleratingFlurry', {
      label: 'Accelerating Flurry',
      slotFamily: 'hold',
      category: 'offensiveHold',
      onHoldStart,
      onHoldUpdate,
      onHoldEnd,
    });
  }

  register();

  window.Combat.flurryDebug = {
    snapshot: () => ({ ...debugState }),
  };

  window.Combat.flurryData = {
    FIRST_STRIKE_DELAY_S,
    COST_BASE,
    COST_PER_STRIKE,
    DAMAGE_MUL_BASE,
    DAMAGE_MUL_PER_STRIKE,
    KNOCKBACK_MUL_BASE,
    KNOCKBACK_MUL_PER_STRIKE,
    HALF_CONE_DEG_BASE,
    HALF_CONE_DEG_MAX_GROWTH,
    HALF_CONE_DEG_GROWTH_PER_STRIKE,
    SIDE_OFFSET_DEG,
    WINDUP_S,
    STRIKE_S,
    NEXT_STRIKE_MIN_S,
    NEXT_STRIKE_BASE_S,
    NEXT_STRIKE_DECAY_PER_STRIKE,
    MOVE_SPEED_MUL_BASE,
    MOVE_SPEED_MUL_PER_STRIKE,
    MOVE_SPEED_MUL_MAX,
    HOLD_S,
    GLOW_FULL_S,
  };

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
    if (cfg.GLOW_FULL_S != null) GLOW_FULL_S = cfg.GLOW_FULL_S;

    Object.assign(window.Combat.flurryData, {
      FIRST_STRIKE_DELAY_S,
      COST_BASE,
      COST_PER_STRIKE,
      DAMAGE_MUL_BASE,
      DAMAGE_MUL_PER_STRIKE,
      KNOCKBACK_MUL_BASE,
      KNOCKBACK_MUL_PER_STRIKE,
      HALF_CONE_DEG_BASE,
      HALF_CONE_DEG_MAX_GROWTH,
      HALF_CONE_DEG_GROWTH_PER_STRIKE,
      SIDE_OFFSET_DEG,
      WINDUP_S,
      STRIKE_S,
      NEXT_STRIKE_MIN_S,
      NEXT_STRIKE_BASE_S,
      NEXT_STRIKE_DECAY_PER_STRIKE,
      MOVE_SPEED_MUL_BASE,
      MOVE_SPEED_MUL_PER_STRIKE,
      MOVE_SPEED_MUL_MAX,
      HOLD_S,
      GLOW_FULL_S,
    });
  };
})();
