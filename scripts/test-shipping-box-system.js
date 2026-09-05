'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const configSource = read('docs/js/shipping-box-config.js');
const shipping = read('docs/js/shipping-panel.js');
const crates = read('docs/js/farm-crates.js');
const store = read('docs/js/general-store.js');
const world = read('docs/js/shipping-box-world.js');

const configContext = { window: {} };
vm.runInNewContext(configSource, configContext, { filename: 'shipping-box-config.js' });
const config = configContext.window.ShippingBoxConfig;
const plain = value => JSON.parse(JSON.stringify(value));
assert.ok(config, 'ShippingBoxConfig loads as a standalone tuning module');

// All new Shipping Box modules consume the shared config rather than owning
// independent copies of Shipping-specific tuning values.
for (const [name, source] of [['ShippingPanel', shipping], ['FarmCrates', crates], ['GeneralStore', store], ['ShippingBoxWorld', world]]) {
  assert.match(source, /ShippingBoxConfig/, `${name} reads ShippingBoxConfig`);
}
assert.match(store, /shipping-box-config\.js[\s\S]*shipping-box-world\.js/, 'config loads before the world adapter');
assert.doesNotMatch(world, /carved_smooth\.png/, 'world implementation does not hardcode texture name');
assert.doesNotMatch(world, /#3FAF9F/i, 'world implementation does not hardcode verdigris color');
assert.doesNotMatch(crates, /hobunji-time-passage/, 'FarmCrates does not hardcode the time-passage event name');
assert.doesNotMatch(crates, /setInterval\(shippingLifecyclePulse,\s*500\)/, 'FarmCrates does not hardcode lifecycle cadence');
assert.doesNotMatch(crates, /area === 'farm' \|\| area === 'interior'/, 'FarmCrates does not hardcode farm-context areas');
assert.doesNotMatch(crates, /hasFarmPermission\(['"]storage['"]\)/, 'FarmCrates does not hardcode withdrawal permission');
assert.doesNotMatch(crates, /w:\s*2,\s*h:\s*1/, 'FarmCrates does not hardcode Shipping Box footprint');
assert.doesNotMatch(crates, /0\.06/, 'FarmCrates does not hardcode lid lift');

// Config owns the behavior/UI/material knobs requested in this work.
assert.deepStrictEqual(plain(config.object.footprint), { width: 2, height: 1 });
assert.strictEqual(config.object.blocksMovement, true);
assert.strictEqual(config.object.surfaceTileTypeKey, 'GRASS');
assert.strictEqual(config.object.lidLiftWhenOccupied, 0.06);
assert.strictEqual(config.lifecycle.pollMs, 500);
assert.deepStrictEqual(plain(config.lifecycle.resolveOnTimePassageKinds), ['wait', 'sleep']);
assert.deepStrictEqual(plain(config.lifecycle.farmContextAreas), ['farm', 'interior']);
assert.strictEqual(config.inventory.permissions.withdraw, 'storage');
assert.strictEqual(config.inventory.permissions.alterFarm, 'alterFarm');
assert.strictEqual(config.material.texture, 'carved_smooth.png');
assert.strictEqual(config.material.forceTextureOnEveryPart, true);
assert.strictEqual(config.material.copperVerdigris.toUpperCase(), '#3FAF9F');
assert.ok(config.panel.fontStack.includes('KhymeryyanRomanLetters+Numbers'));
assert.ok(config.panel.pointerBlockedEvents.includes('mousemove'));
assert.ok(config.panel.style.baseFont.includes('12px'), 'readable Shipping UI font floor stays config-driven');
assert.strictEqual(config.store.categoryKey, 'sell');
assert.ok(Number.isFinite(config.store.css.buttonMinWidthPx), 'General Store Shipping sell CSS lives in config');

// Standalone shipping window + input isolation still exist, now config-driven.
assert.match(shipping, /id = 'shippingStandaloneRoot'/, 'shipping creates a standalone root');
assert.match(shipping, /shippingStandaloneBody'\)\.appendChild\(pane\)/, 'existing transfer pane is reparented instead of duplicated');
assert.match(shipping, /pointerlockchange[\s\S]*releasePointerLock/, 'standalone shipping keeps pointer lock released');
assert.match(shipping, /stopImmediatePropagation\(\)[\s\S]*closeStandalone/, 'legacy pane close is intercepted before main-menu close handling');
assert.match(shipping, /panel\.pointerBlockedEvents\.forEach/, 'input-block list comes from config');
assert.match(shipping, /font-family:\$\{panel\.fontStack\}/, 'standalone typography comes from config');
assert.match(shipping, /getDebugState/, 'shipping exposes diagnostics');
assert.match(shipping, /configVersion/, 'shipping diagnostics report active config version');
assert.match(shipping, /#iiActions \.ii-btn\.sell\{display:none!important\}/, 'inventory direct-sale buttons remain unavailable');

// General Store Shipping sale surface uses configured category/copy/CSS and
// the same canonical sale-price bridge owned by ShippingPanel.
assert.match(store, /const css = store\.css/, 'General Store Shipping sell CSS reads config');
assert.match(store, /store\.categoryKey/, 'General Store sell category key is config-driven');
assert.match(store, /store\.sellOneLabel/, 'Sell 1 label is config-driven');
assert.match(store, /store\.sellStackLabel/, 'Sell Stack label is config-driven');
assert.match(store, /ShippingPanel\?\.getSellableInventory/, 'General Store lists canonical sellable inventory');
assert.match(store, /ShippingPanel\?\.sellInventoryAtStore/, 'General Store sale actions use shared sale bridge');

// Midnight is an accounting cutoff and only resolves at configured hand-off
// triggers; pending units remain separately tracked until then.
assert.match(crates, /const pendingSaleCounts = Object\.create\(null\)/, 'shipping tracks midnight-eligible quantities separately');
assert.match(crates, /function captureMidnightCutoff\(/, 'explicit midnight cutoff stage remains');
assert.match(crates, /available - alreadyPending/, 'post-cutoff deposits do not join the prior shipment');
assert.match(crates, /life\.resolveOnTimePassageKinds\.includes\(kind\)/, 'Wait/Sleep resolution kinds come from config');
assert.match(crates, /lifecycleCfg\(\)\.farmContextAreas\.includes\(area\)/, 'farm-context areas come from config');
assert.match(crates, /life\.reasons\.leftFarm/, 'leaving-farm settlement reason comes from config');
assert.match(crates, /pendingSaleCounts\[key\] = Math\.max\(0, pendingSaleCounts\[key\] - moved\)/, 'withdrawing before collection cancels pending units');
assert.doesNotMatch(crates, /gameHour - lastSellHour/, 'old rolling sale timer stays removed');

// Farm tab integration + placement are generic over configured footprint.
assert.match(crates, /const fp = footprintSize\(\)/, 'Farm UI/placement reads configured footprint');
assert.match(crates, /farmUiCfg\(\)/, 'Farm Buildings UI labels/ids are config-driven');
assert.match(crates, /inventoryCfg\(\)\.permissions\.alterFarm/, 'Farm move permission is config-driven');
assert.match(crates, /FarmBuildings\?\.canPlaceAt/, 'shipping movement reuses farm-building placement validation');
assert.match(crates, /footprintKeys\(box\.col, box\.row\)/, 'movement maintains every configured occupied tile');
assert.match(crates, /window\._farmEditor\?\.save\?\.\(\)/, 'movement persists through existing farm layout save path');

console.log('shipping box modular system regression checks passed');
