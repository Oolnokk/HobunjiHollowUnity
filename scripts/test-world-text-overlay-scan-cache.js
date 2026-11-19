#!/usr/bin/env node
'use strict';

// outline-render-performance.js used to traverse the whole scene on every base pass to find
// world popup/dialogue planes (a full walk of thousands of nodes per frame in a wilderness
// zone). The candidates are cached per scene; only newly attached subtrees are
// inspected on add, while removals are filtered by ancestry. A periodic rescan
// finds late material/render-order edits. This executes the real
// module and checks both halves: no per-frame traversal, and no missed or stale popups.

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
class Object3D {
  constructor() { this.isObject3D = true; this.parent = null; this.children = []; this.visible = true; }
  add(...children) {
    for (const child of children) {
      child.parent?.remove(child);
      child.parent = this;
      this.children.push(child);
    }
    return this;
  }
  remove(...children) {
    for (const child of children) {
      const at = this.children.indexOf(child);
      if (at >= 0) { this.children.splice(at, 1); child.parent = null; }
    }
    return this;
  }
  clear() { return this.remove(...this.children); }
  traverse(callback) { callback(this); for (const child of this.children) child.traverse(callback); }
}
class Scene extends Object3D {}
const withheld = []; // Popups hidden while the base pass renders.
class Renderer {
  constructor() { this._target = null; this.autoClear = true; this.shadowMap = { enabled: false, autoUpdate: true }; this.info = { render: {} }; }
  getRenderTarget() { return this._target; }
  setRenderTarget(target) { this._target = target || null; }
}
Renderer.prototype.render = function render(scene) { withheld.push(scene.popups.filter(p => p.visible === false)); };
const THREE = {
  WebGLRenderer: Renderer, Object3D, Scene, BackSide: 'b', DoubleSide: 'd', LessEqualDepth: 'l', AdditiveBlending: 'a',
  Color: class { copy() { return this; } set() { return this; } }, Matrix3: class { copy() { return this; } identity() { return this; } },
  ShaderMaterial: class { constructor(o = {}) { Object.assign(this, o); this.isShaderMaterial = true; this.userData = {}; } },
};
let clock = 1000;
const context = { window: { THREE }, document: { readyState: 'complete', getElementById: () => null, addEventListener() {} }, performance: { now: () => clock }, console };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'outline-render-performance.js' });
const api = context.window.OutlineRenderPerformance;
assert.ok(api?.installed);

function popup(name) {
  const mesh = new Object3D(); // Real THREE.Mesh inherits Object3D ancestry, traverse() and scene attachment.
  Object.assign(mesh, { name, isMesh: true, renderOrder: 1200, visible: true,
    layers: new Layers(1), material: { map: { isCanvasTexture: true }, depthTest: false, depthWrite: false } });
  return mesh;
}
let traversals = 0;
function makeScene(popups) {
  const scene = new Scene();
  Object.assign(scene, {
    name: 'world', isScene: true, overrideMaterial: null, background: {}, autoUpdate: true, children: [], popups,
    traverse(cb) { traversals++; cb({ isMesh: true, renderOrder: 0, layers: new Layers(1) }); for (const p of this.popups) cb(p); },
  });
  for (const mesh of popups) { scene.children.push(mesh); mesh.parent = scene; } // Model the actual scene graph the registry verifies.
  return scene;
}
const camera = { layers: new Layers(1) };
camera.layers.enableAll();
function baseFrame(renderer, scene) {
  withheld.length = 0;
  renderer.setRenderTarget({});
  scene.autoUpdate = true;
  renderer.render(scene, camera);
  clock += 16;
  return withheld[0] || [];
}

const renderer = new Renderer();
const first = popup('first');
const scene = makeScene([first]);

// 1. Steady state: popups are withheld from every base render with ONE traversal in total.
for (let frame = 0; frame < 20; frame++) assert.deepEqual(baseFrame(renderer, scene).map(p => p.name), ['first'], `frame ${frame}: popup withheld from the outlined base pass`);
assert.equal(traversals, 1, `20 base passes must share one scene traversal, saw ${traversals}`);
assert.equal(first.visible, true, 'withheld popups are made visible again after the base render');

