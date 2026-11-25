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
  let COST_MIN = 24, COST_MAX = 54; // The single cumulative attack cost spans first release-ready pose through full Windup.
  const FULL_CHARGE_POSE = 0.999; // Single full-charge threshold shared by glow, diagnostics, and Flourish qualification.
  const FURIOUS_PROGRESS_OWNER = 'charged-breaker-furious'; // Owns only this hold's temporary transform on Combat.windupPoseProgress.
  const STAMINA_REGEN_BLOCK_SOURCE = 'charged-breaker-hold'; // Independent ResourceSystem regeneration lock held only while charging.
  const MOUNT_CHARGE_BOOST_OWNER = 'mountedCharge'; // Mounted Charge owns only the acceleration earned during its paid hold.

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
  let HOLD_S = 0.5;
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
    staminaRegenBlocked: false,
    staminaCostCommitted: 0,
    staminaCostActual: 0,
    staminaCostTarget: 0,
    mountedBoostPaidFraction: 0, // Diagnostics compare funded windup progress with the charged strike's actual momentum.
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
    const thresholds = [MIN_READY_POSE, 0.50, FULL_CHARGE_POSE];
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

  function chargeCostForPose(poseCharge, staminaCostMul = 1, mounted = false) {
    const pose = clamp01(poseCharge); // The same visible weapon pose funds both charge and acceleration.
    const multiplier = Number(staminaCostMul); // Shared mastery factor for mounted and on-foot holds.
    const scale = Number.isFinite(multiplier) ? Math.max(0, multiplier) : 1; // Clamp invalid or negative stamina costs.
    if (pose < MIN_READY_POSE) {
      // Mounted Charge pays smoothly from the first windup frame; on-foot attacks keep their former free unready segment.
      return mounted ? Math.max(0, COST_MIN * pose / Math.max(1e-6, MIN_READY_POSE) * scale) : 0;
    }
    const readyProgress = clamp01((pose - MIN_READY_POSE) / Math.max(1e-6, 1 - MIN_READY_POSE));
    return Math.max(0, lerp(COST_MIN, COST_MAX, readyProgress) * scale);
  }

  function isFullChargePose(poseCharge) {
    return clamp01(poseCharge) >= FULL_CHARGE_POSE;
  }

  function register() {
    let startedAt = -1;
    let startedMounted = false; // Tracks whether this hold began on a mount so dismounts cannot turn its release into an on-foot lunge.
    let paidChargeCost = 0; // Actual ordinary/enhanced/debt Stamina consumed, used for diagnostics only.
    let paidChargeBaseline = 0; // Cumulative pre-ResourceSystem cost committed, independent of perk and trinket multipliers.
    let staminaRegenBlocked = false; // Tracks ownership of this hold's composable regeneration blocker.
    let furiousTempo = 1; // Snapshot at hold start; charge timing and release use the same reserve level.

    function setHoldStaminaRegenBlocked(blocked) {
      const next = !!blocked;
      if (staminaRegenBlocked === next) return;
      staminaRegenBlocked = next;
      window.ResourceSystem?.setStaminaRegenBlocked?.(window.Combat.deps?.player, STAMINA_REGEN_BLOCK_SOURCE, next);
      debugState.staminaRegenBlocked = next;
    }

    function currentEffects() {
      const deps = window.Combat.deps;
      return window.CombatProgression?.getEffects(deps.currentWeaponKey(), 'chargedBreaker')
        || { afflictions: {}, stats: {} };
    }

    function commitStaminaCostToPose(poseCharge, effects, reason, durationS = 0.22) {
      const shape = window.WeaponShapeStats?.current?.() || { efficiency: 1 }; // Reuses the active weapon's authored efficiency at every payment.
      const efficiency = Math.max(0.05, Number(shape.efficiency) || 1); // Keeps invalid/zero profile data from dividing the charge cost by zero.
      const progressionMultiplier = 1 + (Number(effects?.stats?.staminaCostMul) || 0); // Charged Breaker mastery modifier, before global ResourceSystem taxes/discounts.
      const mounted = window.Mounts?.rideState === 'mounted'; // Mounted Charged Breaker reuses the same heavy mastery, with riding-specific stamina training.
      const target = chargeCostForPose(poseCharge, progressionMultiplier, mounted) / efficiency
        * (mounted ? (window.Mounts?.mountedMeleeStaminaMultiplier?.() || 1) : 1); // Cumulative pre-tax price for the visible pose.
      debugState.staminaCostTarget = target;
      const delta = Math.max(0, target - paidChargeBaseline); // Never compare a pre-tax target against an already-discounted actual payment.
      if (!(delta > 1e-6)) return null;
      const payment = window.ResourceSystem?.spendStamina?.(
        window.Combat.deps.player, delta, reason,
        { actionKind: 'offensiveHeldCharge', abilityId: 'chargedBreaker', durationS }, // The paid hold slice rotates perceived direction over its actual frame duration.
      ) || null;
      paidChargeBaseline = target;
      paidChargeCost += payment
        ? Math.max(0, (Number(payment.enhancedPaid) || 0) + (Number(payment.spent) || 0) + (Number(payment.excess) || 0))
        : delta; // Deterministic fallback for small focused harnesses.
      debugState.staminaCostCommitted = paidChargeBaseline;
      debugState.staminaCostActual = paidChargeCost;
      return payment;
    }

    function onHoldStart() {
      startedAt = now();
      startedMounted = window.Mounts?.rideState === 'mounted';
      paidChargeCost = 0;
      paidChargeBaseline = 0;
      furiousTempo = window.ResourceSystem?.attackTempoMultiplier?.(window.Combat.deps?.player, 'offensiveHeldCharge') ?? 1;
      window.Combat.setWindupProgressTransform?.(FURIOUS_PROGRESS_OWNER, raw => raw * furiousTempo);
      resetChargeGlowMilestones();
      debugState = {
        ...debugState,
        active: true,
        heldSeconds: 0,
        poseCharge: 0,
        glowOverlayLevel: 0,
        glowFlareTier: 0,
        glowFlare: 0,
        staminaRegenBlocked: false,
        staminaCostCommitted: 0,
        staminaCostActual: 0,
        staminaCostTarget: 0,
        mountedBoostPaidFraction: 0,
      };
      const deps = window.Combat.deps;
      const shapeStats = (window.WeaponShapeStats?.current?.() || { power: 1, speed: 1, range: 1, efficiency: 1 }); // Weapon speed controls the full authored charge-pose clock.
      const effects = currentEffects();
      setHoldStaminaRegenBlocked(true); // Block regeneration throughout the actual hold, even when charge is not yet releasable.
      if (startedMounted) window.Mounts?.setMountedCombatWindupBoost?.(MOUNT_CHARGE_BOOST_OWNER, 1, 0); // No speed is granted before any stamina is committed.

      setGlow(0);
      deps.showToast(startedMounted ? 'Mounted Charge charging — release to strike.' : 'Charged Breaker charging — release to strike.', true);
      deps.triggerWeaponHoldVisual((MAX_CHARGE_S + STRIKE_S) / (shapeStats.speed * (window.DoubleEdgedCombatTrinkets?.attackSpeed?.() || 1)), {
        anim: 'sweep',
        pose: window.AttackPoseTemplates?.poseFor('hatchet_swing', POWER), // The editor's Charged Breaker pose, POWER already applied.
        windupFrac: MAX_CHARGE_S / (MAX_CHARGE_S + STRIKE_S),
        strikeFrac: 1,
        power: 1,
        holdS: HOLD_S / (shapeStats.speed * (window.DoubleEdgedCombatTrinkets?.attackSpeed?.() || 1)),
        windupSlowdown: WINDUP_SLOWDOWN,
        afflictionIds: Object.keys(effects.afflictions),
        afflictions: effects.afflictions,
      });
    }

    function releaseNow(heldSeconds, forced) {
      if (startedMounted && window.Mounts?.rideState !== 'mounted') {
        onHoldCancel(); // The mount disappeared during the hold: release no weapon strike or on-foot lunge.
        return;
      }
      startedAt = -1;
      const releasedMounted = startedMounted; // Capture the original riding state for early-release diagnostics.
      startedMounted = false;
      window.Mounts?.clearMountedCombatWindupBoost?.(MOUNT_CHARGE_BOOST_OWNER); // Release ends the boost; the actual carrier velocity carries the attack.
      const deps = window.Combat.deps;
      const poseCharge = poseChargeFromRuntime();
      const shapeStats = (window.WeaponShapeStats?.current?.() || { power: 1, speed: 1, range: 1, efficiency: 1 }); // Release keeps the same weapon profile as the live pose.
      window.Combat.setWindupProgressTransform?.(FURIOUS_PROGRESS_OWNER, null); // Capture the accelerated visible pose first, then release that exact authored partial pose.
      setHoldStaminaRegenBlocked(false); // Also runs on early fizzles, staggers and forced release.
      debugState.active = false;
      debugState.heldSeconds = heldSeconds;
      debugState.poseCharge = poseCharge;

      if (window.Combat.isStaggered(deps.player)) {
        window.FeyHypedAttacks?.clearCredit?.(deps.player, 'chargedBreaker'); // A canceled charge cannot lend already-spent Hyped Stamina to the next unrelated weapon action.
        clearGlow();
        deps.cancelWeaponSwingHold();
        return;
      }
      if (poseCharge < MIN_READY_POSE) {
        window.FeyHypedAttacks?.clearCredit?.(deps.player, 'chargedBreaker'); // An early release has no attack to double.
        clearGlow();
        deps.cancelWeaponSwingHold();
        const posePct = Math.floor(poseCharge * 100); // Floor so a just-short release never reads as meeting the requirement.
        const readyPct = Math.round(MIN_READY_POSE * 100);
        deps.showToast(forced
          ? `${releasedMounted ? 'Mounted Charge' : 'Charged Breaker'} fizzled at ${posePct}% pose: stamina ran out before ${readyPct}%.`
          : `${releasedMounted ? 'Mounted Charge' : 'Charged Breaker'} released too early (${posePct}% pose, needed ${readyPct}%).`, false);
        return;
      }

      const effects = currentEffects();
      const mounted = window.Mounts?.rideState === 'mounted'; // This release's movement is either a mount burst or the normal player lunge, never both.
      if (!forced) commitStaminaCostToPose(poseCharge, effects, 'Charged Breaker'); // Settle only a final unprocessed pose slice, without surcharge.

      // This slices the live authored pose at poseCharge and starts Strike
      // directly from there. No hidden remainder of the windup plays after
      // the player releases the button.
      deps.releaseWeaponSwingHold({ poseProgress: poseCharge });
      setGlow(poseCharge);

      const baseAbil = deps.weaponAbility('cut')
        || { damage: 14, rangePx: deps.TILE * 1.05, knockbackPxS: 360 };
      const baseDamage = baseAbil.damage * lerp(DAMAGE_MUL_MIN, DAMAGE_MUL_MAX, poseCharge)
        * (1 + (effects.stats.damageMul || 0)); // Existing charge-scaled damage before cross-cutting enchantment modifiers.
      const rangePx = baseAbil.rangePx
        * lerp(RANGE_MUL_MIN, RANGE_MUL_MAX, poseCharge)
        * (1 + (effects.stats.rangeMul || 0)) * shapeStats.range;
      const halfConeDeg = lerp(HALF_CONE_DEG_MIN, HALF_CONE_DEG_MAX, poseCharge);
      const halfConeRad = Math.min(Math.PI, halfConeDeg * Math.PI / 180 * shapeStats.range * (1 + (effects.stats.coneWidthMul || 0)));
      const baseKnockbackPxS = baseAbil.knockbackPxS
        * lerp(KNOCKBACK_MUL_MIN, KNOCKBACK_MUL_MAX, poseCharge)
        * (1 + (effects.stats.knockbackMul || 0));
      const baseLungePx = deps.TILE
        * lerp(LUNGE_TILE_MUL_MIN, LUNGE_TILE_MUL_MAX, poseCharge)
        * (1 + (effects.stats.lungeMul || 0));
      const hypedAttackTempo = window.FeyHypedAttacks?.speedMultiplierForNextAction?.(deps.player, 'chargedBreaker') || 1; // Read immediately after the eligible Stamina payment, before the attack-event prepare consumes its credit.
      const attackContext = window.CombatAttackEvents?.prepare?.({
        attacker: deps.player,
        weaponKey: deps.currentWeaponKey(),
        abilityId: 'chargedBreaker',
        damage: baseDamage,
        afflictionBonuses: effects.afflictions,
        knockbackPxS: baseKnockbackPxS,
        rangePx,
        halfConeRad,
        lungePx: mounted ? 0 : baseLungePx,
        chargePercentage: poseCharge,
        fullCharge: isFullChargePose(poseCharge),
        metadata: { attackAngle: deps.player.angle, paidChargeCost, mounted },
      }) || { modifiers: { damage: 1, footingDamage: 1, affliction: 1, knockback: 1, lunge: 1 }, afflictionBonuses: effects.afflictions };
      const damage = Math.round((attackContext.damage ?? baseDamage) * (attackContext.modifiers?.damage || 1));
      const knockbackPxS = (attackContext.knockbackPxS ?? baseKnockbackPxS) * (attackContext.modifiers?.knockback || 1);
      const lungePx = mounted ? 0 : baseLungePx * (attackContext.modifiers?.lunge || 1);
      const attackAfflictions = window.CombatAttackEvents?.scaleAfflictions?.(attackContext.afflictionBonuses || effects.afflictions, attackContext.modifiers?.affliction || 1)
        || effects.afflictions;
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
      const timeScale = 1 / ((window.ResourceSystem?.getExhaustionSpeed(deps.player) ?? 1) * (shapeStats.speed * (window.DoubleEdgedCombatTrinkets?.attackSpeed?.() || 1) * hypedAttackTempo * furiousTempo));
      const strikeS = STRIKE_S * timeScale;
      window.FeyIllusions?.setActionDuration?.(deps.player, strikeS); // Final paid pose slice follows the actual partial-Windup→Strike timeline.

      deps.setCombatSwingCone(rangePx, halfConeRad, deps.player.angle);
      if (!mounted) {
        deps.beginCombatLunge(lungePx, strikeS, LUNGE_HOP_UNITS, {
          rangePx, halfConeRad, pitchDistanceResistance, directFlightStrength,
        });
      } // Mounted Charge gained speed only while spending stamina in Windup; Strike uses real residual momentum.

      debugState.lastRelease = {
        at: Date.now(),
        heldSeconds,
        poseCharge,
        damage,
        rangePx,
        halfConeDeg: halfConeRad * 180 / Math.PI,
        knockbackPxS,
        lungePx,
        pitchDistanceResistance,
        directFlightStrength,
        staminaCostCommitted: paidChargeBaseline,
        staminaCostActual: paidChargeCost,
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
          if (mounted && window.Mounts?.rideState !== 'mounted') return; // A dismount after release cannot turn this committed attack into a phantom on-foot hit.
          const vegetationCleared = deps.clearVegetationInAttackCone?.(
            deps.player.x, deps.player.y, deps.player.angle, rangePx, halfConeRad,
          ) || 0;
          let hits = 0, lastName = '';
          const ordinaryHitTargets = new Set(); // Used after real charged-hit validity so Living Gust's widened region stays knockback-only.
          for (const c of deps.hostileObjects) {
            if (c.health <= 0 || c.areaId !== deps.getCurrentArea()) continue;
            if (!window.Combat.meleeHit(deps.player, c, {
              rangePx,
              halfConeRad,
              yaw: deps.player.angle,
              pitch: deps.getPlayerMeleeAimPitch?.() || 0,
            })) continue;
            const healthBefore = Math.max(0, Number(c.health) || 0); // Used by Mirrored Health for post-mitigation damage only.
            const impactDamage = mounted ? Math.round(damage * (window.Mounts?.mountedMeleeDamageMultiplier?.() || 1)) : damage; // Impact resolves from actual collision-tested speed, not charge pose alone.
            deps.damageCreature(c, impactDamage, deps.player.x, deps.player.y, knockbackPxS, {
              attacker: deps.player, // Explicit source for Attack Power and Tempered Footing.
              abilityId: 'chargedBreaker', // Identifies the committed hit for authored training objectives.
              tag: deps.currentWeaponDamageType(),
              heavy: true,
              footingDamageMultiplier: attackContext.modifiers?.footingDamage || 1,
              afflictionBonuses: attackAfflictions,
            });
            ordinaryHitTargets.add(c);
            window.CombatAttackEvents?.hit?.(attackContext, {
              target: c,
              actualDamage: Math.max(0, healthBefore - (Number(c.health) || 0)),
              metadata: { feyPrimaryDamage: impactDamage, feyPrimaryKnockback: knockbackPxS }, // The mounted/unmounted committed damage informs Hyped's second strike.
              afflictionBonuses: attackAfflictions,
              chargePercentage: poseCharge,
              fullCharge: isFullChargePose(poseCharge),
            });
            deps.playWeaponHitSfx?.(
              deps.currentWeaponDamageType(), c.x, c.y, c.areaId, undefined, 'huge',
            );
            hits++;
            lastName = c.def.label;
          }

          window.EnchantmentSystem?.applyPeripheralGust?.(attackContext, ordinaryHitTargets);
          const pct = Math.round(poseCharge * 100);
          const name = mounted ? 'Mounted Charge' : 'Charged Breaker'; // The same mastered heavy ability has a distinct riding label.
          const msg = hits > 0
            ? `${name} (${pct}% pose charge): hit ${hits > 1 ? hits + ' creatures' : 'the ' + lastName}!`
            : vegetationCleared > 0
              ? `${name} (${pct}% pose charge): cut ${vegetationCleared} vegetation tile${vegetationCleared === 1 ? '' : 's'} into mulch.`
              : `${name} (${pct}% pose charge) connects with nothing.`;
          deps.showToast(msg, hits > 0 || vegetationCleared > 0, true);
          if (hits > 0) {
            window.PlayerLunge?.confirmEnemyHit?.(); // A real enemy hit grants the one-second slow-fall aerial follow-up window; misses grant nothing.
            deps.awardWeaponMasteryXp();
          }
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
      if (startedMounted && window.Mounts?.rideState !== 'mounted') {
        onHoldCancel(); // Removes visual stance and stamina regeneration block when dismounted mid-charge.
        return;
      }
      const deps = window.Combat.deps;
      const shapeStats = (window.WeaponShapeStats?.current?.() || { power: 1, speed: 1, range: 1, efficiency: 1 }); // This update funds the same charge percentage visible to the player.
      const heldSeconds = now() - startedAt;
      const poseCharge = poseChargeFromRuntime();
      debugState.heldSeconds = heldSeconds;
      debugState.poseCharge = poseCharge;
      setGlow(poseCharge);

      const effects = currentEffects(); // Single mastery snapshot funds this hold step and determines its mounted speed ceiling.
      commitStaminaCostToPose(poseCharge, effects, 'Charged Breaker (charging)', Math.max(0.001, dt)); // Per-frame paid charge slices rotate the camera as gradually as Stamina is expended. // Unchanged pose spends nothing.
      if (startedMounted) {
        const efficiency = Math.max(0.05, Number(shapeStats.efficiency) || 1); // Mirror the payment's authored cost denominator.
        const fullCost = chargeCostForPose(1, 1 + (Number(effects.stats.staminaCostMul) || 0)) / efficiency
          * (window.Mounts?.mountedMeleeStaminaMultiplier?.() || 1); // Normalize against this rider's full paid charge budget, including training.
        const funded = fullCost > 0 ? clamp01(paidChargeBaseline / fullCost) : 0; // Each successful incremental stamina commitment raises speed; no elapsed-time-only bonus.
        const masteryScale = Math.max(0, 1 + (Number(effects.stats.lungeMul) || 0)); // Preserve heavy lunge mastery as more mounted charge speed.
        const enchantment = window.EnchantmentSystem; // Living Gust's lunge enhancement must also help mounted windup, without firing its spend-Footing attack event early.
        const weaponKey = deps.currentWeaponKey(); // Use the equipped weapon's existing enchantment identity, not a new buff owner.
        const hasGust = !!enchantment?.hasBase?.('livingGust', weaponKey); // No enchantment lookup or extra per-frame work for ordinary weapons.
        const gustPower = hasGust ? Number(enchantment.getEnchantmentPowerMultiplier?.(weaponKey)) : 0;
        const gustMultiplier = hasGust ? Number(enchantment.TUNING?.LIVING_GUST_LUNGE_MULTIPLIER) : 1;
        const gustScale = Number.isFinite(gustPower) && Number.isFinite(gustMultiplier)
          ? Math.max(0, 1 + (gustMultiplier - 1) * gustPower) : 1; // Read-only counterpart to the impact event's existing lunge modifier.
        window.Mounts?.setMountedCombatWindupBoost?.(MOUNT_CHARGE_BOOST_OWNER, (2.4 + poseCharge * 0.8) * masteryScale * gustScale, funded);
        debugState.mountedBoostPaidFraction = funded;
      }
      const hasEnhancedStamina = (window.ResourceSystem?.getEnhancedResources?.(deps.player, 'stamina', { actionKind: 'offensiveHeldCharge' }) || []).some(entry => !entry.def?.requiresBeneficialTransaction || entry.benefitsTransaction);
      if (deps.player.stamina <= 0 && !hasEnhancedStamina) releaseNow(heldSeconds, true);
    }

    function onHoldCancel() {
      if (startedAt < 0) return;
      startedAt = -1;
      startedMounted = false;
      window.Mounts?.clearMountedCombatWindupBoost?.(MOUNT_CHARGE_BOOST_OWNER); // Cancel any remaining charge acceleration on stagger, dismount, or input cancellation.
      debugState.active = false;
      setHoldStaminaRegenBlocked(false); // Cancellation releases only this action's blocker.
      window.Combat.setWindupProgressTransform?.(FURIOUS_PROGRESS_OWNER, null);
      clearGlow();
      window.FeyHypedAttacks?.clearCredit?.(window.Combat.deps?.player, 'chargedBreaker'); // Stagger, dismount and input cancellation abandon the paid attack.
      window.Combat.deps.cancelWeaponSwingHold();
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
      onHoldCancel,
    });
  }

  register();

  window.Combat.chargedBreakerData = {
    MIN_READY_POSE,
    FULL_CHARGE_POSE,
    MAX_CHARGE_S,
    WINDUP_SLOWDOWN,
    COST_MIN, // Shared charged-attack tuning used by the ranged fallback/diagnostics.
    COST_MAX, // Shared charged-attack tuning at full visible pose.
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
    HOLD_S, // Post-strike pause; enemies hold their strike pose this long before easing back, like the player.
    // Bandit code historically reads WINDUP_S from this table. It now means
    // the real time required to reach the full Windup pose.
    WINDUP_S: MAX_CHARGE_S,
    holdSecondsForPoseCharge,
    chargeCostForPose,
    isFullChargePose,
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
      FULL_CHARGE_POSE,
      MAX_CHARGE_S,
      WINDUP_SLOWDOWN,
      COST_MIN,
      COST_MAX,
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
      HOLD_S,
      WINDUP_S: MAX_CHARGE_S,
      holdSecondsForPoseCharge,
      chargeCostForPose,
      isFullChargePose,
    });
  };
})();
