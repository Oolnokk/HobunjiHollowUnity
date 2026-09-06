'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const adapterPath = path.join(repoRoot, 'docs/js/house-pieces-registry-stability.js');
const loaderPath = path.join(repoRoot, 'docs/js/house-pieces.js');
const source = fs.readFileSync(adapterPath, 'utf8');
const loaderSource = fs.readFileSync(loaderPath, 'utf8');

assert.match(
  loaderSource,
  /\['HousePieces', 'house-pieces-core\.js\?v=[^']+'\],[\s\S]*\[null, 'house-pieces-registry-stability\.js\?v=20260906a'\],[\s\S]*\[null, 'house-pieces-elevation-bootstrap\.js\?v=[^']+'\]/,
  'registry stability adapter loads after the core and before elevation wrappers'
);

let registry = [{ id: 'house_starter', pieceKey: 'starter' }];
const calls = { clear: 0, set: 0, logs: [] };
const HousePieces = {
  init(injectedDeps) {
    this.__deps = injectedDeps;
  },
  clearAll() {
    calls.clear += 1;
    registry = []; // Reproduces the historical core behavior that broke cached loader references.
  },
};

const context = vm.createContext({
  window: { HousePieces },
  console,
});
vm.runInContext(source, context, { filename: 'house-pieces-registry-stability.js' });

const deps = {
  getHousePieces: () => registry,
  setHousePieces(next) { registry = next; calls.set += 1; },
  debugLog(message, level) { calls.logs.push({ message, level }); },
};
HousePieces.init(deps);

// Mirrors farm-editor.js: it caches the live array, clearAll runs, then the
// saved house records are pushed through that cached reference.
const loaderReference = registry;
HousePieces.clearAll();
assert.strictEqual(registry, loaderReference, 'clearAll keeps the original house registry authoritative');
assert.equal(registry.length, 0, 'preserved registry is emptied before restoration');

loaderReference.push({ id: 'house_starter', pieceKey: 'starter', stage: 'built' });
loaderReference.push({ id: 'house_starter_annex', pieceKey: 'starter', stage: 'built' });
assert.equal(registry.length, 2, 'restored records are visible through the authoritative registry');
assert.equal(registry[0].id, 'house_starter');
assert.equal(HousePieces.debugRegistryStability().hasStarter, true);
assert.equal(HousePieces.debugRegistryStability().pieceCount, 2);
assert.equal(HousePieces.debugRegistryStability().preservedClearCount, 1);
assert.equal(calls.clear, 1);
assert.equal(calls.set, 1);
assert.equal(calls.logs.length, 1);

// Re-running the adapter must not double-wrap clearAll.
vm.runInContext(source, context, { filename: 'house-pieces-registry-stability.js' });
HousePieces.clearAll();
assert.equal(calls.clear, 2, 'idempotent install keeps exactly one clearAll wrapper');
assert.equal(HousePieces.debugRegistryStability().preservedClearCount, 2);

console.log('house piece registry stability regression: ok');
