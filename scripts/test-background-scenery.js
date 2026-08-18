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
console.log(`PASS background scenery: ${attachments.length} attachments; ${scene.items.length} generated scene meshes.`);
