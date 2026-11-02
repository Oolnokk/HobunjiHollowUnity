'use strict';

// Regression coverage for final water-height reconciliation in the shared
// wilderness generator. This checks the internal report and exported river
// nodes for custom terrain plus both dramatic presets.
const assert = require('node:assert/strict');
const generator = require('../docs/js/wilderness-map-generator.js');

const presets = [
  { id: 'custom', seed: 'gravity-hydrology-custom' },
  { id: 'cliffs', seed: 'gravity-hydrology-cliffs' },
  { id: 'greatBasin', seed: 'gravity-hydrology-great-basin' },
];

function elevationForExportedTile(tile, root, plateauElevations) {
  if (!tile) return Number(root.elevation) || 0;
  if (!tile.plateau) return Number(root.elevation) || 0;
  assert(plateauElevations.has(tile.plateau), `missing exported plateau tier for ${tile.plateau}`);
  return plateauElevations.get(tile.plateau);
}

for (const preset of presets) {
  const workspace = generator.generateWorkspace(preset.seed, {
    ...generator.defaultSettings(),
    width: 56,
    height: 56,
    preset: preset.id,
    boundaryMode: 'followMapHeight',
    boundaryCliffBoost: 0,
    stepCurve: 'northernCliffs',
    plateaus: 16,
    maxTier: 8,
    ramps: 0,
    rivers: 2,
    ponds: 4,
    plateauPonds: 4,
    plateauStreams: 4,
    animalDens: 0,
    rootTotems: 0,
    prey: 0,
    packPredators: 0,
    ambushPredators: 0,
    omnivores: 0,
    structures: 0,
    caves: 0,
    statues: 0,
    pillars: 0,
    trees: 0,
    logs: 0,
    bushes: 0,
    forage: 0,
    fruitBushes: 0,
    mushrooms: 0,
    beehives: 0,
    treasure: 0,
    ore: 0,
    boulders: 0,
  });

  const report = workspace.hydrologyReport;
  assert(report, `${preset.id}: final hydrology report is exported`);
  assert(report.riverPathsProcessed > 0, `${preset.id}: at least one generated river path is graded`);
  assert.equal(report.riverUpHillSteps, 0, `${preset.id}: river centerlines contain no uphill steps`);
  assert(report.pondBodiesProcessed > 0, `${preset.id}: generated pond basins are discovered`);
  assert.equal(report.pondUnevenBodies, 0, `${preset.id}: no pond basin remains uneven`);
  assert.equal(report.pondMaxElevationSpreadAfter, 0, `${preset.id}: pond floor spread is zero after grading`);

  const root = workspace.maps.find(map => map && !map.isSubmap);
  assert(root, `${preset.id}: exported root wilderness map exists`);
  const plateauElevations = new Map((workspace.plateauGroups || []).map(group => [group.id, Number(group.elevation) || 0]));
  assert(root.rivers.length > 0, `${preset.id}: generated rivers are exported`);

  for (const river of root.rivers) {
    assert.equal(river.flowDirection, 'higher-to-lower', `${preset.id}: exported ${river.id} declares downhill flow`);
    const samples = (river.nodes || [])
      .map(([col, row]) => ({ col, row, tile: root.tiles?.[`${col},${row}`] }))
      .filter(sample => sample.tile && (sample.tile.type === 'river' || sample.tile.type === 'waterfall'))
      .map(sample => ({
        key: `${sample.col},${sample.row}`,
        elevation: elevationForExportedTile(sample.tile, root, plateauElevations),
      }));
    assert(samples.length >= 2, `${preset.id}: ${river.id} has at least two exported water samples`);
    for (let i = 1; i < samples.length; i++) {
      assert(
        samples[i].elevation <= samples[i - 1].elevation,
        `${preset.id}: ${river.id} rises from ${samples[i - 1].key} tier ${samples[i - 1].elevation} to ${samples[i].key} tier ${samples[i].elevation}`
      );
    }
  }

  console.log(
    `PASS ${preset.id}: ${report.riverPathsProcessed} river path(s), ${report.pondBodiesProcessed} pond basin(s), `
    + `${report.riverTilesLowered} river tiles lowered, ${report.pondTilesFlattened} pond tiles levelled`
  );
}

console.log('PASS wilderness hydrology: all preset watercourses follow gravity.');
