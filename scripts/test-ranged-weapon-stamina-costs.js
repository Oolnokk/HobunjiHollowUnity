const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const rangedSource = fs.readFileSync(path.resolve(__dirname, '../docs/js/combat/ranged-weapons.js'), 'utf8');
const archetypeSource = fs.readFileSync(path.resolve(__dirname, '../docs/js/combat/ranged-weapon-archetypes.js'), 'utf8');
const attackValues = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../docs/config/combat/attack-values.json'), 'utf8'));
const loaderSource = fs.readFileSync(path.resolve(__dirname, '../docs/js/combat/combat-config-loader.js'), 'utf8');
const indexSource = fs.readFileSync(path.resolve(__dirname, '../docs/index.html'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Expected ${name} in runtime source.`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unclosed function ${name}`);
}

const player = { maxStamina: 100, stamina: 100 }; // Player used to verify normalization against player-only Stamina discounts.
const loadCost = vm.runInNewContext(`(() => {
  const DEFAULT_RANGED_LOAD_STAMINA_FRACTION = 0.85;
  const deps = { player };
  const window = {
    AlchemySystem: { getStaminaSpendMultiplier: () => 0.8 },
    PerkSystem: { rank: () => 2 },
  };
  ${extractFunction(rangedSource, 'rangedLoadStaminaCost')}
  return rangedLoadStaminaCost;
})()`, { player });

const playerCost = loadCost(player, { loadStaminaFraction: 0.85 });
assert.ok(Math.abs(playerCost * 0.8 * 0.84 - 85) < 1e-9,
  'after the Alchemy multiplier and two ranks of Reduce Stamina Use, a full reload must still remove 85% of maximum Stamina');
assert.strictEqual(loadCost({ maxStamina: 100, stamina: 100 }, { loadStaminaFraction: 0.85 }), 85,
  'NPC reload cost must be 85% of authored maximum Stamina without player-only discounts');
assert.strictEqual(loadCost({ maxStamina: 100, stamina: 100 }, {}), 85,
  'missing per-weapon tuning must retain the safe 85% default');

const chargeCost = vm.runInNewContext(`(() => {
  const HELD_CHARGE_MIN_READY_POSE = 0.48;
  const HELD_CHARGE_COST_MIN = 12;
  const HELD_CHARGE_COST_MAX = 18;
  ${extractFunction(rangedSource, 'chargeStaminaCostForPose')}
  return chargeStaminaCostForPose;
})()`);
assert.strictEqual(chargeCost(0), 0, 'an untouched thrown hold costs no Stamina');
assert.strictEqual(chargeCost(0.48), 12, 'the first releasable thrown pose costs the same 12 Stamina as Charged Breaker');
assert.ok(Math.abs(chargeCost(0.74) - 15) < 1e-9, 'intermediate thrown charge pays the same linear post-ready cost segment as Charged Breaker');
assert.strictEqual(chargeCost(1), 18, 'full thrown charge costs the same 18 Stamina as Charged Breaker');

assert.strictEqual(attackValues.rangedWeapons.crossbow.loadStaminaFraction, 0.85);
assert.strictEqual(attackValues.rangedWeapons.scatterbow.loadStaminaFraction, 0.85);
assert.match(rangedSource, /if \(kind === 'load'\) \{\s*spendRangedLoadStamina\(deps\.player, itemKey, def\);\s*setRangedLoadRegenBlocked\(deps\.player, true\);/,
  'player reload must spend the load cost immediately and keep regeneration blocked while the reload animation runs');
assert.match(rangedSource, /if \(cancelled\?\.kind === 'load'\) setRangedLoadRegenBlocked\(deps\?\.player, false\)/,
  'cancelling a reload must release its Stamina-regeneration blocker');
assert.match(rangedSource, /setLoaded\(action\.itemKey, true\);\s*setRangedLoadRegenBlocked\(deps\?\.player, false\)/,
  'completing a reload must release its Stamina-regeneration blocker');
assert.match(rangedSource, /kind === 'fire' && def\.rangedType !== 'thrown'/,
  'thrown releases must not pay the ordinary one-shot ranged fire surcharge on top of their held charge cost');
assert.match(rangedSource, /spendRangedLoadStamina\(c, itemKey, def\);\s*setRangedLoadRegenBlocked\(c, true\)/,
  'NPC ranged reloads must pay the same load cost and keep regeneration blocked during the reload');
assert.match(rangedSource, /action\.kind === 'fire' && action\.chargeDurationS > 0[\s\S]*chargeStaminaCostForPose\(chargePose\)[\s\S]*abilityId: 'thrownWeapon'/,
  'NPC thrown windups must use the same cumulative pose-based held-charge payment');
assert.match(archetypeSource, /function updateThrownChargeStamina\(\)[\s\S]*payThrownChargeStamina\(charge,[\s\S]*Thrown weapon charge \(holding\)/,
  'player thrown holds must spend stamina progressively while the input remains held');
assert.match(archetypeSource, /const result = baseUpdate\(dt\);\s*updateThrownChargeStamina\(\);/,
  'the held charge payment must tick through the normal ranged update loop');
assert.match(archetypeSource, /payThrownChargeStamina\(charge, poseCharge, 'Thrown weapon charge \(release\)'\)/,
  'release must settle any final unprocessed pose delta exactly once');
assert.match(archetypeSource, /actionKind: 'offensiveHeldCharge', abilityId: 'thrownWeapon'/,
  'thrown charge spending must use the same offensive-held-charge resource transaction category as Charged Breaker');
assert.match(loaderSource, /ranged-weapon-archetypes\.js\?v=20261102rangedStamina1', \(\) => Number\(window\.HobunjiRangedWeaponArchetypes\?\.version\) >= 17/,
  'the loader must request the new archetype implementation version');
assert.match(indexSource, /ranged-weapons\.js\?v=20261102rangedStamina1/);
assert.match(indexSource, /combat-config-loader\.js\?v=20261102rangedStamina1/);

console.log('Ranged weapon stamina cost regressions passed.');
