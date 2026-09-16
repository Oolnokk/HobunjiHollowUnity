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
  const checkpointLoadAt = loaderSource.indexOf('save-checkpoint-manager.js'); // Confirms recovery is in the normal folder-first bootstrap.
  assert.ok(runtimeFlushAt >= 0, 'local save bootstrap loads the runtime flush adapter');
  assert.ok(checkpointLoadAt > runtimeFlushAt, 'checkpoint manager loads after the runtime flush adapter');
  assert.match(folderCoreSource, /evaluateSnapshotForFolderWrite/, 'folder core consults the checkpoint guard before canonical writes');
  assert.match(folderCoreSource, /writeRecoveryCheckpoint/, 'folder core exposes whitelisted recovery-file persistence');
  assert.match(folderCoreSource, /readPrimarySnapshot/, 'folder core exposes canonical state for baseline/recovery');
  assert.match(folderCoreSource, /syncSnapshot/, 'folder core can commit one exact captured snapshot');
  assert.match(source, /automatic folder save is paused/, 'folder autosync is blocked while gameplay state is hydrating');
  assert.match(source, /folder-baseline/, 'old folders seed recovery from canonical state before future writes');
  assert.match(source, /rollbackRestore/, 'failed restores attempt a canonical folder rollback');

  const store = new Map(); // In-memory localStorage proves browser fallback remains independent from folder files.
  const localStorage = {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
  };

  let now = 1_000_000; // Synthetic clock advanced through the hydration grace window and checkpoint rotation.
  class TestDate extends Date {
    static now() { return now; }
  }

  const originalSnapshot = {
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
  let currentSnapshot = structuredClone(originalSnapshot); // Runtime/browser state returned by the snapshot API.
  let folderPrimarySnapshot = structuredClone(originalSnapshot); // Canonical folder state.
  const folderRecovery = new Map(); // Simulated recovery/ directory keyed by public slot name.
  let flushes = 0; // Counts runtime flushes before explicit checkpoint capture.
  let appliedSnapshot = null; // Last snapshot applied to browser state by recovery.
  let reloads = 0; // Successful recovery reload count.
  let folderSyncs = 0; // Successful/partially-successful canonical write attempts.
  let failNextFolderSyncAfterWrite = false; // Simulates I/O failure after canonical files already changed.
  const folderListeners = []; // Captures LocalSaveFolder status listeners.
  const documentListeners = new Map(); // Captures lifecycle listeners without a browser DOM.

  const document = {
    visibilityState: 'visible',
    addEventListener(type, listener) { documentListeners.set(type, listener); },
    querySelector() { return null; },
    getElementById() { return null; },
  };

  const folderStatus = {
    state: 'ready',
    autoSyncArmed: false,
    lastError: null,
    lastAction: 'ready',
    dataLossRisk: null,
  };

  const LocalSaveFolder = {
    getStatus: () => ({ ...folderStatus }),
    onChange(listener) { folderListeners.push(listener); return () => {}; },
    async readRecoveryCheckpoint(slot) {
      return folderRecovery.has(slot) ? structuredClone(folderRecovery.get(slot)) : null;
    },
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
        folderStatus.lastAction = guard.deferred
          ? 'autosync-deferred-hydration'
          : (options.automatic ? 'autosync-blocked-checkpoint-integrity' : 'save-blocked-checkpoint-integrity');
        folderStatus.dataLossRisk = guard.deferred ? null : guard.warning;
        return { ...folderStatus };
      }

      folderPrimarySnapshot = structuredClone(snapshot); // Happens before the simulated I/O failure to model a partial canonical write.
      folderSyncs++;
      if (failNextFolderSyncAfterWrite) {
        failNextFolderSyncAfterWrite = false;
        folderStatus.lastError = 'simulated partial folder write failure';
        folderStatus.lastAction = 'save-error';
        folderStatus.dataLossRisk = null;
        return { ...folderStatus };
      }

      folderStatus.lastError = null;
      folderStatus.dataLossRisk = null;
      folderStatus.lastAction = options.automatic ? 'autosaved-browser-to-folder' : 'saved-browser-to-folder';
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
      apply(snapshot) {
        appliedSnapshot = structuredClone(snapshot);
        currentSnapshot = structuredClone(snapshot);
      },
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
  const api = window.HobunjiSaveCheckpoints; // Public API used by folder core, menu UI, and diagnostics.
  assert.ok(api, 'checkpoint manager exposes its public API');

  let manualResult = await api.saveManual(); // Browser fallback manual save is independent from rolling autosave.
  assert.equal(manualResult.ok, true);
  assert.equal(manualResult.folder, false);
  assert.equal(flushes, 1, 'manual save flushes runtime farm/member data before snapshotting');
  assert.ok(store.has('hobunjiSaveCheckpoint.manual.v1'));
  assert.equal(store.has('hobunjiSaveCheckpoint.auto.v1'), false, 'manual save does not overwrite rolling autosave');

  let autoResult = await api.saveAuto({ reason: 'test-grace' });
  assert.equal(autoResult.skipped, true);
  assert.equal(autoResult.reason, 'load-grace');
  assert.equal(store.has('hobunjiSaveCheckpoint.auto.v1'), false);

  now += 46_000;
  autoResult = await api.saveAuto({ reason: 'test-first-auto' });
  assert.equal(autoResult.ok, true);
  const firstAutoRaw = store.get('hobunjiSaveCheckpoint.auto.v1');
  assert.ok(firstAutoRaw, 'first post-grace browser autosave is written');

  currentSnapshot.meta.worlds[0].members.char_a.nonGearInventory = {};
  currentSnapshot.meta.worlds[0].storage = {};
  currentSnapshot.meta.worlds[0].livestock = [];
  currentSnapshot.meta.characters[0].stable = [];
  now += 30_000;
  autoResult = await api.saveAuto({ reason: 'test-empty-reset' });
  assert.equal(autoResult.skipped, true);
  assert.equal(autoResult.reason, 'integrity');
  assert.equal(store.get('hobunjiSaveCheckpoint.auto.v1'), firstAutoRaw, 'bad browser autosave cannot replace last good checkpoint');

  currentSnapshot = structuredClone(originalSnapshot);
  currentSnapshot.meta.worlds[0].members.char_a.nonGearInventory.turnip = 7;
  now += 30_000;
  autoResult = await api.saveAuto({ reason: 'test-second-auto' });
  assert.equal(autoResult.ok, true);
  assert.ok(store.has('hobunjiSaveCheckpoint.autoPrevious.v1'), 'earlier browser autosave is retained separately');

  currentSnapshot.meta.characters.push({ id: 'char_b', stable: [] });
  currentSnapshot.meta.worlds.push({ id: 'world_b', members: { char_b: { nonGearInventory: {} } }, storage: {}, livestock: [] });
  currentSnapshot.farmLayouts.world_b = { tiles: [] };
  window.__hobunjiPlayerProfile = { characterId: 'char_b', worldId: 'world_b' };
  now += 30_000;
  autoResult = await api.saveAuto({ reason: 'test-save-slot-switch' });
  assert.equal(autoResult.ok, true, 'different empty farmer/world is not mistaken for prior farm reset');

  // Folder-first autosync can arm before gameplay hydration. It must not serialize transient
  // loader/default state even though the folder's own 1-second change poll is already active.
  folderStatus.autoSyncArmed = true;
  window.__hobunjiGameStarted = false;
  const preHydrationCandidate = structuredClone(folderPrimarySnapshot);
  preHydrationCandidate.meta.worlds[0].members.char_a.nonGearInventory.turnip = 6;
  const beforeHydrationSync = structuredClone(folderPrimarySnapshot);
  const hydrationStatus = await LocalSaveFolder.syncSnapshot(preHydrationCandidate, { automatic: true, recoveryKind: 'auto' });
  assert.match(hydrationStatus.lastError, /still hydrating/i, 'automatic folder save is deferred during gameplay hydration');
  assert.deepEqual(folderPrimarySnapshot, beforeHydrationSync, 'hydration-deferred autosave cannot touch canonical folder data');
  window.__hobunjiGameStarted = true;

  // Once a folder is armed, its recovery directory is authoritative. Browser history from a
  // previous fallback session/folder is cleared rather than silently imported into this folder.
  for (const listener of folderListeners) listener({ ...folderStatus });
  await api.syncRecoveryMirrorsFromFolder();
  assert.equal(folderRecovery.has('manual'), false, 'browser manual history is not auto-imported into a primary folder');
  assert.equal(folderRecovery.has('auto'), false, 'browser autosave history is not auto-imported into a primary folder');
  assert.equal(store.has('hobunjiSaveCheckpoint.manual.v1'), false, 'folder authority clears stale browser manual mirror when folder slot is absent');
  assert.equal(store.has('hobunjiSaveCheckpoint.auto.v1'), false, 'folder authority clears stale browser autosave mirror when folder slot is absent');

  // The selected char_b/world_b does not exist in Folder A, so baseline creation waits until
  // the actual selected farmer/world from that folder is ready.
  assert.equal(window.__hobunjiSaveCheckpointDebug.snapshot().folderBaselineSeeds, 0);
  window.__hobunjiPlayerProfile = { characterId: 'char_a', worldId: 'world_a' };
  currentSnapshot = structuredClone(folderPrimarySnapshot);
  await api.syncRecoveryMirrorsFromFolder();
  assert.ok(folderRecovery.has('auto'), 'old folder receives an autosave baseline from its own canonical state');
  assert.equal(folderRecovery.get('auto').reason, 'folder-baseline');
  assert.deepEqual(folderRecovery.get('auto').snapshot, folderPrimarySnapshot, 'baseline exactly matches canonical primary folder');
  assert.equal(window.__hobunjiSaveCheckpointDebug.snapshot().folderBaselineSeeds, 1);

  currentSnapshot.meta.worlds[0].members.char_a.nonGearInventory = {};
  currentSnapshot.meta.worlds[0].storage = {};
  currentSnapshot.meta.worlds[0].livestock = [];
  currentSnapshot.meta.characters[0].stable = [];
  const beforeFirstBadFolderWrite = structuredClone(folderPrimarySnapshot);
  const firstBadFolderStatus = await LocalSaveFolder.syncSnapshot(currentSnapshot, { automatic: true, recoveryKind: 'auto' });
  assert.ok(firstBadFolderStatus.lastError, 'first bad post-upgrade folder autosave is blocked by seeded baseline');
  assert.deepEqual(folderPrimarySnapshot, beforeFirstBadFolderWrite, 'first bad post-upgrade autosave leaves canonical folder untouched');

  // A safe canonical autosave advances latest recovery and rotates the seeded baseline.
  currentSnapshot = structuredClone(beforeFirstBadFolderWrite);
  currentSnapshot.meta.worlds[0].members.char_a.nonGearInventory.turnip = 7;
  now += 30_000;
  const safeFolderStatus = await LocalSaveFolder.syncSnapshot(currentSnapshot, { automatic: true, recoveryKind: 'auto' });
  assert.equal(safeFolderStatus.lastError, null);
  assert.deepEqual(folderRecovery.get('auto').snapshot, currentSnapshot, 'successful canonical autosave advances latest folder recovery');
  assert.ok(folderRecovery.has('autoPrevious'), 'seeded baseline rotates into earlier autosave');

  // Create one known-good manual checkpoint in folder-first mode.
  currentSnapshot.meta.worlds[0].members.char_a.nonGearInventory.turnip = 5;
  now += 30_000;
  manualResult = await api.saveManual();
  assert.equal(manualResult.ok, true, 'manual save commits through folder-first path');
  assert.equal(manualResult.folder, true);
  assert.deepEqual(folderRecovery.get('manual').snapshot, folderPrimarySnapshot, 'folder manual checkpoint equals canonical manual snapshot');
  const goodManualFolderRaw = JSON.stringify(folderRecovery.get('manual'));
  const goodManualBrowserRaw = store.get('hobunjiSaveCheckpoint.manual.v1');

  // A suspicious manual attempt must not destroy the previous good manual checkpoint before
  // the folder guard approves it. UI can explicitly force this only after confirmation.
  currentSnapshot.meta.worlds[0].members.char_a.nonGearInventory = {};
  currentSnapshot.meta.worlds[0].storage = {};
  currentSnapshot.meta.worlds[0].livestock = [];
  currentSnapshot.meta.characters[0].stable = [];
  manualResult = await api.saveManual();
  assert.equal(manualResult.ok, false);
  assert.equal(manualResult.needsConfirmation, true, 'suspicious manual save requires explicit confirmation');
  assert.equal(JSON.stringify(folderRecovery.get('manual')), goodManualFolderRaw, 'rejected manual save preserves folder manual checkpoint');
  assert.equal(store.get('hobunjiSaveCheckpoint.manual.v1'), goodManualBrowserRaw, 'rejected manual save preserves browser manual mirror');

  // Successful restore preserves the current canonical state first, then installs manual.
  const manualCheckpoint = structuredClone(folderRecovery.get('manual'));
  currentSnapshot = structuredClone(folderPrimarySnapshot);
  currentSnapshot.meta.worlds[0].members.char_a.nonGearInventory.turnip = 1;
  folderPrimarySnapshot = structuredClone(currentSnapshot);
  now += 60_000;
  let restoreResult = await api.restoreManual();
  assert.equal(restoreResult.ok, true);
  assert.equal(appliedSnapshot.meta.worlds[0].members.char_a.nonGearInventory.turnip, 5);
  assert.ok(folderRecovery.has('preRestore'), 'restore creates pre-restore recovery before canonical replacement');
  assert.equal(folderRecovery.get('preRestore').snapshot.meta.worlds[0].members.char_a.nonGearInventory.turnip, 1);
  assert.deepEqual(folderPrimarySnapshot, manualCheckpoint.snapshot, 'chosen recovery becomes canonical folder state');
  assert.equal(reloads, 1, 'successful recovery reloads once');

  // Simulate the next restore failing after the canonical folder has already changed. The
  // manager must force-write preRestore back to the folder, not merely fix browser storage.
  currentSnapshot = structuredClone(folderPrimarySnapshot);
  currentSnapshot.meta.worlds[0].members.char_a.nonGearInventory.turnip = 3;
  folderPrimarySnapshot = structuredClone(currentSnapshot);
  const beforeFailedRestore = structuredClone(folderPrimarySnapshot);
  now += 60_000;
  failNextFolderSyncAfterWrite = true;
  restoreResult = await api.restoreManual();
  assert.equal(restoreResult.ok, false, 'restore reports the simulated partial folder failure');
  assert.match(restoreResult.error, /original primary-folder save was restored/i, 'restore reports successful canonical rollback');
  assert.deepEqual(folderPrimarySnapshot, beforeFailedRestore, 'failed restore rolls canonical folder back to pre-restore state');
  assert.deepEqual(currentSnapshot, beforeFailedRestore, 'failed restore also rolls browser working state back');
  assert.equal(reloads, 1, 'failed restore does not reload as if recovery succeeded');
  assert.ok(api.getStatus().preRestore, 'pre-restore checkpoint remains available after rollback');
  assert.equal(window.__hobunjiSaveCheckpointDebug.snapshot().restoreRollbacks, 1, 'diagnostics record automatic folder rollback');
  assert.ok(folderSyncs >= 4, 'fixture exercised canonical autosave, manual save, restore, and rollback writes');

  console.log('save checkpoint manager folder-first regression: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
