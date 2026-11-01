#!/usr/bin/env node
'use strict';

// Executes docs/js/outline-render-performance.js against a stand-in renderer and
// records scene.autoUpdate at every underlying render, which is what decides whether
// three.js re-runs scene.updateMatrixWorld() (the whole scene graph) for that render.
//
// Frame order mirrors game.js renderWorldPasses with a tool held in the Cloud Forest:
//   base render -> held-object depth replays (renders of their own) -> PNG-depth pass
//   -> shell pass -> mist redraw -> composite + final world-text overlay draw.
// Only the base render may recompute matrices. Before this guard the replays ended the
// reuse sequence, so every later pass re-walked the full scene (5 walks per frame).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'docs/js/outline-render-performance.js'), 'utf8');

class Layers {
  constructor(mask = 1) { this.mask = Number(mask) >>> 0; }
  set(channel) { this.mask = (1 << Number(channel)) >>> 0; }
  enableAll() { this.mask = 0xFFFFFFFF >>> 0; }
}
const records = [];
class Renderer {
  constructor() { this._target = null; this.autoClear = true; this.shadowMap = { enabled: false, autoUpdate: true }; this.info = { render: { calls: 0, triangles: 0, points: 0, lines: 0 } }; }
  getRenderTarget() { return this._target; }
  setRenderTarget(target) { this._target = target || null; }
}
Renderer.prototype.render = function render(scene, camera) {
  records.push({ scene: scene.name, mask: camera.layers.mask >>> 0, matricesUpdated: scene.autoUpdate === true, override: !!scene.overrideMaterial });
};
class ShaderMaterial { constructor(options = {}) { Object.assign(this, options); this.isShaderMaterial = true; this.userData = {}; } }
const THREE = {
  WebGLRenderer: Renderer, BackSide: 'back', DoubleSide: 'double', LessEqualDepth: 'lequal', AdditiveBlending: 'additive',
  Color: class { constructor(v) { this.value = v; } copy() { return this; } set() { return this; } },
  Matrix3: class { copy() { return this; } identity() { return this; } },
  ShaderMaterial,
};
let clock = 1000;
const context = { window: { THREE }, document: { readyState: 'complete', getElementById: () => null, addEventListener() {} }, performance: { now: () => clock }, console };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'outline-render-performance.js' });
const api = context.window.OutlineRenderPerformance;
assert.ok(api?.installed && typeof api.markSceneMatricesCurrent === 'function', 'module must expose markSceneMatricesCurrent');

const popup = { isMesh: true, renderOrder: 1200, visible: true, layers: new Layers(1), material: { map: { isCanvasTexture: true }, depthTest: false, depthWrite: false } };
function makeWorld() {
  return { name: 'world', isScene: true, overrideMaterial: null, background: { kind: 'bg' }, autoUpdate: true, children: [], traverse(cb) { cb(popup); } };
}
const shellMaterial = new ShaderMaterial({ side: THREE.BackSide, uniforms: { uThickness: { value: 1 } } });
const post = {
  name: 'post', isScene: true, overrideMaterial: null, background: null, autoUpdate: true,
  children: [{ material: { uniforms: { tColor: {}, tEdgeId: {}, uTexel: {}, uSeamOutlinesOn: { value: 1 } } } }],
  traverse() {},
};

function makeOtherScene(i) { return { name: 'painterly-' + i, isScene: true, overrideMaterial: null, background: null, autoUpdate: true, children: [], traverse() {} }; }

function runFrame({ rearmAfterReplays, scene, elapsedBeforeSecondaryPasses = 0 }) {
  records.length = 0;
  const renderer = new Renderer();
  const camera = { layers: new Layers(1) };
  const postCamera = { layers: new Layers(1) };

  camera.layers.enableAll(); renderer.setRenderTarget({}); // Offscreen target, every layer: the base render.
  renderer.render(scene, camera);

  // Held-object depth replays: they own scene.autoUpdate while they run, one is classified 'base'
  // (every layer, offscreen) and the rest 'other'.
  const replayUpdate = scene.autoUpdate; scene.autoUpdate = false;
  renderer.render(scene, camera);
  for (let i = 0; i < 4; i++) { camera.layers.set(7); renderer.render(scene, camera); }
  camera.layers.enableAll(); scene.autoUpdate = replayUpdate;
  if (rearmAfterReplays) assert.equal(api.markSceneMatricesCurrent(renderer, scene), true);

  clock += elapsedBeforeSecondaryPasses;
  camera.layers.set(4); renderer.render(scene, camera); // PNG occluder depth
  scene.overrideMaterial = shellMaterial; camera.layers.set(1); renderer.render(scene, camera); scene.overrideMaterial = null; // Shell outline
  camera.layers.set(5); renderer.render(scene, camera); // Cloud-forest mist redraw
  camera.layers.enableAll();
  // The painterly post-process renders its own scenes inside the composite call. They end the global
  // adjacent-pass sequence but cannot change the world scene's matrices.
  for (let i = 0; i < 3; i++) renderer.render(makeOtherScene(i), postCamera);
  renderer.setRenderTarget(null); renderer.render(post, postCamera); // Composite -> final world-text overlay draw.
  return records.slice();
}

