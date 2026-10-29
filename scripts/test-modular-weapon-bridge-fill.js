'use strict';

const assert = require('node:assert/strict'); // Runs the bridge brush fill on a synthetic two-block sprite.
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
const context = vm.createContext({ window, Uint8Array, Uint8ClampedArray, Int8Array, Int32Array, Math });
const file = 'docs/tools/modular-weapon-editor/sprite-bridge-fill.js';
vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
const { fillBridge, stampLine } = window.ModularWeaponBridgeFill;
const editorHtml = fs.readFileSync('docs/tools/modular-weapon-editor/index.html', 'utf8');
assert(/sprite-bridge-fill\.js\?v=[A-Za-z0-9_-]+/.test(editorHtml), 'Editor must load the bridge fill module.');
assert(editorHtml.indexOf('sprite-bridge-fill.js') < editorHtml.indexOf('sprite-cutter.js'), 'Bridge fill loads before the cutter.');

const W = 60, H = 30;
const SHADE = [60, 90, 95, 255], LIT = [110, 150, 155, 255], INK = [0, 0, 0, 255];
const src = new Uint8ClampedArray(W * H * 4);
const set = (x, y, c) => src.set(c, (y * W + x) * 4);
const get = (px, x, y) => Array.from(px.slice((y * W + x) * 4, (y * W + x) * 4 + 4));
// Two outlined blocks: shaded body with a lit top band.
for (const x0 of [2, 40]) {
  for (let y = 5; y < 25; y++) for (let x = x0; x < x0 + 18; x++) {
    const border = x === x0 || y === 5 || x === x0 + 17 || y === 24;
    set(x, y, border ? INK : (y < 11 ? LIT : SHADE));
  }
}
const mask = new Uint8Array(W * H);
stampLine(mask, W, H, null, { x: 12, y: 15 }, 4);
stampLine(mask, W, H, { x: 12, y: 15 }, { x: 48, y: 15 }, 4);
assert.equal(mask[15 * W + 30], 1, 'Stroke spans the gap.');
assert.equal(mask[2 * W + 30], 0, 'Stroke stays within its radius.');

