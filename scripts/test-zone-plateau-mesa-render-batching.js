#!/usr/bin/env node
'use strict';

// Executes docs/js/zone-plateau-mesa.js's render batching against real
// three r128: small mesas that share final materials/tags are drawn through
// one batch mesh per spatial bucket, the hidden sources keep their exact
// geometry (occlusion raycasts still use them), the batch carries exactly
// the sources' triangles, meshes a later Jigsaw pass may still rewrite are
// left alone, and a rebuild disposes the old batches.
//
// Needs `three@0.128.0` (CI installs it in the "Install browser" step).
// Without it the test reports a skip instead of failing.
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
  console.log('SKIPPED plateau mesa render batching: three@0.128.0 is not installed (npm install --no-save three@0.128.0).');
  process.exit(0);
}

const context = { THREE, console: { log() {}, warn: console.warn }, setTimeout, Math, JSON, Map, Set, Object, Array, Number, Float32Array, Int32Array, Uint16Array, Uint32Array };
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'docs/js/zone-plateau-mesa.js'), 'utf8'), context);
const api = context.ZonePlateauMesa;

const grassMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
const rockMat = new THREE.MeshBasicMaterial({ color: 0x888888 });
const TileType = { GRASS: 'grass', ROCK: 'rock', RAMP: 'ramp' };
const ROWS = 60, COLS = 60;
const grid = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => ({ type: 'grass', elevTier: 0 })));
const zoneScenes = new Map();
const deps = {
  NORMAL_TOP: 0,
  PLATEAU_UNIT: 1,
  TileType,
  CARVED_TILE_TYPES: new Set(),
  displaceZoneGeometry() {},
  resolveTileMat: (_mapId, type) => (type === TileType.ROCK ? rockMat : grassMat),
  _zoneMesaMeshGroups: new Map(),
  _zoneScenes: zoneScenes,
  _zoneLayouts: new Map(),
};
api.init(deps);

// Several small mesas spread over two 24-tile buckets plus one far away.
const mesas = [];
const addMesa = (minC, minR, w, d) => {
  const maskWorldKeys = new Set();
  for (let r = minR; r < minR + d; r++) for (let c = minC; c < minC + w; c++) maskWorldKeys.add(`${c},${r}`);
  mesas.push({ minC, minR, maxC: minC + w - 1, maxR: minR + d - 1, fromTier: 0, toTier: 1, maskWorldKeys });
};
addMesa(2, 2, 3, 3); addMesa(8, 3, 2, 4); addMesa(14, 10, 4, 3); addMesa(3, 15, 3, 2); // bucket 0,0
addMesa(30, 4, 3, 3); addMesa(36, 8, 4, 4); // bucket 1,0
addMesa(50, 50, 3, 3); // alone in its bucket -> stays its own mesh
addMesa(10, 30, 3, 3); // not jigsaw-final -> must stay its own mesh

const mapId = 'map_test_zone';
const scene = new THREE.Scene();
zoneScenes.set(mapId, { scene, grid });
deps._zoneLayouts.set(mapId, { mesas });

function buildLikeGameJs() {
  const meshes = api.buildZoneMesaMeshes(scene, mapId, mesas, grid);
  deps._zoneMesaMeshGroups.set(mapId, meshes);
  // Simulates the cross-mesh UV pass (a microtask in the real game) tagging
  // meshes whose UVs are final; the last mesa is left for TerrainJigsawUV.
  meshes.forEach((mesh, i) => { if (i !== meshes.length - 1) mesh.userData.terrainJigsawIgnore = true; mesh.userData.cameraObstacle = true; });
  return meshes;
}

