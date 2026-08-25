'use strict';

const assert = require('assert');
const fs = require('fs');

const game = fs.readFileSync('docs/game.js', 'utf8');
const index = fs.readFileSync('docs/index.html', 'utf8');
const grass = fs.readFileSync('docs/js/zone-grass-billboards.js', 'utf8');
const features = fs.readFileSync('docs/js/zone-terrain-features.js', 'utf8');
const climb = fs.readFileSync('docs/js/climb-system.js', 'utf8');

assert.ok(index.includes('js/wilderness-chunks.js?v=20260825chunks1'));
assert.ok(index.indexOf('js/wilderness-chunks.js') < index.indexOf('game.js?v=20260825chunks1'));
assert.ok(index.includes('id="wildernessChunkDebugBtn"'));
assert.ok(index.includes('id="wildernessChunkStatus"'));

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
