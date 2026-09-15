'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { TextEncoder } = require('util');
const { webcrypto } = require('crypto');

const root = path.resolve(__dirname, '..'); // Resolves production persistence modules from this regression script.
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8'); // Reads browser source verbatim for VM execution.

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial)); // Backing map used to emulate browser localStorage for snapshot capture.
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    key(index) { return [...values.keys()][index] ?? null; },
    get length() { return values.size; },
  };
}

async function main() {
  const meta = {
    version: 1,
    characters: [{ id: 'char-a', nickname: 'Tester', inventory: { berry: 1 } }],
    worlds: [{ id: 'world-a', label: 'Hollow' }],
  }; // Browser save metadata mutated below to simulate subsequent gameplay commits.
  const localStorage = makeStorage({ hobunjiSaveMeta: JSON.stringify(meta) }); // Existing browser-save boundary consumed by save-snapshot-core.
  const memory = new Map(); // Injected durable-store backend used in lieu of IndexedDB inside Node.
  const window = { crypto: webcrypto, __hobunjiSaveSyncMemoryStorage: memory }; // Browser global exposing production Web Crypto and test store backend.
  const context = vm.createContext({ window, localStorage, TextEncoder, console, Map, Math, Date }); // VM context supplies only dependencies used by persistence modules.
  window.window = window;

  vm.runInContext(read('docs/js/save-snapshot-core.js'), context, { filename: 'save-snapshot-core.js' });
  vm.runInContext(read('docs/js/save-sync-envelope.js'), context, { filename: 'save-sync-envelope.js' });
  vm.runInContext(read('docs/js/save-sync-store.js'), context, { filename: 'save-sync-store.js' });
  vm.runInContext(read('docs/js/save-coordinator.js'), context, { filename: 'save-coordinator.js' });

  const coordinator = window.HobunjiSaveCoordinator; // Production local-commit orchestrator exercised below.
  const store = window.HobunjiSaveSyncStore; // Production durable store inspected to verify coordinator effects.

  const first = await coordinator.commitCurrent({ reason: 'test-first', pendingTargets: ['drive'] });
  assert.equal(first.ok, true, 'first browser snapshot commits successfully');
  assert.equal(first.changed, true, 'first browser snapshot creates a new envelope');
  assert.equal(first.envelope.revision, 1, 'first durable envelope starts at revision 1');
  assert.equal((await store.getPending('drive')).envelope.contentHash, first.envelope.contentHash, 'same transaction queues the first envelope for Drive');

  const unchanged = await coordinator.commitCurrent({ reason: 'test-unchanged' });
  assert.equal(unchanged.ok, true);
  assert.equal(unchanged.changed, false, 'unchanged gameplay state reuses the existing durable envelope');
  assert.equal(unchanged.envelope.revision, 1, 'unchanged save does not manufacture a new revision');

  meta.characters[0].inventory.berry = 2;
  localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
  const second = await coordinator.commitCurrent({ reason: 'test-changed' });
  assert.equal(second.ok, true);
  assert.equal(second.changed, true, 'changed browser gameplay state creates a new envelope');
  assert.equal(second.envelope.revision, 2, 'changed gameplay state increments the durable revision');
  assert.equal(second.envelope.parentContentHash, first.envelope.contentHash, 'new revision retains immediate content ancestry');
  assert.equal(second.envelope.saveSetId, first.envelope.saveSetId, 'new revision retains the same save-set identity');
  assert.equal(coordinator.getStatus().lastReason, 'test-changed', 'mobile-readable coordinator status reports the latest commit reason');

  console.log('Save coordinator regression checks passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
