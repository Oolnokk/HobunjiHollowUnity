#!/usr/bin/env node
'use strict';

// Real three r128 parity test for the bounded-ray accelerator in
// docs/js/camera-occlusion-chunks.js. Camera boom / clearance rays against
// heavy generated meshes (rooted-ruin root growth, FoliageGenerator surface
// roots) used to test every triangle; the accelerator tests spatial chunks
// instead and must return the SAME hits as three's own Mesh.raycast.
//
// Needs `three@0.128.0` (CI installs it in the "Install browser" step, after
// the fast suite). Without it the test reports a skip instead of failing.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadThree() {
  const candidates = [process.env.THREE_MIN_JS, 'three/build/three.min.js'].filter(Boolean);
  for (const candidate of candidates) {
    try { return require(candidate.startsWith('three/') ? require.resolve(candidate, { paths: [process.cwd(), __dirname] }) : candidate); } catch (_) { /* try next */ }
  }
  return null;
}
const THREE = loadThree();
if (!THREE) {
  console.log('SKIPPED camera-occlusion bounded-ray parity: three@0.128.0 is not installed (npm install --no-save three@0.128.0).');
  process.exit(0);
}

let api = null;
function freshAccelerator() {
  const context = { window: { THREE } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'docs/js/camera-occlusion-chunks.js'), 'utf8'), context);
  return context.window.CameraOcclusionChunks;
}

api = freshAccelerator();

let seed = 987654321;
const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

