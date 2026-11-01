#!/usr/bin/env node
'use strict';

// Exercise the actual vegetation builder and building-footprint filter together.
// NPC farmwork calls markTileDirty -> refreshTileMesh -> rebuildFarmBillboards,
// and the test invokes that same public renderer refresh for each tile mutation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Matrix4 {
  constructor() {
    this.elements = new Float32Array(16);
    this.elements[0] = this.elements[5] = this.elements[10] = this.elements[15] = 1;
  }
  fromArray(buffer, offset = 0) { this.elements.set(buffer.subarray(offset, offset + 16)); return this; }
  multiplyMatrices(_parent, local) { this.elements.set(local.elements); return this; } // Identity scene transform in this harness.
}
class Vector3 {
  setFromMatrixPosition(matrix) {
    this.x = matrix.elements[12]; this.y = matrix.elements[13]; this.z = matrix.elements[14];
    return this;
  }
}
class Object3D {
  constructor() {
    this.position = { x: 0, y: 0, z: 0, set: (x, y, z) => Object.assign(this.position, { x, y, z }) };
    this.rotation = { set() {} };
    this.scale = { set() {} };
    this.matrix = new Matrix4();
  }
  updateMatrix() {
    this.matrix.elements[12] = this.position.x;
    this.matrix.elements[13] = this.position.y;
    this.matrix.elements[14] = this.position.z;
  }
}
class InstancedMesh {
  constructor(_geometry, _material, capacity) {
    this.isInstancedMesh = true;
    this.userData = {};
    this.instanceMatrix = { array: new Float32Array(capacity * 16), needsUpdate: false };
    this.matrixWorld = new Matrix4();
    this.count = capacity;
  }
  setMatrixAt(index, matrix) { this.instanceMatrix.array.set(matrix.elements, index * 16); }
  updateMatrixWorld() {}
  computeBoundingBox() {}
  computeBoundingSphere() {}
}
class Mesh {
  constructor(geometry, material) {
    this.geometry = geometry; this.material = material; this.userData = {};
    this.position = { set() {} }; this.layers = { enable() {} };
  }
}
class Color {
  setHSL() { return this; }
  set() { return this; }
}
class Geometry { translate() { return this; } }
class ShaderMaterial { constructor(def) { this.uniforms = def.uniforms; } }
class TextureLoader { load(_url, onLoad) { onLoad({}); } }
const THREE = {
  Matrix4, Vector3, Object3D, InstancedMesh, Mesh, Color, PlaneGeometry: Geometry,
  BoxGeometry: Geometry, ShaderMaterial, TextureLoader,
  MathUtils: { degToRad: degrees => degrees * Math.PI / 180 },
  NearestFilter: 'nearest', DoubleSide: 'double', AdditiveBlending: 'add',
};
const window = {
  FarmPathBricks: { suppressesGrassAt: () => false },
  TerrainGeometry: {
    makeFloorGeo: () => new Geometry(),
    buildTerrainTileGeo: () => ({ dirtGeo: new Geometry(), grassGeo: null }),
  },
};
const context = vm.createContext({ window, THREE, Float32Array, Map, Set, Math, Number, console });
const read = relative => fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
vm.runInContext(read('docs/js/building-grass-suppression.js'), context, { filename: 'building-grass-suppression.js' });
vm.runInContext(read('docs/js/vegetation-crop-rendering.js'), context, { filename: 'vegetation-crop-rendering.js' });
const filter = window.BuildingGrassSuppression; // Production billboard source/footprint filtering, not duplicate test logic.
const renderer = window.VegetationCropRendering; // Production farm grass/weed instance generator.

const TileType = { GRASS: 'grass', WEEDS: 'weeds', TILLED: 'tilled', TRENCH: 'trench' };
const grid = [[
  { type: TileType.GRASS, crop: '' },
  { type: TileType.GRASS, crop: '' },
  { type: TileType.GRASS, crop: '' },
  { type: TileType.WEEDS, crop: '' },
]]; // Real terrain and crop state, not merely the family plot designation.
const scene = {
  children: [], add(mesh) { this.children.push(mesh); },
  remove(mesh) { const index = this.children.indexOf(mesh); if (index >= 0) this.children.splice(index, 1); },
};
renderer.init({
  COLS: 4, ROWS: 1, PLATEAU_UNIT: 2.5, TileType, scene,
  getGrid: () => grid, getGrassEnabled: () => true, getWeed3D: () => false,
  getTownSceneBuilt: () => false, applySeasonalGrassAppearance() {},
  combatConfig: () => ({ cuttableTargetGlow: {} }), tileSurfaceY: () => 0,
  tileYCenter: () => 0, resolveTileMat: () => ({}), markTerrainEdgeId() {},
  terrainCategoryFor: type => type, NORMAL_TOP: 0,
});
const grassMesh = renderer.getFarmGrassBillMesh(); // Persistent InstancedMesh reused after every farm terrain edit.
const weedMesh = scene.children.find(mesh => mesh.isInstancedMesh && mesh !== grassMesh && mesh.count === 28);
const BLADES = 28; // The production renderer generates fourteen crossed grass/weed pairs per tile.
assert.ok(grassMesh && weedMesh, 'both original farm grass and weed meshes were created');
assert.equal(grassMesh.count, 3 * BLADES);
assert.equal(weedMesh.count, BLADES);

