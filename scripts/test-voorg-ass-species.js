const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = process.env.HOBUNJI_TEST_ROOT || process.cwd(); // Used so this can run in-repo or against a staged checkout.
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8'); // Keeps every fixture read rooted consistently.
const geneticsSource = read('docs/js/creature-genetics.js'); // Runtime under test: genotype, renderer, livestock, and wildlife registration.
const registrationSource = read('docs/js/voorg-ass-registration.js'); // Shared creature/renderer/herd registration loaded before creature-genetics.js.
const loot = JSON.parse(read('docs/config/loot/loot-pools.json')); // Confirms Voorg-Ass kills use the already-authored meat item.

assert.match(geneticsSource, /'voorg-ass':\s*\['belly'\]/, 'Voorg-Ass has only the belly pattern layer');
assert.match(geneticsSource, /'voorg-ass':\s*new Set\(\['belly'\]\)/, 'Voorg-Ass belly is authored as always-present');
assert.match(geneticsSource, /VOORG_ASS_NORTHERN_ZONE_ID = 'map_northern_cliffs'/, 'Voorg-Ass targets Northern Cliffs');
assert.match(geneticsSource, /'voorg-ass':\s*'uumkaoii'/, 'Voorg-Ass borrows Uumkao’ii size/ground calibration only');
assert.match(registrationSource, /voorg-ass_idle\.png[\s\S]*voorg-ass_run1\.png[\s\S]*voorg-ass_run2\.png/, 'Voorg-Ass base animation sprites are registered');
assert.match(registrationSource, /prefix:\s*KIND[\s\S]*patterns:\s*\['belly'\]/, 'Voorg-Ass renderer has the uploaded belly layer and no optional pattern list');
assert.match(registrationSource, /prefix:\s*KIND[\s\S]*?baseShadeReferenceHex:\s*'#99BF99'/, 'Voorg-Ass renderer uses authored #99BF99 full-strength coat anchor');
assert.match(geneticsSource, /resources\[VOORG_ASS_KIND\]\s*=\s*\{\s*itemKey:\s*LIGHT_WOOL_ITEM_KEY,\s*cooldownDays:\s*1,\s*verb:\s*'Shear'/, 'Voorg-Ass uses the generic one-day shearing path');
assert.deepEqual(loot.pools?.['creature_voorg-ass']?.entries?.map(entry => entry.itemKey), ['voorgAssMeat'], 'Voorg-Ass has its own meat drop pool');

let rngState = 0x8a77c11; // Used by deterministic Math.random so breeding coverage cannot become flaky in CI.
const seededMath = Object.create(Math); // Used by the VM while retaining native Math helpers.
seededMath.random = () => {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 0x100000000;
};
const listeners = {}; // Captures the pre-game DOMContentLoaded registration hook.
const logs = []; // Captures mobile-visible farm debug output for replacement verification.
const windowStub = {
  SCRATCHBONES_CONFIG: { game: {
    creatureGenetics: {
      defaultPatternChance: 1 / 3,
      patternChances: {},
      palettes: { default: [
        { id: 'brown', name: 'Brown', hex: '#6a412e', weight: 4 },
        { id: 'cream', name: 'Cream', hex: '#c7aa77', weight: 4 },
        { id: 'ash', name: 'Ash', hex: '#6d7068', weight: 4 },
      ] },
    },
    livestock: { animalWidths: { 'gar-wolf': 1.9 }, diet: {}, resources: {} },
  } },
  HOBUNJI_ATTACHMENT_RIG_PROFILES: { creatures: {
    uumkaoii: {
      sizeScales: { small: { x: 0.5, y: 0.5 }, medium: { x: 0.8, y: 0.8 }, large: { x: 1.2, y: 1.2 } },
      groundOffsets: { small: 0.12, medium: 0.28, large: 0.46 },
    },
    'gar-wolf': {
      sizeScales: { small: { x: 0.35, y: 0.35 }, medium: { x: 1, y: 1 }, large: { x: 1.5, y: 1.5 } },
      groundOffsets: { small: 0.11, medium: 0.33, large: 0.5 },
    },
  } },
  addEventListener(type, fn) { listeners[type] = fn; },
  __farmLog(message, channel) { logs.push({ message, channel }); },
};
const context = vm.createContext({ window: windowStub, console, Math: seededMath, performance: { now: () => 0 }, Set, Array }); // Runs only the isolated genetics module with browser globals stubbed.
vm.runInContext(registrationSource, context);
vm.runInContext(geneticsSource, context);

const creatureDb = {
  'gar-wolf': { label: 'Gar-wolf', modelWidth: 2, spriteAspect: 0.45, defaultSizeClass: 'medium' },
  'uumkaoii-wild': {
    label: "Wild Uumkao'ii", modelWidth: 1.5, spriteAspect: 0.5, defaultSizeClass: 'large', hostile: false,
    speed: 1.1, health: 30, sprites: { idle: 'u', run: ['u1', 'u2'] }, lootPool: 'creature_uumkaoii-wild',
  },
};
windowStub.CreatureGenetics.init({ creatureDb, CREATURE_DB: creatureDb, clamp: (value, min, max) => Math.max(min, Math.min(max, value)) });
windowStub.CreatureGeneticsRender = { SPECIES: { grehlr: { patterns: [] } } }; // Supplies the shared compositor registry extended on DOMContentLoaded.
windowStub.HobunjiCookingData = { items: { // Simulates cooking-data.js having loaded before the page's DOMContentLoaded event.
  puktukWool: {
    id: 'puktukWool', name: 'Puktuk Wool', categories: ['wool', 'material'], quality: 2,
    baseBoost: 1, processingTier: 'raw', primaryEffect: 'farming', tags: ['Puktuk', 'Heavy'],
  },
} };
let receivedWildlifeDeps = null; // Proves the wrapper still delegates to the pre-existing WildlifeSpawn.init implementation.
windowStub.WildlifeSpawn = { init(injectedDeps) { receivedWildlifeDeps = injectedDeps; return 'ok'; } };

assert.equal(typeof listeners.DOMContentLoaded, 'function', 'genetics module registered its pre-game installation hook');
listeners.DOMContentLoaded();
assert.deepEqual(JSON.parse(JSON.stringify(windowStub.CreatureGeneticsRender.SPECIES['voorg-ass'].patterns)), ['belly']);
assert.equal(windowStub.HobunjiCookingData.items.puktukWool.name, 'Heavy Wool', 'Puktuk wool presents as Heavy Wool while retaining its save-compatible key');
assert.equal(windowStub.HobunjiCookingData.items.lightWool.name, 'Light Wool');
assert(windowStub.HobunjiCookingData.items.lightWool.categories.includes('wool'));
assert(windowStub.HobunjiCookingData.items.lightWool.categories.includes('material'));
assert(windowStub.HobunjiCookingData.items.lightWool.tags.includes('Light'));
assert(!windowStub.HobunjiCookingData.items.lightWool.tags.includes('Heavy'));

const wildlifeDeps = {
  CREATURE_DB: creatureDb,
  EXTERIOR_ZONES: {
    map_western_slope: { herbivoreSpecies: ['drenkirra'] },
    map_northern_cliffs: { packSpecies: ['grehlr'], herbivoreSpecies: ['uumkaoii-wild'] },
  },
};
assert.equal(windowStub.WildlifeSpawn.init(wildlifeDeps), 'ok');
assert.equal(receivedWildlifeDeps, wildlifeDeps);
assert.equal(creatureDb['voorg-ass'].label, 'Voorg-Ass');
assert.equal(creatureDb['voorg-ass'].hostile, false);
assert.equal(creatureDb['voorg-ass'].defaultSizeClass, 'large');
assert.equal(creatureDb['voorg-ass'].lootPool, 'creature_voorg-ass');
assert.equal(creatureDb['voorg-ass'].speed, 1.1, 'Voorg-Ass retains the replaced Northern Cliffs prey behavior baseline');
assert.deepEqual(JSON.parse(JSON.stringify(wildlifeDeps.EXTERIOR_ZONES.map_northern_cliffs.herbivoreSpecies)), [], 'Voorg-Ass no longer occupies the cavern/den herbivore pool');
assert.deepEqual(JSON.parse(JSON.stringify(wildlifeDeps.EXTERIOR_ZONES.map_northern_cliffs.roamingHerdSpecies)), ['voorg-ass'], 'Voorg-Ass is registered as exterior-only roaming herd wildlife');
assert.equal(wildlifeDeps.EXTERIOR_ZONES.map_northern_cliffs.roamingHerdCount, 2, 'Northern Cliffs maintain two large roaming herd slots');
assert.equal(creatureDb['voorg-ass-herd-mother'].label, 'Herd-Mother');
assert.equal(creatureDb['voorg-ass-herd-mother'].defaultSizeClass, 'large');
assert.equal(creatureDb['voorg-ass-herd-mother'].lootPool, 'creature_voorg-ass');
assert.equal(windowStub.SCRATCHBONES_CONFIG.game.livestock.resources['voorg-ass'].itemKey, 'lightWool');
assert.equal(windowStub.SCRATCHBONES_CONFIG.game.livestock.resources['voorg-ass'].verb, 'Shear');
assert.equal(windowStub.SCRATCHBONES_CONFIG.game.livestock.resources['voorg-ass'].cooldownDays, 1);
assert.equal(windowStub.SCRATCHBONES_CONFIG.game.livestock.diet['voorg-ass'], 'prey');
assert(logs.some(entry => /\[voorg-ass\].*removedLegacyDenHerbivores=1.*roaming=\[voorg-ass\].*herdCount=2/.test(entry.message)), 'mobile-visible debug log reports the Northern Cliffs herd migration');

for (let i = 0; i < 500; i++) {
  const genotype = windowStub.CreatureGenetics.makeDefaultGenotype('voorg-ass');
  assert.equal(genotype.sizeClass, 'large');
  assert.equal(genotype.belly.enabled, true);
  assert.equal(genotype.belly.copies, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(genotype, 'foxtail'), false, 'Voorg-Ass has no un-authored optional pattern');
}
const parentA = windowStub.CreatureGenetics.makeDefaultGenotype('voorg-ass'); // Used to prove breeding cannot remove the anatomical belly layer.
const parentB = windowStub.CreatureGenetics.makeDefaultGenotype('voorg-ass');
for (let i = 0; i < 500; i++) {
  const child = windowStub.CreatureGenetics.crossOffspring(parentA, parentB, 'voorg-ass', 0.25);
  assert.equal(child.belly.enabled, true);
  assert.equal(child.belly.copies, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(child, 'foxtail'), false);
}

assert.deepEqual(JSON.parse(JSON.stringify(windowStub.CreatureGenetics.creatureSizeScale('voorg-ass', 'large'))), { sizeClass: 'large', x: 1.2, y: 1.2 });
assert.equal(windowStub.CreatureGenetics.creatureGroundOffset('voorg-ass', 'large'), 0.46);

console.log('PASS Voorg-Ass Northern Cliffs + Light Wool integration');
