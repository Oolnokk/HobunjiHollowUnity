#!/usr/bin/env node
'use strict';

// Farm per-tile ground meshes are drawn as merged 8x8-tile batches during the
// world render only. Runs the real module with minimal Three.js stand-ins.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let nextId = 1;
class Layers { constructor() { this.mask = 1; } enable(l) { this.mask |= (1 << l); } }
class Object3D {
  constructor() { this.id = nextId++; this.children = []; this.parent = null; this.visible = true; this.userData = {}; this.layers = new Layers();
    this.position = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }; this.matrixWorld = { elements: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1] }; this.matrixAutoUpdate = true; this.renderOrder = 0; this.frustumCulled = true; this.castShadow = false; this.receiveShadow = false; }
  add(o) { o.parent?.remove?.(o); o.parent = this; this.children.push(o); return this; }
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); o.parent = null; return this; }
  updateMatrixWorld() { const e = this.matrixWorld.elements, p = this.parent?.isScene ? null : this.parent?.matrixWorld.elements; e[12] = this.position.x + (p ? p[12] : 0); e[13] = this.position.y + (p ? p[13] : 0); e[14] = this.position.z + (p ? p[14] : 0); for (const c of this.children) c.updateMatrixWorld(); }
  updateMatrix() {}
  onBeforeRender() {}
}
class Group extends Object3D {}
class Scene extends Object3D { constructor() { super(); this.isScene = true; } }
class BufferAttribute {
  constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; this.version = 0; }
  getX(i) { return this.array[i * this.itemSize]; } getY(i) { return this.array[i * this.itemSize + 1]; } getZ(i) { return this.array[i * this.itemSize + 2]; }
}
class BufferGeometry {
  constructor() { this.id = nextId++; this.attributes = {}; this.index = null; this.groups = []; this.morphAttributes = {}; this.disposed = false; }
  setAttribute(k, a) { this.attributes[k] = a; } setIndex(a) { this.index = a; }
  computeBoundingBox() {} computeBoundingSphere() {} dispose() { this.disposed = true; }
}
class Mesh extends Object3D { constructor(geometry, material) { super(); this.isMesh = true; this.geometry = geometry; this.material = material; } }
const THREE = { Object3D, Group, Scene, Mesh, BufferGeometry, BufferAttribute };
const window = { THREE, GridTileAccessors: { getCurrentArea: () => area } };
let area = 'farm';
let clock = 0; // Drives the module's tagged-group rescan interval.
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'docs/js/farm-tile-render-batches.js'), 'utf8'), vm.createContext({ window, performance: { now: () => clock }, Float64Array, Float32Array, Uint16Array, Uint32Array, Map, WeakMap, Math, Object, String }), { filename: 'farm-tile-render-batches.js' });
const batches = window.FarmTileRenderBatches;

const quad = () => { const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(new Float32Array([0,0,0, 1,0,0, 1,0,1, 0,0,1]), 3)); g.setAttribute('normal', new BufferAttribute(new Float32Array([0,1,0, 0,1,0, 0,1,0, 0,1,0]), 3)); g.setAttribute('uv', new BufferAttribute(new Float32Array([0,0, 1,0, 1,1, 0,1]), 2)); g.setIndex(new BufferAttribute(new Uint16Array([0,1,2, 0,2,3]), 1)); return g; };
const grassMat = { id: 1 }, soilMat = { id: 2 };
const grassColor = { name: 'grass' }, soilColor = { name: 'soil' };
const scene = new Scene();
const edgeHook = () => {};
const tile = (col, row, material = grassMat, color = grassColor) => {
  const m = new Mesh(quad(), material); m.position.x = col; m.position.z = row; m.receiveShadow = true;
  m.layers.enable(3); m.userData.hobunjiTerrainEdgeIdColor = color; m.onBeforeRender = edgeHook; scene.add(m); return m;
};
const tiles = [];
for (let r = 0; r < 4; r++) for (let c = 0; c < 10; c++) tiles.push(tile(c, r));
tiles[5].geometry.groups = [{ start: 0, count: 3 }, { start: 3, count: 3 }]; // Jigsaw-baked farm tiles carry groups; one material still draws the whole range.
const soil = [tile(1, 5, soilMat, soilColor), tile(2, 5, soilMat, soilColor)];
const prop = new Mesh(quad(), grassMat); prop.layers.enable(3); prop.onBeforeRender = function custom() {}; scene.add(prop); // Unknown hook: never batched.
const plain = new Mesh(quad(), grassMat); scene.add(plain); // Not marked as terrain (no material-ID layer).

