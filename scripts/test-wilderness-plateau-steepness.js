#!/usr/bin/env node
'use strict';

// Regression: adjacent cliff tiers grow without rewriting the shallow biomes.
const assert = require('node:assert/strict');
const generator = require('../docs/js/wilderness-map-generator.js');
const cliffRoutes = require('../docs/js/cliff-route-network.js');
const terrainPreview = require('../docs/js/terrain-preview.js'); // Same workspace-to-runtime terrain merge used in editor regression tests.
const fs = require('node:fs'); // Read the lab control schema so exact-zone recipes cannot silently discard steepness.
const path = require('node:path'); // Resolve the shipped lab page independently of test working directory.
const BALCONY_GAP_TIERS = 3; // Three 2.5-unit tiers leave room for the balcony cap and embedded base.

const compact = { // Short deterministic generation while preserving the same plateau algorithms as full zones.
  ...generator.defaultSettings(), width: 42, height: 42, preset: 'cliffs',
  boundaryMode: 'followMapHeight', plateaus: 12, maxTier: 7, ramps: 0,
  rivers: 0, ponds: 0, plateauPonds: 0, plateauStreams: 0,
  animalDens: 0, rootTotems: 0, prey: 0, packPredators: 0, ambushPredators: 0,
  omnivores: 0, structures: 0, caves: 0, statues: 0, pillars: 0,
  trees: 0, logs: 0, bushes: 0, forage: 0, fruitBushes: 0,
  mushrooms: 0, beehives: 0, treasure: 0, ore: 0, boulders: 0,
};

function gapStats(workspace) {
  const root = workspace.maps.find(map => !map.isSubmap); // Root tiles own the plateau face masks.
  assert(root, 'exported root map exists');
  const elevations = new Map(workspace.plateauGroups.map(group => [group.id, group.elevation])); // Flat tier lookup for mask tiles.
  const tierAt = (x, y) => { // Used for edge comparisons with neighbors or unraised ground.
    const tile = root.tiles?.[`${x},${y}`];
    return tile?.plateau ? elevations.get(tile.plateau) || 0 : 0;
  };
  let edges = 0; // Number of different-height neighboring tile pairs.
  let totalGap = 0; // Sum of their tier differences.
  let balconyFriendly = 0; // Proxy count for faces that have vertical clearance before geometry/obstacle checks.
  for (let y = 4; y < root.rows - 4; y++) for (let x = 4; x < root.cols - 4; x++) {
    const from = tierAt(x, y); // Starting tier for both cardinal comparisons.
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const gap = Math.abs(from - tierAt(x + dx, y + dy)); // Absolute height difference, not overall peak height.
      if (!gap) continue;
      edges++;
      totalGap += gap;
      if (gap >= BALCONY_GAP_TIERS) balconyFriendly++;
    }
  }
  return { averageGap: totalGap / Math.max(1, edges), balconyFriendly };
}

const seed = 'cliff-relief-verify'; // Fixed across generations for a meaningful before/after comparison.
const beforeWorkspace = generator.generateWorkspace(seed, { ...compact, plateauSteepness: 1 }); // Existing terrain without the new pass.
const afterWorkspace = generator.generateWorkspace(seed, { ...compact, plateauSteepness: 1.75 }); // Updated cliff relief.
const before = gapStats(beforeWorkspace); // Baseline cliff clearance opportunities.
const after = gapStats(afterWorkspace); // New clearance opportunities.

assert(before.balconyFriendly > 0, 'reference landscape has tall cliff faces');
assert(after.averageGap > before.averageGap, 'average neighboring plateau height must increase');
assert(after.balconyFriendly > before.balconyFriendly, 'more boundaries must offer potential balcony clearance');
assert.equal(beforeWorkspace.plateauSteepnessReport, null, 'neutral steepness leaves the pass disabled');
assert.equal(afterWorkspace.plateauSteepnessReport?.multiplier, 1.75, 'debug output identifies actual steepness');
assert(afterWorkspace.plateauSteepnessReport?.tallerTiles > 0, 'debug output records changed tiles');
assert(afterWorkspace.plateauSteepnessReport?.raisedMaxTier > afterWorkspace.plateauSteepnessReport?.originalMaxTier, 'ramp/border generation sees taller tier range');
assert.equal(afterWorkspace.maps.find(map => !map.isSubmap).generatedFrom?.plateauSteepness, 1.75, 'exported root map records steepness');

for (const zone of ['map_northern_cliffs', 'map_western_slope']) {
  assert.equal(generator.zoneSettings(zone).plateauSteepness, 1.75, `${zone} uses more dramatic relief`);
}
assert.equal(generator.defaultSettings().plateauSteepness, 1, 'neutral setting remains the generic default');

