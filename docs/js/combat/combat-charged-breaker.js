// Combat Charged Breaker — a hold-and-release heavy whose gameplay charge is
// the weapon's ACTUAL Neutral→Windup pose interpolation, not a parallel timer.
// The windup begins briskly, then continuously slows as it approaches the full
// pose. Releasing attacks immediately from the partial pose currently visible.
(() => {
  "use strict";
  if (!window.Combat?.abilities) {
    console.error('combat-charged-breaker.js requires combat-core.js + combat-loadout.js to load first');
    return;
  }

  let MIN_READY_S = 0.62;
  let MAX_CHARGE_S = 4.0; // Used as the real Neutral→Windup duration; full pose and 100% charge are the same event.
  let WINDUP_SLOWDOWN = 25; // Used by Combat.windupPoseProgress; higher means a longer, slower final approach to Windup.
  let CHARGE_DRAIN_PER_S = 18;
  let COST_MIN = 16, COST_MAX = 28;

  // Damage still rises with the pose charge, but this technique is now
  // deliberately centered on movement/control geometry rather than reach.
  let DAMAGE_MUL_MIN = 1.05, DAMAGE_MUL_MAX = 1.30;
  let RANGE_MUL_MIN = 1.00, RANGE_MUL_MAX = 1.15;
  let KNOCKBACK_MUL_MIN = 1.20, KNOCKBACK_MUL_MAX = 3.00;
  let HALF_CONE_DEG_MIN = 34, HALF_CONE_DEG_MAX = 70;
  let LUNGE_TILE_MUL_MIN = 1.80, LUNGE_TILE_MUL_MAX = 4.20;
  // Used by meleeLungeProfile's underlying pitch-distance term. At full
  // charge, looking upward retains most of the horizontal lunge that gravity/
  // aim pitch would ordinarily remove.
  let LUNGE_GRAVITY_RESIST_MIN = 0.00, LUNGE_GRAVITY_RESIST_MAX = 0.90;

  let STRIKE_S = 0.30;
  let POWER = 1.70;
  let HOLD_S = 1.0;
  let LUNGE_HOP_UNITS = 0.45;
  const GLOW_COLOR = 0xffc85a;

  let debugState = {
    active: false,
    heldSeconds: 0,
    poseCharge: 0,
    lastRelease: null,
  }; // Used by mobile-friendly diagnostics without requiring console access.

  function now() { return performance.now() / 1000; }
  function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function poseChargeFromRuntime(heldSeconds = 0) {
    const live = window.Combat.deps?.getWeaponSwingWindupPoseProgress?.();
    if (Number.isFinite(Number(live))) return clamp01(live);
    // Standalone-test fallback: same curve the renderer uses, only used when
    // game.js has not supplied its live pose-progress dependency.
    const raw = MAX_CHARGE_S > 0 ? clamp01(heldSeconds / MAX_CHARGE_S) : 1;
    return window.Combat.windupPoseProgress?.(raw, WINDUP_SLOWDOWN) ?? raw;
  }

  function setGlow(poseCharge) {
    const t = clamp01(poseCharge);
    window.Combat.weaponChargeGlow?.set?.('chargedBreaker', Math.max(0.025, t), {
      expansion: t,
      color: GLOW_COLOR,
      label: 'Charged Breaker',
    });
  }

  function clearGlow() {
    window.Combat.weaponChargeGlow?.clear?.('chargedBreaker');
  }

  function register() {
    let startedAt = -1;

    function onHoldStart() {
      startedAt = now();
      debugState = { ...debugState, active: true, heldSeconds: 0, poseCharge: 0 };
      const deps = window.Combat.deps;
      const effects = window.CombatProgression?.getEffects(deps.currentWeaponKey(), 'chargedBreaker')
        || { afflictions: {}, stats: {} };

      setGlow(0);
      deps.showToast('Charged Breaker charging — release to strike.', true);
      deps.triggerWeaponHoldVisual(MAX_CHARGE_S + STRIKE_S, {
        anim: 'sweep',
        pose: window.Combat.poses.SWEEP_POSE,
        windupFrac: MAX_CHARGE_S / (MAX_CHARGE_S + STRIKE_S),
        strikeFrac: 1,
        power: POWER,
        holdS: HOLD_S,
        windupSlowdown: WINDUP_SLOWDOWN,
        afflictionIds: Object.keys(effects.afflictions),
        afflictions: effects.afflictions,
      });
    }

    function releaseNow(heldSeconds, forced) {
      startedAt = -1;
      const deps = window.Combat.deps;
      const poseCharge = poseChargeFromRuntime(heldSeconds);
      debugState.active = false;
      debugState.heldSeconds = heldSeconds;
      debugState.poseCharge = poseCharge;

      if (window.Combat.isStaggered(deps.player)) {
        clearGlow();
        deps.cancelWeaponSwingHold();
        return;
      }
      if (heldSeconds < MIN_READY_S) {
        clearGlow();
        deps.cancelWeaponSwingHold();
        deps.showToast(forced
          ? 'Charged Breaker fizzled: stamina ran out before it was ready.'
          : `Charged Breaker released too early (${heldSeconds.toFixed(2)}s, needed ${MIN_READY_S}s).`, false);
        return;
      }

      const effects = window.CombatProgression?.getEffects(deps.currentWeaponKey(), 'chargedBreaker')
        || { afflictions: {}, stats: {} };
      if (!forced) {
        const cost = lerp(COST_MIN, COST_MAX, poseCharge) * (1 + (effects.stats.staminaCostMul || 0));
        window.ResourceSystem?.spendStamina(deps.player, cost, 'Charged Breaker');
      }

      // This slices the live authored pose at poseCharge and starts Strike
      // directly from there. No hidden remainder of the windup plays after
      // the player releases the button.
      deps.releaseWeaponSwingHold({ poseProgress: poseCharge });
      setGlow(poseCharge);

      const baseAbil = deps.weaponAbility('cut')
        || { damage: 14, rangePx: deps.TILE * 1.05, knockbackPxS: 360 };
      const damage = Math.round(
        baseAbil.damage * lerp(DAMAGE_MUL_MIN, DAMAGE_MUL_MAX, poseCharge)
        * (1 + (effects.stats.damageMul || 0))
      );
      const rangePx = baseAbil.rangePx
        * lerp(RANGE_MUL_MIN, RANGE_MUL_MAX, poseCharge)
        * (1 + (effects.stats.rangeMul || 0));
      const halfConeDeg = lerp(HALF_CONE_DEG_MIN, HALF_CONE_DEG_MAX, poseCharge);
      const halfConeRad = halfConeDeg * Math.PI / 180;
      const knockbackPxS = baseAbil.knockbackPxS
        * lerp(KNOCKBACK_MUL_MIN, KNOCKBACK_MUL_MAX, poseCharge)
        * (1 + (effects.stats.knockbackMul || 0));
      const lungePx = deps.TILE
        * lerp(LUNGE_TILE_MUL_MIN, LUNGE_TILE_MUL_MAX, poseCharge)
        * (1 + (effects.stats.lungeMul || 0));
      const pitchDistanceResistance = lerp(
        LUNGE_GRAVITY_RESIST_MIN,
        LUNGE_GRAVITY_RESIST_MAX,
        poseCharge,
      );
      const timeScale = 1 / (window.ResourceSystem?.getExhaustionSpeed(deps.player) ?? 1);
      const strikeS = STRIKE_S * timeScale;

      deps.setCombatSwingCone(rangePx, halfConeRad, deps.player.angle);
      deps.beginCombatLunge(lungePx, strikeS, LUNGE_HOP_UNITS, {
        rangePx,
        halfConeRad,
        pitchDistanceResistance,
      });

      debugState.lastRelease = {
        at: Date.now(),
        heldSeconds,
        poseCharge,
        damage,
        rangePx,
        halfConeDeg,
        knockbackPxS,
        lungePx,
        pitchDistanceResistance,
        forced: !!forced,
      };

      window.Combat.beginStagedAction({
        windupS: 0,
        strikeS,
        recoverS: 0,
        onStrike: () => {
          const vegetationCleared = deps.clearVegetationInAttackCone?.(
            deps.player.x, deps.player.y, deps.player.angle, rangePx, halfConeRad,
          ) || 0;
          let hits = 0, lastName = '';
          for (const c of deps.hostileObjects) {
            if (c.health <= 0 || c.areaId !== deps.getCurrentArea()) continue;
            if (!window.Combat.meleeHit(deps.player, c, {
              rangePx,
              halfConeRad,
              yaw: deps.player.angle,
              pitch: deps.getPlayerMeleeAimPitch?.() || 0,
            })) continue;
            deps.damageCreature(c, damage, deps.player.x, deps.player.y, knockbackPxS, {
              tag: deps.currentWeaponDamageType(),
              heavy: true,
              afflictionBonuses: effects.afflictions,
            });
            deps.playWeaponHitSfx?.(
              deps.currentWeaponDamageType(), c.x, c.y, c.areaId, undefined, 'huge',
            );
            hits++;
            lastName = c.def.label;
          }

          const pct = Math.round(poseCharge * 100);
          const msg = hits > 0
            ? `Charged Breaker (${pct}% pose charge): hit ${hits > 1 ? hits + ' creatures' : 'the ' + lastName}!`
            : vegetationCleared > 0
              ? `Charged Breaker (${pct}% pose charge): cut ${vegetationCleared} vegetation tile${vegetationCleared === 1 ? '' : 's'} into mulch.`
              : `Charged Breaker (${pct}% pose charge) connects with nothing.`;
          deps.showToast(msg, hits > 0 || vegetationCleared > 0, true);
          if (hits > 0) deps.awardWeaponMasteryXp();
        },
        onComplete: clearGlow,
        onCancel: clearGlow,
        data: {
          meleeThreat: window.Combat.playerMeleeThreat(rangePx, halfConeRad, {
            yaw: deps.player.angle,
            lungePx,
            source: 'Charged Breaker',
          }),
        },
      });
    }

    function onHoldUpdate(_slot, dt) {
      if (startedAt < 0) return;
      const deps = window.Combat.deps;
      const heldSeconds = now() - startedAt;
      const poseCharge = poseChargeFromRuntime(heldSeconds);
      debugState.heldSeconds = heldSeconds;
      debugState.poseCharge = poseCharge;
      setGlow(poseCharge);

      const drain = Math.min(deps.player.stamina, CHARGE_DRAIN_PER_S * dt);
      window.ResourceSystem?.spendStamina(deps.player, drain, 'Charged Breaker (charging)');
      if (deps.player.stamina <= 0) releaseNow(heldSeconds, true);
    }

    function onHoldEnd() {
      if (startedAt < 0) return;
      releaseNow(now() - startedAt, false);
    }

    window.Combat.abilities.register('chargedBreaker', {
      label: 'Charged Breaker',
      slotFamily: 'hold',
      category: 'offensiveHold',
      onHoldStart,
      onHoldUpdate,
      onHoldEnd,
    });
  }

  register();

  window.Combat.chargedBreakerData = {
    MIN_READY_S,
    MAX_CHARGE_S,
    WINDUP_SLOWDOWN,
    DAMAGE_MUL_MIN,
    DAMAGE_MUL_MAX,
    RANGE_MUL_MIN,
    RANGE_MUL_MAX,
    KNOCKBACK_MUL_MIN,
    KNOCKBACK_MUL_MAX,
    HALF_CONE_DEG_MIN,
    HALF_CONE_DEG_MAX,
    LUNGE_TILE_MUL_MIN,
    LUNGE_TILE_MUL_MAX,
    LUNGE_GRAVITY_RESIST_MIN,
    LUNGE_GRAVITY_RESIST_MAX,
    STRIKE_S,
    LUNGE_HOP_UNITS,
    POWER,
    // Bandit code historically reads WINDUP_S from this table. It now means
    // the real time required to reach the full Windup pose.
    WINDUP_S: MAX_CHARGE_S,
  };

  window.Combat.chargedBreakerDebug = {
    snapshot: () => ({ ...debugState, lastRelease: debugState.lastRelease ? { ...debugState.lastRelease } : null }),
  };
  // Backward-compatible diagnostic alias retained after deleting the old
  // particle-fire telegraph implementation.
  window.Combat.chargedBreakerPlayerTelegraph = {
    snapshot: () => ({
      active: debugState.active,
      poseCharge: debugState.poseCharge,
      presentation: 'counter-shield-style-weapon-glow',
      glow: window.Combat.weaponChargeGlow?.snapshot?.() || null,
    }),
  };

  window.Combat.applyChargedBreakerConfig = function (cfg) {
    if (!cfg) return;
    if (cfg.MIN_READY_S != null) MIN_READY_S = cfg.MIN_READY_S;
    if (cfg.MAX_CHARGE_S != null) MAX_CHARGE_S = cfg.MAX_CHARGE_S;
    else if (cfg.WINDUP_S != null) MAX_CHARGE_S = cfg.WINDUP_S;
    if (cfg.WINDUP_SLOWDOWN != null) WINDUP_SLOWDOWN = cfg.WINDUP_SLOWDOWN;
    if (cfg.CHARGE_DRAIN_PER_S != null) CHARGE_DRAIN_PER_S = cfg.CHARGE_DRAIN_PER_S;
    if (cfg.COST_MIN != null) COST_MIN = cfg.COST_MIN;
    if (cfg.COST_MAX != null) COST_MAX = cfg.COST_MAX;
    if (cfg.DAMAGE_MUL_MIN != null) DAMAGE_MUL_MIN = cfg.DAMAGE_MUL_MIN;
    if (cfg.DAMAGE_MUL_MAX != null) DAMAGE_MUL_MAX = cfg.DAMAGE_MUL_MAX;
    if (cfg.RANGE_MUL_MIN != null) RANGE_MUL_MIN = cfg.RANGE_MUL_MIN;
    if (cfg.RANGE_MUL_MAX != null) RANGE_MUL_MAX = cfg.RANGE_MUL_MAX;
    if (cfg.KNOCKBACK_MUL_MIN != null) KNOCKBACK_MUL_MIN = cfg.KNOCKBACK_MUL_MIN;
    if (cfg.KNOCKBACK_MUL_MAX != null) KNOCKBACK_MUL_MAX = cfg.KNOCKBACK_MUL_MAX;
    if (cfg.HALF_CONE_DEG_MIN != null) HALF_CONE_DEG_MIN = cfg.HALF_CONE_DEG_MIN;
    if (cfg.HALF_CONE_DEG_MAX != null) HALF_CONE_DEG_MAX = cfg.HALF_CONE_DEG_MAX;
    if (cfg.HALF_CONE_DEG != null && cfg.HALF_CONE_DEG_MIN == null && cfg.HALF_CONE_DEG_MAX == null) {
      HALF_CONE_DEG_MIN = HALF_CONE_DEG_MAX = cfg.HALF_CONE_DEG;
    }
    if (cfg.LUNGE_TILE_MUL_MIN != null) LUNGE_TILE_MUL_MIN = cfg.LUNGE_TILE_MUL_MIN;
    if (cfg.LUNGE_TILE_MUL_MAX != null) LUNGE_TILE_MUL_MAX = cfg.LUNGE_TILE_MUL_MAX;
    if (cfg.LUNGE_TILE_MUL != null && cfg.LUNGE_TILE_MUL_MIN == null && cfg.LUNGE_TILE_MUL_MAX == null) {
      LUNGE_TILE_MUL_MIN = LUNGE_TILE_MUL_MAX = cfg.LUNGE_TILE_MUL;
    }
    if (cfg.LUNGE_GRAVITY_RESIST_MIN != null) LUNGE_GRAVITY_RESIST_MIN = cfg.LUNGE_GRAVITY_RESIST_MIN;
    if (cfg.LUNGE_GRAVITY_RESIST_MAX != null) LUNGE_GRAVITY_RESIST_MAX = cfg.LUNGE_GRAVITY_RESIST_MAX;
    if (cfg.STRIKE_S != null) STRIKE_S = cfg.STRIKE_S;
    if (cfg.POWER != null) POWER = cfg.POWER;
    if (cfg.HOLD_S != null) HOLD_S = cfg.HOLD_S;
    if (cfg.LUNGE_HOP_UNITS != null) LUNGE_HOP_UNITS = cfg.LUNGE_HOP_UNITS;

    Object.assign(window.Combat.chargedBreakerData, {
      MIN_READY_S,
      MAX_CHARGE_S,
      WINDUP_SLOWDOWN,
      DAMAGE_MUL_MIN,
      DAMAGE_MUL_MAX,
      RANGE_MUL_MIN,
      RANGE_MUL_MAX,
      KNOCKBACK_MUL_MIN,
      KNOCKBACK_MUL_MAX,
      HALF_CONE_DEG_MIN,
      HALF_CONE_DEG_MAX,
      LUNGE_TILE_MUL_MIN,
      LUNGE_TILE_MUL_MAX,
      LUNGE_GRAVITY_RESIST_MIN,
      LUNGE_GRAVITY_RESIST_MAX,
      STRIKE_S,
      LUNGE_HOP_UNITS,
      POWER,
      WINDUP_S: MAX_CHARGE_S,
    });
  };
})();
