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
  document: { createElement: tag => tag === 'canvas' ? makeCanvas() : null, readyState: 'complete', getElementById: () => null },
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8'), context);

(async () => {
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
// The grounding scan/offset live in js/creature-ground-anchor.js: run them for real against the
// synthetic image above (fringe row ignored, so the opaque bottom is row 2 of 4) and check the cache.
{
  const anchorContext = { console, window: null, Image: class { set src(value) { this.requested = value; queueMicrotask(() => { Object.assign(this, image); this.onload(); }); } } };
  anchorContext.window = anchorContext;
  anchorContext.PNGPlaneAvatar = context.PNGPlaneAvatar; // The real scan helper.
  vm.createContext(anchorContext);
  vm.runInContext(fs.readFileSync('docs/js/creature-ground-anchor.js', 'utf8'), anchorContext);
  const anchor = anchorContext.CreatureGroundAnchor;
  const ratios = [];
  anchor.resolveRatio('a.png', ratio => ratios.push(ratio));
  anchor.resolveRatio('a.png', ratio => ratios.push(ratio)); // A second caller waits on the same scan.
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(ratios, [3 / height, 3 / height], 'animal ground scan selects only alpha-255 pixels and shares one load per sprite');
  anchor.resolveRatio('a.png', ratio => ratios.push(ratio));
  assert.equal(ratios.length, 3, 'a resolved sprite answers synchronously from the cache');
  assert.equal(anchor.planeOffset(2, 1), -0, 'no padding means no offset');
  assert.equal(anchor.planeOffset(2, 0.75), -0.5, 'padding shifts the plane down by its share of the model height');
}
assert.match(gameSource, /const resolveCreatureGroundAnchorRatio = window\.CreatureGroundAnchor\.resolveRatio;/, 'game.js delegates the grounding scan to the extracted module');

const frameSwapStart = gameSource.indexOf('function setCreatureFrame('); // Isolates texture swapping from the following grounding code.
const frameSwapEnd = gameSource.indexOf('// Ground-anchor scan/offset now live in', frameSwapStart); // Ends at the next helper section.
const frameSwapSource = gameSource.slice(frameSwapStart, frameSwapEnd); // Verifies animation frames preserve the plane offset.
assert(frameSwapStart >= 0 && frameSwapEnd > frameSwapStart, 'creature frame-swap helper is present');
assert.doesNotMatch(frameSwapSource, /position\.y/, 'changing idle/run textures does not reset the idle-derived Y offset');

console.log('character bob and creature grounding checks passed');
})();
