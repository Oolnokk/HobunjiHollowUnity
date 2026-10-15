#!/usr/bin/env node
'use strict';

// Runs the real CreatureGeneticsRender + Voorg-Ass registration: the base
// allele recolors only the authored #99BF99 coat family, leaves unrelated
// sprite detail untouched, and goes through the renderer's recolor cache
// (no per-compose full-frame pixel pass).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const WIDTH = 3; // coat key pixel, low-saturation highlight, unrelated red detail
const HEIGHT = 1;
const SOURCE = [[0x99, 0xBF, 0x99], [0xEE, 0xEE, 0xEE], [0xC0, 0x40, 0x40]];

function pixelsFor(url) {
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4); // Overlays (belly/eyes) stay transparent in this fixture.
  if (!url.includes('voorg-ass_idle')) return pixels;
  SOURCE.forEach((rgb, x) => pixels.set([...rgb, 255], x * 4));
  return pixels;
}

class FakeCanvas {
  constructor() { this.width = WIDTH; this.height = HEIGHT; this.pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4); }
  getContext() {
    return {
      drawImage: source => {
        for (let i = 0; i < source.pixels.length; i += 4) if (source.pixels[i + 3]) this.pixels.set(source.pixels.slice(i, i + 4), i);
      },
      getImageData: () => ({ data: new Uint8ClampedArray(this.pixels) }),
      putImageData: data => { this.pixels = new Uint8ClampedArray(data.data); },
    };
  }
}

class FakeImage {
  constructor() { this.naturalWidth = WIDTH; this.naturalHeight = HEIGHT; this.pixels = pixelsFor(''); }
  set src(url) { this.pixels = pixelsFor(url); queueMicrotask(() => this.onload?.()); }
}

const context = {
  console,
  document: { createElement: tag => tag === 'canvas' ? new FakeCanvas() : null, addEventListener() {} },
  Image: FakeImage,
  performance: { now: () => 0 },
  fetch: async () => ({ json: async () => ({}) }), // No authored base masks: Voorg-Ass relies on its source key.
  window: { SCRATCHBONES_CONFIG: { game: {} }, __farmLog: () => {}, addEventListener() {} },
};
vm.runInNewContext(fs.readFileSync('docs/js/color-fill.js', 'utf8'), context);
vm.runInNewContext(fs.readFileSync('docs/js/creature-genetics-render.js', 'utf8'), context);
vm.runInNewContext(fs.readFileSync('docs/js/voorg-ass-registration.js', 'utf8'), context);

const W = context.window;
const shared = W.ColorFill.shadeFillPixels; // Counts real shade-fill passes to prove cache reuse.
let keyedPasses = 0;
W.ColorFill = { ...W.ColorFill, shadeFillPixels: Object.assign(function (...args) { // ColorFill is frozen; the renderer reads window.ColorFill per call.
  if (String(args[2]?.debugLabel || '').includes('hex-target')) keyedPasses++;
  return shared.apply(this, args);
}, shared) };

assert.equal(W.VoorgAssRegistration.ensureRendererSpecies(W.CreatureGeneticsRender.SPECIES), true);
const originalComposeFrame = W.CreatureGeneticsRender.composeFrame;

(async () => {
  const genotype = { base: { color: '#336699' }, belly: { color: '#ffffff', enabled: true } };
  const first = await W.CreatureGeneticsRender.composeFrame('voorg-ass', 'idle', genotype);
  const rgbAt = (canvas, x) => Array.from(canvas.pixels.slice(x * 4, x * 4 + 3));
  assert.notDeepEqual(rgbAt(first, 0), SOURCE[0], 'the #99BF99 coat pixel takes the base allele color');
  assert(rgbAt(first, 0)[2] > rgbAt(first, 0)[0], 'the coat pixel is tinted toward the blue base allele');
  assert.deepEqual(rgbAt(first, 1), SOURCE[1], 'low-saturation highlights stay authored');
  assert.deepEqual(rgbAt(first, 2), SOURCE[2], 'unrelated hues stay authored');
  assert.equal(keyedPasses, 1, 'one keyed recolor pass for the first compose');

  const second = await W.CreatureGeneticsRender.composeFrame('voorg-ass', 'idle', genotype);
  assert.deepEqual(Array.from(second.pixels), Array.from(first.pixels), 'repeat composes are identical');
  assert.equal(keyedPasses, 1, 'repeat composes reuse the cached recolored base');
  assert.equal(W.CreatureGeneticsRender.composeFrame, originalComposeFrame, 'Voorg-Ass no longer wraps the shared compositor');
  assert.deepEqual(genotype.base, { color: '#336699' }, 'rendering does not mutate the inherited genotype');
  console.log('Voorg-Ass keyed coat recolor tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
