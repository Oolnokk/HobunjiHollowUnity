#!/usr/bin/env node
'use strict';

// The Cloud Forest dense wall's on-camera, non-fading chunk parts draw as one
// InstancedMesh per part across chunks during the world render only. Runs the
// real module against real three r128 objects (no WebGL needed).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let THREE;
try {
  THREE = require('three'); // CI installs three@0.128.0 (regression-suite.yml).
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('SKIPPED dense forest wall batches: three@0.128.0 is unavailable.');
  process.exit(0);
}

const window = { THREE };
const load = file => vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'docs/js', file), 'utf8'),
  ctx, { filename: file });
const ctx = vm.createContext({ window, globalThis: window, WeakRef, WeakMap, Map, Float64Array, Math, Number, Object, console });
load('instanced-mesh-bounds.js');
load('dense-forest-wall-batches.js');
const batches = window.DenseForestWallBatches;
const bounds = window.InstancedMeshBounds;

const trunk = new THREE.BoxGeometry(1, 4, 1);
const leaves = new THREE.BoxGeometry(3, 2, 3);
const bark = new THREE.MeshBasicMaterial({ color: 0x553311 });
const leaf = new THREE.MeshBasicMaterial({ color: 0x228833 });
const scene = new THREE.Scene();

// One chunk = two InstancedMeshes (trunk + leaves), `n` trees in a row at x.
function chunk(x, n = 3) {
  const group = new THREE.Group();
  group.userData.denseForestWall = true;
  group.userData.backgroundScenery = true;
  for (const [geometry, material] of [[trunk, bark], [leaves, leaf]]) {
    const mesh = new THREE.InstancedMesh(geometry, material, n);
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) mesh.setMatrixAt(i, m.makeTranslation(x + i * 2, 0, -20));
    mesh.frustumCulled = false;
    mesh.userData.backgroundScenery = true;
    bounds.tag(mesh);
    group.add(mesh);
  }
  scene.add(group);
  return group;
}
const chunks = [chunk(-6), chunk(0), chunk(6)];
const offscreen = chunk(500); // Far to the side: outside the camera frustum.
const camera = new THREE.PerspectiveCamera(60, 1.5, 0.1, 200);
camera.position.set(0, 2, 10);
camera.lookAt(0, 2, -20);
scene.updateMatrixWorld(true);

const draws = () => { let n = 0; scene.traverseVisible(o => { if (o.isMesh) n++; }); return n; };
const before = draws();
const restore = batches.suspendForRender(scene, { isZone: true, camera });
assert.equal(typeof restore, 'function', 'on-camera chunks are swapped for batches');
const holder = scene.children.find(o => o.name === 'dense_forest_wall_batches');
const drawn = holder.children.filter(m => m.visible);
assert.equal(drawn.length, 2, 'one batch per tree part (trunk, leaves)');
assert.ok(chunks.every(c => c.children.every(m => !m.visible)), 'on-camera chunk parts are hidden for this render');
assert.ok(offscreen.children.every(m => m.visible), 'off-camera chunk parts are left to the camera cull, not merged');
const trunkBatch = drawn.find(m => m.geometry === trunk);
assert.equal(trunkBatch.count, 9, 'the batch holds every on-camera chunk\'s instances');
const p = new THREE.Matrix4(), pos = new THREE.Vector3();
const xs = []; for (let i = 0; i < trunkBatch.count; i++) { trunkBatch.getMatrixAt(i, p); xs.push(pos.setFromMatrixPosition(p).x); }
assert.deepEqual(xs.sort((a, b) => a - b), [-6, -4, -2, 0, 2, 4, 6, 8, 10], 'instance matrices are copied unchanged');
assert.equal(trunkBatch.userData.backgroundScenery, true, 'batches stay background scenery (out of held/x-ray replays)');
assert.equal(trunkBatch.userData.hobunjiInstanceBounds, true, 'batches are bounded for the camera and replay culls');
assert.equal(trunkBatch.raycast(), undefined, 'batches never answer raycasts');
assert.equal(draws(), before - 6 + 2 - 0, 'six on-camera part meshes became two');
restore();
assert.ok(chunks.every(c => c.children.every(m => m.visible)) && !holder.visible, 'restore shows the chunk meshes again');

const rebuilds = batches.snapshot().rebuilds;
batches.suspendForRender(scene, { isZone: true, camera })();
assert.equal(batches.snapshot().rebuilds, rebuilds, 'an unchanged wall reuses its batches');

// A fading chunk gets transparent per-chunk materials: it draws itself.
const fading = chunks[2];
fading.children.forEach(m => { m.material = m.material.clone(); m.material.transparent = true; m.material.opacity = 0.5; });
const r2 = batches.suspendForRender(scene, { isZone: true, camera });
assert.ok(fading.children.every(m => m.visible), 'fading (transparent) chunk parts are not merged');
assert.equal(holder.children.find(m => m.visible && m.geometry === trunk).count, 6, 'batches shrink to the opaque chunks');
r2();

// Quarter-density style edit: fewer instances in place.
chunks[0].children[0].count = 1;
chunks[0].children[0].instanceMatrix.needsUpdate = true;
const r3 = batches.suspendForRender(scene, { isZone: true, camera });
assert.equal(holder.children.find(m => m.visible && m.geometry === trunk).count, 4, 'a changed instance count rebuilds the batch');
r3();

assert.equal(batches.suspendForRender(scene, { isZone: false, camera }), null, 'outside zones nothing is merged');
assert.equal(scene.children.includes(holder), false, 'and the scene\'s batches are released');
batches.setEnabled(false);
assert.equal(batches.suspendForRender(scene, { isZone: true, camera }), null, 'A/B switch');
console.log('ok - dense forest wall: on-camera opaque chunk parts draw as one instanced batch per part');
