#!/usr/bin/env node
'use strict';
// Exact outline parity and in-flight canvas deduplication regressions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let loads = 0; // Count image loads for coalesced same-key requests.
class FakeImage {
  constructor() { this.naturalWidth = 4; this.naturalHeight = 4; }
  set src(_path) { loads++; Promise.resolve().then(() => this.onload()); }
}
const fakeDocument = { createElement() {
  return { width: 0, height: 0, getContext() { return {
    drawImage() {}, putImageData() {},
    getImageData() { return { width: 4, height: 4, data: new Uint8ClampedArray(64) }; },
  }; } };
} };
const windowStub = { ColorFill: {
  rgbToHsv: () => ({ h: 0, s: 0, v: 0 }), hsvToRgb: () => [0, 0, 0],
  hueDistance: () => 0, hsvValueFillPixels() {},
} }; // Supplies the existing color-fill contract for a transparent source sprite.
vm.runInNewContext(fs.readFileSync('docs/js/tool-metal-recolor.js', 'utf8'), {
  window: windowStub, console, document: fakeDocument, Image: FakeImage,
  Math, Uint8Array, Uint8ClampedArray, Float64Array, Int32Array, Map, Set, Promise,
}, { filename: 'tool-metal-recolor.js' });
const optimized = windowStub.ToolMetalRecolor.__test.buildOxidationOutlineMask;
// Reference implementation deliberately mirrors the previous circular scan.
function reference(oxidation, metal, width, height, outlineWidth, centered) {
  const result = new Uint8Array(width * height), boundary = new Uint8Array(width * height);
  if (!outlineWidth) return result;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x;
    if (!oxidation[p]) continue;
    let edge = false;
    for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const a = x + dx, b = y + dy;
      if (a < 0 || b < 0 || a >= width || b >= height ||
          (!oxidation[b * width + a] && metal[b * width + a])) { edge = true; break; }
    }
    if (edge) boundary[p] = 1;
  }
  const radius = Math.max(1, Math.round((outlineWidth | 0) * 5 * Math.min(1, Math.min(width, height) / 450)));
  const inner = centered ? Math.floor(radius / 2) : 0;
  const outer = centered ? radius - inner : radius;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x;
    if (!metal[p]) continue;
    const r = oxidation[p] ? inner : outer;
    if (r <= 0) continue;
    find: for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.hypot(dx, dy) > r + 0.01) continue;
      const a = x + dx, b = y + dy;
      if (a < 0 || b < 0 || a >= width || b >= height) continue;
      if (boundary[b * width + a]) { result[p] = 1; break find; }
    }
  }
  return result;
}
let seed = 918273; // Fixed seed keeps any future regression reproducible.
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
for (let i = 0; i < 120; i++) {
  const width = 1 + Math.floor(random() * 47), height = 1 + Math.floor(random() * 47);
  const border = Math.floor(random() * 17), centered = random() > .5;
  const metal = Uint8Array.from({ length: width * height }, () => random() > .15 ? 1 : 0);
  const oxidation = Uint8Array.from({ length: width * height }, (_, n) => metal[n] && random() > .58 ? 1 : 0);
  assert.deepEqual([...optimized(oxidation, metal, width, height, border, centered)],
    [...reference(oxidation, metal, width, height, border, centered)],
    'exact outline pixel parity in case ' + i);
}
(async () => {
  const opts = { targetHex: '#e7e7e7', oxidationAmount: 0 };
  const first = windowStub.ToolMetalRecolor.getRecoloredCanvas('demo.png', opts);
  const duplicate = windowStub.ToolMetalRecolor.getRecoloredCanvas('demo.png', opts);
  assert.strictEqual(first, duplicate, 'same-key requests share the pending promise');
  const canvas = await first;
  assert.equal(loads, 1, 'source loads once');
  assert.strictEqual(await duplicate, canvas);
  assert.strictEqual(await windowStub.ToolMetalRecolor.getRecoloredCanvas('demo.png', opts), canvas);
  windowStub.ToolMetalRecolor.clearCache();
  assert.notStrictEqual(await windowStub.ToolMetalRecolor.getRecoloredCanvas('demo.png', opts), canvas);
  console.log('profiled CPU hotspots: outline and pending-canvas cache ok');
})().catch(err => { console.error(err); process.exitCode = 1; });
