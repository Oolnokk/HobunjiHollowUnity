#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Validates the authored combat balance anchors.
const fs = require('node:fs'); // Reads the production tuning and runtime constants used by the balance math.

const attackValues = JSON.parse(fs.readFileSync('docs/config/combat/attack-values.json', 'utf8')); // Attack tuning used for combo, Death Mark, Breaker, and Flurry calculations.
const banditConfig = JSON.parse(fs.readFileSync('docs/config/bandits/bandit-gang-config.json', 'utf8')); // Tier-0 rank multipliers used for the requested kill thresholds.
const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Source of the shared metal-tier damage scalar and Native Copper tier.
const banditSource = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8'); // Source of the shared bandit base-health constant.
const scratchConfigSource = fs.readFileSync('docs/config/scratchbones-config.js', 'utf8'); // Source of Sharp/Blunt Health/Footing multipliers and shared Footing conversion.
const footingBridgeSource = fs.readFileSync('docs/js/footing-damage-recovery-bridge.js', 'utf8'); // Source of the final shared Footing multiplier applied by ResourceSystem.

const nativeCopperTierMatch = gameSource.match(/nativeCopper:\s*\{[^}]*tier:\s*(\d+)/); // Extracts the live Native Copper tier instead of duplicating it in the test.
assert(nativeCopperTierMatch, 'Native Copper tier must remain discoverable in game.js');
const nativeCopperTier = Number(nativeCopperTierMatch[1]); // Still used to verify the original ungraded-save fallback calculation.
const reinforcementSource = fs.readFileSync('docs/js/metal-reinforcement.js', 'utf8'); // The current grade-I power now comes from the shared smith policy.
const startingPowerMatch = reinforcementSource.match(/const MIN_REINFORCEMENT_POWER = ([0-9.]+)/); // Pins actual new-character Copper-I power without guessing a material-only tier.
assert(startingPowerMatch, 'the smith policy must expose its starting power');
assert.match(gameSource, /return tier \? 0\.85 \+ tier \* 0\.05 : 1/, 'metal damage scaling changed; update this balance calibration intentionally if the material curve changes');
const nativeCopperMultiplier = Number(startingPowerMatch[1]); // New players receive an explicit grade-0 reinforcement, overriding old ungraded-save metal scaling.
assert.equal(0.85 + nativeCopperTier * 0.05, 0.90, 'ungraded saved copper still preserves its legacy strength');

const baseHealthMatch = banditSource.match(/const BANDIT_BASE_MAX_HEALTH = (\d+(?:\.\d+)?)/); // Extracts the combat runtime's unscaled bandit-health baseline.
assert(baseHealthMatch, 'bandit base health must remain discoverable in combat-bandit.js');
const banditBaseHealth = Number(baseHealthMatch[1]); // Used with rank/tier curves to derive actual tier-0 HP.
const tier0GruntHealth = Math.round(banditBaseHealth * banditConfig.healthMultiplierByRankAndTier.grunt[0]); // Health-only tier-0 grunt target; attack/stamina still use the original stat curve.
const tier0LieutenantHealth = Math.round(banditBaseHealth * banditConfig.healthMultiplierByRankAndTier.lieutenant[0]); // Health-only tier-0 Lieutenant target.
const tier0FlaskerHealth = Math.round(banditBaseHealth * banditConfig.healthMultiplierByRankAndTier.flasker[0]); // Flasker durability is independent of its attack/Stamina curve.

const nativeCopperCutDamage = attackValues.weaponAbilities.cut.damage * nativeCopperMultiplier; // Shared melee base that Charged Breaker and Flurry scale from.
const breaker = attackValues.chargedBreaker; // Short alias used throughout the Breaker calibration assertions.
const fullBreakerDamage = Math.round(nativeCopperCutDamage * breaker.DAMAGE_MUL_MAX); // Native Copper damage of a fully charged, unmarked Breaker.
const deathMarks = attackValues.deathMark.multiplierByStacksConsumed; // Heavy-attack multipliers granted by one through three combo finishers.

