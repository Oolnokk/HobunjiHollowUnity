#!/usr/bin/env node
'use strict';

// outline-render-performance.js used to traverse the whole scene on every base pass to find
// world popup/dialogue planes (a full walk of thousands of nodes per frame in a wilderness
// zone). The candidates are now cached per scene and re-derived only after a scene-graph
// change (add/remove/clear anywhere) or the periodic safety rescan. This executes the real
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
class Object3D { add() { return this; } remove() { return this; } clear() { return this; } }
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
  return { name, isMesh: true, renderOrder: 1200, visible: true, layers: new Layers(1), material: { map: { isCanvasTexture: true }, depthTest: false, depthWrite: false } };
}
let traversals = 0;
function makeScene(popups) {
  const scene = new Scene();
  Object.assign(scene, {
    name: 'world', isScene: true, overrideMaterial: null, background: {}, autoUpdate: true, children: [], popups,
    traverse(cb) { traversals++; cb({ isMesh: true, renderOrder: 0, layers: new Layers(1) }); for (const p of this.popups) cb(p); },
  });
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
assert.equal(traversals, 2, 'one rescan after the structure change');
for (let frame = 0; frame < 5; frame++) baseFrame(renderer, scene);
assert.equal(traversals, 2, 'and no further traversals while the graph is unchanged');

// 3. remove()/clear() also invalidate, and a popup that stopped being an overlay plane is dropped.
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

// 6. The structure-epoch wrappers keep returning the wrapped method's own result.
{ const fresh = new Scene(); assert.equal(fresh.add(), fresh, 'wrapped add() still returns what the original returned'); assert.equal(fresh.remove(), fresh); assert.equal(fresh.clear(), fresh); }

console.log('World text overlay scan cache checks passed.');
