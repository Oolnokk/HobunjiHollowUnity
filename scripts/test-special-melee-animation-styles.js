const assert = require('node:assert/strict'); // Verifies runtime style resolution and editor pairing without needing a browser.
const fs = require('node:fs'); // Loads the production modules and authoring surface under test.
const vm = require('node:vm'); // Evaluates the shared resolver in a minimal Combat harness.

const read = path => fs.readFileSync(path, 'utf8');
const comboSource = read('docs/js/combat/combat-combo.js');
const quickSource = read('docs/js/combat/combat-quickattacks.js');
const chargedSource = read('docs/js/combat/combat-charged-breaker.js');
const flurrySource = read('docs/js/combat/combat-flurry.js');
const counterSource = read('docs/js/combat/combat-counter-shield.js');
const banditSource = read('docs/js/combat/combat-bandit.js');
const editorSource = read('docs/tools/attack-animation-editor/index.html');

const windowObject = {
  Combat: {
    abilities: { register() {} },
  },
};
vm.runInNewContext(comboSource, {
  window: windowObject,
  performance: { now: () => 0 },
  console,
}, { filename: 'combat-combo.js' });

const resolveVisual = windowObject.Combat.currentWeaponMeleeAnimation;
assert.equal(typeof resolveVisual, 'function', 'combo module must publish the shared special-melee animation resolver');

const thrust = resolveVisual({
  currentComboAbilityId: () => 'pokeCombo',
  currentWeaponKey: () => 'pickshovel_test',
}, 'opportunistJab');
assert.equal(thrust.anim, 'thrust', 'poke-family weapons must select the thrust special-attack animation');
assert.equal(thrust.pose, null, 'thrust keeps the existing thrust renderer instead of borrowing the sweep pose');

const slash = resolveVisual({
  currentComboAbilityId: () => 'swingCombo',
  currentWeaponKey: () => 'hatchet_test',
}, 'chargedBreaker');
assert.equal(slash.anim, 'sweep', 'swing-family weapons must select the slash/sweep special-attack animation');
assert.ok(slash.pose && slash.pose.windup && slash.pose.strike, 'slash/sweep special attacks must carry the authored sweep pose');

assert.deepEqual(
  Array.from(Object.keys(windowObject.Combat.specialMeleeAnimationDebug.lastResolved)).sort(),
  ['abilityId', 'anim', 'comboId', 'resolvedAt', 'weaponKey'].sort(),
  'mobile diagnostics must expose the most recent special-attack animation decision',
);

assert.match(quickSource, /currentWeaponMeleeAnimation\?\.\(deps, id\)/, 'Quick Attacks must resolve animation style from the equipped weapon');
assert.match(chargedSource, /currentWeaponMeleeAnimation\?\.\(deps, 'chargedBreaker'\)/, 'Charged Breaker must resolve animation style from the equipped weapon');
assert.match(flurrySource, /currentWeaponMeleeAnimation\?\.\(deps, 'acceleratingFlurry'\)/, 'Accelerating Flurry must resolve animation style from the equipped weapon');
assert.match(counterSource, /currentWeaponMeleeAnimation\?\.\(deps, 'counterShield'\)/, 'Counter Shield riposte must resolve animation style from the equipped weapon');
assert.match(banditSource, /function banditSpecialMeleeAnimation\(def, loadout = def\?\.banditAbilityLoadout\)[\s\S]*comboId === 'pokeCombo'/, 'bandit special attacks must resolve from their ordinary combo family, not idle render style');
assert.ok((banditSource.match(/const attackVisual = banditSpecialMeleeAnimation\(def(?:, loadout)?\)/g) || []).length >= 2, 'bandit Quick Attack and Charged Breaker must both use the shared special-animation resolver');

for (const id of [
  'quick_opportunist', 'quick_opportunist_slash',
  'quick_exhaust', 'quick_exhaust_slash',
  'quick_backstab', 'quick_backstab_slash',
  'quick_mercy', 'quick_mercy_slash',
  'charged_breaker', 'charged_breaker_thrust',
  'flurry', 'flurry_thrust',
  'counter_shield_riposte_thrust', 'counter_shield_riposte_slash',
]) {
  assert.ok(editorSource.includes(`id: '${id}'`), `Attack Animation Editor must expose ${id}`);
}
assert.match(editorSource, /id: 'counter_shield'[^\n]*Counter Shield — Guard[^\n]*heldAnimationKey: 'counterShield'/, 'Counter Shield guard remains a separate shared hold pose');
assert.match(editorSource, /action\.id\.startsWith\('charged_breaker'\)/, 'both Charged Breaker animation variants must preview real held timing');
assert.match(editorSource, /action\.id\.startsWith\('flurry'\)/, 'both Flurry animation variants must preview real strike timing');
assert.match(editorSource, /action\.id\.startsWith\('counter_shield_riposte_'\)/, 'both Counter Shield riposte variants must preview real counter timing');

console.log('special melee animation style tests passed');
