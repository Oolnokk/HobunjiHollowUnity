#!/usr/bin/env node
'use strict';

// Integration regression: real authored dairy/loot definitions and production resource paths.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.HOBUNJI_TEST_ROOT || path.resolve(__dirname, '..'); // Allows staged checkouts to run the same test.
const read = file => fs.readFileSync(path.join(root, file), 'utf8'); // All fixtures come from files being tested.

const pools = JSON.parse(read('docs/config/loot/loot-pools.json')).pools;
const index = JSON.parse(read('docs/config/items/item-index.json'));
const cooking = read('docs/js/cooking-data.js');
const staticConfig = read('docs/config/scratchbones-config.js');

const expectedWildProducts = [
  ['nazgraku', 'nazgrakuMeat', 'nazgrakuHide'],
  ['pingdort', 'pingdortMeat', 'pingdortHide'],
  ['tzatzul', 'tzatzulMeat', 'tzatzulHide'],
  ['tzatzul_hatchling', 'tzatzulMeat', 'tzatzulHide'],
]; // Each adult/new hatchling corpse must grant one species-correct skin and meat.
for (const [species, meat, hide] of expectedWildProducts) {
  const pool = pools['creature_' + species];
  assert(pool, species + ' corpse pool is registered');
  for (const key of [meat, hide]) {
    assert(pool.entries.some(entry => entry.itemKey === key && entry.chance === 1 && entry.min >= 1),
      species + ' needs guaranteed ' + key);
    assert(index[key], key + ' is missing from the generated item index');
  }
}
assert.equal(pools.creature_moot.entries.find(entry => entry.id === 'hide').itemKey, 'mootHide');
assert.equal(pools.creature_moot.entries.find(entry => entry.id === 'meat').itemKey, 'mootMeat');
assert.deepEqual(pools.creature_uumkaoii.entries, [], 'Companion Uumkao’ii must remain intentionally loot-free');
assert.match(staticConfig, /"additionalResources"\s*:\s*\{\s*"nazgraku"\s*:/, 'Nazgraku needs an independent saved milk resource');
for (const key of ['mootMilk', 'nazgrakuMilk', 'pingdortMeat', 'tzatzulMeat']) {
  assert(index[key], key + ' item index missing');
  assert(cooking.includes('"' + key + '":'), key + ' ingredient definition missing');
}

// FarmAnimals owns the actual production day tick, action prompts, harvest awards and save state.
const config = { game: { livestock: {
  itemKinds: {}, animalWidths: {}, diet: {}, resources: {
    nazgraku: { itemKey: 'nazgrakuEggs', cooldownDays: 2 },
  },
  additionalResources: {
    nazgraku: [{ itemKey: 'nazgrakuMilk', cooldownDays: 1, verb: 'Milk', interactive: true }],
  },
}, wildlife: { denMothers: {} } } }; // Mirrors the real Nazgraku config, including legacy egg preservation.
const inventory = {}; // Collected milk and egg counts are asserted independently.
const records = [
  { id: 'naz1', kind: 'nazgraku', barnId: 'barn1', resourceReady: false, daysUntilResource: 2, heartLevel: 2.5 },
  { id: 'moot1', kind: 'moot', barnId: 'barn1', resourceReady: false, daysUntilResource: 1, heartLevel: 2.5 },
  { id: 'stasis', kind: 'nazgraku', barnId: null, resourceReady: false, daysUntilResource: 2, heartLevel: 2.5 },
]; // Older saved livestock has no additionalResources state until housed-day tick.
let saves = 0; // Ensures every resource grant and daily cooldown advance persists.
const W = {
  SCRATCHBONES_CONFIG: config,
  CreatureTextureCache: { create: () => ({}), genotypeFrameSetKey() {} },
  CreatureGeneticsRender: { SPECIES: {} },
  InventoryStacks: { MAX_TOTAL: 999 },
  PerkSystem: { rank: () => 0 },
  __farmLog() {},
};
const context = vm.createContext({ window: W, console });
vm.runInContext(read('docs/js/moot-registration.js'), context, { filename: 'moot-registration.js' });
assert.equal(config.game.livestock.resources.moot.itemKey, 'mootMilk');
assert.equal(config.game.livestock.resources.moot.verb, 'Milk');
assert.equal(config.game.livestock.resources.nazgraku.itemKey, 'nazgrakuEggs', 'Nazgraku eggs must not be removed');

// Species registration is the bridge between authored pools and the live corpse's def.
vm.runInContext(read('docs/js/pingdort-registration.js'), context, { filename: 'pingdort-registration.js' });
vm.runInContext(read('docs/js/tzatzul-registration.js'), context, { filename: 'tzatzul-registration.js' });
const creatureDb = { 'gar-wolf': { lootPool: 'creature_gar-wolf' }, grehlr: { lootPool: 'creature_grehlr' } }; // Predators are baselines, not loot sources for these birds.
const liveItems = {}; // Game-owned inventory registry at wildlife initialization.
const inventoryWheel = []; // New loot keys must appear in the item arch.
const injected = { CREATURE_DB: creatureDb, ITEM_DEFS: liveItems, inventoryItems: inventoryWheel, TILE: 64 }; // Same shape passed by production wildlife registration.
assert(W.PingdortRegistration.register(injected));
assert(W.TzatzulRegistration.register(injected));
assert.equal(creatureDb.pingdort.lootPool, 'creature_pingdort');
assert.equal(creatureDb.tzatzul.lootPool, 'mixedCrateTreasurePuzzle', 'Adult Tzatzul must retain hoard');
assert.equal(creatureDb.tzatzul.bonusLootPool, 'creature_tzatzul');
assert.equal(creatureDb['tzatzul-hatchling'].bonusLootPool, null);
for (const key of ['pingdortMeat', 'pingdortHide', 'tzatzulMeat', 'tzatzulHide']) {
  assert(liveItems[key], key + ' has no live inventory definition');
  assert(inventoryWheel.some(entry => entry.key === key), key + ' is absent from the item wheel');
}

const farmSource = read('docs/js/farm-animals.js');
assert(farmSource.trimEnd().endsWith('})();'), 'FarmAnimals must retain its isolated module closure');
const farmUnderTest = farmSource.replace(/\}\)\(\);\s*$/,
  'window.__farmDairyTest = { collectResource, getButtons:_farmAnimalGetButtons, onAction:_farmAnimalOnAction };\n})();');
