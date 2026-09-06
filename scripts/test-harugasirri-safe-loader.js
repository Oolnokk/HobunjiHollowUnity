'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const loaderSource = fs.readFileSync(path.join(repoRoot, 'docs/js/local-save-folder.js'), 'utf8');
const backdropSource = fs.readFileSync(path.join(repoRoot, 'docs/js/harugasirri-superbackdrop.js'), 'utf8');

// Regression: the Harugasirri script must NOT be parser-injected before
// border-terrain.js. That used to replace/chase the Cloud Forest BorderTerrain
// accessor chain before normal rendering had booted, which could leave the UI
// alive while the Three.js world never reached its normal render bootstrap.
const writes = [];
const listeners = new Map();
let appendedScript = null;
const activeScene = { id: 'farm-scene' };
const logs = [];
const windowForLoader = {
  GridTileAccessors: { getActiveScene: () => activeScene },
  BorderTerrain: { buildTownBorderTerrain() { return 'town-built'; } },
  __farmLog: message => logs.push(message),
};
const documentForLoader = {
  readyState: 'loading',
  write: text => writes.push(String(text)),
  addEventListener: (name, handler) => listeners.set(name, handler),
  createElement: tag => ({ tagName: String(tag).toUpperCase(), async: true, src: '', onload: null, onerror: null }),
  head: { appendChild: node => { appendedScript = node; } },
};
vm.runInNewContext(loaderSource, { window: windowForLoader, document: documentForLoader, console });
assert.equal(writes.some(text => text.includes('harugasirri-superbackdrop.js')), false,
  'Harugasirri must not be inserted by document.write during parser bootstrap');
assert.equal(typeof listeners.get('DOMContentLoaded'), 'function', 'late Harugasirri loader should wait for normal game bootstrap');
listeners.get('DOMContentLoaded')();
assert(appendedScript?.src.includes('harugasirri-superbackdrop.js'), 'late loader should append Harugasirri after bootstrap');
assert(logs.some(message => message.includes('normal game bootstrap complete')),
  'the first Harugasirri status message should reach menu debug only after normal bootstrap');

let attachedScene = null;
windowForLoader.HarugasirriSuperBackdrop = {
  attach(scene) { attachedScene = scene; return Promise.resolve(scene); },
};
appendedScript.onload();
assert.equal(attachedScene, activeScene, 'late loader should attach to the already-built active scene');
assert.equal(windowForLoader.BorderTerrain.__harugasirriLateTownFallback, true,
  'late loader should install the town-scene fallback after BorderTerrain.init has already run');
assert(logs.some(message => message.includes('safe late loader armed')),
  'safe late-loader status should be available through the in-menu debug logger');

// Regression: when Harugasirri itself executes after BorderTerrain exists, it
// must take the simple wrapping path and leave BorderTerrain as an ordinary
// value property. No accessor/setter interception is permitted in this path.
const borderTerrain = {
  init() {},
  buildBorderTerrain() {},
  buildZoneBorderTerrain() {},
  buildTownBorderTerrain() {},
};
const windowForBackdrop = {
  BorderTerrain: borderTerrain,
  HobunjiCacheAudit: { register() {} },
  __farmLog() {},
};
vm.runInNewContext(backdropSource, {
  window: windowForBackdrop,
  console,
  fetch: () => Promise.reject(new Error('fetch should not run during bootstrap-only test')),
  Promise,
  WeakMap,
  WeakSet,
});
const descriptor = Object.getOwnPropertyDescriptor(windowForBackdrop, 'BorderTerrain');
assert.equal(windowForBackdrop.BorderTerrain, borderTerrain, 'Harugasirri should wrap the existing BorderTerrain object in place');
assert.equal(typeof descriptor?.set, 'undefined', 'late Harugasirri load must not install a BorderTerrain setter');
assert.equal(borderTerrain.__harugasirriSuperBackdropPatch, true, 'existing BorderTerrain API should be wrapped successfully');

console.log('PASS Harugasirri safe loader: no parser-time BorderTerrain interception; late active-scene attach and town fallback armed.');