// 1. With the re-arm, only the base render walks the scene; every later pass of the frame reuses it.
{
  const scene = makeWorld();
  const frame = runFrame({ rearmAfterReplays: true, scene });
  const worldRenders = frame.filter(r => r.scene === 'world');
  const updated = worldRenders.filter(r => r.matricesUpdated);
  assert.equal(updated.length, 1, `only the base render may recompute matrices; got ${JSON.stringify(worldRenders)}`);
  assert.equal(worldRenders[0].matricesUpdated, true, 'the first world render is the base pass');
  const afterReplays = worldRenders.slice(-4); // pngDepth, shell, mist, world-text overlay
  assert.equal(afterReplays.length, 4);
  assert.deepEqual(afterReplays.map(r => r.matricesUpdated), [false, false, false, false], `PNG-depth, shell, mist and world-text passes must reuse the base matrices: ${JSON.stringify(afterReplays)}`);
  assert.equal(frame.filter(r => r.scene.startsWith('painterly-')).length, 3, 'unrelated scenes were rendered between the mist pass and the text overlay');
  assert.ok(afterReplays[3].mask === (1 << api.worldTextOverlayLayer) >>> 0, 'the last world render is the layer-6 text overlay draw');
  assert.equal(scene.autoUpdate, true, 'scene.autoUpdate is restored after the frame');
  assert.ok(api.snapshot().reusedSceneMatrixPasses >= 4, 'reuse counter reflects the four reused passes');
}

// 2. Control: without the re-arm the replays end the sequence and every later pass walks the scene again.
{
  const scene = makeWorld();
  const frame = runFrame({ rearmAfterReplays: false, scene });
  const afterReplays = frame.filter(r => r.scene === 'world').slice(-4);
  assert.deepEqual(afterReplays.slice(0, 3).map(r => r.matricesUpdated), [true, true, true], 'documents the original behavior the re-arm fixes: PNG-depth, shell and mist each re-walk the scene');
  assert.equal(afterReplays[3].matricesUpdated, true, 'a pass that re-walked the scene since the base render means the overlay must not assume the base matrices');
}

// 3. A stale base render is never reused (guards against an old frame's matrices).
{
  const scene = makeWorld();
  const frame = runFrame({ rearmAfterReplays: true, scene, elapsedBeforeSecondaryPasses: api.snapshot().maxReuseAgeMs + 50 });
  const afterReplays = frame.filter(r => r.scene === 'world').slice(-4);
  assert.deepEqual(afterReplays.map(r => r.matricesUpdated), [true, true, true, true], 'past the reuse age limit every pass, including the text overlay, recomputes matrices');
}

// 4. Re-arming refuses a non-scene and reuse is per-scene: another scene's passes are untouched.
{
  const renderer = new Renderer();
  assert.equal(api.markSceneMatricesCurrent(renderer, null), false);
  assert.equal(api.markSceneMatricesCurrent(null, makeWorld()), false);
  const a = makeWorld(), b = makeWorld(); b.name = 'other-world';
  api.markSceneMatricesCurrent(renderer, a);
  records.length = 0;
  const camera = { layers: new Layers(1) }; camera.layers.set(4);
  renderer.render(a, camera);
  assert.equal(records[0].matricesUpdated, false, 'the armed scene reuses');
  renderer.render(b, camera);
  assert.equal(records[1].matricesUpdated, true, 'a different scene must still update its own matrices (and ends the sequence)');
  renderer.render(a, camera);
  assert.equal(records[2].matricesUpdated, true, 'an unrelated render in between ends the sequence');
}

console.log('Outline matrix reuse checks passed.');