function heavyMesh(kind) {
  let geometry = new THREE.TorusKnotGeometry(5, 1.6, 240, 24, 2, 3); // ~11.5k triangles, indexed, with uv.
  let material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  if (kind === 'nonindexed') geometry = geometry.toNonIndexed();
  if (kind === 'multi') {
    const triangles = geometry.index.count / 3, half = Math.floor(triangles / 2);
    geometry.clearGroups();
    geometry.addGroup(0, half * 3, 0);
    geometry.addGroup(half * 3, (triangles - half) * 3 - 30, 1); // Last 10 triangles are in no group: three never raycasts them.
    material = [new THREE.MeshBasicMaterial({ side: THREE.FrontSide }), new THREE.MeshBasicMaterial({ side: THREE.BackSide })];
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(3, -2, 7); mesh.rotation.set(0.4, 1.1, -0.3); mesh.scale.set(1.3, 0.8, 1.1); // Non-trivial world matrix.
  mesh.updateMatrixWorld(true);
  return mesh;
}

// Chunk building is time-sliced in the game; tests finish it synchronously so results are deterministic.
function prepared(mesh) {
  assert.ok(api.prepareBoundedRayMesh(mesh), 'heavy mesh must be served from chunks once prepared');
  return mesh;
}

function randomRays(count) {
  const rays = [];
  for (let i = 0; i < count; i++) {
    rays.push({
      origin: new THREE.Vector3((random() - 0.5) * 24 + 3, (random() - 0.5) * 24 - 2, (random() - 0.5) * 24 + 7),
      direction: new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize(),
      far: 0.02 + random() * 30,
      near: random() < 0.2 ? 0.3 : 0,
    });
  }
  return rays;
}

function cast(raycaster, mesh, ray) {
  raycaster.set(ray.origin, ray.direction);
  raycaster.near = ray.near; raycaster.far = ray.far;
  return raycaster.intersectObject(mesh, false);
}

function sameHit(a, b) {
  return Math.abs(a.distance - b.distance) < 1e-9 && a.faceIndex === b.faceIndex && a.object === b.object
    && a.face.a === b.face.a && a.face.b === b.face.b && a.face.c === b.face.c && a.face.materialIndex === b.face.materialIndex
    && a.point.distanceTo(b.point) < 1e-9 && a.face.normal.distanceTo(b.face.normal) < 1e-9
    && ((!a.uv && !b.uv) || (a.uv && b.uv && a.uv.distanceTo(b.uv) < 1e-9));
}

const raycaster = new THREE.Raycaster();

for (const kind of ['indexed', 'nonindexed', 'multi']) {
  const mesh = prepared(heavyMesh(kind));
  const rays = randomRays(600);
  api.setBoundedRayAcceleratorEnabled(false);
  const expected = rays.map(ray => cast(raycaster, mesh, ray));
  api.setBoundedRayAcceleratorEnabled(true);
  const actual = rays.map(ray => cast(raycaster, mesh, ray));
  let hits = 0;
  rays.forEach((_, i) => {
    assert.strictEqual(actual[i].length, expected[i].length, `${kind}: ray ${i} hit count`);
    expected[i].forEach((hit, k) => { hits++; assert.ok(sameHit(hit, actual[i][k]), `${kind}: ray ${i} hit ${k} differs from three's own raycast`); });
  });
  assert.ok(hits > 50, `${kind}: the sample must actually hit the mesh (${hits} hits)`);
}
assert.ok(api.boundedRayAcceleratorStats().chunkedCalls > 0, 'Heavy meshes with bounded rays must use the chunked path');

// A moving mesh stays exact: the current matrixWorld is read on every call.
{
  const mesh = prepared(heavyMesh('indexed'));
  const ray = { origin: new THREE.Vector3(14, 0, 7), direction: new THREE.Vector3(-1, 0, 0), far: 40, near: 0 };
  cast(raycaster, mesh, ray);
  mesh.position.x += 4; mesh.updateMatrixWorld(true);
  api.setBoundedRayAcceleratorEnabled(false); const expected = cast(raycaster, mesh, ray);
  api.setBoundedRayAcceleratorEnabled(true); const actual = cast(raycaster, mesh, ray);
  assert.ok(expected.length > 0 && expected.length === actual.length && expected.every((hit, i) => sameHit(hit, actual[i])), 'Moved mesh must match three');
}

// Rewritten vertex data is picked up (rebuild), and a geometry rewritten every
// frame stops being chunked instead of rebuilding forever.
{
  const mesh = heavyMesh('indexed');
  const position = mesh.geometry.attributes.position;
  const ray = { origin: new THREE.Vector3(14, 0, 7), direction: new THREE.Vector3(-1, 0, 0), far: 40, near: 0 };
  prepared(mesh);
  let disabled = false;
  for (let frame = 0; frame < 8; frame++) {
    for (let i = 0; i < position.count; i++) position.setX(i, position.getX(i) + 0.25);
    position.needsUpdate = true;
    if (!disabled) disabled = !api.prepareBoundedRayMesh(mesh); // Each rewrite forces a counted rebuild until the geometry is judged animated.
    api.setBoundedRayAcceleratorEnabled(false); const expected = cast(raycaster, mesh, ray);
    api.setBoundedRayAcceleratorEnabled(true); const actual = cast(raycaster, mesh, ray);
    assert.ok(expected.length === actual.length && expected.every((hit, i) => sameHit(hit, actual[i])), `Animated geometry frame ${frame} must match three`);
  }
  assert.ok(api.boundedRayAcceleratorStats().disabledGeometries >= 1, 'Constantly rewritten geometry must fall back to three permanently');
}

// Partially revealed root meshes (setDrawRange) match three, including a window in the middle.
{
  const mesh = heavyMesh('indexed');
  const total = mesh.geometry.index.count;
  const rays = randomRays(400);
  for (const [start, count] of [[0, Math.floor(total / 3 / 2) * 3], [Math.floor(total / 3 / 4) * 3, Math.floor(total / 3 / 3) * 3], [0, total]]) {
    mesh.geometry.setDrawRange(start, count);
    api.prepareBoundedRayMesh(mesh);
    api.setBoundedRayAcceleratorEnabled(false); const expected = rays.map(ray => cast(raycaster, mesh, ray));
    api.setBoundedRayAcceleratorEnabled(true); const actual = rays.map(ray => cast(raycaster, mesh, ray));
    rays.forEach((_, i) => {
      assert.strictEqual(actual[i].length, expected[i].length, `drawRange ${start}+${count}: ray ${i} hit count`);
      expected[i].forEach((hit, k) => assert.ok(sameHit(hit, actual[i][k]), `drawRange ${start}+${count}: ray ${i} hit ${k}`));
    });
  }
}

// A ray whose direction is not unit length (outside Raycaster's contract) keeps three's exact behavior.
{
  const mesh = prepared(heavyMesh('indexed'));
  const rays = randomRays(300).map(ray => ({ ...ray, direction: ray.direction.clone().multiplyScalar(2.5) }));
  api.setBoundedRayAcceleratorEnabled(false); const expected = rays.map(ray => cast(raycaster, mesh, ray));
  api.setBoundedRayAcceleratorEnabled(true); const actual = rays.map(ray => cast(raycaster, mesh, ray));
  rays.forEach((_, i) => {
    assert.strictEqual(actual[i].length, expected[i].length, `non-unit ray ${i} hit count`);
    expected[i].forEach((hit, k) => assert.ok(sameHit(hit, actual[i][k]), `non-unit ray ${i} hit ${k}`));
  });
}

// Unbounded (picking) rays and small meshes never take the chunked path.
{
  const chunkedBefore = api.boundedRayAcceleratorStats().chunkedCalls;
  const mesh = heavyMesh('indexed');
  const picking = new THREE.Raycaster(new THREE.Vector3(30, 0, 7), new THREE.Vector3(-1, 0, 0)); // far = Infinity
  picking.intersectObject(mesh, false);
  const small = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  small.updateMatrixWorld(true);
  const bounded = new THREE.Raycaster(new THREE.Vector3(5, 0, 0), new THREE.Vector3(-1, 0, 0), 0, 20);
  assert.strictEqual(bounded.intersectObject(small, false).length, 2, 'Small meshes keep three behavior');
  assert.strictEqual(api.boundedRayAcceleratorStats().chunkedCalls, chunkedBefore, 'Picking rays and small meshes must use three directly');
}

console.log('Camera occlusion bounded-ray parity checks passed.');
