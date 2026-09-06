'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const loaderSource = fs.readFileSync(path.join(repoRoot, 'docs/js/local-save-folder.js'), 'utf8');
const backdropSource = fs.readFileSync(path.join(repoRoot, 'docs/js/harugasirri-superbackdrop-runtime.js'), 'utf8');

// Regression: neither Harugasirri transform nor runtime may be parser-injected
// alongside the core save/bootstrap scripts. They remain post-bootstrap visuals.
const writes = [];
const listeners = new Map();
const appendedScripts = [];
const activeScene = { id: 'farm-scene' };
const logs = [];
let accessorsReady = false;
const gridAccessors = {
  init() { accessorsReady = true; },
  getActiveScene() {
    if (!accessorsReady) throw new TypeError('deps is null');
    return activeScene;
  },
};
const windowForLoader = {
  GridTileAccessors: gridAccessors,
  BorderTerrain: { buildTownBorderTerrain() { return 'town-built'; } },
  __farmLog: message => logs.push(message),
};
const documentForLoader = {
  readyState: 'loading',
  write: text => writes.push(String(text)),
  createElement: tag => ({ tagName: String(tag).toUpperCase(), async: true, src: '', onload: null, onerror: null }),
  head: { appendChild: node => appendedScripts.push(node) },
};
const loaderContext = {
  window: windowForLoader,
  document: documentForLoader,
  console,
  Object,
};
windowForLoader.addEventListener = (name, handler) => listeners.set(name, handler);
vm.runInNewContext(loaderSource, loaderContext);
assert.equal(writes.some(text => text.includes('harugasirri-transform.js')), false,
  'Harugasirri transform helper must not be document.write-loaded during game parser bootstrap');
assert.equal(writes.some(text => text.includes('harugasirri-superbackdrop')), false,
  'Harugasirri runtime must not be document.write-loaded during game parser bootstrap');
assert.equal(typeof listeners.get('DOMContentLoaded'), 'function', 'late Harugasirri loader should wait for parser bootstrap');

listeners.get('DOMContentLoaded')();
assert.equal(appendedScripts.length, 1, 'post-bootstrap loader should start with the transform helper only');
assert(appendedScripts[0].src.includes('harugasirri-transform.js'), 'transform helper should load before backdrop runtime');
windowForLoader.HarugasirriTransform = {};
appendedScripts[0].onload();
assert.equal(appendedScripts.length, 2, 'runtime should be appended only after the transform helper loads');
assert(appendedScripts[1].src.includes('harugasirri-superbackdrop-runtime.js'), 'second late script should be the transform-aware runtime');

let attachedScene = null;
windowForLoader.HarugasirriSuperBackdrop = {
  attach(scene) { attachedScene = scene; return Promise.resolve(scene); },
};
appendedScripts[1].onload();
assert.equal(attachedScene, null, 'runtime load must tolerate GridTileAccessors existing before its deps are initialized');
assert.equal(gridAccessors.__harugasirriSceneReadyHook, true, 'loader should arm the one-shot scene-ready init hook');
gridAccessors.init({});
assert.equal(attachedScene, activeScene, 'GridTileAccessors.init should attach the backdrop at the exact point scene deps become valid');
assert(logs.some(message => message.includes('normal parser bootstrap complete')),
  'Harugasirri status should start only after parser bootstrap');
assert(logs.some(message => message.includes('waiting for GridTileAccessors.init')),
  'menu debug should explain the delayed scene-ready wait');
assert(logs.some(message => message.includes('attached through GridTileAccessors.init')),
  'menu debug should confirm the actual scene-ready attach path');
assert(logs.some(message => message.includes('safe late loader armed')),
  'safe late-loader status should be available through the in-menu debug logger');

// Regression: the new runtime sees an already-created BorderTerrain and wraps
// it directly. It must never install the old parser-time accessor/setter hook.
const borderTerrain = {
  init() {},
  buildBorderTerrain() {},
  buildZoneBorderTerrain() {},
  buildTownBorderTerrain() {},
};
const runtimeListeners = new Map();
const windowForBackdrop = {
  BorderTerrain: borderTerrain,
  HobunjiCacheAudit: { register() {} },
  __farmLog() {},
  addEventListener(name, handler) { runtimeListeners.set(name, handler); },
};
vm.runInNewContext(backdropSource, {
  window: windowForBackdrop,
  document: { currentScript: { src: 'https://example.test/js/harugasirri-superbackdrop-runtime.js' } },
  location: { href: 'https://example.test/index.html', pathname: '/index.html' },
  URL,
  console,
  fetch: () => Promise.reject(new Error('fetch should not run during bootstrap-only test')),
  Promise,
  Set,
  WeakMap,
  WeakSet,
});
const descriptor = Object.getOwnPropertyDescriptor(windowForBackdrop, 'BorderTerrain');
assert.equal(windowForBackdrop.BorderTerrain, borderTerrain, 'Harugasirri should wrap the existing BorderTerrain object in place');
assert.equal(typeof descriptor?.set, 'undefined', 'late Harugasirri runtime must not install a BorderTerrain setter');
assert.equal(borderTerrain.__harugasirriSuperBackdropPatch, true, 'existing BorderTerrain API should be wrapped successfully');
assert.equal(typeof runtimeListeners.get('harugasirri-transform-changed'), 'function',
  'runtime should refresh attached backdrops only when transform state changes');

console.log('PASS Harugasirri safe loader: delayed GridTileAccessors init attaches the boot scene with no parser-time BorderTerrain interception.');
