#!/usr/bin/env node
'use strict';
// Weight eraser + reflect (sibling bone, belt halves) grid maths.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const sandbox = { globalThis: null }; sandbox.globalThis = sandbox; vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('docs/js/pants-rig-core.js', 'utf8'), sandbox);
const Core = sandbox.HobunjiPantsRig;
const W = 8, H = 4, N = 5;
const grid = () => { const data = new Uint8Array(W * H * N); for (let i = 0; i < W * H; i++) data[i * N] = 255; return { width: W, height: H, channels: [...Core.WEIGHT_CHANNELS], data }; };
const cell = (g, x, y) => Array.from(g.data.slice((y * W + x) * N, (y * W + x + 1) * N));
const put = (g, x, y, v) => g.data.set(v, (y * W + x) * N);
const sums = g => { for (let i = 0; i < W * H; i++) { let s = 0; for (let c = 0; c < N; c++) s += g.data[i * N + c]; assert.strictEqual(s, 255, 'cell ' + i + ' must sum to 255'); } };

{ // Sibling reflect: leftThigh (1) -> rightThigh (3), mirrored in x.
  const g = grid();
  put(g, 1, 2, [55, 200, 0, 0, 0]);
  put(g, 6, 2, [0, 0, 0, 0, 255]); // Sibling's old paint is overwritten (here a rightCalf cell stays as other-leg paint).
  put(g, 5, 1, [100, 0, 0, 155, 0]); // Old rightThigh paint at an unrelated cell is erased by the mirror (source there is 0).
  Core.reflectWeightChannel(g, 1, 3, 'all');
  sums(g);
  assert.deepStrictEqual(cell(g, 1, 2).map(Number), [55, 200, 0, 0, 0], 'the source is untouched');
  assert.strictEqual(cell(g, 6, 2)[3], 200, 'mirrored value is exact');
  assert.strictEqual(cell(g, 6, 2)[4], 55, 'other leg paint is kept; the belt shrinks to fit');
  assert.strictEqual(cell(g, 5, 1)[3], 0, 'old sibling paint is replaced, not merged');
  assert.strictEqual(cell(g, 5, 1)[0], 255 - 0, 'freed weight returns to the belt');
}
{ // Belt reflect left -> right overwrites only the right half.
  const g = grid();
  put(g, 0, 0, [100, 155, 0, 0, 0]); // Left half belt 100.
  put(g, 7, 0, [255, 0, 0, 0, 0]);   // Its mirror: belt 255 now.
  put(g, 3, 1, [0, 0, 0, 0, 255]);   // Left half cell, must not change.
  put(g, 4, 1, [30, 0, 0, 225, 0]);  // Right half; its mirror (3,1) has belt 0 -> becomes 0 belt.
  Core.reflectWeightChannel(g, 0, 0, 'right');
  sums(g);
  assert.strictEqual(cell(g, 7, 0)[0], 100, 'right belt equals mirrored left belt');
  assert.deepStrictEqual(cell(g, 0, 0).map(Number), [100, 155, 0, 0, 0], 'left half untouched');
  assert.deepStrictEqual(cell(g, 3, 1).map(Number), [0, 0, 0, 0, 255], 'left half untouched');
  assert.deepStrictEqual(cell(g, 4, 1).map(Number), [0, 0, 0, 255, 0], 'leg paint rescales to fill what the belt leaves');
  const back = grid(); put(back, 7, 0, [100, 0, 0, 155, 0]); Core.reflectWeightChannel(back, 0, 0, 'left'); sums(back);
  assert.strictEqual(cell(back, 0, 0)[0], 100, 'right -> left mirrors the other way');
}
{ // Eraser.
  const data = new Uint8Array([55, 200, 0, 0, 0]);
  Core.eraseWeightCell(data, 0, N, 1, 0.5);
  assert.deepStrictEqual(Array.from(data), [155, 100, 0, 0, 0], 'half of the bone weight returns to the belt');
  Core.eraseWeightCell(data, 0, N, 1, 1);
  assert.deepStrictEqual(Array.from(data), [255, 0, 0, 0, 0], 'full strength erases it');
  const belt = new Uint8Array([200, 55, 0, 0, 0]);
  Core.eraseWeightCell(belt, 0, N, 0, 1);
  assert.strictEqual(belt[0] + belt[1], 255); assert.strictEqual(belt[0], 0, 'erasing belt hands it to the bones');
  const pure = new Uint8Array([255, 0, 0, 0, 0]);
  Core.eraseWeightCell(pure, 0, N, 0, 1);
  assert.strictEqual(pure[0], 255, 'pure belt cell has nowhere to go');
}
console.log('Pants rig weight reflect/erase: PASS');
