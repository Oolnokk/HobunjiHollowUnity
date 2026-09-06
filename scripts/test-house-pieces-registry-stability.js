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

const LAYOUT_KEY = 'hobunji_farm_layout_v3:test-world';
const BACKUP_KEY = LAYOUT_KEY + ':house-layout-backup-v1';
const storage = new Map();
const initialLayout = {
  version: 3,
  tiles: [{ c: 1, r: 1, type: 'grass' }],
  housePieces: [
    { id: 'house_starter', pieceKey: 'starter', col: 8, row: 6, w: 4, h: 3, stage: 'built' },
    { id: 'house_starter_annex', pieceKey: 'starter', col: 12, row: 6, w: 3, h: 3, stage: 'built' },
  ],
};
storage.set(LAYOUT_KEY, JSON.stringify(initialLayout));

const localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); },
};

let registry = [{ id: 'house_starter', pieceKey: 'starter' }];
const calls = { clear: 0, set: 0, logs: [], saves: 0, loads: 0 };
const HousePieces = {
  init(injectedDeps) {
    this.__deps = injectedDeps;
  },
  clearAll() {
    calls.clear += 1;
    registry = []; // Reproduces the historical core behavior that broke cached loader references.
  },
};
const FarmEditor = {
  farmLayoutKey() { return LAYOUT_KEY; },
  loadFarmLayout() {
    calls.loads += 1;
    const raw = localStorage.getItem(LAYOUT_KEY);
    return raw ? JSON.parse(raw) : null;
  },
  saveFarmLayout() {
    calls.saves += 1;
    const layout = { version: 3, tiles: [], objects: {}, furniture: [], decor: [] };
    if (registry.length) layout.housePieces = registry.map(piece => ({ ...piece }));
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    return true;
  },
};

const context = vm.createContext({
  window: { HousePieces, FarmEditor },
  localStorage,
  console,
});
vm.runInContext(source, context, { filename: 'house-pieces-registry-stability.js' });

// The first load happens before HousePieces.init in the real game. It must
// still seed a last-known-good layout backup without needing HousePieces deps.
const firstLoad = FarmEditor.loadFarmLayout();
assert.equal(firstLoad.housePieces.length, 2, 'valid stored house layout loads normally');
assert.deepEqual(JSON.parse(localStorage.getItem(BACKUP_KEY)).housePieces.map(piece => piece.id), ['house_starter', 'house_starter_annex']);

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

for (const saved of firstLoad.housePieces) loaderReference.push({ ...saved });
assert.equal(registry.length, 2, 'restored records are visible through the authoritative registry');
assert.equal(registry[0].id, 'house_starter');
assert.equal(HousePieces.debugRegistryStability().hasStarter, true);
assert.equal(HousePieces.debugRegistryStability().pieceCount, 2);
assert.equal(HousePieces.debugRegistryStability().preservedClearCount, 1);
assert.equal(calls.clear, 1);
assert.equal(calls.set, 1);

// A normal exported save with a healthy registry stays allowed and refreshes
// the backup from the just-written authoritative layout.
assert.equal(FarmEditor.saveFarmLayout(), true);
assert.equal(calls.saves, 1);
assert.equal(JSON.parse(localStorage.getItem(BACKUP_KEY)).housePieces.length, 2);

// Reproduce the dangerous post-load failure: the live registry suddenly loses
// the starter while the stored/backup layout is still valid. pagehide and
// beforeunload call this exported save path, which must now refuse the write.
registry.length = 0;
const storedBeforeBlockedSave = localStorage.getItem(LAYOUT_KEY);
assert.equal(FarmEditor.saveFarmLayout(), false, 'invalid transient live registry cannot overwrite a previously valid house save');
assert.equal(calls.saves, 1, 'blocked save never reaches the original serializer');
assert.equal(localStorage.getItem(LAYOUT_KEY), storedBeforeBlockedSave, 'blocked save leaves the authoritative stored layout untouched');
assert.equal(HousePieces.debugRegistryStability().blockedInvalidSaveCount, 1);

// FarmEditor-internal lexical saves cannot be monkey-patched from outside the
// module. Simulate one writing a layout without housePieces; guarded loading
// must repair just the house records from the last-known-good full-layout backup.
localStorage.setItem(LAYOUT_KEY, JSON.stringify({ version: 3, tiles: [{ c: 9, r: 9, type: 'tilled' }], objects: {} }));
const recovered = FarmEditor.loadFarmLayout();
assert.deepEqual(recovered.tiles, [{ c: 9, r: 9, type: 'tilled' }], 'recovery preserves newer non-house farm changes');
assert.deepEqual(recovered.housePieces.map(piece => piece.id), ['house_starter', 'house_starter_annex'], 'recovery restores house records from backup');
assert.equal(HousePieces.debugRegistryStability().recoveredBackupCount, 1);
assert.equal(HousePieces.debugRegistryStability().backupHasStarter, true);

// Re-running the adapter must not double-wrap clearAll or save/load.
vm.runInContext(source, context, { filename: 'house-pieces-registry-stability.js' });
registry.push(...recovered.housePieces.map(piece => ({ ...piece })));
HousePieces.clearAll();
assert.equal(calls.clear, 2, 'idempotent install keeps exactly one clearAll wrapper');
assert.equal(HousePieces.debugRegistryStability().preservedClearCount, 2);

console.log('house piece registry stability + persistence guard regression: ok');
