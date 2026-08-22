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

const context = { // Browser-like global used to evaluate the grounding wrapper + PNG avatar helper without Three.js.
  console,
  document: { createElement: tag => tag === 'canvas' ? makeCanvas() : null },
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/creature-grounding.js', 'utf8'), context); // Must load first, matching debug.js's parser-time bootstrap.
vm.runInContext(fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8'), context); // Assignment is intercepted and its image scan wrapped immediately.

const width = 2; // Tiny synthetic idle-frame width for the alpha-threshold regression.
const height = 4; // Tiny synthetic idle-frame height for the alpha-threshold regression.
const pixels = new Uint8ClampedArray(width * height * 4); // RGBA buffer with controlled solid/fringe rows.
pixels[(1 * width) * 4 + 3] = 255;
pixels[(2 * width + 1) * 4 + 3] = 255;
pixels[(3 * width) * 4 + 3] = 20;
const image = { naturalWidth: width, naturalHeight: height, pixels }; // Loaded-image shape consumed by the public scan helper.

assert.deepEqual(
  { ...context.PNGPlaneAvatar.scanOpaqueVerticalBoundsOfImage.rawScan(image, 254) },
  { top: 1, bottom: 2 },
  'the underlying fully opaque scan still ignores the lower antialiased fringe row',
);

const contactWidth = 100; // Wide enough to distinguish a real contact band from one isolated tail/speck pixel.
const contactHeight = 20; // Keeps the wrapper's guarded upward search local to the bottom of the sprite.
const contactPixels = new Uint8ClampedArray(contactWidth * contactHeight * 4); // Synthetic animal silhouette used to test coherent foot selection.
for (let x = 35; x <= 64; x++) contactPixels[(16 * contactWidth + x) * 4 + 3] = 255; // Used as the coherent paw/foot contact row.
contactPixels[(17 * contactWidth + 96) * 4 + 3] = 255; // Used as a lower isolated tail-tip/speck that must not become the floor.
contactPixels[(18 * contactWidth + 50) * 4 + 3] = 20; // Used as an even lower antialiased fringe that threshold 254 must ignore.
const contactImage = { naturalWidth: contactWidth, naturalHeight: contactHeight, pixels: contactPixels }; // Mimics a decoded creature idle PNG.
const contactBounds = context.PNGPlaneAvatar.scanOpaqueVerticalBoundsOfImage(contactImage, 254); // Uses the wrapped gameplay-facing scan.
assert.equal(contactBounds.top, 16, 'coherent-grounding wrapper preserves the original top opaque row');
assert.equal(contactBounds.rawBottom, 17, 'diagnostic metadata retains the literal lowest fully opaque pixel');
assert.equal(contactBounds.bottom, 16, 'grounding ignores a sparse lower tail/speck and chooses the coherent paw row');
assert.equal(contactBounds.groundingRule, 'coherent-contact-row-v1', 'grounding reports which contact-row rule produced the correction');

const debugSource = fs.readFileSync('docs/debug.js', 'utf8'); // Confirms the wrapper installs before png-plane-avatar/game startup in the browser build.
assert.match(debugSource, /creature-grounding\.js\?v=20260822a/, 'early bootstrap loads creature-grounding.js');
assert.match(debugSource, /document\.write\(`<script src="\$\{src\}" data-creature-grounding="1">/, 'parser-time grounding load is synchronous');

const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Confirms the shared gameplay call sites use the intended tuning.
assert.match(gameSource, /const MOVE_BOB_WALK_AMP = 0\.0075;/, 'walking bob is reduced by half');
assert.match(gameSource, /const MOVE_BOB_RUN_AMP\s+= 0\.015;/, 'full-effort bob is reduced by half');
assert.match(gameSource, /const CREATURE_FULL_OPAQUE_ALPHA_THRESHOLD = 254;/, 'animal ground scan selects only alpha-255 pixels');
assert.match(
  gameSource,
  /scanOpaqueVerticalBoundsOfImage\?\.\(img, CREATURE_FULL_OPAQUE_ALPHA_THRESHOLD\)/,
  'the cached idle-frame grounding scan uses the wrapped fully opaque image scan',
);

const farmAnimalSource = fs.readFileSync('docs/js/farm-animals.js', 'utf8'); // Confirms farm livestock do not feed visual bob back into their ground state.
assert.doesNotMatch(farmAnimalSource, /this\.wy \+= Math\.sin\(/, 'farm livestock bob no longer accumulates into persistent ground Y');
assert.match(farmAnimalSource, /this\.avatarRef\.group\.position\.set\(this\.wx, this\.wy \+ bobY, this\.wz\)/, 'farm livestock bob is render-only');

const frameSwapStart = gameSource.indexOf('function setCreatureFrame('); // Isolates texture swapping from the following grounding code.
const frameSwapEnd = gameSource.indexOf('// spriteUrl -> resolved bottom-opacity ratio', frameSwapStart); // Ends at the next helper section.
const frameSwapSource = gameSource.slice(frameSwapStart, frameSwapEnd); // Verifies animation frames preserve the plane offset.
assert(frameSwapStart >= 0 && frameSwapEnd > frameSwapStart, 'creature frame-swap helper is present');
assert.doesNotMatch(frameSwapSource, /position\.y/, 'changing idle/run textures does not reset the idle-derived Y offset');

console.log('character bob and coherent creature grounding checks passed');
