#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../docs/tools/clothing-species-fit'); // Tests the module loaded by the real clothing editor.
const host = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'contour-fit.js'), 'utf8'), host, { filename: 'contour-fit.js' });
const fit = host.window.ClothingContourFit;
assert(fit && typeof fit.fitPixels === 'function');

const width = 48, height = 40, size = width * height; // Synthetic portrait has both a neckline and poncho overhang.
const rgba = () => new Uint8ClampedArray(size * 4);
const source = rgba(), target = rgba(), poncho = rgba(), protectedPixels = new Uint8Array(size);
function fillRect(data, left, top, right, bottom, color) {
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    const pixel = (y * width + x) * 4;
    data[pixel] = color; data[pixel + 1] = 40; data[pixel + 2] = 90; data[pixel + 3] = 255;
  }
}
function edges(data, y) {
  const xs = [];
  for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3]) xs.push(x);
  return xs.length ? [xs[0], xs[xs.length - 1]] : null;
}
fillRect(source, 17, 3, 30, 36, 1);
fillRect(target, 10, 3, 37, 36, 1);
fillRect(poncho, 14, 5, 33, 34, 200);
// Deliberately create a fully transparent neckline that should not receive unwanted copied pixels.
for (let y = 5; y <= 9; y++) for (let x = 22; x <= 25; x++) {
  poncho[(y * width + x) * 4 + 3] = 0;
}
fit.paint(protectedPixels, width, height, 23, 7, 4, false);
const saved = fit.pack(protectedPixels, width, height);
assert.deepEqual([...fit.unpack(saved, width, height)], [...protectedPixels], 'Protected pixels round-trip through saved RLE mask');
const fitted = fit.fitPixels(poncho, source, target, protectedPixels, width, height, { strength: 1, feather: 14 });
assert(fitted.rows > 20, 'Valid torso rows should undergo the automatic fit');
const before = edges(poncho, 20), after = edges(fitted.pixels, 20);
assert(after[0] < before[0] && after[1] > before[1], 'Poncho follows expanded torso while keeping its overhang');
for (let i = 0; i < size; i++) if (protectedPixels[i]) {
  assert.deepEqual([...fitted.pixels.slice(i * 4, i * 4 + 4)], [...poncho.slice(i * 4, i * 4 + 4)],
    'Every protected RGBA pixel, including the transparent neck hole, stays fixed');
}
const zero = fit.fitPixels(poncho, source, target, protectedPixels, width, height, { strength: 0 });
assert.deepEqual([...zero.pixels], [...poncho], 'Strength zero is an exact no-op');
const unchanged = fit.fitPixels(poncho, source, source, null, width, height, { strength: 1 });
assert.deepEqual([...unchanged.pixels], [...poncho], 'Identical source/target torso outlines cannot alter the sprite');
const erased = protectedPixels.slice();
fit.paint(erased, width, height, 23, 7, 4, true);
assert.equal(erased.reduce((n, v) => n + v, 0), 0, 'Erase restores unprotected pixels');
assert.throws(() => fit.fitPixels(poncho, source, target, null, width + 1, height), /equal-sized/, 'Wrong raster dimensions fail explicitly');
console.log('OK: isolated torso contours, poncho widening, collar pinning, transparency, erase, strength=0 and mask persistence');
