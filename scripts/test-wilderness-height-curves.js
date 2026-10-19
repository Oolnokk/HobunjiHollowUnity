'use strict';

const assert = require('node:assert/strict');
const Generator = require('../docs/js/wilderness-map-generator.js');

const reductions = { // Keep this deterministic regression light without changing the underlying plateau or boundary algorithms.
  width: 70, height: 70, plateaus: 36, ramps: 5,
  trees: 0, bushes: 0, logs: 0, ore: 0, boulders: 0,
  forage: 0, fruitBushes: 0, mushrooms: 0, prey: 0,
  packPredators: 0, ambushPredators: 0, animalDens: 0,
  structures: 0, caves: 0, rootTotems: 0, pathAnchors: 2
};

function inspectZone(zoneId, farSide) {
  const zone = Generator.zoneSettings(zoneId); // Gameplay's actual Tothal Shift settings, not lab-only copies.
  assert.equal(zone.heightCurves?.enabled, true, zoneId + ' must enable two-axis height profiles');
  assert.equal(zone.boundaryFarRise?.[farSide], 2, zoneId + ' far boundary rise should be two tiers');
  assert.equal(zone.heightCurves.eastWest.length, 13);
  assert.equal(zone.heightCurves.northSouth.length, 13);
  const workspace = Generator.generateWorkspace('height-curves-regression-' + zoneId, { ...zone, ...reductions }); // One small map per zone exercises real output.
  const root = workspace.maps.find(map => !map.isSubmap); // Raw exported mask, whose border metadata survives the Tothal import.
  assert(root && root.cols === 140 && root.rows === 140);
  const groups = new Map((workspace.plateauGroups || []).map(group => [group.id, group.elevation])); // Find each rendered plateau tier from the exact exported mask.
  const boundary = Object.values(root.tiles).filter(tile => tile.borderEscarpmentSide === farSide); // True cliff boundary, never distant backdrop.
  assert(boundary.length > 10, zoneId + ' far boundary must contain real cliff tiles');
  const boundaryTiers = boundary.map(tile => groups.get(tile.plateau)).filter(Number.isFinite); // Renderer plateau height resolved from group membership.
  assert(boundaryTiers.length > 4, zoneId + ' boundary must export tiered plateau geometry');
  assert(boundaryTiers.some(tier => tier === (zone.maxTier || Generator.defaultSettings().maxTier) + 2),
    zoneId + ' far cliffs must top out at highest playable tier + 2');

  function regionAverage(c0, c1, r0, r1) {
    let total = 0, count = 0;
    for (let row = r0; row < r1; row++) for (let col = c0; col < c1; col++) {
      const tile = root.tiles[col + ',' + row];
      if (!tile || tile.borderEscarpment || tile.distantBoundaryLandscape || !tile.plateau) continue;
      const tier = groups.get(tile.plateau);
      if (!Number.isFinite(tier)) continue;
      total += tier; count++;
    }
    assert(count > 20, zoneId + ' profile sampling must include raised, playable plateau terrain');
    return total / count;
  }

  return { workspace, root, groups, regionAverage, boundary:boundary.length };
}

const northern = inspectZone('map_northern_cliffs', 'north');
const western = inspectZone('map_western_slope', 'west');
const ncNorth = northern.regionAverage(25, 112, 20, 45); // Walkable northern quarter, excluding the boundary wall.
const ncSouth = northern.regionAverage(25, 112, 95, 120); // Corresponding southern quarter.
assert(ncNorth > ncSouth + 2, 'Northern Cliffs terrain must climb markedly northward: ' + ncNorth + ' vs ' + ncSouth);
const wsWest = western.regionAverage(20, 45, 25, 112); // Westward upper plateau quarter.
const wsEast = western.regionAverage(95, 120, 25, 112); // Eastward low plateau quarter.
assert(wsWest > wsEast + 4, 'Western Slope must climb steeply toward the west: ' + wsWest + ' vs ' + wsEast);
const westDistant = Object.values(western.root.tiles).filter(tile => tile.distantBoundaryLandscapeSide === 'north' || tile.distantBoundaryLandscapeSide === 'south');
assert(westDistant.length > 10, 'Western Slope north/south edges must retain distant scenery rather than full cliff walls');
assert.equal(Generator.defaultSettings().heightCurves, null, 'Legacy custom presets should not opt into drawn curves by default');
console.log('Wilderness height curves: northern ' + ncSouth.toFixed(1) + ' → ' + ncNorth.toFixed(1)
  + ', western ' + wsEast.toFixed(1) + ' → ' + wsWest.toFixed(1) + '; far cliff rises +2 tiers.');
