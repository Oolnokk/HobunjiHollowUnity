'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/portrait-utils.js', 'utf8');
const a = source.indexOf('class PortraitPixelCache'), b = source.indexOf('const DEFAULT_BEHIND_LAYER_ORDER', a);
const pending = [];
class ImageMock {
  constructor() { this.naturalWidth = 1024; this.naturalHeight = 1024; }
  set src(url) { this.url = url; pending.push(this); }
}
const context = {
  Map, Image: ImageMock, URL, _puAssetBase: './assets/', window: {},
  document: { baseURI: 'https://example.test/docs/index.html', createElement: () => ({
    getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray([100, 80, 60, 255]) }), putImageData() {} }),
  }) },
  getPortraitTintingConfig: () => ({}), isEffectivelyZeroSaturation: () => false,
  colorFillApi: () => ({ shadeFillPixels(data, rgb) { data[0] = rgb[0]; } }),
};
vm.runInNewContext(source.slice(a, b) + '\nthis.PixelCache = PortraitPixelCache; this.images = IMG_CACHE;', context);
const cache = new context.PixelCache(8 * 1024 * 1024, 8);
const first = { width: 1024, height: 1024 };
cache.set('first', first); cache.set('second', { width: 1024, height: 1024 });
cache.get('first'); cache.set('third', { width: 1024, height: 1024 });
assert.equal(cache.has('first'), true, 'recently used pixels survive eviction');
assert.equal(cache.has('second'), false);
for (let i = 0; i < 1000; i++) cache.set(`traveller-${i}`, { width: 1024, height: 1024 });
assert.equal(cache.size, 2);
assert.equal(cache.pixelBytes, 8 * 1024 * 1024);
assert.equal(first.width, 1024, 'eviction does not resize pixels retained by a live render');
cache.set('oversized', { width: 4096, height: 4096 });
assert.equal(cache.size, 0, 'an oversized canvas is returned to its caller but not cached');
cache.set('replace', first); cache.set('replace', { width: 1, height: 1 });
assert.equal(cache.pixelBytes, 4);
cache.clear(); assert.equal(cache.pixelBytes, 0);
for (let i = 0; i < 30; i++) cache.set(i, Promise.resolve());
assert.equal(cache.size, 8, 'pending requests are bounded by count');

const loaderA = source.indexOf('function loadImg('), loaderB = source.indexOf('// ── CSS filter helpers', loaderA);
vm.runInNewContext(source.slice(loaderA, loaderB) + '\nthis.load = loadImg;', context);
const shadeA = source.indexOf('const _SHADE_FILL_CACHE'), shadeB = source.indexOf('function _imageForTint', shadeA);
vm.runInNewContext(source.slice(shadeA, shadeB) + '\nthis.tint = getShadeFillCanvas; this.shade = _SHADE_FILL_CACHE;', context);
(async () => {
  const live = context.tint(first, 'sprite', { mode: 'shadeFill', rgb: [20, 30, 40], options: { cacheEnabled: true } });
  for (let i = 0; i < 100; i++) context.tint(first, 'sprite', { mode: 'shadeFill', rgb: [i, 30, 40], options: { cacheEnabled: true } });
  assert.equal(context.shade.size, 3, 'real tint rendering obeys its twelve MiB budget');
  assert.equal(live.width, 1024); assert.equal(live.height, 1024);
  const load = context.load('old.png');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending[0].crossOrigin, 'anonymous');
  context.images.clear(); pending.shift().onload();
  assert(await load instanceof ImageMock);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.images.size, 0, 'late successful loads cannot resurrect a cleared cache');
  for (let i = 0; i < 30; i++) {
    const p = context.load(`new-${i}.png`);
    await new Promise(resolve => setImmediate(resolve));
    pending.shift().onload(); await p;
  }
  assert.equal(context.images.size, 12, 'decoded source images obey their forty-eight MiB budget');
  assert.equal(context.images.pixelBytes, 48 * 1024 * 1024);
  console.log('portrait pixel budgets, live pixel preservation and stale load rejection passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
