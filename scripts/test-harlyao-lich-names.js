// Regression checks for the shared Harlyao name culture and ordinary versus authored lich spawns.
// Run: node scripts/test-harlyao-lich-names.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..'); // Source root for running directly or from the CI working directory.
const read = file => fs.readFileSync(path.join(root, file), 'utf8'); // Tests the shipped runtime, not a copied generator.
const win = {}; // Browser namespace shared by the existing name-generation modules.
const context = vm.createContext({ window: win, console, performance: { now: () => 1000 } }); // Browser-like script harness without DOM or network access.
vm.runInContext(read('docs/config/scratchbones-config.js'), context, { filename: 'scratchbones-config.js' });
vm.runInContext(read('docs/js/scratchbones-name-generator.js'), context, { filename: 'scratchbones-name-generator.js' });

const generator = win.SCRATCHBONES_NAME_GENERATOR; // Shared public name API used in gameplay.
const cultureMap = win.SCRATCHBONES_CONFIG.game.nameGeneration; // Source of culture/species resolution rules.
assert.equal(cultureMap.aiCultureSelection.speciesToCultureId.harlyao, 'harlyao');
assert.equal(cultureMap.aiCultureSelection.speciesToCultureId['harlyao-skeleton'], 'harlyao');
const reserved = new Set(['nanahi', 'azgarlu', 'imlao']); // Named keystone guardians remain exclusive.
const seenGivenNames = new Set(); // Tracks personal-name variety without conflating it with surnames.
const seenFullNames = new Set(); // Tracks complete family-name combinations across deterministic seeds.
const harlyaoRules = cultureMap.cultures.harlyao.harlyaoRules; // One phonology config supplies separate first and last name parts.
assert(harlyaoRules.lastParts.includes('ai') && harlyaoRules.surnameLastParts.includes('ai'), 'both parts may end in ai');
assert(!harlyaoRules.lastParts.includes('o') && !harlyaoRules.surnameLastParts.includes('o'), 'do not add a bare o final ending');
let aiEndings = 0; // Both given names and surnames should reach the established ai ending.
for (let i = 0; i < 2500; i++) {
  const seed = 'harlyao-test-' + i; // Independent deterministic seed for a generated individual.
  const name = generator.generateIdentityFromSeed(seed, 'male', 'harlyao'); // A seeded Harlyao identity includes first and family names.
  const parts = name.split(' '); // Validate each Harlyao word separately, including its vowel boundaries.
  assert.equal(parts.length, 2, 'Harlyao identities need exactly one given name and one surname');
  assert.notEqual(parts[0], parts[1], 'a family name should differ from its owner\'s given name');
  for (const part of parts) {
    assert.match(part, /^[A-Z][a-z]{4,11}$/);
    assert(!reserved.has(part.toLowerCase()), part + ' must not duplicate an authored lich');
    assert.doesNotMatch(part.toLowerCase(), /(?!ao|ai$)[aeiou]{2}/, 'only established ao and terminal ai vowel pairs are permitted');
    if (part.endsWith('ai')) aiEndings++;
  }
  assert.equal(generator.generateIdentityFromSeed(seed, 'female', 'harlyao'), name, 'Harlyao names currently have no gender suffix rule');
  seenGivenNames.add(parts[0]);
  seenFullNames.add(name);
}
assert(seenGivenNames.size > 1100, 'Harlyao given names should preserve their existing variety');
assert(seenFullNames.size > 2400, 'independent family names should diversify complete identities');
assert(aiEndings > 100, 'the ai ending should remain common across both name parts');
assert.equal(generator.generateHarlyaoName(() => 0), 'Narkalu', 'a pathological fixed RNG cannot lock in an authored identity');
assert.equal(generator.generateHarlyaoSurname(() => 0, 'Narkalu'), 'Garnagar', 'family-name generation stays finite with a fixed RNG');
const boundaryRolls = [12.1 / 28, .1, 0, 14.1 / 25, 0]; // Forces dran + na + ur, selecting n as the bridge consonant.
assert.equal(generator.generateHarlyaoName(() => boundaryRolls.shift() ?? 0), 'Drannanur', 'a consonant must interrupt a vowel-vowel fragment boundary');

assert(generator.generateIdentityFromSeed('culture-regression', 'male', 'slagothim').includes(' '), 'existing living-species naming still works');

