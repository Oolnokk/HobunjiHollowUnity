'use strict';
const assert = require('assert'); // Verifies the production dye/layout path without browser dependencies.
const fs = require('fs'); // Reads the actual registered garment configs.
const vm = require('vm'); // Runs the same compositor used in game and by the loom.
const draws = [], tints = []; // Records placement and per-layer dye operations for assertions below.
const document = {
  currentScript: { src: 'https://example.test/docs/js/clothing-weaving-system.js' },
  documentElement: { dataset: {} }, body: { dataset: {} }, head: { appendChild() {} },
  addEventListener() {}, querySelectorAll() { return []; }, getElementById() { return null; },
  createElement(tag) {
    if (tag !== 'canvas') return { style: {}, dataset: {} };
    const canvas = { width: 0, height: 0 }; // Minimal canvas surface exercises composition calls and dimensions.
    canvas.getContext = () => ({
      drawImage(...args) { draws.push(args); },
      getImageData() { return { data: new Uint8ClampedArray(4) }; }, putImageData() {},
    });
    return canvas;
  },
};
const window = {
  setInterval() {}, setTimeout() {},
  loadImg(url) { return Promise.resolve({ width: url.endsWith('pants_basic.png') ? 500 : 519, height: url.endsWith('pants_basic.png') ? 500 : 360, url }); },
  SpriteRecolor: { recolorImageData(data, tint) { tints.push(tint); } },
}; // Production image loading returns authored source dimensions; recoloring records the requested dye.
const context = vm.createContext({
  window, document, console, URL, MutationObserver: class { observe() {} },
  fetch: async url => ({ ok: true, json: async () => JSON.parse(fs.readFileSync('docs/' + new URL(url).pathname.split('/docs/')[1], 'utf8')) }),
}); // Supplies local repository JSON through the normal fetch/config cache.
vm.runInContext(fs.readFileSync('docs/js/clothing-weaving-system.js', 'utf8'), context);
(async () => {
  const api = window.ClothingWeavingSystem; // Uses the public entry points called by the pants renderer and loom.
  const result = await api.renderClothingLayers('draped_pants', { primaryHex: '#112233', secondaryHex: '#aabbcc' }); // Different dyes must reach the two independent sprite layers.
  assert.deepStrictEqual(tints, [0x112233, 0xaabbcc]);
  assert.strictEqual(result.canvas.width, 500);
  assert.strictEqual(result.canvas.height, 500);
  assert(draws.some(args => args[0].url?.endsWith('draped_pants-drape.png') && args[1] === 5 && args[2] === 80 && args[3] === 500), 'new source art is aligned before tint/composition');
  assert.strictEqual(await api.hasSecondaryDyeForItem({ cosmeticId: 'draped_pants' }), true);
  assert.strictEqual(await api.hasSecondaryDyeForItem({ cosmeticId: 'layered_skirt' }), false);
  const skirt = await api.renderClothingLayers('layered_skirt', { primaryHex: '#445566' }); // Single-dye skirts use the identical normalized rig canvas.
  assert.strictEqual(skirt.canvas.width, 500);
  assert.strictEqual(skirt.canvas.height, 500);
  assert.strictEqual(tints.at(-1), 0x445566);
  console.log('Layered leg garment dye/layout composition: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