vm.runInContext(farmUnderTest, context, { filename: 'farm-animals.js' });
const itemDefs = { // All item keys resolved through the live inventory catalog.
  nazgrakuEggs: { label: 'Nazgraku Eggs', icon: '🥚' },
  nazgrakuMilk: { label: 'Nazgraku Milk', icon: '🥛' },
  mootMilk: { label: 'Moot Milk', icon: '🥛' },
};
W.FarmAnimals.init({
  LIVESTOCK_RESOURCE_DEFS: config.game.livestock.resources,
  LIVESTOCK_RESOURCE_VERB: { nazgraku: 'Collect', moot: 'Milk' },
  loadWorldLivestock: () => records,
  saveWorldLivestock() { saves++; },
  inventory, ITEM_DEFS: itemDefs,
  rollItemStars: () => 3, recordItemQuality() {}, awardFarmingXp() {}, starRatingText: () => '',
  getFarmBuildings: () => [], calendar: { day: 1 }, getHeldItemKey: () => null,
});
W.FarmAnimals.tickResources();
assert.equal(records[0].additionalResources.nazgrakuMilk.ready, true, 'Old-save Nazgraku milk should mature on its own cooldown');
assert.equal(records[0].resourceReady, false, 'Nazgraku eggs should still be unavailable on day one');
assert.equal(records[1].resourceReady, true, 'Moot milk should mature in a day');
assert.equal(records[2].additionalResources, undefined, 'Unassigned livestock must not progress or mutate');
W.FarmAnimals.tickResources();
assert.equal(records[0].resourceReady, true, 'Nazgraku eggs should mature separately on day two');