const restore = batches.suspendForRender(scene);
assert.equal(typeof restore, 'function', 'farm tiles are swapped for batches');
const holder = scene.children.find(o => o.userData.hobunjiFarmTileBatchHolder);
const drawn = holder.children.filter(m => m.visible);
// 10x4 grass tiles span two 8-wide cells (x 0-7 and 8-9) -> 2 batches; 2 soil tiles -> 1 batch.
assert.equal(drawn.length, 3, 'one batch per 8x8 cell and render state');
assert.ok(tiles.every(t => !t.visible) && soil.every(t => !t.visible), 'batched tiles are hidden for this render');
assert.ok(prop.visible && plain.visible, 'unknown hooks and unmarked meshes keep drawing themselves');
const grassBatch = drawn.find(m => m.material === grassMat && m.geometry.attributes.position.count === 8 * 4 * 4);
assert.ok(grassBatch, 'the 8x4-tile grass cell merges 32 tiles');
assert.equal(grassBatch.onBeforeRender, edgeHook, 'the edge-ID hook travels with the batch');
assert.equal(grassBatch.userData.terrainRenderChunk, true, 'batches are terrain to the ground x-ray and invisible to the jigsaw/chunker');
assert.equal(grassBatch.raycast(), undefined, 'batches never answer raycasts');
const pos = grassBatch.geometry.attributes.position.array;
assert.ok(Math.max(...pos.filter((_, i) => i % 3 === 0)) === 8 && Math.max(...pos.filter((_, i) => i % 3 === 2)) === 4, 'geometry is baked in world space');
assert.equal(grassBatch.geometry.index.array.length, 32 * 6, 'indices are offset per tile');
restore();
assert.ok(tiles.every(t => t.visible) && !holder.visible, 'restore shows the authoritative tiles again');

const rebuilds = batches.snapshot().rebuilds;
batches.suspendForRender(scene)();
assert.equal(batches.snapshot().rebuilds, rebuilds, 'unchanged tiles reuse their batches');
tiles[0].geometry.attributes.uv.version++; // e.g. jigsaw re-bakes UVs
batches.suspendForRender(scene)();
assert.equal(batches.snapshot().rebuilds, rebuilds + 1, 'a changed tile rebuilds only its own batch');
scene.remove(tiles[1]); const hoed = tile(1, 0, soilMat, soilColor); // A hoe stroke replaces the tile mesh.
batches.suspendForRender(scene)();
assert.equal(batches.snapshot().rebuilds, rebuilds + 3, 'the tile swap rebuilds the cell it left and the cell it joined');
tiles[2].visible = false; // e.g. hidden by another system
const r2 = batches.suspendForRender(scene); r2();
assert.equal(tiles[2].visible, false, 'a tile hidden by someone else stays hidden and out of the batch');

area = 'town';
assert.equal(batches.suspendForRender(scene), null, 'only the farm is batched');

