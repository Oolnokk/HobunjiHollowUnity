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
    this.position = { x: 0, y: 0, z: 0 }; this.matrixWorld = { elements: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1] }; this.matrixAutoUpdate = true; this.renderOrder = 0; this.frustumCulled = true; this.castShadow = false; this.receiveShadow = false; }
  add(o) { o.parent?.remove?.(o); o.parent = this; this.children.push(o); return this; }
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); o.parent = null; return this; }
  updateMatrixWorld() { const e = this.matrixWorld.elements; e[12] = this.position.x; e[13] = this.position.y; e[14] = this.position.z; }
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
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'docs/js/farm-tile-render-batches.js'), 'utf8'), vm.createContext({ window, Float64Array, Float32Array, Uint16Array, Uint32Array, Map, WeakMap, Math, Object, String }), { filename: 'farm-tile-render-batches.js' });
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
area = 'farm';
batches.setEnabled(false);
assert.equal(batches.suspendForRender(scene), null, 'A/B switch');
console.log('ok - farm tiles draw as merged 8x8 batches during the world render, sources stay authoritative');