function damageTypeMultipliers(type) {
  const pattern = new RegExp(`"${type}"\\s*:\\s*\\{\\s*"healthDamage"\\s*:\\s*([0-9.]+),\\s*"footingDamage"\\s*:\\s*([0-9.]+),\\s*"knockback"\\s*:\\s*([0-9.]+)\\s*\\}`); // Reads all three independently tuned hit channels without executing the browser config.
  const match = scratchConfigSource.match(pattern); // Used below to keep this calibration tied to production Sharp/Blunt tuning.
  assert(match, `${type} damage multipliers must remain discoverable in scratchbones-config.js`);
  return { health: Number(match[1]), footing: Number(match[2]), knockback: Number(match[3]) };
}

const sharpType = damageTypeMultipliers('sharp'); // Used to validate Sharp's direct-damage bias and heavy-attack breakpoints.
const bluntType = damageTypeMultipliers('blunt'); // Used to validate Blunt's Footing bias and heavy-attack breakpoints.
const footingLossMatch = scratchConfigSource.match(/"footingLossPerDamage"\s*:\s*([0-9.]+)/); // Used to derive actual direct-hit Footing loss from raw attack damage.
const footingBridgeMatch = footingBridgeSource.match(/FOOTING_DAMAGE_MULTIPLIER\s*=\s*([0-9.]+)/); // Used to include the runtime-wide Footing bridge in type comparisons.
assert(footingLossMatch && footingBridgeMatch, 'shared Footing conversion multipliers must remain discoverable');
const footingLossPerDamage = Number(footingLossMatch[1]); // Multiplies the type-specific Footing channel inside applyHitStagger.
const footingBridgeMultiplier = Number(footingBridgeMatch[1]); // Multiplies every ResourceSystem.spendFooting request at runtime.
const sharpFootingPerRawDamage = sharpType.footing * footingLossPerDamage * footingBridgeMultiplier; // Actual Footing removed by one raw Sharp damage before buffs/resistance.
const bluntFootingPerRawDamage = bluntType.footing * footingLossPerDamage * footingBridgeMultiplier; // Actual Footing removed by one raw Blunt damage before buffs/resistance.

assert.equal(nativeCopperMultiplier, 0.75, 'new Copper-I starting gear uses the wider 0.75x progression');
assert.equal(tier0GruntHealth, 30, 'tier-0 grunt gets enough Health to survive a basic starting combo');
assert.equal(tier0LieutenantHealth, 50, 'tier-0 lieutenant is tougher than a grunt without increased offensive stats');
assert.equal(tier0FlaskerHealth, 43, 'tier-0 flasker survives longer while retaining its ranged support role');
assert.equal(fullBreakerDamage, 11, 'new grade-I Copper full Charged Breaker has an 11-damage heavy baseline');
assert.deepEqual(sharpType, { health: 1.1, footing: 0.8, knockback: 1 }, 'Sharp keeps its existing Health, Footing, and knockback strengths');
assert.deepEqual(bluntType, { health: 0.5, footing: 1.25, knockback: 1.25 }, 'Blunt preserves half Health but increases Footing and knockback to 125%');
assert(Math.abs(sharpFootingPerRawDamage - 2.56) < 1e-9, 'Sharp should remove 2.56 Footing per raw damage after shared scaling');
assert(Math.abs(bluntFootingPerRawDamage - 4) < 1e-9, 'Blunt should remove 4 Footing per raw damage after shared scaling');
assert(Math.abs(bluntFootingPerRawDamage / sharpFootingPerRawDamage - 1.5625) < 1e-9, 'Blunt should apply 56.25% more Footing pressure than Sharp');
assert(fullBreakerDamage * sharpType.health < tier0GruntHealth, 'Starter Sharp unmarked Breaker must not one-shot a tier-0 grunt');
assert(fullBreakerDamage * deathMarks[0] * sharpType.health < tier0GruntHealth, 'Starter Sharp one-mark Breaker should not erase the grunt before follow-up tactics');
assert(fullBreakerDamage * deathMarks[2] * sharpType.health >= tier0GruntHealth, 'Three earned Death Marks still create a decisive Sharp power hit against a grunt');
assert(fullBreakerDamage * deathMarks[2] * sharpType.health < tier0LieutenantHealth, 'Lieutenants survive even the strongest starter Sharp mark-consumption hit');
const maxMarkedBluntHealth = fullBreakerDamage * deathMarks[2] * bluntType.health; // Ensures even a fully marked blunt breaker leaves ordinary foes alive for Footing/terrain tactics.
assert(maxMarkedBluntHealth < tier0GruntHealth, 'Blunt three-mark Charged Breaker should not erase tier-0 grunts before knockback/Footing can matter');
assert.equal(bluntType.footing, 1.25, 'Blunt Footing is increased to 125% of the baseline');
assert.equal(bluntType.knockback, 1.25, 'Blunt knockback is increased to 125% of the baseline');
assert.match(gameSource, /applyKnockback\(c, fromX, fromY, knockbackPxS \* impactMultiplier \* \(resourceDamage.knockbackMultiplier \?\? 1\), popupCredit\)/, 'Creatures must receive the new configured impulse multiplier once');
assert.match(gameSource, /applyKnockback\(player, fromX, fromY, knockbackPxS \* \(resourceDamage.knockbackMultiplier \?\? 1\)\)/, 'The player must receive the same configured impulse multiplier once');
assert.match(gameSource, /environmentalImpact \? \{ health: amount, footing: 0 \} : hitResourceDamage\(amount, dmgOpts\)/, 'Environmental collisions and falls must bypass the direct-blunt Health reduction');

