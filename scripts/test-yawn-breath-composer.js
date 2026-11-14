#!/usr/bin/env node
// Run with: node scripts/test-yawn-breath-composer.js
// Execute the shipped yawn grain engine and its renderer integration without browser audio hardware.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function main() {
  const root = path.resolve(__dirname, '..'); // Loads real shipped modules rather than copying DSP logic into the harness.
  const window = { addEventListener() {} }; // Only the independent renderer's public browser seams are needed.
  const document = { addEventListener() {} }; // Loading the renderer must not require an actual DOM.
  vm.runInNewContext(fs.readFileSync(path.join(root, 'docs/js/yawn-breath-composer.js'), 'utf8'), { window });
  const compose = window.YawnBreathComposer.compose; // Directly tests the real grain engine.
  const sampleRate = 8000; // Cheap, realistic PCM resolution for integration-level duration checks.
  const sourceLength = sampleRate; // One-second recording must become a five-second yawn.
  const left = new Float32Array(sourceLength); // Source texture has both a steady breath and distinct inhale/exhale.
  const right = new Float32Array(sourceLength); // Separate stereo content must survive grain reassembly.
  for (let index = 0; index < sourceLength; index++) {
    const phase = index / sampleRate;
    left[index] = 0.18 * Math.sin(2 * Math.PI * (91 * phase + 30 * phase * phase))
      + 0.05 * Math.sin(index * 2.1);
    right[index] = 0.12 * Math.cos(2 * Math.PI * 153 * phase)
      + 0.06 * Math.sin(index * 0.9);
  }
  const leftBefore = left.slice(); // Composer must not mutate cached decoded PCM.
  const ratio = Math.pow(2, 7 / 12); // Existing female/species pitch shifts still use the native Web Audio playback rate.
  const composed = compose([left, right], sampleRate, 5, ratio, 0.8);
  assert.equal(composed.length, 2, 'stereo channels are retained');
  assert.equal(composed[0].length, Math.round(sampleRate * 5 * ratio), 'native pitch transposition still yields five audible seconds');
  assert.equal(composed[1].length, composed[0].length, 'channels stay sample-aligned');
  assert.deepEqual(left, leftBefore, 'the original recording is never changed');
  assert.equal(composed[0][0], 0, 'the sample begins without a click');
  assert(Math.abs(composed[0].at(-1)) < 1e-7, 'the sample ends without a click (including signed zero)');
  assert.deepEqual(compose([left, right], sampleRate, 5, ratio, 0.8)[0], composed[0], 'rendering is deterministic for cache reuse');
  assert.notDeepEqual(compose([left, right], sampleRate, 5, ratio, 1)[0], composed[0], 'species-relative tempo affects the grain sequence');
  assert.notDeepEqual(composed[0], composed[1], 'stereo channels are not accidentally summed or cloned');
  for (let startS = 0.5; startS < 4.5; startS += 0.5) {
    const begin = Math.floor(sampleRate * ratio * startS);
    const end = Math.floor(sampleRate * ratio * (startS + 0.5));
    let power = 0; // Each half-second must contain an audible signal without WSOLA flutter/gaps.
    for (let index = begin; index < end; index++) {
      assert(Number.isFinite(composed[0][index]), 'the grain envelope never creates NaN or infinity');
      power += composed[0][index] ** 2;
    }
    assert(Math.sqrt(power / (end - begin)) > 0.008, 'the middle remains continuously audible');
  }
  assert.throws(() => compose([], sampleRate, 5), /source PCM/, 'empty audio is rejected');
  assert.throws(() => compose([new Float32Array(8)], sampleRate, 5), /too short/, 'invalid short source is rejected');
  assert.throws(() => compose([left], 0, 5), /sample rate/, 'invalid sample rate is rejected');

  const playbackSource = fs.readFileSync(path.join(root, 'docs/js/animal-voice-independent-playback.js'), 'utf8')
    .replace('window.AnimalVoiceIndependentPlayback = {',
      'window.__yawnTestRenderer = { renderBufferFor }; window.AnimalVoiceIndependentPlayback = {'); // Harness-only private seam; production export remains unchanged.
  vm.runInNewContext(playbackSource, { window, document, console, setTimeout, clearTimeout, Date, Promise,
    performance: { now: () => Date.now() }, // Cooperative DSP fallback needs a clock when no Web Worker exists.
  });
  const decoded = {
    sampleRate, numberOfChannels: 2, duration: 1,
    getChannelData(index) { return index ? right : left; },
  }; // Matches the real AudioBuffer shape used by the renderer.
  const context = {
    createBuffer(count, length, rate) {
      const channels = Array.from({ length: count }, () => new Float32Array(length)); // Tracks the allocated result buffers.
      return {
        numberOfChannels: count, sampleRate: rate, length, duration: length / rate,
        copyToChannel(samples, index) { channels[index].set(samples); },
        getChannelData(index) { return channels[index]; },
      };
    },
  }; // Minimal WebAudio buffer allocator; no hardware or autoplay permission needed.
  const options = { breathYawnDurationS: 5, breathYawnCadence: 0.8 }; // Only the missing-yawn case opts into composing.
  const render = window.__yawnTestRenderer.renderBufferFor; // Same cache/spatial-render buffer preparation as live gameplay.
  const pending = render('breath-test.m4a', decoded, context, 1, 7, 4, 24, options);
  const rendered = await pending;
  assert.equal(rendered.length, Math.round(sampleRate * 5 * ratio), 'renderer bypasses generic WSOLA for missing-yawn composition');
  assert(Math.abs(rendered.duration / ratio - 5) < 1 / sampleRate, 'final playback lasts five seconds at the modulated pitch');
  assert.equal(await render('breath-test.m4a', decoded, context, 1, 7, 4, 24, options), rendered, 'renderer caches identical fallback compositions');
  assert.notEqual(await render('breath-test.m4a', decoded, context, 1, 7, 4, 24, { ...options, breathYawnCadence: 1 }),
    rendered, 'different species cadence must not share the same cache entry');
  const normal = await render('breath-test.m4a', decoded, context, 1, 0, 4, 24, { tailPadS: 0 }); // Real independent voice playback explicitly disables the ordinary 18ms tail pad.
  assert.equal(normal.length, sourceLength, 'the shared renderer still uses normal processing when composition is not requested');
  console.log('Natural breath-yawn composer, pitch/duration, stereo, non-silent overlap, cache isolation and ordinary voice parity: OK');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
