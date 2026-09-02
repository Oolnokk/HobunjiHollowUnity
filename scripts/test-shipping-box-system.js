'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const shipping = read('docs/js/shipping-panel.js');
const crates = read('docs/js/farm-crates.js');
const store = read('docs/js/general-store.js');

// Standalone shipping window + input isolation.
assert.match(shipping, /id = 'shippingStandaloneRoot'/, 'shipping creates a standalone root');
assert.match(shipping, /shippingStandaloneBody'\)\.appendChild\(pane\)/, 'existing shipping transfer pane is reparented instead of duplicated');
assert.match(shipping, /pointerlockchange[\s\S]*releasePointerLock/, 'standalone shipping keeps pointer lock released');
assert.match(shipping, /stopImmediatePropagation\(\)[\s\S]*closeStandalone/, 'legacy pane close is intercepted before main-menu close handling');
assert.match(shipping, /getDebugState/, 'shipping exposes mobile-friendly diagnostic state');

// Readability: use the regular game-menu font stack and stop inheriting the
// old 7-10px transfer typography in the standalone window.
assert.match(shipping, /KhymeryyanRomanLetters\+Numbers[\s\S]*Pixelify Sans[\s\S]*DM Mono/, 'shipping uses the regular menu font stack');
assert.match(shipping, /--tr-font-xs: clamp\(11px, 1\.35vmin, 14px\)/, 'shipping small text has a readable floor');
assert.match(shipping, /--tr-font-sm: clamp\(13px, 1\.65vmin, 17px\)/, 'shipping normal text has a readable floor');
assert.match(shipping, /midnight-ready/, 'shipping status communicates midnight-ready quantities');

// Economy routing: ordinary Inventory selling stays unavailable; General
// Store and Shipping Box share one canonical sell-price bridge.
assert.match(shipping, /#iiActions \.ii-btn\.sell \{ display: none !important; \}/, 'inventory direct-sale buttons are unavailable');
assert.match(shipping, /getSellableInventory/, 'shipping exposes canonical sellable stack data to the General Store');
assert.match(shipping, /sellInventoryAtStore/, 'General Store sales share the canonical shipping price bridge');
assert.match(store, /data-general-store-cat="sell"/, 'General Store creates a dedicated Sell tab');
assert.match(store, /Sell 1/, 'General Store supports one-item sales');
assert.match(store, /Sell Stack/, 'General Store supports stack sales');
assert.match(store, /ShippingPanel\?\.getSellableInventory/, 'General Store lists only canonical sellable inventory');
assert.match(store, /ShippingPanel\?\.sellInventoryAtStore/, 'General Store sale actions use the shared sale bridge');

// World visual + movement.
assert.match(crates, /ProceduralFurniture[\s\S]*CATALOG\?\.chest/, 'shipping reuses the existing Storage Chest recipe');
assert.match(crates, /sx: Math\.max\(0\.001, \(part\.transform\?\.sx \|\| 0\.001\) \* 2\)/, 'shipping chest is stretched to two-tile width');
assert.match(crates, /w: 2, h: 1/, 'shipping publishes a two-by-one footprint');
assert.match(crates, /set col\(value\)[\s\S]*moveTo/, 'editor coordinate writes resync the visual');
assert.match(crates, /lid\.add\(latch\)/, 'latch follows the lid so editor cleanup leaves no orphan mesh');
assert.match(crates, /ShippingPanel\?\.open\?\.\(\)/, 'in-world shipping interaction opens the standalone window');
assert.doesNotMatch(crates, /color: 0xe06820/, 'old orange placeholder shipping cube is removed');

// Midnight is the accounting cutoff, not an immediate visual emptying event.
assert.match(crates, /const pendingSaleCounts = Object\.create\(null\)/, 'shipping tracks midnight-eligible quantities separately from visible box contents');
assert.match(crates, /function captureMidnightCutoff\(/, 'shipping has an explicit midnight cutoff stage');
assert.match(crates, /available - alreadyPending/, 'post-midnight deposits are not swept into the previous cutoff');
assert.match(crates, /hobunji-time-passage/, 'Wait and Sleep use the calendar system completion event');
assert.match(crates, /kind !== 'wait' && kind !== 'sleep'/, 'only explicit Wait/Sleep passage resolves through the time-passage hook');
assert.match(crates, /settlePendingShippingSale\('left farm'\)/, 'leaving the farm resolves a pending midnight shipment');
assert.match(crates, /area === 'farm' \|\| area === 'interior'/, 'entering the farmhouse does not count as leaving the farm');
assert.match(crates, /pendingSaleCounts\[key\] = Math\.max\(0, pendingSaleCounts\[key\] - moved\)/, 'withdrawing before deferred resolution cancels those pending units');
assert.doesNotMatch(crates, /gameHour - lastSellHour/, 'shipping no longer uses the old rolling hour timer');
assert.doesNotMatch(crates, /Sell everything every SELL_INTERVAL_HOURS/, 'shipping no longer documents the obsolete rolling sale schedule');

// Farm tab integration: the Shipping Box appears in the same Buildings list
// and uses that tab's farm overview + placement legality path to move.
assert.match(crates, /farmBuildingsList/, 'shipping integrates with the Farm tab Buildings list');
assert.match(crates, /farmGlanceCanvas/, 'shipping movement uses the existing Farm overview canvas');
assert.match(crates, /farmBuildingKind = 'shipping-box'/, 'shipping adds a dedicated Buildings-list row');
assert.match(crates, /settings-small-btn/, 'shipping Move control uses the existing Farm row button class');
assert.match(crates, /function patchFarmPanel[\s\S]*Object\.defineProperty\(window, 'FarmPanel'/, 'shipping captures FarmPanel dependencies regardless of script/init order');
assert.match(crates, /FarmBuildings\?\.canPlaceAt/, 'shipping movement reuses farm-building placement validation');
assert.match(crates, /function installShippingPlacementGuard[\s\S]*rectsOverlap/, 'barn placement also respects the Shipping Box full two-tile footprint');
assert.match(crates, /worldObjects\.delete\(oldKey\)[\s\S]*box\.moveTo\(col, row\)[\s\S]*worldObjects\.set/, 'shipping movement preserves the existing box instance and its contents');
assert.match(crates, /window\._farmEditor\?\.save\?\.\(\)/, 'shipping movement persists through the existing farm layout save path');

console.log('shipping box system regression checks passed');
