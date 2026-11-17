#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const rendererSource = fs.readFileSync('docs/js/creature-genetics-render.js', 'utf8'); // The shipped compositor is exercised, not a duplicate algorithm.
const sampleGenes = { base: { color: '#775533' }, colorpoint: { copies: 1, enabled: true, color: '#ddaa88' } }; // Expresses a base coat, a required pattern, and the species' always-on eyes.

function makeHarness(options = {}) {
  let imageAttempts = 0; // Counts loads of the asset chosen to fail once so a poisoned image promise is detectable.
  let maskAttempts = 0; // Ensures a failed mask fetch never becomes a permanent empty successful response.
  let shadeCalls = 0; // Confirms successful retries still recolor, rather than silently returning native base art.
  const messages = []; // Mobile-style warnings are captured to ensure failures remain diagnosable.

  class TestCanvas {
    constructor() {
      this.width = 2; this.height = 1;
      this.draws = []; // Records actual drawn base/pattern/eye layers for completeness checks.
      this.pixels = new Uint8ClampedArray([128, 128, 128, 255, 128, 128, 128, 255]);
    }
    getContext() {
      return {
        drawImage: source => { this.draws.push(...(source.draws || [source.url || 'unknown'])); },
        getImageData: () => ({ data: new Uint8ClampedArray(this.pixels) }),
        putImageData: image => { this.pixels = new Uint8ClampedArray(image.data); },
      };
    }
  }
  class TestImage {
    constructor() { this.naturalWidth = 2; this.naturalHeight = 1; }
    set src(value) {
      this.url = value;
      queueMicrotask(() => {
        if (value.includes(options.failImage || '<never>') && ++imageAttempts === 1) this.onerror?.(new Error('transient image error'));
        else this.onload?.();
      });
    }
  }
  const env = {
    window: {
      ColorFill: { shadeFillPixels() { shadeCalls++; } }, // Reuse the public pixel-compositor contract without needing an actual browser.
      __farmLog(message) { messages.push(message); },
    },
    Image: TestImage,
    document: { createElement: tag => tag === 'canvas' ? new TestCanvas() : null },
    performance: { now: () => 0 },
    fetch: async () => {
      maskAttempts++;
      if (options.failMasksOnce && maskAttempts === 1) throw new Error('transient mask request error');
      return { ok: true, json: async () => ({
        'gar-wolf': { idle: { encoding: 'selected-pixel-index-runs-v1', width: 2, height: 1, runs: [0, 2] } },
      }) };
    },
  };
  vm.runInNewContext(rendererSource, env, { filename: 'creature-genetics-render.js' });
  return {
    compositor: env.window.CreatureGeneticsRender,
    env,
    messages,
    get imageAttempts() { return imageAttempts; },
    get maskAttempts() { return maskAttempts; },
    get shadeCalls() { return shadeCalls; },
  };
}

function assertComplete(canvas) {
  assert.ok(canvas, 'completed composition returns a canvas');
  assert.ok(canvas.draws.some(v => v.includes('gar-wolf_idle.png')), 'base body is drawn');
  assert.ok(canvas.draws.some(v => v.includes('gw_colorpoint_idle.png')), 'inherited pattern is drawn');
  assert.ok(canvas.draws.some(v => v.includes('gar-wolf_eye.png')), 'eyes are drawn above the patterns');
}

(async () => {
  for (const asset of ['gar-wolf_eye.png', 'gw_colorpoint_idle.png']) {
    const h = makeHarness({ failImage: asset });
    await assert.rejects(h.compositor.composeFrame('gar-wolf', 'idle', sampleGenes), /Incomplete.*artwork/,
      'an image failure must reject rather than returning a cacheable eyeless or patternless frame');
    assert.equal(h.compositor.memorySnapshot().composeFailures, 1, 'mobile status records the incomplete composite');
    assert.match(h.compositor.memorySnapshot().lastComposeFailure.message, /Incomplete/, 'mobile status explains the missing layer');
    const recovered = await h.compositor.composeFrame('gar-wolf', 'idle', sampleGenes);
    assertComplete(recovered);
    assert.equal(h.imageAttempts, 2, 'failed image promises are removed and loaded again on retry');
    assert.equal(h.compositor.memorySnapshot().composeFailures, 1, 'success does not add a failure');
  }

  const masks = makeHarness({ failMasksOnce: true });
  await assert.rejects(masks.compositor.composeFrame('gar-wolf', 'idle', sampleGenes), /transient mask request error/,
    'a failed mask request must not be cached as an empty mask collection');
  assertComplete(await masks.compositor.composeFrame('gar-wolf', 'idle', sampleGenes));
  assert.equal(masks.maskAttempts, 2, 'base masks are fetched again after a failure');
  assert.ok(masks.shadeCalls > 0, 'recovery applies inherited coat recoloring');
  assert.ok(masks.messages.some(v => v.includes('base masks unavailable')), 'a mobile-readable warning explains the mask retry');

  const prewarm = makeHarness({ failMasksOnce: true });
  await prewarm.compositor.prewarm(['gar-wolf']); // A transient mask fetch cannot abort optional gameplay preloading.
  assert.equal(prewarm.maskAttempts, 1, 'prewarm attempted the same shared masks once');
  assertComplete(await prewarm.compositor.composeFrame('gar-wolf', 'idle', sampleGenes));
  assert.equal(prewarm.maskAttempts, 2, 'first real composite retries masks after a failed prewarm');

  const painted = makeHarness();
  const paintedGenes = {
    ...sampleGenes,
    colorPoolPaint: { layers: { base: { dyeHex: '#558899', patterns: [{ motifDataUrl: 'data:image/png;base64,AA==' }] } } },
  }; // A real saved paint calls the optional weaving compositor, which may be late to load.
  await assert.rejects(painted.compositor.composeFrame('gar-wolf', 'idle', paintedGenes), /Incomplete.*paint:base/,
    'a missing surface-paint dependency must not freeze a permanent unpainted texture');
  painted.env.window.ClothingWeavingSystem = {
    applyPatternStackToTintedImage: async source => {
      const out = new TestPaintCanvas(source); // Distinct canvas marks success under applyColorPoolPaint's identity check.
      return out;
    },
  };
  function TestPaintCanvas(source) {
    this.width = source.width; this.height = source.height; this.draws = ['recovered-paint'];
  }
  assertComplete(await painted.compositor.composeFrame('gar-wolf', 'idle', paintedGenes));
  console.log('Animal genotype atomic/retry tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
