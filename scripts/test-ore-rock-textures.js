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
  RepeatWrapping: 1, SRGBColorSpace: 2, sRGBEncoding: 3001, // The shipped Three r128 uses sRGBEncoding instead of colorSpace.
  TextureLoader: class { load(src) { return { src, repeat: { set(x, y) { this.x = x; this.y = y; } } }; } },
  CanvasTexture: class { constructor(canvas) { this.image = canvas; this.repeat = { set() {} }; } },
  MeshBasicMaterial: class { constructor(options) { Object.assign(this, options); this.userData = {}; } }, // Ore rock colors must remain visible without cave lighting.
};
const context = { document, Image: ImageStub, THREE, window: { __farmLog: () => {} } }; // Browser-compatible fixture supplied to the actual ore material module.
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/ore-rock-textures.js', 'utf8'), context);

(async () => {
  const palette = { copper: { hex: '#B87333', verdigrisHex: '#3FAF9F' }, tinCopper: { hex: '#58A28D', verdigrisHex: null }, mushistonite: { hex: '#7BA963' } }; // Tests both defined verdigris and ordinary mineral colors.
  const ore = context.window.OreRockTextures.materialFor(THREE, 'tinCopper', palette); // Asynchronously receives its canvas after the source image resolves.
  assert.strictEqual(context.window.OreRockTextures.materialFor(THREE, 'tinCopper', palette), ore, 'One shared material for every rock of the same ore');
  assert.strictEqual(ore.userData.sharedOreRockMaterial, true, 'Removing one rock must not dispose another rock material');
  const stone = context.window.OreRockTextures.materialFor(THREE, 'stone', palette); // Fallback must be plain carved stone.
  assert.equal(stone.map.src, 'assets/textures/carved_smooth.png', 'Stone-only rocks retain the original image');
  assert.deepStrictEqual([stone.map.repeat.x, stone.map.repeat.y], [1, 1], 'The loading/stone fallback must use the same full PNG crop as the mineral canvas');
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
  const shade = 0.78 + ((97 + 86 + 77) / (3 * 255)) * 0.56; // Expected shading of the fixture's uniform stone pixels.
  const shadedColor = hex => [1, 3, 5].map(offset => Math.round(parseInt(hex.slice(offset, offset + 2), 16) * shade)); // Matches the production mineral shading for this non-clipping fixture.
  const firstMineralColor = pixels => {
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] !== original[i] || pixels[i + 1] !== original[i + 1] || pixels[i + 2] !== original[i + 2]) {
        return [pixels[i], pixels[i + 1], pixels[i + 2]];
      }
    }
    return null;
  };
  assert.deepStrictEqual(firstMineralColor(maskedPixels), shadedColor(palette.tinCopper.hex), 'Ores without verdigris retain their ordinary mineral color');
  const copper = context.window.OreRockTextures.materialFor(THREE, 'copper', palette); // A real oxidizing ore must display its verdigris rather than freshly forged copper.
  await Promise.resolve();
  await Promise.resolve();
  assert(copper.map instanceof THREE.CanvasTexture, 'Copper also receives a masked ore texture');
  assert.strictEqual(copper.map.encoding, THREE.sRGBEncoding, 'Three r128 receives the sRGB encoding required to display verdigris accurately');
  assert(copper instanceof THREE.MeshBasicMaterial, 'Ore uses the unlit authored cliff texture treatment');
  assert.strictEqual(context.window.OreRockTextures.materialFor(THREE, 'copper', palette), copper, 'Copper material is also cached');
  assert.deepStrictEqual(firstMineralColor(maskedPixels), shadedColor(palette.copper.verdigrisHex), 'Copper vein pixels should use its existing verdigris hue');
  assert.notDeepStrictEqual(firstMineralColor(maskedPixels), shadedColor(palette.copper.hex), 'Copper veins must not use the freshly forged metal hue');
  assert.equal(context.window.OreRockTextures.debugSnapshot().copper, 'ready', 'Mobile diagnostics show copper texture preparation');
  let disposedCount = 0; // Proves the indexed source geometry is released exactly once after converting into facet-seamed triangles.
  const mappedRock = { isMesh: true, geometry: { dispose() { disposedCount++; } }, userData: {} }; // Synthetic mineable rock exercises the actual ownership transition.
  let mappingOptions = null; // Captures production mapping options without requiring WebGL in Node.
  context.window.HobunjiSurfaceStretchUV = { mapMesh(mesh, options) { mappingOptions = options; mesh.geometry = { userData: {} }; return { patchCount: 3, fallbackCount: 0 }; } };
  assert(context.window.OreRockTextures.fitRockMesh(mappedRock, 'test'), 'Ore rock helper uses the installed surface mapper');
  assert.equal(mappingOptions.edgeReferenceWorldSize, 1, 'Mineral faces preserve a one-tile native source border, not the six-tile cliff default');
  assert.strictEqual(mappingOptions.preserveQuadPairs, true, 'Mound mapping must rescue irregular stone faces using their original quadrilateral topology');
  assert(mappedRock.userData.oreRockSurfaceMapped, 'Mapped faces expose Pixel Probe metadata');
  assert.strictEqual(mappedRock.userData.terrainJigsawIgnore, true, 'Terrain Jigsaw must not silently overwrite finished nine-slice mineral UVs');
  assert.strictEqual(mappedRock.userData.naturalSurfaceUvOwner, 'HobunjiSurfaceStretchUV', 'The cliff UV solver remains the authoritative owner');
  assert.strictEqual(disposedCount, 1, 'Replaced rock geometry releases old GPU resources without double disposal');
  assert.equal(context.window.OreRockTextures.debugSnapshot()._surfaceMapping.surfaces, 3, 'Mobile diagnostics report recognized facet count');
  const caveSource = fs.readFileSync('docs/js/cavern-ore-rocks.js', 'utf8'); // Cave renderer should consume exactly the same material function as game.js.
  const gameSource = fs.readFileSync('docs/game.js', 'utf8');
  const farmSource = fs.readFileSync('docs/js/vegetation-crop-rendering.js', 'utf8'); // Detects future regressions where farm mounds map before their final material styling.
  const farmFinalSource = fs.readFileSync('docs/js/faceted-natural-surface-shell-reduction.js', 'utf8');
  assert(farmSource.includes('farmLooseRockMound') && farmFinalSource.includes('if (object.userData?.farmLooseRockMound && !object.userData?.oreRockSurfaceMapped) window.OreRockTextures?.fitRockMesh'), 'Farm surfaces map only after their final natural-surface material pass');
  assert(caveSource.includes('OreRockTextures.materialFor') && gameSource.includes('OreRockTextures.materialFor'), 'Caves, town mines and wilderness use the same renderer');
  assert(caveSource.includes('OreRockTextures.fitRockMesh') && gameSource.includes('OreRockTextures.fitRockMesh'), 'All three mineral rock settings use the same connected-face UV mapper');
  assert(gameSource.includes('verdigrisHex: METAL_DEFS.lowTinBronze.verdigrisHex') && gameSource.includes('verdigrisHex: METAL_DEFS.tinBronze.verdigrisHex'), 'Both bronze-bearing ores follow the authored bronze alloy verdigris palettes');
  const paletteDeclarations = gameSource.slice(gameSource.indexOf('      const METAL_DEFS = {'), gameSource.indexOf('      const METAL_BAR_RECIPES = {')); // Isolate the real palette literals without executing gameplay.
  const actual = vm.runInNewContext(paletteDeclarations + '\n({ metals: METAL_DEFS, ores: ORE_DEFS })'); // Uses actual production alloy hues, not a replicated test constant.
  for (const [alias, oreKey, metalKey] of [['crudeBronzeRendered', 'tinCopper', 'lowTinBronze'], ['naturalBronzeRendered', 'mushistonite', 'tinBronze']]) {
    const ore = context.window.OreRockTextures.materialFor(THREE, alias, { [alias]: actual.ores[oreKey] }); // Unique key keeps the earlier independent mock-palette cache untouched.
    await Promise.resolve();
    await Promise.resolve();
    assert(ore.map instanceof THREE.CanvasTexture, oreKey + ' should receive a mineral texture');
    assert.deepStrictEqual(firstMineralColor(maskedPixels), shadedColor(actual.metals[metalKey].verdigrisHex), oreKey + ' must show its bronze verdigris in actual pixels');
    assert.notDeepStrictEqual(firstMineralColor(maskedPixels), shadedColor(actual.ores[oreKey].hex), oreKey + ' must not show its raw inventory hue on the rock');
  }

  const worldSource = fs.readFileSync('docs/js/wilderness-map-generator.js', 'utf8'); // Ore identity must survive world-map export for matching appearance and drops.
  assert(worldSource.includes('generatedObjectOreKind') && gameSource.includes('t.generatedObjectOreKind'), 'Wilderness ore kinds survive map conversion');
  console.log('PASS ore-rock-textures: ' + unchanged + ' stone pixels, ' + changed + ' ore pixels; shared cave/mine/wilderness renderer');
})().catch(error => { console.error(error); process.exitCode = 1; });
