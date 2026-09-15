'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/google-drive-save-identity-probe.js'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'docs/js/local-save-folder.js'), 'utf8');

const window = {};
window.window = window;
const context = vm.createContext({
  window,
  console,
  document: {
    body: null,
    addEventListener() {},
    getElementById() { return null; },
  },
  sessionStorage: {
    getItem() { return null; },
    setItem() {},
  },
  MutationObserver: class { observe() {} },
  Date,
  JSON,
  String,
  Number,
  Boolean,
  Math,
  Object,
  Array,
});

vm.runInContext(source, context, { filename: 'google-drive-save-identity-probe.js' });
const probe = window.HobunjiGoogleDriveIdentityProbe;
assert.ok(probe?.compareSamples, 'identity probe exposes its pure comparison criterion for regression tests');

const baseline = probe.compareSamples(null, { fileId: 'file-a', version: '1', contentHash: 'sha256:a' });
assert.equal(baseline.state, 'baseline-recorded', 'first probe records a comparison baseline without claiming success');

const pass = probe.compareSamples(
  { fileId: 'file-a', version: '1', contentHash: 'sha256:a' },
  { fileId: 'file-a', version: '2', contentHash: 'sha256:b' }
);
assert.equal(pass.state, 'stable-id-version-advanced', 'same file id plus advanced Drive version is the required identity-preservation pass');

const replaced = probe.compareSamples(
  { fileId: 'file-a', version: '1', contentHash: 'sha256:a' },
  { fileId: 'file-b', version: '2', contentHash: 'sha256:b' }
);
assert.equal(replaced.state, 'file-id-changed', 'a new file id is always a failure even when Drive version/content changed');

const unsettled = probe.compareSamples(
  { fileId: 'file-a', version: '1', contentHash: 'sha256:a' },
  { fileId: 'file-a', version: '1', contentHash: 'sha256:b' }
);
assert.equal(unsettled.state, 'hash-changed-version-static', 'hash changes without a version advance are treated as unsettled sync, not a pass');

const unchanged = probe.compareSamples(
  { fileId: 'file-a', version: '2', contentHash: 'sha256:b' },
  { fileId: 'file-a', version: '2', contentHash: 'sha256:b' }
);
assert.equal(unchanged.state, 'unchanged', 'identical samples report no remote change');

const debugAfterPureComparisons = window.__hobunjiGoogleDriveIdentityProbeDebug.snapshot();
assert.equal(debugAfterPureComparisons.stableIdentityPasses, 0, 'pure comparison calls do not increment runtime PASS telemetry');
assert.equal(debugAfterPureComparisons.identityFailures, 0, 'pure comparison calls do not increment runtime failure telemetry');

assert(source.includes('drive.inspectRemote({ interactive: true })'), 'probe samples Drive through the read-only inspected remote envelope');
assert(!source.includes('updateRemoteFile') && !source.includes("method: 'PATCH'"), 'identity probe contains no Drive write path');
assert(source.includes("SESSION_KEY = 'hobunjiDriveIdentityProbe.v1'"), 'non-secret prior sample survives a same-tab reload for manual desktop testing');

const conflictIndex = loader.indexOf('google-drive-save-conflict-ui.js');
const probeIndex = loader.indexOf('google-drive-save-identity-probe.js');
const lifecycleIndex = loader.indexOf('google-drive-save-lifecycle.js');
assert(conflictIndex >= 0 && probeIndex > conflictIndex, 'identity probe loads after Drive Settings/conflict controls exist');
assert(lifecycleIndex > probeIndex, 'background lifecycle logic remains separate from the explicit identity probe');

console.log('OK  Drive identity probe requires stable fileId + advanced Drive version and never writes remote content');
