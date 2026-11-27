'use strict';

// Real primary-folder save core with a deterministic File System Access adapter.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function missing() {
  return Object.assign(new Error('Not found'), { name: 'NotFoundError' });
}

function directory(name, counters) {
  const files = new Map(); // Files accessible by the test when simulating an outside editor or a deleted save.
  const folders = new Map(); // Nested character/world/farm/recovery directories for real persistence calls.
  return {
    name, kind: 'directory', files, folders,
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    async getDirectoryHandle(key, { create = false } = {}) {
      if (!folders.has(key)) {
        if (!create) throw missing();
        folders.set(key, directory(key, counters));
      }
      return folders.get(key);
    },
    async getFileHandle(key, { create = false } = {}) {
      if (!files.has(key)) {
        if (!create) throw missing();
        let raw = ''; // Durable bytes change only after close, just like createWritable.
        let modified = ++counters.clock; // Used by the incremental writer's external-edit protection.
        files.set(key, {
          kind: 'file',
          replaceBytesPreservingMetadata(next) { raw = String(next); }, // Models an external restore that preserves file size and modification time.
          getFile: async () => {
            counters.reads.push(name + '/' + key); // Verifies a fast lock save does not even inspect large farm/recovery files.
            if (counters.onFileRead) {
              const listener = counters.onFileRead; // Single injected in-flight edit for no-op race regression.
              counters.onFileRead = null;
              listener(name, key);
            }
            return { text: async () => raw, size: raw.length, lastModified: modified };
          },
          async createWritable() {
            if (counters.fail) throw new Error('Simulated disk failure');
            let pending = ''; // Staged data never appears as committed until close succeeds.
            return {
              async write(value) { pending = String(value); },
              async close() { raw = pending; modified = ++counters.clock; counters.writes.push(name + '/' + key); },
            };
          },
        });
      }
      return files.get(key);
    },
    async removeEntry(key) {
      if (!files.delete(key) && !folders.delete(key)) throw missing();
    },
    async *entries() {
      yield* files;
      yield* folders;
    },
  };
}

