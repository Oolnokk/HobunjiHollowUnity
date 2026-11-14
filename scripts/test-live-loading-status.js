#!/usr/bin/env node
'use strict';

// Regression coverage for the text-only loading hint displayed under #statusBar.
// Exercises actual module code with fake clock, network edges, Three.js loader
// callbacks, transition loader visibility, explicit jobs, and error cleanup.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const source = read('docs/js/live-loading-status.js');
const html = read('docs/index.html');
const css = read('docs/style.css');
assert.match(html, /id="liveLoadingStatus"[^>]*hidden/, 'shipped gameplay markup begins with no visible loading text');
assert.match(html, /js\/live-loading-status\.js\?v=/, 'loader is installed by the real gameplay page');
assert.match(css, /#liveLoadingStatus\s*\{/, 'text receives dedicated minimal status-bar positioning');
assert.match(css, /#liveLoadingStatus\[hidden\]/, 'hidden state is respected in CSS');
assert.match(read('docs/js/loading-screen-runtime.js'), /onPendingRequestsChanged\(listener\)/, 'existing fetch wrapper supplies request-edge events');
assert(!source.includes('requestAnimationFrame('), 'loading hint does not add frame work or animation');

let time = 1000; // Monotonic game clock advanced manually to check short-request flicker suppression.
let nextTimerId = 0; // Identifies scheduled deadlines in the deterministic fake clock.
const timers = new Map(); // Scheduled one-shot timeouts; no perpetual idle polling.
const setTimeoutFake = (callback, ms) => {
  const id = ++nextTimerId;
  timers.set(id, { callback, at: time + Math.max(1, ms) });
  return id;
};
const advance = ms => {
  time += ms;
  for (let guard = 0; guard < 100; guard++) {
    const due = [...timers].filter(([, timer]) => timer.at <= time).sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) return;
    timers.delete(due[0]);
    due[1].callback();
  }
  throw new Error('loading status timer loop did not settle');
};
const output = { hidden: true, textContent: '' }; // The actual bare output element, with no panel props.
let requests = []; // Existing LoadingScreenRuntime pending-network snapshot; mutable only from simulated fetch edges.
let networkChanged = () => {}; // Registered through the existing loading-screen request hook.
let screenHidden = () => {}; // Registered once for fullscreen-to-gameplay handoff.
let fullscreenVisible = false; // Simulates lore loader that must own the foreground.
let nativeStarts = 0, nativeEnds = 0; // Verifies original Three.js asset manager methods still run.
const manager = {
  itemStart() { nativeStarts++; },
  itemEnd() { nativeEnds++; },
};
const windowObject = {
  performance: { now: () => time },
  __hobunjiGameRenderer: {},
  THREE: { DefaultLoadingManager: manager },
  LoadingScreenRuntime: {
    pendingRequestNames: () => requests.slice(),
    onPendingRequestsChanged(callback) { networkChanged = callback; return () => { networkChanged = () => {}; }; },
    onHidden(callback) { screenHidden = callback; return () => { screenHidden = () => {}; }; },
    getDebug: () => ({ visible: fullscreenVisible }),
  },
};
const documentObject = { getElementById: id => id === 'liveLoadingStatus' ? output : null };
vm.runInNewContext(source, {
  window: windowObject, document: documentObject,
  setTimeout: setTimeoutFake, clearTimeout: id => timers.delete(id),
  console,
}, { filename: 'live-loading-status.js' });

const hint = windowObject.HobunjiLiveLoadingStatus;
assert(hint?.installed, 'live loading runtime is installed');
assert(output.hidden, 'idle HUD stays free of loading text');
requests.push('assets/textures/stone.png?v=4');
networkChanged();
advance(399);
assert(output.hidden, 'short network fetch does not flash the label');
advance(1);
assert.equal(output.hidden, false, 'long-running fetch becomes visible');
assert.match(output.textContent, /Loading textures/, 'real pending file kind is shown');
assert(!output.style && !output.className, 'module adds no visible container or inline style writes');

manager.itemStart('assets/models/tent.glb');
manager.itemStart('assets/models/tent.glb');
assert.equal(nativeStarts, 2, 'real Three.js manager callbacks are preserved');
assert.equal(hint.snapshot().assets, 2);
manager.itemEnd('assets/models/tent.glb');
assert.equal(nativeEnds, 1);
assert.equal(hint.snapshot().assets, 1, 'one of two same-URL asset requests remains pending');
manager.itemEnd('assets/models/tent.glb');
requests.length = 0;
networkChanged();
assert.equal(hint.snapshot().pending, 0);
assert.equal(output.hidden, true, 'text disappears when requests have actually completed');

fullscreenVisible = true;
requests.push('config/locales/camp.json');
networkChanged();
advance(400);
assert(output.hidden, 'full-screen loader hides the in-game status while it owns the screen');
fullscreenVisible = false;
screenHidden();
assert.equal(output.hidden, false, 'remaining request appears immediately after the full-screen loader hides');
assert.match(output.textContent, /world data/);
requests.length = 0;
networkChanged();

windowObject.__hobunjiGameRenderer = null;
manager.itemStart('assets/textures/portrait.png');
advance(400);
assert(output.hidden, 'no gameplay renderer means the hint cannot cover the title/loading sequence');
windowObject.__hobunjiGameRenderer = {};
advance(500);
assert.equal(output.hidden, false, 'pending work becomes visible once the playable renderer exists');
manager.itemEnd('assets/textures/portrait.png');
assert(output.hidden);

(async () => {
  const release = hint.begin('Preparing wilderness'); // Exposed integration hook for later yielding zone loaders.
  advance(400);
  assert.match(output.textContent, /Preparing wilderness/);
  release();
  release();
  assert.equal(hint.snapshot().pending, 0, 'explicit load release is idempotent');
  assert(output.hidden);
  assert.equal(await hint.track(Promise.resolve('ready'), 'world tasks'), 'ready');
  await assert.rejects(hint.track(Promise.reject(new Error('asset missing')), 'world tasks'), /asset missing/);
  assert.equal(hint.snapshot().pending, 0, 'success and failure settle the same async task');
  assert(output.hidden);
  assert.equal(timers.size, 0, 'idle hint leaves no recurring timers');
  assert.equal(hint.snapshot().completedAssets, 3, 'all completed Three.js assets are counted');
  console.log('live loading status: delayed show, network/assets, loading screen, startup renderer, transitions and cleanup passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