const out = fillBridge(src, mask, W, H, { outlineThickness: 1, seed: 7 });
assert(out.seeds > 0 && out.grown > 0);
assert.equal(out.grown, out.filled, 'Every hollowed pixel reachable from metal is grown.');
// The stroke's edges over empty space become black rim; its middle becomes metal.
assert.deepEqual(get(out.pixels, 30, 15 - 4 + 0), INK.slice(0, 3).concat(255));
const middle = get(out.pixels, 30, 15);
assert(middle[3] === 255 && (middle[0] === SHADE[0] || middle[0] === LIT[0]), 'Gap middle is a sampled metal tone.');
// The old block outline crossed by the stroke is replaced with metal.
const crossed = get(out.pixels, 19, 15);
assert.notDeepEqual(crossed, INK, 'Block outline under the stroke is hollowed.');
// Only the two sampled tones (plus black rim) are written into the stroke.
for (let p = 0; p < W * H; p++) if (mask[p]) {
  const c = Array.from(out.pixels.slice(p * 4, p * 4 + 3)).join();
  assert(['0,0,0', SHADE.slice(0, 3).join(), LIT.slice(0, 3).join()].includes(c), 'Unexpected color ' + c);
}
// Pixels outside the stroke are untouched.
for (let p = 0; p < W * H; p++) if (!mask[p]) for (let c = 0; c < 4; c++) assert.equal(out.pixels[p * 4 + c], src[p * 4 + c]);
// Deterministic for a given seed.
assert.deepEqual(Array.from(fillBridge(src, mask, W, H, { outlineThickness: 1, seed: 7 }).pixels), Array.from(out.pixels));
// Both tones survive: the blocks' lit top band and shaded body continue into a stroke spanning both heights.
const tall = new Uint8Array(W * H);
stampLine(tall, W, H, { x: 12, y: 13 }, { x: 48, y: 13 }, 7);
const banded = fillBridge(src, tall, W, H, { outlineThickness: 1, seed: 2, lightDirection: null });
assert(banded.shaded > 0 && banded.unshaded > 0, 'Bridge keeps both shaded and unshaded tones.');
assert.equal(banded.highlighted, 0);
assert.deepEqual(get(banded.pixels, 30, 18).slice(0, 3), SHADE.slice(0, 3), 'Lower bridge continues the shaded body.');
assert.deepEqual(get(banded.pixels, 30, 8).slice(0, 3), LIT.slice(0, 3), 'Upper bridge continues the lit band.');
// Edge highlight lights only the light-facing new edge.
const lowMask = new Uint8Array(W * H);
stampLine(lowMask, W, H, { x: 12, y: 18 }, { x: 48, y: 18 }, 4);
const lit = fillBridge(src, lowMask, W, H, { outlineThickness: 1, seed: 2, lightDirection: [0, -1], highlightWidth: 2 });
assert(lit.highlighted > 0);
assert.deepEqual(get(lit.pixels, 30, 16).slice(0, 3), LIT.slice(0, 3), 'Top edge of the bridge is highlighted.');
assert.deepEqual(get(lit.pixels, 30, 20).slice(0, 3), SHADE.slice(0, 3), 'Bottom edge stays shaded.');
// Painted-over metal is kept; only empty space and outline ink under the stroke are regrown. The one exception is
// shaded metal on a channel linking the two blocks' lit bands, which becomes unshaded.
let relitCount = 0;
for (let p = 0; p < W * H; p++) if (mask[p] && src[p * 4 + 3] && src[p * 4] > 0) {
  const before = Array.from(src.slice(p * 4, p * 4 + 4)), after = Array.from(out.pixels.slice(p * 4, p * 4 + 4));
  if (before.join() === after.join()) continue;
  assert.deepEqual([before, after], [SHADE, LIT], 'Painted-over metal may only change from shaded to unshaded.');
  relitCount++;
}
assert(out.preserved > 0 && out.pools === 2 && out.poolsLinked === 1 && relitCount > 0);
// Separate unshaded pools touching the hollow get linked by an unshaded channel. Each block's lit pool sits in its
// own corner (left block bottom, right block top), so a plain race would leave the bridge shaded in the middle.
const pools = new Uint8ClampedArray(W * H * 4);
const setP = (x, y, c) => pools.set(c, (y * W + x) * 4);
for (const x0 of [2, 40]) for (let y = 2; y < 28; y++) for (let x = x0; x < x0 + 18; x++) {
  const border = x === x0 || y === 2 || x === x0 + 17 || y === 27;
  const litCorner = x0 === 2 ? (y >= 20 && y < 26) : (y >= 4 && y < 10);
  setP(x, y, border ? INK : litCorner ? LIT : SHADE);
}
const span = new Uint8Array(W * H);
stampLine(span, W, H, { x: 17, y: 15 }, { x: 42, y: 15 }, 12);
const linked = fillBridge(pools, span, W, H, { outlineThickness: 1, seed: 5, lightDirection: null });
assert.equal(linked.pools, 2);
assert.equal(linked.poolsLinked, 1);
assert(linked.channelled > 0);
// Walk the bridge middle column: a lit pixel exists there, and lit pixels connect both pools.
const litAt = (x, y) => { const p = (y * W + x) * 4; return linked.pixels[p] === LIT[0] && linked.pixels[p + 1] === LIT[1]; };
const seen = new Uint8Array(W * H), stack = [];
for (let y = 0; y < H; y++) for (let x = 0; x < 20; x++) if (litAt(x, y)) { seen[y * W + x] = 1; stack.push([x, y]); }
let reachedRight = false;
while (stack.length) {
  const [x, y] = stack.pop();
  if (x >= 40) { reachedRight = true; break; }
  for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
    if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[ny * W + nx] || !litAt(nx, ny)) continue;
    seen[ny * W + nx] = 1; stack.push([nx, ny]);
  }
}
assert(reachedRight, 'An unshaded channel connects the left and right lit pools.');
// A stroke touching no metal is rejected with a clear message.
const lonely = new Uint8Array(W * H);
stampLine(lonely, W, H, null, { x: 30, y: 2 }, 1);
assert.throws(() => fillBridge(src, lonely, W, H), /touch metal/);
assert.throws(() => fillBridge(src, new Uint8Array(W * H), W, H), /Paint over/);
console.log('modular weapon bridge fill OK');