// 2. A popup attached through add() is found on the very next frame.
const second = popup('second');
scene.popups.push(second);
scene.add(second);
assert.deepEqual(baseFrame(renderer, scene).map(p => p.name).sort(), ['first', 'second'], 'a newly added popup must not be missed');
assert.equal(traversals, 1, 'new popup is discovered by inspecting only the attached subtree');
for (let frame = 0; frame < 5; frame++) baseFrame(renderer, scene);
assert.equal(traversals, 1, 'unrelated frames still avoid a full-scene traversal');

// 3. remove()/clear() prune detached candidates without a full scan; changed renderOrder is checked live.
scene.popups.splice(scene.popups.indexOf(first), 1);
scene.remove(first);
assert.deepEqual(baseFrame(renderer, scene).map(p => p.name), ['second'], 'a removed popup is no longer withheld');
second.renderOrder = 5; // Stops matching the predicate without any graph change.
assert.deepEqual(baseFrame(renderer, scene).map(p => p.name), [], 'cached candidates are re-checked against the predicate every frame');
second.renderOrder = 1200;

// 4. A popup that BECOMES an overlay plane without a graph change is picked up by the periodic rescan.
const late = popup('late'); late.renderOrder = 0; // Attached while not yet an overlay plane.
scene.popups.push(late); scene.add(late);
baseFrame(renderer, scene);
late.renderOrder = 1200; // Flag flipped after attach: no add()/remove() happens.
const before = traversals;
const early = baseFrame(renderer, scene).map(p => p.name);
assert.ok(!early.includes('late') && traversals === before, 'not noticed before the safety rescan');
clock += api.snapshot().worldTextRescanMs + 1;
assert.ok(baseFrame(renderer, scene).map(p => p.name).includes('late'), 'noticed once the periodic rescan runs');

// 5. Cached results are per scene: another scene never inherits this scene's popups.
const other = makeScene([]);
assert.deepEqual(baseFrame(new Renderer(), other).map(p => p.name), [], 'a different scene has its own candidate list');

// 6. Invisible score parents must not schedule the expensive post-composite pass;
//    toggling plate visibility must take effect immediately without rescanning the scene.
const score = popup('plate-score-ink'); // A CanvasTexture note cached even when its pressure plate is inactive.
const scoreBoard = new Object3D(); // An actual parent group, not a detached mock.
scoreBoard.visible = false;
scoreBoard.add(score);
scene.popups.push(score); scene.add(scoreBoard);
assert.ok(!baseFrame(renderer, scene).map(p => p.name).includes('plate-score-ink'),
  'inactive pressure-plate notes are not withheld or selected for the final overlay');
const traversalsAfterScore = traversals;
scoreBoard.visible = true;
assert.ok(baseFrame(renderer, scene).map(p => p.name).includes('plate-score-ink'),
  'activating the pressure plate immediately selects the cached note for its final pass');
assert.equal(traversals, traversalsAfterScore,
  'score activation changes only parent visibility and must not traverse the world scene again');
scoreBoard.visible = false;
assert.ok(!baseFrame(renderer, scene).map(p => p.name).includes('plate-score-ink'),
  'stepping off the pressure plate immediately removes the overlay note');

// 7. The structure-epoch wrappers keep returning the wrapped method's own result.
{ const fresh = new Scene(); assert.equal(fresh.add(), fresh, 'wrapped add() still returns what the original returned'); assert.equal(fresh.remove(), fresh); assert.equal(fresh.clear(), fresh); }

// Unrelated scenes and detached staging groups cannot invalidate this scene's cache.
const existingScans = traversals;
const unrelatedScene = makeScene([]);
const detachedGroup = new Object3D();
detachedGroup.add(popup('detached'));
unrelatedScene.add(popup('another-world'));
detachedGroup.clear();
baseFrame(renderer, scene);
assert.equal(traversals, existingScans, 'unrelated and detached graph mutations do not rescan the active world');

console.log('World text overlay scan cache checks passed.');
