#!/usr/bin/env node
'use strict';

// Regression guard for a performance bug: two modules hook
// THREE.WebGLRenderer.prototype.render globally and used to recompute their
// per-entity transforms on EVERY internal render() call. With outlines on
// (the default), game.js calls renderer.render() several times per visual
// frame (color pass, shell/target/material-ID/depth outline passes, final
// composite) -- all synchronously back to back -- so that work ran up to 6x
// per frame instead of once. Both now apply once per synchronous frame and
// defer their revert/reset to a microtask.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

async function flushMicrotasks(times = 5) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

async function testNpcSocialInhibition() {
  const source = read('docs/js/npc-social-inhibition-runtime.js');
  class Renderer {}
  Renderer.prototype.render = function render() {};
  const THREE = { WebGLRenderer: Renderer };
  const plannerApi = { init() {}, resolveNpcTarget: () => null };
  const walker = {
    root: { position: { x: 0, y: 0, z: 0 }, rotation: { y: 0 }, updateMatrixWorld() {} },
    state: 'idle',
    area: 'test',
    currentScheduleTarget: { socialLookAt: { x: 1, z: 1 } },
  };
  const windowObject = { THREE, NpcActivityPlanner: plannerApi, performance: { now: () => 0 }, setInterval: () => 0 };
  const context = { window: windowObject, performance: windowObject.performance, console, setInterval: () => 0 };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'npc-social-inhibition-runtime.js' });

  windowObject.NpcActivityPlanner.init({
    listNpcWalkersInArea: () => [walker],
    getCurrentArea: () => 'test',
  });

  const api = windowObject.NpcSocialInhibition;
  assert.ok(api, 'NpcSocialInhibition must install');
  assert.ok(windowObject.THREE.WebGLRenderer.prototype.render.__npcSocialInhibitionRenderHook,
    'render hook must be installed on THREE.WebGLRenderer.prototype.render');

  // Simulate one visual frame's several synchronous internal render() calls.
  for (let i = 0; i < 6; i++) windowObject.THREE.WebGLRenderer.prototype.render.call({}, {}, {});
  const midFrame = api.getDebug();
  assert.strictEqual(midFrame.renderCount, 6, 'every render() call must still be counted');
  assert.strictEqual(midFrame.facingApplications, 1,
    'facing presentation must be computed once per synchronous frame, not once per internal render() call');

  await flushMicrotasks();

  // A second frame's render() calls must trigger a fresh application.
  for (let i = 0; i < 4; i++) windowObject.THREE.WebGLRenderer.prototype.render.call({}, {}, {});
  const secondFrame = api.getDebug();
  assert.strictEqual(secondFrame.renderCount, 10, 'render count accumulates across frames');
  assert.strictEqual(secondFrame.facingApplications, 2, 'a new synchronous frame must reapply presentation exactly once');

  console.log('npc-social-inhibition-runtime frame-dedup guard passed');
}

async function testCombatDeathMark() {
  const source = read('docs/js/combat/combat-death-mark.js');
  class Renderer {}
  Renderer.prototype.render = function render() {};

  class Object3D { constructor() { this.children = []; this.parent = null; } add(child) { this.children.push(child); child.parent = this; } remove(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); if (child.parent === this) child.parent = null; } }
  class Group extends Object3D { constructor() { super(); this.position = { set() {} }; this.quaternion = { copy() {} }; } }
  class Material { constructor(params = {}) { Object.assign(this, params); this.color = { set() {} }; } dispose() {} }
  class Mesh extends Object3D { constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; this.scale = { set() {} }; } }
  class Sprite extends Object3D { constructor(material) { super(); this.material = material; this.scale = { set() {} }; } }
  class Geometry { dispose() {} }
  const canvasCtx = { createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} };
  const documentStub = { createElement: () => ({ width: 0, height: 0, getContext: () => canvasCtx }) };

  let quaternionReads = 0;
  const camera = { getWorldQuaternion() { quaternionReads++; } };
  const postCamera = { getWorldQuaternion() { quaternionReads++; } };

  const THREE = {
    WebGLRenderer: Renderer,
    Group, Sprite, Mesh,
    SpriteMaterial: Material, MeshBasicMaterial: Material,
    PlaneGeometry: Geometry,
    TextureLoader: class { load() { return {}; } },
    CanvasTexture: class { },
    Quaternion: class { copy() { return this; } },
    AdditiveBlending: 'additive', DoubleSide: 'double', LinearFilter: 'linear',
  };
  const windowObject = {
    THREE,
    Combat: { deps: { TILE: 64, hostileObjects: { has: () => true } } },
    ResourceSystem: { applyDamage: (entity, amount) => amount },
    HobunjiDeathMark: null,
  };
  const context = { window: windowObject, THREE, document: documentStub, performance: { now: () => 0 }, console };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'combat-death-mark.js' });

  assert.ok(windowObject.HobunjiDeathMark, 'HobunjiDeathMark must install');
  assert.ok(windowObject.THREE.WebGLRenderer.prototype.__hobunjiDeathMarkHooked,
    'render hook must be installed on THREE.WebGLRenderer.prototype.render');
  assert.ok(windowObject.THREE.WebGLRenderer.prototype.render.__hobunjiDeathMarkOriginal,
    'the wrapped render() must retain a reference to the original implementation');

  const entity = {
    _deathMarkStacks: 0, health: 10, scene: new Group(),
    avatarRef: { group: { position: { y: 0 } } }, halfHeight: 1, x: 0, y: 0,
  };
  // Real entry point marks land through: the combo's heavy finisher tags its
  // hit with appliesDeathMark, which resolveHeavyMultiplier/applyMark turns
  // into a real visuals-map entry -- the same path a live Cleave/Long Lunge
  // hit takes, rather than reaching into the closure-private map directly.
  windowObject.ResourceSystem.applyDamage(entity, 10, { heavy: true, appliesDeathMark: true });
  assert.strictEqual(entity._deathMarkStacks, 1, 'a death-mark-granting heavy hit must stack a mark on the entity');

  const render = windowObject.THREE.WebGLRenderer.prototype.render;
  render.call({}, {}, camera);
  render.call({}, {}, camera);
  render.call({}, {}, postCamera);
  assert.strictEqual(quaternionReads, 1,
    'billboard transforms must be recomputed once per synchronous frame, not once per internal render() call');

  await flushMicrotasks();

  render.call({}, {}, camera);
  render.call({}, {}, camera);
  assert.strictEqual(quaternionReads, 2, 'a new synchronous frame must recompute billboard transforms exactly once');

  console.log('combat-death-mark frame-dedup guard passed');
}

(async () => {
  await testNpcSocialInhibition();
  await testCombatDeathMark();
})().catch(err => { console.error(err); process.exit(1); });
