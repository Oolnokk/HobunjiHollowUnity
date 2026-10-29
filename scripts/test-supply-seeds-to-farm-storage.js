#!/usr/bin/env node
'use strict';

// Exercises the REAL production morning delivery and WorldMetaStore transaction in a VM.
// Includes reload, cross-world isolation, repeated delivery and failed atomic writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'docs', file), 'utf8');
const game = read('game.js'); // Production morning handler must be used, not a rewritten model.
const start = game.indexOf('function worldObjectMorningTick()');
const end = game.indexOf('// Farm livestock also sit in worldObjects', start);
assert.ok(start >= 0 && end > start);
const production = game.slice(start, end);

let meta = { worlds: [
  { id: 'farm-A', storage: { needlegrainSeeds: 3 }, pendingSupplyOrders: [] },
  { id: 'farm-B', storage: { needlegrainSeeds: 50 }, pendingSupplyOrders: [] },
] }; // Canonical world-scoped save metadata shared by both the receipt queue and Farm Storage.
let failSeedCommit = false; // Simulates quota/disk failure on the transaction (no partial credit allowed).
const localStorage = {
  getItem: () => JSON.stringify(meta),
  setItem: (key, value) => {
    assert.equal(key, 'hobunjiSaveMeta');
    const next = JSON.parse(value);
    if (failSeedCommit && next.worlds[0].storage.needlegrainSeeds !== meta.worlds[0].storage.needlegrainSeeds) throw new Error('quota exceeded');
    meta = next;
  },
};
const messages = []; // In-game delivery error/success messages and their visibility.
const state = {
  window: { InventoryStacks: { MAX_TOTAL: 99 }, SupplyPage: { render() {} } },
  localStorage,
  calendar: { day: 7 },
  inventory: { gold: 99, needlegrainSeeds: 11 },
  ITEM_DEFS: { needlegrainSeeds: { cat: 'seed' }, heftrootSeeds: { cat: 'seed' }, oomkaoiiCrate: { cat: 'livestock' } },
  SUPPLY_CATALOG: [],
  deliveryLog: [],
  menuOpen: true,
  _tothalWorldId: () => 'farm-A',
  showToast: (message, good) => { messages.push({ message, good }); },
  saveMemberWorldData: () => {
    const updated = JSON.parse(localStorage.getItem('hobunjiSaveMeta'));
    updated.worlds[0].pendingSupplyOrders = state.window.test.pending();
    updated.worlds[0].inventory = { ...state.inventory };
    localStorage.setItem('hobunjiSaveMeta', JSON.stringify(updated));
  },
  tickWorldObjects() {},
};
const env = vm.createContext(state);
vm.runInContext(read('js/world-meta-store.js'), env, { filename: 'world-meta-store.js' });
vm.runInContext(`let pendingOrders = [];
${production}
window.test = { morning: worldObjectMorningTick, add: order => pendingOrders.push(order), pending: () => pendingOrders.slice(), restore: orders => { pendingOrders = [...orders]; }, log: () => deliveryLog.slice() };
`, env, { filename: 'game.js:worldObjectMorningTick' });
const { test, WorldMetaStore } = state.window;
const seedItem = { key: 'needlegrainSeeds', name: 'Needlegrain Seeds', gives: { needlegrainSeeds: 3 } };
test.add({ id: 'seed-A', key: 'needlegrainSeeds', qty: 2, arrivalDay: 7, item: seedItem });
test.add({ id: 'seed-B', key: 'heftrootSeeds', qty: 1, arrivalDay: 8, item: { key: 'heftrootSeeds', name: 'Heftroot Seeds', gives: { heftrootSeeds: 3 } } });
state.saveMemberWorldData(); // SupplyPage persists the paid receipt as soon as the order is placed.
assert.equal(WorldMetaStore.loadPendingSupplyOrders('farm-A').length, 2);
assert.equal(WorldMetaStore.loadPendingSupplyOrders('farm-B').length, 0);
test.morning();
assert.equal(WorldMetaStore.loadStorage('farm-A').needlegrainSeeds, 9, '2 packs × 3 seeds credited to world storage');
assert.equal(state.inventory.needlegrainSeeds, 11, 'purchased seeds never enter the bag');
assert.equal(WorldMetaStore.loadStorage('farm-B').needlegrainSeeds, 50, 'another farm world remains untouched');
assert.equal(test.pending().length, 1);
assert.equal(WorldMetaStore.loadPendingSupplyOrders('farm-A').length, 1, 'delivered receipt cleared durably');
assert.match(test.log()[0].text, /delivered to Farm Storage/);

// A failed write must not partially debit the receipt or credit the seeds.
state.calendar.day = 8;
failSeedCommit = true;
test.morning();
assert.equal(test.pending().length, 1);
assert.equal(WorldMetaStore.loadStorage('farm-A').heftrootSeeds, undefined);
assert.equal(WorldMetaStore.loadPendingSupplyOrders('farm-A').length, 1);
assert.match(messages.at(-1).message, /order retained/);
failSeedCommit = false;
test.restore(WorldMetaStore.loadPendingSupplyOrders('farm-A')); // Simulates reload before retry.
test.morning();
assert.equal(WorldMetaStore.loadStorage('farm-A').heftrootSeeds, 3);
assert.equal(test.pending().length, 0);
assert.equal(WorldMetaStore.loadPendingSupplyOrders('farm-A').length, 0);
test.restore([{ id: 'seed-B', key: 'heftrootSeeds', qty: 1, arrivalDay: 8, item: { key: 'heftrootSeeds', name: 'Heftroot Seeds', gives: { heftrootSeeds: 3 } } }]);
test.morning();
assert.equal(WorldMetaStore.loadStorage('farm-A').heftrootSeeds, 3, 'replaying a completed seed receipt cannot duplicate inventory');

// Non-seed purchases remain bag deliveries and clear their saved receipt.
test.restore([]);
test.add({ id: 'crate', key: 'uumkaoiiCrate', qty: 1, arrivalDay: 8, item: { key: 'uumkaoiiCrate', name: 'Crate', gives: { oomkaoiiCrate: 1 } } });
state.saveMemberWorldData();
test.morning();
assert.equal(state.inventory.oomkaoiiCrate, 1);
assert.equal(WorldMetaStore.loadStorage('farm-A').oomkaoiiCrate, undefined);
assert.equal(WorldMetaStore.loadPendingSupplyOrders('farm-A').length, 0);
console.log('ok - seed receipts persist, credit storage atomically, and survive reload');
