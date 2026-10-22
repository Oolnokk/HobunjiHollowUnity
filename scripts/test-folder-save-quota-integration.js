'use strict';

const assert = require('node:assert/strict'); // Assertions for real save modules running against deterministic browser adapters.
const fs = require('node:fs'); // Loads production modules without changing their source.
const vm = require('node:vm'); // Isolates separate browser sessions and their transient staging maps.

function missing() {
  return Object.assign(new Error('Not found'), { name: 'NotFoundError' });
}

function directory(name, disk) {
  const children = new Map(); // File System Access entries retained across simulated page reloads.
  return {
    name, kind: 'directory',
    queryPermission: async () => 'granted',
    async getDirectoryHandle(key, { create = false } = {}) {
      if (!children.has(key)) {
        if (!create) throw missing();
        children.set(key, directory(key, disk));
      }
      return children.get(key);
    },
    async getFileHandle(key, { create = false } = {}) {
      if (!children.has(key)) {
        if (!create) throw missing();
        let text = ''; // File contents change only when a writable stream closes successfully.
        children.set(key, {
          kind: 'file',
          getFile: async () => ({ text: async () => text }),
          async createWritable() {
            if (disk.failWrites) throw new Error('Disk write failed');
            let pending = ''; // Uncommitted file data used to model createWritable/close.
            return { async write(value) { pending = value; }, async close() { text = pending; } };
          },
        });
      }
      return children.get(key);
    },
    async removeEntry(key) { if (!children.delete(key)) throw missing(); },
    async *entries() { yield* children.entries(); },
  };
}

async function boot(folder, nativeData) {
  class Storage { // Fresh prototype per browser session, with a quota shared by its native values.
    constructor() { this.limit = Infinity; }
    getItem(key) { return nativeData.get(String(key)) ?? null; }
    removeItem(key) { nativeData.delete(String(key)); }
    clear() { nativeData.clear(); }
    setItem(key, value) {
      let size = String(key).length + String(value).length; // Native quota counts all persisted keys and values.
      for (const [otherKey, otherValue] of nativeData) if (otherKey !== key) size += otherKey.length + otherValue.length;
      if (size > this.limit) throw Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' });
      nativeData.set(String(key), String(value));
    }
  }
  const storage = new Storage(); // Native persistence intentionally survives boot while guard staging does not.
  const indexedDB = { // Minimal async IndexedDB adapter for the folder core's handle bookkeeping.
    open() {
      const request = {}; // Core assigns onsuccess before the microtask runs.
      request.result = {
        transaction() {
          const transaction = { // Completes handle writes after their callbacks are installed.
            objectStore: () => ({
              get() { const read = { result: null }; queueMicrotask(() => read.onsuccess()); return read; },
              put() {}, delete() {},
            }),
          };
          queueMicrotask(() => transaction.oncomplete?.());
          return transaction;
        },
      };
      queueMicrotask(() => request.onsuccess());
      return request;
    },
  };
  const document = { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } }; // No UI is needed to execute the save path.
  const window = { // Production globals; folder saves use the same storage seen by gameplay callbacks.
    Storage, localStorage: storage, showDirectoryPicker: async () => folder,
    addEventListener() {}, __hobunjiGameStarted: true,
    __hobunjiPlayerProfile: { characterId: 'farmer', worldId: 'hollow' },
  };
  const context = vm.createContext({ // Timers are inert so each test explicitly chooses when to save.
    window, localStorage: storage, indexedDB, document, console,
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    location: { reload() { throw new Error('Unexpected reload'); } },
  });
  for (const file of ['storage-quota-guard', 'save-snapshot-core', 'local-save-folder-core', 'folder-save-runtime-flush', 'save-checkpoint-manager']) {
    vm.runInContext(fs.readFileSync(`docs/js/${file}.js`, 'utf8'), context, { filename: `${file}.js` });
  }
  await new Promise(resolve => setImmediate(resolve));
  await window.LocalSaveFolder.chooseFolder();
  return { window, storage };
}

(async () => {
  const disk = { failWrites: false }; // Shared disk survives both browser sessions and can fail independently of quota.
  const folder = directory('Primary Save', disk); // Actual production folder core reads/writes this adapter.
  const initial = { version: 1, characters: [{ id: 'farmer' }], worlds: [{ id: 'hollow', members: { farmer: { nonGearInventory: {} } } }] }; // Old persisted save lacks the cooked pie.
  const nativeData = new Map([['hobunjiSaveMeta', JSON.stringify(initial)]]); // Browser copy remains stale when later writes exceed quota.
  const first = await boot(folder, nativeData); // First session starts with a small browser save and initializes its folder.
  assert.equal((await first.window.LocalSaveFolder.syncNow()).lastError, null);
  first.storage.limit = JSON.stringify(initial).length + 30;
  first.window.FarmAnimals = { init() {} };
  first.window.FarmAnimals.init({
    inventory: { cookedPie: 1 },
    saveMemberWorldData() {
      const meta = JSON.parse(first.storage.getItem('hobunjiSaveMeta')); // Mirrors the gameplay read/modify/write that previously swallowed quota errors.
      meta.worlds[0].members.farmer.nonGearInventory.cookedPie = 1;
      meta.worlds[0].members.farmer.cookingState = { recipe: 'three-fish-pie', notes: 'x'.repeat(300) };
      first.storage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
    },
    saveFarmLayout() { first.storage.setItem('hobunji_farm_layout_v3:hollow', JSON.stringify({ tiles: [1, 2, 3] })); },
  });
  const saved = await first.window.HobunjiSaveCheckpoints.saveManual(); // Real runtime flush → snapshot capture → folder write → recovery checkpoint.
  assert.equal(saved.ok, true);
  assert.equal(saved.folder, true);
  assert.equal(JSON.parse(nativeData.get('hobunjiSaveMeta')).worlds[0].members.farmer.nonGearInventory.cookedPie, undefined);
  assert.equal((await first.window.LocalSaveFolder.readPrimarySnapshot()).snapshot.meta.worlds[0].members.farmer.nonGearInventory.cookedPie, 1);
  assert.equal((await first.window.LocalSaveFolder.readRecoveryCheckpoint('manual')).snapshot.meta.worlds[0].members.farmer.nonGearInventory.cookedPie, 1);

  const second = await boot(folder, nativeData); // Reload discards all first-session staging and still starts with the stale native browser save.
  second.storage.limit = first.storage.limit;
  assert.equal((await second.window.LocalSaveFolder.loadFromFolder()).ok, true, 'oversized disk saves hydrate before autosync is armed');
  const reloaded = second.window.HobunjiSaveSnapshot.capture(); // Real snapshot adapter must now see the pie and farm layout from disk.
  assert.equal(reloaded.meta.worlds[0].members.farmer.nonGearInventory.cookedPie, 1);
  assert.deepEqual(Array.from(reloaded.farmLayouts.hollow.tiles), [1, 2, 3]);

  disk.failWrites = true;
  assert.match((await second.window.LocalSaveFolder.syncNow()).lastError, /Disk write failed/, 'staging cannot hide a real folder write failure');
  console.log('folder quota integration: cooked pie survives manual save and a new browser session; real disk failures remain visible');
})().catch(error => { console.error(error); process.exitCode = 1; });
