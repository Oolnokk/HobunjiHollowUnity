#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const WIDTH = 3; // Three probe pixels isolate bodystripes, another pattern, and unobstructed base.
const HEIGHT = 1; // A single row is sufficient for compositor color-role validation.
const NEUTRAL = 128; // Matches the injected neutral luminance so recoloring produces exact target RGB values.

function rgbaPixels(opaqueIndex = null) {
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4); // Used as one mocked sprite or pattern image.
  for (let x = 0; x < WIDTH; x++) {
    const i = x * 4;
    pixels.set([NEUTRAL, NEUTRAL, NEUTRAL, opaqueIndex === null || x === opaqueIndex ? 255 : 0], i);
  }
  return pixels;
}

class FakeCanvas {
  constructor() {
    this.width = WIDTH;
    this.height = HEIGHT;
    this.pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4); // Stores the composited result read by assertions.
  }

  getContext() {
    return {
      drawImage: source => {
        const sourcePixels = source.pixels; // Supplies either a mocked image or recolored intermediate canvas.
        for (let i = 0; i < sourcePixels.length; i += 4) {
          if (sourcePixels[i + 3] === 0) continue;
          this.pixels.set(sourcePixels.slice(i, i + 4), i);
        }
      },
      getImageData: () => ({ data: new Uint8ClampedArray(this.pixels) }),
      putImageData: data => { this.pixels = new Uint8ClampedArray(data.data); },
    };
  }
}

class FakeImage {
  constructor() {
    this.naturalWidth = WIDTH;
    this.naturalHeight = HEIGHT;
    this.pixels = rgbaPixels(); // Replaced by the URL-specific mask in the src setter.
  }

  set src(url) {
    this.pixels = url.includes('bodystripes') ? rgbaPixels(0)
      : url.includes('spectacles') ? rgbaPixels(1)
        : rgbaPixels();
    queueMicrotask(() => this.onload?.());
  }
}

const context = {
  console,
  document: { createElement: tag => tag === 'canvas' ? new FakeCanvas() : null },
  Image: FakeImage,
  performance: { now: () => 0 },
  fetch: async () => ({
    json: async () => ({
      drenkirra: { idle: { width: WIDTH, height: HEIGHT, encoding: 'selected-pixel-index-runs-v1', runs: [0, WIDTH] } },
    }),
  }),
  window: {
    SCRATCHBONES_CONFIG: { game: { portrait: { tinting: { neutralLuminance: NEUTRAL / 255 } } } },
    __farmLog: () => {},
  },
};
vm.runInNewContext(fs.readFileSync('docs/js/creature-genetics-render.js', 'utf8'), context);

(async () => {
  const genotype = { // Uses distinct colors so each combined-pattern role can be identified independently.
    base: { color: '#112233' },
    bodystripes: { color: '#aabbcc', copies: 1, enabled: true },
    spectacles: { color: '#ff5500', copies: 1, enabled: true },
  };
  const canvas = await context.window.CreatureGeneticsRender.composeFrame('drenkirra', 'idle', genotype);
  const rgbAt = x => Array.from(canvas.pixels.slice(x * 4, x * 4 + 3)); // Reads one isolated output region.

  assert.deepEqual(rgbAt(0), [0x11, 0x22, 0x33], 'bodystripes use the stored base color');
  assert.deepEqual(rgbAt(1), [0xff, 0x55, 0x00], 'other combined patterns retain their normal pattern color');
  assert.deepEqual(rgbAt(2), [0xaa, 0xbb, 0xcc], 'unstriped body uses the bodystripes pattern color');
  assert.equal(genotype.base.color, '#112233', 'rendering does not mutate inherited base color');
  assert.equal(genotype.bodystripes.color, '#aabbcc', 'rendering does not mutate inherited pattern color');

  const carriedOnly = { // Confirms an unexpressed bodystripes allele does not invert the visible base.
    base: { color: '#112233' },
    bodystripes: { color: '#aabbcc', copies: 1, enabled: false },
  };
  const carriedCanvas = await context.window.CreatureGeneticsRender.composeFrame('drenkirra', 'idle', carriedOnly);
  assert.deepEqual(Array.from(carriedCanvas.pixels.slice(8, 11)), [0x11, 0x22, 0x33],
    'carried but unexpressed bodystripes leave the base color unchanged');

  console.log('Drenkirra bodystripes color tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
