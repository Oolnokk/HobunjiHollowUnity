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
assert.equal(result.version, 2);
assert.equal(result.apronDepthTiles, 8);
assert.equal(result.roadWidthTiles, 3);
assert.equal(result.protectedWidthTiles, 5);
assert.equal(result.roadTiles, 24, '8-deep gate should retain exactly 3 path tiles per slice');
assert.equal(result.shoulderTiles, 16, '8-deep gate should retain exactly one grass shoulder per side');
assert(result.reclaimedTiles > 0, 'oversized road apron should be reclaimed as grass');
assert(result.blockersCleared > 0, 'blocker inside protected path should be stripped');

const root = ordinary.maps[0];
for (let r = 0; r < 8; r++) {
  for (let c = 4; c <= 14; c++) {
    const tile = root.tiles[`${c},${r}`];
    const lateral = Math.abs(c - 9);
    if (lateral <= 1) {
      assert.equal(tile.type, 'path');
      assert.equal(tile.entryCorridorProtected, true);
      assert.equal(tile.borderEntryGate, true, 'only the actual 3-wide road keeps gate semantics');
      assert.equal(tile.generatedObjectType, undefined);
    } else if (lateral === 2) {
      assert.equal(tile.type, 'grass');
      assert.equal(tile.entryCorridorShoulder, true);
      assert.equal(tile.borderEntryGate, undefined, 'safety shoulder must be ordinary grass');
      assert.equal(tile.generatedObjectType, undefined);
    } else {
      assert.equal(tile.type, 'grass');
      assert.equal(tile.entryCorridorProtected, false);
      assert.equal(tile.borderEntryGate, undefined, 'reclaimed apron must be ordinary terrain, not a hidden gate');
    }
  }
}

const cloud = makeWorkspace({ cloud: true });
const cloudResult = EntryCorridor.applyWorkspace(cloud, { zoneId: 'map_southern_cloud_forest' });
assert.equal(cloudResult.version, 2);
assert(cloudResult.cloudForestBackfillTrees > 0, 'Cloud Forest should repopulate the reclaimed apron with trees');
const cloudRoot = cloud.maps[0];
const backfilled = Object.entries(cloudRoot.tiles).filter(([, tile]) => tile.generatedObjectType === 'copse');
assert(backfilled.length > 0);
for (const [key, tile] of backfilled) {
  const [c] = key.split(',').map(Number);
  assert(Math.abs(c - 9) > 2, 'backfilled trees must remain outside the 3-wide road + one-tile shoulders');
  assert.equal(tile.type, 'shrub');
  assert.equal(tile.borderEntryGate, undefined);
}

console.log('PASS wilderness entry corridor V2', {
  ordinary: result,
  cloudTrees: cloudResult.cloudForestBackfillTrees,
});