const forestSettings = { ...compact, preset: 'greatBasin', maxTier: 2, lowProfilePlateaus: true }; // Cloud Forest's intentionally shallow preset.
const forestBefore = generator.generateWorkspace('shallow-forest-relief', { ...forestSettings, plateauSteepness: 1 }); // Control layout.
const forestAfter = generator.generateWorkspace('shallow-forest-relief', { ...forestSettings, plateauSteepness: 1.75 }); // Cliff setting deliberately has no effect here.
assert.deepEqual(
  forestAfter.plateauGroups.map(group => group.elevation),
  forestBefore.plateauGroups.map(group => group.elevation),
  'non-cliff Great Basin terrain must not be regraded'
);
assert.equal(forestAfter.plateauSteepnessReport, null, 'shallow zone has no cliff-relief pass');


// A real route-graph comparison checks that vertical clearance actually unlocks balcony generation,
// not just that neighboring elevations became numerically larger.
const syntheticCliff = tier => Array.from({ length: 36 }, () => Array.from({ length: 18 }, (_, col) => ({
  type: col === 7 ? 'rock' : 'grass',
  incline: col === 7,
  elevTier: col > 7 ? tier : 0,
}))); // Same wide plateau/rock-face footprint for both heights; only its true tier changes.
const cliffRouteOptions = { // Shared gameplay cliff graph uses 2.5 world units per terrain tier.
  plateauUnit: 2.5,
  blocked: tile => !tile || tile.incline || tile.type === 'rock',
};
const shortCliff = cliffRoutes.build(syntheticCliff(1), { ...cliffRouteOptions, area: 'short-cliff' }); // Prior one-tier, 2.5-world-unit wall.
const tallCliff = cliffRoutes.build(syntheticCliff(Math.round(1 * 1.75)), { ...cliffRouteOptions, area: 'tall-cliff' }); // New two-tier, 5-world-unit wall.
assert.equal(shortCliff.balconies.length, 0, 'short cliffs leave no clearance for a correctly embedded balcony base');
assert(tallCliff.balconies.length > shortCliff.balconies.length, 'raising the same cliff must actually permit balcony spawns');
assert(tallCliff.verification.ok, 'new taller cliff routes and balconies remain traversable');
assert.equal(tallCliff.unconnectedComponents, 0, 'the taller cliff does not strand the upper plateau');


// Merge both full generated workspaces before evaluating cliff routes. This catches
// differences between source-tier arithmetic and the actual Map Editor/runtime tile grid.
function generatedCliffGraph(workspace, area) {
  const root = workspace.maps.find(map => !map.isSubmap); // The correct parent for all exported plateau submaps.
  const merged = terrainPreview.buildMergedZoneGrid(workspace, root.id); // Authoritative elevation and incline ownership after export.
  const grid = terrainPreview.buildZGrid(merged.cols, merged.rows, merged.tiles); // Final row-major cliff routing input.
  return cliffRoutes.build(grid, {
    area,
    plateauUnit: terrainPreview.PLATEAU_UNIT, // Identical world-height units as runtime cliff routing.
    tileY: tile => (tile.elevTier || 0) * terrainPreview.PLATEAU_UNIT,
    blocked: tile => !tile || tile.incline || tile.type === 'rock' || ['river','stream','trench'].includes(tile.type),
  });
}
const beforeGraph = generatedCliffGraph(beforeWorkspace, 'before-relief'); // Baseline generated wilderness, not an artificial straight wall.
const afterGraph = generatedCliffGraph(afterWorkspace, 'after-relief'); // Same seed after the live steepness remap.
assert(afterGraph.balconies.length > beforeGraph.balconies.length,
  `real exported cliff graph should produce more balconies: ${beforeGraph.balconies.length} -> ${afterGraph.balconies.length}`);
assert.equal(afterGraph.verification.invalidHops.length, 0, 'new terrain must not create invalid cliff navigation hops');
assert.equal(afterGraph.verification.invalidEmbeddedBases.length, 0, 'new balconies must retain safely embedded rock bases');
assert(afterGraph.verification.unreachablePlateaus.length <= beforeGraph.verification.unreachablePlateaus.length,
  'the new relief must not strand more plateau components in this seeded integration test');

// Exact biome recipes use setControlValue, which deliberately ignores missing controls.
// Keep a visible slider in the Lab so plateauSteepness survives settingsFromControls.
const labHtml = fs.readFileSync(path.join(__dirname, '../docs/tools/wilderness-generation-lab/index.html'), 'utf8'); // Shipped lab schema checked without a browser.
assert(labHtml.includes("key:'plateauSteepness'"), 'the exact live-zone recipe must expose a plateauSteepness control');
const labFeatures = fs.readFileSync(path.join(__dirname, '../docs/tools/wilderness-generation-lab/lab-features.js'), 'utf8'); // Verifies the Lab still sources gameplay zone configs.
assert(labFeatures.includes("zoneSettings?.('map_northern_cliffs')") && labFeatures.includes("zoneSettings?.('map_western_slope')"),
  'wilderness Lab presets must use the actual live zone settings');

console.log(`PASS plateau steepness: balcony-clearance edges ${before.balconyFriendly} -> ${after.balconyFriendly}, mean tier gap ${before.averageGap.toFixed(2)} -> ${after.averageGap.toFixed(2)}; actual balconies ${beforeGraph.balconies.length} -> ${afterGraph.balconies.length}; Great Basin unchanged`);
