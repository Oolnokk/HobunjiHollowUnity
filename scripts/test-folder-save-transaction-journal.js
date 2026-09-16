'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootPath = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(rootPath, relative), 'utf8');

function clone(value) {
  return structuredClone(value);
}

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

class FakeFileHandle {
  constructor(name, fullPath, controller) {
    this.kind = 'file';
    this.name = name;
    this.fullPath = fullPath;
    this.controller = controller;
    this.content = '';
  }

  async getFile() {
    const content = this.content;
    return { text: async () => content };
  }

  async createWritable() {
    let next = '';
    return {
      write: async value => { next = String(value); },
      close: async () => {
        if (this.controller.failPath === this.fullPath && this.controller.failCount > 0) {
          this.controller.failCount--;
          throw new Error(`Injected write failure at ${this.fullPath}`);
        }
        this.content = next;
      },
    };
  }
}

class FakeDirectoryHandle {
  constructor(name, fullPath, controller) {
    this.kind = 'directory';
    this.name = name;
    this.fullPath = fullPath;
    this.controller = controller;
    this.children = new Map();
  }

  async queryPermission() { return 'granted'; }
  async requestPermission() { return 'granted'; }

  async getDirectoryHandle(name, options = {}) {
    const existing = this.children.get(name);
    if (existing?.kind === 'directory') return existing;
    if (existing) throw new Error(`${name} is not a directory`);
    if (!options?.create) {
      const error = new Error(`Directory not found: ${name}`);
      error.name = 'NotFoundError';
      throw error;
    }
    const fullPath = this.fullPath ? `${this.fullPath}/${name}` : name;
    const created = new FakeDirectoryHandle(name, fullPath, this.controller);
    this.children.set(name, created);
    return created;
  }

  async getFileHandle(name, options = {}) {
    const existing = this.children.get(name);
    if (existing?.kind === 'file') return existing;
    if (existing) throw new Error(`${name} is not a file`);
    if (!options?.create) {
      const error = new Error(`File not found: ${name}`);
      error.name = 'NotFoundError';
      throw error;
    }
    const fullPath = this.fullPath ? `${this.fullPath}/${name}` : name;
    const created = new FakeFileHandle(name, fullPath, this.controller);
    this.children.set(name, created);
    return created;
  }

  async removeEntry(name) {
    if (!this.children.has(name)) {
      const error = new Error(`Entry not found: ${name}`);
      error.name = 'NotFoundError';
      throw error;
    }
    this.children.delete(name);
  }

  async *entries() {
    for (const entry of this.children.entries()) yield entry;
  }
}

function makeIndexedDb(savedHandle) {
  return {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = {
          objectStoreNames: { contains: () => true },
          transaction() {
            return {
              objectStore() {
                return {
                  get() {
                    const getRequest = {};
                    queueMicrotask(() => {
                      getRequest.result = savedHandle;
                      getRequest.onsuccess?.();
                    });
                    return getRequest;
                  },
                };
              },
            };
          },
        };
        request.onsuccess?.();
      });
      return request;
    },
  };
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'unnamed';
}

async function putJson(dir, name, value) {
  const handle = await dir.getFileHandle(name, { create: true });
  handle.content = JSON.stringify(value);
}

async function putCanonical(root, snapshot, savedAt) {
  const chars = await root.getDirectoryHandle('characters', { create: true });
  const worlds = await root.getDirectoryHandle('worlds', { create: true });
  const farms = await root.getDirectoryHandle('farm-layouts', { create: true });
  chars.children.clear();
  worlds.children.clear();
  farms.children.clear();
  for (const character of snapshot.meta.characters) {
    await putJson(chars, `${slugify(character.nickname)}-${character.id}.json`, character);
  }
  for (const world of snapshot.meta.worlds) {
    await putJson(worlds, `${slugify(world.label)}-${world.id}.json`, world);
  }
  for (const [worldId, layout] of Object.entries(snapshot.farmLayouts)) {
    await putJson(farms, `${worldId}.json`, { worldId, layout });
  }
  await putJson(root, 'manifest.json', {
    version: snapshot.meta.version ?? 1,
    portableSaveVersion: 2,
    recoverySaveVersion: 1,
    farmLayoutsIncluded: true,
    savedAt,
    characterCount: snapshot.meta.characters.length,
    worldCount: snapshot.meta.worlds.length,
    farmLayoutCount: Object.keys(snapshot.farmLayouts).length,
  });
}

