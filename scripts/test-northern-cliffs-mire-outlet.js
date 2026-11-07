#!/usr/bin/env node
'use strict';

// Regression coverage for the Northern Cliffs' geographic drainage into the Eastern Mire.
const assert = require('node:assert/strict');
const generator = require('../docs/js/wilderness-map-generator.js');

const compact = { // Shared generator uses the real Northern Cliffs biome settings, with fewer props for quick seeded tests.
  ...generator.defaultSettings(),
  ...generator.zoneSettings('map_northern_cliffs'),
  width: 56, height: 56, plateaus: 14, maxTier: 8, ramps: 0,
  rivers: 2, ponds: 2, plateauPonds: 2, plateauStreams: 2,
  animalDens: 0, rootTotems: 0, prey: 0, packPredators: 0, ambushPredators: 0,
  omnivores: 0, structures: 0, caves: 0, statues: 0, pillars: 0,
  trees: 0, logs: 0, bushes: 0, forage: 0, fruitBushes: 0,
  mushrooms: 0, beehives: 0, treasure: 0, ore: 0, boulders: 0,
};
const waterTypes = new Set(['river', 'stream', 'waterfall']); // Matches all possible runtime/export watercourse tiles at a carved mouth.

assert.equal(compact.riverOutlet, 'southeastToMire', 'Northern Cliffs owns the explicitly configured outlet');
assert.equal(generator.zoneSettings('map_eastern_mire').riverOutlet, undefined, 'Mire does not inherit the Cliffs outlet');
assert.equal(generator.defaultSettings().riverOutlet, null, 'unconfigured biomes retain random river borders');

for (const seed of ['mire-outlet-one', 'mire-outlet-two', 'mire-outlet-three']) {
  const workspace = generator.generateWorkspace(seed, compact); // Runs the actual generation/export pipeline, not a mocked river path.
  const root = workspace.maps.find(map => map && !map.isSubmap); // Exported root owns the complete playable edge.
  const outlet = workspace.waterwayOutlet; // Mobile-visible marker returned alongside the hydrology diagnostics.
  assert(root && outlet, `${seed}: exported river mouth exists`);
  assert.equal(outlet.destinationZoneId, 'map_eastern_mire', `${seed}: southeast water drains toward the Mire`);
  assert.equal(outlet.side, 'east', `${seed}: exit is on the eastern rim`);
  assert.equal(outlet.traversable, false, `${seed}: no premature player transition`);
  assert.equal(outlet.x, root.cols - 1, `${seed}: outlet reaches the actual exported map edge`);
  assert(outlet.y >= root.rows * 0.65 && outlet.y < root.rows * 0.9, `${seed}: outlet stays southeast, away from the southern entry canyon`);
  assert.equal(root.rivers.length, 2, `${seed}: both authored rivers remain present`);
  assert.equal(workspace.hydrologyReport.riverUpHillSteps, 0, `${seed}: drainage is still graded downhill`);

  for (const river of root.rivers) {
    assert.equal(river.outletZoneId, 'map_eastern_mire', `${seed}: ${river.id} carries its downstream geography`);
    assert.equal(river.outletSide, 'east', `${seed}: ${river.id} discharges east, not through the south entry`);
    const tail = river.nodes[river.nodes.length - 1]; // Last exported in-bounds river sample should approach the shared mouth.
    assert(tail && tail[0] > root.cols - 12 && Math.abs(tail[1] - outlet.y) < 12,
      `${seed}: ${river.id} approaches the southeast edge (${JSON.stringify(tail)})`);
  }

  for (let x = outlet.x - 12; x <= outlet.x; x++) {
    const tile = root.tiles?.[`${x},${outlet.y}`]; // Every column of the actual exported border-channel should contain connected water.
    assert(tile && waterTypes.has(tile.type), `${seed}: mouth is continuous through ${x},${outlet.y}`);
  }
  const edgeTile = root.tiles?.[`${outlet.x},${outlet.y}`]; // Physical water needs to survive export where the boundary cliff was cut.
  assert(edgeTile && waterTypes.has(edgeTile.type), `${seed}: the southeast border has visible river water`);
}

const ordinary = generator.generateWorkspace('ordinary-cliff-rivers', { ...compact, riverOutlet: null }); // Control case keeps the original multi-border river rules.
assert.equal(ordinary.waterwayOutlet, null, 'unconfigured river generation does not fabricate an outlet');
assert(ordinary.maps.find(map => !map.isSubmap).rivers.every(river => !river.outletZoneId),
  'other zones do not point their rivers toward the Mire');
console.log('PASS Northern Cliffs: seeded waterways share a continuous southeast Mire mouth, no traversal.');
