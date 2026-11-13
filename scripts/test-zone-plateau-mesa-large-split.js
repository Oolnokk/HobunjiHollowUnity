#!/usr/bin/env node
'use strict';

// Executes docs/js/zone-plateau-mesa.js's render batching against real three
// r128 for sources too large to merge: a zone-spanning mesa tier and the
// transparent cliff-handhold decal mesh are each drawn through per-cell
// indexed stand-ins (so the camera and the scissored held/shell depth replays
// can drop most of them), the hidden source keeps its exact geometry for
// sampling and raycasts, and the stand-ins carry exactly its triangles.
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
  console.log('SKIPPED plateau mesa large split: three@0.128.0 is not installed (npm install --no-save three@0.128.0).');
  process.exit(0);
}

const context = { THREE, console: { log() {}, warn: console.warn }, setTimeout, Math, JSON, Map, Set, Object, Array, Number, Float32Array, Int32Array, Uint16Array, Uint32Array };
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'docs/js/zone-plateau-mesa.js'), 'utf8'), context);
const api = context.ZonePlateauMesa;

const grassMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
const rockMat = new THREE.MeshBasicMaterial({ color: 0x888888 });
const decalMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
const TileType = { GRASS: 'grass', ROCK: 'rock', RAMP: 'ramp' };
const ROWS = 80, COLS = 80;
const grid = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => ({ type: 'grass', elevTier: 0 })));
const deps = {
  NORMAL_TOP: 0, PLATEAU_UNIT: 1, TileType, CARVED_TILE_TYPES: new Set(),
  displaceZoneGeometry() {}, resolveTileMat: (_mapId, type) => (type === TileType.ROCK ? rockMat : grassMat),
  _zoneMesaMeshGroups: new Map(), _zoneScenes: new Map(), _zoneLayouts: new Map(),
};
api.init(deps);

const mesas = [];
const addMesa = (minC, minR, w, d) => {
  const maskWorldKeys = new Set();
  for (let r = minR; r < minR + d; r++) for (let c = minC; c < minC + w; c++) maskWorldKeys.add(`${c},${r}`);
  mesas.push({ minC, minR, maxC: minC + w - 1, maxR: minR + d - 1, fromTier: 0, toTier: 1, maskWorldKeys });
};
addMesa(4, 4, 66, 66); // One tier spanning most of the zone: far over the merge limit.
addMesa(72, 72, 3, 3); // An ordinary small mesa beside it.

const mapId = 'map_split_zone';
const scene = new THREE.Scene();
deps._zoneScenes.set(mapId, { scene, grid });
deps._zoneLayouts.set(mapId, { mesas });

