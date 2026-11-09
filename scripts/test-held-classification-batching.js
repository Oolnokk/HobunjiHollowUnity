#!/usr/bin/env node
'use strict';

// Executes the real held-object-render-order.js against a minimal fake THREE and
// checks that add() classification is deferred, deduplicated across nested
// adds, and still visible to the first render / snapshot.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Layers { constructor() { this.mask = 1; } enable(l) { this.mask |= (1 << l); } }
class Object3D {
  constructor() { this.children = []; this.parent = null; this.layers = new Layers(); this.userData = {}; this.renderOrder = 0; }
  add(...objects) { for (const o of objects) { o.parent = this; this.children.push(o); } return this; }
  traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); }
}
class Scene extends Object3D { constructor() { super(); this.isScene = true; } }
class Camera extends Object3D { constructor() { super(); this.isCamera = true; } }
class Stub {}
class WebGLRenderer { render() { renderCalls++; } }
let renderCalls = 0;

const visits = new Map();
function makeMesh(extra = {}) {
  const mesh = new Object3D();
  mesh.isMesh = true;
  Object.defineProperty(mesh, 'isLight', { get() { visits.set(mesh, (visits.get(mesh) || 0) + 1); return false; } }); // classifyObject reads isLight once per visit.
  Object.assign(mesh, extra);
  return mesh;
}

const window = { THREE: { Object3D, Scene, WebGLRenderer, Box3: Stub, Frustum: Stub, Matrix4: Stub, Vector2: Stub, Vector3: Stub, Vector4: Stub }, requestAnimationFrame: () => 0 };
window.window = window;
const context = vm.createContext({
  window, console, performance: { now: () => 0 }, queueMicrotask, Promise, Number, Math, Set, Map, WeakSet, WeakMap, Array, Object, String, JSON,
});
vm.runInContext(fs.readFileSync('docs/js/held-object-render-order.js', 'utf8'), context);
const api = window.HeldObjectRenderOrder;
assert(api?.installed, 'module installs against the fake THREE');

(async () => {
  // Build a deep tree bottom-up, the worst case for per-add subtree walks.
  const scene = new Scene();
  const root = new Object3D();
  let node = makeMesh({ name: 'leaf' });
  const meshes = [node];
  for (let depth = 0; depth < 12; depth++) {
    const parent = new Object3D();
    const sibling = makeMesh();
    meshes.push(sibling);
    parent.add(node, sibling);
    node = parent;
  }
  root.add(node);
  visits.clear();
  scene.add(root);
  assert.equal([...visits.values()].reduce((a, b) => a + b, 0), 0, 'add() no longer classifies synchronously');

  // A held plane added and snapshotted in the same tick must still be counted.
  const held = makeMesh({ renderOrder: api.LEGACY_HELD_RENDER_ORDER });
  scene.add(held);
  assert.equal(api.snapshot().heldMeshes, 1, 'snapshot flushes pending classification');

  await Promise.resolve();
  for (const mesh of meshes) assert.equal(visits.get(mesh), 1, 'each mesh in a nested bottom-up tree is classified exactly once per flush');

  // Rendering right after add() (no microtask turn) sees the tagged mesh in the registry.
  const held2 = makeMesh({ renderOrder: api.LEGACY_HELD_RENDER_ORDER });
  scene.add(held2);
  const renderer = new WebGLRenderer();
  renderer.render(scene, new Camera());
  assert.equal(renderCalls, 1);
  assert(held2.layers.mask & (1 << api.HELD_OVERLAY_LAYER), 'first render after add() has enforced the held overlay layer');
  console.log('held classification batching: ok');
})().catch((error) => { console.error(error); process.exit(1); });
