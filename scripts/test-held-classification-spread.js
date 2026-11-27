#!/usr/bin/env node
'use strict';

// The periodic held-object repair walk (HeldObjectRenderOrder.scanScene) used to classify the whole scene in one
// call, the biggest single stall of a world frame. On a world frame it now runs as bounded slices of a snapshot of
// the same nodes. This executes the real module against a fake THREE and a fake clock where every classified node
// costs 0.1 ms, and checks the contract:
//   - the first scan of a scene, forced scans and non-world scans stay synchronous;
//   - a due walk is split across calls, visits every node exactly once per cycle and keeps the 750 ms cadence;
//   - nothing is restarted while a walk is in flight;
//   - nodes detached mid-walk are skipped.
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
class Stub {}
class WebGLRenderer { render() {} }

let time = 1000;
const visits = new Map();
const NODE_COST_MS = 0.1;
function makeMesh() {
  const mesh = new Object3D();
  mesh.isMesh = true;
  Object.defineProperty(mesh, 'isLight', { get() { visits.set(mesh, (visits.get(mesh) || 0) + 1); time += NODE_COST_MS; return false; } }); // classifyObject reads isLight once per visit.
  return mesh;
}

const window = { THREE: { Object3D, Scene, WebGLRenderer, Box3: Stub, Frustum: Stub, Matrix4: Stub, Vector2: Stub, Vector3: Stub, Vector4: Stub }, requestAnimationFrame: () => 0 };
window.window = window;
const context = vm.createContext({
  window, console, performance: { now: () => time }, queueMicrotask, Promise, Number, Math, Set, Map, WeakSet, WeakMap, Array, Object, String, JSON,
});
vm.runInContext(fs.readFileSync('docs/js/held-object-render-order.js', 'utf8'), context);
const api = window.HeldObjectRenderOrder;
assert(api?.installed && typeof api.scanScene === 'function', 'module installs and exposes scanScene');

const COUNT = 600;
function build() {
  const scene = new Scene();
  const meshes = [];
  for (let i = 0; i < COUNT; i++) { const m = makeMesh(); meshes.push(m); scene.add(m); }
  return { scene, meshes };
}
const total = visits => [...visits.values()].reduce((a, b) => a + b, 0);
const slices = () => api.snapshot().classificationScanSlices;
const fullScans = () => api.snapshot().classificationFullScans;