let randomState = 123456; // Repeatable live GameRandom stream for spawn assertions.
const random = () => { randomState = (Math.imul(1664525, randomState) + 1013904223) >>> 0; return randomState / 4294967296; };
const hostiles = new Set(); // Real lich combat consults active opponents when avoiding duplicate names.
const calls = []; // Captures the shared humanoid-constructor options passed by the lich module.
win.GameRandom = { random };
win.BanditCombat = {
  init() {}, updateCombatAI() {},
  async loadGangConfig() { return {}; },
  async makeEntity(...args) {
    calls.push(args);
    return {
      id: 'lich-' + calls.length, name: args[5].nameOverride, areaId: 'map_dev_arena',
      health: 100, enemyClass: args[5].enemyClass, isHarlyaoLich: true,
      lichType: args[5].extra.lichType, groundLift: .5,
      avatarRef: { modelHeight: .9, legs: { setHoverMode() {} } }, scene: { add() {} },
    };
  },
};
win.RangedWeapons = { update() {} };
win.Combat = { getMovementSpeedMul() { return 1; } };
win.SpecialHarlyaoLiches = {
  defFor(type) { return { name: { hronal: 'Azgarlu of the Flame', tothal: 'Nanahi the Unsleeping', kanthic: 'Imlao the Sightless' }[type] }; },
  specialRoster() { return { name: 'authored', appearance: { speciesId: 'harlyao-skeleton', gender: 'male' }, lichDyeId: 'dye:CLOTH:pure_blue' }; },
  init() {},
};
vm.runInContext(read('docs/js/combat/combat-lich.js'), context, { filename: 'combat-lich.js' });
win.BanditCombat.init({ getCurrentArea: () => 'map_dev_arena', hostileObjects: hostiles, TILE: 64 });

(async () => {
  const a = await win.HarlyaoLichCombat.makeEntity({ type: 'hronal', x: 10, y: 10 }); // Ordinary named Hronal actor.
  assert(a && a.name && a.name !== 'Hronal Lich' && !reserved.has(a.name.toLowerCase()));
  assert.match(a.name, /^[A-Z][a-z]{4,11} [A-Z][a-z]{4,11}$/, 'overhead label includes given name and surname, with no planar title');
  assert.equal(a.name, a.lichGivenName + ' ' + a.lichSurname, 'surname is tracked separately from the generated given name');
  assert.equal(a.lichEpithet, undefined, 'ordinary liches must not carry outdated planar epithets');
  hostiles.add(a);
  const b = await win.HarlyaoLichCombat.makeEntity({ type: 'hronal', x: 20, y: 10 }); // Another actor must check the active name pool.
  assert.notEqual(a.lichGivenName, b.lichGivenName, 'concurrent ordinary liches should not share their personal name');
  hostiles.add(b);
  for (const type of ['tothal', 'kanthic']) {
    const ordinary = await win.HarlyaoLichCombat.makeEntity({ type, x: 25, y: 20 }); // All traditions share the same Harlyao family-name culture.
    assert.match(ordinary.name, /^[A-Z][a-z]{4,11} [A-Z][a-z]{4,11}$/, type + ' overhead name format');
    assert.equal(ordinary.name, ordinary.lichGivenName + ' ' + ordinary.lichSurname, type + ' keeps both identity fields');
    assert(!/ the | of the /i.test(ordinary.name), 'planar epithets belong only to the authored guardians');
    hostiles.add(ordinary);
  }
  const roster = { name: 'My Authored Lich', appearance: { speciesId: 'harlyao-skeleton', gender: 'male' }, lichDyeId: 'dye:CLOTH:pure_blue' }; // Explicit external editor roster must keep its identity.
  const custom = await win.HarlyaoLichCombat.makeEntity({ type: 'kanthic', x: 20, y: 30, roster });
  assert.equal(custom.name, 'My Authored Lich');
  const special = await win.HarlyaoLichCombat.makeEntity({ type: 'tothal', x: 10, y: 30, special: true });
  assert.equal(special.name, 'Nanahi the Unsleeping');
  assert.equal(win.HarlyaoLichCombat.debugSnapshot().activeLiches[0].name, a.name, 'existing mobile debug snapshots expose real lich names');
  assert.equal(win.HarlyaoLichCombat.debugSnapshot().activeLiches[0].givenName, a.lichGivenName, 'mobile diagnostics preserve the given name');
  assert.equal(win.HarlyaoLichCombat.debugSnapshot().activeLiches[0].surname, a.lichSurname, 'mobile diagnostics preserve the surname');
  assert.match(win.HarlyaoLichCombat.formatDebug(), /names=/, 'mobile text diagnostics show actual generated names');
  const index = read('docs/index.html'); // Page script loading must include the generator before game.js.
  assert(index.indexOf('js/scratchbones-name-generator.js?v=') >= 0);
  assert(index.indexOf('js/scratchbones-name-generator.js?v=') < index.indexOf('game.js?v='));
  console.log('Harlyao lich names: two-part family identities, terminal ai, authored epithets and mobile diagnostics passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
