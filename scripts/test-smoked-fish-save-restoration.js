'use strict';

// Reproduce older Needlegrain Hollow worlds that saved smoked-fish counts and quality
// but omitted their dynamically registered processed-item definitions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const inventory = {
  fish_permafrostEelSmoked: 24,
  fish_frostWhiskerEelSmoked: 15,
  fish_stonebellyTroutSmoked: 30,
  rockscale_silverplateSmoked: 96,
  sixfin_coalbarSmoked: 210,
  mossfin_frostcapSmoked: 3,
  sixfin_honeystripeSmoked: 33,
  rockscale_giltbackSmoked: 15,
};
const startingInventory = { ...inventory };
const qualityBuckets = Object.fromEntries(
  Object.entries(inventory).map(([key, amount]) => [key, { 3: amount }]),
);
const ITEM_DEFS = Object.fromEntries(
  ['fish_permafrostEel', 'fish_frostWhiskerEel', 'fish_stonebellyTrout'].map(key => [
    key, { icon: '🐟', label: key, cat: 'material', tags: ['Fish'], sellPrice: 20 },
  ]),
);
let packRebuilds = 0;
let wheelRebuilds = 0;
const window = {
  ShippingPanel: {
    init() { this.ready = true; },
    registerItemDefinitions(definitions) {
      if (!this.ready) return false;
      Object.assign(ITEM_DEFS, definitions);
      return true;
    },
  },
};
const document = {
  getElementById(id) { return id === 'hobunjiCookingLayer' ? {} : null; },
  addEventListener() {},
};
const context = vm.createContext({ window, document, console });

function load(name) {
  vm.runInContext(fs.readFileSync('docs/js/' + name, 'utf8'), context, { filename: name });
}
function visibleFish() {
  return Object.keys(inventory).filter(key => inventory[key] > 0 && ITEM_DEFS[key]);
}

load('cooking-data.js');
load('cooking-system.js');
load('item-processing.js');
window.CookingSystem.init({
  ITEM_DEFS, inventory, inventoryItems: [],
  buildInventoryGrid() { packRebuilds++; },
  refreshItemScroll() { wheelRebuilds++; },
});
window.ItemProcessing.init({
  ITEM_DEFS, cropData: {}, PROCESSING_METHODS: ['smoking', 'drying'],
  getInventoryItems: () => [],
});
assert.equal(visibleFish().length, 0, 'saved preserved fish initially have no processed definitions');

window.CookingSystem.restore({ qualityBuckets, processedDefinitions: [], cookedDefinitions: {} });
assert.equal(visibleFish().length, 3, 'older fish recover as soon as a world loads');
assert.equal(window.CookingSystem.repairPreservedInventory(), 0, 'recovery is idempotent');

load('fish-catalog.js');
assert.equal(visibleFish().length, 3, 'late fish catalog is not registered before ShippingPanel initializes');
window.ShippingPanel.init({});
assert.equal(visibleFish().length, 8, 'late catalog registration recovers the remaining saved fish');
assert.equal(packRebuilds, 2, 'Pack rebuilds after each successful repair stage');
assert.equal(wheelRebuilds, 2, 'held-item scroll rebuilds after each successful repair stage');
assert.deepEqual(inventory, startingInventory, 'preserved-fish quantities are never modified');
const saved = window.CookingSystem.serialize();
assert.deepEqual(JSON.parse(JSON.stringify(saved.qualityBuckets)), qualityBuckets, 'star quality is preserved');
assert.equal(saved.processedDefinitions.filter(def => def.key.endsWith('Smoked')).length, 8,
  'recovered definitions are serialized for future reloads');
assert.ok(saved.processedDefinitions.every(def =>
  def.cookingProcessSteps.length > 0 && def.cookingProcessMultiplier > 1),
'processing provenance survives migration');
for (const key of Object.keys(inventory)) {
  assert.ok(ITEM_DEFS[key].cookingCategories.includes('fish'), key + ' can be cooked');
}
// A character/world switch clears processedDefinitions but ITEM_DEFS is shared.
// Those stale definitions must not suppress rebuilding the newly loaded world's
// saved fish so they survive its next save too.
window.CookingSystem.restore({ qualityBuckets, processedDefinitions: [], cookedDefinitions: {} });
const secondSave = window.CookingSystem.serialize();
assert.equal(secondSave.processedDefinitions.filter(def => def.key.endsWith('Smoked')).length, 8,
  'reloading another legacy world re-registers provenance despite shared definitions');
assert.deepEqual(JSON.parse(JSON.stringify(secondSave.qualityBuckets)), qualityBuckets,
  'switching worlds leaves fish quality buckets untouched');
assert.deepEqual(inventory, startingInventory, 'switching worlds never changes fish counts');
assert.equal(window.CookingSystem.repairPreservedInventory(), 0, 'second restore remains idempotent');

console.log('smoked-fish save restoration ok');
