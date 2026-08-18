'use strict';
const assert = require('assert');

class BufferGeometry {
  constructor() { this.attributes = {}; }
  setAttribute(name, value) { this.attributes[name] = value; return this; }
  setIndex(value) { this.index = value; return this; }
  computeVertexNormals() {}
}
class BufferAttribute { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; } }
class Mesh { constructor(geometry, material) { this.geometry = geometry; this.material = material; this.userData = {}; } }
class MeshStandardMaterial { constructor(opts) { Object.assign(this, opts); } }
global.THREE = {
  BufferGeometry,
  BufferAttribute,
  Float32BufferAttribute: BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  DoubleSide: 2,
  InstancedMesh: class {},
  Object3D: class {},
};
global.window = {};
require('../docs/js/border-terrain.js');
const Core = window.BackgroundScenery;
assert(Core, 'BackgroundScenery export missing');

const town = {
  cols: 60,
  rows: 50,
  routes: [
    { id: 'north_south', label: 'North/South', nodes: [[30,49],[30,20],[30,0]], pathWidth: 3 },
    { id: 'east', label: 'East', nodes: [[40,30],[59,30]], pathWidth: 5 },
    { id: 'west', label: 'West', nodes: [[20,25],[0,25]], pathWidth: 3 },
  ],
  rivers: [
    { id: 'stream', label: 'Town Stream', kind: 'stream', width: 3, seed: 336742, nodes: [[0,0],[13,11],[25,17],[37,20],[50,21],[59,22]] },
  ],
};

let attachments = Core.collectBoundaryAttachments(town);
const byId = id => attachments.find(a => a.id === id);
assert.equal(byId('route:north_south:start').edge, 'south');
assert.equal(byId('route:north_south:end').edge, 'north');
assert.equal(byId('route:east:end').edge, 'east');
assert.equal(byId('route:east:end').width, 5);
assert.equal(byId('river:stream:start').edge, 'north', 'NW-corner river defaults to north');
assert.equal(byId('river:stream:end').edge, 'east');
assert.equal(byId('river:stream:start').seed, 336742);
const cfg = Core.resolveConfig(town);
assert.equal(cfg.ridgeClearanceTiles, 0);
assert.equal(cfg.borderDepthTiles, 18);
const riverAutoA = Core.buildContinuationPolyline(byId('river:stream:start'), cfg, {});
const riverAutoB = Core.buildContinuationPolyline(byId('river:stream:start'), cfg, {});
assert.deepStrictEqual(riverAutoA, riverAutoB, 'seeded river continuation must be deterministic');
assert(riverAutoA.length > 2, 'automatic river continuation should meander, not become one straight segment');

town.backgroundScenery = { attachments: { 'river:stream:start': { edge: 'west' } } };
attachments = Core.collectBoundaryAttachments(town);
assert.equal(attachments.find(a => a.id === 'river:stream:start').edge, 'west', 'corner edge override must win');
delete town.backgroundScenery;

assert.equal(Core.WILDERNESS_PROFILES.map_southern_cloud_forest.side, 'north');
const cloudGrid = Array.from({ length: 8 }, () => Array.from({ length: 20 }, () => ({ type: 'grass', elevTier: 1 })));
for (let c = 3; c <= 4; c++) cloudGrid[0][c].type = 'path';
for (let c = 11; c <= 15; c++) cloudGrid[0][c].type = 'path';
const cloudEntrance = Core.findEdgePathRun(cloudGrid, 20, 8, 'north');
assert.equal(cloudEntrance.widthCells, 5, 'wilderness scenery should select the widest generated north-edge path run');
assert.equal(cloudEntrance.center, 13.5, 'wilderness scenery should center itself on the generated entrance, not a hardcoded column');

