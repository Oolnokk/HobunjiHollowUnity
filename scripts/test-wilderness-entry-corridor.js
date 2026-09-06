'use strict';
const assert = require('assert');

require('../docs/js/wilderness-entry-corridor.js');
const EntryCorridor = globalThis.WildernessEntryCorridor;
assert(EntryCorridor, 'WildernessEntryCorridor export missing');

function put(tiles, c, r, extra = {}) {
  tiles[`${c},${r}`] = {
    type: 'path',
    crop: '',
    plateau: 'plat_generated_tier_2_23',
    ...extra,
  };
}

function makeWorkspace({ cloud = false } = {}) {
  const cols = 40, rows = 48;
  const tiles = {};

  // The actual Cloud Forest failure shape: the literal entrance is already
  // narrow, so a detector that gives up after a couple of narrow slices never
  // reaches the Great Basin high-entry road farther inward.
  for (let r = 0; r < 10; r++) {
    for (let c = 19; c <= 21; c++) put(tiles, c, r);
  }

  // A small ordinary gap/connector before the high-entry brush begins.
  for (let r = 10; r < 14; r++) put(tiles, 20, r);

  // Delayed radius-brushed causeway. Its center drifts right as it heads for
  // the selected high plateau, exercising the slice-following logic too.
  for (let r = 14; r < 30; r++) {
    const center = 20 + Math.floor((r - 14) / 6); // 20 -> 22 slowly.
    for (let c = center - 6; c <= center + 6; c++) {
      put(tiles, c, r, c === center && r === 18
        ? { generatedObjectId: 'bad_blocker', generatedObjectType: 'undiggableBoulder' }
        : {});
    }
  }

  // Ordinary narrow road resumes after the causeway and must stay untouched.
  for (let r = 30; r < 38; r++) put(tiles, 22, r);

  return {
    maps: [{
      id: 'map_generated_wilderness_root', cols, rows, tiles,
      transitions: [{ id: 'sp_generated_entry', label: 'Entry north', col: 20, row: 0 }],
      routes: [{ id: 'route_map_entry_marker', nodes: [[20, 0]] }],
      generatedFrom: {},
    }],
    ...(cloud ? { wildernessLabLiveRecipe: { zoneId: 'map_southern_cloud_forest' } } : {}),
  };
}

const ordinary = makeWorkspace();
const result = EntryCorridor.applyWorkspace(ordinary);
assert.equal(result.applied, true);
assert.equal(result.version, 4);
assert.equal(result.detector, 'delayed-following-wide-path-causeway');
assert.equal(result.firstWideSlice, 14, 'must scan past the narrow literal entry');
assert.equal(result.lastWideSlice, 29);
assert.equal(result.wideSlices, 16);
assert.equal(result.widestDetectedPathTiles, 13);
assert.equal(result.roadWidthTiles, 3);
assert.equal(result.protectedWidthTiles, 5);
assert.equal(result.roadTiles, 48, '16 wide slices should retain exactly 3 road cells each');
assert.equal(result.shoulderTiles, 32, '16 wide slices should retain exactly one grass shoulder per side');
assert(result.reclaimedTiles > 0, 'wide high-entry causeway should be reclaimed');
assert(result.blockersCleared > 0, 'blocker on protected centerline should be stripped');

const root = ordinary.maps[0];
for (let r = 0; r < 14; r++) {
  const existing = Object.entries(root.tiles).filter(([key]) => Number(key.split(',')[1]) === r);
  for (const [, tile] of existing) {
    assert.equal(tile.type, 'path', 'narrow literal entrance/connector must remain untouched');
    assert.equal(tile.entryCorridorReclaimed, undefined);
  }
}

for (let r = 14; r < 30; r++) {
  const center = 20 + Math.floor((r - 14) / 6);
  for (let c = center - 6; c <= center + 6; c++) {
    const tile = root.tiles[`${c},${r}`];
    const lateral = Math.abs(c - center);
    if (lateral <= 1) {
      assert.equal(tile.type, 'path');
      assert.equal(tile.entryCausewayCenterline, true);
      assert.equal(tile.entryCorridorProtected, true);
      assert.equal(tile.generatedObjectType, undefined);
    } else if (lateral === 2) {
      assert.equal(tile.type, 'grass');
      assert.equal(tile.entryCorridorShoulder, true);
      assert.equal(tile.generatedObjectType, undefined);
    } else {
      assert.equal(tile.type, 'grass');
      assert.equal(tile.entryCorridorReclaimed, true);
    }
    assert.equal(tile.plateau, 'plat_generated_tier_2_23', 'repair must preserve plateau elevation metadata');
  }
}

for (let r = 30; r < 38; r++) {
  assert.equal(root.tiles[`22,${r}`].type, 'path', 'ordinary narrow road after causeway must remain untouched');
}

const cloud = makeWorkspace({ cloud: true });
const cloudResult = EntryCorridor.applyWorkspace(cloud, { zoneId: 'map_southern_cloud_forest' });
assert.equal(cloudResult.version, 4);
assert(cloudResult.cloudForestBackfillTrees > 0, 'Cloud Forest should repopulate reclaimed causeway edges with trees');
const backfilled = Object.entries(cloud.maps[0].tiles).filter(([, tile]) => tile.generatedObjectType === 'copse');
assert(backfilled.length > 0);
for (const [key, tile] of backfilled) {
  const [c, r] = key.split(',').map(Number);
  assert(r >= 14 && r < 30, 'tree backfill must stay inside reclaimed causeway slices');
  const center = 20 + Math.floor((r - 14) / 6);
  assert(Math.abs(c - center) > 2, 'trees must remain outside 3-wide road + one-tile shoulders');
  assert.equal(tile.type, 'shrub');
  assert.equal(tile.plateau, 'plat_generated_tier_2_23');
}

console.log('PASS wilderness entry corridor V4', {
  ordinary: result,
  cloudTrees: cloudResult.cloudForestBackfillTrees,
});
