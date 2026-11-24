'use strict';
// Pinned outline (docs/tools/clothing-species-fit/silhouette-pins.js): pinned
// pixels go back exactly to their source position, the correction fades out
// with distance, nothing far away changes, and the brush snaps to outline
// pixels only.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../docs/tools/clothing-species-fit/silhouette-pins.js'), 'utf8'), ctx);
const Pins = ctx.ClothingSilhouettePins;

// A filled 20x20 square at (30..49, 30..49) in an 80x80 sprite.
const W = 80, H = 80, rgba = new Uint8ClampedArray(W * H * 4);
for (let y = 30; y < 50; y++) for (let x = 30; x < 50; x++) { const i = (y * W + x) * 4; rgba[i] = 200; rgba[i + 3] = 255; }

// The brush snaps to outline pixels: an interior click finds nothing, an edge click finds edge pixels only.
assert.equal(Pins.outlinePixelsNear(rgba, W, H, 40, 40, 3).length, 0, 'interior pixels are never pinned');
const edge = Pins.outlinePixelsNear(rgba, W, H, 30.5, 40, 2.5);
assert(edge.length >= 3 && edge.every(p => p.x === 30.5), 'left-edge click pins the left outline column: ' + JSON.stringify(edge));

// Suppose the fit moved the left edge 6px right (x 30 -> 36); pins pull it back.
const pinsAt = edge.map(p => ({ x: p.x + 6, y: p.y, ex: -6, ey: 0 }));
const on = Pins.correctionAt(pinsAt, 8, pinsAt[0].x, pinsAt[0].y);
assert(Math.abs(on.x + 6) < 1e-9 && Math.abs(on.y) < 1e-9, 'correction is exact on the pinned stroke: ' + JSON.stringify(on));
const near = Pins.correctionAt(pinsAt, 8, pinsAt[0].x + 8, pinsAt[0].y).x;
const far = Pins.correctionAt(pinsAt, 8, pinsAt[0].x + 30, pinsAt[0].y).x;
assert(near < -0.5 && near > -6, 'cloth near the pin follows partly: ' + near);
assert.equal(far, 0, 'nothing beyond the falloff moves');

// Shift the square right by 6 to stand in for "fitted art", then apply the pins.
const fitted = new Uint8ClampedArray(W * H * 4);
for (let y = 30; y < 50; y++) for (let x = 36; x < 56; x++) { const i = (y * W + x) * 4; fitted[i] = 200; fitted[i + 3] = 255; }
const out = Pins.warp(fitted, W, H, pinsAt, 8);
const alphaAt = (img, x, y) => img[(y * W + x) * 4 + 3];
for (const p of edge) assert.equal(alphaAt(out, Math.floor(p.x), Math.floor(p.y)), 255, 'pinned outline pixel is back at its source position ' + JSON.stringify(p));
assert.equal(alphaAt(out, 55, 10), alphaAt(fitted, 55, 10), 'far pixels are untouched');
assert.equal(alphaAt(out, 55, 40), 255, 'the far (unpinned) edge stays where the fit put it');
assert.strictEqual(Pins.warp(fitted, W, H, [], 8), fitted, 'no pins is a no-op');
assert.strictEqual(Pins.warp(fitted, W, H, edge.map(p => ({ ...p, ex: 0, ey: 0 })), 8), fitted, 'pins already in place are a no-op');

// Big corrections widen the falloff so the field cannot fold.
assert(Pins.effectiveSigma([{ x: 0, y: 0, ex: 30, ey: 0 }], 4) >= 27, 'falloff widens for large corrections');
assert.equal(Pins.normalizeSigma('nope'), Pins.DEFAULT_SIGMA);
console.log('Silhouette pins OK: outline snapping, exact pinned pixels, falloff, far pixels untouched.');
