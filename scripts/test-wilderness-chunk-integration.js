'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const game = fs.readFileSync('docs/game.js', 'utf8');
const index = fs.readFileSync('docs/index.html', 'utf8');
const chunks = fs.readFileSync('docs/js/wilderness-chunks.js', 'utf8');
const borderTerrain = fs.readFileSync('docs/js/border-terrain.js', 'utf8');
const grass = fs.readFileSync('docs/js/zone-grass-billboards.js', 'utf8');
const features = fs.readFileSync('docs/js/zone-terrain-features.js', 'utf8');
const climb = fs.readFileSync('docs/js/climb-system.js', 'utf8');

assert.match(index, /js\/wilderness-chunks\.js\?v=[^"']+/);
assert.ok(index.indexOf('js/wilderness-chunks.js') < index.indexOf('src="game.js?v='));
assert.ok(index.includes('id="wildernessChunkDebugBtn"'));
assert.ok(index.includes('id="wildernessChunkStatus"'));
assert.match(index, /id="settingCloudForestCullRadius"[^>]+value="30"/);
assert.ok(index.includes('id="settingCloudForestResetDefaults"'));

assert.ok(game.includes('function buildZoneScene(mapId, focusCol = null, focusRow = null)'));
assert.ok(game.includes('window.WildernessChunks.createZone({'));
assert.ok(game.includes('window.WildernessChunks?.update(dt);'));
assert.ok(game.includes('window.WildernessChunks.rebuildZone(mapId, col, row);'));
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

// Every ordinary zone build still receives the generic outer border terrain.
// Cloud Forest keeps its explicit north-edge exception below instead of
// weakening the shared border call for every wilderness map.
assert.ok(game.includes('window.BorderTerrain.buildZoneBorderTerrain(zScene, ZCOLS, ZROWS, mapId, 0, zGrid);'));
assert.ok(borderTerrain.includes("const CLOUD_ID = 'map_southern_cloud_forest';"));
assert.ok(borderTerrain.includes('zoneMapId === CLOUD_ID ? removeCloudForestNorthBoundaryCliffs(workspace) : workspace'));
assert.ok(borderTerrain.includes('northBoundaryCliffsRemoved: true'));

assert.ok(chunks.includes('const DEFAULT_CHUNK_TILES = 16;'));
assert.ok(chunks.includes('this.chunkTiles = normalizeChunkTiles(requestedChunkTiles);'));
assert.ok(chunks.includes('Math.ceil(this.cols / this.chunkTiles)'));
assert.ok(chunks.includes('Math.ceil(this.rows / this.chunkTiles)'));
assert.ok(chunks.includes('tileToChunk(col, this.chunkTiles)'));
assert.ok(chunks.includes('tileToChunk(row, this.chunkTiles)'));
assert.ok(chunks.includes('chunkTiles: this.chunkTiles'));
assert.ok(!chunks.includes('cx * CHUNK_TILES'));
assert.ok(!chunks.includes('cz * CHUNK_TILES'));

// Execute the real chunk module with lightweight browser stubs. These two
// controllers coexist with different dimensions, proving chunk size is now
// zone-owned rather than a process-wide constant.
const sandbox = {
  window: {},
  document: { getElementById: () => null },
  performance: { now: () => 0 },
  console,
};
vm.runInNewContext(chunks, sandbox, { filename: 'wilderness-chunks.js' });
const chunkApi = sandbox.window.WildernessChunks;
const sceneStub = { add() {}, remove() {} };
const tenTileZone = chunkApi.createZone({
  mapId: 'test_zone_ten', scene: sceneStub, cols: 41, rows: 35,
  chunkTiles: 10, buildChunk: () => ({}),
});
const sevenTileZone = chunkApi.createZone({
  mapId: 'test_zone_seven', scene: sceneStub, cols: 41, rows: 35,
  chunkSize: 7, buildChunk: () => ({}),
});
const defaultZone = chunkApi.createZone({
  mapId: 'test_zone_default', scene: sceneStub, cols: 41, rows: 35,
  buildChunk: () => ({}),
});
assert.strictEqual(tenTileZone.snapshot().chunkTiles, 10);
assert.strictEqual(sevenTileZone.snapshot().chunkTiles, 7);
assert.strictEqual(defaultZone.snapshot().chunkTiles, 16);
assert.deepStrictEqual(
  { ...tenTileZone.boundsFor(2, 3) },
  { colStart: 20, rowStart: 30, colEnd: 30, rowEnd: 35 }
);
assert.deepStrictEqual(
  { ...sevenTileZone.boundsFor(5, 4) },
  { colStart: 35, rowStart: 28, colEnd: 41, rowEnd: 35 }
);

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

assert.ok(climb.includes('function removeBranchesInBounds(mapId, bounds)'));
assert.ok(climb.includes('removeBranchesInBounds,'));

console.log('Wilderness chunk integration checks passed.');
