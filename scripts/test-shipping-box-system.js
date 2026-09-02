'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const shipping = read('docs/js/shipping-panel.js');
const crates = read('docs/js/farm-crates.js');
const store = read('docs/js/general-store.js');

assert.match(shipping, /id = 'shippingStandaloneRoot'/, 'shipping creates a standalone root');
assert.match(shipping, /shippingStandaloneBody'\)\.appendChild\(pane\)/, 'existing shipping transfer pane is reparented instead of duplicated');
assert.match(shipping, /pointerlockchange[\s\S]*releasePointerLock/, 'standalone shipping keeps pointer lock released');
assert.match(shipping, /stopImmediatePropagation\(\)[\s\S]*closeStandalone/, 'legacy pane close is intercepted before main-menu close handling');
assert.match(shipping, /#iiActions \.ii-btn\.sell \{ display: none !important; \}/, 'inventory direct-sale buttons are unavailable');
assert.match(shipping, /getSellableInventory/, 'shipping exposes canonical sellable stack data to the General Store');
assert.match(shipping, /sellInventoryAtStore/, 'General Store sales share the canonical shipping price bridge');
assert.match(shipping, /getDebugState/, 'shipping exposes mobile-friendly diagnostic state');

assert.match(crates, /ProceduralFurniture[\s\S]*CATALOG\?\.chest/, 'shipping reuses the existing Storage Chest recipe');
assert.match(crates, /sx: Math\.max\(0\.001, \(part\.transform\?\.sx \|\| 0\.001\) \* 2\)/, 'shipping chest is stretched to two-tile width');
assert.match(crates, /w: 2, h: 1/, 'shipping publishes a two-by-one footprint');
assert.match(crates, /set col\(value\)[\s\S]*moveTo/, 'editor coordinate writes resync the visual');
assert.match(crates, /lid\.add\(latch\)/, 'latch follows the lid so editor cleanup leaves no orphan mesh');
assert.match(crates, /ShippingPanel\?\.open\?\.\(\)/, 'in-world shipping interaction opens the standalone window');
assert.doesNotMatch(crates, /color: 0xe06820/, 'old orange placeholder shipping cube is removed');

assert.match(store, /data-general-store-cat="sell"/, 'General Store creates a dedicated Sell tab');
assert.match(store, /Sell 1/, 'General Store supports one-item sales');
assert.match(store, /Sell Stack/, 'General Store supports stack sales');
assert.match(store, /ShippingPanel\?\.getSellableInventory/, 'General Store lists only canonical sellable inventory');
assert.match(store, /ShippingPanel\?\.sellInventoryAtStore/, 'General Store sale actions use the shared sale bridge');

console.log('shipping box system regression checks passed');