const hitResourceFunctionSource = gameSource.match(/function hitResourceDamage\(amount, dmgOpts\) \{[\s\S]*?\n      \}/)?.[0]; // Extracts the production hit-channel calculation for direct execution below.
assert(hitResourceFunctionSource, 'Shared hit resource function must stay discoverable in game.js');
const runtimeTypeMultipliers = Object.fromEntries(Object.entries({ sharp: sharpType, blunt: bluntType }).map(([type, tuning]) => [type, { healthDamage: tuning.health, footingDamage: tuning.footing, knockback: tuning.knockback }])); // Mirrors the tested config into the production helper's minimal window dependency.
const productionHitResourceDamage = new Function('window', `${hitResourceFunctionSource}\nreturn hitResourceDamage;`)({ SCRATCHBONES_CONFIG: { game: { combat: { stagger: { damageTypeMultipliers: runtimeTypeMultipliers } } } } }); // Executes the exact production helper for per-channel regression tests.
assert.deepEqual(productionHitResourceDamage(8, { tag: 'blunt' }), { health: 4, footing: 10, knockbackMultiplier: 1.25 }, 'A blunt hit must halve direct Health without halving Footing or impulse');
assert.deepEqual(productionHitResourceDamage(8, { tag: 'sharp' }), { health: 8.8, footing: 6.4, knockbackMultiplier: 1 }, 'Sharp stays unchanged in all hit channels');
assert.deepEqual(productionHitResourceDamage(8, { tag: 'blunt', footingDamageMultiplier: 0 }), { health: 4, footing: 0, knockbackMultiplier: 1.25 }, 'Projectile Footing override must not disable knockback');
assert.deepEqual(productionHitResourceDamage(8, { tag: 'poison' }), { health: 8, footing: 8, knockbackMultiplier: 1 }, 'Unconfigured damage types retain neutral multipliers');

const swingComboCost = attackValues.combo.swingCombo.reduce((sum, step) => sum + step.staminaCost, 0); // Full three-hit sweep combo cost before perks/buffs.
const pokeComboCost = attackValues.combo.pokeCombo.reduce((sum, step) => sum + step.staminaCost, 0); // Full thrust combo is the new heavy-charge balance anchor.
const fullBreakerCost = breaker.COST_MAX; // One cumulative full-pose price, independent of time held.
const standardStaminaBar = 100; // Ordinary player combat budget used by existing resource-system balance fixtures.
assert.equal(fullBreakerCost, 54, 'full Charged Breaker should cost 54 Stamina at authored maximum charge');
assert.equal(fullBreakerCost, pokeComboCost, 'full Charged Breaker should cost exactly one completed thrust combo');
assert(fullBreakerCost < swingComboCost, 'full Charged Breaker remains slightly cheaper than a completed sweep combo');
assert.equal('CHARGE_DRAIN_PER_S' in breaker, false, 'obsolete time-drain setting must not reappear');
assert(swingComboCost + fullBreakerCost > standardStaminaBar, 'full sweep combo and full Charged Breaker must exceed an untouched Stamina bar');

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
