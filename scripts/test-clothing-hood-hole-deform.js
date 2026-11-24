'use strict';
// Hood-opening quad deform (docs/tools/clothing-species-fit/hood-hole-deform.js):
// the opening follows its quad, the cloth between rim and outline follows with
// the falloff, the outer outline never moves, and thin bands never fold over.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../docs/tools/clothing-species-fit/hood-hole-deform.js'), 'utf8'), ctx);
const Hole = ctx.ClothingHoodHoleDeform;

// Synthetic hood: an opaque ring (radius 12..30) around a transparent opening.
const W = 80, H = 80, cx = 40, cy = 40;
const rgba = new Uint8ClampedArray(W * H * 4);
const ringPoints = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const r = Math.hypot(x + .5 - cx, y + .5 - cy);
  if (r >= 12 && r <= 30) { const i = (y * W + x) * 4; rgba[i] = 200; rgba[i + 3] = 255; }
}
for (let a = 0; a < 360; a += 2) {
  const t = a * Math.PI / 180;
  ringPoints.push({x: cx + Math.cos(t) * 12, y: cy + Math.sin(t) * 12});
}
const profile = Hole.buildProfile(rgba, W, H, ringPoints, {x: cx, y: cy});
assert(profile, 'a closed ring yields an opening profile');
assert(Math.abs(profile.box.x1 - profile.box.x0 - 24) < 1, 'opening box spans the rim');
const outlineMean = profile.outline.reduce((a, b) => a + b, 0) / profile.outline.length;
assert(Math.abs(outlineMean - 30) < 1.5, 'outline found at the hood silhouette: ' + outlineMean);

assert.strictEqual(Hole.warp(rgba, W, H, profile, Hole.zeroCorners(), 1.5), rgba, 'untouched corners are a no-op');

// Push the whole opening 4px right: rim moves ~4px, outline stays put.
const corners = [0, 1, 2, 3].map(() => ({x: 4, y: 0}));
const d0 = Hole.displacementAt(profile, corners, 1.5, cx + 12.5, cy);
assert(Math.abs(d0.x - 4) < 0.6, 'rim follows the opening quad: ' + d0.x);
const dOut = Hole.displacementAt(profile, corners, 1.5, cx + 30.5, cy);
assert.equal(Math.hypot(dOut.x, dOut.y), 0, 'outline does not move');
const mid = r => Hole.displacementAt(profile, corners, 6, cx + r, cy).x;
assert(mid(18) < Hole.displacementAt(profile, corners, 0.2, cx + 18, cy).x, 'higher falloff rate keeps the change tighter around the hole');
assert(Math.abs(Hole.falloffWeight(0, 3) - 1) < 1e-12 && Math.abs(Hole.falloffWeight(1, 3)) < 1e-12, 'falloff is 1 at the rim and 0 at the outline');

const out = Hole.warp(rgba, W, H, profile, corners, 1.5);
let outerChanged = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const r = Math.hypot(x + .5 - cx, y + .5 - cy);
  if (r > 31 && out[(y * W + x) * 4 + 3] !== rgba[(y * W + x) * 4 + 3]) outerChanged++;
}
assert.equal(outerChanged, 0, 'nothing outside the outline changes');

// A huge outward push on a thin band is limited so the mapping stays monotonic (no fold-over).
const huge = [0, 1, 2, 3].map(() => ({x: 40, y: 0}));
let prev = -Infinity;
for (let r = 12.5; r <= 30; r += 0.25) {
  const x = cx + r + Hole.displacementAt(profile, huge, 0.5, cx + r, cy).x;
  assert(x >= prev - 1e-9, 'band folds over at r=' + r);
  prev = x;
}
console.log('Hood-hole deform OK: opening quad, outline lock, falloff and fold limit.');
