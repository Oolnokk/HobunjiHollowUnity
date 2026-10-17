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
};
const panel = window.ShippingPanel;
panel.init({ ITEM_DEFS, BASE_PRICES, inventory: {} });

assert.equal(panel.getShipPrice('redberries'), 5, 'crop table price still wins');
assert.equal(panel.getShipPrice('rawFish'), 12, 'raw fish ships at its own sellPrice');
assert.equal(panel.getShipPrice('garWolfMeatJerky'), 20, 'jerky ships');
assert.equal(panel.getShipPrice('garWolfMeatSmoked'), 18, 'smoked meat ships');
assert.equal(panel.getShipPrice('needlegrainSeeds'), undefined, 'zero-value items stay unshippable');
assert.equal(panel.getShipPrice('kurrayaLike'), undefined, 'items without a price stay unshippable');
assert.equal(panel.getShipPrice('missing'), undefined, 'unknown keys stay unshippable');
assert.equal(panel.canShipKey('rawFish'), true);
assert.equal(panel.canShipKey('needlegrainSeeds'), false);
console.log('shipping box item pricing ok');
