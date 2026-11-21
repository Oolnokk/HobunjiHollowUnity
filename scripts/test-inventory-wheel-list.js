#!/usr/bin/env node
'use strict';
// Runs js/inventory-wheel-list.js (the item wheel's list, extracted from game.js): a valid list is reused across
// frames without re-running the eligibility checks, and is rebuilt when the owned keys, a definition, the catalog,
// the held item or the eligibility provider change, when REFRESH_MS has passed, and every frame with the
// cross-frame reuse switched off. Also checks game.js delegates to it and index.html loads it first.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let clock = 0;
const eligibilityCalls = [];
const win = { ItemProcessing: { isWheelEligible: key => { eligibilityCalls.push(key); return !key.startsWith('mat'); } } };
win.window = win;
vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/js/inventory-wheel-list.js'), 'utf8'),
  vm.createContext({ window: win, performance: { now: () => clock }, Map, Object }), { filename: 'inventory-wheel-list.js' });
const W = win.InventoryWheelList;

const ITEM_DEFS = { seedA: { icon: 'a', label: 'Seed A' }, foodB: { icon: 'b', label: 'Food B' }, matC: { icon: 'c', label: 'Mat C' } };
const inventory = { gold: 50, seedA: 2, foodB: 1, matC: 5 };
const inventoryItems = [{ key: 'seedA', label: 'SEED A' }, { key: 'foodB', label: 'FOOD B' }];
let held = null, frame = 1;
W.init({ inventory, ITEM_DEFS, inventoryItems, getInventoryStackKeys: () => Object.keys(inventory).filter(k => k !== 'gold' && (inventory[k] || 0) > 0),
  getManualHeldItem: () => held, getFrameSerial: () => frame });
const keysOf = list => list.map(item => item.key);
const builds = () => W.snapshot().builds;

let list = W.getStackItems();
assert.deepEqual(keysOf(list), ['seedA', 'foodB'], 'owned, wheel-eligible stacks; gold and ineligible items left out');
assert.equal(list[0], inventoryItems[0], 'catalog entries are returned as is');
assert.equal(builds(), 1);
assert.equal(eligibilityCalls.length, 3);

// Next frames, nothing changed: reused without a single eligibility check.
for (let i = 0; i < 5; i++) { frame++; clock += 16; assert.equal(W.getStackItems(), list, 'same list object across frames'); }
assert.equal(builds(), 1, 'no rebuild while every input is unchanged');
assert.equal(eligibilityCalls.length, 3, 'and no eligibility checks');
assert.equal(W.snapshot().crossFrameReuses, 5);

// A count change that keeps the item owned does not change the list.
inventory.seedA = 1; frame++; clock += 16;
assert.equal(W.getStackItems(), list);
// Each input that can change the list rebuilds it at once.
const rebuildsOn = (label, change, undo) => {
  const before = builds(); change(); frame++; clock += 16;
  const next = W.getStackItems();
  assert.equal(builds(), before + 1, label + ' rebuilds the list');
  undo?.(); frame++; clock += 16; W.getStackItems();
  return next;
};
assert.deepEqual(keysOf(rebuildsOn('a newly owned item', () => { ITEM_DEFS.seedD = { icon: 'd', label: 'Seed D' }; inventory.seedD = 1; }, null)), ['seedA', 'foodB', 'seedD']);
assert.equal(W.getStackItems().find(item => item.key === 'seedD').label, 'SEED D', 'an item missing from the catalog gets a generated entry');
rebuildsOn('the last of an item used up', () => { inventory.foodB = 0; }, () => { inventory.foodB = 1; });
rebuildsOn('a replaced definition', () => { ITEM_DEFS.seedA = { ...ITEM_DEFS.seedA }; }, null);
rebuildsOn('a catalog change', () => { inventoryItems.push({ key: 'matC', label: 'MAT C' }); }, null);
rebuildsOn('a new manually held item', () => { held = { kind: 'clothing', uid: 1 }; }, null);
const provider = win.ItemProcessing.isWheelEligible;
rebuildsOn('a replaced eligibility provider', () => { win.ItemProcessing.isWheelEligible = key => provider(key); }, null);

// The safety refresh: rebuilt after REFRESH_MS even when nothing visible changed (late-loaded data).
let before = builds(); frame++; clock += W.REFRESH_MS + 1;
W.getStackItems();
assert.equal(builds(), before + 1, 'rebuilt once REFRESH_MS has passed');

// Within one frame the list is always reused (several consumers read it per frame).
before = builds(); frame++; clock += W.REFRESH_MS + 1;
W.getStackItems(); W.getStackItems(); W.getStackItems();
assert.equal(builds(), before + 1, 'one build per frame at most');

// Off (Settings / benchmark A/B): rebuilt every frame, as before.
assert.equal(W.setCrossFrameEnabled(false), false);
before = builds();
for (let i = 0; i < 3; i++) { frame++; clock += 16; W.getStackItems(); W.getStackItems(); }
assert.equal(builds(), before + 3, 'per-frame rebuild with cross-frame reuse off');
W.setCrossFrameEnabled(true);

// Wiring: game.js's delegation and init(deps) are executed by test-gorkunash-frame-costs.js; index.html loads it first.
const html = fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8');
assert.ok(html.indexOf('js/inventory-wheel-list.js?v=') > 0 && html.indexOf('js/inventory-wheel-list.js?v=') < html.indexOf('game.js?v='), 'loaded before game.js');
console.log('inventory wheel list: reused across frames, rebuilt on owned keys/definitions/catalog/held item/provider change, safety refresh, per-frame when off');
