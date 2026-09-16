'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const game = fs.readFileSync('docs/game.js', 'utf8');
const index = fs.readFileSync('docs/index.html', 'utf8');
const grass = fs.readFileSync('docs/js/zone-grass-billboards.js', 'utf8');
const features = fs.readFileSync('docs/js/zone-terrain-features.js', 'utf8');
const climb = fs.readFileSync('docs/js/climb-system.js', 'utf8');
const zoneRegrowth = fs.readFileSync('docs/js/zone-regrowth.js', 'utf8'); // Runtime chunk-rebuild call site now lives here rather than inline in game.js.

assert.match(index, /js\/wilderness-chunks\.js\?v=[^"']+/);
assert.ok(index.indexOf('js/wilderness-chunks.js') < index.indexOf('src="game.js?v='));
assert.ok(index.includes('id="wildernessChunkDebugBtn"'));
assert.ok(index.includes('id="wildernessChunkStatus"'));
assert.match(index, /id="settingCloudForestCullRadius"[^>]+value="30"/);
assert.ok(index.includes('id="settingCloudForestResetDefaults"'));

assert.ok(game.includes('function buildZoneScene(mapId, focusCol = null, focusRow = null)'));
assert.ok(game.includes('window.WildernessChunks.createZone({'));
assert.ok(game.includes('window.WildernessChunks?.update(dt);'));
assert.ok(zoneRegrowth.includes('window.WildernessChunks.rebuildZone(mapId, col, row);'));
assert.ok(game.includes('member.wildernessChunkState = serializeWildernessChunkState();'));
assert.ok(game.includes('restoreWildernessChunkState(playerData.wildernessChunkState);'));
assert.ok(game.includes('recordWildernessChunkTileDelta(currentArea, col, row);'));
assert.ok(game.includes('applyWildernessChunkTileDeltas(mapId, zGrid)'));
assert.ok(game.includes('includeTiles: false'));
assert.ok(game.includes('includeGlobalPath: false'));
assert.ok(game.includes('mesh.isMesh && mesh.userData?.wildernessChunkOwnsGeometry'));
assert.ok(game.includes('window.TerrainJigsawUV?.bakeMesh?.(mesh)'));
assert.ok(game.includes('window.WildernessChunks?.destroyZone(mapId);'));
assert.ok(game.includes('removeBranchesInBounds(mapId, bounds)'));
assert.ok(game.includes('vegCullRadiusTiles: 30'));
assert.ok(game.includes("document.getElementById('settingCloudForestResetDefaults')"));

assert.ok(grass.includes('function buildZoneGrassBillboards(zScene, zGrid, zcols, zrows, zoneBaseElev = 0, bounds = null)'));
assert.ok(grass.includes('for (let row = range.rowStart; row < range.rowEnd; row++)'));
assert.ok(grass.includes('mesh.userData.wildernessChunkOwnsGeometry = true'));

for (const signature of [
  'buildZoneRampMeshes(zScene, zGrid, zcols, zrows, mapId, bounds = null)',
  'buildRampCurtainMeshes(zScene, zGrid, zcols, zrows, mapId, bounds = null)',
  'buildRockFormationMeshes(zScene, zGrid, zcols, zrows, mapId, bounds = null)',
  'buildWaterfallCurtainMeshes(zScene, zGrid, zcols, zrows, mapId, bounds = null)',
  'buildZoneRiverWaterMeshes(zScene, zGrid, zcols, zrows, mapId, bounds = null)',
]) {
  assert.ok(features.includes(signature), 'missing bounded feature builder: ' + signature);
}

// Execute the real waterfall builder with a minimal THREE shim. Two adjacent
// waterfall tiles at different tiers both visit their shared edge; the final
// persistent sheet must contain that curtain once, live on the zone scene
// rather than the streamed group, and retain ordinary view-frustum culling.
{
  class BufferGeometry {
    constructor() { this.attributes = {}; this.index = null; this.disposed = false; }
    setAttribute(name, attribute) { this.attributes[name] = attribute; }
    setIndex(index) { this.index = index; }
    computeVertexNormals() {}
    computeBoundingSphere() {}
    dispose() { this.disposed = true; }
  }
  class Attribute {
    constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; }
  }
  class DataTexture {
    constructor() { this.needsUpdate = false; this.disposed = false; }
    dispose() { this.disposed = true; }
  }
  class Color { constructor(value) { this.value = value; } }
  class ShaderMaterial {
    constructor(options) { Object.assign(this, options); this.needsUpdate = false; }
  }
  class TextureLoader {
    load(url) { this.url = url; }
  }
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material;
      this.userData = {};
      this.parent = null;
      this.frustumCulled = true;
    }
  }
  const THREE = {
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
    FrontSide: 'front',
    Mesh,
  };
  const window = { MergedWaterRenderer: { DEFAULT_TEXTURE_TILE_SIZE: 4 } };
  vm.runInNewContext(features, { window, THREE, console, Uint8Array, Uint16Array, Uint32Array, Math, performance: { now: () => 0 } });
  const api = window.ZoneTerrainFeatures;
  const TileType = { WATERFALL: 'waterfall', RIVER: 'river', STREAM: 'stream', RAMP: 'ramp', PATH: 'path', GRASS: 'grass', ROCK: 'rock' };
  api.init({
    TileType,
    RIVER_TOP: 0.4,
    NORMAL_TOP: 0.5,
    PLATEAU_UNIT: 1,
    displaceZoneGeometry() {},
    markTerrainEdgeId() {},
    terrainCategoryFor: value => value,
    resolveTileMat: () => null,
    buildMergedWaterMesh: () => null,
  });
  const zoneScene = {
    children: [],
    add(object) { object.parent = this; this.children.push(object); },
    remove(object) { this.children = this.children.filter(child => child !== object); object.parent = null; },
  };
  const streamedGroup = { parent: zoneScene };
  const grid = [[
    { type: TileType.WATERFALL, elevTier: 1 },
    { type: TileType.WATERFALL, elevTier: 0 },
  ]];
  const bounds = { colStart: 0, rowStart: 0, colEnd: 2, rowEnd: 1 };

  const firstChunkResult = api.buildWaterfallCurtainMeshes(streamedGroup, grid, 2, 1, 'test_waterfall_zone', bounds);
  assert.strictEqual(firstChunkResult.length, 0, 'streamed chunk must not own the persistent waterfall mesh');
  assert.strictEqual(zoneScene.children.length, 1, 'one persistent waterfall mesh should be attached to the zone scene');
  const waterfallMesh = zoneScene.children[0];
  assert.strictEqual(waterfallMesh.parent, zoneScene, 'waterfall mesh should survive streamed group unloads');
  assert.strictEqual(waterfallMesh.geometry.index.array.length, 6, 'shared waterfall edge should emit one quad, not two overlapping quads');
  assert.strictEqual(waterfallMesh.userData.waterfallCurtainCount, 1);
  assert.strictEqual(waterfallMesh.userData.waterfallDuplicateEdgesSkipped, 1);
  assert.strictEqual(waterfallMesh.frustumCulled, true, 'persistence must not disable normal offscreen frustum culling');

  const repeatedChunkResult = api.buildWaterfallCurtainMeshes(streamedGroup, grid, 2, 1, 'test_waterfall_zone', bounds);
  assert.strictEqual(repeatedChunkResult.length, 0, 'later chunk builds should reuse the persistent waterfall sheet');
  assert.strictEqual(zoneScene.children.length, 1, 'later chunk builds must not add duplicate persistent waterfall meshes');
  assert.strictEqual(window.__waterfallRenderStats.test_waterfall_zone.curtains, 1);
  assert.strictEqual(window.__waterfallRenderStats.test_waterfall_zone.duplicateEdgesSkipped, 1);
}

assert.ok(climb.includes('function removeBranchesInBounds(mapId, bounds)'));
assert.ok(climb.includes('removeBranchesInBounds,'));

console.log('Wilderness chunk integration checks passed.');