async function main() {
  const counters = { clock: 0, writes: [], reads: [], fail: false }; // Records real canonical/manifest writes for assertions.
  const folder = directory('primary', counters);
  let deviceId = 'incremental-test-device'; // Simulated current installation; switched to test a second device's save.
  const jsonVisits = { character: 0, world: 0 }; // Count production-core entity serialization passes during no-op saves.
  const trackedJSON = {
    parse: JSON.parse,
    stringify(value, ...options) {
      if (value?.id === 'char') jsonVisits.character++;
      if (value?.id === 'world') jsonVisits.world++;
      return JSON.stringify(value, ...options);
    },
  }; // Instrument only the isolated production core, never the test's own setup and assertions.
  const native = new Map(); // Browser cache that survives each simulated save.
  const localStorage = {
    getItem: key => native.get(key) ?? null,
    setItem: (key, value) => native.set(key, String(value)),
    removeItem: key => native.delete(key),
  };
  const indexedDB = {
    open() {
      const request = {};
      request.result = {
        transaction() {
          const tx = {
            objectStore() {
              return {
                get() {
                  const read = { result: null };
                  queueMicrotask(() => read.onsuccess?.());
                  return read;
                },
                put() {}, delete() {},
              };
            },
          };
          queueMicrotask(() => tx.oncomplete?.());
          return tx;
        },
      };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
  const window = {
    addEventListener() {},
    __hobunjiPlayerProfile: { characterId: 'char', worldId: 'world' },
    showDirectoryPicker: async () => folder,
    FolderSaveDeviceProvenance: { getDeviceId: () => deviceId }, // The core stamps only the changed portable entities.
    HobunjiSaveSnapshot: {
      browserCacheParts: () => [localStorage.getItem('hobunjiSaveMeta'), 'world', localStorage.getItem('hobunji_farm_layout_v3:world')],
      apply() {}, // The fake browser already contains the generated snapshot's own source data.
    },
  };
  const source = fs.readFileSync('docs/js/local-save-folder-core.js', 'utf8');
  new Function(source); // Syntax must be valid even before a save folder is connected.
  const context = vm.createContext({
    window, localStorage, indexedDB, console, JSON: trackedJSON,
    setInterval: () => 1, clearInterval() {},
    setTimeout: () => 1, clearTimeout() {},
  });
  vm.runInContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await window.LocalSaveFolder.chooseFolder()).state, 'ready');

  const meta = {
    version: 1,
    characters: [{ id: 'char', nickname: 'Farmer', bag: { coins: 10 } }],
    worlds: [{ id: 'world', label: 'Farm', day: 1 }],
  };
  const layout = { version: 3, tiles: [{ c: 1, r: 2 }] };
  const saveMeta = () => localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
  const saveLayout = () => localStorage.setItem('hobunji_farm_layout_v3:world', JSON.stringify(layout));
  saveMeta(); saveLayout();

  let lastChange = null; // Captures whether a status notification requests a recovery refresh.
  window.LocalSaveFolder.onChange((_status, change) => { lastChange = change; });
  const initial = await window.LocalSaveFolder.syncNow({ automatic: false });
  assert.equal(lastChange?.refreshRecovery, true, 'first save that arms a folder requests a recovery refresh');
  assert.equal(initial.lastError, null, 'first folder commit succeeds');
  assert.equal(initial.saveFileWork.written, 3, 'first save writes character, world and layout files');
  const firstStamp = JSON.parse(await (await folder.files.get('manifest.json').getFile()).text()).writerProvenance;
  assert.equal(firstStamp.lastWriterDeviceId, 'incremental-test-device', 'portable manifest records last-writer identity');
  const characterBytes = await (await folder.folders.get('characters').files.get('farmer-char.json').getFile()).text();
  assert.equal(JSON.parse(characterBytes).folderSaveProvenance.lastWriterDeviceId, 'incremental-test-device');
  // The native Windows filesystem also exposes Drive recovery versions.
  const savedVersions = folder.folders.get('characters');
  const previousName = '.hobunji-previous-farmer-char.json-12345678-1234-4123-8123-123456789012';
  const pendingName = '.hobunji-pending-farmer-char.json-12345678-1234-4123-8123-123456789013';
  await seedLegacy(savedVersions, previousName, { id: 'char', nickname: 'Previous' });
  await seedLegacy(savedVersions, pendingName, { id: 'char', nickname: 'Pending' });
  await seedLegacy(savedVersions, 'notes.txt', { note: 'keep me' });
  const repeatExplicit = await window.LocalSaveFolder.syncNow({ automatic: false });
  assert.ok(savedVersions.files.has(previousName), 'native save preserves Drive previous version');
  assert.ok(savedVersions.files.has(pendingName), 'native save preserves interrupted staged version');
  assert.ok(savedVersions.files.has('notes.txt'), 'native save preserves non-save files');
  assert.equal(repeatExplicit.lastError, null);
  assert.equal(lastChange?.refreshRecovery, false, 'routine explicit save already handled its recovery slots');
  assert.equal(repeatExplicit.saveFileWork.written, 0, 'explicit save no longer rewrites unchanged character/world files to timestamp them');
  assert.equal(await (await folder.folders.get('characters').files.get('farmer-char.json').getFile()).text(), characterBytes,
    'an explicit save preserves exact character bytes when no character data changed');
  assert.equal(JSON.parse(await (await folder.files.get('manifest.json').getFile()).text()).writerProvenance.lastWriterDeviceId,
    'incremental-test-device', 'manifest alone advances the last-writer provenance');
  deviceId = 'second-device';
  const newDeviceSave = await window.LocalSaveFolder.syncNow({ automatic: false });
  assert.equal(newDeviceSave.lastError, null);
  assert.equal(newDeviceSave.saveFileWork.written, 0, 'changing only the writing device never rewrites character/world entities');
  assert.equal(JSON.parse(await (await folder.files.get('manifest.json').getFile()).text()).writerProvenance.lastWriterDeviceId,
    'second-device', 'manifest records the new writer even though entity bytes were unchanged');
  assert.equal(await (await folder.folders.get('characters').files.get('farmer-char.json').getFile()).text(), characterBytes,
    'the first device remains recorded on its unchanged character entity');
  deviceId = 'incremental-test-device';

  const writesBeforeIdle = counters.writes.length;
  jsonVisits.character = 0; jsonVisits.world = 0;
  const idle = await window.LocalSaveFolder.syncNow({ automatic: true });
  assert.equal(idle.lastAction, 'autosync-skipped-unchanged');
  assert.equal(lastChange?.refreshRecovery, false, 'unchanged autosave only publishes status');
  assert.equal(counters.writes.length, writesBeforeIdle, 'identical autosave does not rewrite files or manifest');
  assert.deepEqual(jsonVisits, { character: 1, world: 1 },
    'unchanged autosave serializes each entity once, not once for provenance and again for the folder digest');

  folder.files.delete('manifest.json');
  const repairedManifest = await window.LocalSaveFolder.syncNow({ automatic: true });
  assert.equal(repairedManifest.lastError, null, 'missing manifest is repaired before skipping a no-op autosave');
  assert.ok(folder.files.has('manifest.json'), 'the repaired manifest exists on disk');

  counters.onFileRead = () => {
    const newer = JSON.parse(localStorage.getItem('hobunjiSaveMeta')); // User edits happen while the file metadata await resolves.
    newer.characters[0].nickname = 'In-flight browser edit';
    localStorage.setItem('hobunjiSaveMeta', JSON.stringify(newer));
  };
  const concurrent = await window.LocalSaveFolder.syncNow({ automatic: true });
  assert.equal(concurrent.lastAction, 'autosync-skipped-unchanged');
  assert.equal(concurrent.changeSyncPending, true, 'in-flight edits are queued for the next autosave');
  assert.match(concurrent.browserMirrorWarning, /newer browser changes/i, 'in-flight edit remains mobile-visible');

  meta.worlds[0].day = 2;
  saveMeta();
  const worldUpdate = await window.LocalSaveFolder.syncNow({ automatic: true });
  assert.equal(worldUpdate.lastError, null);
  assert.equal(lastChange?.refreshRecovery, false, 'changed autosave already handled its recovery slots');
  assert.equal(worldUpdate.saveFileWork.written, 1, 'one edited world writes only its own canonical file');
  assert.equal(worldUpdate.saveFileWork.unchanged, 2, 'unchanged character and layout keep their original files');
  assert.equal(await (await folder.folders.get('characters').files.get('farmer-char.json').getFile()).text(), characterBytes,
    'editing a world does not churn the unchanged character provenance');

  layout.tiles.push({ c: 4, r: 6 });
  saveLayout();
  const farmUpdate = await window.LocalSaveFolder.syncNow({ automatic: true });
  assert.equal(farmUpdate.lastError, null);
  const farmOnlyWriter = JSON.parse(await (await folder.files.get('manifest.json').getFile()).text()).writerProvenance;
  assert.equal(farmOnlyWriter.lastWriterDeviceId, 'incremental-test-device', 'farm-only saves still update portable manifest writer');
  assert.equal(farmUpdate.saveFileWork.written, 1, 'editing a farm writes its layout file without rewriting world and character');

  const canonicalFarm = folder.folders.get('farm-layouts').files.get('world.json');
  const originalFarmBytes = await (await canonicalFarm.getFile()).text(); // Authoritative disk contents before the simulated outside restore.
  const externallyRestored = originalFarmBytes.replace('"c":1', '"c":9');
  assert.notEqual(externallyRestored, originalFarmBytes, 'the test modifies canonical layout content');
  assert.equal(externallyRestored.length, originalFarmBytes.length, 'the external edit preserves the exact byte count');
  canonicalFarm.replaceBytesPreservingMetadata(externallyRestored);
  const noOpDuringExternalRestore = await window.LocalSaveFolder.syncNow({ automatic: true });
  assert.equal(noOpDuringExternalRestore.lastAction, 'autosync-skipped-unchanged', 'a no-op does not overwrite the externally edited farm');
  meta.worlds[0].day = 2.5;
  saveMeta();
  const preservedExternalFarm = await window.LocalSaveFolder.syncNow({ automatic: true });
  assert.equal(preservedExternalFarm.lastAction, 'autosync-blocked-external-layout',
    'a changed save must detect external farm contents even when size and timestamp were preserved');
  assert.equal(await (await canonicalFarm.getFile()).text(), externallyRestored, 'outside farm data was not overwritten');
  canonicalFarm.replaceBytesPreservingMetadata(originalFarmBytes);
  const correctedAfterInspection = await window.LocalSaveFolder.syncNow({ automatic: true });
  assert.equal(correctedAfterInspection.lastError, null, 'restoring the original farm allows the pending world change to save');

  localStorage.removeItem('hobunji_farm_layout_v3:world'); // Browser cache loses a layout that still exists in the primary folder.
  const missingBrowserFarm = await window.LocalSaveFolder.syncNow({ automatic: true });
  assert.equal(missingBrowserFarm.lastAction, 'autosync-blocked-missing-layout', 'a missing browser layout cannot shrink the committed farm');
  assert.equal(await (await canonicalFarm.getFile()).text(), originalFarmBytes, 'previous canonical farm is preserved on disk');
  saveLayout();
  const recoveredBrowserFarm = await window.LocalSaveFolder.syncNow({ automatic: true });
  assert.equal(recoveredBrowserFarm.lastError, null, 'repaired browser layout can be saved again');

  folder.folders.get('characters').files.delete('farmer-char.json');
  meta.worlds[0].day = 3; saveMeta();
  const missingFile = await window.LocalSaveFolder.syncNow({ automatic: true });
  assert.equal(missingFile.lastError, null);
  assert.equal(missingFile.saveFileWork.written, 2, 'missing unchanged character file is recreated on the next changed save');

  // Deliberately alter the real disk without touching the browser snapshot.
  const layoutHandle = folder.folders.get('farm-layouts').files.get('world.json');
  const outside = await layoutHandle.createWritable();
  await outside.write(JSON.stringify({ worldId: 'world', layout: { version: 3, tiles: [{ c: 99, r: 99 }] } }));
  await outside.close();
  meta.worlds[0].day = 4; saveMeta();
  const blocked = await window.LocalSaveFolder.syncNow({ automatic: true });
  assert.equal(blocked.lastAction, 'autosync-blocked-external-layout', 'external farm edit retains the data-loss guard');
  assert.equal(JSON.parse(await (await layoutHandle.getFile()).text()).layout.tiles[0].c, 99, 'external layout remains untouched');

  // An explicit folder switch must not reuse the previous folder's fingerprints.
  const newFolder = directory('other', counters);
  window.showDirectoryPicker = async () => newFolder;
  await window.LocalSaveFolder.chooseFolder();
  const other = await window.LocalSaveFolder.syncNow({ automatic: false });
  assert.equal(other.saveFileWork.written, 3, 'new folder receives a complete initial save, not a no-op');

  const recoveredFolder = directory('recovery-picked', counters); // A recovery-only folder switch must invalidate the same incremental catalog.
  window.showDirectoryPicker = async () => recoveredFolder;
  await window.LocalSaveFolder.chooseRecoveryFolder();
  const recoverySelected = await window.LocalSaveFolder.syncNow({ automatic: false });
  assert.equal(recoverySelected.lastError, null);
  assert.equal(recoverySelected.saveFileWork.written, 3, 'recovery folder re-selection writes all canonical files to its new destination');

  // Mutation after the delta scan must never install stale content hashes as
  // proof of a durable save. A caller-owned pinned snapshot can be mutable.
  meta.worlds[0].day = 5;
  const pinned = { snapshotVersion: 1, meta, farmLayouts: { world: layout } }; // Explicit save uses the same data objects so the injected edit is observable.
  counters.onFileRead = () => { meta.worlds[0].day = 6; }; // Edit arrives while the farm integrity check is awaiting disk.
  const mutated = await window.LocalSaveFolder.syncSnapshot(pinned, { automatic: false });
  assert.equal(mutated.lastAction, 'save-error', 'mutated snapshot is rejected before publishing a stale delta fingerprint');
  assert.match(mutated.lastError, /snapshot changed/i);
  saveMeta();
  const recoveredMutation = await window.LocalSaveFolder.syncNow({ automatic: false });
  assert.equal(recoveredMutation.lastError, null, 'a stable retry can persist the newer world state safely');

  // A failed write must not publish a new delta baseline.
  meta.worlds[0].day = 5; saveMeta();
  counters.fail = true;
  const failed = await window.LocalSaveFolder.syncNow({ automatic: true });
  assert.equal(failed.lastAction, 'save-error');
  assert.equal(lastChange?.refreshRecovery, true, 'failed writes still request a recovery refresh');
  counters.fail = false;
  const retried = await window.LocalSaveFolder.syncNow({ automatic: true });
  assert.equal(retried.lastError, null);
  assert.equal(retried.saveFileWork.written, 3, 'retry after partial failure uses a complete, verified baseline');

  // Explicit world deletion must remove the old canonical layout without
  // destroying numbered user recovery copies kept beside it.
  const layoutsDir = recoveredFolder.folders.get('farm-layouts'); // Canonical directory that owns the real current-world layout.
  const backup = await layoutsDir.getFileHandle('world(1).json', { create: true }); // User's independent version-copy backup.
  const backupWrite = await backup.createWritable();
  await backupWrite.write(JSON.stringify({ worldId: 'world', layout }));
  await backupWrite.close();
  meta.worlds = [];
  saveMeta();
  const removedWorld = await window.LocalSaveFolder.syncNow({ force: true });
  assert.equal(removedWorld.lastError, null, 'explicit force-save may remove a deliberately deleted world');
  assert.equal(layoutsDir.files.has('world.json'), false, 'deleted world canonical farm layout is removed');
  assert.equal(layoutsDir.files.has('world(1).json'), true, 'numbered backup copies survive world deletion');

  // A large farm must not cause an unchanged autosave to rewrite its payload.
  const largeFolder = directory('large-farm', counters); // Separate destination keeps the stress test from disturbing recovery history.
  window.showDirectoryPicker = async () => largeFolder;
  meta.worlds = [{ id: 'world', label: 'Farm', day: 30 }];
  saveMeta();
  const largeLayout = {
    version: 3,
    tiles: Array.from({ length: 20000 }, (_, i) => ({ c: i % 128, r: Math.floor(i / 128), crop: 'crop' + (i % 5), age: i })),
  }; // Deliberately multi-megabyte farm payload; all 20,000 distinct tile records must survive world-only writes.
  localStorage.setItem('hobunji_farm_layout_v3:world', JSON.stringify(largeLayout));
  await window.LocalSaveFolder.chooseFolder();
  const initialLarge = await window.LocalSaveFolder.syncNow({ automatic: false });
  assert.equal(initialLarge.lastError, null);
  const baselineDiskWrites = counters.writes.length;
  const skippedLarge = await window.LocalSaveFolder.syncNow({ automatic: true });
  assert.equal(skippedLarge.lastAction, 'autosync-skipped-unchanged', 'large unchanged farm has a complete no-op save');
  assert.equal(counters.writes.length, baselineDiskWrites, 'large unchanged farm produces zero disk writes');
  meta.worlds[0].day = 31;
  saveMeta();
  const changedLarge = await window.LocalSaveFolder.syncNow({ automatic: true });
  assert.equal(changedLarge.lastError, null);
  assert.equal(changedLarge.saveFileWork.written, 1, 'world-only edit does not rewrite the 20,000-tile farm');
  const persistedLarge = JSON.parse(await (await largeFolder.folders.get('farm-layouts').files.get('world.json').getFile()).text());
  assert.equal(persistedLarge.layout.tiles.length, 20000, 'all large farm tiles remain intact after the world-only save');

  // Lockpicking's first failure writes a tiny penalty; it must not scan or
  // rewrite the 20,000-tile farm, or rewrite massive rolling checkpoints.
  const lockRecord = { version: 2, tier: 1, stage: 0, misses: 1, streak: 0, streakScore: 0,
    bestStreak: 0, bestScore: 0, failedStage: 0, folderUnsynced: true }; // Durable first-failure penalty owned by the current character.
  meta.characters[0].chestLockProgress = { world: { 'chest-a': lockRecord } };
  saveMeta();
  assert.equal(window.LocalSaveFolder.canSaveLockProgress('char'), true, 'the verified character baseline enables fast saving');
  const quickWritesBefore = counters.writes.length;
  const quickReadsBefore = counters.reads.length;
  const quick = await window.LocalSaveFolder.saveLockProgress({
    characterId: 'char', worldId: 'world', lockId: 'chest-a', record: lockRecord,
  });
  assert.equal(quick.lastError, null, 'first-failure character-only folder commit succeeds');
  assert.equal(quick.lastAction, 'autosaved-lock-progress');
  assert.equal(lastChange?.refreshRecovery, false, 'lock-only save changes no recovery slot');
  assert.equal(quick.saveFileWork.written, 1, 'only the character canonical JSON is rewritten');
  assert.equal(quick.recoveryRefreshPending, true, 'full recovery refresh remains scheduled for the next ordinary autosave');
  assert.deepEqual(counters.writes.slice(quickWritesBefore),
    ['characters/farmer-char.json', 'large-farm/manifest.json'],
    'fast save does not write any world/farm/recovery files');
  assert.equal(counters.reads.slice(quickReadsBefore).some(name => name.startsWith('farm-layouts/')), false,
    'fast save never reads the large farm layout, even for integrity scanning');
  const largeCharacterFile = largeFolder.folders.get('characters').files.get('farmer-char.json');
  assert.equal(JSON.parse(await (await largeCharacterFile.getFile()).text()).chestLockProgress.world['chest-a'].misses, 1,
    'reloading canonical character bytes preserves the first-try failure');
  assert.equal(JSON.parse(await (await largeCharacterFile.getFile()).text()).chestLockProgress.world['chest-a'].folderUnsynced, false,
    'reloading a successfully committed lock does not demand a redundant retry');
  assert.equal(JSON.parse(await (await largeFolder.folders.get('farm-layouts').files.get('world.json').getFile()).text()).layout.tiles.length,
    20000, 'character-only save preserves the entire farm');

  // A browser quota failure must not replace the just-committed character with
  // an old character lacking this penalty during the deferred full autosave.
  delete meta.characters[0].chestLockProgress;
  saveMeta();
  const stale = await window.LocalSaveFolder.syncNow({ automatic: true });
  assert.equal(stale.lastAction, 'autosync-blocked-lock-progress', 'stale browser metadata cannot erase durable lock penalties');
  assert.equal(JSON.parse(await (await largeCharacterFile.getFile()).text()).chestLockProgress.world['chest-a'].misses, 1);
  meta.characters[0].chestLockProgress = { world: { 'chest-a': { ...lockRecord, folderUnsynced: false } } };
  saveMeta();
  const recoveryCatchup = await window.LocalSaveFolder.syncNow({ automatic: true });
  assert.equal(recoveryCatchup.lastError, null, 'regular full autosave can follow the fast lock save');
  assert.equal(recoveryCatchup.recoveryRefreshPending, false, 'deferred recovery work is complete');
  assert.equal(recoveryCatchup.saveFileWork.written, 0, 'the acknowledged lock progress is already durable; full recovery refresh need not rewrite canonical files');

  // Even same-size, same-timestamp external edits to the CHARACTER file must
  // be rejected rather than silently overwritten by the targeted path.
  const originalCharacterBytes = await (await largeCharacterFile.getFile()).text();
  const externallyEditedCharacter = originalCharacterBytes.replace('"coins":10', '"coins":99');
  assert.notEqual(externallyEditedCharacter, originalCharacterBytes);
  assert.equal(externallyEditedCharacter.length, originalCharacterBytes.length);
  largeCharacterFile.replaceBytesPreservingMetadata(externallyEditedCharacter);
  const rejected = await window.LocalSaveFolder.saveLockProgress({
    characterId: 'char', worldId: 'world', lockId: 'chest-a',
    record: { ...lockRecord, misses: 2 },
  });
  assert.equal(rejected.lastAction, 'save-error', 'externally edited canonical character data blocks a fast save');
  assert.match(rejected.lastError, /changed outside this session/i);
  assert.equal(await (await largeCharacterFile.getFile()).text(), externallyEditedCharacter, 'outside edits are preserved');

  // A pre-manifest-provenance folder must use the writers recorded in its
  // canonical disk entities, not a different device's stale browser metadata.
  const legacyFolder = directory('older-folder', counters); // Independent simulated folder with only legacy per-entity provenance.
  async function seedLegacy(dir, filename, value) {
    const handle = await dir.getFileHandle(filename, { create: true });
    const stream = await handle.createWritable();
    await stream.write(JSON.stringify(value));
    await stream.close();
  }
  const legacyCharacters = await legacyFolder.getDirectoryHandle('characters', { create: true });
  const legacyWorlds = await legacyFolder.getDirectoryHandle('worlds', { create: true });
  await seedLegacy(legacyCharacters, 'farmer-legacy-char.json', {
    id: 'legacy-char', nickname: 'Farmer',
    folderSaveProvenance: { version: 1, lastWriterDeviceId: 'legacy-world-device', writtenAt: 1200 },
  });
  await seedLegacy(legacyWorlds, 'legacy-world.json', {
    id: 'legacy-world', label: 'Legacy',
    folderSaveProvenance: { version: 1, lastWriterDeviceId: 'legacy-older-device', writtenAt: 1000 },
  });
  const legacyManifest = { version: 1, portableSaveVersion: 1, savedAt: 1300, characterCount: 1, worldCount: 1 };
  await seedLegacy(legacyFolder, 'manifest.json', legacyManifest);
  window.showDirectoryPicker = async () => legacyFolder;
  const olderStatus = await window.LocalSaveFolder.chooseFolder();
  assert.equal(olderStatus.state, 'ready', 'older save folder can be selected safely');
  assert.equal(olderStatus.lastWriterProvenance.lastWriterDeviceId, 'legacy-world-device',
    'old-folder Resume provenance uses the newest on-disk entity writer, not the stale browser mirror');

  await seedLegacy(legacyFolder, 'manifest.json', {
    ...legacyManifest, writerProvenance: { version: 1, lastWriterDeviceId: 'manifest-writer', writtenAt: 1400 },
  });
  const newFormatStatus = await window.LocalSaveFolder.chooseFolder();
  assert.equal(newFormatStatus.lastWriterProvenance.lastWriterDeviceId, 'manifest-writer',
    'the manifest writer wins over legacy entity stamps when both exist');

  const markerName = 'hobunji-write-in-progress.json';
  await seedLegacy(legacyFolder, markerName, { version: 1, startedAt: 1500 });
  const interrupted = await window.LocalSaveFolder.chooseFolder();
  assert.equal(interrupted.state, 'ready', 'interrupted folder remains available for recovery');
  assert.match(interrupted.lastError, /interrupted or active browser Drive save/i);
  const beforeBlockedWrites = counters.writes.length;
  const blockedLoad = await window.LocalSaveFolder.loadFromFolder();
  assert.equal(blockedLoad.ok, false, 'native restore rejects a browser mixed revision');
  await assert.rejects(() => window.LocalSaveFolder.readPrimarySnapshot(), /interrupted or active browser Drive save/i);
  const blockedSave = await window.LocalSaveFolder.syncNow({ force: true, automatic: false });
  assert.match(blockedSave.lastError, /interrupted or active browser Drive save/i);
  assert.equal(counters.writes.length, beforeBlockedWrites, 'even a forced native save cannot replace an active browser transaction');
  assert.ok(legacyFolder.files.has(markerName), 'the interrupted transaction marker is not silently removed');

  console.log('OK  incremental saves, cross-device provenance, legacy disk fallback, lock-progress fast commits, quota rollback, single-pass no-op serialization, guarded layouts, external edits, recovery and large-farm stress');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
