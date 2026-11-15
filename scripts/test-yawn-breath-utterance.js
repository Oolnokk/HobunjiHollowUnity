#!/usr/bin/env node
// Run with: node scripts/test-yawn-breath-utterance.js
// The missing-yawn path uses the same tempo/pitch renderer as ordinary utterances.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function main() {
  const root = path.resolve(__dirname, '..'); // Resolves shipped runtime modules used in this regression.
  const playbackSource = fs.readFileSync(path.join(root, 'docs/js/animal-voice-independent-playback.js'), 'utf8'); // Inspects the real shared DSP path.
  const yawnSource = fs.readFileSync(path.join(root, 'docs/js/npc-yawn-rest.js'), 'utf8'); // Confirms the fallback requests only the exact utterance tempo.
  const gameIndex = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8'); // Ensures the former grain composer is not loaded in gameplay.
  assert.doesNotMatch(playbackSource, /YawnBreathComposer|breathYawnDurationS|breathYawnCadence/, 'no special yawn synthesis remains in shared playback');
  assert.doesNotMatch(gameIndex, /yawn-breath-composer\.js/, 'the old grain compositor is not booted');
  assert.match(yawnSource, /BREATH_FALLBACK_TEMPO = 0\.35/, 'fallback tempo is authored as an exact utterance setting');
  assert.match(yawnSource, /tempo: BREATH_FALLBACK_TEMPO/, 'the fallback passes its tempo directly to playback');

  const window = { addEventListener() {} }; // Minimal browser facade for loading the real playback module.
  const document = { addEventListener() {} }; // No DOM or audio hardware is needed for the DSP regression.
  const instrumentedSource = playbackSource.replace('window.AnimalVoiceIndependentPlayback = {',
    'window.__testYawnRenderer = { renderBufferFor }; window.AnimalVoiceIndependentPlayback = {'); // Exposes only the real pure renderer in the harness.
  assert.notEqual(instrumentedSource, playbackSource, 'the renderer seam still exists');
  vm.runInNewContext(instrumentedSource, {
    window, document, console, Promise, Date, setTimeout, clearTimeout,
    performance: { now: () => Date.now() }, // Cooperative WSOLA uses the same timing hook as normal gameplay.
  });

  const sampleRate = 4000; // In-memory mock decoded audio keeps the test fast and deterministic.
  const sourceLength = sampleRate; // One second of breath should last 1 / 0.350 seconds before end-of-animation interruption.
  const left = new Float32Array(sourceLength); // Varying signal exercises real WSOLA stretching without repeated silent samples.
  const right = new Float32Array(sourceLength); // Separate stereo samples test channel retention.
  for (let i = 0; i < sourceLength; i++) {
    left[i] = 0.25 * Math.sin(i * 0.10 + (i / sampleRate) ** 2 * 3);
    right[i] = 0.19 * Math.cos(i * 0.13 + (i / sampleRate) * 2);
  }
  const leftOriginal = left.slice(); // Verifies cached AudioBuffer source data is never modified.
  const decoded = {
    sampleRate, numberOfChannels: 2, duration: 1,
    getChannelData(index) { return index ? right : left; },
  }; // Same shape as the browser-decoded AudioBuffer.
  const context = {
    createBuffer(count, length, rate) {
      const channels = Array.from({ length: count }, () => new Float32Array(length)); // Captures the actual rendered PCM channels.
      return {
        numberOfChannels: count, length, sampleRate: rate, duration: length / rate,
        copyToChannel(samples, index) { channels[index].set(samples); },
        getChannelData(index) { return channels[index]; },
      };
    },
  }; // Allocator-only AudioContext facade; verifies buffers without device playback.
  const opts = { tailPadS: 0, edgeFadeS: 0 }; // Avoid adding an authored tail so durations reflect utterance tempo only.
  const render = window.__testYawnRenderer.renderBufferFor; // Production WSOLA renderer, not a test-only DSP imitation.
  const at035 = await render('breath5-035.m4a', decoded, context, 0.35, 0, 4, 24, opts);
  assert.equal(at035.length, Math.round(sourceLength / 0.35), '0.350x stretches the complete breath to 2.857x length');
  assert.equal(at035.numberOfChannels, 2, 'stereo breath channels are retained');
  assert.deepEqual(left, leftOriginal, 'WSOLA never mutates the decoded source');
  assert(at035.getChannelData(0).some(sample => Math.abs(sample) > 0.01), 'the stretched breath remains audible');

  const pitchSemitones = 7; // Confirms species-specific pitch remains independent from tempo.
  const pitchRatio = Math.pow(2, pitchSemitones / 12); // WebAudio's final playbackRate compensates stretched PCM duration.
  const pitched = await render('breath5-035.m4a', decoded, context, 0.35, pitchSemitones, 4, 24, opts);
  assert(Math.abs(pitched.duration / pitchRatio - sourceLength / sampleRate / 0.35) < 1 / sampleRate,
    'species pitch changes transposition without changing the audible 0.350x tempo');
  assert.notEqual(pitched, at035, 'independent pitch and tempo cannot share one cached waveform');
  assert.equal(await render('breath5-035.m4a', decoded, context, 0.35, 0, 4, 24, opts), at035,
    'identical fallback requests share the normal rendered-buffer cache');

  const recorded = await render('recorded-yawn.ogg', decoded, context, 1, 0, 4, 24, opts);
  assert.equal(recorded.length, sourceLength, 'existing recorded yawns still run at natural one-to-one speed');
  console.log('Yawn Breath 5: ordinary 0.350x WSOLA, stereo, source preservation, pitch independence, cache, real-recording parity: OK');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
