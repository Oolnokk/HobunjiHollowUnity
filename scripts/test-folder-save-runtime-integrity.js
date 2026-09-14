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

  (async () => {
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
  })().catch(error => { throw error; });
}

// 3) Guard ordering: Quit must commit live runtime state before it asks the
// folder layer to serialize localStorage, and only reload after both finish.
(async () => {
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
  console.log('OK  guarded Quit flushes live runtime before the primary folder and reload');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
