#!/usr/bin/env node
'use strict';

// Verdigris/motif borders scale with the source raster's short side (like
// animal surface paint), so a 234x173 pauldron gets the same apparent line
// weight as a 450x1204 tool sprite instead of a ~2.6x heavier border.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const windowStub = {};
windowStub.window = windowStub;
vm.runInNewContext(fs.readFileSync('docs/js/tool-metal-recolor.js', 'utf8'), { window: windowStub, console, document: undefined, Image: function Image() {}, Math, Uint8Array, Uint8ClampedArray, Map, Set, Promise }, { filename: 'tool-metal-recolor.js' });
const api = windowStub.ToolMetalRecolor.__test;

assert.equal(api.outlineRasterScale(450, 1204), 1, 'standard tool sprites keep their authored border');
assert.equal(api.outlineRasterScale(2048, 2048), 1, 'large rasters are never scaled up');
assert.ok(Math.abs(api.outlineRasterScale(234, 173) - 173 / 450) < 1e-12, 'pauldron border follows its short side');

function outlineThickness(width, height) {
  // Left half oxidised, right half bare metal: count outline pixels on one row.
  const n = width * height;
  const metal = new Uint8Array(n).fill(1);
  const oxidation = new Uint8Array(n);
  for (let y = 0; y < height; y++) for (let x = 0; x < width / 2; x++) oxidation[y * width + x] = 1;
  const outline = api.buildOxidationOutlineMask(oxidation, metal, width, height, 2, false);
  const row = Math.floor(height / 2);
  let count = 0;
  for (let x = 0; x < width; x++) if (outline[row * width + x]) count++;
  return count;
}
const toolThickness = outlineThickness(450, 460);
const pauldronThickness = outlineThickness(234, 173);
assert.equal(toolThickness, 10, 'tool raster keeps the legacy 10px outward border');
assert.equal(pauldronThickness, Math.round(10 * 173 / 450), 'pauldron raster border is proportionally thinner');

console.log('verdigris outline raster scaling: ok');
