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
// A stroke touching no metal is rejected with a clear message.
const lonely = new Uint8Array(W * H);
stampLine(lonely, W, H, null, { x: 30, y: 2 }, 1);
assert.throws(() => fillBridge(src, lonely, W, H), /touch metal/);
assert.throws(() => fillBridge(src, new Uint8Array(W * H), W, H), /Paint over/);
console.log('modular weapon bridge fill OK');
