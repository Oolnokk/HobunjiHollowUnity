#!/usr/bin/env node
'use strict';

// Execute the production morning-delivery function in an isolated world.
// This checks the real game.js delivery path rather than comparing source text.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const game = fs.readFileSync(path.join(__dirname, '..', 'docs', 'game.js'), 'utf8');
const start = game.indexOf('function worldObjectMorningTick()');
const end = game.indexOf('// Farm livestock also sit in worldObjects', start);
assert.ok(start >= 0 && end > start, 'production morning-delivery function is available');
const production = game.slice(start, end); // Executes the real morning delivery handler with controlled world storage and inventory.

let stock = { needlegrainSeeds: 3 }; // World-scoped Farm Storage, distinct from the player's bag.
let failStorage = false; // Simulates saving failure so a paid seed order must remain pending.
const messages = []; // Visible toast diagnostics used to verify delivery destinations.
let rendered = 0; // Supplies tab should refresh after morning processing.
const state = {
  window: { InventoryStacks: { MAX_TOTAL: 99 }, SupplyPage: { render() { rendered++; } } },
  calendar: { day: 7 },
  pendingOrders: undefined,
  inventory: { gold: 99, needlegrainSeeds: 11 },
  ITEM_DEFS: { needlegrainSeeds: { cat: 'seed' }, heftrootSeeds: { cat: 'seed' }, oomkaoiiCrate: { cat: 'livestock' } },
  SUPPLY_CATALOG: [],
  deliveryLog: [],
  menuOpen: true,
  _loadWorldStorage: () => ({ ...stock }),
  _saveWorldStorage: next => { if (failStorage) return false; stock = { ...next }; return true; },
  showToast: (message, good) => { messages.push({ message, good }); },
  tickWorldObjects() {},
};
const env = vm.createContext(state);
vm.runInContext(`let pendingOrders = [];
${production}
window.test = { morning: worldObjectMorningTick, add: order => pendingOrders.push(order), pending: () => pendingOrders.slice(), log: () => deliveryLog.slice() };
`, env, { filename: 'game.js:worldObjectMorningTick' });
const item = (key, name, gives) => ({ key, name, gives });
state.window.test.add({ key: 'needlegrainSeeds', qty: 2, arrivalDay: 7, item: item('needlegrainSeeds', 'Needlegrain Seeds', { needlegrainSeeds: 3 }) });
state.window.test.add({ key: 'heftrootSeeds', qty: 1, arrivalDay: 8, item: item('heftrootSeeds', 'Heftroot Seeds', { heftrootSeeds: 3 }) });
state.window.test.morning();
assert.equal(stock.needlegrainSeeds, 9, 'purchased seeds add to existing Farm Storage stacks');
assert.equal(state.inventory.needlegrainSeeds, 11, 'ordered seeds never enter the player bag');
assert.equal(state.window.test.pending().length, 1, 'future orders remain pending');
assert.match(state.window.test.log()[0].text, /delivered to Farm Storage/);
assert.ok(rendered > 0, 'Supplies view refreshes after delivery');

// A failed world save must not silently consume the paid order.
state.calendar.day = 8;
failStorage = true;
state.window.test.morning();
assert.equal(state.window.test.pending().length, 1);
assert.equal(stock.heftrootSeeds, undefined, 'failed storage write does not claim delivery');
assert.equal(state.inventory.heftrootSeeds, undefined);
assert.match(messages.at(-1).message, /order retained/);
failStorage = false;
state.window.test.morning();
assert.equal(stock.heftrootSeeds, 3, 'retained seed order successfully retries');
assert.equal(state.window.test.pending().length, 0);
state.window.test.morning();
assert.equal(stock.heftrootSeeds, 3, 'delivered orders do not duplicate');

// Non-seed orders still travel to the player's inventory.
state.window.test.add({ key: 'uumkaoiiCrate', qty: 1, arrivalDay: 8, item: item('uumkaoiiCrate', 'Crate', { oomkaoiiCrate: 1 }) });
state.window.test.morning();
assert.equal(state.inventory.oomkaoiiCrate, 1);
assert.equal(stock.oomkaoiiCrate, undefined);
console.log('ok - seed orders go straight to Farm Storage');
