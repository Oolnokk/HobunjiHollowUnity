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

  let MIN_READY_POSE = 0.48; // Used as the minimum visible Neutral→Windup interpolation required to release a real strike.
  let MAX_CHARGE_S = 4.0; // Used only to pace the visual Neutral→Windup journey; full pose and 100% charge are the same event.
  let WINDUP_SLOWDOWN = 25; // Used by Combat.windupPoseProgress; higher means a longer, slower final approach to Windup.
  let CHARGE_DRAIN_PER_S = 4;
  let COST_MIN = 12, COST_MAX = 18;

  // Damage still rises with the pose charge, but this technique is now
  // deliberately centered on movement/control geometry rather than reach.
  let DAMAGE_MUL_MIN = 1.20, DAMAGE_MUL_MAX = 2.40;
  let RANGE_MUL_MIN = 1.00, RANGE_MUL_MAX = 1.15;
  let KNOCKBACK_MUL_MIN = 1.20, KNOCKBACK_MUL_MAX = 3.00;
  let HALF_CONE_DEG_MIN = 34, HALF_CONE_DEG_MAX = 70;
  let LUNGE_TILE_MUL_MIN = 1.80, LUNGE_TILE_MUL_MAX = 4.20;
  // Used by meleeLungeProfile's underlying pitch-distance term. At full
  // charge, looking upward retains most of the horizontal lunge that gravity/
  // aim pitch would ordinarily remove.
  let LUNGE_GRAVITY_RESIST_MIN = 0.00, LUNGE_GRAVITY_RESIST_MAX = 0.90;
  let LUNGE_DIRECT_FLIGHT_MIN = 0.00, LUNGE_DIRECT_FLIGHT_MAX = 0.98; // At full pose charge, almost all travel follows one straight 3D aim vector.

  let STRIKE_S = 0.30;
  let POWER = 1.70;
  let HOLD_S = 1.0;
  let LUNGE_HOP_UNITS = 0.45;
  const GLOW_COLOR = 0xffc85a;
  const GLOW_FLARE_DURATION_S = 0.17; // Short enough for the 48% and 50% milestones to read as two distinct flashes.
  let glowMilestonesHit = [false, false, false]; // Ready, 50%, and full-pose milestones reached during the current hold.
  let glowFlareQueue = []; // Queues very close milestones instead of collapsing them into one frame.
  let activeGlowFlareTier = 0;
  let activeGlowFlareStartedAt = -1;

  let debugState = {
    active: false,
    heldSeconds: 0,
    poseCharge: 0,
    lastRelease: null,
  }; // Used by mobile-friendly diagnostics without requiring console access.

  function now() { return performance.now() / 1000; }
  function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function holdSecondsForPoseCharge(poseCharge) {
    const charge = clamp01(poseCharge);
    const slowdown = Math.max(0, Number(WINDUP_SLOWDOWN) || 0);
    if (slowdown <= 1e-6) return charge * MAX_CHARGE_S;
    const raw = (Math.exp(charge * Math.log1p(slowdown)) - 1) / slowdown;
    return clamp01(raw) * MAX_CHARGE_S;
  }

  function poseChargeFromRuntime() {
    const live = window.Combat.deps?.getWeaponSwingWindupPoseProgress?.();
    if (Number.isFinite(Number(live))) return clamp01(live);
    // Charge is deliberately NEVER reconstructed from elapsed hold time.
    // Missing render-pose authority therefore fails closed at zero power
    // instead of silently violating the visible-pose == gameplay-charge rule.
    window.__farmLog?.('[charged-breaker] visible windup pose progress unavailable; charge held at 0%.', 'warn', 'combat');
    return 0;
  }

  function resetChargeGlowMilestones() {
    glowMilestonesHit = [false, false, false];
    glowFlareQueue = [];
    activeGlowFlareTier = 0;
    activeGlowFlareStartedAt = -1;
  }

  function chargeGlowMilestones(poseCharge) {
    const t = clamp01(poseCharge);
    const thresholds = [MIN_READY_POSE, 0.50, 0.999];
    for (let i = 0; i < thresholds.length; i++) {
      if (glowMilestonesHit[i] || t < thresholds[i]) continue;
      glowMilestonesHit[i] = true;
      glowFlareQueue.push(i + 1);
    }

    const current = now();
    if (activeGlowFlareStartedAt >= 0 && current - activeGlowFlareStartedAt >= GLOW_FLARE_DURATION_S) {
      activeGlowFlareStartedAt = -1;
      activeGlowFlareTier = 0;
    }
    if (activeGlowFlareStartedAt < 0 && glowFlareQueue.length) {
      activeGlowFlareTier = glowFlareQueue.shift();
      activeGlowFlareStartedAt = current;
    }
    const flareAge = activeGlowFlareStartedAt >= 0 ? current - activeGlowFlareStartedAt : Infinity;
    const flare = Number.isFinite(flareAge)
      ? clamp01(1 - flareAge / GLOW_FLARE_DURATION_S)
      : 0;
    return {
      overlayLevel: glowMilestonesHit.filter(Boolean).length,
      flare,
      flareTier: activeGlowFlareTier,
    };
  }

  function setGlow(poseCharge) {
    const t = clamp01(poseCharge);
    const milestone = chargeGlowMilestones(t);
    window.Combat.weaponChargeGlow?.set?.('chargedBreaker', Math.max(0.025, t), {
      expansion: t,
      color: GLOW_COLOR,
      label: 'Charged Breaker',
      flowStrength: 1,
      flowSpeed: 8.5,
      overlayMode: 'stepped',
      overlayProgress: t,
      overlayLevel: milestone.overlayLevel,
      flare: milestone.flare,
      motionTrail: true,
    });
    debugState.glowOverlayLevel = milestone.overlayLevel;
    debugState.glowFlareTier = milestone.flareTier;
    debugState.glowFlare = milestone.flare;
  }

  function clearGlow() {
    window.Combat.weaponChargeGlow?.clear?.('chargedBreaker');
  }

  function register() {
    let startedAt = -1;

    function onHoldStart() {
      startedAt = now();
      resetChargeGlowMilestones();
      debugState = {
        ...debugState,
        active: true,
        heldSeconds: 0,
        poseCharge: 0,
        glowOverlayLevel: 0,
        glowFlareTier: 0,
        glowFlare: 0,
      };
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
      const poseCharge = poseChargeFromRuntime();
      debugState.active = false;
      debugState.heldSeconds = heldSeconds;
      debugState.poseCharge = poseCharge;

      if (window.Combat.isStaggered(deps.player)) {
        clearGlow();
        deps.cancelWeaponSwingHold();
        return;
      }
      if (poseCharge < MIN_READY_POSE) {
        clearGlow();
        deps.cancelWeaponSwingHold();
        const posePct = Math.round(poseCharge * 100);
        const readyPct = Math.round(MIN_READY_POSE * 100);
        deps.showToast(forced
          ? `Charged Breaker fizzled at ${posePct}% pose: stamina ran out before ${readyPct}%.`
          : `Charged Breaker released too early (${posePct}% pose, needed ${readyPct}%).`, false);
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
      const directFlightStrength = lerp(
        LUNGE_DIRECT_FLIGHT_MIN,
        LUNGE_DIRECT_FLIGHT_MAX,
        poseCharge,
      );
      const timeScale = 1 / (window.ResourceSystem?.getExhaustionSpeed(deps.player) ?? 1);
      const strikeS = STRIKE_S * timeScale;

      deps.setCombatSwingCone(rangePx, halfConeRad, deps.player.angle);
      deps.beginCombatLunge(lungePx, strikeS, LUNGE_HOP_UNITS, {
        rangePx,
        halfConeRad,
        pitchDistanceResistance,
        directFlightStrength,
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
        directFlightStrength,
        forced: !!forced,
      };

      window.Combat.beginStagedAction({
        // The held Neutral→Windup portion has already happened before release.
        // Treat the visible release→Strike arc as the remaining pre-impact phase
        // so the charge-scaled lunge can actually carry the player into range
        // before damage resolves at the partial Strike endpoint.
        windupS: strikeS,
        strikeS: 0,
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
      const poseCharge = poseChargeFromRuntime();
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
    MIN_READY_POSE,
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
    LUNGE_DIRECT_FLIGHT_MIN,
    LUNGE_DIRECT_FLIGHT_MAX,
    STRIKE_S,
    LUNGE_HOP_UNITS,
    POWER,
    // Bandit code historically reads WINDUP_S from this table. It now means
    // the real time required to reach the full Windup pose.
    WINDUP_S: MAX_CHARGE_S,
    holdSecondsForPoseCharge,
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
    if (cfg.MAX_CHARGE_S != null) MAX_CHARGE_S = cfg.MAX_CHARGE_S;
    else if (cfg.WINDUP_S != null) MAX_CHARGE_S = cfg.WINDUP_S;
    if (cfg.WINDUP_SLOWDOWN != null) WINDUP_SLOWDOWN = cfg.WINDUP_SLOWDOWN;
    if (cfg.MIN_READY_POSE != null) {
      MIN_READY_POSE = clamp01(cfg.MIN_READY_POSE);
    } else if (cfg.MIN_READY_S != null) {
      // Backward-compatible authored data is translated ONCE into pose space.
      // Runtime readiness still depends only on the visible pose percentage.
      const rawReadyT = MAX_CHARGE_S > 0 ? clamp01(cfg.MIN_READY_S / MAX_CHARGE_S) : 1;
      MIN_READY_POSE = window.Combat.windupPoseProgress?.(rawReadyT, WINDUP_SLOWDOWN) ?? rawReadyT;
    }
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
    if (cfg.LUNGE_DIRECT_FLIGHT_MIN != null) LUNGE_DIRECT_FLIGHT_MIN = cfg.LUNGE_DIRECT_FLIGHT_MIN;
    if (cfg.LUNGE_DIRECT_FLIGHT_MAX != null) LUNGE_DIRECT_FLIGHT_MAX = cfg.LUNGE_DIRECT_FLIGHT_MAX;
    if (cfg.STRIKE_S != null) STRIKE_S = cfg.STRIKE_S;
    if (cfg.POWER != null) POWER = cfg.POWER;
    if (cfg.HOLD_S != null) HOLD_S = cfg.HOLD_S;
    if (cfg.LUNGE_HOP_UNITS != null) LUNGE_HOP_UNITS = cfg.LUNGE_HOP_UNITS;

    Object.assign(window.Combat.chargedBreakerData, {
      MIN_READY_POSE,
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
      LUNGE_DIRECT_FLIGHT_MIN,
      LUNGE_DIRECT_FLIGHT_MAX,
      STRIKE_S,
      LUNGE_HOP_UNITS,
      POWER,
      WINDUP_S: MAX_CHARGE_S,
      holdSecondsForPoseCharge,
    });
  };
})();
