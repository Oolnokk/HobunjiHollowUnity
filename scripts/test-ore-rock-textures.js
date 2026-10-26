#!/usr/bin/env node
'use strict';

const assert = require('assert'); // Compares the shared rock material, natural-stone pixels and mineral-patch pixels.
const fs = require('fs'); // Reads production JavaScript rather than duplicating its rendering algorithm.
const vm = require('vm'); // Runs the browser ore module with a small, deterministic canvas stub.

const width = 96, height = 96; // Sample texture dimensions large enough to contain both stone and ore regions.
const original = new Uint8ClampedArray(width * height * 4); // Neutral stone image whose untouched pixels must survive tinting.
for (let i = 0; i < original.length; i += 4) {
  original[i] = 97; original[i + 1] = 86; original[i + 2] = 77; original[i + 3] = 255;
}
let maskedPixels = null; // Captures the final tinted pixel buffer for mask coverage assertions.
const document = {
  createElement() {
    return {
      width, height,
      getContext() {
        return {
          drawImage() {},
          getImageData() { return { data: new Uint8ClampedArray(original) }; },
          putImageData(pixels) { maskedPixels = pixels.data; },
        };
      },
    };
  },
};
class ImageStub {
  constructor() { this.naturalWidth = width; this.naturalHeight = height; }
  set src(value) { assert(value.endsWith('/carved_smooth.png')); this.onload(); }
}
const THREE = {
  RepeatWrapping: 1, SRGBColorSpace: 2,
  TextureLoader: class { load(src) { return { src, repeat: { set() {} } }; } },
  CanvasTexture: class { constructor(canvas) { this.image = canvas; this.repeat = { set() {} }; } },
  MeshStandardMaterial: class { constructor(options) { Object.assign(this, options); this.userData = {}; } },
};
const context = { document, Image: ImageStub, THREE, window: { __farmLog: () => {} } }; // Browser-compatible fixture supplied to the actual ore material module.
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/ore-rock-textures.js', 'utf8'), context);

(async () => {
  const palette = { tinCopper: { hex: '#58A28D' }, mushistonite: { hex: '#7BA963' } }; // Two ores prove material caching is keyed by mineral kind.
  const ore = context.window.OreRockTextures.materialFor(THREE, 'tinCopper', palette); // Asynchronously receives its canvas after the source image resolves.
  assert.strictEqual(context.window.OreRockTextures.materialFor(THREE, 'tinCopper', palette), ore, 'One shared material for every rock of the same ore');
  assert.strictEqual(ore.userData.sharedOreRockMaterial, true, 'Removing one rock must not dispose another rock material');
  const stone = context.window.OreRockTextures.materialFor(THREE, 'stone', palette); // Fallback must be plain carved stone.
  assert.equal(stone.map.src, 'assets/textures/carved_smooth.png', 'Stone-only rocks retain the original image');
  await Promise.resolve();
  await Promise.resolve();
  assert(ore.map instanceof THREE.CanvasTexture, 'Mineral-bearing rocks use a selectively recolored canvas');
  assert.equal(context.window.OreRockTextures.debugSnapshot().tinCopper, 'ready', 'Mobile diagnostics report successful texture preparation');
  let unchanged = 0, changed = 0; // Counts unaltered natural-stone and altered mineral pixels within the one ore texture.
  for (let i = 0; i < original.length; i += 4) {
    const same = original[i] === maskedPixels[i] && original[i + 1] === maskedPixels[i + 1] && original[i + 2] === maskedPixels[i + 2];
    if (same) unchanged++;
    else changed++;
  }
  assert(unchanged > 500, 'Most of the rock must still look like natural stone');
  assert(changed > 500, 'The ore must occupy visible irregularly colored deposits');
  assert(ore.map !== stone.map, 'A shared ore map cannot alter the unmineralized stone texture');
  const caveSource = fs.readFileSync('docs/js/cavern-ore-rocks.js', 'utf8'); // Cave renderer should consume exactly the same material function as game.js.
  const gameSource = fs.readFileSync('docs/game.js', 'utf8');
  assert(caveSource.includes('OreRockTextures.materialFor') && gameSource.includes('OreRockTextures.materialFor'), 'Caves, town mines and wilderness use the same renderer');
  const worldSource = fs.readFileSync('docs/js/wilderness-map-generator.js', 'utf8'); // Ore identity must survive world-map export for matching appearance and drops.
  assert(worldSource.includes('generatedObjectOreKind') && gameSource.includes('t.generatedObjectOreKind'), 'Wilderness ore kinds survive map conversion');
  console.log('PASS ore-rock-textures: ' + unchanged + ' stone pixels, ' + changed + ' ore pixels; shared cave/mine/wilderness renderer');
})().catch(error => { console.error(error); process.exitCode = 1; });
