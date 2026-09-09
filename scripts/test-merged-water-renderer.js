#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSurfaceData, buildInvertedSurfaceData } = require('../docs/js/merged-water-renderer.js');

const rendererSource = fs.readFileSync(path.join(__dirname, '../docs/js/merged-water-renderer.js'), 'utf8');
const waterSystemSource = fs.readFileSync(path.join(__dirname, '../docs/js/water-system.js'), 'utf8');

function cornersForTile(data, tileIndex) {
  const start = tileIndex * 12;
  const values = [];
  for (let i = 0; i < 4; i++) values.push({
    x: data.positions[start + i * 3],
    y: data.positions[start + i * 3 + 1],
    z: data.positions[start + i * 3 + 2],
  });
  return values;
}

const gentle = buildSurfaceData([
  { col: 0, row: 0, surfaceY: 0, depth: 0.4 },
  { col: 1, row: 0, surfaceY: 0.2, depth: 0.6 },
], { joinThreshold: 0.275, yOffset: 0 });
const gentleLeft = cornersForTile(gentle, 0);
const gentleRight = cornersForTile(gentle, 1);
assert.equal(gentleLeft[1].y, 0.1, 'small head differences average along the north shared edge');
assert.equal(gentleLeft[3].y, 0.1, 'small head differences average along the south shared edge');
assert.equal(gentleRight[0].y, gentleLeft[1].y, 'adjacent tiles use the exact same north edge height');
assert.equal(gentleRight[2].y, gentleLeft[3].y, 'adjacent tiles use the exact same south edge height');

const sharp = buildSurfaceData([
  { col: 0, row: 0, surfaceY: -0.5, depth: 0.2 },
  { col: 1, row: 0, surfaceY: 0, depth: 0.2 },
], { joinThreshold: 0.275, yOffset: 0 });
const sharpLeft = cornersForTile(sharp, 0);
const sharpRight = cornersForTile(sharp, 1);
assert.equal(sharpLeft[1].y, -0.5, 'a trench-sized elevation step stays sharp');
assert.equal(sharpRight[0].y, 0, 'the higher side of a sharp step keeps its own height');

const disconnected = buildSurfaceData([
  { col: 1, row: 2, surfaceY: 0, depth: 0.5 },
  { col: 7, row: 8, surfaceY: 1, depth: 1 },
], { yOffset: 0 });
assert.deepEqual(disconnected.uvs.slice(0, 2), [0.25, 0.5], 'world-space UVs tile the PNG every four tiles');
assert.deepEqual(disconnected.uvs.slice(8, 10), [1.75, 2], 'disconnected water stays aligned to the same tiled world-space pattern');
assert.equal(disconnected.tileCount, 2);
assert.equal(disconnected.indices.length, 12, 'two tile quads become four triangles in one index buffer');

const coverage = buildSurfaceData([
  { col: 0, row: 0, surfaceY: 0, depth: 0.45, coverage: 1 },
  { col: 1, row: 0, surfaceY: 0, depth: 0.2 },
], { yOffset: 0 });
assert.deepEqual(coverage.coverages.slice(0, 4), [1, 1, 1, 1], 'permanent streams can reach the authored 80% maximum independently of color depth');
assert.deepEqual(coverage.coverages.slice(4, 8), [0.2, 0.2, 0.2, 0.2], 'temporary water defaults coverage to its simulated depth');

const invertedCells = [
  { col: 0, row: 0, surfaceY: 0.1, depth: 0.2, coverage: 0.2, visible: true },
  { col: 1, row: 0, surfaceY: 0.1, depth: 0.2, coverage: 0.2, visible: true },
  { col: 2, row: 0, surfaceY: 0.35, depth: 0.7, coverage: 0.7, visible: true },
  { col: 0, row: 1, surfaceY: 0.1, depth: 0.2, coverage: 0.2, visible: true },
  { col: 1, row: 1, surfaceY: 0, depth: 0, coverage: 0, visible: false },
  { col: 2, row: 1, surfaceY: 0.1, depth: 0.2, coverage: 0.2, visible: true },
];
const invertedOptions = {
  cols: 3,
  rows: 2,
  yOffset: 0,
  baseline: { visible: true, surfaceY: 0.1, depth: 0.2, coverage: 0.2 },
};
const invertedClassic = buildSurfaceData(invertedCells, invertedOptions);
const inverted = buildInvertedSurfaceData(invertedCells, invertedOptions);
assert.equal(inverted.representation, 'baseline-geometry-exceptions', 'wet weather uses the geometry-masked inverted representation');
assert.equal(inverted.baselineRectangles, 3, 'baseline cells around a dry hole are merged into three large rectangles');
assert.equal(inverted.exceptionCount, 1, 'only the wet differing cell contributes special geometry');
assert.equal(inverted.maskedCellCount, 2, 'the wet deviation and dry hole are both omitted from the common baseline');
assert.equal(inverted.positions.length / 3, 16, 'three baseline rectangles plus one wet exception use four quads total');
assert.equal(inverted.indices.length / 3, 8, 'four quads remain eight triangles in one geometry');
assert.ok(inverted.positions.length <= invertedClassic.positions.length,
  'inverted geometry never exceeds the classic wet-tile vertex count');

