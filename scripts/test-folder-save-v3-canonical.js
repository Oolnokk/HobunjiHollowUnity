'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { TextEncoder } = require('util');
const { webcrypto } = require('crypto');

const root = path.resolve(__dirname, '..'); // Resolves production persistence modules from this regression script.
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8'); // Loads browser modules verbatim into isolated VM contexts.

function makeStorage(meta) {
  const values = new Map(meta ? [['hobunjiSaveMeta', JSON.stringify(meta)]] : []); // Browser-local save state consumed by the real snapshot adapter.
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    key(index) { return [...values.keys()][index] ?? null; },
    get length() { return values.size; },
  };
}

function metaWithBerry(value) {
  return {
    version: 1,
    characters: [{ id: 'char-a', nickname: 'Tester', inventory: { berry: value } }],
    worlds: [{ id: 'world-a', label: 'Hollow' }],
  };
}

class FakeFileHandle {
  constructor(name, text = '') {
    this.name = name; // Stable fake file identity reused across every overwrite of the same canonical filename.
    this.textValue = text; // Current UTF-8 file contents returned by getFile().
    this.writeCount = 0; // Regression-visible count proving subsequent saves overwrite the same handle.
  }

  async getFile() {
    const textValue = this.textValue; // Snapshot of file contents at getFile() time, matching browser File semantics closely enough for this adapter.
    return { text: async () => textValue };
  }

  async createWritable() {
    const handle = this; // Stable file handle updated only when close() commits the pending text.
    let pending = ''; // Buffered replacement contents written by the production adapter.
    return {
      async write(value) { pending = String(value); },
      async close() { handle.textValue = pending; handle.writeCount++; },
      async abort() { pending = ''; },
    };
  }
}

class FakeDirectoryHandle {
  constructor() {
    this.name = 'Hobunji Save'; // Folder name surfaced through the fake V2 status/debug paths.
    this.files = new Map(); // Fixed-name file map used to prove canonical identity remains stable across writes.
  }

  async queryPermission() { return 'granted'; }

  async getFileHandle(name, options = {}) {
    if (this.files.has(name)) return this.files.get(name);
    if (options.create) {
      const file = new FakeFileHandle(name); // Newly-created canonical file handle retained permanently under the same filename.
      this.files.set(name, file);
      return file;
    }
    const error = new Error(`File not found: ${name}`); // Browser-like NotFoundError triggers the adapter's clean V2 fallback path.
    error.name = 'NotFoundError';
    throw error;
  }
}

function boot({ initialMeta = metaWithBerry(1), directory = new FakeDirectoryHandle(), onV2Load = null } = {}) {
  const localStorage = makeStorage(initialMeta); // Isolated browser save for this scenario.
  const memory = new Map(); // Injected durable sync-store backend avoids needing IndexedDB in Node.
  const listeners = new Set(); // Fake V2 core change listeners retained so the adapter can wrap the real subscription surface.
  const folderStatus = {
    supported: true,
    state: 'ready',
    folderName: directory.name,
    autoSyncArmed: true,
    portableFarmLayouts: true,
    lastError: null,
    dataLossRisk: null,
  }; // Minimal current V2 status consumed by the canonical adapter.
  let v2Loads = 0; // Counts recovery-tree loads so invalid V3 files can prove they are never silently bypassed.
  let v2Writes = 0; // Counts recovery-tree writes performed before canonical writes.

  const window = {
    crypto: webcrypto,
    __hobunjiSaveSyncMemoryStorage: memory,
    __hobunjiFolderSaveV3Handle: directory,
    LocalSaveFolder: {
      getStatus() { return { ...folderStatus }; },
      onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      async syncNow() { v2Writes++; return { ...folderStatus }; },
      async loadFromFolder() {
        v2Loads++;
        if (onV2Load) onV2Load(localStorage); // Scenario hook simulates stale V2 recovery data temporarily replacing the browser cache.
        return { ok: true, changed: true, action: 'loaded-v2' };
      },
      async reconnect() { return { ...folderStatus }; },
      async chooseFolder() { return { ...folderStatus }; },
      async changeFolder() { return { ...folderStatus }; },
    },
  }; // Browser globals required by the production persistence stack.
  window.window = window;
  const context = vm.createContext({ window, localStorage, TextEncoder, console, Map, Math, Date }); // Isolated production execution context.

  for (const file of [
    'docs/js/save-snapshot-core.js',
    'docs/js/save-sync-envelope.js',
    'docs/js/save-sync-store.js',
    'docs/js/save-coordinator.js',
    'docs/js/folder-save-v3-canonical.js',
  ]) vm.runInContext(read(file), context, { filename: path.basename(file) });

  return {
    window,
    localStorage,
    directory,
    getV2Loads: () => v2Loads,
    getV2Writes: () => v2Writes,
  };
}

