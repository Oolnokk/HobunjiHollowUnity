'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

(async () => {
  const repoRoot = path.resolve(__dirname, '..');
  const loaderSource = fs.readFileSync(path.join(repoRoot, 'docs/js/local-save-folder.js'), 'utf8');
  const backdropSource = fs.readFileSync(path.join(repoRoot, 'docs/js/harugasirri-superbackdrop-runtime.js'), 'utf8');

  // Regression: Harugasirri helpers remain post-bootstrap visuals and never add
  // timers or render-loop work just to wait for a scene.
  assert.equal(loaderSource.includes('setInterval('), false, 'Harugasirri loader must not poll');
  assert.equal(loaderSource.includes('requestAnimationFrame('), false, 'Harugasirri loader must not add per-frame work');
  assert(loaderSource.includes('HarugasirriCullRange?.armScene?.(group)'),
    'successful runtime attachment must directly hand the actual group to the cull/range helper');
  const writes = [];
  const listeners = new Map();
  const appendedScripts = [];
  const activeScene = { id: 'farm-scene' };
  const logs = [];
  let accessorsReady = false;
  let sceneReady = false;
  const gridAccessors = {
    init() { accessorsReady = true; },
    getActiveScene() {
      if (!accessorsReady) throw new TypeError('deps is null');
      return sceneReady ? activeScene : null;
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
    Promise,
    WeakSet,
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
  assert(appendedScripts[0].src.includes('harugasirri-transform.js'), 'transform helper should load first');
  windowForLoader.HarugasirriTransform = {};
  appendedScripts[0].onload();
  assert.equal(appendedScripts.length, 2, 'render-order/cull guard should load after the transform helper');
  assert(appendedScripts[1].src.includes('harugasirri-cull-range.js'),
    'render-order/cull guard must be armed before any backdrop can be attached');
  let handedOffGroup = null;
  windowForLoader.HarugasirriCullRange = { armScene(group) { handedOffGroup = group; } };
  appendedScripts[1].onload();
  assert.equal(appendedScripts.length, 3, 'runtime should load after transform + render-order/cull guard');
  assert(appendedScripts[2].src.includes('harugasirri-superbackdrop-runtime.js'),
    'third late script should be the transform-aware runtime');

  let attachedScene = null;
  const attachedGroup = { id: 'harugasirri-group' };
  windowForLoader.HarugasirriSuperBackdrop = {
    attach(scene) { attachedScene = scene; return Promise.resolve(attachedGroup); },
  };
  appendedScripts[2].onload();
  assert.equal(attachedScene, null, 'runtime load must tolerate GridTileAccessors existing before its deps are initialized');
  assert.equal(gridAccessors.__harugasirriSceneReadyHook, true, 'loader should arm the accessor-init hook');

  gridAccessors.init({});
  assert.equal(attachedScene, null,
    'GridTileAccessors.init itself is not proof that the Three.js scene exists yet');
  sceneReady = true;
  const returnedScene = gridAccessors.getActiveScene();
  assert.equal(returnedScene, activeScene, 'wrapped accessor must preserve the original getActiveScene return value');
  assert.equal(attachedScene, activeScene,
    'the first later getActiveScene() that returns a real scene must trigger backdrop attachment');
  await Promise.resolve();
  assert.equal(handedOffGroup, attachedGroup,
    'the exact group returned by HarugasirriSuperBackdrop.attach must be handed directly to the cull/range helper');
  assert(logs.some(message => message.includes('first real active scene')),
    'menu debug should explain that scene readiness is deferred beyond accessor init when necessary');
  assert(logs.some(message => message.includes('safe late loader armed')),
    'safe late-loader status should be available through the in-menu debug logger');

  // Texture IO is visual enhancement only. The group must be constructible and
  // attachable before texture callbacks fire, otherwise one image failure/hang can
  // suppress all Harugasirri geometry and leave the scene count at zero.
  assert.equal(backdropSource.includes('const loaded = await shadeFilledTexture'), false,
    'material creation must not await texture IO');
  assert.equal(backdropSource.includes('await Promise.all(['), false,
    'template creation must not wait for all material textures');
  assert(backdropSource.includes("textureStatus: 'loading'"),
    'materials should start as immediate flat fallbacks and upgrade asynchronously');
  assert(backdropSource.includes("HobunjiCacheAudit?.register?.('Harugasirri attach attempts'"),
    'performance dumps should expose attach attempts separately from successful scene attaches');
  assert(backdropSource.includes("HobunjiCacheAudit?.register?.('Harugasirri backdrop failures'"),
    'performance dumps should expose backdrop failures directly');

  // Regression: the runtime sees an already-created BorderTerrain and wraps it
  // directly. It must never install the old parser-time accessor/setter hook.
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

  console.log('PASS Harugasirri safe loader: direct range handoff follows the successful attach, late scene creation still works without polling, and texture IO cannot block geometry.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
