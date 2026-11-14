#!/usr/bin/env node
'use strict';

// The cloud depth masks used to erode the atlas on the GPU with nine linear
// texture taps per pixel (min of the centre and +-1.5 texels in x/y). The sky
// now bakes that erosion once per atlas on the CPU. This checks the baked
// mask against a direct emulation of the old shader's taps at every texel
// centre, including the wrapping longitude seam and the clamped poles.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const window = {};
const context = vm.createContext({ window, Math, Number, Uint8Array, Uint16Array, Object, console, performance: { now: () => 0 } });
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'docs/js/sky-dome.js'), 'utf8'), context, { filename: 'sky-dome.js' });
const erode = window.HobunjiSkyDome?.erodeCloudAlpha;
assert.equal(typeof erode, 'function', 'sky dome exposes its mask bake');

// GLSL: texture2D with LinearFilter, wrapS = Repeat, wrapT = ClampToEdge,
// sampled at texel centre + (dx, dy) texels. Rows are in canvas order here.
function legacyTap(alpha, w, h, x, y, dx, dy) {
  const sx = x + dx, sy = Math.min(h - 0.5, Math.max(0.5, y + 0.5 + dy)) - 0.5; // Clamp UV to [0, 1] like the shader, then texel space.
  const x0 = Math.floor(sx), fx = sx - x0, y0 = Math.floor(sy), fy = sy - y0;
  const at = (ix, iy) => alpha[Math.min(h - 1, Math.max(0, iy)) * w + (((ix % w) + w) % w)];
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bot = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bot * fy;
}
function legacyMask(alpha, w, h, x, y) {
  let m = Infinity;
  for (const dx of [0, 1.5, -1.5]) for (const dy of [0, 1.5, -1.5]) m = Math.min(m, legacyTap(alpha, w, h, x, y, dx, dy));
  return m;
}

let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
for (const [w, h] of [[64, 32], [37, 19]]) {
  const alpha = new Uint8Array(w * h);
  // Blobby clouds plus noise, with a cloud straddling the longitude seam.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const blob = Math.max(0, 1 - Math.hypot((x - w * 0.3) / (w * 0.15), (y - h * 0.5) / (h * 0.3)));
    const seam = Math.max(0, 1 - Math.hypot(Math.min(x, w - x) / (w * 0.1), (y - h * 0.3) / (h * 0.25)));
    alpha[y * w + x] = Math.min(255, Math.round(255 * Math.max(blob, seam) + rnd() * 40));
  }
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba[i * 4 + 3] = alpha[i];
  const baked = erode(rgba, w, h);
  assert.equal(baked.length, w * h);
  let worst = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const expected = legacyMask(alpha, w, h, x, y);
    const got = baked[(h - 1 - y) * w + x]; // DataTexture rows are flipped relative to the canvas.
    worst = Math.max(worst, Math.abs(got - expected));
  }
  assert.ok(worst <= 0.5 + 1e-9, `baked mask matches the 9-tap shader at texel centres (${w}x${h}, worst ${worst})`);
}

const sky = fs.readFileSync(path.resolve(__dirname, '..', 'docs/js/sky-dome.js'), 'utf8');
assert.match(sky, /erodedMask \? makeErodedCloudDepthMaskMaterial\(erodedMask\) : makeCloudDepthMaskMaterial\(texture\)/, 'falls back to the 9-tap mask when the atlas cannot be read');
console.log('ok - baked cloud depth masks reproduce the old 9-tap erosion');
