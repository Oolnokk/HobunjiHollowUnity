'use strict';
// Off-camera Cloud Forest trees should stop drawing without affecting near gameplay.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

class Vec3 {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  setFromMatrixPosition(m) { this.x = m.tx || 0; this.y = m.ty || 0; this.z = m.tz || 0; return this; }
}
class Mat4 {
  constructor() { this.tx = 0; this.ty = 0; this.tz = 0; this.direction = 1; }
  makeScale() { return this; }
  clone() { return Object.assign(new Mat4(), this); }
  copy(m) { Object.assign(this, m); return this; }
  equals(m) { return this.tx === m.tx && this.ty === m.ty && this.tz === m.tz && this.direction === m.direction; }
  multiplyMatrices(_projection, view) { this.direction = view.direction; return this; }
}
class Sphere {
  constructor(center = new Vec3(), radius = 0) { this.center = center; this.radius = radius; }
}
class Box3 {
  constructor(min = new Vec3(Infinity, Infinity, Infinity), max = new Vec3(-Infinity, -Infinity, -Infinity)) {
    this.min = min; this.max = max;
  }
  clone() { return new Box3(new Vec3(this.min.x, this.min.y, this.min.z), new Vec3(this.max.x, this.max.y, this.max.z)); }
  isEmpty() { return this.min.x > this.max.x; }
  applyMatrix4(m) {
    for (const axis of ['x', 'y', 'z']) {
      this.min[axis] += m['t' + axis] || 0;
      this.max[axis] += m['t' + axis] || 0;
    }
    return this;
  }
  union(box) {
    for (const axis of ['x', 'y', 'z']) {
      this.min[axis] = Math.min(this.min[axis], box.min[axis]);
      this.max[axis] = Math.max(this.max[axis], box.max[axis]);
    }
    return this;
  }
  getBoundingSphere(sphere) {
    sphere.center = new Vec3(...['x', 'y', 'z'].map(axis => (this.min[axis] + this.max[axis]) / 2));
    sphere.radius = Math.hypot(...['x', 'y', 'z'].map(axis => (this.max[axis] - this.min[axis]) / 2));
    return sphere;
  }
}
const observedSpheres = []; // Confirms tall canopy bounds extend past the root position.
class Frustum {
  setFromProjectionMatrix(matrix) { this.direction = matrix.direction; return this; }
  intersectsSphere(sphere) {
    observedSpheres.push(sphere);
    return sphere.center.x * this.direction >= -sphere.radius;
  }
}
class Group {
  constructor() { this.isObject3D = true; this.children = []; this.parent = null; this.userData = {}; this.visible = true; }
  add(child) { this.children.push(child); child.parent = this; }
  remove(child) { this.children = this.children.filter(item => item !== child); child.parent = null; }
  traverse(callback) { callback(this); for (const child of this.children) child.traverse?.(callback); }
  updateMatrixWorld() {}
  updateWorldMatrix() {}
}
class InstancedMesh extends Group {
  constructor(geometry, material, count) {
    super();
    this.isInstancedMesh = true;
    this.geometry = geometry;
    this.material = material;
    this.matrices = Array(count);
    this.instanceMatrix = { setUsage() {}, needsUpdate: false };
  }
  setMatrixAt(index, matrix) { this.matrices[index] = matrix.clone(); }
}
const THREE = { Vector3: Vec3, Matrix4: Mat4, Sphere, Box3, Frustum, Group, InstancedMesh, DynamicDrawUsage: 1 };
const scene = new Group(); // Authored tree roots and generated instanced groups share this scene.
const sharedMaterial = {}; // The simulated baked meshes share a material for instancing.
function tree(x, knownBounds = true) {
  const root = new Group();
  root.userData = { bakedTreeAsset: true, treeSpecies: 'shadewood', treeVariant: 1 };
  root.matrixWorld = new Mat4();
  root.matrixWorld.tx = x;
  const mesh = new Group();
  mesh.isMesh = true;
  mesh.geometry = knownBounds
    ? { boundingBox: new Box3(new Vec3(-1, 0, -1), new Vec3(1, 14, 1)) }
    : { computeBoundingBox() {} };
  mesh.material = sharedMaterial;
  mesh.matrixWorld = root.matrixWorld;
  root.add(mesh);
  scene.add(root);
  return { root, mesh };
}
const left = tree(-19); // Initially behind the simulated camera.
const right = tree(19); // Initially inside the simulated camera view.
tree(-12, false); // A missing geometry bounding box must not hide the batch.
const camera = {
  isCamera: true, matrixWorld: new Mat4(), matrixWorldInverse: new Mat4(),
  projectionMatrix: new Mat4(), updateWorldMatrix() {},
}; // Mirrors the matrix information available on a THREE.Camera.
let activeCamera = camera; // Set to null to verify the safe radial-only fallback.
let now = 0; // Deterministic idle-validation clock.
let domLookups = 0; // Ensures the dev panel isn't queried every frame.
const fog = { init() {}, update() {} };
const root = { THREE, CloudForestFog: fog, TreeAssetLibrary: { getMode: () => 'baked' },
  Combat: { deps: { getActiveCamera: () => activeCamera } } };
