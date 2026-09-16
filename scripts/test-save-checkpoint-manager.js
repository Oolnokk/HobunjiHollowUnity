'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const checkpointPath = path.join(repoRoot, 'docs/js/save-checkpoint-manager.js');
const loaderPath = path.join(repoRoot, 'docs/js/local-save-folder.js');
const source = fs.readFileSync(checkpointPath, 'utf8');
const loaderSource = fs.readFileSync(loaderPath, 'utf8');

const runtimeFlushAt = loaderSource.indexOf('folder-save-runtime-flush.js'); // Confirms the checkpoint layer can flush live farm state before capture.
const checkpointLoadAt = loaderSource.indexOf('save-checkpoint-manager.js'); // Confirms the new recovery layer is part of the normal persistence bootstrap.
assert.ok(runtimeFlushAt >= 0, 'local save bootstrap loads the runtime flush adapter');
assert.ok(checkpointLoadAt > runtimeFlushAt, 'checkpoint manager loads after the runtime flush adapter');

const store = new Map(); // In-memory localStorage used to prove the three checkpoint keys remain independent.
const localStorage = {
  getItem(key) { return store.has(key) ? store.get(key) : null; },
  setItem(key, value) { store.set(key, String(value)); },
  removeItem(key) { store.delete(key); },
};

let now = 1_000_000; // Synthetic clock advanced through the 45-second hydration grace window.
class TestDate extends Date {
  static now() { return now; }
}

let currentSnapshot = {
  snapshotVersion: 1,
  meta: {
    version: 1,
    characters: [{ id: 'char_a', stable: [{ id: 'stable_1' }, { id: 'stable_2' }] }],
    worlds: [{
      id: 'world_a',
      members: { char_a: { nonGearInventory: { turnip: 8, ore: 5, milk: 2 } } },
      storage: { hay: 20, seed: 12, wool: 4 },
      livestock: [{ id: 'livestock_1' }, { id: 'livestock_2' }],
    }],
  },
  farmLayouts: { world_a: { tiles: [1, 2, 3] } },
};
let flushes = 0; // Counts live-state flushes performed before manual/autosave checkpoint capture.
let appliedSnapshot = null; // Records which checkpoint restore replaced the canonical browser autosave.
let reloads = 0; // Ensures restore schedules the normal reload after applying a checkpoint.
const documentListeners = new Map(); // Captures lifecycle listeners without needing a browser DOM.

const document = {
  visibilityState: 'visible',
  addEventListener(type, listener) { documentListeners.set(type, listener); },
  querySelector() { return null; },
  getElementById() { return null; },
};

const window = {
  __hobunjiGameStarted: true,
  __hobunjiPlayerProfile: { characterId: 'char_a', worldId: 'world_a' },
  HobunjiRuntimeSave: {
    isReady: () => true,
    flushNow: () => { flushes += 1; return { ok: true }; },
  },
  HobunjiSaveSnapshot: {
    validate(snapshot) { assert.ok(snapshot?.meta?.characters && snapshot?.meta?.worlds); return snapshot; },
    capture() { return structuredClone(currentSnapshot); },
    fingerprint(snapshot) { return JSON.stringify(snapshot); },
    summary(snapshot) {
      return {
        snapshotVersion: 1,
        characterCount: snapshot.meta.characters.length,
        worldCount: snapshot.meta.worlds.length,
        farmLayoutCount: Object.keys(snapshot.farmLayouts).length,
      };
    },
    apply(snapshot) { appliedSnapshot = structuredClone(snapshot); },
  },
};

const context = vm.createContext({
  window,
  document,
  localStorage,
  console,
  Date: TestDate,
  structuredClone,
  confirm: () => true,
  alert: () => {},
  location: { reload: () => { reloads += 1; } },
  setInterval: () => 1,
  setTimeout: (fn) => { fn(); return 1; },
  clearInterval: () => {},
  Object,
  JSON,
  String,
  Number,
  Array,
  Map,
  Set,
  Error,
});

vm.runInContext(source, context, { filename: 'save-checkpoint-manager.js' });
const api = window.HobunjiSaveCheckpoints; // Public checkpoint API used by menu UI and mobile-visible diagnostics.
assert.ok(api, 'checkpoint manager exposes its public API');

