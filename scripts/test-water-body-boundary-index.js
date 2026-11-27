#!/usr/bin/env node
'use strict';
// The water-body outline's grid-accelerated nearest-boundary query must equal the brute-force minimum exactly
// (it replaced an O(vertices x segments) loop that was ~half of a wilderness zone's first build).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/water-body-outline-overlay.js', 'utf8');
const win = { THREE: { BufferGeometry: class {}, Float32BufferAttribute: class {}, BufferAttribute: class {}, DataTexture: class {}, TextureLoader: class { load() {} }, RGBAFormat: 'rgba' }, HobunjiSurfaceStretchUV: { mapGeometry() { throw new Error('unused'); } } };
win.window = win;
vm.runInNewContext(source, { window: win, console: { debug() {}, warn() {} }, Map, Set, WeakMap, Float32Array, Uint8Array, Uint16Array, Uint32Array, Math, Number, Object, Infinity });
const api = win.WaterBodyOutlineOverlay;
assert.equal(typeof api.buildBoundaryDistanceIndex, 'function');

let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
function check(label, segments, points) {
  const index = api.buildBoundaryDistanceIndex(segments);
  let worst = 0;
  for (const [x, z] of points) {
    const brute = api.distanceToBoundary(x, z, segments);
    const fast = index.query(x, z);
    worst = Math.max(worst, Math.abs(brute - fast));
    assert.ok(Math.abs(brute - fast) < 1e-9, `${label}: (${x},${z}) brute ${brute} vs indexed ${fast}`);
  }
  return worst;
}

// 1) Random segments of mixed length (including degenerate ones), points inside and well outside the box.
{
  const segments = Array.from({ length: 400 }, () => { const x = rnd() * 60, z = rnd() * 60, l = rnd() < 0.1 ? 0 : rnd() * 12, a = rnd() * 6.283; return [[x, z], [x + Math.cos(a) * l, z + Math.sin(a) * l]]; });
  const points = Array.from({ length: 1500 }, () => [rnd() * 140 - 40, rnd() * 140 - 40]);
  check('random', segments, points);
}
// 2) A realistic lake outline: the rim of a 20x14 tile pond, queried at every vertex of its interior.
{
  const segments = [];
  for (let c = 0; c < 20; c++) { segments.push([[c, 0], [c + 1, 0]], [[c, 14], [c + 1, 14]]); }
  for (let r = 0; r < 14; r++) { segments.push([[0, r], [0, r + 1]], [[20, r], [20, r + 1]]); }
  const points = [];
  for (let c = 0; c <= 20; c += 0.5) for (let r = 0; r <= 14; r += 0.5) points.push([c, r]);
  check('pond', segments, points);
}
// 3) One segment, no segments, and a long diagonal that spans many cells.
check('single', [[[0, 0], [10, 10]]], [[5, 5], [-3, 4], [20, 20], [0, 10]]);
assert.equal(api.buildBoundaryDistanceIndex([]).query(1, 1), 0, 'no boundary -> 0, like distanceToBoundary');
check('diagonal', [[[0, 0], [50, 50]], [[0, 50], [50, 0]]], Array.from({ length: 300 }, () => [rnd() * 60, rnd() * 60]));

// 4) Speed sanity: the indexed query beats brute force on a realistic big outline (not a flaky threshold, just must be faster).
{
  const segments = Array.from({ length: 1200 }, (_, i) => { const t = i / 1200 * 6.283, t2 = (i + 1) / 1200 * 6.283; return [[50 + 40 * Math.cos(t), 50 + 30 * Math.sin(t)], [50 + 40 * Math.cos(t2), 50 + 30 * Math.sin(t2)]]; });
  const points = Array.from({ length: 4000 }, () => [rnd() * 100, rnd() * 100]);
  const index = api.buildBoundaryDistanceIndex(segments);
  let t = process.hrtime.bigint(); for (const [x, z] of points) api.distanceToBoundary(x, z, segments); const brute = Number(process.hrtime.bigint() - t);
  t = process.hrtime.bigint(); for (const [x, z] of points) index.query(x, z); const fast = Number(process.hrtime.bigint() - t);
  assert.ok(fast < brute, `indexed (${fast}ns) should beat brute force (${brute}ns)`);
  console.log(`boundary index ${(brute / fast).toFixed(1)}x faster than brute force on a 1200-segment outline`);
}
console.log('water body boundary index tests passed');
