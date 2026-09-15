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
    readyState: 'loading',
    addEventListener() {},
    getElementById() { return null; },
  };
}

async function main() {
  const loader = read('docs/js/local-save-folder.js');
  const coordinatorIndex = loader.indexOf('save-coordinator.js');
  const coreIndex = loader.indexOf('local-save-folder-core.js');
  const provenanceIndex = loader.indexOf('folder-save-device-provenance.js');
  const runtimeIndex = loader.indexOf('folder-save-runtime-flush.js');
  const quitIndex = loader.indexOf('folder-save-quit-guard.js');
  const legacyIndex = loader.indexOf('local-save-flow.js');
  const netlifyIndex = loader.indexOf('netlify-cloud-save.js');
  assert.ok(coordinatorIndex >= 0 && coreIndex > coordinatorIndex, 'durable save coordinator should load before external persistence transports');
  assert.ok(provenanceIndex >= 0 && runtimeIndex > provenanceIndex, 'runtime flush should load after folder provenance wrappers');
  assert.ok(quitIndex > runtimeIndex, 'quit guard should load after the runtime flush bridge');
  assert.equal(legacyIndex, -1, 'legacy local-save-flow must stay out of the production loader');
  assert.equal(netlifyIndex, -1, 'legacy Netlify cloud transport must stay out of the production loader');
  assert.ok(read('docs/js/folder-save-quit-guard.js').includes('installQuitButton'), 'quit guard owns the Quit control after retiring local-save-flow');
  console.log('OK  V3 runtime modules own save orchestration without legacy flow activation');

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

  // 2) V3 provenance must come from the canonical envelope, not transport-only
  // timestamps injected into gameplay metadata. Legacy per-entity stamps remain readable.
  {
    const source = read('docs/js/folder-save-device-provenance.js');
    const meta = {
      version: 1,
      characters: [{ id: 'char-a', nickname: 'Tester' }],
      worlds: [{ id: 'world-a', label: 'Hollow' }],
    };
    const originalMetaRaw = JSON.stringify(meta); // Exact gameplay blob compared after folder sync to prove provenance no longer mutates it.
    const localStorage = makeStorage({ hobunjiSaveMeta: originalMetaRaw, 'hobunjiSaveDeviceId.v1': 'device-this-installation' });
    const folderStatus = {
      state: 'ready',
      folderName: 'Hobunji Save',
      autoSyncArmed: true,
      lastError: null,
      dataLossRisk: null,
    };
    let currentEnvelope = {
      writerId: 'device-this-installation',
      writtenAt: 1000,
      contentHash: 'sha256:same-device',
    }; // Durable V3 envelope provenance can change independently of gameplay metadata.
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
        HobunjiSaveSyncStore: {
          async getCurrentEnvelope() { return currentEnvelope ? { ...currentEnvelope } : null; },
        },
        crypto: { randomUUID: () => 'device-unused-random-id' },
      },
    });
    vm.runInContext(source, context, { filename: 'folder-save-device-provenance.js' });

    await localSave.syncNow();
    assert.equal(localStorage.getItem('hobunjiSaveMeta'), originalMetaRaw, 'folder sync must not inject transport provenance into gameplay save metadata');
    assert.match(context.window.FolderSaveDeviceProvenance.sourceLine(), /From “Hobunji Save”/);
    assert.match(context.window.FolderSaveDeviceProvenance.sourceLine(), /Last saved on this device/);
    assert.equal(context.window.FolderSaveDeviceProvenance.latestProvenance().source, 'canonical-envelope', 'canonical envelope is the primary V3 provenance source');

    currentEnvelope = {
      writerId: 'device-other-installation',
      writtenAt: 2000,
      contentHash: 'sha256:other-device',
    };
    await context.window.FolderSaveDeviceProvenance.refreshEnvelopeProvenance();
    assert.match(context.window.FolderSaveDeviceProvenance.sourceLine(), /Last saved on a different device/);
    assert.ok(!context.window.FolderSaveDeviceProvenance.sourceLine().includes('device-other-installation'), 'UI must not expose the anonymous device id itself');

    currentEnvelope = null;
    const legacy = JSON.parse(originalMetaRaw);
    legacy.worlds[0].folderSaveProvenance = { version: 1, lastWriterDeviceId: 'device-this-installation', writtenAt: 500 };
    localStorage.setItem('hobunjiSaveMeta', JSON.stringify(legacy));
    await context.window.FolderSaveDeviceProvenance.refreshEnvelopeProvenance();
    assert.equal(context.window.FolderSaveDeviceProvenance.latestProvenance().source, 'legacy-entity', 'pre-V3 per-entity provenance remains a read-only compatibility fallback');
    console.log('OK  V3 provenance stays outside gameplay content while legacy provenance remains readable');
  }

  // 3) Guard ordering: Quit must capture live runtime state, make that snapshot
  // durable locally + queue linked Drive atomically, then mirror to folder, then reload.
  {
    const source = read('docs/js/folder-save-quit-guard.js');
    const sequence = [];
    let durableOptions = null; // Captures the coordinator call so the test can prove linked Drive is queued at the durable boundary.
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
        readyState: 'loading',
        addEventListener() {},
        getElementById() { return null; },
      },
      window: {
        LocalSaveFolder: {
          isSupported: () => true,
          getStatus: () => ({ ...folderStatus }),
          async syncNow() { sequence.push('folder'); return { ...folderStatus }; },
        },
        HobunjiGoogleDriveSave: {
          getStatus() { return { linked: true, state: 'auth-required' }; },
        },
        HobunjiRuntimeSave: {
          flushNow() { sequence.push('runtime'); return { ok: true, captured: true }; },
        },
        HobunjiSaveCoordinator: {
          async commitCurrent(options) { durableOptions = options; sequence.push('durable'); return { ok: true }; },
        },
        addEventListener() {},
      },
    });
    vm.runInContext(source, context, { filename: 'folder-save-quit-guard.js' });
    await context.window.FolderSaveQuitGuard.guardedQuit(button);
    assert.deepEqual(sequence, ['runtime', 'durable', 'folder', 'reload'], 'Quit must save runtime → durable local → folder → reload, in that order');
    assert.deepEqual(durableOptions?.pendingTargets, ['drive'], 'linked Drive is queued atomically with the durable Quit save even when authorization is absent');
    assert.equal(context.window.__hobunjiFolderSaveQuitDebug.snapshot().queuedDriveCommits, 1, 'mobile diagnostics count the queued Drive commit');
    console.log('OK  guarded Quit durably queues Drive before the primary folder and reload');
  }

  // 4) A real durable-store failure must stop external overwrite/navigation, so
  // the player can retry while the freshly-flushed localStorage state remains intact.
  {
    const source = read('docs/js/folder-save-quit-guard.js');
    const sequence = [];
    const alerts = [];
    const button = { disabled: false, textContent: '🚪 Quit', dataset: {} };
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
      alert: message => alerts.push(message),
      location: { reload() { sequence.push('reload'); } },
      document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; } },
      window: {
        LocalSaveFolder: {
          isSupported: () => true,
          getStatus: () => ({ ...folderStatus }),
          async syncNow() { sequence.push('folder'); return { ...folderStatus }; },
        },
        HobunjiGoogleDriveSave: {
          getStatus() { return { linked: true, state: 'auth-required' }; },
        },
        HobunjiRuntimeSave: {
          flushNow() { sequence.push('runtime'); return { ok: true, captured: true }; },
        },
        HobunjiSaveCoordinator: {
          async commitCurrent() { sequence.push('durable-failed'); return { ok: false, error: 'IDB write failed' }; },
        },
        addEventListener() {},
      },
    });
    vm.runInContext(source, context, { filename: 'folder-save-quit-guard.js' });
    await context.window.FolderSaveQuitGuard.guardedQuit(button);
    assert.deepEqual(sequence, ['runtime', 'durable-failed'], 'durable failure stops before folder overwrite or reload');
    assert.match(alerts[0] || '', /durable local save storage/i, 'durable failure is visible without DevTools');
    console.log('OK  durable-store failures stop folder overwrite and navigation');
  }

  console.log('\nFolder save runtime integrity checks passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