const manualResult = api.saveManual(); // Explicit save must create only the manual checkpoint.
assert.equal(manualResult.ok, true);
assert.equal(flushes, 1, 'manual save flushes live farm/member data before snapshotting');
assert.ok(store.has('hobunjiSaveCheckpoint.manual.v1'));
assert.equal(store.has('hobunjiSaveCheckpoint.auto.v1'), false, 'manual save does not overwrite the rolling autosave');

let autoResult = api.saveAuto({ reason: 'test-grace' }); // First autosave attempt starts the hydration grace timer and must not write.
assert.equal(autoResult.skipped, true);
assert.equal(autoResult.reason, 'load-grace');
assert.equal(store.has('hobunjiSaveCheckpoint.auto.v1'), false);

now += 46_000;
autoResult = api.saveAuto({ reason: 'test-first-auto' }); // First safe post-load autosave becomes the current rolling checkpoint.
assert.equal(autoResult.ok, true);
assert.equal(store.has('hobunjiSaveCheckpoint.auto.v1'), true);
const firstAutoRaw = store.get('hobunjiSaveCheckpoint.auto.v1'); // Preserved for comparison after an intentionally bad live state.

currentSnapshot.meta.worlds[0].members.char_a.nonGearInventory = {};
currentSnapshot.meta.worlds[0].storage = {};
currentSnapshot.meta.worlds[0].livestock = [];
currentSnapshot.meta.characters[0].stable = [];
now += 30_000;
autoResult = api.saveAuto({ reason: 'test-empty-reset' }); // Reproduces the farm/inventory-reset signature the recovery autosave must reject.
assert.equal(autoResult.skipped, true);
assert.equal(autoResult.reason, 'integrity');
assert.equal(store.get('hobunjiSaveCheckpoint.auto.v1'), firstAutoRaw, 'suspicious empty farm state cannot replace the last good autosave checkpoint');

currentSnapshot.meta.worlds[0].members.char_a.nonGearInventory = { turnip: 7, ore: 5, milk: 2 };
currentSnapshot.meta.worlds[0].storage = { hay: 19, seed: 12, wool: 4 };
currentSnapshot.meta.worlds[0].livestock = [{ id: 'livestock_1' }, { id: 'livestock_2' }];
currentSnapshot.meta.characters[0].stable = [{ id: 'stable_1' }, { id: 'stable_2' }];
now += 30_000;
autoResult = api.saveAuto({ reason: 'test-second-auto' });
assert.equal(autoResult.ok, true);
assert.ok(store.has('hobunjiSaveCheckpoint.autoPrevious.v1'), 'a distinct earlier autosave is retained when the latest autosave advances');
assert.notEqual(store.get('hobunjiSaveCheckpoint.manual.v1'), store.get('hobunjiSaveCheckpoint.auto.v1'), 'manual and autosave checkpoints remain physically separate');

currentSnapshot.meta.characters.push({ id: 'char_b', stable: [] }); // Second save slot proves farm-specific integrity checks do not compare unrelated farmers.
currentSnapshot.meta.worlds.push({ id: 'world_b', members: { char_b: { nonGearInventory: {} } }, storage: {}, livestock: [] }); // Empty but legitimate second farm used by the save-slot-switch regression.
currentSnapshot.farmLayouts.world_b = { tiles: [] }; // Matching farm layout keeps the second world a complete snapshot.
window.__hobunjiPlayerProfile = { characterId: 'char_b', worldId: 'world_b' }; // Simulates choosing a different farmer/world after the earlier checkpoint.
now += 30_000;
autoResult = api.saveAuto({ reason: 'test-save-slot-switch' });
assert.equal(autoResult.ok, true, 'switching to a different empty farmer/world is not mistaken for the prior farm being reset');
assert.notEqual(autoResult.reason, 'integrity');

const restoreResult = api.restoreManual(); // Recovery should apply the explicit manual checkpoint rather than whatever the live autosave currently contains.
assert.equal(restoreResult.ok, true);
assert.equal(appliedSnapshot.meta.worlds[0].members.char_a.nonGearInventory.turnip, 8);
assert.equal(reloads, 1, 'restoring a checkpoint reloads into the recovered browser save');

console.log('save checkpoint manager regression: ok');
