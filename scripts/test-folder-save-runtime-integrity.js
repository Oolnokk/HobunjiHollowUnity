'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    dump() { return Object.fromEntries(values); },
  };
}

function basicDom() {
  return {
    body: null,
    addEventListener() {},
    getElementById() { return null; },
  };
}

async function main() {
  const loader = read('docs/js/local-save-folder.js');
  const provenanceIndex = loader.indexOf('folder-save-device-provenance.js');
  const runtimeIndex = loader.indexOf('folder-save-runtime-flush.js');
  const quitIndex = loader.indexOf('folder-save-quit-guard.js');
  const legacyIndex = loader.indexOf('local-save-flow.js');
  assert.ok(provenanceIndex >= 0 && runtimeIndex > provenanceIndex, 'runtime flush should load after folder provenance wrappers');
  assert.ok(quitIndex > runtimeIndex, 'quit guard should load after the runtime flush bridge');
  assert.ok(legacyIndex > quitIndex, 'quit guard must register before the legacy quit flow');
  console.log('OK  folder save runtime modules load in safe orchestration order');

  // 1) Prove the exact Grehlr failure class is closed: livestock collection can
  // no longer update the live bag and save livestock while leaving member
  // inventory stale in localStorage until some unrelated later action.
  {
    const source = read('docs/js/folder-save-runtime-flush.js');
    const context = vm.createContext({
      console,
      window: {},
      document: basicDom(),
    });
    vm.runInContext(source, context, { filename: 'folder-save-runtime-flush.js' });

    let receivedDeps = null;
    context.window.FarmAnimals = {
      init(deps) { receivedDeps = deps; },
    };

    const inventory = { grehlrStinkOil: 0 };
    let persistedStinkOil = 0;
    let memberSaves = 0;
    let livestockSaves = 0;
    let farmSaves = 0;
    context.window.FarmAnimals.init({
      inventory,
      saveMemberWorldData() { persistedStinkOil = inventory.grehlrStinkOil; memberSaves++; },
      saveFarmLayout() { farmSaves++; },
      saveWorldLivestock() { livestockSaves++; },
    });

    inventory.grehlrStinkOil = 1;
    receivedDeps.saveWorldLivestock([]);
    assert.equal(livestockSaves, 1, 'livestock state should still save normally');
    assert.equal(persistedStinkOil, 1, 'Grehlr stink oil must be persisted with the livestock collection operation');
    assert.equal(memberSaves, 1, 'inventory-changing livestock collection should persist member data exactly once');

    inventory.grehlrStinkOil = 2;
    const flushed = context.window.HobunjiRuntimeSave.flushNow({ reason: 'test-quit' });
    assert.equal(flushed.ok, true, 'explicit runtime flush should succeed after gameplay init');
    assert.equal(flushed.captured, true, 'explicit runtime flush should use the real member save callback');
    assert.equal(persistedStinkOil, 2, 'explicit runtime flush must capture the latest live inventory');
    assert.equal(farmSaves, 1, 'explicit runtime flush should also persist the current farm layout');

    // A live folder capture must not stringify the entire old browser save just
    // to detect if it changes while the canonical disk write is in flight.
    let fullFingerprintCalls = 0; // Detects accidental regression to whole-save fingerprinting.
    context.window.__hobunjiPlayerProfile = { worldId: 'world-test' };
    context.window.HobunjiSaveSnapshot = {
      capture: () => ({
        snapshotVersion: 1,
        meta: { version: 1, characters: [{ id: 'char-test' }], worlds: [{ id: 'world-test' }] },
        farmLayouts: { 'world-test': { tiles: [1] } },
      }),
      browserCacheParts: () => ['browser-meta', 'world-test', 'browser-layout'],
      fingerprint: () => { fullFingerprintCalls++; return 'expensive serialized save'; },
      validate: () => {},
    };
    context.window.FarmEditor = { captureFarmLayout: () => ({ tiles: [2] }) };
    context.window.FarmAnimals.init({
      inventory,
      saveMemberWorldData() {},
      saveFarmLayout() {},
      captureMemberWorldData(meta) { return meta; },
    });
    const directCapture = context.window.HobunjiRuntimeSave.captureSnapshot({ reason: 'test-auto' });
    assert.equal(directCapture.ok, true, 'direct folder capture still completes');
    assert.equal(fullFingerprintCalls, 0, 'raw browser cache parts replace expensive whole-save baseline fingerprinting');
    assert.equal(directCapture.snapshot.browserBaselineParts.length, 3, 'transient baseline covers browser meta and farm layout');
    assert.equal(Object.keys(directCapture.snapshot).includes('browserBaselineParts'), false,
      'transient browser baseline cannot be serialized into primary or recovery checkpoints');

    console.log('OK  live Grehlr resource inventory is persisted before folder mirroring');
  }

  // 2) Prove portable saves carry an anonymous last-writer installation id and
  // the onboarding text can distinguish this installation from another one.
  {
    const source = read('docs/js/folder-save-device-provenance.js');
    const meta = {
      version: 1,
      characters: [{ id: 'char-a', nickname: 'Tester' }],
      worlds: [{ id: 'world-a', label: 'Hollow' }],
    };
    const localStorage = makeStorage({ hobunjiSaveMeta: JSON.stringify(meta) });
    const folderStatus = {
      state: 'ready',
      folderName: 'Hobunji Save',
      autoSyncArmed: true,
      lastError: null,
      dataLossRisk: null,
    };
    const localSave = {
      getStatus() { return { ...folderStatus }; },
      async syncNow() { return { ...folderStatus }; },
      async loadFromFolder() { return { ok: true, changed: true }; },
    };
    const context = vm.createContext({
      console,
      localStorage,
      document: basicDom(),
      MutationObserver: class { observe() {} },
      requestAnimationFrame(fn) { fn(); },
      window: {
        LocalSaveFolder: localSave,
        crypto: { randomUUID: () => 'device-this-installation' },
      },
    });
    vm.runInContext(source, context, { filename: 'folder-save-device-provenance.js' });

    await localSave.syncNow();
    const stamped = JSON.parse(localStorage.getItem('hobunjiSaveMeta'));
    assert.equal(stamped.worlds[0].folderSaveProvenance.lastWriterDeviceId, 'device-this-installation', 'world save should remember anonymous last writer');
    assert.equal(stamped.characters[0].folderSaveProvenance.lastWriterDeviceId, 'device-this-installation', 'character save should remember anonymous last writer');
    assert.ok(Number(stamped.worlds[0].folderSaveProvenance.writtenAt) > 0, 'save provenance should remember overwrite time');
    assert.match(context.window.FolderSaveDeviceProvenance.sourceLine(), /From “Hobunji Save”/);
    assert.match(context.window.FolderSaveDeviceProvenance.sourceLine(), /Last saved on this device/);

    stamped.worlds[0].folderSaveProvenance.lastWriterDeviceId = 'device-other-installation';
    stamped.worlds[0].folderSaveProvenance.writtenAt += 1000;
    localStorage.setItem('hobunjiSaveMeta', JSON.stringify(stamped));
    assert.match(context.window.FolderSaveDeviceProvenance.sourceLine(), /Last saved on a different device/);
    assert.ok(!context.window.FolderSaveDeviceProvenance.sourceLine().includes('device-other-installation'), 'UI must not expose the anonymous device id itself');
    console.log('OK  Resume provenance shows folder source and same/different-device status without naming devices');
  }

  // 3) Guard ordering: Quit must commit live runtime state before it asks the
  // folder layer to serialize localStorage, and only reload after both finish.
  {
    const source = read('docs/js/folder-save-quit-guard.js');
    const sequence = [];
    const button = {
      disabled: false,
      textContent: '🚪 Quit',
      dataset: {},
    };
    const folderStatus = {
      supported: true,
      state: 'ready',
      folderName: 'Hobunji Save',
      autoSyncArmed: true,
      lastError: null,
      dataLossRisk: null,
    };
    const context = vm.createContext({
      console,
      confirm: () => true,
      alert: message => { throw new Error('Unexpected alert: ' + message); },
      location: { reload() { sequence.push('reload'); } },
      document: {
        addEventListener() {},
        querySelector() { return null; },
      },
      window: {
        LocalSaveFolder: {
          isSupported: () => true,
          getStatus: () => ({ ...folderStatus }),
          async syncNow() { sequence.push('folder'); return { ...folderStatus }; },
        },
        HobunjiRuntimeSave: {
          flushNow() { sequence.push('runtime'); return { ok: true, captured: true }; },
        },
        addEventListener() {},
      },
    });
    vm.runInContext(source, context, { filename: 'folder-save-quit-guard.js' });
    await context.window.FolderSaveQuitGuard.guardedQuit(button);
    assert.deepEqual(sequence, ['runtime', 'folder', 'reload'], 'Quit must save runtime → folder → reload, in that order');
    for (const lastAction of ['saved-primary-recovery-error', 'autosaved-primary-recovery-error']) {
      sequence.length = 0;
      folderStatus.lastAction = lastAction;
      folderStatus.lastError = 'Primary folder save succeeded, but recovery history could not be updated: quota exceeded';
      await context.window.FolderSaveQuitGuard.guardedQuit(button);
      assert.deepEqual(sequence, ['runtime', 'folder', 'reload'], 'secondary recovery errors do not block a successful primary save');
      assert.equal(context.window.__hobunjiFolderSaveQuitDebug.snapshot().lastRecoveryWarning, folderStatus.lastError);
    }
    sequence.length = 0;
    folderStatus.lastAction = 'save-error';
    folderStatus.lastError = 'disk write failed';
    context.alert = message => { sequence.push('alert'); assert.match(message, /disk write failed/); };
    await context.window.FolderSaveQuitGuard.guardedQuit(button);
    assert.deepEqual(sequence, ['runtime', 'folder', 'alert'], 'a real primary save failure still blocks quit');
    console.log('OK  guarded Quit distinguishes primary failure from recovery warnings');
  }

  // 4) An in-flight fallback folder write must not mirror an older snapshot
  // over browser changes that happened after serialization began.
  {
    const browser = makeStorage({
      hobunjiSaveMeta: JSON.stringify({ version: 1, characters: [{ id: 'c', nickname: 'Original' }], worlds: [{ id: 'w', label: 'World' }] }),
      'hobunji_farm_layout_v3:w': JSON.stringify({ tiles: [1] }),
    });
    let mutateDuringWrite = false; // Inject a browser change after the folder save snapshot has already been captured.
    let browserMirrors = 0; // Confirms the second, stale folder save does not overwrite the newer browser cache.
    function directory(name) {
      const files = new Map(); // In-memory files provide a File System Access API double.
      const dirs = new Map(); // Child directory handles for characters/worlds/layouts.
      const notFound = () => Object.assign(new Error('not found'), { name: 'NotFoundError' });
      return {
        name,
        async queryPermission() { return 'granted'; },
        async getDirectoryHandle(child, options = {}) {
          if (!dirs.has(child)) {
            if (!options.create) throw notFound();
            dirs.set(child, directory(child));
          }
          return dirs.get(child);
        },
        async getFileHandle(child, options = {}) {
          if (!files.has(child)) {
            if (!options.create) throw notFound();
            files.set(child, '');
          }
          return {
            kind: 'file',
            async getFile() { return { text: async () => files.get(child) }; },
            async createWritable() {
              return {
                async write(value) {
                  files.set(child, value);
                  if (name === 'characters' && mutateDuringWrite) {
                    mutateDuringWrite = false;
                    const newer = JSON.parse(browser.getItem('hobunjiSaveMeta'));
                    newer.characters[0].nickname = 'Newer browser edit';
                    browser.setItem('hobunjiSaveMeta', JSON.stringify(newer));
                  }
                },
                async close() {},
              };
            },
          };
        },
        async *entries() {
          for (const [child, handle] of dirs) yield [child, { kind: 'directory', ...handle }];
          for (const child of files.keys()) yield [child, { kind: 'file' }];
        },
        async removeEntry(child) { files.delete(child); },
      };
    }
    const root = directory('Save Folder'); // Simulated permission-granted primary save directory.
    const idbValues = new Map(); // Remembered folder handle store used by LocalSaveFolder.init.
    const indexedDB = {
      open() {
        const req = {};
        Promise.resolve().then(() => {
          req.result = {
            objectStoreNames: { contains: () => true },
            transaction: () => {
              const tx = {
                objectStore: () => ({
                  get(key) {
                    const result = {};
                    Promise.resolve().then(() => { result.result = idbValues.get(key); result.onsuccess?.(); });
                    return result;
                  },
                  put(value, key) { idbValues.set(key, value); Promise.resolve().then(() => tx.oncomplete?.()); },
                }),
              };
              return tx;
            },
          };
          req.onsuccess?.();
        });
        return req;
      },
    };
    let nextTimer = 1; // Stable timer ids let the debounce remain pending without sleeping the test.
    const intervals = new Map(); // Pending callbacks prove the autosave debounce was scheduled.
    const sandbox = {
      window: {
        showDirectoryPicker: async () => root,
        addEventListener() {},
        __hobunjiGameStarted: false,
        HobunjiSaveSnapshot: {
          browserCacheParts: () => [browser.getItem('hobunjiSaveMeta'), 'w', browser.getItem('hobunji_farm_layout_v3:w')],
          apply() { browserMirrors++; },
        },
      },
      indexedDB,
      localStorage: browser,
      setTimeout(callback, ms) { const id = nextTimer++; intervals.set(id, { callback, ms }); return id; },
      clearTimeout(id) { intervals.delete(id); },
      setInterval(callback, ms) { const id = nextTimer++; intervals.set(id, { callback, ms }); return id; },
      clearInterval(id) { intervals.delete(id); },
    };
    vm.runInNewContext(read('docs/js/local-save-folder-core.js'), sandbox, { filename: 'local-save-folder-core.js' });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await sandbox.window.LocalSaveFolder.chooseFolder();
    const first = await sandbox.window.LocalSaveFolder.syncNow();
    assert.equal(first.autoSyncArmed, true, 'first explicit folder save arms autosaving');
    mutateDuringWrite = true;
    const before = browserMirrors;
    const status = await sandbox.window.LocalSaveFolder.syncNow({ automatic: true, reason: 'folder-timer' });
    assert.equal(status.lastError, null, 'the canonical folder write itself succeeds');
    assert.match(status.browserMirrorWarning || '', /newer browser changes/i, 'the fallback path detects edits made during disk I/O');
    assert.equal(browserMirrors, before, 'an old snapshot never replaces newer browser state');
    assert.equal(status.changeSyncPending, true, 'the newer edits are queued for another folder autosave');
    assert.equal(JSON.parse(browser.getItem('hobunjiSaveMeta')).characters[0].nickname, 'Newer browser edit');
    console.log('OK  in-flight folder autosave preserves newer browser edits');
  }

  console.log('\nFolder save runtime integrity checks passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