(async () => {
  const { scene, meshes } = build();
  await Promise.resolve(); // Let the add() classification flush run.
  visits.clear();

  // 1. The first scan of a scene is synchronous even when spreading is requested: registration is never late.
  api.scanScene(scene, false, true);
  assert.equal(visits.size, COUNT, 'first scan visits every node immediately');
  assert.equal(slices(), 0, 'the first scan is not sliced');
  const afterFirst = fullScans();

  // 2. Not due yet: nothing happens.
  visits.clear();
  time += 100;
  api.scanScene(scene, false, true);
  assert.equal(visits.size, 0, 'a walk is not due inside 750 ms');

  // 3. Due: the walk starts but does NOT finish in one call.
  time += 800;
  visits.clear();
  const callStart = time;
  api.scanScene(scene, false, true);
  const firstSlice = visits.size;
  assert.ok(firstSlice > 0 && firstSlice < COUNT, `the due walk is sliced (visited ${firstSlice} of ${COUNT} in the first call)`);
  assert.ok(time - callStart < 8, 'one slice stays within a few milliseconds of work');
  assert.equal(slices(), 1);
  assert.equal(fullScans(), afterFirst + 1, 'one logical repair walk is counted once, not once per slice');

  // 4. It is not restarted while in flight, and later calls finish it with every node visited exactly once.
  let calls = 1;
  while (slices() < 1000 && [...visits.values()].some(v => v === 0) === false && visits.size < COUNT && calls < 200) {
    time += 16; // A frame passes; the walk is still inside its 750 ms window and must continue, not restart.
    api.scanScene(scene, false, true);
    calls++;
  }
  assert.equal(visits.size, COUNT, 'every node was visited during the cycle');
  assert.ok([...visits.values()].every(count => count === 1), 'every node was visited exactly once (no restart, no repeats)');
  assert.ok(calls > 1, 'the walk really spanned several calls');
  assert.equal(fullScans(), afterFirst + 1, 'continuing a walk does not count as a new walk');

  // 5. Cadence: after finishing, the next walk is due 750 ms after the previous one STARTED, not sooner.
  visits.clear();
  api.scanScene(scene, false, true);
  assert.equal(visits.size, 0, 'no new walk starts right after one finished');

  // 6. Nodes detached mid-walk are skipped.
  time += 800;
  visits.clear();
  api.scanScene(scene, false, true); // Starts a new sliced walk.
  const startedWith = visits.size;
  assert.ok(startedWith < COUNT);
  const removed = meshes.filter(m => !visits.has(m)).slice(-5); // Not yet reached by the walk.
  for (const m of removed) { scene.children.splice(scene.children.indexOf(m), 1); m.parent = null; } // A real detach: gone from the graph, not just unparented.
  let guard = 0;
  while (visits.size < COUNT - removed.length && guard++ < 200) { time += 16; api.scanScene(scene, false, true); }
  assert.ok(removed.every(m => !visits.has(m)), 'a node detached before the walk reached it is never classified');
  assert.equal(visits.size, COUNT - removed.length, 'all attached nodes were still visited');

  // 7. A forced scan supersedes an in-flight walk and is fully synchronous.
  time += 800;
  visits.clear();
  api.scanScene(scene, false, true); // Start a sliced walk.
  assert.ok(visits.size < COUNT);
  visits.clear();
  api.scanScene(scene, true, true);
  assert.equal(visits.size, COUNT - removed.length, 'a forced scan walks the whole scene immediately');

  // 8. Without the spread flag (non-world renders) a due walk is synchronous, exactly as before.
  time += 800;
  visits.clear();
  api.scanScene(scene);
  assert.equal(visits.size, COUNT - removed.length, 'a non-world scan is synchronous');

  // Exercise the actual render wrapper: the outline pass draws the same scene
  // under an override material between the main draws that advance the scan.
  const outlined = build().scene;
  await Promise.resolve();
  const renderer = new WebGLRenderer();
  const camera = { isCamera: true, layers: { mask: 1 } };
  const outlineMaterial = {};
  const renderFrame = () => {
    renderer.render(outlined, camera);
    outlined.overrideMaterial = outlineMaterial;
    try { renderer.render(outlined, camera); }
    finally { outlined.overrideMaterial = null; }
  };
  renderFrame();
  time += 800;
  visits.clear();
  renderFrame();
  assert.ok(visits.size > 0 && visits.size < COUNT, 'the outline pass does not finish the first slice synchronously');
  for (let i = 0; i < 25; i++) { time += 16; renderFrame(); }
  assert.equal(visits.size, COUNT, 'outline passes do not interrupt the pending world scan');
  assert.ok([...visits.values()].every(n => n === 1), 'every mesh is classified once across world and outline passes');

  // A moved descendant still has a parent, but its root is not the source scene.
  // A detached subtree's descendant also still has a parent.
  const source = build().scene, destination = new Scene();
  const movedBranch = new Object3D(), detachedBranch = new Object3D();
  const moved = makeMesh(), detached = makeMesh();
  moved.userData.backgroundScenery = true;
  movedBranch.add(moved);
  detachedBranch.add(detached);
  source.add(movedBranch, detachedBranch);
  await Promise.resolve();
  api.scanScene(source, true);
  time += 800;
  visits.clear();
  api.scanScene(source, false, true);
  assert.ok(!visits.has(moved) && !visits.has(detached), 'both branches are still ahead of the first slice');
  source.children.splice(source.children.indexOf(movedBranch), 1);
  destination.add(movedBranch);
  source.children.splice(source.children.indexOf(detachedBranch), 1);
  detachedBranch.parent = null;
  api.scanScene(destination, true);
  const destinationVisits = visits.get(moved);
  for (let i = 0; i < 25; i++) { time += 16; api.scanScene(source, false, true); }
  api.forgetScene(source);
  assert.equal(moved.parent.parent, destination);
  assert.equal(api.snapshot().registeredBackgroundDepthMeshes, 1, 'retiring the old scene preserves the destination registration');
  assert.equal(visits.get(moved), destinationVisits, 'the old scan never reclassifies a moved descendant');
  assert.ok(!visits.has(detached), 'the old scan never reclassifies a detached descendant');

  console.log('held classification spread: sliced due walks, exact-once coverage, unchanged cadence, detach-safe, forced/non-world stay synchronous');
})().catch(error => { console.error(error); process.exit(1); });
