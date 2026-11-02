#!/usr/bin/env node
'use strict';

// Executes the real world-meta-store.js: read-only loaders must not re-parse an
// unchanged save blob, must hand out private copies, and must see every write.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const store = new Map();
const localStorage = {
  getItem: key => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(key, String(value)); },
  removeItem: key => { store.delete(key); },
};
let parses = 0;
const JSONCounting = { parse: (text) => { parses++; return JSON.parse(text); }, stringify: JSON.stringify };
const window = { localStorage };
const context = vm.createContext({ window, localStorage, JSON: JSONCounting, performance, console, structuredClone });
vm.runInContext(fs.readFileSync('docs/js/world-meta-store.js', 'utf8'), context);
const api = window.WorldMetaStore;
const plain = value => JSON.stringify(value); // vm-realm arrays/objects fail deepEqual's prototype check.

localStorage.setItem('hobunjiSaveMeta', JSON.stringify({
  worlds: [{ id: 'w1', livestock: [{ id: 'a', hp: 3 }], breedingPairs: [], storage: { seed: 2 }, pendingSupplyOrders: [{ id: 'o1', key: 'seed', qty: 2, arrivalDay: 4 }] }],
}));

parses = 0;
const first = api.loadLivestock('w1');
for (let i = 0; i < 50; i++) api.loadStorage('w1');
assert.equal(parses, 1, 'an unchanged blob is parsed once, not once per call');

first[0].hp = 99; // Callers mutate what they receive.
assert.equal(api.loadLivestock('w1')[0].hp, 3, 'mutating a returned value never corrupts later reads');
assert.equal(plain(api.loadBreedingPairs('missing')), JSON.stringify([]), 'unknown world falls back to the empty default');

assert.equal(api.saveStorage('w1', { seed: 7 }), true);
assert.equal(plain(api.loadStorage('w1')), JSON.stringify({ seed: 7 }), 'writes are visible to the next read');
assert.equal(api.saveLivestock('w1', [{ id: 'b' }]), true);
assert.equal(api.loadLivestock('w1')[0].id, 'b');

assert.equal(api.completeSeedSupplyOrder('w1', { id: 'o1', key: 'seed', qty: 2, arrivalDay: 4 }, { seed: 1 }), true);
assert.equal(api.loadStorage('w1').seed, 9, 'compound write commits through to cached readers');
assert.equal(plain(api.loadPendingSupplyOrders('w1')), '[]');

localStorage.removeItem('hobunjiSaveMeta');
assert.equal(plain(api.loadStorage('w1')), JSON.stringify({}), 'a cleared save reads as empty');
console.log('world meta store cache: ok');
