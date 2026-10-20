'use strict';

const assert = require('node:assert/strict');
const Generator = require('../docs/js/wilderness-map-generator.js');

const reductions = { // Keep the comparison deterministic and cheap while exercising real geometry exports.
  width: 70, height: 70, plateaus: 36, ramps: 5,
  trees: 0, bushes: 0, logs: 0, ore: 0, boulders: 0,
  forage: 0, fruitBushes: 0, mushrooms: 0, prey: 0,
  packPredators: 0, ambushPredators: 0, animalDens: 0,
  structures: 0, caves: 0, rootTotems: 0, pathAnchors: 2
};

function inspectZone(zoneId, overrides = {}) {
  const zone = Generator.zoneSettings(zoneId);
  assert.equal(zone.heightCurves?.enabled, true, zoneId + ' should use the two-axis height editor');
  assert.equal(zone.heightCurves.eastWest.length, 13);
  assert.equal(zone.heightCurves.northSouth.length, 13);
  const workspace = Generator.generateWorkspace('height-curves-regression-' + zoneId, { ...zone, ...reductions, ...overrides });
  const root = workspace.maps.find(map => !map.isSubmap);
  assert(root && root.cols === 140 && root.rows === 140);
  const groups = new Map((workspace.plateauGroups || []).map(group => [group.id, group.elevation]));

  function tierAt(tile) { return tile ? groups.get(tile.plateau) : undefined; }
  function wall(side) {
    const tiles = Object.values(root.tiles).filter(tile => tile.borderEscarpmentSide === side && tile.borderEscarpment);
    assert(tiles.length > 10, zoneId + ' must retain real ' + side + ' boundary cliffs');
    const tiers = tiles.map(tierAt).filter(Number.isFinite);
    assert(tiers.length > 4, side + ' boundary needs real exported plateau tiers');
    return { tiles: tiles.length, crest: Math.max(...tiers) };
  }
  function playableTop() {
    return Math.max(...Object.values(root.tiles)
      .filter(tile => !tile.borderEscarpment && !tile.distantBoundaryLandscape && tile.plateau)
      .map(tierAt).filter(Number.isFinite));
  }
  function average(c0, c1, r0, r1) {
    let total = 0, count = 0;
    for (let row = r0; row < r1; row++) for (let col = c0; col < c1; col++) {
      const tile = root.tiles[col + ',' + row];
      if (!tile || tile.borderEscarpment || tile.distantBoundaryLandscape || !tile.plateau) continue;
      const tier = tierAt(tile);
      if (!Number.isFinite(tier)) continue;
      total += tier; count++;
    }
    assert(count > 20, zoneId + ' sample requires raised, playable plateau terrain');
    return total / count;
  }
  return { root, zone, wall, playableTop, average };
}

const northern = inspectZone('map_northern_cliffs');
const unlifted = inspectZone('map_northern_cliffs', { plateauLiftToNorthWallGap: null }); // Same seed; original cliffs, old-height shelves.
const western = inspectZone('map_western_slope');

assert.equal(northern.zone.plateauLiftToNorthWallGap, 2, 'plateaus, not cliffs, must approach the old second-tier gap');
assert.equal(northern.zone.boundaryCliffBoost, 5, 'restore the original high perimeter cliff boost');
assert.equal(northern.zone.boundaryFarRise, undefined, 'do not replace the original north cliff with a short custom wall');
assert.equal(northern.zone.boundaryLocalRise, undefined, 'do not shorten the original east, west, or south walls');
for (const side of ['north', 'east', 'west']) {
  assert.equal(northern.wall(side).crest, unlifted.wall(side).crest,
    side + ' boundary wall crest must remain exactly the same with or without plateau lift');
}
const originalCrest = unlifted.wall('north').crest;
const elevatedCrest = northern.playableTop();
assert(elevatedCrest > unlifted.playableTop() + 2,
  'the playable plateaus should be substantially taller than in the old version');
assert.equal(originalCrest - elevatedCrest, 2,
  'the highest playable plateau should sit exactly two tiers beneath the UNCHANGED north wall');

const ncNorth = northern.average(25, 112, 20, 45);
const ncSouth = northern.average(25, 112, 95, 120);
assert(ncNorth > ncSouth + 2, 'Northern Cliffs must still climb substantially toward north: ' + ncNorth + ' vs ' + ncSouth);

assert.equal(western.zone.boundaryFarRise?.west, 2, 'Western Slope should keep its west boundary policy');
const westTop = western.wall('west').crest;
assert(westTop > western.playableTop(), 'Western Slope west cliff must remain above the playable area');
const wsWest = western.average(20, 45, 25, 112);
const wsEast = western.average(95, 120, 25, 112);
assert(wsWest > wsEast + 4, 'Western Slope must rise steeply westward: ' + wsWest + ' vs ' + wsEast);
const westDistant = Object.values(western.root.tiles).filter(tile =>
  tile.distantBoundaryLandscapeSide === 'north' || tile.distantBoundaryLandscapeSide === 'south');
assert(westDistant.length > 10, 'Western Slope north/south edges must retain distant backdrops');
assert.equal(Generator.defaultSettings().heightCurves, null, 'legacy presets should not enable height curves by default');

console.log('Wilderness height curves: Northern Cliffs unchanged wall tier ' + originalCrest
  + ', plateau max ' + unlifted.playableTop() + ' -> ' + elevatedCrest + ' (2-tier gap); '
  + 'north/south playable averages ' + ncNorth.toFixed(1) + '/' + ncSouth.toFixed(1)
  + '; Western Slope west/east ' + wsWest.toFixed(1) + '/' + wsEast.toFixed(1));
