const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = process.env.HOBUNJI_TEST_ROOT || process.cwd(); // Used so the same regression test can run in-repo or against a staged checkout.
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8'); // Used to keep all fixture reads rooted consistently.
const geneticsSource = read('docs/js/creature-genetics.js'); // Runtime under test: Puktuk genetics, renderer registration, and wildlife bootstrap.
const loot = JSON.parse(read('docs/config/loot/loot-pools.json')); // Confirms killed Puktuk resolve to an authored item pool.
const cookingSource = read('docs/js/cooking-data.js'); // Confirms the existing Puktuk wool item is already categorized as Heavy.

assert.match(geneticsSource, /puktuk:\s*\['belly', 'foxtail'\]/, 'Puktuk exposes the belly and foxtail pattern layers');
assert.match(geneticsSource, /puktuk:\s*new Set\(\['belly'\]\)/, 'Puktuk belly is authored as always-present');
assert.match(geneticsSource, /const PUKTUK_FOXTAIL_CHANCE = 0\.08/, 'Puktuk foxtail uses the rare 8% fresh-roll rate');
assert.match(geneticsSource, /CREATURE_SIZE_PROFILE_ALIAS = \{ puktuk: 'gar-wolf' \}/, 'Puktuk reuses Gar-wolf size calibration without a render alias');
assert.match(geneticsSource, /PUKTUK_WESTERN_ZONE_ID = 'map_western_slope'/, 'Puktuk targets the Western Incline/Slope zone');
assert.match(geneticsSource, /puktuk_idle\.png[\s\S]*puktuk_run1\.png[\s\S]*puktuk_run2\.png/, 'Puktuk base animation sprites are registered');
assert.match(geneticsSource, /itemKey: 'puktukWool'[\s\S]*verb: 'Shear'/, 'Puktuk livestock production uses the existing wool item');
assert.deepEqual(loot.pools?.creature_puktuk?.entries?.map(entry => entry.itemKey), ['puktukMeat'], 'Puktuk has its own meat drop pool');
assert.match(cookingSource, /"puktukWool"\s*:\s*\{[\s\S]*?"name"\s*:\s*"Puktuk Wool"[\s\S]*?"Heavy"/, 'Puktuk Wool remains tagged Heavy');

let rngState = 0x51f15e; // Used by deterministic Math.random so the rarity assertion cannot become flaky in CI.
const seededMath = Object.create(Math); // Used by the VM runtime while retaining all native Math helpers.
seededMath.random = () => {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 0x100000000;
};
const listeners = {}; // Used to capture the module's pre-game DOMContentLoaded registration hook.
const windowStub = {
  SCRATCHBONES_CONFIG: { game: {
    creatureGenetics: {
      defaultPatternChance: 1 / 3,
      patternChances: { grehlr: { mitts: 0.08 } },
      palettes: { default: [
        { id: 'brown', name: 'Brown', hex: '#6a412e', weight: 4 },
        { id: 'cream', name: 'Cream', hex: '#c7aa77', weight: 4 },
        { id: 'ash', name: 'Ash', hex: '#6d7068', weight: 4 },
      ] },
    },
    livestock: { animalWidths: { 'gar-wolf': 1.9 }, diet: {}, resources: {} },
  } },
  HOBUNJI_ATTACHMENT_RIG_PROFILES: { creatures: {
    'gar-wolf': {
      sizeScales: { small: { x: 0.35, y: 0.35 }, medium: { x: 1, y: 1 }, large: { x: 1.5, y: 1.5 } },
      groundOffsets: { small: 0.11, medium: 0.33, large: 0.5 },
    },
  } },
  addEventListener(type, fn) { listeners[type] = fn; },
  __farmLog() {},
};
const context = vm.createContext({ window: windowStub, console, Math: seededMath, performance: { now: () => 0 }, Set }); // Runs only the isolated genetics module with browser globals stubbed.
vm.runInContext(geneticsSource, context);

const creatureDb = { // Supplies the two existing species Puktuk intentionally borrows baseline data from.
  'gar-wolf': { label: 'Gar-wolf', modelWidth: 2, spriteAspect: 0.45, defaultSizeClass: 'medium' },
  'uumkaoii-wild': { label: "Wild Uumkao'ii", modelWidth: 1.5, spriteAspect: 0.5, defaultSizeClass: 'large', hostile: false, sprites: { idle: 'u', run: ['u1', 'u2'] } },
};
windowStub.CreatureGenetics.init({ creatureDb, CREATURE_DB: creatureDb, clamp: (value, min, max) => Math.max(min, Math.min(max, value)) });

for (let i = 0; i < 500; i++) {
  const genotype = windowStub.CreatureGenetics.makeDefaultGenotype('puktuk'); // Verifies every fresh animal receives the required permanent belly and medium default size.
  assert.equal(genotype.sizeClass, 'medium');
  assert.equal(genotype.belly.enabled, true);
  assert.equal(genotype.belly.copies, 2);
}
let foxtailCount = 0; // Used to verify the configured rare foxtail remains near its 8% authored rate.
for (let i = 0; i < 5000; i++) {
  foxtailCount += windowStub.CreatureGenetics.makeDefaultGenotype('puktuk').foxtail.enabled ? 1 : 0;
}
assert.ok(foxtailCount >= 300 && foxtailCount <= 500, `expected ~8% foxtails, got ${foxtailCount}/5000`);

const parentA = windowStub.CreatureGenetics.makeDefaultGenotype('puktuk'); // Used to prove breeding cannot remove the anatomical belly layer.
const parentB = windowStub.CreatureGenetics.makeDefaultGenotype('puktuk'); // Used with parentA for repeated inherited-pattern coverage.
for (let i = 0; i < 500; i++) {
  const child = windowStub.CreatureGenetics.crossOffspring(parentA, parentB, 'puktuk', 0.05); // Exercises the permanent-pattern breeding branch including mutation chances.
  assert.equal(child.belly.enabled, true);
  assert.equal(child.belly.copies, 2);
}

assert.deepEqual(JSON.parse(JSON.stringify(windowStub.CreatureGenetics.creatureSizeScale('puktuk', 'small'))), { sizeClass: 'small', x: 0.35, y: 0.35 });
assert.deepEqual(JSON.parse(JSON.stringify(windowStub.CreatureGenetics.creatureSizeScale('puktuk', 'medium'))), { sizeClass: 'medium', x: 1, y: 1 });
assert.deepEqual(JSON.parse(JSON.stringify(windowStub.CreatureGenetics.creatureSizeScale('puktuk', 'large'))), { sizeClass: 'large', x: 1.5, y: 1.5 });
assert.equal(windowStub.CreatureGenetics.creatureGroundOffset('puktuk', 'small'), 0.11);
assert.equal(windowStub.CreatureGenetics.creatureGroundOffset('puktuk', 'medium'), 0.33);
assert.equal(windowStub.CreatureGenetics.creatureGroundOffset('puktuk', 'large'), 0.5);
assert.equal(windowStub.SCRATCHBONES_CONFIG.game.livestock.resources.puktuk.itemKey, 'puktukWool');
assert.equal(windowStub.SCRATCHBONES_CONFIG.game.livestock.resources.puktuk.verb, 'Shear');
assert.equal(windowStub.SCRATCHBONES_CONFIG.game.livestock.animalWidths.puktuk, 1.9);

windowStub.CreatureGeneticsRender = { SPECIES: { grehlr: { patterns: [] } } }; // Supplies the real shared renderer registry that the module extends before game startup.
let receivedWildlifeDeps = null; // Used to prove the wrapper still delegates to the original WildlifeSpawn.init with the same dependency object.
windowStub.WildlifeSpawn = { init(injectedDeps) { receivedWildlifeDeps = injectedDeps; return 'ok'; } };
assert.equal(typeof listeners.DOMContentLoaded, 'function', 'genetics module registered its pre-game install hook');
listeners.DOMContentLoaded();
assert.deepEqual(JSON.parse(JSON.stringify(windowStub.CreatureGeneticsRender.SPECIES.puktuk.patterns)), ['belly', 'foxtail']);

const wildlifeDeps = { // Represents the live registries game.js passes to WildlifeSpawn.init.
  CREATURE_DB: creatureDb,
  EXTERIOR_ZONES: { map_western_slope: { herbivoreSpecies: ['drenkirra', 'uumkaoii-wild'] } },
};
assert.equal(windowStub.WildlifeSpawn.init(wildlifeDeps), 'ok');
assert.equal(receivedWildlifeDeps, wildlifeDeps);
assert.equal(creatureDb.puktuk.label, 'Puktuk');
assert.equal(creatureDb.puktuk.defaultSizeClass, 'medium');
assert.equal(creatureDb.puktuk.hostile, false);
assert.equal(creatureDb.puktuk.lootPool, 'creature_puktuk');
assert.deepEqual(JSON.parse(JSON.stringify(wildlifeDeps.EXTERIOR_ZONES.map_western_slope.herbivoreSpecies)), ['puktuk', 'uumkaoii-wild']);

console.log(`PASS Puktuk species integration (foxtail ${foxtailCount}/5000)`);