const nazgrakuAnimal = { id: 'naz-on-farm', livestockId: 'naz1', animalKey: 'nazgraku' };
const buttons = W.__farmDairyTest.getButtons(nazgrakuAnimal, 'Nazgraku', '🐾');
assert(buttons.some(button => button.label === 'Milk Nazgraku Milk'), 'Nazgraku needs its own contextual milk action');
assert(buttons.some(button => button.label === 'Collect Nazgraku Eggs'), 'Egg collection must survive milk addition');

assert.equal(W.__farmDairyTest.collectResource('naz1', 'nazgrakuMilk').ok, true);
assert.equal(inventory.nazgrakuMilk, 1);
assert.equal(records[0].resourceReady, true, 'Milking must not reset the Nazgraku egg timer');
assert.equal(W.__farmDairyTest.collectResource('naz1').ok, true);
assert.equal(inventory.nazgrakuEggs, 1);
assert.equal(records[0].additionalResources.nazgrakuMilk.ready, false, 'Collecting milk resets only milk readiness');
assert.equal(W.__farmDairyTest.collectResource('naz1', 'notReal').ok, false, 'Unknown extra resources are rejected');
assert.equal(W.__farmDairyTest.collectResource('moot1').ok, true);
assert.equal(inventory.mootMilk, 1);
assert.equal(W.__farmDairyTest.collectResource('moot1').ok, false, 'Duplicate milking cannot be claimed');
assert(saves > 3, 'Both collection and cooldown changes must persist');

// Run the production data-driven loot roll, including Tzatzul's separate hoard + butcher products.
const lootWindow = {
  CalendarSystem: { currentWeekdayName: () => 'Day 1', currentSeason: () => ({ name: 'Highheat' }) },
  Fishing: { timeOfDay: () => 'day' },
  ConditionRegistry: { rollIndependentEligible: entries => entries.filter(entry => entry.chance === 1) },
  GameRandom: { random: () => 0 },
  LocalDBOverrides: { loadDatabase: async id => id === 'lootPools' ? { pools } : { shops: {} } },
};
const lootCtx = vm.createContext({ window: lootWindow, console });
vm.runInContext(read('docs/js/loot-rolling.js'), lootCtx, { filename: 'loot-rolling.js' });
lootWindow.LootRolling.init({
  calendar: { weather: 'clear' }, getCurrentArea: () => 'map_northern_cliffs',
  getPlayerData: () => ({ appearance: { speciesId: 'mao-ao' } }), applyLoadedShopStock() {},
});
async function run() {
  await lootWindow.LootRolling.loadLootShopConfig();
  for (const [species, meat, hide] of expectedWildProducts) {
    const drops = lootWindow.LootRolling.rollLootPool('creature_' + species);
    assert(drops[meat] >= 1, species + ' corpse meat was lost during the real loot roll');
    assert(drops[hide] >= 1, species + ' corpse hide was lost during the real loot roll');
  }
  const mixed = lootWindow.LootRolling.rollLootPool('mixedCrateTreasurePuzzle', {
    random: () => 0, entity: { def: { bonusLootPool: 'creature_tzatzul' } },
  });
  assert(mixed.tzatzulMeat >= 3 && mixed.tzatzulHide >= 1, 'Tzatzul hoard roll must include body products');
  assert(!lootWindow.LootRolling.rollLootPool('creature_tzatzul_hatchling').treasureChest,
    'Tzatzul hatchlings may not inherit the adult hoard');

  console.log('Wildlife dairy, independent Nazgraku eggs, and species-correct carcass products passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
