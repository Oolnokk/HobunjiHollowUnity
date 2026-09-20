#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Validates the authored combat balance anchors.
const fs = require('node:fs'); // Reads the production tuning and runtime constants used by the balance math.

const attackValues = JSON.parse(fs.readFileSync('docs/config/combat/attack-values.json', 'utf8')); // Attack tuning used for combo, Death Mark, Breaker, and Flurry calculations.
const banditConfig = JSON.parse(fs.readFileSync('docs/config/bandits/bandit-gang-config.json', 'utf8')); // Tier-0 rank multipliers used for the requested kill thresholds.
const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Source of the shared metal-tier damage scalar and Native Copper tier.
const banditSource = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8'); // Source of the shared bandit base-health constant.

const nativeCopperTierMatch = gameSource.match(/nativeCopper:\s*\{[^}]*tier:\s*(\d+)/); // Extracts the live Native Copper tier instead of duplicating it in the test.
assert(nativeCopperTierMatch, 'Native Copper tier must remain discoverable in game.js');
const nativeCopperTier = Number(nativeCopperTierMatch[1]); // Used to calculate the exact live material multiplier.
assert.match(gameSource, /return tier \? 0\.85 \+ tier \* 0\.05 : 1/, 'metal damage scaling changed; update this balance calibration intentionally if the material curve changes');
const nativeCopperMultiplier = 0.85 + nativeCopperTier * 0.05; // Mirrors metalDmgMultiplier after pinning its source expression above.

const baseHealthMatch = banditSource.match(/const BANDIT_BASE_MAX_HEALTH = (\d+(?:\.\d+)?)/); // Extracts the combat runtime's unscaled bandit-health baseline.
assert(baseHealthMatch, 'bandit base health must remain discoverable in combat-bandit.js');
const banditBaseHealth = Number(baseHealthMatch[1]); // Used with rank/tier curves to derive actual tier-0 HP.
const tier0GruntHealth = Math.round(banditBaseHealth * banditConfig.statMultiplierByRankAndTier.grunt[0]); // Requested ordinary tier-0 Bandit target.
const tier0LieutenantHealth = Math.round(banditBaseHealth * banditConfig.statMultiplierByRankAndTier.lieutenant[0]); // Requested tier-0 Lieutenant target.

const nativeCopperCutDamage = attackValues.weaponAbilities.cut.damage * nativeCopperMultiplier; // Shared melee base that Charged Breaker and Flurry scale from.
const breaker = attackValues.chargedBreaker; // Short alias used throughout the Breaker calibration assertions.
const fullBreakerDamage = Math.round(nativeCopperCutDamage * breaker.DAMAGE_MUL_MAX); // Native Copper damage of a fully charged, unmarked Breaker.
const deathMarks = attackValues.deathMark.multiplierByStacksConsumed; // Heavy-attack multipliers granted by one through three combo finishers.

assert.equal(nativeCopperMultiplier, 0.9, 'Native Copper is expected to remain the 0.90x starter material for this calibration');
assert.equal(tier0GruntHealth, 20, 'tier-0 grunt health changed; rebalance the one-mark breakpoint intentionally');
assert.equal(tier0LieutenantHealth, 36, 'tier-0 lieutenant health changed; rebalance the three-mark breakpoint intentionally');
assert.equal(fullBreakerDamage, 13, 'full Native Copper Charged Breaker should establish the 13-damage heavy baseline');
assert(fullBreakerDamage < tier0GruntHealth, 'unmarked Charged Breaker must not erase the value of earning the third combo hit');
assert(fullBreakerDamage * deathMarks[0] >= tier0GruntHealth, 'one Death Mark + full Native Copper Charged Breaker must one-shot a tier-0 grunt');
assert(fullBreakerDamage * deathMarks[1] < tier0LieutenantHealth, 'two Death Marks should not reach the tier-0 lieutenant one-shot reserved for three marks');
assert(fullBreakerDamage * deathMarks[2] >= tier0LieutenantHealth, 'three Death Marks + full Native Copper Charged Breaker must one-shot a tier-0 lieutenant');

const swingComboCost = attackValues.combo.swingCombo.reduce((sum, step) => sum + step.staminaCost, 0); // Full three-hit sweep combo cost before perks/buffs.
const fullBreakerCost = breaker.CHARGE_DRAIN_PER_S * breaker.MAX_CHARGE_S + breaker.COST_MAX; // Worst-case full-charge stamina spend from hold start through release.
const standardStaminaBar = 100; // Ordinary player combat budget used by existing resource-system balance fixtures.
assert.equal(fullBreakerCost, 34, 'full Charged Breaker should cost 34 stamina at authored maximum charge');
assert(swingComboCost + fullBreakerCost <= standardStaminaBar, 'full combo -> Death Mark -> full Charged Breaker should fit inside one standard stamina bar');

const swingFinisherDamage = Math.round(nativeCopperCutDamage * attackValues.combo.swingCombo[2].damageMul); // Direct damage of the mark-granting third sweep hit.
const oneMarkBreakerBonus = fullBreakerDamage * deathMarks[0] - fullBreakerDamage; // Extra heavy damage earned by successfully reaching the third combo hit.
assert(oneMarkBreakerBonus >= swingFinisherDamage, 'earning one Death Mark should add at least another finisher-like chunk of damage to the next heavy');

function flurryTotals(strikeCount) {
  let stamina = 0; // Cumulative escalating stamina spend returned for the requested held-flurry length.
  let damage = 0; // Cumulative Native Copper raw damage returned for the same strike count.
  for (let index = 0; index < strikeCount; index++) {
    stamina += attackValues.flurry.COST_BASE + index * attackValues.flurry.COST_PER_STRIKE;
    damage += Math.round(nativeCopperCutDamage * (attackValues.flurry.DAMAGE_MUL_BASE + index * attackValues.flurry.DAMAGE_MUL_PER_STRIKE));
  }
  return { stamina, damage };
}

const fourStrikeFlurry = flurryTotals(4); // Comparable short heavy sequence used against the one-impact Charged Breaker baseline.
const markedFlurryDamage = fourStrikeFlurry.damage * deathMarks[0]; // Same one-mark amplification Charged Breaker receives during its empowerment window.
const markedBreakerDamage = fullBreakerDamage * deathMarks[0]; // One-mark Breaker damage used as the reference heavy payoff.
const markedHeavyRatio = markedFlurryDamage / markedBreakerDamage; // Keeps short Flurry and Breaker near one another without making them identical.
assert(markedHeavyRatio >= 0.85 && markedHeavyRatio <= 1.15, 'a four-strike marked Flurry should stay within 15% of marked full Breaker damage');
assert(fourStrikeFlurry.stamina <= fullBreakerCost, 'the short Flurry comparison should not cost more stamina than full Breaker');

const nineStrikeFlurry = flurryTotals(9); // Long hold used to guard the intended rapidly escalating Flurry stamina curve.
assert.equal(nineStrikeFlurry.stamina, 99, 'Flurry must retain its steep cumulative stamina ramp instead of being flattened by the heavy rebalance');

console.log('combat stamina/power calibration tests passed');
