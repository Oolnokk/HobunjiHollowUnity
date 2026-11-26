// Mounted one-off weapon attack. The ordinary combo mastery supplies its first
// swing's stats/afflictions, but a mount never advances the three-hit chain.
(() => {
  'use strict';
  if (!window.Combat?.abilities) {
    console.error('combat-mounted.js requires combat-core.js and combat-loadout.js');
    return;
  }

  let activeAttack = null; // Keeps repeated taps from overlapping the same mounted strike.
  const debug = { attempts: 0, strikes: 0, lastHit: null }; // Exposed for mobile copy/debug without console access.

  function riding() {
    return window.Mounts?.rideState === 'mounted' && !!window.Mounts?.rideEntity;
  }

  function oneOffMountedTap() {
    if (!riding() || activeAttack) return;
    const combat = window.Combat; // Shared attack/stagger/weapon dependency owner.
    const deps = combat.deps; // Gameplay-owned weapon stats, actor, effects and hit geometry.
    if (!deps?.player || combat.isStaggered(deps.player)) return;

    const comboId = deps.currentComboAbilityId?.() || 'swingCombo'; // Existing per-weapon combo defines which mastery applies.
    const firstStep = combat.comboData?.[comboId]?.[0]; // Only the opening combo move is used; no special-finisher progression.
    if (!firstStep) return;
    const weaponKey = deps.currentWeaponKey(); // Identifies the selected weapon for combo mastery and enchantments.
    const stats = window.WeaponShapeStats?.current?.() || { power: 1, speed: 1, range: 1, efficiency: 1 };
    const effects = window.CombatProgression?.getEffects?.(weaponKey, comboId) || { afflictions: {}, stats: {} }; // Original combo mastery, not a separate mounted progression tree.
    const bonuses = effects.stats || {}; // Mounted opening swing's unlocked damage/range/cost bonuses.
    const speed = Math.max(0.1, (window.ResourceSystem?.getExhaustionSpeed?.(deps.player) ?? 1) *
      (Number(stats.speed) || 1) * (window.DoubleEdgedCombatTrinkets?.attackSpeed?.() || 1));
    const windupS = firstStep.windupS / speed;
    const strikeS = firstStep.strikeS / speed;
    const totalS = windupS + strikeS;
    const base = deps.weaponAbility('cut') || { damage: 14, rangePx: deps.TILE * 1.05, knockbackPxS: 360 }; // Existing weapon cut stats remain authoritative.
    const rangePx = base.rangePx * firstStep.rangeMul * (combat.comboData.RANGE_SCALE || 1) *
      (1 + (bonuses.rangeMul || 0)) * (Number(stats.range) || 1);
    const halfConeRad = Math.min(Math.PI, firstStep.halfConeDeg * Math.PI / 180 *
      (Number(stats.range) || 1) * (1 + (bonuses.coneWidthMul || 0)));
    const baseDamage = base.damage * firstStep.damageMul * (1 + (bonuses.damageMul || 0));
    const knockbackPxS = base.knockbackPxS * firstStep.knockbackMul * (1 + (bonuses.knockbackMul || 0));
    const attackContext = window.CombatAttackEvents?.prepare?.({
      attacker: deps.player, weaponKey, abilityId: comboId, slotId: 'tap1', attackCategory: 'combo', damage: baseDamage, // Retain combo mastery identity while routing enchantment flourishes through mounted Action 1.
      afflictionBonuses: effects.afflictions, knockbackPxS, rangePx, halfConeRad,
      lungePx: 0, comboStep: 1, comboFinisher: false,
      metadata: { attackAngle: deps.player.angle, mounted: true },
    }) || { modifiers: { damage: 1, knockback: 1, affliction: 1, footingDamage: 1 }, afflictionBonuses: effects.afflictions };
    const afflictions = window.CombatAttackEvents?.scaleAfflictions?.(
      attackContext.afflictionBonuses || effects.afflictions, attackContext.modifiers?.affliction || 1,
    ) || effects.afflictions;
    const staminaCost = firstStep.staminaCost * (1 + (bonuses.staminaCostMul || 0)) /
      Math.max(0.05, Number(stats.efficiency) || 1) * (window.Mounts?.mountedMeleeStaminaMultiplier?.() || 1);
    window.ResourceSystem?.spendStamina?.(deps.player, staminaCost, 'Mounted Strike', {
      actionKind: 'combatCombo', abilityId: comboId, heavy: false,
    });
    deps.setCombatSwingCone?.(rangePx, halfConeRad, deps.player.angle);
    deps.triggerWeaponSwingVisual?.(totalS, {
      anim: firstStep.anim, dirSign: firstStep.dirSign,
      pose: combat.comboStepPose?.(comboId, firstStep) || firstStep.pose,
      windupFrac: windupS / totalS, strikeFrac: 1, power: 1,
      holdS: (firstStep.holdS || 0) / speed,
      coneRangePx: rangePx, coneHalfConeRad: halfConeRad, coneAngle: deps.player.angle,
      afflictionIds: Object.keys(afflictions), afflictions,
    });

    debug.attempts++;
    const action = combat.beginStagedAction({
      windupS: totalS, strikeS: 0, recoverS: 0,
      onStrike: () => {
        if (!riding()) return; // A dismount or forced unsummon cancels the mounted hit at its impact frame.
        debug.strikes++;
        const momentum = window.Mounts?.mountedMeleeDamageMultiplier?.() || 1; // Samples actual velocity at impact, after collision and braking.
        const damage = Math.max(0, Math.round((attackContext.damage ?? baseDamage) * (attackContext.modifiers?.damage || 1) * momentum));
        const knockback = (attackContext.knockbackPxS ?? knockbackPxS) * (attackContext.modifiers?.knockback || 1);
        const vegetation = deps.clearVegetationInAttackCone?.(deps.player.x, deps.player.y, deps.player.angle, rangePx, halfConeRad) || 0;
        let hits = 0;
        const landed = new Set(); // Enchantment gust applies only after the ordinary hit tests have succeeded.
        for (const target of deps.hostileObjects || []) {
          if (!target || target.health <= 0 || target.areaId !== deps.getCurrentArea()) continue;
          if (!combat.meleeHit(deps.player, target, { rangePx, halfConeRad, yaw: deps.player.angle, pitch: deps.getPlayerMeleeAimPitch?.() || 0 })) continue;
          const before = Math.max(0, Number(target.health) || 0); // Post-mitigation delta for existing cross-cutting hit observers.
          deps.damageCreature(target, damage, deps.player.x, deps.player.y, knockback, {
            attacker: deps.player, // Explicit source for Attack Power and Tempered Footing.
              abilityId: comboId, tag: deps.currentWeaponDamageType(), heavy: false,
            footingDamageMultiplier: attackContext.modifiers?.footingDamage || 1,
            afflictionBonuses: afflictions,
          });
          landed.add(target);
          window.CombatAttackEvents?.hit?.(attackContext, {
            target, actualDamage: Math.max(0, before - (Number(target.health) || 0)),
            afflictionBonuses: afflictions, comboStep: 1, comboFinisher: false,
          });
          deps.playWeaponHitSfx?.(deps.currentWeaponDamageType(), target.x, target.y, target.areaId, undefined, 'medium');
          hits++;
        }
        window.EnchantmentSystem?.applyPeripheralGust?.(attackContext, landed);
        debug.lastHit = { at: Date.now(), hits, damage, momentum, vegetation, comboId }; // Inspect mount strike output on a phone.
        if (hits) deps.awardWeaponMasteryXp?.();
      },
      onComplete: () => { activeAttack = null; },
      onCancel: () => { activeAttack = null; },
      data: { meleeThreat: combat.playerMeleeThreat?.(rangePx, halfConeRad, { yaw: deps.player.angle, lungePx: 0, source: 'Mounted Strike' }) },
    });
    activeAttack = action && !action.cancelled && action.phase !== 'done' ? action : null;
  }

  window.Combat.abilities.register('mountedStrike', {
    label: 'Mounted Strike', category: 'combo', slotFamily: 'tap', onTap: oneOffMountedTap,
  });
  window.Combat.mountedCombat = { debug }; // Existing Debug and Pixel Probe can inspect attack attempts without a console.
})();