const Border = window.BorderTerrain;
assert.equal(Border.CLOUD_FOREST_BASE_TREE_SPACING_WORLD, 1, 'Cloud Forest scenery must translate the generator tree spacing to one world unit');
const denseLayout = Border.buildDenseCloudForestLayout(12, 6, 6, 1.5, () => 2);
const scales = new Set(denseLayout.map(entry => entry.scale));
assert(scales.has(1), 'dense layout must include full-height Shadewoods');
assert(scales.has(0.75), 'dense layout must fill gaps with 75% Shadewoods');
assert(scales.has(0.5), 'dense layout must fill remaining gaps with 50% Shadewoods');
assert(denseLayout.every(entry => Math.abs(entry.x - 6) >= 1.5), 'all tree layers must preserve the authored town-path cut');
const fullTrees = denseLayout.filter(entry => entry.scale === 1);
for (let i = 0; i < fullTrees.length; i++) {
  for (let j = i + 1; j < fullTrees.length; j++) {
    const dx = Math.abs(fullTrees[i].x - fullTrees[j].x);
    const dz = Math.abs(fullTrees[i].z - fullTrees[j].z);
    if (dx < 1e-6 || dz < 1e-6) assert(Math.max(dx, dz) >= 1 - 1e-6, 'full-height centers must retain the one-world-unit base spacing');
  }
}

const syntheticWorkspace = {
  maps: [{
    id: 'map_generated_wilderness_root', cols: 3, rows: 4, tiles: {
      '0,0': { type: 'rock', plateau: 'boundary_a', borderEscarpment: true, generatedBorderEscarpment: true, borderEscarpmentSide: 'north', borderEscarpmentDepth: 2 },
      '1,0': { type: 'path', plateau: 'boundary_b', borderEscarpment: true, generatedBorderEscarpment: true, borderEscarpmentSide: 'north', borderEscarpmentDepth: 2 },
      '0,1': { type: 'grass', plateau: 'interior_a' },
      '1,1': { type: 'path', plateau: 'interior_b' },
    }, generatedFrom: {}
  }],
  generatorPreset: {},
};
Border.removeCloudForestNorthBoundaryCliffs(syntheticWorkspace);
const normalizedRoot = syntheticWorkspace.maps[0];
assert.equal(normalizedRoot.tiles['0,0'].plateau, 'interior_a', 'north cliff tile should inherit its inward plateau instead of a boundary-cliff plateau');
assert.equal(normalizedRoot.tiles['0,0'].type, 'grass', 'north cliff rock should become ordinary ground');
assert.equal(normalizedRoot.tiles['0,0'].borderEntryGate, true, 'raised north-edge ground must merge as a flat plateau top rather than an incline wall');
assert.equal(normalizedRoot.tiles['0,0'].borderEscarpment, undefined);
assert.equal(normalizedRoot.tiles['1,0'].plateau, 'interior_b');
assert.equal(normalizedRoot.tiles['1,0'].type, 'path', 'the actual generated entrance path must survive cliff removal');
assert(normalizedRoot.generatedFrom.northBoundaryCliffsRemoved >= 2);

const scene = { items: [], add(obj) { this.items.push(obj); }, remove() {} };
window.BorderTerrain.init({
  getTownScene: () => scene,
  getTownZone: () => town,
  NORMAL_TOP: 0,
  TileType: { GRASS: 'grass', PATH: 'path' },
  resolveTileMat: () => ({}),
  resolveCliffMat: () => ({}),
  getGrassBillboardMat: () => null,
  mbRng: seed => { let x = seed >>> 0; return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296); },
  getGrassEnabled: () => true,
  grassBladeGeo: {},
  markOutline() {},
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  PLATEAU_UNIT: 2.5,
});
window.BorderTerrain.buildTownBorderTerrain();
assert(scene.items.length >= 8, `expected terrain, cliff, route and water meshes; got ${scene.items.length}`);
console.log(`PASS background scenery: ${attachments.length} attachments; ${scene.items.length} generated town meshes; cloud entrance ${cloudEntrance.widthCells} tiles at ${cloudEntrance.center}; dense layout ${denseLayout.length} trees.`);
