#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { buildSurfaceData } = require('../docs/js/merged-water-renderer.js');

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
], { joinThreshold: 0.275, yOffset: 0, uvWidth: 4, uvHeight: 4 });
const gentleLeft = cornersForTile(gentle, 0);
const gentleRight = cornersForTile(gentle, 1);
assert.equal(gentleLeft[1].y, 0.1, 'small head differences average along the north shared edge');
assert.equal(gentleLeft[3].y, 0.1, 'small head differences average along the south shared edge');
assert.equal(gentleRight[0].y, gentleLeft[1].y, 'adjacent tiles use the exact same north edge height');
assert.equal(gentleRight[2].y, gentleLeft[3].y, 'adjacent tiles use the exact same south edge height');

const sharp = buildSurfaceData([
  { col: 0, row: 0, surfaceY: -0.5, depth: 0.2 },
  { col: 1, row: 0, surfaceY: 0, depth: 0.2 },
], { joinThreshold: 0.275, yOffset: 0, uvWidth: 4, uvHeight: 4 });
const sharpLeft = cornersForTile(sharp, 0);
const sharpRight = cornersForTile(sharp, 1);
assert.equal(sharpLeft[1].y, -0.5, 'a trench-sized elevation step stays sharp');
assert.equal(sharpRight[0].y, 0, 'the higher side of a sharp step keeps its own height');

const disconnected = buildSurfaceData([
  { col: 1, row: 2, surfaceY: 0, depth: 0.5 },
  { col: 7, row: 8, surfaceY: 1, depth: 1 },
], { yOffset: 0, uvWidth: 10, uvHeight: 10 });
assert.deepEqual(disconnected.uvs.slice(0, 2), [0.1, 0.2], 'UVs come from world X/Z rather than tile-local coordinates');
assert.deepEqual(disconnected.uvs.slice(8, 10), [0.7, 0.8], 'disconnected high water samples the matching part of the same stretched PNG');
assert.equal(disconnected.tileCount, 2);
assert.equal(disconnected.indices.length, 12, 'two tile quads become four triangles in one index buffer');

console.log('merged water renderer tests passed');
