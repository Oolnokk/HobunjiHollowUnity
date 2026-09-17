'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('docs/js/zone-terrain-features.js', 'utf8'); // Executes the production waterfall/river builders below instead of duplicating their height math in the test.
const waterSystemSource = fs.readFileSync('docs/js/water-system.js', 'utf8'); // Verifies zone-supplied render options override WaterSystem's default merged-water options.

assert.match(source, /const WATER_SURFACE_RENDER_OFFSET = 0\.015/, 'zone waterfall/river rendering should own one shared final-surface Y offset');
assert.match(source, /function waterSurfaceY\(tile\)/, 'horizontal water should keep one shared base-surface height helper');
assert.match(source, /function renderedWaterSurfaceY\(tile\)/, 'waterfall curtains should use the final rendered water height, including the merged-water Y offset');
assert.match(source, /const selfY = renderedWaterSurfaceY\(t\)/, 'waterfall curtains should start from final rendered water height, not the sunken river bed');
assert.match(source, /surfaceY: waterSurfaceY\(tile\)/, 'merged horizontal water should use the shared base-surface helper');
assert.match(source, /yOffset: WATER_SURFACE_RENDER_OFFSET/, 'zone water mesh should explicitly receive the same render offset used by waterfall curtains');
assert.match(waterSystemSource, /yOffset:\s*0\.015,[\s\S]{0,160}\.\.\.options,/, 'WaterSystem must apply caller options after its default yOffset so the zone connector offset is authoritative');

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
let mergedCells = null; // Captures the horizontal river cells used below to calculate their final rendered Y values.
let mergedOptions = null; // Captures the zone-supplied yOffset that WaterSystem forwards to MergedWaterRenderer.
api.init({
  TileType,
  RIVER_TOP: -0.55,
  NORMAL_TOP: 0,
  PLATEAU_UNIT: 2.5,
  displaceZoneGeometry() {},
  markTerrainEdgeId() {},
  terrainCategoryFor: value => value,
  resolveTileMat: () => null,
  buildMergedWaterMesh(_scene, cells, options) {
    mergedCells = cells;
    mergedOptions = options;
    return { geometry: { computeVertexNormals() {} }, userData: {} };
  },
});

function makeScene() {
  return {
    children: [],
    add(object) { object.parent = this; this.children.push(object); },
    remove(object) { this.children = this.children.filter(child => child !== object); object.parent = null; },
  };
}

function curtainEndpointYs(mesh) {
  const positions = mesh.geometry.attributes.position.array; // Each emitted curtain quad stores top/top/bottom/bottom vertices in this order.
  return [...new Set([positions[1], positions[4], positions[7], positions[10]].map(value => Number(value.toFixed(4))))].sort((a, b) => a - b);
}

function finalHorizontalYs() {
  assert.ok(mergedCells, 'expected merged horizontal water cells to be produced');
  assert.ok(mergedOptions, 'expected merged horizontal water options to be produced');
  assert.strictEqual(mergedOptions.yOffset, 0.015, 'zone water should pin the same final-render offset used by waterfall curtains');
  return mergedCells.map(cell => Number((cell.surfaceY + mergedOptions.yOffset).toFixed(4))).sort((a, b) => a - b);
}

// River -> waterfall is the exact seam visible in game: a deep-water river on
// the upper tier meets a deep-water waterfall cell one plateau tier below.
{
  mergedCells = null;
  mergedOptions = null;
  const zoneScene = makeScene();
  const grid = [[
    { type: TileType.RIVER, elevTier: 1 },
    { type: TileType.WATERFALL, elevTier: 0 },
  ]];

  api.buildWaterfallCurtainMeshes(zoneScene, grid, 2, 1, 'river_surface_connector_test');
  assert.strictEqual(zoneScene.children.length, 1, 'expected one persistent river-to-waterfall connector sheet');
  const waterfall = zoneScene.children[0];
  const curtainY = curtainEndpointYs(waterfall);
  assert.deepStrictEqual(curtainY, [-0.085, 2.415], 'river-to-waterfall curtain should meet the final rendered lower and upper water surfaces exactly');
  assert.strictEqual(waterfall.userData.waterfallSurfaceHeightMode, 'merged-water-surface');
  assert.strictEqual(waterfall.userData.waterfallSurfaceYOffset, 0.015);
  assert.strictEqual(window.__waterfallRenderStats.river_surface_connector_test.surfaceYOffset, 0.015);

  api.buildZoneRiverWaterMeshes(zoneScene, grid, 2, 1, 'river_surface_connector_test');
  assert.deepStrictEqual(finalHorizontalYs(), curtainY, 'river horizontal surface and waterfall curtain must share identical final rendered endpoint heights');
}

// Streams sit 0.05 higher than deep river/waterfall water before the common
// render offset. Keep that authored distinction while still closing the seam.
{
  mergedCells = null;
  mergedOptions = null;
  const zoneScene = makeScene();
  const grid = [[
    { type: TileType.STREAM, elevTier: 1 },
    { type: TileType.WATERFALL, elevTier: 0 },
  ]];

  api.buildWaterfallCurtainMeshes(zoneScene, grid, 2, 1, 'stream_surface_connector_test');
  assert.strictEqual(zoneScene.children.length, 1, 'expected one persistent stream-to-waterfall connector sheet');
  const curtainY = curtainEndpointYs(zoneScene.children[0]);
  assert.deepStrictEqual(curtainY, [-0.085, 2.465], 'stream-to-waterfall curtain should preserve the stream surface offset and still meet both final surfaces');

  api.buildZoneRiverWaterMeshes(zoneScene, grid, 2, 1, 'stream_surface_connector_test');
  assert.deepStrictEqual(finalHorizontalYs(), curtainY, 'stream horizontal surface and waterfall curtain must share identical final rendered endpoint heights');
}

console.log('Waterfall river-surface connector checks passed.');
