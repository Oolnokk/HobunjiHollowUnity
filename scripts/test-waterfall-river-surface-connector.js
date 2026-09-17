'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('docs/js/zone-terrain-features.js', 'utf8'); // Executes the production waterfall/river builders below instead of duplicating their height math in the test.

assert.match(source, /function waterSurfaceY\(tile\)/, 'waterfall and horizontal water surfaces should share one visible-surface height helper');
assert.match(source, /const selfY = waterSurfaceY\(t\)/, 'waterfall curtains should start from the visible water surface, not the sunken river bed');
assert.match(source, /surfaceY: waterSurfaceY\(tile\)/, 'merged horizontal water should use the same visible-surface helper as waterfall curtains');

class BufferGeometry {
  constructor() { this.attributes = {}; this.index = null; }
  setAttribute(name, attribute) { this.attributes[name] = attribute; }
  setIndex(index) { this.index = index; }
  computeVertexNormals() {}
  computeBoundingSphere() {}
  dispose() {}
}
class Attribute {
  constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; }
}
class DataTexture {
  constructor() { this.needsUpdate = false; }
  dispose() {}
}
class Color { constructor(value) { this.value = value; } }
class ShaderMaterial { constructor(options) { Object.assign(this, options); } }
class TextureLoader { load() {} }
class Mesh {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.userData = {};
    this.parent = null;
    this.frustumCulled = true;
  }
}

const THREE = { // Supplies only the Three.js pieces reached by the real waterfall builder in this isolated regression test.
  BufferGeometry,
  Float32BufferAttribute: Attribute,
  BufferAttribute: Attribute,
  DataTexture,
  RGBAFormat: 'rgba',
  Color,
  ShaderMaterial,
  TextureLoader,
  RepeatWrapping: 'repeat',
  SRGBColorSpace: 'srgb',
  DoubleSide: 'double',
  Mesh,
};
const window = { MergedWaterRenderer: { DEFAULT_TEXTURE_TILE_SIZE: 4 } }; // Provides the shared river texture scale read by the waterfall UV builder.
vm.runInNewContext(source, { window, THREE, console, Uint8Array, Uint16Array, Uint32Array, Math, performance: { now: () => 0 } });

const api = window.ZoneTerrainFeatures; // Calls the production feature API for both vertical and horizontal water geometry.
const TileType = { WATERFALL: 'waterfall', RIVER: 'river', STREAM: 'stream', RAMP: 'ramp', PATH: 'path', GRASS: 'grass', ROCK: 'rock' }; // Matches the string tile identities used by the production module.
let mergedCells = null; // Captures the horizontal river surface cells so their Y values can be compared with the waterfall curtain endpoints.
api.init({
  TileType,
  RIVER_TOP: -0.55,
  NORMAL_TOP: 0,
  PLATEAU_UNIT: 2.5,
  displaceZoneGeometry() {},
  markTerrainEdgeId() {},
  terrainCategoryFor: value => value,
  resolveTileMat: () => null,
  buildMergedWaterMesh(_scene, cells) {
    mergedCells = cells;
    return { geometry: { computeVertexNormals() {} }, userData: {} };
  },
});

const zoneScene = { // Owns the persistent waterfall sheet exactly like the real wilderness zone scene does.
  children: [],
  add(object) { object.parent = this; this.children.push(object); },
  remove(object) { this.children = this.children.filter(child => child !== object); object.parent = null; },
};
const grid = [[ // A one-tier waterfall drop exposes the old 0.45-unit bed-to-surface gap if the two systems ever diverge again.
  { type: TileType.WATERFALL, elevTier: 1 },
  { type: TileType.WATERFALL, elevTier: 0 },
]];

api.buildWaterfallCurtainMeshes(zoneScene, grid, 2, 1, 'surface_connector_test');
assert.strictEqual(zoneScene.children.length, 1, 'expected one persistent waterfall connector sheet');
const waterfall = zoneScene.children[0]; // Reads the real generated curtain vertex heights below.
const positions = waterfall.geometry.attributes.position.array; // The quad stores top/top/bottom/bottom vertices in this order.
const curtainY = [...new Set([positions[1], positions[4], positions[7], positions[10]].map(value => Number(value.toFixed(4))))].sort((a, b) => a - b); // Reduces the four vertices to the two visible endpoint heights.
assert.deepStrictEqual(curtainY, [-0.1, 2.4], 'waterfall curtain should meet the visible lower and upper water surfaces exactly');
assert.strictEqual(waterfall.userData.waterfallSurfaceHeightMode, 'merged-water-surface');
assert.strictEqual(window.__waterfallRenderStats.surface_connector_test.surfaceHeightMode, 'merged-water-surface');

api.buildZoneRiverWaterMeshes(zoneScene, grid, 2, 1, 'surface_connector_test');
assert.ok(mergedCells, 'expected merged horizontal water cells to be produced');
const horizontalY = mergedCells.map(cell => Number(cell.surfaceY.toFixed(4))).sort((a, b) => a - b); // Compares the horizontal surfaces against the curtain endpoints above.
assert.deepStrictEqual(horizontalY, curtainY, 'horizontal river/waterfall surfaces and the vertical connector must share identical endpoint heights');

console.log('Waterfall river-surface connector checks passed.');
