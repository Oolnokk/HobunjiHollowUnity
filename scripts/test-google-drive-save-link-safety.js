'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/google-drive-save-link-safety.js'), 'utf8');

async function main() {
  const calls = [];
  let coordinatorResult = { ok: true, envelope: { contentHash: 'sha256:local-current', snapshot: { id: 'local' } } };
  let currentEnvelope = coordinatorResult.envelope; // Durable local authority returned after the browser recapture.
  let priorLink = { fileId: 'drive-old' }; // Existing linked file whose reconciliation baseline must never leak into another file id.
  let baseline = { contentHash: 'sha256:old-baseline' }; // Deliberately stale previous-file baseline used to catch identity mixing.
  let conflict = null; // Captures immediate preservation of ambiguous new-file branches.
  let rawResult = {
    ok: true,
    link: { fileId: 'drive-old' },
    metadata: { id: 'drive-old' },
    remoteEnvelope: { contentHash: 'sha256:local-current', snapshot: { id: 'same' } },
    decision: { state: 'identical' },
  }; // First scenario relinks the same file id and should keep its applicable baseline.
  let lastReconciliationArgs = null; // Records corrected decision inputs when file identity changes.

  const localStorage = {
    value: '{"characters":[{"id":"c"}],"worlds":[]}',
    getItem(key) { return key === 'hobunjiSaveMeta' ? this.value : null; },
  };
  const originalDrive = {
    getStatus() { return { configured: true, linked: Boolean(priorLink), fileId: priorLink?.fileId || null }; },
    async linkExistingFile() { calls.push('raw-link'); return rawResult; },
    async syncPending() {},
  };
  const store = {
    async getLink() { return priorLink; },
    async getCurrentEnvelope() { return currentEnvelope; },
    async setBaseline(_target, value) { baseline = value; calls.push(['baseline', value]); },
    async setConflict(_target, value) { conflict = value; calls.push(['conflict', value?.kind || null]); },
    async appendEvent(type, details) { calls.push(['event', type, details]); },
  };
  const reconciliation = {
    decide(args) {
      lastReconciliationArgs = args;
      if (!args.baselineContentHash && args.localEnvelope?.contentHash !== args.externalEnvelope?.contentHash) {
        return { state: 'first-link-needs-direction', safeAutomatic: false };
      }
      return { state: 'identical', safeAutomatic: true };
    },
  };
  const context = vm.createContext({
    console,
    localStorage,
    Date,
    window: {
      HobunjiGoogleDriveSave: originalDrive,
      HobunjiSaveCoordinator: {
        async commitCurrent(options) { calls.push(['capture', options]); return coordinatorResult; },
      },
      HobunjiSaveSyncStore: store,
      HobunjiSaveReconciliation: reconciliation,
    },
  });
  vm.runInContext(source, context, { filename: 'google-drive-save-link-safety.js' });

  const sameFile = await context.window.HobunjiGoogleDriveSave.linkExistingFile();
  assert.equal(calls[0][0], 'capture', 'first-link wrapper captures browser save before opening/processing the Drive link');
  assert.equal(calls[0][1].reason, 'drive-link-local-capture', 'first-link recapture has a distinct diagnostics reason');
  assert.equal(calls[1], 'raw-link', 'raw Drive Picker/reconciliation runs only after local recapture succeeds');
  assert.equal(sameFile.fileIdentityChanged, false, 'relinking the same file id keeps its existing reconciliation identity');
  assert.deepEqual(baseline, { contentHash: 'sha256:old-baseline' }, 'same-file relink does not discard an applicable baseline');
  assert.equal(context.window.__hobunjiGoogleDriveLinkSafetyDebug.snapshot().lastCaptureHash, 'sha256:local-current', 'mobile diagnostics expose the local hash protected before first link');

  // Choosing a different file id must sever the prior file's ancestry. The raw
  // transport may have classified it using the old baseline, so the wrapper
  // recomputes with baseline=null and preserves both branches immediately.
  calls.length = 0;
  rawResult = {
    ok: true,
    link: { fileId: 'drive-new' },
    metadata: { id: 'drive-new', version: '8' },
    remoteEnvelope: { contentHash: 'sha256:remote-new', snapshot: { id: 'remote-new' } },
    decision: { state: 'external-only-change' }, // Intentionally wrong/stale-baseline classification from the raw layer.
  };
  const switched = await context.window.HobunjiGoogleDriveSave.linkExistingFile();
  assert.equal(switched.fileIdentityChanged, true, 'selecting another Drive file is recognized as a new reconciliation identity');
  assert.equal(switched.decision.state, 'first-link-needs-direction', 'different file is recomputed with no inherited common baseline');
  assert.equal(baseline, null, 'old file baseline is cleared before the corrected new-file decision is retained');
  assert.equal(lastReconciliationArgs.baselineContentHash, null, 'new Drive file decision receives no previous-file baseline hash');
  assert.equal(conflict.kind, 'drive-link-divergence', 'different local/remote branches are immediately preserved as a durable link conflict');
  assert.equal(conflict.local.contentHash, 'sha256:local-current');
  assert.equal(conflict.external.contentHash, 'sha256:remote-new');
  let debug = context.window.__hobunjiGoogleDriveLinkSafetyDebug.snapshot();
  assert.equal(debug.fileIdentityChanges, 1, 'file-id switch remains visible in mobile diagnostics');
  assert.equal(debug.decisionsRecomputed, 1);
  assert.equal(debug.preservedAmbiguousLinks, 1);
  assert.equal(debug.lastLinkedFileId, 'drive-new');

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
  rawResult = { ok: false, cancelled: true };
  await context.window.HobunjiGoogleDriveSave.linkExistingFile();
  assert.equal(calls.at(-1), 'raw-link', 'truly empty browser may still open Drive Picker when IndexedDB is unavailable');

  console.log('OK  Drive linking captures localStorage and isolates reconciliation baselines by exact file id');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
