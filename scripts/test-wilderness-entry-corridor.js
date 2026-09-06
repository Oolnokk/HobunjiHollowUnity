'use strict';
const assert = require('assert');

require('../docs/js/wilderness-entry-corridor.js');
const EntryCorridor = globalThis.WildernessEntryCorridor;
assert(EntryCorridor, 'WildernessEntryCorridor export missing');

function makeWorkspace({ cloud = false } = {}) {
  const cols = 24, rows = 24;
  const tiles = {};
  // Mimic what the Map Editor export actually preserves: a giant contiguous
  // path slab near the entry, with no source-only borderEntryGate/designRole.
  for (let r = 0; r < 8; r++) {
    for (let c = 5; c <= 17; c++) {
      tiles[`${c},${r}`] = {
        type: 'path',
        crop: '',
        plateau: 'plat_generated_tier_2_23',
        ...(c === 11 && r === 2 ? { generatedObjectId: 'bad_blocker', generatedObjectType: 'undiggableBoulder' } : {}),
      };
    }
  }
  // After the giant slab, continue with a normal narrow road. The repair must
  // stop here rather than thinning the actual generated path network.
  for (let r = 8; r < 15; r++) {
    tiles[`11,${r}`] = { type: 'path', crop: '', plateau: 'plat_generated_tier_2_23' };
  }
  return {
    maps: [{
      id: 'map_generated_wilderness_root', cols, rows, tiles,
      transitions: [{ id: 'sp_generated_entry', label: 'Entry north', col: 11, row: 0 }],
      routes: [{ id: 'route_map_entry_marker', nodes: [[11, 0]] }],
      generatedFrom: {},
    }],
    ...(cloud ? { wildernessLabLiveRecipe: { zoneId: 'map_southern_cloud_forest' } } : {}),
  };
}

const ordinary = makeWorkspace();
const result = EntryCorridor.applyWorkspace(ordinary);
assert.equal(result.applied, true);
assert.equal(result.version, 3);
assert.equal(result.detector, 'wide-contiguous-exported-path-slab');
assert.equal(result.wideSlices, 8);
assert.equal(result.apronDepthTiles, 8);
assert.equal(result.widestDetectedPathTiles, 13);
assert.equal(result.roadWidthTiles, 3);
assert.equal(result.protectedWidthTiles, 5);
assert.equal(result.roadTiles, 24, '8 wide slices should retain exactly 3 road cells each');
assert.equal(result.shoulderTiles, 16, '8 wide slices should retain exactly one grass shoulder per side');
assert(result.reclaimedTiles > 0, 'wide exported path slab should be reclaimed');
assert(result.blockersCleared > 0, 'blocker on protected road should be stripped');

const root = ordinary.maps[0];
for (let r = 0; r < 8; r++) {
  for (let c = 5; c <= 17; c++) {
    const tile = root.tiles[`${c},${r}`];
    const lateral = Math.abs(c - 11);
    if (lateral <= 1) {
      assert.equal(tile.type, 'path');
      assert.equal(tile.entryCorridorProtected, true);
      assert.equal(tile.generatedObjectType, undefined);
      assert.equal(tile.plateau, 'plat_generated_tier_2_23', 'repair must preserve plateau elevation metadata');
    } else if (lateral === 2) {
      assert.equal(tile.type, 'grass');
      assert.equal(tile.entryCorridorShoulder, true);
      assert.equal(tile.generatedObjectType, undefined);
      assert.equal(tile.plateau, 'plat_generated_tier_2_23');
    } else {
      assert.equal(tile.type, 'grass');
      assert.equal(tile.entryCorridorProtected, false);
      assert.equal(tile.entryCorridorReclaimed, true);
      assert.equal(tile.plateau, 'plat_generated_tier_2_23');
    }
  }
}
for (let r = 8; r < 15; r++) {
  assert.equal(root.tiles[`11,${r}`].type, 'path', 'ordinary narrow path after slab must remain untouched');
}

const cloud = makeWorkspace({ cloud: true });
const cloudResult = EntryCorridor.applyWorkspace(cloud, { zoneId: 'map_southern_cloud_forest' });
assert.equal(cloudResult.version, 3);
assert(cloudResult.cloudForestBackfillTrees > 0, 'Cloud Forest should repopulate reclaimed slab with trees');
const backfilled = Object.entries(cloud.maps[0].tiles).filter(([, tile]) => tile.generatedObjectType === 'copse');
assert(backfilled.length > 0);
for (const [key, tile] of backfilled) {
  const [c, r] = key.split(',').map(Number);
  assert(r < 8, 'tree backfill must stay inside reclaimed wide slab');
  assert(Math.abs(c - 11) > 2, 'trees must remain outside 3-wide road + one-tile shoulders');
  assert.equal(tile.type, 'shrub');
  assert.equal(tile.plateau, 'plat_generated_tier_2_23');
}

console.log('PASS wilderness entry corridor V3', {
  ordinary: result,
  cloudTrees: cloudResult.cloudForestBackfillTrees,
});
