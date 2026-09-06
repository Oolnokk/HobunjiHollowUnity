'use strict';
const assert = require('assert');

require('../docs/js/wilderness-entry-corridor.js');
const EntryCorridor = globalThis.WildernessEntryCorridor;
assert(EntryCorridor, 'WildernessEntryCorridor export missing');

function makeWorkspace({ cloud = false } = {}) {
  const cols = 20, rows = 20;
  const tiles = {};
  for (let r = 0; r < 8; r++) {
    for (let c = 4; c <= 14; c++) {
      tiles[`${c},${r}`] = {
        type: 'path',
        borderEntryGate: true,
        ...(c === 9 && r === 2 ? { generatedObjectId: 'bad_blocker', generatedObjectType: 'undiggableBoulder' } : {}),
      };
    }
  }
  return {
    maps: [{
      id: 'map_generated_wilderness_root', cols, rows, tiles,
      transitions: [{ id: 'sp_generated_entry', label: 'Entry north', col: 9, row: 0 }],
      routes: [{ id: 'route_map_entry_marker', nodes: [[9, 0]] }],
      generatedFrom: {},
    }],
    ...(cloud ? { wildernessLabLiveRecipe: { zoneId: 'map_southern_cloud_forest' } } : {}),
  };
}

const ordinary = makeWorkspace();
const result = EntryCorridor.applyWorkspace(ordinary);
assert.equal(result.applied, true);
assert.equal(result.version, 3);
assert.equal(result.apronDepthTiles, 8);
assert.equal(result.roadWidthTiles, 1);
assert.equal(result.protectedWidthTiles, 1);
assert.equal(result.shoulderTiles, 0);
assert.equal(result.roadTiles, 8, '8-deep gate should retain exactly one path tile per slice');
assert(result.reclaimedTiles > 0, 'oversized road apron should be reclaimed');
assert(result.blockersCleared > 0, 'blocker on the centerline should be stripped');

const root = ordinary.maps[0];
for (let r = 0; r < 8; r++) {
  for (let c = 4; c <= 14; c++) {
    const tile = root.tiles[`${c},${r}`];
    const lateral = Math.abs(c - 9);
    if (lateral === 0) {
      assert.equal(tile.type, 'path');
      assert.equal(tile.entryCorridorProtected, true);
      assert.equal(tile.borderEntryGate, true, 'only the one-tile centerline keeps gate semantics');
      assert.equal(tile.generatedObjectType, undefined);
    } else {
      assert.equal(tile.type, 'grass');
      assert.equal(tile.entryCorridorProtected, false);
      assert.equal(tile.entryCorridorShoulder, undefined);
      assert.equal(tile.borderEntryGate, undefined, 'everything beside the road must be ordinary terrain');
    }
  }
}

const cloud = makeWorkspace({ cloud: true });
const cloudResult = EntryCorridor.applyWorkspace(cloud, { zoneId: 'map_southern_cloud_forest' });
assert.equal(cloudResult.version, 3);
assert(cloudResult.cloudForestBackfillTrees > 0, 'Cloud Forest should repopulate the reclaimed apron with trees');
const cloudRoot = cloud.maps[0];
const backfilled = Object.entries(cloudRoot.tiles).filter(([, tile]) => tile.generatedObjectType === 'copse');
assert(backfilled.length > 0);
for (const [key, tile] of backfilled) {
  const [c] = key.split(',').map(Number);
  assert.notEqual(c, 9, 'backfilled trees must stay off only the one-tile road centerline');
  assert.equal(tile.type, 'shrub');
  assert.equal(tile.borderEntryGate, undefined);
}
assert(backfilled.some(([key]) => Math.abs(Number(key.split(',')[0]) - 9) === 1), 'Cloud Forest trees should be allowed immediately adjacent to the road');

console.log('PASS wilderness entry corridor V3', {
  ordinary: result,
  cloudTrees: cloudResult.cloudForestBackfillTrees,
});