// Tagged tile groups (town NPC farm plots) batch in any area, keep no terrain identity,
// and sit at their tiles' centroid; untagged children and crops keep drawing themselves.
const town = new Scene();
const plots = new Group(); plots.userData.hobunjiStaticBatchGroup = true; plots.position.x = 16; town.add(plots);
const waterMat = { id: 7, transparent: true };
const plotTile = (col, row, material = soilMat) => { const m = new Mesh(quad(), material); m.position.x = col; m.position.z = row; m.userData.hobunjiStaticBatchable = true; plots.add(m); return m; };
const soilTiles = [plotTile(0, 0), plotTile(1, 0), plotTile(2, 0)];
const waterTiles = [plotTile(0, 1, waterMat), plotTile(1, 1, waterMat)];
waterTiles.forEach(t => { t.userData.hobunjiStaticBatchFlat = true; }); // Declared non-overlapping.
const glassMat = { id: 8, transparent: true };
const panes = [plotTile(0, 2, glassMat), plotTile(1, 2, glassMat)]; // Transparent but not declared flat: may overlap, never merged.
const crop = new Mesh(quad(), grassMat); crop.position.x = 1; plots.add(crop); // Untagged (sways via render hooks): never batched.
const hooked = plotTile(3, 0); hooked.onBeforeRender = function custom() {}; // Unknown hook: never batched.
const terrainLike = new Mesh(quad(), grassMat); terrainLike.layers.enable(3); terrainLike.userData.hobunjiTerrainEdgeIdColor = grassColor; terrainLike.onBeforeRender = edgeHook; town.add(terrainLike); // Farm-only path.
const restoreTown = batches.suspendForRender(town);
assert.equal(typeof restoreTown, 'function', 'tagged plot tiles batch outside the farm');
const townHolder = town.children.find(o => o.userData.hobunjiFarmTileBatchHolder);
const townDrawn = townHolder.children.filter(m => m.visible);
assert.equal(townDrawn.length, 2, 'one soil batch and one water batch');
assert.ok(soilTiles.every(t => !t.visible) && waterTiles.every(t => !t.visible), 'tagged tiles are hidden for this render');
assert.ok(crop.visible && hooked.visible && terrainLike.visible, 'crops, hooked tiles and farm-only terrain outside the farm draw themselves');
assert.ok(panes.every(t => t.visible), 'transparent members that are not declared flat draw themselves');
const soilBatch = townDrawn.find(m => m.material === soilMat);
assert.equal(soilBatch.userData.terrainRenderChunk, undefined, 'plot batches never become terrain to the ground x-ray');
assert.equal(soilBatch.userData.hobunjiRenderProxy, true, 'plot batches are render proxies');
assert.equal(soilBatch.userData.geometryAutoLODExclude, true, 'opt-in AutoLOD never decimates a merge of tiny sources');
assert.deepEqual([soilBatch.position.x, soilBatch.position.z], [17, 0], 'a tagged batch sits at its tiles\' centroid (group offset included)');
const sx = soilBatch.geometry.attributes.position.array.filter((_, i) => i % 3 === 0);
assert.deepEqual([Math.min(...sx), Math.max(...sx)], [-1, 2], 'vertices are relative to that centroid');
restoreTown();
assert.ok(soilTiles.every(t => t.visible) && !townHolder.visible, 'restore shows the plot tiles again');
assert.equal(batches.suspendForRender(town, { isZone: true }), null, 'wilderness zones leave tagged groups to zone-prop batching');
const rebuildsBefore = batches.snapshot().rebuilds;
const cachedBefore = batches.snapshot().groupCachedScans;
batches.suspendForRender(town)();
assert.equal(batches.snapshot().groupCachedScans, cachedBefore + 1, 'an unchanged tagged group reuses its member list');
soilTiles[0].geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0,0, 1,0, 1,1, 0,1]), 2)); // Replaced attribute restarts at version 0.
batches.suspendForRender(town)();
assert.equal(batches.snapshot().rebuilds, rebuildsBefore, 'an in-place edit waits for the periodic full rescan');
clock += 1001;
batches.suspendForRender(town)();
assert.equal(batches.snapshot().rebuilds, rebuildsBefore + 1, 'the full rescan sees a replaced attribute even at the same version');
plots.remove(soilTiles[2]); const moved = plotTile(5, 0); // An owner swapping a tile mesh is seen at once.
const r3 = batches.suspendForRender(town);
assert.ok(soilTiles[2].visible === true && !moved.visible, 'a removed member is no longer hidden; its replacement joins the batch the same frame');
r3();
assert.equal(batches.snapshot().rebuilds, rebuildsBefore + 2, 'the changed cell rebuilds immediately');
let full = batches.snapshot().groupFullScans;
batches.suspendForRender(town)();
assert.equal(batches.snapshot().groupFullScans, full, 'unchanged again: cached');
soilTiles[1].material = { id: 9 }; // e.g. a finish/tint swap
const r4 = batches.suspendForRender(town);
assert.equal(batches.snapshot().groupFullScans, full + 1, 'a material swap rescans the same frame');
assert.equal(soilTiles[1].visible, true, 'the re-materialed tile left the soil batch and draws itself');
r4();
full = batches.snapshot().groupFullScans;
plots.position.x = 20; // A moved building or plot group
batches.suspendForRender(town)();
assert.equal(batches.snapshot().groupFullScans, full + 1, 'a moved group rescans the same frame');
plots.userData.hobunjiStaticBatchRevision = 1; const fullBefore = batches.snapshot().groupFullScans;
batches.suspendForRender(town)();
assert.equal(batches.snapshot().groupFullScans, fullBefore + 1, 'an owner revision bump forces a full rescan');
plots.visible = false;
assert.equal(batches.suspendForRender(town), null, 'a hidden source group is left alone');
area = 'farm';
batches.setEnabled(false);
assert.equal(batches.suspendForRender(scene), null, 'A/B switch');
console.log('ok - farm tiles draw as merged 8x8 batches during the world render, sources stay authoritative');
