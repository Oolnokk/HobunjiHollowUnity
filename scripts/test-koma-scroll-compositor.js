'use strict';
const assert = require('node:assert/strict'); // Verifies actual layered sprite compositor behavior without requiring a browser.
const fs = require('node:fs'); // Reads the shipped SpriteRecolor implementation, not a rewritten model.
const vm = require('node:vm'); // Runs the real browser module against a small observable canvas surface.

const images = []; // Captures unique PNG source requests to enforce sharing between icon uses.
const tints = []; // Captures the exact two shade-fill targets, paper and binding.
const paint = []; // Captures compositing modes and alpha for source clipping and layering.
let nextCanvas = 0; // Stable identity makes the returned cached canvas observable.
class FakeImage {
  constructor() { this.naturalWidth = 8; this.naturalHeight = 8; }
  set src(value) {
    this.url = value;
    images.push(value);
    queueMicrotask(() => this.onload?.()); // Mimics image decode completion after the caller installs onload.
  }
  get src() { return this.url; }
}
function canvas() {
  const id = ++nextCanvas; // Per-canvas ID distinguishes scratch tinted layers from the returned composited art.
  const element = { width: 0, height: 0 };
  const context = {
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    drawImage(image, ...args) {
      paint.push({ canvas: id, source: image.url || image.canvasId || 'unknown', args,
        alpha: this.globalAlpha, mode: this.globalCompositeOperation });
    },
    getImageData() { return { data: new Uint8ClampedArray(element.width * element.height * 4) }; },
    putImageData() {},
    save() { this._saved = [this.globalAlpha, this.globalCompositeOperation]; },
    restore() { [this.globalAlpha, this.globalCompositeOperation] = this._saved; },
  };
  element.canvasId = id;
  element.getContext = () => context;
  return element;
}
const document = {
  getElementById: () => null, // The module's optional fishing-loader bridge is unrelated to item recoloring.
  createElement: type => { assert.equal(type, 'canvas'); return canvas(); },
};
const window = {
  ColorFill: {
    shadeFillPixels(_pixels, rgb) { tints.push(rgb.slice()); }, // Exact paper/ribbon RGB calls from the real code.
    shadeFillConfig: () => ({}), relativeLuminance: () => 0,
    rgbToHsv: () => ({ h: 0, s: 0, v: 0 }),
    hsvToRgb: () => [0, 0, 0], hueDistance: () => 0,
  },
  __farmLog() {},
};
const source = fs.readFileSync('docs/js/sprite-recolor.js', 'utf8'); // Production shader-layer code under review.
vm.runInNewContext(source, { window, document, Image: FakeImage, console, Promise, Uint8ClampedArray, queueMicrotask });
const api = window.SpriteRecolor; // Runtime public texture API called by both inventory icons and held items.
(async () => {
  const scrollPath = 'assets/objectsprites/scroll.png'; // The same URL game.js constructs for an item with spriteIcon='scroll.png'.
  const first = await api.getRecoloredCanvas(scrollPath, 0xE7D5AF, 'layered-scroll:7cff4f');
  assert.deepEqual(tints.slice(0, 2), [[231, 213, 175], [124, 255, 79]], 'Paper and Held 2 binding must be dyed independently');
  assert.equal(first.width, 8);
  assert.equal(first.height, 8);
  assert.ok(paint.some(step => step.source === 'assets/objectsprites/scroll_binding.png'), 'Separate scroll binding source is drawn');
  const before = { paints: paint.length, loads: images.length };
  assert.strictEqual(await api.getRecoloredCanvas(scrollPath, 0xE7D5AF, 'layered-scroll:7cff4f'), first, 'Pack and held item share one cached composite');
  assert.equal(paint.length, before.paints, 'Repeated HUD draws must not generate extra canvases');
  assert.equal(images.length, before.loads, 'Repeated HUD draws must not trigger extra image decodes');
  const pink = await api.getRecoloredCanvas(scrollPath, 0xE7D5AF, 'layered-scroll:ff4fd8');
  assert.notStrictEqual(pink, first, 'Different attack categories must not share a stale binding tint');
  assert.deepEqual(tints.slice(-2), [[231, 213, 175], [255, 79, 216]]);
  assert.equal(images.filter(path => path.endsWith('scroll.png')).length, 1, 'All bindings share one source-paper decode');
  assert.equal(images.filter(path => path.endsWith('scroll_binding.png')).length, 1, 'All bindings share one ribbon image decode');

  const powder = await api.getRecoloredCanvas('assets/objectsprites/powder.png', 0xF8F6F5, 'direct-sheen');
  assert.equal(powder.width, 8);
  const sheenPass = paint.find(step => step.source === 'assets/objectsprites/iridescent_sheen.png');
  assert.equal(sheenPass?.mode, 'source-atop', 'Iridescence must be clipped to the solid powder');
  assert.equal(sheenPass?.alpha, 0.34, 'Sheen cannot overpower the recolored pale powder');
  assert.deepEqual(tints.slice(-1), [[248, 246, 245]]);
  console.log('Scroll paper, independent reticle-colored bindings, cache reuse and clipped Koma sheen passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
