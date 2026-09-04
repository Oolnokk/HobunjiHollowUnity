#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rendererPath = path.join(__dirname, '../docs/js/merged-water-renderer.js'); // Used by both the executable module import and shader/source integration assertions.
const rendererSource = fs.readFileSync(rendererPath, 'utf8'); // Used to verify the fitted overlay stays wired to the shared cliff mapper and shader.
const {
  buildSurfaceData,
  DEFAULT_STRETCH_OVERLAY_TEXTURE,
  DEFAULT_STRETCH_OVERLAY_OPACITY,
} = require(rendererPath);

const gameSource = fs.readFileSync(path.join(__dirname, '../docs/game.js'), 'utf8');

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
assert.deepEqual(disconnected.uvs.slice(0, 2), [0.25, 0.5], 'world-space UVs tile the base PNG every four tiles');
assert.deepEqual(disconnected.uvs.slice(8, 10), [1.75, 2], 'disconnected water stays aligned to the same tiled world-space base pattern');
assert.equal(disconnected.tileCount, 2);
assert.equal(disconnected.indices.length, 12, 'two tile quads become four triangles in one index buffer');

const coverage = buildSurfaceData([
  { col: 0, row: 0, surfaceY: 0, depth: 0.45, coverage: 1 },
  { col: 1, row: 0, surfaceY: 0, depth: 0.2 },
], { yOffset: 0 });
assert.deepEqual(coverage.coverages.slice(0, 4), [1, 1, 1, 1], 'permanent streams can reach the authored 80% maximum independently of color depth');
assert.deepEqual(coverage.coverages.slice(4, 8), [0.2, 0.2, 0.2, 0.2], 'temporary water defaults coverage to its simulated depth');

assert.equal(DEFAULT_STRETCH_OVERLAY_TEXTURE, 'assets/textures/canvas.png', 'water overlay uses the authored canvas texture');
assert.equal(DEFAULT_STRETCH_OVERLAY_OPACITY, 0.20, 'non-black canvas pixels use the requested 20% overlay opacity');
assert.match(rendererSource, /position\.setY\(i, 0\)/,
  'water is flattened only during footprint solving so height steps still belong to one connected overlay surface');
assert.match(rendererSource, /HobunjiSurfaceStretchUV/,
  'water reuses the same irregular perimeter-to-square mapper as the farm cliffs');
assert.match(rendererSource, /setAttribute\('aStretchUv', stretchUv\)/,
  'the fitted canvas UVs are kept independently from the base water UVs');
assert.match(rendererSource, /setAttribute\('uv', tiledUv\)/,
  'the existing wibbly water texture keeps its original world-tiled UVs');
assert.match(rendererSource, /pureBlack = 1\.0 - step/,
  'pure-black canvas pixels have a dedicated source-opacity preservation path');
assert.match(rendererSource, /mix\(uSurfaceOverlayOpacity, 1\.0, pureBlack\)/,
  'pure black bypasses the 20% opacity reduction while other pixels use it');
assert.match(rendererSource, /drawCalls: 1/,
  'the second PNG is composited in the existing merged water draw call instead of adding an overlapping mesh');

assert.match(gameSource, /if \(!sceneObj\?\.add\) \{[\s\S]*?return null;[\s\S]*?MergedWaterRenderer\.createMesh/,
  'merged water construction waits until its destination scene exists');
assert.match(gameSource, /function updateTownWaterMeshes\(\) \{[\s\S]*?if \(!townScene\) return;[\s\S]*?if \(_townWaterSimDirty\)/,
  'town water keeps its dirty flag until the town scene is available');

console.log('merged water renderer tests passed');
