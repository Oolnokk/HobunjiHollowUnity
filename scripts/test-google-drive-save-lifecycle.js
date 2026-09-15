'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/google-drive-save-lifecycle.js'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'docs/js/local-save-folder.js'), 'utf8');

async function main() {
  new Function(source);
  const uiIndex = loader.indexOf('google-drive-save-ui.js'); // Lifecycle status refresh depends on the Drive Settings surface being available first.
  const lifecycleIndex = loader.indexOf('google-drive-save-lifecycle.js'); // Production lifecycle module under test.
  const startupIndex = loader.indexOf('google-drive-save-startup.js'); // Startup authorization gate remains separate and loads after passive session lifecycle checks.
  assert.ok(uiIndex >= 0 && lifecycleIndex > uiIndex, 'Drive lifecycle reconciliation loads after Drive Settings/transport UI');
  assert.ok(startupIndex > lifecycleIndex, 'pre-onboarding Drive startup gate loads after lifecycle reconciliation hooks');

  const windowListeners = new Map(); // Captures online/pageshow handlers without a browser event loop.
  const documentListeners = new Map(); // Captures visibility handler for foreground checks.
  let syncCalls = 0; // Counts transport preflights and verifies they are strictly non-interactive.
  let lastSyncOptions = null; // Captures the options passed to syncPending.
  let refreshCalls = 0; // Visible Drive UI should refresh after silent lifecycle checks.
  const status = {
    configured: true,
    linked: true,
    tokenPresent: true,
    busyOperation: null,
  }; // Mutable fake transport status used to test authorized and fresh-session cases.

  const window = {
    HobunjiGoogleDriveSave: {
      getStatus() { return { ...status }; },
      async syncPending(options) {
        syncCalls++;
        lastSyncOptions = options;
        return {
          ok: false,
          needsResolution: true,
          decision: { state: 'external-only-change' },
          status: { state: 'remote-update' },
        }; // Remote-only discovery must surface, not hot-load or overwrite.
      },
    },
    HobunjiGoogleDriveSaveUI: {
      async refresh() { refreshCalls++; },
    },
    addEventListener(type, listener) { windowListeners.set(type, listener); },
  };
  window.window = window;

  const document = {
    visibilityState: 'visible',
    addEventListener(type, listener) { documentListeners.set(type, listener); },
  };
  const navigator = { onLine: true };
  const context = vm.createContext({
    window,
    document,
    navigator,
    console,
    setTimeout,
    clearTimeout,
    Math,
    Number,
    Boolean,
    String,
    Date,
  });
  vm.runInContext(source, context, { filename: 'google-drive-save-lifecycle.js' });

  const lifecycle = window.HobunjiGoogleDriveSaveLifecycle;
  assert.ok(lifecycle?.checkNow, 'lifecycle module exposes an explicit diagnostic check hook');

  const checked = await lifecycle.checkNow('test-foreground');
  assert.equal(syncCalls, 1, 'authorized lifecycle check performs one Drive preflight');
  assert.deepEqual(lastSyncOptions, { interactive: false }, 'lifecycle preflight can never summon Google authorization UI');
  assert.equal(checked.needsResolution, true, 'remote-only change is surfaced for later resolution instead of hot-loaded');
  assert.equal(refreshCalls, 1, 'Drive Settings status refreshes after lifecycle preflight');
  let debug = window.__hobunjiGoogleDriveSaveLifecycleDebug.snapshot();
  assert.equal(debug.remoteUpdates, 1, 'remote-only lifecycle discovery is visible in mobile diagnostics');
  assert.equal(debug.lastResult, 'external-only-change');

  status.tokenPresent = false;
  const skipped = await lifecycle.checkNow('fresh-session-no-token');
  assert.equal(skipped.skipped, 'auth-required', 'fresh page session without a memory token stays local until an explicit Drive gesture');
  assert.equal(syncCalls, 1, 'no-token lifecycle check performs no Drive request');
  debug = window.__hobunjiGoogleDriveSaveLifecycleDebug.snapshot();
  assert.equal(debug.skippedNoToken, 1, 'no-token skips remain visible in diagnostics');

  status.tokenPresent = true;
  navigator.onLine = false;
  const offline = await lifecycle.checkNow('offline-return');
  assert.equal(offline.skipped, 'offline', 'offline foreground never attempts a Drive request');
  assert.equal(syncCalls, 1);

  assert.ok(windowListeners.has('online'), 'online reconnect schedules a lifecycle Drive preflight');
  assert.ok(windowListeners.has('pageshow'), 'BFCache resume is covered');
  assert.ok(documentListeners.has('visibilitychange'), 'foreground visibility transition is covered');

  console.log('OK  Drive lifecycle reconciliation stays silent, local-first, and detects remote changes after foreground/reconnect');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
