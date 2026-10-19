'use strict';

// The Shipping Box must take anything with a sale value (fish, meat, jerky,
// smoked/dried goods...), not only the crop table in BASE_PRICES.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = { addEventListener() {} };
const context = vm.createContext({
  window,
  document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; } },
  console,
});
for (const file of ['shipping-box-config.js', 'shipping-panel.js']) {
  vm.runInContext(fs.readFileSync(`docs/js/${file}`, 'utf8'), context, { filename: file });
}

const BASE_PRICES = { redberries: 5 };
const ITEM_DEFS = {
  redberries: { label: 'Redberries', sellPrice: 5 },
  rawFish: { label: 'Fish', cat: 'material', sellPrice: 12 },
  garWolfMeatJerky: { label: 'Gar-wolf Meat Jerky', cat: 'processed', sellPrice: 20 },
  garWolfMeatSmoked: { label: 'Smoked Gar-wolf Meat', cat: 'processed', sellPrice: 18 },
  needlegrainSeeds: { label: 'Seeds', cat: 'seed', sellPrice: 0 },
  kurrayaLike: { label: 'No price' },
  masteryTablet: { label: 'Mastery Tablet', cat: 'material', sellPrice: 140 },
  techniqueScroll: { label: 'Technique Scroll', cat: 'material', sellPrice: 90 },
  brewedPotion: { label: 'Brewed Potion', cat: 'processed', sellPrice: 24 },
  boundRelic: { label: 'Bound Relic', cat: 'material', sellPrice: 120 },
  questReward: { label: 'Unique quest station', cat: 'furniture', sellPrice: 0 },
};
const panel = window.ShippingPanel;
const inventory = { masteryTablet: 2, techniqueScroll: 1, brewedPotion: 3, boundRelic: 1, questReward: 1, gold: 0 }; // Tests actual merchant transfers without a browser UI.
let savedSales = 0; // Counts merchant persistence calls after a valid sale.
panel.init({ ITEM_DEFS, BASE_PRICES, inventory, clampInventoryStack() {}, buildInventoryGrid() {}, refreshItemScroll() {}, saveMemberWorldData() { savedSales++; } });

assert.equal(panel.getShipPrice('redberries'), 5, 'crop table price still wins');
assert.equal(panel.getShipPrice('rawFish'), 12, 'raw fish ships at its own sellPrice');
assert.equal(panel.getShipPrice('garWolfMeatJerky'), 20, 'jerky ships');
assert.equal(panel.getShipPrice('garWolfMeatSmoked'), 18, 'smoked meat ships');
assert.equal(panel.getShipPrice('needlegrainSeeds'), undefined, 'zero-value items stay unshippable');
assert.equal(panel.getShipPrice('kurrayaLike'), undefined, 'items without a price stay unshippable');
assert.equal(panel.getShipPrice('missing'), undefined, 'unknown keys stay unshippable');
assert.equal(panel.canShipKey('rawFish'), true);
assert.equal(panel.canShipKey('needlegrainSeeds'), false);
const sellKeys = panel.getSellableInventory().map(item => item.key); // Both store and shipping use this price authority.
for (const key of ['masteryTablet', 'techniqueScroll', 'brewedPotion', 'boundRelic']) assert.ok(sellKeys.includes(key), key + ' is offered for resale');
assert.ok(!sellKeys.includes('questReward'), 'quest-only, zero-priced items stay protected');
const one = panel.sellInventoryAtStore('masteryTablet', 1); // Sell only one duplicate and retain the other for reading.
assert.equal(one.moved, 1);
assert.equal(one.earned, 140);
assert.equal(inventory.masteryTablet, 1);
assert.equal(inventory.gold, 140);
assert.equal(savedSales, 1);
assert.equal(panel.sellInventoryAtStore('questReward', 1).moved, 0, 'protected quest items cannot be sold');
assert.equal(inventory.questReward, 1);
console.log('shipping box item pricing ok');