async function putPending(root, record) {
  const journalDir = await root.getDirectoryHandle('transaction-journal', { create: true });
  await putJson(journalDir, 'pending.json', record);
}

async function hasPending(root) {
  try {
    const dir = await root.getDirectoryHandle('transaction-journal');
    await dir.getFileHandle('pending.json');
    return true;
  } catch (error) {
    if (error?.name === 'NotFoundError') return false;
    throw error;
  }
}

async function settleInit(window) {
  for (let i = 0; i < 8; i++) {
    await new Promise(resolve => setImmediate(resolve));
    if (window.LocalSaveFolder?.getStatus?.().state === 'ready') return;
  }
  throw new Error(`Folder core did not initialize: ${JSON.stringify(window.LocalSaveFolder?.getStatus?.())}`);
}

function makeSnapshot(turnips) {
  return {
    snapshotVersion: 1,
    meta: {
      version: 1,
      characters: [{ id: 'char_a', nickname: 'Tester', stable: [{ id: 'stable_a' }] }],
      worlds: [{
        id: 'world_a',
        label: 'Hollow',
        members: { char_a: { nonGearInventory: { turnip: turnips, ore: 3, milk: 1 } } },
        storage: { hay: 12, seed: 4, wool: 2 },
        livestock: [{ id: 'livestock_a' }],
      }],
    },
    farmLayouts: { world_a: { tiles: [turnips, 2, 3] } },
  };
}

