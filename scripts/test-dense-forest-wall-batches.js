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

// ── Distance LOD: far chunks draw each bark part's lighter twin. ──
batches.setEnabled(true);
const lodScene = new THREE.Scene();
const bark2 = new THREE.MeshBasicMaterial({ color: 0x553311 });
const vineMat = new THREE.MeshBasicMaterial({ color: 0x336633 });
const fullTrunk = new THREE.CylinderGeometry(0.5, 0.5, 4, 16, 8);
const liteTrunk = new THREE.CylinderGeometry(0.5, 0.5, 4, 6, 4);
const vines = new THREE.CylinderGeometry(0.1, 0.1, 4, 5, 6);
const cards = new THREE.PlaneGeometry(3, 3);
const twins = new Map([[fullTrunk, liteTrunk], [vines, null]]);
let liteCalls = 0;
window.FoliageGenerator = { liteTreeGeometry: geometry => { liteCalls++; return twins.has(geometry) ? twins.get(geometry) : undefined; } };
function lodChunk(x, z, dz = 0) {
  const group = new THREE.Group();
  Object.assign(group.userData, { denseForestWall: true, backgroundScenery: true, cullSphere: { x: x + 2, z, radius: 3, xzRadius: 3 } });
  for (const [geometry, material, layers] of [[fullTrunk, bark2, 3], [vines, vineMat, 3], [cards, leaf, 1]]) {
    const mesh = new THREE.InstancedMesh(geometry, material, 3);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 3; i++) mesh.setMatrixAt(i, m.makeTranslation(x + i * 2, 0, z - i * dz));
    mesh.frustumCulled = false;
    mesh.layers.mask = layers;
    mesh.userData.backgroundScenery = true;
    bounds.tag(mesh);
    group.add(mesh);
  }
  lodScene.add(group);
  return group;
}
batches.setLodDistance(16); // Explicit, independent of the shipped default.
const nearChunk = lodChunk(-2, 2);   // ~5 units from the camera at z=10 (nearest tree)
const farChunk = lodChunk(-2, -30);  // ~37 units away
lodScene.updateMatrixWorld(true);
batches.setLodDistance(16);
const r4 = batches.suspendForRender(lodScene, { isZone: true, camera });
const lodHolder = lodScene.children.find(o => o.name === 'dense_forest_wall_batches');
const shown = lodHolder.children.filter(m => m.visible);
const liteBatch = shown.find(m => m.geometry === liteTrunk);
assert.ok(liteBatch, 'a far chunk\'s bark part draws its lite twin, even as the only member');
assert.equal(liteBatch.count, 3, 'with every one of the chunk\'s instances');
assert.equal(liteBatch.material, bark2, 'and the chunk part\'s own live material');
assert.equal(liteBatch.layers.mask, 3, 'and its layers (shell outline membership)');
assert.equal(liteBatch.userData.denseForestWallLod, 'far');
const lp = new THREE.Matrix4(); liteBatch.getMatrixAt(0, lp);
assert.equal(new THREE.Vector3().setFromMatrixPosition(lp).z, -30, 'instance matrices are the chunk\'s own');
assert.equal(shown.some(m => m.geometry === vines), false, 'parts with no twin (vines) are not drawn far away');
assert.ok(farChunk.children.every(m => !m.visible), 'the far chunk\'s full-detail parts are hidden for this render');
assert.ok(nearChunk.children[0].visible && nearChunk.children[1].visible, 'a near chunk keeps full detail (alone, so drawn by itself)');
const cardBatch = shown.find(m => m.geometry === cards);
assert.ok(cardBatch && cardBatch.count === 6, 'leaf cards stay the same geometry and still merge across near and far chunks');
const snap = batches.snapshot();
assert.equal(snap.lodFarTrees, 3); assert.equal(snap.lodNearTrees, 3);
assert.equal(snap.lodLiteParts, 1); assert.equal(snap.lodOmittedParts, 1);
const tri = g => g.index.count / 3;
assert.equal(snap.lodTrianglesAvoided, (tri(fullTrunk) - tri(liteTrunk)) * 3 + tri(vines) * 3, 'reports the triangles not drawn');
r4();
assert.ok(farChunk.children.every(m => m.visible) && nearChunk.children.every(m => m.visible) && !lodHolder.visible, 'restore shows every chunk mesh again');

const lodRebuilds = batches.snapshot().rebuilds;
batches.suspendForRender(lodScene, { isZone: true, camera })();
assert.equal(batches.snapshot().rebuilds, lodRebuilds, 'an unchanged LOD split reuses its batches');

batches.setLodDistance(1000); // Everything counts as near: back to plain merging.
const r5 = batches.suspendForRender(lodScene, { isZone: true, camera });
assert.equal(lodHolder.children.some(m => m.visible && m.geometry === liteTrunk), false, 'no lite twin inside the LOD distance');
assert.ok(lodHolder.children.some(m => m.visible && m.geometry === fullTrunk && m.count === 6), 'full trunks merge across both chunks again');
r5();

