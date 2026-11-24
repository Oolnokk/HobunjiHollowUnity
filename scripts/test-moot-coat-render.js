#!/usr/bin/env node
'use strict';

// Exercises the real composite path, not only the pattern URL and genotype
// registry: Moot overcoat redraws neutral teeth/hooves/ink, which must not be
// recolored when its mint body pigments take the inherited overcoat color.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const WIDTH = 6; // Five real animal samples plus one outside-silhouette black background pixel.
const HEIGHT = 1; // A tiny transparent RGBA canvas keeps this browser-free test cheap.
const COAT = [0x9C, 0xBD, 0x9E]; // Exact native Moot coat pigment, used by keyed recoloring.
const TOOTH = [0xE4, 0xDD, 0xCB]; // Neutral ivory inside the opaque overcoat sprite.
const HOOF = [0x66, 0x67, 0x69]; // Neutral grey inside the opaque overcoat sprite.
const INK = [0x19, 0x19, 0x19]; // Near-black authored outline.
const regions = [COAT, TOOTH, HOOF, INK, COAT]; // Base sprite contains a matching full animal silhouette.

function pixelsFor(url) {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4); // Transparent unless the requested authored artwork covers this region.
  if (/moot_overcoat_idle/.test(url)) {
    for (let x = 0; x < 4; x++) data.set([...regions[x], 255], x * 4);
    data.set([...INK, 255], 20); // Authored black overcoat padding outside the actual body must never become a halo.
  } else if (/moot_mitts_idle/.test(url)) {
    data.set([...COAT, 255], 16);
  } else if (/moot_idle/.test(url)) {
    regions.forEach((rgb, x) => data.set([...rgb, 255], x * 4));
  }
  return data;
}
class Canvas {
  constructor() { this.width = WIDTH; this.height = HEIGHT; this.pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4); }
  getContext() {
    const context = { // A minimal 2D context supporting the source-atop silhouette clip used by the real compositor.
      globalCompositeOperation: 'source-over',
      drawImage: src => {
        for (let i = 0; i < src.pixels.length; i += 4) {
          if (src.pixels[i + 3] !== 255) continue;
          if (context.globalCompositeOperation === 'source-atop' && !this.pixels[i + 3]) continue;
          this.pixels.set(src.pixels.slice(i, i + 4), i);
        }
      },
      getImageData: () => ({ data: new Uint8ClampedArray(this.pixels) }),
      putImageData: imageData => { this.pixels = new Uint8ClampedArray(imageData.data); },
    };
    return context; // The compositor calls context.drawImage after creation; never return undefined from the fake canvas.
  }
}
class Image {
  constructor() { this.naturalWidth = WIDTH; this.naturalHeight = HEIGHT; this.pixels = pixelsFor(''); }
  set src(url) { this.pixels = pixelsFor(url); queueMicrotask(() => this.onload?.()); }
}
const W = {
  SCRATCHBONES_CONFIG: { game: { livestock: { itemKinds: {}, animalWidths: {}, diet: {}, resources: {} }, wildlife: { denMothers: {} } } },
  addEventListener() {},
  __farmLog() {},
}; // Runtime registries under test retain the real module initialization order.
const context = { window: W, document: { createElement: () => new Canvas(), currentScript: null, addEventListener() {} },
  Image, fetch: async () => ({ json: async () => ({}) }), performance: { now: () => 0 }, console, queueMicrotask }; // No desktop browser or GPU needed.
vm.runInNewContext(fs.readFileSync('docs/js/color-fill.js', 'utf8'), context);
vm.runInNewContext(fs.readFileSync('docs/js/creature-genetics-render.js', 'utf8'), context);
vm.runInNewContext(fs.readFileSync('docs/js/moot-registration.js', 'utf8'), context);
assert.equal(W.MootRegistration.ensureRendererSpecies(), true);

(async () => {
  const genotype = {
    base: { color: '#A57348', copies: 2 },
    overcoat: { color: '#3366B9', copies: 2, enabled: true },
    mitts: { color: '#D4A640', copies: 1, enabled: true },
  }; // The first pattern supplies B; obsolete mitt pigment must be ignored.
  const first = await W.CreatureGeneticsRender.composeFrame('moot', 'idle', genotype);
  const rgb = (canvas, x) => Array.from(canvas.pixels.subarray(4 * x, 4 * x + 3));
  assert(rgb(first, 0)[2] > rgb(first, 0)[0], 'overcoat mint pigment must take its blue allele');
  assert.deepEqual(rgb(first, 1), TOOTH, 'ivory tooth in overcoat source must stay ivory');
  assert.deepEqual(rgb(first, 2), HOOF, 'grey hoof in overcoat source must stay grey');
  assert.deepEqual(rgb(first, 3), INK, 'near-black artist outline in overcoat source must stay intact');
  assert.equal(first.pixels[5 * 4 + 3], 0, 'black overcoat pixels outside the animal silhouette must remain transparent');
  assert(rgb(first, 4)[2] > rgb(first, 4)[0], 'mitt shares the blue B pigment from overcoat, ignoring obsolete warm pigment');
  const explicit = await W.CreatureGeneticsRender.composeFrame('moot', 'idle', { ...genotype, secondary: { color: '#D4A640' } });
  assert(rgb(explicit, 0)[0] > rgb(explicit, 0)[2], 'explicit B recolors the overcoat');
  assert(rgb(explicit, 4)[0] > rgb(explicit, 4)[2], 'explicit B recolors the mitts too');
  const firstPixels = Array.from(first.pixels); // Used to prove cached repeated compositions return identical pixels.
  const second = await W.CreatureGeneticsRender.composeFrame('moot', 'idle', genotype);
  assert.deepEqual(Array.from(second.pixels), firstPixels, 'repeat rendering is pixel-stable');
  assert.equal(W.CreatureGeneticsRender.patternUrl('moot', 'overcoat', 'run2'),
    'assets/creaturesprites/patterns/moot_overcoat_run2.png');
  assert.equal(W.CreatureGeneticsRender.patternUrl('moot', 'mitts', 'run1'),
    'assets/creaturesprites/patterns/moot_mitts_run1.png');
  console.log('PASS Moot overcoat selective tint, silhouette clipping, and shared secondary pigment');
})().catch(err => { console.error(err); process.exitCode = 1; });