// Like cliff-route-network.js's handhold decals: non-indexed, transparent,
// one material, quads scattered across the zone, pushed into the same list.
function makeDecals() {
  const vertices = [], uvs = [];
  for (let n = 0; n < 3600; n++) {
    const x = 3 + (n * 37 % 70), z = 3 + (n * 53 % 70), y = 1 + (n % 5);
    vertices.push(x, y, z, x + 0.4, y, z, x + 0.4, y + 0.4, z, x, y, z, x + 0.4, y + 0.4, z, x, y + 0.4, z);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  const decals = new THREE.Mesh(geometry, decalMat);
  decals.name = mapId + '-cliff-handhold-decals';
  decals.userData.cliffRoutes = true;
  decals.userData.terrainJigsawIgnore = true;
  scene.add(decals);
  return decals;
}

function build() {
  const meshes = api.buildZoneMesaMeshes(scene, mapId, mesas, grid);
  const decals = makeDecals();
  meshes.push(decals); // The real builder appends CliffRouteNetwork.render()'s meshes to this same array.
  deps._zoneMesaMeshGroups.set(mapId, meshes);
  meshes.forEach(mesh => { mesh.userData.terrainJigsawIgnore = true; });
  meshes[0].userData.cameraObstacle = true;
  return { meshes, tier: meshes[0], small: meshes[1], decals };
}

function triangleSoup(meshes) {
  const out = [];
  for (const mesh of meshes) {
    const g = mesh.geometry, pos = g.attributes.position, uv = g.attributes.uv;
    const groups = Array.isArray(mesh.material) && g.groups.length ? g.groups : [{ start: 0, count: g.index ? g.index.count : pos.count, materialIndex: 0 }];
    for (const group of groups) {
      const material = Array.isArray(mesh.material) ? mesh.material[group.materialIndex] : mesh.material;
      for (let i = group.start; i + 2 < group.start + group.count; i += 3) {
        const corner = k => { const v = g.index ? g.index.getX(i + k) : i + k; return `${pos.getX(v).toFixed(4)},${pos.getY(v).toFixed(4)},${pos.getZ(v).toFixed(4)}/${uv.getX(v).toFixed(4)},${uv.getY(v).toFixed(4)}`; };
        out.push(`${material.uuid}|${corner(0)}|${corner(1)}|${corner(2)}`); // Whole triangles, winding included.
      }
    }
  }
  return out.sort();
}
const tris = mesh => (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3;
const partsOf = source => scene.children.filter(o => o.userData.plateauMesaRenderSplit && o.name.startsWith(source.name + '__render_split_'));

(async () => {
  let { tier, small, decals } = build();
  assert.ok(tris(tier) > 6000, `fixture tier is over the merge limit (${tris(tier)} triangles)`);
  assert.ok(tris(decals) > 6000);
  const tierGeometry = tier.geometry, decalGeometry = decals.geometry;
  tierGeometry.computeBoundingSphere();
  await new Promise(resolve => setTimeout(resolve, 5));

  const tierParts = partsOf(tier), decalParts = partsOf(decals);
  assert.ok(tierParts.length >= 4, `a zone-spanning tier becomes several cells (${tierParts.length})`);
  assert.ok(decalParts.length >= 4, `the decal mesh becomes several cells (${decalParts.length})`);
  assert.strictEqual(tier.visible, false, 'the split source is hidden');
  assert.strictEqual(tier.userData.plateauMesaRenderBatched, true);
  assert.strictEqual(tier.geometry, tierGeometry, 'the source keeps its geometry for cliff/height sampling');
  assert.strictEqual(tier.parent, scene, 'and stays in the scene as the occlusion raycast target');
  assert.strictEqual(decals.geometry, decalGeometry);
  assert.strictEqual(small.visible, true, 'a small mesa alone in its bucket is untouched');

  assert.deepStrictEqual(triangleSoup(tierParts), triangleSoup([tier]), 'parts draw exactly the tier\'s triangles, UVs, winding and material slots');
  assert.deepStrictEqual(triangleSoup(decalParts), triangleSoup([decals]), 'parts draw exactly the decal triangles');
  for (const part of tierParts) {
    assert.ok(part.geometry.index, 'parts are indexed, so shared vertices are shaded once');
    assert.ok(part.material[0] === grassMat && part.material[1] === rockMat, 'parts reuse the shared slot materials');
    assert.ok(part.geometry.groups.length >= 1 && part.geometry.groups.length <= 2, 'one draw group per material slot present in the cell');
    assert.ok(!part.userData.cameraObstacle, 'parts are render-only');
    assert.strictEqual(part.userData.plateauMesaRenderBatchMapId, mapId, 'parts carry the same tag other systems use to find mesa stand-ins');
    assert.strictEqual(part.userData.hobunjiGroundXray, true, 'ground x-ray identity is preserved');
    assert.strictEqual(part.layers.mask, tier.layers.mask);
    assert.ok(part.geometry.boundingSphere.radius < tierGeometry.boundingSphere.radius * 0.6, 'each part is far smaller than the source, so it can be culled');
    const b = part.geometry.boundingBox; // Triangles are assigned by centroid: a part may overhang its 24-unit cell by one tile at most.
    assert.ok(b.max.x - b.min.x <= 26.01 && b.max.z - b.min.z <= 26.01, 'a part covers about one 24x24 cell');
  }
  const partVertices = tierParts.reduce((n, p) => n + p.geometry.attributes.position.count, 0);
  assert.ok(partVertices < tris(tier) * 3 * 0.5, `vertices stay shared (${partVertices} for ${tris(tier)} triangles)`);
  assert.ok(decalParts.every(p => p.material === decalMat && p.geometry.groups.length === 0), 'a single-material source stays single-material');
  assert.ok(decalParts.every(p => p.position.lengthSq() === 0), 'parts share the source origin, so transparent sorting against the rest of the scene is unchanged');

  // Raycasts still resolve to the hidden source.
  const ray = new THREE.Raycaster(new THREE.Vector3(20.5, 10, 20.5), new THREE.Vector3(0, -1, 0));
  const hit = ray.intersectObjects([tier, ...tierParts.filter(p => p.userData.cameraObstacle)], false)[0];
  assert.ok(hit && hit.object === tier, 'occlusion-style raycasts still hit the source tier');

  const snap = api.mesaBatchSnapshot();
  assert.strictEqual(snap.splitMeshes, 2);
  assert.strictEqual(snap.splitParts, tierParts.length + decalParts.length);
  assert.strictEqual(snap.zones[mapId].hiddenSources, 2);

  // A rebuild disposes the old parts and splits the new sources again.
  let disposed = 0;
  for (const part of tierParts) part.geometry.addEventListener('dispose', () => { disposed++; });
  api.rebuildZoneMesaMeshes(mapId);
  assert.strictEqual(disposed, tierParts.length, 'old part geometries are disposed on rebuild');
  assert.ok(!scene.children.some(o => tierParts.includes(o)), 'old parts leave the scene');

  // The A/B switch restores one draw per large source at the next build.
  for (const object of scene.children.slice()) scene.remove(object);
  assert.strictEqual(api.setLargeMesaSplitEnabled(false), false);
  ({ tier, small, decals } = build());
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.strictEqual(scene.children.filter(o => o.userData.plateauMesaRenderSplit).length, 0, 'disabled: nothing is split');
  assert.strictEqual(tier.visible, true, 'disabled: the tier draws itself as before');
  assert.strictEqual(decals.visible, true);
  api.setLargeMesaSplitEnabled(true);

  console.log('PASS plateau mesa large split');
})().catch(error => { console.error(error); process.exit(1); });
