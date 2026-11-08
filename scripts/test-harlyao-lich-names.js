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
const seen = new Set(); // Tracks generated variety across seeds.
const harlyaoParts = cultureMap.cultures.harlyao.harlyaoRules.lastParts; // Final endings are configurable independently of planar epithets.
assert(harlyaoParts.includes('ai'), 'Harlyao may end in ai');
assert(!harlyaoParts.includes('o'), 'do not add a bare o final ending');
let aiEndings = 0; // Seeded samples must actually reach the ai ending rather than only declaring it.

for (let i = 0; i < 2500; i++) {
  const seed = 'harlyao-test-' + i; // Independent deterministic seed for a generated individual.
  const name = generator.generateIdentityFromSeed(seed, 'male', 'harlyao'); // Culture identity is a single given name.
  assert.match(name, /^[A-Z][a-z]{4,11}$/);
  assert(!reserved.has(name.toLowerCase()), name + ' must not duplicate an authored lich');
  assert.doesNotMatch(name.toLowerCase(), /(?!ao|ai$)[aeiou]{2}/, 'only established ao and terminal ai vowel pairs are permitted');
  assert.equal(name.split(' ').length, 1, 'each Harlyao personal name is one word');
  if (name.endsWith('ai')) aiEndings++;
  assert.equal(generator.generateIdentityFromSeed(seed, 'female', 'harlyao'), name, 'Harlyao names currently have no gender suffix rule');
  seen.add(name);
}
assert(seen.size > 1100, 'two/three-part Harlyao syllable pools should produce a wide variety of names');
assert(aiEndings > 20, 'the ai ending should be reachable across thousands of generated names');
assert.equal(generator.generateHarlyaoName(() => 0), 'Narkalu', 'a pathological fixed RNG cannot lock in an authored identity');
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
  assert.match(a.name, /^[A-Z][a-z]{4,11} the [A-Z][a-z]+$/, 'overhead label is one name plus the planar adjective');
  assert.equal(a.lichGivenName, a.name.split(' the ')[0], 'epithet must not become a surname');
  assert(win.HarlyaoLichCombat.LICH_EPITHETS.hronal.includes(a.lichEpithet), 'Hronal epithet follows the fire-and-earth tradition');
  hostiles.add(a);
  const b = await win.HarlyaoLichCombat.makeEntity({ type: 'hronal', x: 20, y: 10 }); // Another actor must check the active name pool.
  assert.notEqual(a.lichGivenName, b.lichGivenName, 'concurrent ordinary liches should not share their personal name');
  hostiles.add(b);
  for (const type of ['tothal', 'kanthic']) {
    const ordinary = await win.HarlyaoLichCombat.makeEntity({ type, x: 25, y: 20 }); // Each tradition must use its own epithet pool.
    assert.match(ordinary.name, /^[A-Z][a-z]{4,11} the [A-Z][a-z]+$/, type + ' overhead name format');
    assert(win.HarlyaoLichCombat.LICH_EPITHETS[type].includes(ordinary.lichEpithet), type + ' planar epithet pool');
    assert(!['Flame', 'Unsleeping', 'Sightless'].includes(ordinary.lichEpithet), 'authored epithets belong to the three named guardians');
    hostiles.add(ordinary);
  }
  const roster = { name: 'My Authored Lich', appearance: { speciesId: 'harlyao-skeleton', gender: 'male' }, lichDyeId: 'dye:CLOTH:pure_blue' }; // Explicit external editor roster must keep its identity.
  const custom = await win.HarlyaoLichCombat.makeEntity({ type: 'kanthic', x: 20, y: 30, roster });
  assert.equal(custom.name, 'My Authored Lich');
  const special = await win.HarlyaoLichCombat.makeEntity({ type: 'tothal', x: 10, y: 30, special: true });
  assert.equal(special.name, 'Nanahi the Unsleeping');
  assert.equal(win.HarlyaoLichCombat.debugSnapshot().activeLiches[0].name, a.name, 'existing mobile debug snapshots expose real lich names');
  assert.equal(win.HarlyaoLichCombat.debugSnapshot().activeLiches[0].givenName, a.lichGivenName, 'mobile diagnostics distinguish personal names from epithets');
  assert.match(win.HarlyaoLichCombat.formatDebug(), /names=/, 'mobile text diagnostics show actual generated names');
  const index = read('docs/index.html'); // Page script loading must include the generator before game.js.
  assert(index.indexOf('js/scratchbones-name-generator.js?v=') >= 0);
  assert(index.indexOf('js/scratchbones-name-generator.js?v=') < index.indexOf('game.js?v='));
  console.log('Harlyao lich names: single-word personal names, terminal ai, planar epithets, authored overrides and mobile diagnostics passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
