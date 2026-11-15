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
          getFile: async () => {
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
  const counters = { clock: 0, writes: [], fail: false }; // Records real canonical/manifest writes for assertions.
  const folder = directory('primary', counters);
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
    showDirectoryPicker: async () => folder,
    HobunjiSaveSnapshot: {
      browserCacheParts: () => [localStorage.getItem('hobunjiSaveMeta'), 'world', localStorage.getItem('hobunji_farm_layout_v3:world')],
      apply() {}, // The fake browser already contains the generated snapshot's own source data.
    },
  };
  const source = fs.readFileSync('docs/js/local-save-folder-core.js', 'utf8');
  new Function(source); // Syntax must be valid even before a save folder is connected.
  const context = vm.createContext({
    window, localStorage, indexedDB, console,
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

  const initial = await window.LocalSaveFolder.syncNow({ automatic: false });
  assert.equal(initial.lastError, null, 'first folder commit succeeds');
  assert.equal(initial.saveFileWork.written, 3, 'first save writes character, world and layout files');

  const writesBeforeIdle = counters.writes.length;
  const idle = await window.LocalSaveFolder.syncNow({ automatic: true });
  assert.equal(idle.lastAction, 'autosync-skipped-unchanged');
  assert.equal(counters.writes.length, writesBeforeIdle, 'identical autosave does not rewrite files or manifest');

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
  assert.equal(worldUpdate.saveFileWork.written, 1, 'one edited world writes only its own canonical file');
  assert.equal(worldUpdate.saveFileWork.unchanged, 2, 'unchanged character and layout keep their original files');

  layout.tiles.push({ c: 4, r: 6 });
  saveLayout();
  const farmUpdate = await window.LocalSaveFolder.syncNow({ automatic: true });
  assert.equal(farmUpdate.lastError, null);
  assert.equal(farmUpdate.saveFileWork.written, 1, 'editing a farm writes its layout file without rewriting world and character');

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
  counters.fail = false;
  const retried = await window.LocalSaveFolder.syncNow({ automatic: true });
  assert.equal(retried.lastError, null);
  assert.equal(retried.saveFileWork.written, 3, 'retry after partial failure uses a complete, verified baseline');

  console.log('OK  incremental saves, no-op autosaves, missing files, external edits, folder switching, and write retries');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
