'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Expose private DSP only in this harness to compare every sample with the
// synchronous reference; production retains its existing public API.
const source = fs.readFileSync('docs/js/animal-voice-independent-playback.js', 'utf8')
  .replace('window.AnimalVoiceIndependentPlayback = {', 'window.testDsp = { processConstantAxes, renderBufferFor }; window.AnimalVoiceIndependentPlayback = {');
let clock = 0; // Simulated CPU clock forces scheduling boundaries during searches.
let yields = 0; // Counts opportunities for input/rendering before audio completes.
const sandbox = {
  console, URL, location: { href: 'https://example.test/', pathname: '/' },
  performance: { now: () => (clock += 0.25) },
  setTimeout(resolve) { yields++; queueMicrotask(resolve); return yields; },
  clearTimeout() {}, addEventListener() {},
  document: { addEventListener() {} },
};
sandbox.window = sandbox;
vm.runInNewContext(source, sandbox);
function buffer(channels, length, sampleRate) {
  const data = Array.from({ length: channels }, () => new Float32Array(length)); // Test AudioBuffer storage.
  return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
    getChannelData: index => data[index], copyToChannel: (samples, index) => data[index].set(samples) };
}
const context = { createBuffer: buffer }; // Real sample math with a minimal AudioContext adapter.
(async () => {
  const input = buffer(2, 9000, 44100); // Stereo waveform covers correlated grains and the forced final grain.
  for (let channel = 0; channel < 2; channel++) {
    for (let index = 0; index < input.length; index++) input.getChannelData(channel)[index] = Math.sin(index * (0.031 + channel * 0.006)) * 0.6;
  }
  for (const tempo of [0.7, 1.6]) {
    const expected = sandbox.testDsp.processConstantAxes(input, tempo, 2); // Reference calculation drains the same DSP synchronously.
    const before = yields; // Verify a cache miss gives the game opportunities to run.
    const rendered = await sandbox.testDsp.renderBufferFor(`test-${tempo}.wav`, input, context, tempo, 2);
    assert(yields > before, 'ordinary pain/breath/strike rendering must yield during waveform processing');
    for (let channel = 0; channel < 2; channel++) assert.deepEqual(Array.from(rendered.getChannelData(channel)), Array.from(expected[channel]), 'scheduling must preserve every processed sample');
    const cachedYields = yields; // Cached playback must skip repeated DSP entirely.
    assert.equal(await sandbox.testDsp.renderBufferFor(`test-${tempo}.wav`, input, context, tempo, 2), rendered);
    assert.equal(yields, cachedYields);
  }
  console.log('Voice processing yields during search, preserves stereo samples, and reuses cached renders.');
})().catch(error => { console.error(error); process.exitCode = 1; });