const uniformCells = [];
for (let row = 0; row < 50; row++) {
  for (let col = 0; col < 60; col++) {
    uniformCells.push({ col, row, surfaceY: 0.1, depth: 0.2, coverage: 0.2, visible: true });
  }
}
const uniformClassic = buildSurfaceData(uniformCells, { yOffset: 0 });
const uniformInverted = buildInvertedSurfaceData(uniformCells, {
  cols: 60,
  rows: 50,
  yOffset: 0,
  baseline: { visible: true, surfaceY: 0.1, depth: 0.2, coverage: 0.2 },
});
assert.equal(uniformClassic.positions.length / 3, 12000, 'classic 60x50 water uses four vertices per wet tile');
assert.equal(uniformInverted.positions.length / 3, 4, 'uniform 60x50 water collapses to one four-vertex baseline rectangle');
assert.equal(uniformInverted.baselineRectangles, 1);
assert.equal(uniformInverted.exceptionCount, 0);

const checkerCells = [];
for (let row = 0; row < 10; row++) {
  for (let col = 0; col < 10; col++) {
    const differs = (row + col) % 2 === 1;
    checkerCells.push({
      col, row,
      surfaceY: differs ? 0.35 : 0.1,
      depth: differs ? 0.7 : 0.2,
      coverage: differs ? 0.7 : 0.2,
      visible: true,
    });
  }
}
const checkerClassic = buildSurfaceData(checkerCells, { yOffset: 0 });
const checkerInverted = buildInvertedSurfaceData(checkerCells, {
  cols: 10,
  rows: 10,
  yOffset: 0,
  baseline: { visible: true, surfaceY: 0.1, depth: 0.2, coverage: 0.2 },
});
assert.ok(checkerInverted.positions.length <= checkerClassic.positions.length,
  'checkerboard worst case still cannot exceed classic geometry');

const dryBaseline = buildInvertedSurfaceData([
  { col: 1, row: 0, surfaceY: -0.2, depth: 0.45, coverage: 0.45, visible: true },
], {
  cols: 2,
  rows: 1,
  yOffset: 0,
  baseline: { visible: false, surfaceY: 0, depth: 0, coverage: 0 },
});
assert.equal(dryBaseline.baselineVisible, false, 'dry weather does not create a map-wide water baseline');
assert.equal(dryBaseline.representation, 'tile-merged', 'dry weather directly retains the classic sparse-water path');
assert.equal(dryBaseline.positions.length / 3, 4, 'locally retained water still renders as one classic merged tile quad');
assert.equal(dryBaseline.inversionFallback, true, 'diagnostics show that no baseline compression was attempted while dry');

assert.doesNotMatch(rendererSource, /uExceptionMask|aBaseline|waterExceptionMask/,
  'inverted water no longer adds a fragment mask texture, baseline shader attribute, or mask-texture ownership');
assert.doesNotMatch(rendererSource, /texture2D\s*\(\s*uExceptionMask/,
  'the water fragment shader performs no extra exception-mask texture lookup');
assert.doesNotMatch(waterSystemSource,
  /cells\.push\(\{[\s\S]{0,220}?visible:\s*false/,
  'the collector never allocates invisible per-tile records');
assert.match(waterSystemSource,
  /INVERTED_WATER_MIN_WET_FRACTION = 0\.25/,
  'sparse water has an explicit density gate before baseline analysis');
assert.match(waterSystemSource,
  /const minimumInversionWetCells = Math\.ceil\(rows \* cols \* INVERTED_WATER_MIN_WET_FRACTION\);[\s\S]{0,280}?cells\.length < minimumInversionWetCells[\s\S]{0,280}?_dryRenderBaseline\(\)/,
  'the sparse collector returns directly to the classic path before allocating baseline samples');
assert.match(waterSystemSource,
  /function _newBaselineSamples\(\)[\s\S]{0,900}?wet:\s*\[\][\s\S]{0,900}?dryCount:/,
  'dense-state baseline sampling counts dry cells separately and retains only wet values that can affect a visible median');
assert.match(waterSystemSource,
  /function _baselineMedian\(samples\)[\s\S]{0,900}?highIndex < samples\.dryCount[\s\S]{0,900}?samples\.wet\.sort/,
  'baseline median bypasses wet-sample sorting when the median is wholly below the visibility threshold');

assert.match(waterSystemSource, /if \(!sceneObj\?\.add\) \{[\s\S]*?return null;[\s\S]*?MergedWaterRenderer\.createMesh/,
  'merged water construction waits until its destination scene exists');
assert.match(waterSystemSource, /function updateTownWaterMeshes\(\) \{[\s\S]*?if \(!townScene\) return;[\s\S]*?if \(_townWaterSimDirty\)/,
  'town water keeps its dirty flag until the town scene is available');

console.log('merged water renderer tests passed');