async function main() {
  const journalSource = read('docs/js/folder-save-transaction-journal.js');
  const coreSource = read('docs/js/local-save-folder-core.js');
  const loaderSource = read('docs/js/local-save-folder.js');

  assert.ok(loaderSource.indexOf('folder-save-transaction-journal.js') < loaderSource.indexOf('local-save-folder-core.js'), 'transaction rules load before the folder core');
  assert.match(coreSource, /TRANSACTION_PENDING_FILE = 'pending\.json'/, 'folder core has a durable pending transaction marker');
  assert.match(coreSource, /withTransactionLock\(\(\) => _syncNowImpl\(options\)\)/, 'all canonical sync paths use the core cross-tab transaction lock');
  assert.match(coreSource, /repairPendingTransactionUnlocked\(\{ reason: 'before-read' \}\)/, 'canonical reads repair interrupted writes before trusting folder data');
  assert.match(coreSource, /writePendingTransactionUnlocked\(record\)/, 'canonical writes persist the journal before touching the target snapshot');

  const pureWindow = {};
  vm.runInNewContext(journalSource, { window: pureWindow, Date, JSON, Object, Number, String, Array, Error }, { filename: 'folder-save-transaction-journal.js' });
  const journal = pureWindow.HobunjiFolderTransactionJournal;
  const before = makeSnapshot(8);
  const target = makeSnapshot(5);
  const record = journal.createRecord({
    transactionId: 'tx-pure',
    startedAt: 100,
    source: 'test',
    before: { savedAt: 90, snapshot: before },
    target: { savedAt: 100, snapshot: target },
  });
  assert.equal(journal.decideRecovery(record, target).action, 'finalize-target', 'completed target with a leftover marker finalizes instead of rolling back');
  assert.equal(journal.decideRecovery(record, makeSnapshot(6)).action, 'rollback-before', 'torn target with a previous canonical snapshot rolls back');
  const firstWrite = journal.createRecord({ transactionId: 'tx-first', startedAt: 100, source: 'test', before: null, target: { savedAt: 100, snapshot: target } });
  assert.equal(journal.decideRecovery(firstWrite, makeSnapshot(6)).action, 'finish-target', 'interrupted first write finishes its staged target when no prior canonical snapshot exists');
  const reordered = clone(target);
  reordered.meta.characters.reverse();
  reordered.meta.worlds.reverse();
  assert.equal(journal.snapshotsMatch(target, reordered), true, 'snapshot comparison ignores directory iteration order for characters/worlds');

  const controller = { failPath: null, failCount: 0 };
  const root = new FakeDirectoryHandle('Hobunji Save', '', controller);
  const snapshotA = makeSnapshot(8);
  const snapshotB = makeSnapshot(5);
  const snapshotC = makeSnapshot(2);
  await putCanonical(root, snapshotA, 1000);

  const localStorage = makeStorage({
    hobunjiSaveMeta: JSON.stringify(snapshotB.meta),
    'hobunji_farm_layout_v3:world_a': JSON.stringify(snapshotB.farmLayouts.world_a),
  });
  let lockRequests = 0;
  const window = {
    showDirectoryPicker: async () => root,
    addEventListener() {},
    navigator: {
      locks: {
        request: async (_name, _options, operation) => {
          lockRequests++;
          return operation();
        },
      },
    },
    crypto: { randomUUID: () => `uuid-${lockRequests}` },
    HobunjiSaveCheckpoints: {
      evaluateSnapshotForFolderWrite: () => ({ ok: true }),
      onFolderSnapshotWritten: async () => {},
    },
  };
  const context = vm.createContext({
    window,
    indexedDB: makeIndexedDb(root),
    localStorage,
    console,
    location: { reload() {} },
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: fn => { fn(); return 1; },
    queueMicrotask,
    Date,
    Math,
    JSON,
    Object,
    Number,
    String,
    Array,
    Set,
    Map,
    Error,
    Promise,
  });
  vm.runInContext(journalSource, context, { filename: 'folder-save-transaction-journal.js' });
  vm.runInContext(coreSource, context, { filename: 'local-save-folder-core.js' });
  await settleInit(window);

  let status = await window.LocalSaveFolder.syncNow({ force: true });
  assert.equal(status.lastError, null, 'normal transactional folder save succeeds');
  assert.equal(await hasPending(root), false, 'normal commit clears pending.json');
  assert.ok(lockRequests > 0, 'canonical save requested the core Web Lock');
  let primary = await window.LocalSaveFolder.readPrimarySnapshot();
  assert.equal(primary.snapshot.meta.worlds[0].members.char_a.nonGearInventory.turnip, 5, 'normal commit installs the target canonical snapshot');

  // Inject a failure after the character file has already changed but before the
  // world file closes. The journal must restore all canonical files to snapshot B.
  localStorage.setItem('hobunjiSaveMeta', JSON.stringify(snapshotC.meta));
  localStorage.setItem('hobunji_farm_layout_v3:world_a', JSON.stringify(snapshotC.farmLayouts.world_a));
  controller.failPath = 'worlds/hollow-world_a.json';
  controller.failCount = 1;
  status = await window.LocalSaveFolder.syncNow({ force: true });
  assert.match(status.lastError || '', /rolled the canonical folder back safely/i, 'mid-write failure reports a completed transaction rollback');
  assert.equal(await hasPending(root), false, 'successful rollback clears the interrupted transaction marker');
  primary = await window.LocalSaveFolder.readPrimarySnapshot();
  assert.equal(primary.snapshot.meta.worlds[0].members.char_a.nonGearInventory.turnip, 5, 'mid-write failure restores the previous whole canonical snapshot');
  assert.ok(window.LocalSaveFolder.getStatus().transactionRollbacks >= 1, 'rollback is visible in save diagnostics');

  // Simulate a hard crash: pending.json exists and only one canonical file reached
  // the new target. The next canonical read (the same path startup inspection uses)
  // must repair before returning data.
  const crashRecord = journal.createRecord({
    transactionId: 'tx-hard-crash',
    startedAt: 2000,
    source: 'test-hard-crash',
    before: { savedAt: primary.savedAt, snapshot: clone(snapshotB) },
    target: { savedAt: 2000, snapshot: clone(snapshotC) },
  });
  await putPending(root, crashRecord);
  const chars = await root.getDirectoryHandle('characters');
  await putJson(chars, 'tester-char_a.json', snapshotC.meta.characters[0]);
  primary = await window.LocalSaveFolder.readPrimarySnapshot();
  assert.equal(primary.snapshot.meta.worlds[0].members.char_a.nonGearInventory.turnip, 5, 'startup/read repair rolls a torn hard-crash transaction back before exposing it');
  assert.equal(await hasPending(root), false, 'startup/read repair clears the recovered crash marker');

  // Simulate a crash after every canonical data file completed but before the
  // marker was removed. The target should be kept and its manifest finalized.
  await putCanonical(root, snapshotC, 2000);
  await putPending(root, crashRecord);
  primary = await window.LocalSaveFolder.readPrimarySnapshot();
  assert.equal(primary.snapshot.meta.worlds[0].members.char_a.nonGearInventory.turnip, 2, 'fully written target survives a crash before journal cleanup');
  assert.equal(primary.savedAt, 2000, 'finalization restores the target manifest timestamp');
  assert.equal(await hasPending(root), false, 'completed target finalization clears the stale marker');

  console.log('folder save transaction journal regression: ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
