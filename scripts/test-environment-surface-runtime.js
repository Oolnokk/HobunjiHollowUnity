'use strict';

// environment-surface-runtime.js is retired: snow and slush are owned by
// environment-surface-micro-plateau.js (see test-environment-surface-micro-plateau*.js).
// What remains is an inert EnvironmentSurfaceRuntime stub that rain-planes.js's
// bootstrap and environment-surface-pixel-probe.js still look for, plus the
// Western Slope mountain-backdrop loader. Check that remaining contract.

const fs = require('fs');
const assert = require('assert');
const vm = require('vm');

const runtime = fs.readFileSync('docs/js/environment-surface-runtime.js', 'utf8');
const rain = fs.readFileSync('docs/js/rain-planes.js', 'utf8');
const hub = fs.readFileSync('docs/tools/index.html', 'utf8');

const appended = [];
const window = {};
const document = {
  readyState: 'complete',
  createElement: () => ({}),
  head: { appendChild: node => appended.push(node) },
};
vm.runInNewContext(runtime, { window, document });

const api = window.EnvironmentSurfaceRuntime;
assert(api && api.__retiredV5, 'the retired stub still publishes window.EnvironmentSurfaceRuntime');
assert.doesNotThrow(() => { api.init(); api.update(0.016); }, 'stub lifecycle calls are no-ops');
const snapshot = api.debugSnapshot();
assert.strictEqual(snapshot.mode, 'none', 'stub builds no surfaces');
assert.strictEqual(snapshot.pendingJobs, 0, 'stub queues no jobs');
assert.deepStrictEqual(api.forceRebuild(), snapshot, 'forceRebuild just reports the inert snapshot');
assert.strictEqual(appended.length, 1, 'late-load path appends the Western Slope backdrop script');
assert.match(appended[0].src, /^js\/western-slope-mountain-backdrops\.js\?v=[A-Za-z0-9_.-]+$/);

assert.match(rain, /environment-surface-runtime\.js\?v=[A-Za-z0-9_.-]+/, 'rain bootstrap must synchronously load the environment runtime before game boot');
assert.match(hub, /data-target="wilderness-generation-lab"/, 'main tool hub must expose the Wilderness + Surface Lab');

console.log('Environment surface runtime (retired stub) checks passed.');