const visibleCells = mesh => [...new Set(Array.from({ length: mesh.count },
  (_, i) => Math.floor(mesh.instanceMatrix.array[i * 16 + 12])))].sort((a, b) => a - b);
const sourceCells = mesh => {
  const source = mesh.userData.hobunjiBillboardSourceMatrices;
  return [...new Set(Array.from({ length: mesh.userData.hobunjiBillboardSourceCount || 0 },
    (_, i) => Math.floor(source[i * 16 + 12])))].sort((a, b) => a - b);
};

const originalHouseMask = new Set(['0,0']); // The farmhouse initially covers col 0.
filter.filterBillboardMesh(grassMesh, originalHouseMask, 'hobunjiFarmBuildingGrass');
filter.filterBillboardMesh(weedMesh, originalHouseMask, 'hobunjiFarmBuildingGrass');
assert.deepEqual(visibleCells(grassMesh), [1, 2], 'farmhouse hides grass only on its actual footprint');
assert.deepEqual(sourceCells(grassMesh), [0, 1, 2], 'house grass remains in unfiltered source for later recovery');

grid[0][1].type = TileType.TILLED; // Spouse hoes a newly designated field tile.
renderer.refreshTileMesh(1, 0);
assert.deepEqual(visibleCells(grassMesh), [2], 'spouse till removes billboards, including through house filtering');
assert.deepEqual(sourceCells(grassMesh), [0, 2], 'till removes stale source data, not just visible instances');

grid[0][1].crop = 'needlegrain'; // Spouse plants the tilled plot.
renderer.refreshTileMesh(1, 0);
assert.deepEqual(visibleCells(grassMesh), [2], 'planting does not restore grass on tilled soil');

filter.filterBillboardMesh(grassMesh, new Set(), 'hobunjiFarmBuildingGrass');
assert.deepEqual(visibleCells(grassMesh), [0, 2], 'moving the farmhouse reveals only still-grassy ground');

grid[0][0].type = TileType.TRENCH; // Spouse digs the previously covered grass tile.
renderer.refreshTileMesh(0, 0);
assert.deepEqual(visibleCells(grassMesh), [2], 'no grass floating over a newly excavated trench');

grid[0][2].type = TileType.TRENCH; // Last grass tile is excavated.
renderer.refreshTileMesh(2, 0);
filter.filterBillboardMesh(grassMesh, new Set(), 'hobunjiFarmBuildingGrass');
assert.equal(grassMesh.count, 0, 'stale matrices remain inert after the last source tile disappears');

grid[0][1].type = TileType.GRASS; grid[0][1].crop = ''; // Untill restores an appropriate grass tile.
renderer.refreshTileMesh(1, 0);
assert.deepEqual(visibleCells(grassMesh), [1], 'grass returns when the tile actually becomes grass again');

grid[0][1].crop = 'needlegrain'; // Legacy crop on a grass-type tile must still suppress grass.
renderer.refreshTileMesh(1, 0);
assert.equal(grassMesh.count, 0, 'a planted crop hides grass even when ground type is stale');

grid[0][3].crop = 'needlegrain'; // Defensive check: old weed ground with a live crop.
renderer.refreshTileMesh(3, 0);
assert.equal(weedMesh.count, 0, 'crop-occupied weed tiles do not retain billboard clusters');
grid[0][3].crop = '';
renderer.refreshTileMesh(3, 0);
assert.deepEqual(visibleCells(weedMesh), [3], 'weeds return to weed ground when a crop is removed');

assert.equal(filter.refreshRebuiltBillboardMesh({}), null, 'non-billboard scene objects are ignored');
console.log('ok - production farm grass/weed renderer and footprint-source cache stay synchronized');
