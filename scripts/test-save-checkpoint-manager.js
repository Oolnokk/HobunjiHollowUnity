'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

(async () => {
  const repoRoot = path.resolve(__dirname, '..');
  const checkpointPath = path.join(repoRoot, 'docs/js/save-checkpoint-manager.js');
  const folderCorePath = path.join(repoRoot, 'docs/js/local-save-folder-core.js');
  const loaderPath = path.join(repoRoot, 'docs/js/local-save-folder.js');
  const source = fs.readFileSync(checkpointPath, 'utf8');
  const folderCoreSource = fs.readFileSync(folderCorePath, 'utf8');
  const loaderSource = fs.readFileSync(loaderPath, 'utf8');

  const runtimeFlushAt = loaderSource.indexOf('folder-save-runtime-flush.js'); // Confirms the checkpoint layer can flush live farm state before capture.
  const checkpointLoadAt = loaderSource.indexOf('save-checkpoint-manager.js'); // Confirms the recovery layer is part of the normal folder-first bootstrap.
  assert.ok(runtimeFlushAt >= 0, 'local save bootstrap loads the runtime flush adapter');
  assert.ok(checkpointLoadAt > runtimeFlushAt, 'checkpoint manager loads after the runtime flush adapter');
  assert.match(folderCoreSource, /evaluateSnapshotForFolderWrite/, 'folder core consults the checkpoint integrity guard before canonical writes');
  assert.match(folderCoreSource, /writeRecoveryCheckpoint/, 'folder core exposes whitelisted recovery-file persistence');
  assert.match(folderCoreSource, /readPrimarySnapshot/, 'folder core exposes the canonical folder snapshot for recovery display/pre-restore');
  assert.match(folderCoreSource, /syncSnapshot/, 'folder core can commit one exact captured snapshot for manual save and restore');

  const store = new Map(); // In-memory localStorage proves browser fallback slots remain independent from folder files.
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
  let folderPrimarySnapshot = structuredClone(currentSnapshot); // Canonical folder state returned before a recovery overwrites it.
  const folderRecovery = new Map(); // In-memory recovery directory keyed by manual/auto/autoPrevious/preRestore.
  let flushes = 0; // Counts live-state flushes before explicit browser-fallback checkpoint capture.
  let appliedSnapshot = null; // Records which checkpoint restore replaced the canonical browser autosave.
  let reloads = 0; // Ensures restore schedules the normal reload after applying a checkpoint.
  let folderSyncs = 0; // Counts exact snapshot commits into the mocked primary folder.
  const folderListeners = []; // Captures LocalSaveFolder status listeners so mirror sync can be driven explicitly.
  const documentListeners = new Map(); // Captures lifecycle listeners without needing a browser DOM.

  const document = {
    visibilityState: 'visible',
    addEventListener(type, listener) { documentListeners.set(type, listener); },
    querySelector() { return null; },
    getElementById() { return null; },
  };

  const folderStatus = { state: 'ready', autoSyncArmed: false, lastError: null }; // Starts as browser fallback; tests arm folder-first mode later.
  const LocalSaveFolder = {
    getStatus: () => ({ ...folderStatus }),
    onChange(listener) { folderListeners.push(listener); return () => {}; },
    async readRecoveryCheckpoints() {
      return Object.fromEntries(['manual', 'auto', 'autoPrevious', 'preRestore'].map(slot => [slot, folderRecovery.get(slot) || null]));
    },
    async writeRecoveryCheckpoint(slot, record) {
      folderRecovery.set(slot, structuredClone(record));
      return record;
    },
    async readPrimarySnapshot() {
      return { savedAt: now - 5000, snapshot: structuredClone(folderPrimarySnapshot) };
    },
    async syncSnapshot(snapshot, options = {}) {
      const guard = window.HobunjiSaveCheckpoints?.evaluateSnapshotForFolderWrite?.(snapshot, options);
      if (!options.force && guard?.ok === false) {
        folderStatus.lastError = `Skipped saving to the folder: ${guard.warning}`;
        return { ...folderStatus, dataLossRisk: guard.warning };
      }
      folderStatus.lastError = null;
      folderPrimarySnapshot = structuredClone(snapshot);
      folderSyncs++;
      await window.HobunjiSaveCheckpoints?.onFolderSnapshotWritten?.(structuredClone(snapshot), {
        automatic: !!options.automatic,
        savedAt: now,
        recoveryKind: options.recoveryKind || 'auto',
      });
      return { ...folderStatus };
    },
  };

  const window = {
    __hobunjiGameStarted: true,
    __hobunjiPlayerProfile: { characterId: 'char_a', worldId: 'world_a' },
    LocalSaveFolder,
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
      apply(snapshot) { appliedSnapshot = structuredClone(snapshot); currentSnapshot = structuredClone(snapshot); },
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
    Promise,
  });

  vm.runInContext(source, context, { filename: 'save-checkpoint-manager.js' });
  const api = window.HobunjiSaveCheckpoints; // Public checkpoint API used by folder core, menu UI, and mobile diagnostics.
  assert.ok(api, 'checkpoint manager exposes its public API');

  let manualResult = await api.saveManual(); // Browser-fallback manual save must not require or overwrite a folder.
  assert.equal(manualResult.ok, true);
  assert.equal(manualResult.folder, false);
  assert.equal(flushes, 1, 'manual save flushes live farm/member data before snapshotting');
  assert.ok(store.has('hobunjiSaveCheckpoint.manual.v1'));
  assert.equal(store.has('hobunjiSaveCheckpoint.auto.v1'), false, 'manual save does not overwrite the rolling autosave');

  let autoResult = await api.saveAuto({ reason: 'test-grace' }); // First fallback autosave starts the hydration grace timer and must not write.
  assert.equal(autoResult.skipped, true);
  assert.equal(autoResult.reason, 'load-grace');
  assert.equal(store.has('hobunjiSaveCheckpoint.auto.v1'), false);

  now += 46_000;
  autoResult = await api.saveAuto({ reason: 'test-first-auto' }); // First safe fallback autosave becomes the latest good recovery point.
  assert.equal(autoResult.ok, true);
  assert.equal(store.has('hobunjiSaveCheckpoint.auto.v1'), true);
  const firstAutoRaw = store.get('hobunjiSaveCheckpoint.auto.v1'); // Preserved for comparison after an intentionally bad live state.

  currentSnapshot.meta.worlds[0].members.char_a.nonGearInventory = {};
  currentSnapshot.meta.worlds[0].storage = {};
  currentSnapshot.meta.worlds[0].livestock = [];
  currentSnapshot.meta.characters[0].stable = [];
  now += 30_000;
  autoResult = await api.saveAuto({ reason: 'test-empty-reset' }); // Reproduces the farm/inventory-reset signature the recovery autosave must reject.
  assert.equal(autoResult.skipped, true);
  assert.equal(autoResult.reason, 'integrity');
  assert.equal(store.get('hobunjiSaveCheckpoint.auto.v1'), firstAutoRaw, 'suspicious empty farm state cannot replace the last good fallback autosave');
  assert.equal(api.evaluateSnapshotForFolderWrite(currentSnapshot).ok, false, 'the same suspicious state is rejected before a canonical folder write');

  currentSnapshot.meta.worlds[0].members.char_a.nonGearInventory = { turnip: 7, ore: 5, milk: 2 };
  currentSnapshot.meta.worlds[0].storage = { hay: 19, seed: 12, wool: 4 };
  currentSnapshot.meta.worlds[0].livestock = [{ id: 'livestock_1' }, { id: 'livestock_2' }];
  currentSnapshot.meta.characters[0].stable = [{ id: 'stable_1' }, { id: 'stable_2' }];
  now += 30_000;
  autoResult = await api.saveAuto({ reason: 'test-second-auto' });
  assert.equal(autoResult.ok, true);
  assert.ok(store.has('hobunjiSaveCheckpoint.autoPrevious.v1'), 'a distinct earlier fallback autosave is retained when the latest autosave advances');

  currentSnapshot.meta.characters.push({ id: 'char_b', stable: [] }); // Second save slot proves farm-specific integrity checks do not compare unrelated farmers.
  currentSnapshot.meta.worlds.push({ id: 'world_b', members: { char_b: { nonGearInventory: {} } }, storage: {}, livestock: [] });
  currentSnapshot.farmLayouts.world_b = { tiles: [] };
  window.__hobunjiPlayerProfile = { characterId: 'char_b', worldId: 'world_b' };
  now += 30_000;
  autoResult = await api.saveAuto({ reason: 'test-save-slot-switch' });
  assert.equal(autoResult.ok, true, 'switching to a different empty farmer/world is not mistaken for the prior farm being reset');

  // Arm folder-first mode. Existing browser checkpoints seed an older folder's
  // missing recovery directory, after which folder copies become authoritative.
  folderStatus.autoSyncArmed = true;
  for (const listener of folderListeners) listener({ ...folderStatus });
  await api.syncRecoveryMirrorsFromFolder();
  assert.ok(folderRecovery.has('manual'), 'existing browser manual checkpoint migrates into recovery/manual.json when an older folder is adopted');
  assert.ok(folderRecovery.has('auto'), 'existing browser latest autosave migrates into recovery/autosave-latest.json');

  // Return to the original farm for same-save folder integrity coverage.
  window.__hobunjiPlayerProfile = { characterId: 'char_a', worldId: 'world_a' };
  currentSnapshot = structuredClone(folderPrimarySnapshot);
  currentSnapshot.meta.worlds[0].members.char_a.nonGearInventory = { turnip: 6, ore: 5, milk: 2 };
  now += 30_000;
  await window.HobunjiSaveCheckpoints.onFolderSnapshotWritten(currentSnapshot, { automatic: true, savedAt: now, recoveryKind: 'auto' });
  assert.deepEqual(folderRecovery.get('auto').snapshot, currentSnapshot, 'successful canonical folder autosync advances recovery/autosave-latest.json with the same snapshot');

  currentSnapshot.meta.worlds[0].members.char_a.nonGearInventory = {};
  currentSnapshot.meta.worlds[0].storage = {};
  currentSnapshot.meta.worlds[0].livestock = [];
  currentSnapshot.meta.characters[0].stable = [];
  const folderBeforeBadSync = structuredClone(folderPrimarySnapshot);
  const folderBadStatus = await LocalSaveFolder.syncSnapshot(currentSnapshot, { automatic: true, recoveryKind: 'auto' });
  assert.ok(folderBadStatus.lastError, 'suspicious empty farm is blocked before the mocked canonical folder write');
  assert.deepEqual(folderPrimarySnapshot, folderBeforeBadSync, 'blocked autosave leaves canonical folder data untouched');

  currentSnapshot = structuredClone(folderBeforeBadSync);
  currentSnapshot.meta.worlds[0].members.char_a.nonGearInventory.turnip = 5;
  now += 30_000;
  manualResult = await api.saveManual();
  assert.equal(manualResult.ok, true, 'manual save commits into folder-first workflow when the folder is armed');
  assert.equal(manualResult.folder, true);
  assert.ok(folderSyncs >= 1, 'manual save writes the exact flushed snapshot into the canonical folder');
  assert.deepEqual(folderRecovery.get('manual').snapshot, folderPrimarySnapshot, 'recovery/manual.json matches the canonical manual snapshot');

  const manualCheckpoint = structuredClone(folderRecovery.get('manual'));
  currentSnapshot.meta.worlds[0].members.char_a.nonGearInventory.turnip = 1;
  folderPrimarySnapshot = structuredClone(currentSnapshot);
  now += 60_000;
  const restoreResult = await api.restoreManual(); // Recovery preserves current canonical state as pre-restore before replacing it.
  assert.equal(restoreResult.ok, true);
  assert.equal(appliedSnapshot.meta.worlds[0].members.char_a.nonGearInventory.turnip, manualCheckpoint.snapshot.meta.worlds[0].members.char_a.nonGearInventory.turnip);
  assert.ok(folderRecovery.has('preRestore'), 'restore creates recovery/pre-restore.json before canonical replacement');
  assert.equal(folderRecovery.get('preRestore').snapshot.meta.worlds[0].members.char_a.nonGearInventory.turnip, 1, 'pre-restore checkpoint contains the canonical folder state that was about to be replaced');
  assert.deepEqual(folderPrimarySnapshot, manualCheckpoint.snapshot, 'chosen recovery checkpoint becomes the new canonical folder state');
  assert.equal(reloads, 1, 'successful recovery reloads into the recovered save');

  console.log('save checkpoint manager folder-first regression: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