function triangleSoup(meshes) {
  const out = [];
  for (const mesh of meshes) {
    const g = mesh.geometry;
    const pos = g.attributes.position, uv = g.attributes.uv;
    const groups = Array.isArray(mesh.material) && g.groups.length ? g.groups : [{ start: 0, count: g.index ? g.index.count : pos.count, materialIndex: 0 }];
    for (const group of groups) {
      const material = Array.isArray(mesh.material) ? mesh.material[group.materialIndex] : mesh.material;
      for (let i = group.start; i < group.start + group.count; i++) {
        const v = g.index ? g.index.getX(i) : i;
        out.push(`${material.uuid}|${pos.getX(v).toFixed(4)},${pos.getY(v).toFixed(4)},${pos.getZ(v).toFixed(4)}|${uv.getX(v).toFixed(4)},${uv.getY(v).toFixed(4)}`);
      }
    }
  }
  return out.sort();
}

(async () => {
  const meshes = buildLikeGameJs();
  assert.strictEqual(meshes.length, mesas.length);
  const sourceGeometries = meshes.map(m => m.geometry);
  await new Promise(resolve => setTimeout(resolve, 5));

  const batches = scene.children.filter(o => o.userData.plateauMesaRenderBatch);
  assert.strictEqual(batches.length, 2, 'one batch per populated bucket with 2+ eligible mesas');
  const hidden = meshes.filter(m => !m.visible);
  assert.strictEqual(hidden.length, 6, 'the six bucketed sources are hidden');
  assert.ok(meshes[6].visible, 'a mesa alone in its bucket keeps drawing itself');
  assert.ok(meshes[7].visible, 'a mesa a later Jigsaw pass may rewrite is not batched');
  meshes.forEach((m, i) => assert.strictEqual(m.geometry, sourceGeometries[i], 'sources keep their geometry for raycasts'));
  assert.ok(hidden.every(m => m.userData.cameraObstacle === true && m.parent === scene), 'hidden sources stay occlusion targets in the scene');
  assert.ok(batches.every(b => !b.userData.cameraObstacle), 'batches are render-only, not extra occlusion targets');
  assert.ok(batches.every(b => b.material[0] === grassMat && b.material[1] === rockMat), 'batches reuse the shared slot materials');
  assert.ok(batches.every(b => b.geometry.groups.length >= 1 && b.geometry.groups.length <= 2), 'one draw group per material slot');
  assert.deepStrictEqual(triangleSoup(batches), triangleSoup(hidden), 'batches draw exactly the hidden sources\' triangles, UVs and slots');

  // Raycasting still hits the (hidden) source mesas.
  const ray = new THREE.Raycaster(new THREE.Vector3(3.5, 10, 3.5), new THREE.Vector3(0, -1, 0));
  const hit = ray.intersectObjects(meshes, false)[0];
  assert.ok(hit && hit.object === meshes[0], 'occlusion-style raycasts still resolve to the source mesa');

  const snap = api.mesaBatchSnapshot();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(snap.zones[mapId])), { batches: 2, hiddenSources: 6 });

  // A runtime rebuild (dig/fill on a plateau) disposes the old batches.
  let disposed = 0;
  batches.forEach(b => b.geometry.addEventListener('dispose', () => { disposed++; }));
  api.rebuildZoneMesaMeshes(mapId);
  assert.strictEqual(disposed, 2, 'old batch geometries are disposed on rebuild');
  assert.ok(!scene.children.some(o => batches.includes(o)), 'old batches leave the scene');
  // Rebuilt meshes are re-batched once their UVs are final.
  deps._zoneMesaMeshGroups.get(mapId).forEach((mesh, i, all) => { if (i !== all.length - 1) mesh.userData.terrainJigsawIgnore = true; });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.strictEqual(scene.children.filter(o => o.userData.plateauMesaRenderBatch).length, 2, 'rebuilt mesas are batched again');

  // A stale scheduled pass (zone rebuilt again before it ran) does nothing.
  const staleScene = new THREE.Scene();
  api.buildZoneMesaMeshes(staleScene, 'map_stale', mesas.slice(0, 3), grid); // never registered in _zoneMesaMeshGroups
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.strictEqual(staleScene.children.filter(o => o.userData.plateauMesaRenderBatch).length, 0, 'unregistered builds are not batched');

  console.log('PASS plateau mesa render batching');
})().catch(error => { console.error(error); process.exit(1); });