async function main() {
  // 1) A successful explicit folder save keeps the legacy recovery-tree write
  // and adds/verifies the fixed-name V3 canonical file afterward.
  {
    const runtime = boot({ initialMeta: metaWithBerry(2) });
    const save = runtime.window.LocalSaveFolder; // Adapter-wrapped production filesystem API.
    const firstStatus = await save.syncNow();
    assert.equal(runtime.getV2Writes(), 1, 'V2 recovery tree is still written before the canonical file');
    assert.equal(firstStatus.canonicalAvailable, true, 'successful folder save reports a V3 canonical file');

    const file = runtime.directory.files.get('hobunji-primary-save.json'); // Stable fake canonical file handle created by the first save.
    assert.ok(file, 'folder save creates hobunji-primary-save.json');
    const firstEnvelope = await runtime.window.HobunjiSaveEnvelope.parse(file.textValue);
    assert.equal(firstEnvelope.snapshot.meta.characters[0].inventory.berry, 2, 'canonical file contains the current gameplay snapshot');
    assert.equal(file.writeCount, 1, 'first save writes canonical file once');

    const changedMeta = metaWithBerry(3); // Second gameplay change written through the same canonical file handle.
    runtime.localStorage.setItem('hobunjiSaveMeta', JSON.stringify(changedMeta));
    await save.syncNow();
    assert.strictEqual(runtime.directory.files.get('hobunji-primary-save.json'), file, 'subsequent saves reuse the same canonical file handle');
    assert.equal(file.writeCount, 2, 'subsequent save overwrites the existing canonical file in place');
    const secondEnvelope = await runtime.window.HobunjiSaveEnvelope.parse(file.textValue);
    assert.equal(secondEnvelope.revision, 2, 'changed canonical gameplay state advances the durable revision');
    assert.equal(secondEnvelope.saveSetId, firstEnvelope.saveSetId, 'canonical overwrite preserves one stable save-set identity');
  }

  // 2) A valid V3 canonical file wins over a stale V2 recovery tree. The V2
  // loader may run to preserve its compatibility/autosync lifecycle, but V3 is
  // re-applied last and its exact envelope identity becomes durable locally.
  {
    const directory = new FakeDirectoryHandle(); // Folder preloaded with a canonical envelope representing the external authority.
    const seed = boot({ initialMeta: metaWithBerry(7), directory });
    const externalEnvelope = await seed.window.HobunjiSaveEnvelope.create(
      seed.window.HobunjiSaveSnapshot.capture(),
      { saveSetId: 'external-save-set', revision: 19, writerId: 'other-device', writtenAt: 5000 }
    );
    const canonicalFile = await directory.getFileHandle('hobunji-primary-save.json', { create: true });
    canonicalFile.textValue = seed.window.HobunjiSaveEnvelope.serialize(externalEnvelope);

    const runtime = boot({
      initialMeta: metaWithBerry(1),
      directory,
      onV2Load(storage) { storage.setItem('hobunjiSaveMeta', JSON.stringify(metaWithBerry(0))); },
    });
    const result = await runtime.window.LocalSaveFolder.loadFromFolder();
    const finalMeta = JSON.parse(runtime.localStorage.getItem('hobunjiSaveMeta')); // Browser state after stale V2 compatibility load and final canonical re-apply.
    assert.equal(result.ok, true);
    assert.equal(result.canonical, true, 'V3 load explicitly reports canonical authority');
    assert.equal(runtime.getV2Loads(), 1, 'V2 compatibility loader still runs beneath a valid canonical restore');
    assert.equal(finalMeta.characters[0].inventory.berry, 7, 'canonical V3 state wins over stale V2 recovery data');
    const durable = await runtime.window.HobunjiSaveSyncStore.getCurrentEnvelope();
    assert.equal(durable.saveSetId, 'external-save-set', 'restore preserves exact external save-set identity locally');
    assert.equal(durable.revision, 19, 'restore preserves exact external revision locally');
  }

  // 3) Without a canonical file, old V2 folders continue to load normally and
  // are not silently upgraded merely because they were opened.
  {
    const runtime = boot({
      initialMeta: metaWithBerry(1),
      onV2Load(storage) { storage.setItem('hobunjiSaveMeta', JSON.stringify(metaWithBerry(5))); },
    });
    const result = await runtime.window.LocalSaveFolder.loadFromFolder();
    assert.equal(result.ok, true, 'V2 fallback remains usable');
    assert.equal(runtime.getV2Loads(), 1, 'V2 loader owns restore when canonical file is absent');
    assert.equal(runtime.directory.files.has('hobunji-primary-save.json'), false, 'loading V2 alone does not create/upgrade the canonical file');
    assert.equal(JSON.parse(runtime.localStorage.getItem('hobunjiSaveMeta')).characters[0].inventory.berry, 5, 'V2 fallback still updates browser state');
  }

  // 4) A present but corrupt V3 file is never silently bypassed in favor of a
  // potentially stale recovery mirror.
  {
    const directory = new FakeDirectoryHandle(); // Folder containing an intentionally corrupt canonical file.
    const canonicalFile = await directory.getFileHandle('hobunji-primary-save.json', { create: true });
    canonicalFile.textValue = '{ definitely not valid json';
    const runtime = boot({
      initialMeta: metaWithBerry(1),
      directory,
      onV2Load(storage) { storage.setItem('hobunjiSaveMeta', JSON.stringify(metaWithBerry(99))); },
    });
    const result = await runtime.window.LocalSaveFolder.loadFromFolder();
    assert.equal(result.ok, false, 'invalid canonical file blocks automatic restore');
    assert.equal(result.action, 'v3-invalid');
    assert.equal(runtime.getV2Loads(), 0, 'invalid canonical file is not bypassed with a stale V2 load');
    assert.equal(JSON.parse(runtime.localStorage.getItem('hobunjiSaveMeta')).characters[0].inventory.berry, 1, 'browser state remains unchanged when canonical validation fails');
  }

  console.log('Folder Save V3 canonical regression checks passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
