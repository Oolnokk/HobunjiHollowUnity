#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Checks movement tuning and opacity-bound behavior.
const fs = require('node:fs'); // Reads runtime sources for integration assertions.
const vm = require('node:vm'); // Loads the browser helper with a small canvas stub.

function makeCanvas() {
  const canvas = { width: 0, height: 0, pixels: null }; // Holds the image pixels copied by drawImage below.
  const context2d = { // Implements only the canvas operations used by png-plane-avatar.js's scan path.
    clearRect() {}, save() {}, translate() {}, scale() {}, restore() {},
    drawImage(image) { canvas.pixels = image.pixels; },
    getImageData() { return { data: canvas.pixels }; },
  };
  canvas.getContext = () => context2d;
  return canvas;
}

const context = { // Browser-like global used to evaluate the PNG avatar helper without Three.js.
  console,
  document: { createElement: tag => tag === 'canvas' ? makeCanvas() : null },
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8'), context);

const width = 2; // Tiny synthetic idle-frame width for the alpha-bound scan.
const height = 4; // Tiny synthetic idle-frame height for the alpha-bound scan.
const pixels = new Uint8ClampedArray(width * height * 4); // RGBA buffer with controlled solid/fringe rows.
pixels[(1 * width) * 4 + 3] = 255;
pixels[(2 * width + 1) * 4 + 3] = 255;
pixels[(3 * width) * 4 + 3] = 20;
const image = { naturalWidth: width, naturalHeight: height, pixels }; // Loaded-image shape consumed by the public scan helper.

assert.deepEqual(
  { ...context.PNGPlaneAvatar.scanOpaqueVerticalBoundsOfImage(image, 254) },
  { top: 1, bottom: 2 },
  'fully opaque grounding ignores the lower antialiased fringe row',
);

const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Confirms the shared gameplay call sites use the intended tuning.
assert.match(gameSource, /const MOVE_BOB_WALK_AMP = 0\.0075;/, 'walking bob is reduced by half');
assert.match(gameSource, /const MOVE_BOB_RUN_AMP\s+= 0\.015;/, 'full-effort bob is reduced by half');
assert.match(gameSource, /const CREATURE_FULL_OPAQUE_ALPHA_THRESHOLD = 254;/, 'animal ground scan selects only alpha-255 pixels');
assert.match(
  gameSource,
  /scanOpaqueVerticalBoundsOfImage\?\.\(img, CREATURE_FULL_OPAQUE_ALPHA_THRESHOLD\)/,
  'the cached idle-frame grounding scan uses the fully opaque threshold',
);

const frameSwapStart = gameSource.indexOf('function setCreatureFrame('); // Isolates texture swapping from the following grounding code.
const frameSwapEnd = gameSource.indexOf('// spriteUrl -> resolved bottom-opacity ratio', frameSwapStart); // Ends at the next helper section.
const frameSwapSource = gameSource.slice(frameSwapStart, frameSwapEnd); // Verifies animation frames preserve the plane offset.
assert(frameSwapStart >= 0 && frameSwapEnd > frameSwapStart, 'creature frame-swap helper is present');
assert.doesNotMatch(frameSwapSource, /position\.y/, 'changing idle/run textures does not reset the idle-derived Y offset');

console.log('character bob and creature grounding checks passed');