batches.setLodDistance(16);
const fadeMaterial = bark2.clone(); fadeMaterial.transparent = true; fadeMaterial.opacity = 0.6;
farChunk.children[0].material = fadeMaterial; // Fading chunk part: its own transparent clone.
const otherFar = lodChunk(10, -30); // A second, opaque far chunk with the same part.
lodScene.updateMatrixWorld(true);
const r6 = batches.suspendForRender(lodScene, { isZone: true, camera });
const fadingLite = lodHolder.children.filter(m => m.visible && m.geometry === liteTrunk);
assert.ok(farChunk.children[0].visible && farChunk.children[0].geometry === liteTrunk,
  'a fading part whose trees are all far draws itself with the twin (no extra draw)');
assert.equal(farChunk.children[0].material, fadeMaterial, 'with its own live transparent material');
assert.equal(fadingLite.length, 1, 'never merged with another chunk');
assert.equal(fadingLite[0].material, bark2, 'the opaque chunk keeps the shared material');
assert.equal(batches.snapshot().lodSwappedInPlace, 1);
r6();
assert.equal(farChunk.children[0].geometry, fullTrunk, 'restore puts the full geometry back');
// Straddling fading part: near and far subsets, each in a batch of its own.
const fadingMixed = lodChunk(0, 0, 7); fadingMixed.children[0].material = fadeMaterial;
farChunk.visible = false; nearChunk.visible = false; otherFar.visible = false;
lodScene.updateMatrixWorld(true);
const r10 = batches.suspendForRender(lodScene, { isZone: true, camera });
const own = lodHolder.children.filter(m => m.visible && m.material === fadeMaterial);
assert.deepEqual(own.map(m => [m.geometry === liteTrunk ? 'lite' : 'full', m.count]).sort(), [['full', 1], ['lite', 2]],
  'a straddling fading part splits into its own near and far batches');
assert.ok(!fadingMixed.children[0].visible);
r10();
lodScene.remove(fadingMixed);
farChunk.visible = true; nearChunk.visible = true; otherFar.visible = true;
const fadingNear = nearChunk.children[0]; const keep = fadingNear.material;
fadingNear.material = fadeMaterial.clone();
const r9 = batches.suspendForRender(lodScene, { isZone: true, camera });
assert.ok(fadingNear.visible, 'a fading NEAR part still draws itself, untouched');
r9();
fadingNear.material = keep;
lodScene.remove(otherFar);
farChunk.children[0].material = bark2;

// A chunk straddling the boundary: trees at 10, 17 and 24 units from the camera.
farChunk.visible = false; nearChunk.visible = false;
const mixed = lodChunk(0, 0, 7); // z = 0, -7, -14 with the camera at z = 10
lodScene.updateMatrixWorld(true);
const r8 = batches.suspendForRender(lodScene, { isZone: true, camera });
const mixedShown = lodHolder.children.filter(m => m.visible);
assert.equal(mixedShown.find(m => m.geometry === fullTrunk)?.count, 1, 'the near tree of a straddling chunk keeps full bark');
assert.equal(mixedShown.find(m => m.geometry === liteTrunk)?.count, 2, 'its two far trees draw the lite twin');
assert.equal(mixedShown.find(m => m.geometry === vines)?.count, 1, 'only the near tree keeps its vines');
assert.equal(mixedShown.find(m => m.geometry === cards)?.count, undefined, 'leaf cards of a lone chunk draw themselves');
assert.ok(mixed.children[2].visible && !mixed.children[0].visible && !mixed.children[1].visible, 'split parts are hidden, untouched leaves are not');
r8();
// Hysteresis: the tree at 17 units stays far until it is 1.5 units inside the boundary.
batches.setLodDistance(17.5);
let rh = batches.suspendForRender(lodScene, { isZone: true, camera });
assert.equal(lodHolder.children.find(m => m.visible && m.geometry === liteTrunk)?.count, 2, 'a far tree just inside the distance stays far');
rh();
batches.setLodDistance(19);
rh = batches.suspendForRender(lodScene, { isZone: true, camera });
assert.equal(lodHolder.children.find(m => m.visible && m.geometry === liteTrunk)?.count, 1, 'and switches back once well inside it');
rh();
batches.setLodDistance(16);
mixed.visible = false; farChunk.visible = true; nearChunk.visible = true;

batches.setLodEnabled(false);
const r7 = batches.suspendForRender(lodScene, { isZone: true, camera });
assert.equal(lodHolder.children.some(m => m.visible && m.geometry === liteTrunk), false, 'LOD A/B switch');
assert.ok(farChunk.children[1].visible === false && lodHolder.children.some(m => m.visible && m.geometry === vines), 'with LOD off the vines are merged as before');
r7();
console.log('ok - dense forest wall: far chunks draw lite bark twins with the chunk\'s own matrices, material and layers');

