'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/google-drive-save-link-safety.js'), 'utf8');

async function main() {
  const calls = [];
  let coordinatorResult = { ok: true, envelope: { contentHash: 'sha256:local-current' } };
  const localStorage = {
    value: '{"characters":[{"id":"c"}],"worlds":[]}',
    getItem(key) { return key === 'hobunjiSaveMeta' ? this.value : null; },
  };
  const originalDrive = {
    getStatus() { return { configured: true, linked: false }; },
    async linkExistingFile() { calls.push('raw-link'); return { ok: true }; },
    async syncPending() {},
  };
  const context = vm.createContext({
    console,
    localStorage,
    window: {
      HobunjiGoogleDriveSave: originalDrive,
      HobunjiSaveCoordinator: {
        async commitCurrent(options) { calls.push(['capture', options]); return coordinatorResult; },
      },
    },
  });
  vm.runInContext(source, context, { filename: 'google-drive-save-link-safety.js' });

  await context.window.HobunjiGoogleDriveSave.linkExistingFile();
  assert.equal(calls[0][0], 'capture', 'first-link wrapper captures browser save before opening/processing the Drive link');
  assert.equal(calls[0][1].reason, 'drive-link-local-capture', 'first-link recapture has a distinct diagnostics reason');
  assert.equal(calls[1], 'raw-link', 'raw Drive Picker/reconciliation runs only after local recapture succeeds');
  assert.equal(context.window.__hobunjiGoogleDriveLinkSafetyDebug.snapshot().lastCaptureHash, 'sha256:local-current', 'mobile diagnostics expose the local hash protected before first link');

  calls.length = 0;
  coordinatorResult = { ok: false, unavailable: true, error: 'IndexedDB unavailable' };
  await assert.rejects(
    () => context.window.HobunjiGoogleDriveSave.linkExistingFile(),
    /local save but durable sync storage is unavailable/i,
    'existing local save is never treated as empty when durable storage cannot capture it'
  );
  assert.equal(calls.some(value => value === 'raw-link'), false, 'unsafe first link stops before Picker/reconciliation can overwrite the local branch');

  calls.length = 0;
  localStorage.value = null;
  coordinatorResult = { ok: false, unavailable: true, error: 'IndexedDB unavailable' };
  await context.window.HobunjiGoogleDriveSave.linkExistingFile();
  assert.equal(calls.at(-1), 'raw-link', 'truly empty browser may still restore Drive when IndexedDB is unavailable');

  console.log('OK  Drive first-link comparison cannot miss an existing localStorage-only save');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