const script = fs.readFileSync(path.join(__dirname, '../docs/js/cloud-forest-tree-batcher.js'), 'utf8');
vm.runInNewContext(script, {
  window: root, performance: { now: () => now },
  document: { getElementById() { domLookups++; return null; } }, console,
}, { filename: 'cloud-forest-tree-batcher.js' });
root.CloudForestFog.init({
  THREE, player: { x: 0, y: 0 }, TILE: 1,
  getCurrentArea: () => 'map_southern_cloud_forest',
  isCloudForestArea: () => true,
  getActiveScene: () => scene,
  getCloudForestFogRadiusTiles: () => 34,
});
const api = root.CloudForestTreeBatcher; // Existing mobile-visible batching diagnostics.
const batchAt = x => scene.children.find(child => child.userData?.cloudForestTreeBatch
  && Math.abs(child.userData.cullSphere.x - x) < 0.01);

root.CloudForestFog.update(0.016);
let stats = api.getDebugState();
assert.equal(stats.frustumActive, true);
assert.equal(stats.treeCount, 3);
assert.equal(stats.batchedTreeCount, 3);
assert.equal(stats.frustumCulledChunkCount, 1);
assert.equal(left.mesh.visible, false);
assert.equal(right.mesh.visible, false);
assert.equal(batchAt(-19).visible, false);
assert.equal(batchAt(19).visible, true);
assert.equal(batchAt(-12).visible, true, 'unknown mesh bounds need radial-only fallback');
assert.ok(observedSpheres.some(sphere => sphere.radius >= 10), '3D bounds must include canopy height');

const initialLookups = domLookups;
root.CloudForestFog.update(0.016);
assert.equal(domLookups, initialLookups, 'idle frame should not update the developer panel');
camera.matrixWorld.direction = -1;
camera.matrixWorldInverse.direction = -1;
root.CloudForestFog.update(0.016);
assert.equal(batchAt(-19).visible, true, 'camera rotation should refresh visibility while stationary');
assert.equal(batchAt(19).visible, false);
assert.equal(batchAt(-12).visible, true);

activeCamera = null;
root.CloudForestFog.update(0.016);
stats = api.getDebugState();
assert.equal(stats.frustumActive, false);
assert.equal(stats.frustumCulledChunkCount, 0);
assert.equal(batchAt(19).visible, true, 'missing camera must fall back to distance culling');

scene.remove(right.root);
now += 1800;
root.CloudForestFog.update(0.016);
stats = api.getDebugState();
assert.equal(stats.batchedTreeCount, 2, 'removed trees should disappear on idle validation');
assert.ok(stats.culledChunkCount <= stats.chunkCount);
console.log('Cloud Forest tree batch frustum and fallback checks passed');
