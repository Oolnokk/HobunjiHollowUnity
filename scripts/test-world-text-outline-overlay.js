#!/usr/bin/env node
'use strict';

// Regression guard for the world-popup disappearance introduced when popup and
// ambient dialogue CanvasTexture planes were withheld from the outlined base
// pass and redrawn after the final composite. game.js uses a separate fixed
// post-process camera, so the presentation pass must be recognized from the
// outline composite material rather than the gameplay camera's layer mask.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/outline-render-performance.js'), 'utf8');

class Layers {
  constructor(mask = 1) { this.mask = Number(mask) >>> 0; }
  set(channel) { this.mask = (1 << Number(channel)) >>> 0; }
  disable(channel) { this.mask = (this.mask & ~((1 << Number(channel)) >>> 0)) >>> 0; }
  enableAll() { this.mask = 0xFFFFFFFF >>> 0; }
}

class Renderer {
  constructor() {
    this._target = null;
    this.autoClear = true;
    this.shadowMap = { enabled: false, autoUpdate: true };
    this.info = { render: { calls: 0, triangles: 0, points: 0, lines: 0 } };
    this.calls = [];
  }
  getRenderTarget() { return this._target; }
  setRenderTarget(target) { this._target = target || null; }
}
Renderer.prototype.render = function render(scene, camera) {
  this.calls.push({ scene: scene?.name || '', mask: Number(camera?.layers?.mask ?? 0) >>> 0, target: this._target });
};

const THREE = { WebGLRenderer: Renderer, BackSide: 'back-side' };
let clock = 0;
const performanceStub = { now: () => ++clock };
const documentStub = {
  readyState: 'complete',
  getElementById: () => null,
  addEventListener() {},
};
const windowObject = { THREE };
const context = { window: windowObject, document: documentStub, performance: performanceStub, console };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'outline-render-performance.js' });

const api = windowObject.OutlineRenderPerformance;
assert.ok(api?.installed, 'OutlineRenderPerformance must install');

function makePopupMesh() {
  return {
    isMesh: true,
    renderOrder: 1200,
    visible: true,
    layers: new Layers(1),
    material: {
      map: { isCanvasTexture: true },
      depthTest: false,
      depthWrite: false,
    },
  };
}

function makeWorldScene(name, popup) {
  return {
    name,
    overrideMaterial: null,
    background: { kind: 'world-background' },
    autoUpdate: true,
    children: [],
    traverse(callback) { callback(popup); },
  };
}

function makePostScene(name = 'outline-post') {
  return {
    name,
    overrideMaterial: null,
    background: null,
    autoUpdate: true,
    children: [{
      material: {
        uniforms: {
          tColor: { value: {} },
          tEdgeId: { value: {} },
          uTexel: { value: {} },
          uDepthOutlinesOn: { value: 1 },
          uSeamOutlinesOn: { value: 1 },
        },
      },
    }],
  };
}

function renderBase(renderer, scene, camera) {
  renderer.setRenderTarget({ texture: {}, depthTexture: {} });
  renderer.render(scene, camera);
}

function renderShell(renderer, scene, camera) {
  const previousMask = camera.layers.mask;
  const previousOverride = scene.overrideMaterial;
  camera.layers.set(1);
  scene.overrideMaterial = {
    isShaderMaterial: true,
    side: THREE.BackSide,
    uniforms: { uThickness: { value: 1 } },
  };
  renderer.render(scene, camera);
  scene.overrideMaterial = previousOverride;
  camera.layers.mask = previousMask;
}

function renderPost(renderer, scene, camera) {
  renderer.setRenderTarget(null);
  renderer.render(scene, camera);
}

function testFixedPostCameraAndUnrelatedPass() {
  const renderer = new Renderer();
  const popup = makePopupMesh();
  const worldScene = makeWorldScene('world', popup);
  const worldCamera = { layers: new Layers(0xFFFFFFFF) };
  const postScene = makePostScene();
  const postCamera = { layers: new Layers(1) }; // Mirrors a normal fixed fullscreen camera: default layer only.

  renderBase(renderer, worldScene, worldCamera);
  assert.strictEqual(popup.layers.mask, 1 << 6, 'popup must be withheld from the offscreen base pass on the reserved overlay layer');
  assert.strictEqual(popup.visible, true, 'popup visibility must be restored immediately after the base draw');
  const baseCall = renderer.calls.find(call => call.scene === 'world' && call.target !== null);
  assert.strictEqual(baseCall?.mask, 0xFFFFFFFF >>> 0, 'nested render hooks must still see the authoritative all-layers gameplay camera mask during the base pass');

  // An auxiliary render between base and composite used to invalidate the pending
  // popup handoff. It must no longer be allowed to make text disappear.
  renderer.setRenderTarget(null);
  renderer.render({ name: 'auxiliary', overrideMaterial: null, children: [], autoUpdate: true }, { layers: new Layers(1) });
  assert.strictEqual(popup.layers.mask, 1 << 6, 'unrelated render calls must not discard a pending popup overlay');

  renderShell(renderer, worldScene, worldCamera);
  renderPost(renderer, postScene, postCamera);

  assert.strictEqual(api.classifyPass(renderer, postScene, postCamera), 'postOrDirect', 'default-layer fixed post camera must still be recognized as the outline presentation pass');
  assert.strictEqual(popup.layers.mask, 1, 'popup layer membership must be restored after the final overlay draw');
  assert.strictEqual(popup.visible, true, 'popup visibility must remain restored after the final overlay draw');

  const overlayCalls = renderer.calls.filter(call => call.scene === 'world' && call.target === null && call.mask === (1 << 6));
  assert.strictEqual(overlayCalls.length, 1, 'world popup must be drawn exactly once after the final composite');

  const uniforms = postScene.children[0].material.uniforms;
  assert.strictEqual(uniforms.uDepthOutlinesOn.value, 0, 'obsolete depth outline composite must remain suppressed');
  assert.strictEqual(uniforms.uSeamOutlinesOn.value, 0, 'obsolete material seam composite must remain suppressed');
}

function testNoShellStillRestoresPopup() {
  const before = api.snapshot();
  const renderer = new Renderer();
  const popup = makePopupMesh();
  const worldScene = makeWorldScene('world-no-shell', popup);
  const worldCamera = { layers: new Layers(0xFFFFFFFF) };
  const postScene = makePostScene('outline-post-no-shell');
  const postCamera = { layers: new Layers(1) };

  renderBase(renderer, worldScene, worldCamera);
  renderPost(renderer, postScene, postCamera);

  assert.strictEqual(popup.layers.mask, 1, 'popup must be restored even when no shell pass ran');
  const overlayCalls = renderer.calls.filter(call => call.scene === 'world-no-shell' && call.target === null && call.mask === (1 << 6));
  assert.strictEqual(overlayCalls.length, 1, 'withheld popup must still be drawn once when shell outlines are disabled/skipped');

  const after = api.snapshot();
  assert.strictEqual(after.withheldWorldTextBasePasses, before.withheldWorldTextBasePasses + 1, 'debug counter must record the withheld base pass');
  assert.strictEqual(after.finalWorldTextOverlayPasses, before.finalWorldTextOverlayPasses + 1, 'debug counter must record the successful final popup overlay');
  assert.strictEqual(after.abandonedWorldTextOverlays, before.abandonedWorldTextOverlays, 'successful presentation must not increment abandoned-overlay diagnostics');
}

testFixedPostCameraAndUnrelatedPass();
testNoShellStillRestoresPopup();
console.log('world-text final-overlay regression guard passed');
