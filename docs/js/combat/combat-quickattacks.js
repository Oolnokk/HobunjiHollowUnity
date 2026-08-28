// Combat quick attacks — the weapon tool's tap-slot conditional techniques,
// ported from the sandbox's triggerQuickAttack()/getQuickConditions(). Each
// technique registers under the 'tap' slot family (same family as the 3-step
// combo in combat-combo.js) so any one of them can occupy tap1 or tap2.
//
// The sandbox evaluates its conditions against a single fixed "dummy"
// target; this game has many hostiles at once, so conditions are evaluated
// against deps.findAutoTarget() (the nearest live hostile within lock-on
// range) while the actual strike still hits every creature in the swing's
// cone, matching combat-combo.js's hit-resolution precedent.
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

  // Mirrors the sandbox's getQuickConditions(), evaluated against the
  // player's current auto-target rather than a fixed dummy. This is exported
  // below so attack execution and every readiness cue use exactly one source
  // of truth instead of duplicating state thresholds in UI code.
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
  // `quickAttacks.techniques` section can override them wholesale —
  // buildTechnique below is the one shared "build" function every technique
  // used to duplicate as its own bespoke build(deps, target, cond).
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

  // technique(cond) -> { name, damageMul, halfConeDeg, rangeMul, knockbackMul, sourceText }
  // `deps`/`target` are no longer needed by the builder itself (only by
  // getConditions, above) — kept as the exported function's shape isn't
  // part of this change, just what used to happen inside each bespoke
  // build(). game.js's bandit AI calls this the same way it used to call
  // TECHNIQUES[id].build(...).
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
  let COST_BASE = 11;
  let COST_BONUS = 18;
  let HOLD_S = 1; // post-strike pause before easing back to neutral
  // The jab's hit cone (scaled off the shared 'cut' ability's rangePx —
  // see baseAbil below) read as oversized in practice; shrink it here
  // rather than touching 'cut' itself, since flurry/charged breaker/
  // counter-shield all scale off that same shared base and weren't
  // reported as too big.
  let RANGE_SCALE = 0.6;
  // Farther forward step than the 3-hit combo's, layered under the jab —
  // see game.js's beginCombatLunge. Expressed as a TILE multiple. Stops
  // early once a hostile enters this jab's own hit cone (see the
  // beginCombatLunge call below), so a longer reach here just means less
  // whiffed closing distance rather than overshooting past the target.
  // Originally 2.2; a 5x pass (11.0) proved too far, halved down to 5.5.
  let LUNGE_TILE_MUL = 5.5;

  function registerQuickAttack(id, def) {
    let busyAction = null;

    function onTap() {
      if (busyAction) return; // previous strike's windup/strike hasn't resolved yet
      const deps = window.Combat.deps;
      // Footing/impact stagger lockout — see combat-combo.js's matching guard.
      if (window.Combat.isStaggered(deps.player)) return;
      const target = deps.findAutoTarget();
      const cond = getConditions(deps, target);
      const tech = buildTechnique(def, cond);
      const cost = tech.sourceText === 'no condition bonus' ? COST_BASE : COST_BONUS;

      // Every affliction this jab can inflict, and every stat bonus on top
      // of the base numbers below, comes from the player's own chosen
      // upgrades (see combat-progression.js) — a fresh, unleveled jab deals
      // plain damage with no afflictions at all.
      const effects = window.CombatProgression?.getEffects(deps.currentWeaponKey(), id) || { afflictions: {}, stats: {} };
      // Sharp/blunt comes from whichever tool occupies the weapon slot (see
      // combat-combo.js's matching comment) -- every technique here used to
      // hardcode 'sharp' regardless of the equipped weapon's own dmgType.

      // Never refuses for lack of stamina — overspending pushes into
      // Exhausted instead of blocking the jab (see resource-system.js's
      // spendStamina); Exhausted's reduced speed then slows this jab's own
      // windup/strike down, same as the source demo's cooldown-slowing rule.
      window.ResourceSystem?.spendStamina(deps.player, cost * (1 + (effects.stats.staminaCostMul || 0)), tech.name);
      const timeScale = 1 / (window.ResourceSystem?.getExhaustionSpeed(deps.player) ?? 1);
      const windupS = WINDUP_S * timeScale;
      const strikeS = STRIKE_S * timeScale;
      const baseAbil = deps.weaponAbility('cut') || { damage: 14, rangePx: deps.TILE * 1.05, knockbackPxS: 360 };
      const damage = Math.round(baseAbil.damage * tech.damageMul * (1 + (effects.stats.damageMul || 0)));
      const rangePx = baseAbil.rangePx * tech.rangeMul * RANGE_SCALE * (1 + (effects.stats.rangeMul || 0));
      const halfConeRad = tech.halfConeDeg * Math.PI / 180;
      const knockbackPxS = baseAbil.knockbackPxS * tech.knockbackMul;

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
          let hits = 0, lastName = '';
          for (const c of deps.hostileObjects) {
            if (c.health <= 0 || c.areaId !== deps.getCurrentArea()) continue;
            if (!window.Combat.meleeHit(deps.player, c, {
              rangePx, halfConeRad,
              yaw: deps.player.angle,
              pitch: deps.getPlayerMeleeAimPitch?.() || 0,
            })) continue;
            deps.damageCreature(c, damage, deps.player.x, deps.player.y, knockbackPxS, { tag: deps.currentWeaponDamageType(), category: 'quickAttack', afflictionBonuses: effects.afflictions });
            deps.playWeaponHitSfx?.(deps.currentWeaponDamageType(), c.x, c.y, c.areaId);
            hits++;
            lastName = c.def.label;
          }
          const msg = hits > 0
            ? `${tech.name}: ${tech.sourceText} — hit ${hits > 1 ? hits + ' creatures' : 'the ' + lastName}!`
            : vegetationCleared > 0
              ? `${tech.name}: cut ${vegetationCleared} vegetation tile${vegetationCleared === 1 ? '' : 's'} into mulch.`
            : `${tech.name}: ${tech.sourceText}, but connects with nothing.`;
          // silent: same reasoning as combat-combo.js — every swing already
          // has its own weaponSlash/creatureClawHit sfx.
          deps.showToast(msg, hits > 0 || vegetationCleared > 0, true);
          if (hits > 0) deps.awardWeaponMasteryXp();
        },
        onComplete: () => { busyAction = null; },
        onCancel: () => { busyAction = null; },
      });
    }

    window.Combat.abilities.register(id, { label: def.label, slotFamily: 'tap', category: 'quickAttack', onTap });
  }

  for (const id of Object.keys(TECHNIQUES)) registerQuickAttack(id, TECHNIQUES[id]);

  // Read-only data export for game.js's bandit AI — see combat-combo.js's
  // matching comment. exhaustCutter/backstabFlick/mercySpike's build(deps,
  // target, cond) never actually reads `deps` (only `cond`), so a bandit can
  // call build(null, player, banditCond) directly with its own condition
  // check (player exhausted/behind/low-health from the bandit's point of
  // view) and get the exact same damage/range/knockback numbers a player
  // jab would. opportunistJab is excluded from the bandit pool — its bonus
  // depends on enemy strike-state data, which only creatures expose today.
  window.Combat.quickAttackData = { TECHNIQUES, WINDUP_S, STRIKE_S, RANGE_SCALE, LUNGE_TILE_MUL, HOLD_S, getConditions };

  // Applies docs/config/combat/attack-values.json's `quickAttacks` section —
  // see combat-combo.js's applyComboConfig for the general pattern. TECHNIQUES
  // entries are mutated in place (each is replaced wholesale via Object.assign
  // after clearing extra keys) since window.Combat.quickAttackData.TECHNIQUES
  // and every registerQuickAttack closure's `def` all hold the same object
  // references, not copies.
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
    if (cfg.COST_BASE != null) COST_BASE = cfg.COST_BASE;
    if (cfg.COST_BONUS != null) COST_BONUS = cfg.COST_BONUS;
    if (cfg.HOLD_S != null) HOLD_S = cfg.HOLD_S;
    if (cfg.RANGE_SCALE != null) RANGE_SCALE = cfg.RANGE_SCALE;
    if (cfg.LUNGE_TILE_MUL != null) LUNGE_TILE_MUL = cfg.LUNGE_TILE_MUL;
    Object.assign(window.Combat.quickAttackData, { WINDUP_S, STRIKE_S, RANGE_SCALE, LUNGE_TILE_MUL, HOLD_S, getConditions });
  };
})();
