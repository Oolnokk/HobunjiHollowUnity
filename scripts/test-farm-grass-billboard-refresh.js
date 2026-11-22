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
vm.runInContext(read('docs/js/npc-farm-plots.js'), context, { filename: 'npc-farm-plots.js' }); // Use the real managed-key registry that the town map loader already calls.
const filter = window.BuildingGrassSuppression; // Production billboard source/footprint filtering, not duplicate test logic.
const renderer = window.VegetationCropRendering; // Production farm grass/weed instance generator.

const TileType = { GRASS: 'grass', WEEDS: 'weeds', TILLED: 'tilled', TRENCH: 'trench' };
const grid = [[
  { type: TileType.GRASS, crop: '' },
  { type: TileType.GRASS, crop: '' },
  { type: TileType.GRASS, crop: '' },
  { type: TileType.WEEDS, crop: '' },
]]; // Real terrain and crop state, not merely the family plot designation.
let townGrid = [[0, 1, 2].map(() => ({ type: TileType.GRASS, elevTier: 0 }))]; // Normalized base cells in the actual town loader.
const townZone = { id: 'map_hobunji_town' }; // The production town layout intentionally does not retain farmPlots.
const plotOwner = window.NpcFarmPlots; // Authoritative source of plot membership shared by floor and billboard renderers.
plotOwner.registerMap(townZone.id, [
  { id: 'bed', tiles: [[0, 0]], tillers: ['gorobi_ginju'] },
  { id: 'trench', kind: 'dig', tiles: [[1, 0]], diggers: ['gikali_ginju'] },
  { id: 'unassigned', tiles: [[2, 0]], tillers: [] },
]);
const townScene = { children: [], add(mesh) { this.children.push(mesh); }, remove(mesh) { const i = this.children.indexOf(mesh); if (i >= 0) this.children.splice(i, 1); } }; // Test scene for rebuilding town grass.
const scene = {
  children: [], add(mesh) { this.children.push(mesh); },
  remove(mesh) { const index = this.children.indexOf(mesh); if (index >= 0) this.children.splice(index, 1); },
};
renderer.init({
  COLS: 4, ROWS: 1, PLATEAU_UNIT: 2.5, TileType, scene,
  getGrid: () => grid, getGrassEnabled: () => true, getWeed3D: () => false,
  getTownSceneBuilt: () => false, getTownZone: () => townZone, getTownGrid: () => townGrid, getTownScene: () => townScene, applySeasonalGrassAppearance() {},
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

// The town floor is grass beneath simulated beds; no instance of that grass
// may survive in either the renderer's source or its compacted scene buffer.
renderer.buildTownGrassBillboards(3, 1);
let townBillboard = townScene.children.find(mesh => mesh.isInstancedMesh);
assert.ok(townBillboard, 'town grass has a source mesh');
assert.deepEqual(sourceCells(townBillboard), [2], 'tillers and trench diggers suppress both kinds of Ginju plot');
assert.deepEqual(visibleCells(townBillboard), [2], 'only the unassigned grassy lawn gets billboards');
filter.filterBillboardMesh(townBillboard, new Set(), 'hobunjiTownBuildingGrass');
assert.deepEqual(visibleCells(townBillboard), [2], 'building-footprint refresh does not resurrect plot grass');

// Reloading the same town replaces the authoritative plot set without keeping
// an old grass mask or spuriously suppressing an unassigned tile.
plotOwner.registerMap(townZone.id, [{ id: 'runtime-bed', tiles: [[1, 0]], tillers: ['gikali_ginju'] }]);
renderer.buildTownGrassBillboards(3, 1);
townBillboard = townScene.children.find(mesh => mesh.isInstancedMesh);
assert.deepEqual(sourceCells(townBillboard), [0, 2], 'reloaded plot registry follows changed management and restores released grass');

// Exercise the complete real Ginju map instead of assuming a mocked field
// shape: it has four cultivated beds and three irrigation trench groups.
const authoredMap = JSON.parse(fs.readFileSync(path.join(root, 'config/maps/hobunji_hollow_town.map.json'), 'utf8')); // Canonical real town source for grass ownership.
plotOwner.registerMap(authoredMap.id, authoredMap.farmPlots);
const plotTiles = new Set(authoredMap.farmPlots.flatMap(plot => plot.tiles.map(([c, row]) => `${c},${row}`))); // Exact ground footprints, including the north/south trench orientation.
assert.equal(authoredMap.farmPlots.length, 7, 'Ginju has seven assigned field and irrigation groups');
assert.equal(plotTiles.size, 174, 'all 174 farm tiles remain distinct and assigned');
assert.ok([...plotTiles].every(key => {
  const [c, row] = key.split(',').map(Number);
  return plotOwner.isManagedTile(authoredMap.id, c, row);
}), 'all authored Ginju crop and trench cells are recognized by the actual NPC plot runtime');

townGrid = Array.from({ length: authoredMap.rows }, (_, row) => Array.from({ length: authoredMap.cols }, (_, c) => {
  const type = authoredMap.tiles[`${c},${row}`]?.type || TileType.GRASS;
  return { type: plotOwner.isManagedTile(authoredMap.id, c, row) ? TileType.GRASS : type, elevTier: 0 };
})); // Mirror game.js's town-layout conversion before VegetationCropRendering builds billboards.
renderer.buildTownGrassBillboards(authoredMap.cols, authoredMap.rows);
townBillboard = townScene.children.find(mesh => mesh.isInstancedMesh);
const projectedSource = townBillboard.userData.hobunjiBillboardSourceMatrices; // Immutable base matrices consumed later by height and building render passes.
const projectedCount = townBillboard.userData.hobunjiBillboardSourceCount;
for (let i = 0; i < projectedCount; i++) {
  const x = projectedSource[i * 16 + 12], z = projectedSource[i * 16 + 14];
  assert.equal(plotTiles.has(`${Math.floor(x)},${Math.floor(z)}`), false, 'not one grass billboard root sits inside a real Ginju field');
}
const grassCount = townGrid.flat().filter(tile => tile.type === TileType.GRASS).length - plotTiles.size; // Whole-town expected count with all 174 plot cells hidden.
assert.equal(townBillboard.count, grassCount * BLADES, 'town retains lawn billboards but removes every managed plot source instance');
console.log('ok - all seven real Ginju fields and trenches exclude grass from the town render source');
console.log('ok - production farm grass/weed renderer and footprint-source cache stay synchronized');
