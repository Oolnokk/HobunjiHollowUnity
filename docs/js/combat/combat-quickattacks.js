// Combat quick attacks — the weapon tool's tap-slot conditional techniques,
// ported from the sandbox's triggerQuickAttack()/getQuickConditions(). Each
// technique registers under the 'tap' slot family (same family as the 3-step
// combo in combat-combo.js) so any one of them can occupy tap1 or tap2.
//
// Conditions are resolved against the creature that the strike ACTUALLY hits,
// at impact time. The swing can hit several hostiles in its cone, so each one
// gets its own conditional verdict/damage instead of inheriting a button-press
// verdict from whichever creature happened to be the auto-target.
//
// "enemyStriking" (Opportunist Jab's bonus) recognizes both the generic
// enemy telegraph's strike stage and named modular animal attacks that expose
// a committed strike window through Combat.animalAttacks.isStriking(). That
// keeps Pounce's leap and future named attacks on the same condition path.
(() => {
  "use strict";
  if (!window.Combat?.abilities) { console.error('combat-quickattacks.js requires combat-core.js + combat-loadout.js to load first'); return; }

  function now() { return performance.now() / 1000; }

  function enemyIsStriking(target) {
    if (!target) return false;
    if (target.telegraphState === 'strike') return true;
    return !!window.Combat.animalAttacks?.isStriking?.(target);
  }

  // Shared source of truth for attack execution and readiness cues. The target
  // passed here is the exact creature being inspected: UI may pass the current
  // auto-target, while strike resolution passes each creature actually hit.
  function getConditions(deps, target) {
    if (!target) return { enemyStriking: false, exhausted: false, behind: false, lowHealth: false };
    const toPlayerX = deps.player.x - target.x;
    const toPlayerY = deps.player.y - target.y;
    const dist = Math.max(0.001, Math.hypot(toPlayerX, toPlayerY));
    const forwardX = Math.cos(target.facing || 0);
    const forwardY = Math.sin(target.facing || 0);
    const behindDot = forwardX * (toPlayerX / dist) + forwardY * (toPlayerY / dist);
    return {
      enemyStriking: enemyIsStriking(target),
      // True Exhausted (see resource-system.js's spendStamina) always
      // counts, even if a Winded-Stamina-reduced effective max makes the
      // plain 20%-of-max fallback threshold look full.
      exhausted: !!target.exhaustion?.active || target.stamina <= target.maxStamina * 0.20,
      behind: behindDot < -0.35,
      lowHealth: target.health > 0 && target.health <= target.maxHealth * 0.30,
    };
  }
  window.Combat.getQuickAttackConditions = getConditions;

  // Each technique's numbers live in TECHNIQUES as plain data (base values,
  // a single condition key it swaps to `bonus` values under, and its own
  // fixed halfConeDeg/rangeMul) so docs/config/combat/attack-values.json's
  // `quickAttacks.techniques` section can override them wholesale.
  const TECHNIQUES = {
    opportunistJab: { label: 'Opportunist Jab', condKey: 'enemyStriking', halfConeDeg: 16, rangeMul: 0.95,
      base: { damageMul: 0.5, knockbackMul: 0.9 }, bonus: { damageMul: 3.2, knockbackMul: 1.9 }, bonusText: 'bonus: target was in strike stage' },
    exhaustCutter: { label: 'Exhaust Cutter', condKey: 'exhausted', halfConeDeg: 18, rangeMul: 1.0,
      base: { damageMul: 0.57, knockbackMul: 1.0 }, bonus: { damageMul: 3.1, knockbackMul: 2.0 }, bonusText: 'bonus: target stamina was empty' },
    backstabFlick: { label: 'Backstab Flick', condKey: 'behind', halfConeDeg: 39, rangeMul: 1.25,
      base: { damageMul: 0.57, knockbackMul: 1.0 }, bonus: { damageMul: 3.6, knockbackMul: 2.4 }, bonusText: 'bonus: player was behind target' },
    mercySpike: { label: 'Mercy Spike', condKey: 'lowHealth', halfConeDeg: 14, rangeMul: 1.5,
      base: { damageMul: 0.43, knockbackMul: 0.85 }, bonus: { damageMul: 3.9, knockbackMul: 1.65 }, bonusText: 'bonus: target was below 30% health' },
  };

  function buildTechnique(techDef, cond) {
    const active = !!cond[techDef.condKey];
    const vals = active ? techDef.bonus : techDef.base;
    return {
      name: techDef.label, damageMul: vals.damageMul, knockbackMul: vals.knockbackMul,
      halfConeDeg: techDef.halfConeDeg, rangeMul: techDef.rangeMul,
      sourceText: active ? techDef.bonusText : 'no condition bonus',
    };
  }
  window.Combat.buildQuickAttack = buildTechnique;

  let WINDUP_S = 0.075;
  let STRIKE_S = 0.105;
  let COST_COMMIT = 60; // Up-front quick-attack commitment; configured by attack-values.json and spent in onTap().
  let CONDITIONAL_REFUND_FRACTION = 0.5; // Fraction of the actual post-modifier spend restored after at least one correct conditional hit.
  let HOLD_S = 1; // post-strike pause before easing back to neutral
  // The jab's hit cone (scaled off the shared 'cut' ability's rangePx —
  // see baseAbil below) is intentionally tighter than the forward lunge.
  let RANGE_SCALE = 0.6;
  // Forward closing distance in tiles. Quick attacks are meant to be a costly
  // commitment with unusual reach, but 5.5 tiles proved excessive.
  let LUNGE_TILE_MUL = 4.5;

  function round1(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
  }

  // ResourceSystem intentionally lets abilities overspend into Exhausted
  // black-stamina debt. A successful conditional should refund the same real
  // resource that was spent, so pay debt back first, then normal Stamina. If
  // the refund exactly clears Exhausted, keep Stamina at its refunded amount
  // instead of letting ResourceSystem's normal "debt reached 100" path refill
  // the entire bar on the next tick.
  function refundStamina(entity, amount) {
    let remaining = Math.max(0, Number(amount) || 0); // Portion of this quick-attack refund still waiting to be applied.
    let restored = 0; // Actual Stamina/debt points restored, returned for feedback/debugging.
    if (!(remaining > 0) || !entity) return 0;

    if (entity.exhaustion?.active) {
      const blackBefore = Math.max(0, Math.min(100, Number(entity.exhaustion.blackStamina) || 0));
      const debtRefund = Math.min(remaining, 100 - blackBefore);
      entity.exhaustion.blackStamina = round1(blackBefore + debtRefund);
      remaining -= debtRefund;
      restored += debtRefund;
      if (entity.exhaustion.blackStamina >= 100) {
        entity.exhaustion.active = false;
        entity.exhaustion.blackStamina = 100;
      }
    }

    if (!entity.exhaustion?.active && remaining > 0) {
      const effectiveMax = window.ResourceSystem?.getEffectiveMax?.(entity, 'stamina') ?? entity.maxStamina ?? 0;
      const before = Number(entity.stamina) || 0;
      entity.stamina = round1(Math.min(effectiveMax, before + remaining));
      restored += Math.max(0, entity.stamina - before);
    }

    window.ResourceSystem?.enforceCaps?.(entity);
    return round1(restored);
  }

  function registerQuickAttack(id, def) {
    let busyAction = null;

    function onTap() {
      if (busyAction) return; // previous strike's windup/strike hasn't resolved yet
      const deps = window.Combat.deps;
      // Footing/impact stagger lockout — see combat-combo.js's matching guard.
      if (window.Combat.isStaggered(deps.player)) return;

      // Every affliction this jab can inflict, and every stat bonus on top
      // of the base numbers below, comes from the player's own chosen
      // upgrades (see combat-progression.js) — a fresh, unleveled jab deals
      // plain damage with no afflictions at all.
      const effects = window.CombatProgression?.getEffects(deps.currentWeaponKey(), id) || { afflictions: {}, stats: {} };
      const requestedCost = COST_COMMIT * (1 + (effects.stats.staminaCostMul || 0)); // Pre-ResourceSystem cost; perks/alchemy may reduce the real spend below this.

      // Never refuses for lack of stamina — overspending pushes into
      // Exhausted instead of blocking the jab (see resource-system.js's
      // spendStamina); Exhausted's reduced speed then slows this jab's own
      // windup/strike down.
      const spendResult = window.ResourceSystem?.spendStamina(deps.player, requestedCost, def.label) || { spent: 0, excess: 0 };
      const actualCost = round1((Number(spendResult.spent) || 0) + (Number(spendResult.excess) || 0)); // Actual post-perk/alchemy resource commitment used to calculate the conditional refund.
      const timeScale = 1 / (window.ResourceSystem?.getExhaustionSpeed(deps.player) ?? 1);
      const windupS = WINDUP_S * timeScale;
      const strikeS = STRIKE_S * timeScale;
      const baseAbil = deps.weaponAbility('cut') || { damage: 14, rangePx: deps.TILE * 1.05, knockbackPxS: 360 };
      const rangePx = baseAbil.rangePx * def.rangeMul * RANGE_SCALE * (1 + (effects.stats.rangeMul || 0));
      const halfConeRad = def.halfConeDeg * Math.PI / 180;

      // All quick attacks are aimed jabs — mirror the shovel's straight thrust.
      deps.triggerWeaponSwingVisual(windupS + strikeS, {
        anim: 'thrust',
        windupFrac: windupS / (windupS + strikeS),
        strikeFrac: 1,
        holdS: HOLD_S,
        afflictionIds: Object.keys(effects.afflictions),
        afflictions: effects.afflictions,
        coneRangePx: rangePx,
        coneHalfConeRad: halfConeRad,
        coneAngle: deps.player.angle,
      });
      deps.beginCombatLunge(deps.TILE * LUNGE_TILE_MUL * (1 + (effects.stats.lungeMul || 0)), windupS + strikeS, 0, { rangePx, halfConeRad });

      busyAction = window.Combat.beginStagedAction({
        windupS,
        strikeS,
        recoverS: 0,
        onStrike: () => {
          const vegetationCleared = deps.clearVegetationInAttackCone?.(deps.player.x, deps.player.y, deps.player.angle, rangePx, halfConeRad) || 0; // Used for accurate hit feedback when the cone only cuts growth.
          let hits = 0, lastName = '', conditionalHits = 0, conditionalText = '';
          for (const c of deps.hostileObjects) {
            if (c.health <= 0 || c.areaId !== deps.getCurrentArea()) continue;
            if (!window.Combat.meleeHit(deps.player, c, {
              rangePx, halfConeRad,
              yaw: deps.player.angle,
              pitch: deps.getPlayerMeleeAimPitch?.() || 0,
            })) continue;

            // Resolve the conditional NOW, against the creature actually hit.
            // This is deliberately before damage so Mercy Spike reads the
            // target's pre-impact health and every other condition reads the
            // exact state/facing at contact.
            const hitConditions = getConditions(deps, c);
            const hitTech = buildTechnique(def, hitConditions);
            const conditionBonusUsed = hitTech.sourceText !== 'no condition bonus';
            const damage = Math.round(baseAbil.damage * hitTech.damageMul * (1 + (effects.stats.damageMul || 0)));
            const knockbackPxS = baseAbil.knockbackPxS * hitTech.knockbackMul;

            deps.damageCreature(c, damage, deps.player.x, deps.player.y, knockbackPxS, {
              tag: deps.currentWeaponDamageType(),
              category: 'quickAttack',
              consumeHealthVulnerability: conditionBonusUsed,
              afflictionBonuses: effects.afflictions,
            });
            deps.playWeaponHitSfx?.(deps.currentWeaponDamageType(), c.x, c.y, c.areaId, undefined, conditionBonusUsed ? 'huge' : 'small');
            hits++;
            lastName = c.def.label;
            if (conditionBonusUsed) {
              conditionalHits++;
              conditionalText ||= hitTech.sourceText;
            }
          }

          // One successful conditional is enough to earn one half-cost refund;
          // cleaving several qualifying creatures cannot multiply the refund.
          const refundRequested = conditionalHits > 0 ? actualCost * CONDITIONAL_REFUND_FRACTION : 0;
          const refunded = refundStamina(deps.player, refundRequested);
          const sourceText = conditionalHits > 0 ? conditionalText : 'no condition bonus';
          const refundText = refunded > 0 ? `; refunded ${refunded} stamina` : '';
          const msg = hits > 0
            ? `${def.label}: ${sourceText}${refundText} — hit ${hits > 1 ? hits + ' creatures' : 'the ' + lastName}!`
            : vegetationCleared > 0
              ? `${def.label}: cut ${vegetationCleared} vegetation tile${vegetationCleared === 1 ? '' : 's'} into mulch.`
            : `${def.label}: no condition bonus, but connects with nothing.`;
          // silent: same reasoning as combat-combo.js — every swing already
          // has its own weapon swing/impact sfx.
          deps.showToast(msg, hits > 0 || vegetationCleared > 0, true);
          if (hits > 0) deps.awardWeaponMasteryXp();

          // Mobile/headless-friendly latest-resolution snapshot. Existing
          // combat diagnostics can read this without needing browser devtools.
          window.Combat.quickAttackData.lastResolution = {
            id, name: def.label, hits, conditionalHits,
            requestedCost: round1(requestedCost), actualCost, refunded,
            lungeTiles: LUNGE_TILE_MUL,
            resolvedAt: now(),
          };
          deps.debugLog?.(`[quick-attack] ${def.label} hits=${hits} conditionalHits=${conditionalHits} cost=${actualCost} refund=${refunded} lungeTiles=${LUNGE_TILE_MUL}`, 'combat');
        },
        onComplete: () => { busyAction = null; },
        onCancel: () => { busyAction = null; },
      });
    }

    window.Combat.abilities.register(id, { label: def.label, slotFamily: 'tap', category: 'quickAttack', onTap });
  }

  for (const id of Object.keys(TECHNIQUES)) registerQuickAttack(id, TECHNIQUES[id]);

  // Read-only data export for game.js's bandit AI and diagnostics.
  window.Combat.quickAttackData = {
    TECHNIQUES, WINDUP_S, STRIKE_S, COST_COMMIT, CONDITIONAL_REFUND_FRACTION,
    RANGE_SCALE, LUNGE_TILE_MUL, HOLD_S, getConditions, refundStamina,
    lastResolution: null,
  };

  // Applies docs/config/combat/attack-values.json's `quickAttacks` section —
  // see combat-combo.js's applyComboConfig for the general pattern. TECHNIQUES
  // entries are mutated in place because every registered closure keeps the
  // same object reference.
  window.Combat.applyQuickAttackConfig = function (cfg) {
    if (!cfg) return;
    if (cfg.techniques) {
      for (const id of Object.keys(TECHNIQUES)) {
        const override = cfg.techniques[id];
        if (!override) continue;
        const target = TECHNIQUES[id];
        for (const k of Object.keys(target)) delete target[k];
        Object.assign(target, override);
      }
    }
    if (cfg.WINDUP_S != null) WINDUP_S = cfg.WINDUP_S;
    if (cfg.STRIKE_S != null) STRIKE_S = cfg.STRIKE_S;
    if (cfg.COST_COMMIT != null) COST_COMMIT = cfg.COST_COMMIT;
    if (cfg.CONDITIONAL_REFUND_FRACTION != null) CONDITIONAL_REFUND_FRACTION = cfg.CONDITIONAL_REFUND_FRACTION;
    if (cfg.HOLD_S != null) HOLD_S = cfg.HOLD_S;
    if (cfg.RANGE_SCALE != null) RANGE_SCALE = cfg.RANGE_SCALE;
    if (cfg.LUNGE_TILE_MUL != null) LUNGE_TILE_MUL = cfg.LUNGE_TILE_MUL;
    Object.assign(window.Combat.quickAttackData, {
      WINDUP_S, STRIKE_S, COST_COMMIT, CONDITIONAL_REFUND_FRACTION,
      RANGE_SCALE, LUNGE_TILE_MUL, HOLD_S, getConditions, refundStamina,
    });
  };
})();
