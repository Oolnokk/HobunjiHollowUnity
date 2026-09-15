'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/folder-save-local-autosave-policy.js'), 'utf8');

let rawSyncCalls = 0;
let rawLoadCalls = 0;
let rawReconnectCalls = 0;
let rawReconcileCalls = 0;
let internalStatus = {
  supported: true,
  state: 'ready',
  folderName: 'Hobunji Hollow',
  autoSyncArmed: false,
  lastError: null,
};

const listeners = new Set();
const localSave = {
  getStatus() { return { ...internalStatus }; },
  onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  async syncNow(options = {}) {
    rawSyncCalls++;
    internalStatus = { ...internalStatus, autoSyncArmed: !options.automatic };
    return { ...internalStatus };
  },
  async loadFromFolder() {
    rawLoadCalls++;
    internalStatus = { ...internalStatus, autoSyncArmed: true };
    return { ok: true, changed: true };
  },
  async reconnect() {
    rawReconnectCalls++;
    internalStatus = { ...internalStatus, autoSyncArmed: false, state: 'ready' };
    return { ...internalStatus };
  },
  async reconcileConnectedFolder() {
    rawReconcileCalls++;
    internalStatus = { ...internalStatus, autoSyncArmed: true };
    return { ok: true };
  },
};

const window = { LocalSaveFolder: localSave };
window.window = window;
const context = vm.createContext({ window, console, Object, String, Boolean, Promise });
vm.runInContext(source, context, { filename: 'folder-save-local-autosave-policy.js' });

(async () => {
  assert.equal(window.LocalSaveFolder.getStatus().autoSyncArmed, false, 'public folder status always reports automatic folder sync disabled');
  assert.equal(window.LocalSaveFolder.getStatus().folderWritePolicy, 'explicit-only', 'folder status exposes explicit-only write policy');

  const blocked = await window.LocalSaveFolder.syncNow({ automatic: true });
  assert.equal(rawSyncCalls, 0, 'automatic folder write never reaches the legacy core writer');
  assert.equal(blocked.automaticWriteBlocked, true, 'blocked automatic write is explicit to upstream V3 wrappers');
  assert.equal(blocked.state, 'automatic-folder-write-blocked', 'blocked automatic result cannot look like a successful ready write');

  const explicit = await window.LocalSaveFolder.syncNow();
  assert.equal(rawSyncCalls, 1, 'explicit Save to Folder still reaches the legacy writer');
  assert.equal(rawReconnectCalls, 1, 'explicit write immediately disarms the legacy timer via non-destructive reconnect');
  assert.equal(internalStatus.autoSyncArmed, false, 'legacy timer is actually off after explicit write');
  assert.equal(explicit.autoSyncArmed, false, 'explicit write returns explicit-only status');

  const loaded = await window.LocalSaveFolder.loadFromFolder();
  assert.equal(loaded.ok, true, 'explicit folder restore still succeeds');
  assert.equal(rawLoadCalls, 1, 'explicit folder restore reaches the legacy loader');
  assert.equal(rawReconnectCalls, 2, 'folder restore immediately disarms the legacy timer');
  assert.equal(internalStatus.autoSyncArmed, false, 'legacy timer is off after folder restore');

  await window.LocalSaveFolder.reconcileConnectedFolder();
  assert.equal(rawReconcileCalls, 1, 'direct legacy reconcile remains available');
  assert.equal(rawReconnectCalls, 3, 'direct reconcile is also disarmed before returning');
  assert.equal(internalStatus.autoSyncArmed, false, 'direct reconcile cannot leave folder autosync armed');

  const debug = window.__hobunjiFolderSaveLocalAutosavePolicyDebug.snapshot();
  assert.equal(debug.blockedAutomaticWrites, 1, 'blocked automatic write is visible in diagnostics');
  assert.equal(debug.timerDisarms, 3, 'timer disarms are visible in diagnostics');
  assert.equal(debug.explicitWrites, 1, 'explicit folder write count is visible in diagnostics');
  assert.equal(debug.explicitLoads, 1, 'explicit folder load count is visible in diagnostics');

  console.log('OK  normal autosaves stay browser-local and legacy folder timers are disarmed after explicit folder operations');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
