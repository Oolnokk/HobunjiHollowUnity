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
  enable(channel) { this.mask = (this.mask | ((1 << Number(channel)) >>> 0)) >>> 0; }
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
  clearDepth() { this.calls.push({kind:'clearDepth',target:this._target}); } // A compositor actor-mask pass clears depth but preserves the fully rendered canvas color.
}
Renderer.prototype.render = function render(scene, camera) {
  this.calls.push({ scene: scene?.name || '', mask: Number(camera?.layers?.mask ?? 0) >>> 0, target: this._target,
    noteDepthTest:scene?.scoreNote?.material?.depthTest, actorColorWrite:scene?.maskActor?.material?.colorWrite,
    actorDepthWrite:scene?.maskActor?.material?.depthWrite, actorAlphaTest:scene?.maskActor?.material?.alphaTest,
    effectLayers:scene?.maskEffect?.layers?.mask, actorLayers:scene?.maskActor?.layers?.mask });
};

class Color {
  constructor(value) { this.value = value; this.isColor = true; }
  copy(other) { this.value = other?.value; return this; }
  set(value) { this.value = value; return this; }
}
class Matrix3 {
  constructor() { this.isMatrix3 = true; }
  copy() { return this; }
  identity() { return this; }
}
class ShaderMaterial {
  constructor(options = {}) {
    Object.assign(this, options);
    this.isShaderMaterial = true;
    this.userData = {}; // Used by outline-render-performance.js to tag its shared alpha-aware target materials.
  }
}

const THREE = {
  WebGLRenderer: Renderer,
  BackSide: 'back-side',
  DoubleSide: 'double-side',
  LessEqualDepth: 'less-equal-depth',
  AdditiveBlending: 'additive-blending',
  Color,
  Matrix3,
  ShaderMaterial,
};
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

function testPlateGatedScoreAvoidsHiddenFinalPass() {
  const renderer = new Renderer();
  const note = makePopupMesh(); // Uses the same CanvasTexture/depth/renderOrder contract as outdoor Scratchbone clues.
  note.renderOrder = 1202;
  note.userData={puzzleCaveScoreOverlay:true}; // Exactly the opt-in flag on every exterior Scratchbone ink and halo plane.
  const board = { visible: false }; // The score itself remains cached while the player stands off its activation plate.
  note.parent = board;
  const scene = makeWorldScene('plate-gated-score', note);
  const body={isMesh:true,visible:true,layers:new Layers(1),
    material:{map:{},transparent:true,alphaTest:.001,colorWrite:true,depthWrite:false,depthTest:true}}; // Soft portrait edges need the existing solid-pixel depth cutoff.
  const effect={isMesh:true,visible:true,layers:new Layers(1),
    material:{map:{},transparent:true,alphaTest:0,blending:THREE.AdditiveBlending,depthTest:true,depthWrite:false}}; // Additive eye/glow planes are not solid silhouettes.
  const root={visible:true,parent:scene,traverse(callback){callback(body);callback(effect);}}; // Real rigs have both opaque cutouts and transparent effects.
  body.parent=root;effect.parent=root;
  scene.scoreNote=note;scene.maskActor=body;scene.maskEffect=effect;
  api.setScoreCharacterRootsProvider(function*(){yield root;yield root;}); // Duplicate entries from active and corpse registries are deduplicated.
  const camera = { layers: new Layers(0xFFFFFFFF) };
  const post = makePostScene('outline-post-score');
  const postCamera = { layers: new Layers(1) };

  const before = api.snapshot();
  renderBase(renderer, scene, camera);
  renderPost(renderer, post, postCamera);
  assert.equal(renderer.calls.filter(call => call.scene === scene.name && call.target === null).length, 0,
    'a hidden note must not cause an extra final canvas draw');
  assert.equal(api.snapshot().finalWorldTextOverlayPasses, before.finalWorldTextOverlayPasses,
    'inactive scores do not consume world text overlay passes');

  board.visible = true;
  renderBase(renderer, scene, camera);
  renderShell(renderer, scene, camera);
  renderPost(renderer, post, postCamera);
  assert.equal(renderer.calls.filter(call => call.scene === scene.name && call.target === null && call.mask === (1 << 6)).length, 1,
    'a newly active note draws once after the shell/post composite');
  assert.equal(note.layers.mask, 1, 'the active score restores its original scene layer after presentation');
  const depthClear=renderer.calls.findIndex(call=>call.kind==='clearDepth');
  const actorPass=renderer.calls.findIndex(call=>call.scene===scene.name&&call.target===null&&call.mask===(1<<24));
  const scorePass=renderer.calls.findIndex(call=>call.scene===scene.name&&call.target===null&&call.mask===(1<<6));
  assert(depthClear>=0&&depthClear<actorPass&&actorPass<scorePass,
    'after the outline composite, clear only depth, draw real character silhouettes, then draw the cliff-visible score');
  assert.equal(renderer.calls[actorPass].actorColorWrite,false,
    'the actor-depth pass cannot overwrite the already-composited player/NPC colors');
  assert.equal(renderer.calls[actorPass].actorDepthWrite,true,
    'character body planes write an alpha-aware depth silhouette even when their normal materials are translucent');
  assert.equal(renderer.calls[actorPass].actorAlphaTest,.35,
    'the actor depth pass must use solid 0.35 PNG coverage, not the soft 0.001 fringe');
  assert.equal(renderer.calls[actorPass].effectLayers,1,
    'an additive eye or glow plane must never stamp its full rectangle into depth');
  assert.equal(api.snapshot().scoreActorDepthMeshes,1,
    'a duplicated rig with a transparent glow contributes one real silhouette mesh');
  assert.equal(renderer.calls[scorePass].noteDepthTest,true,
    'the note must depth-test against the closer actor instead of covering the player or NPC');
  assert.equal(note.material.depthTest,false, 'note material returns to depth-independent base state after its final-pass mask');
  assert.equal(body.material.colorWrite,true, 'character original color-write state is restored after the mask pass');
  assert.equal(body.material.depthWrite,false, 'character original translucent depth-write behavior is restored');
  assert.equal(body.material.alphaTest,.001, 'portrait soft-edge alpha restores after the depth-only pass');
  assert.equal(effect.layers.mask,1, 'transparent eye glow never enters the mask layer');
  assert.equal(body.layers.mask,1, 'actor original render layers are unchanged by the temporary mask');

  board.visible = false;
  renderBase(renderer, scene, camera);
  renderPost(renderer, post, postCamera);
  assert.equal(renderer.calls.filter(call => call.scene === scene.name && call.target === null && call.mask === (1 << 6)).length, 1,
    'deactivating the plate removes the score again without a second overlay call');
  assert.equal(renderer.calls.filter(call=>call.kind==='clearDepth').length,1,
    'stepping off the plate must not trigger a second actor-depth replay');
  api.setScoreCharacterRootsProvider(null);
}

testFixedPostCameraAndUnrelatedPass();
testNoShellStillRestoresPopup();
testPlateGatedScoreAvoidsHiddenFinalPass();
console.log('world-text final-overlay regression guard passed');
