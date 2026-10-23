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
  assert.equal(c & 1, 0, 'reclaimed trees must align to the generator\'s 2x-scaled source lattice');
  assert.equal(r & 1, 0, 'reclaimed trees must align to the generator\'s 2x-scaled source lattice');
  assert(EntryCorridor.cloudForestTreePosition(c, r), 'reclaimed tree must survive normal Cloud Forest thinning');
}

// Density regression: the old checkerboard converted 50% of reclaimed tiles
// into trees. Normal Cloud Forest saturation occupies one of four final tiles
// BEFORE the 20% thinning and 1/6 variety replacement: ~1/6 after both.
const cols = 96, rows = 100, bigTiles = {};
for (let r = 0; r < 10; r++) for (let c = 47; c <= 49; c++) put(bigTiles, c, r);
for (let r = 10; r < 14; r++) put(bigTiles, 48, r);
for (let r = 14; r < 78; r++) for (let c = 37; c <= 59; c++) put(bigTiles, c, r);
const big = {
  maps: [{ id:'large_cloud_wilderness_root', cols, rows, tiles:bigTiles,
    transitions:[{ id:'sp_generated_entry', label:'Entry north', col:48, row:0 }],
    generatedFrom:{} }],
};
const bigReport = EntryCorridor.applyWorkspace(big, { zoneId:EntryCorridor.CLOUD_ID });
assert.equal(bigReport.applied, true, 'large cloud-entry fixture must find delayed wide causeway');
assert.equal(bigReport.wideSlices, 64);
const candidates = [], actual = [];
for (let r = 14; r < 78; r++) for (let c = 37; c <= 59; c++) {
  if (Math.abs(c - 48) <= 2) continue; // The three-tile road and one-tile shoulders remain treeless.
  const tile = bigTiles[c + ',' + r];
  if ((c & 1) === 0 && (r & 1) === 0) candidates.push([c,r]);
  if (tile.generatedObjectType === 'copse') actual.push([c,r]);
}
const actualLatticeFraction = actual.length / candidates.length;
assert(Math.abs(actualLatticeFraction - EntryCorridor.CLOUD_FOREST_TREE_KEEP) < 0.08,
  'causeway backfill must match normal survivor density, not 50% checkerboard: '
    + actual.length + '/' + candidates.length);
assert(actual.length < 220, 'backfill must be substantially sparser than the previous checkerboard');
assert(actual.every(([c,r]) => ((c & 1) === 0 && (r & 1) === 0)),
  'all backfill must respect two-dimensional tree spacing');
const normalSample = Array.from({length:64},(_,r) => Array.from({length:64},(_,c) =>
  EntryCorridor.cloudForestTreePosition(c,r) ? 1 : 0).reduce((a,b) => a+b,0)).reduce((a,b) => a+b,0);
assert(Math.abs(normalSample / (64*64) - (1/6)) < 0.025,
  'tree chooser must average near 1/6 of ordinary final-world cells over a full plot');

console.log('PASS wilderness entry corridor V4', {
  ordinary: result,
  cloudTrees: cloudResult.cloudForestBackfillTrees,
});
