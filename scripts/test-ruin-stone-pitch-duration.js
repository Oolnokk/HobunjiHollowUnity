'use strict';
const assert = require('node:assert/strict'); // Validates independent pitch without changing stone cue duration.
const fs = require('node:fs'); // Reads the shipped sound modules rather than a reimplementation.
const vm = require('node:vm'); // Executes each browser module with controllable audio backends.

const read = file => fs.readFileSync(file, 'utf8'); // Shared source reader for production fixtures.
const audioCalls = []; // Records native voices so a playback-rate regression is observable.
class FakeAudio {
  constructor(url) { this.src = url; this.playbackRate = 1; this.volume = 1; audioCalls.push(this); }
  addEventListener() {}
  play() { this.played = true; return Promise.resolve(); }
  pause() {}
}
const independentCalls = []; // Tracks independent renderer requests and their timing options.
const soundConfig = { game: { audio: { enabled: true, sfxVolume: 0.75,
  objectSfx: { enabled: true,
    stoneActivator: { url: 'stone-activator.m4a', volume: 0.8 },
    stoneMechanism: { url: 'stone-mechanism.m4a', volume: 0.86 },
    igniteLarge: { url: 'ignition.m4a', volume: 0.85 },
  },
} } }; // Mirrors the production stone cue configuration.
const windowStub = {
  SCRATCHBONES_CONFIG: soundConfig,
  AnimalVoiceIndependentPlayback: {
    playIndependent(url, options) {
      independentCalls.push({ url, options });
      return { independentPitch: true };
    },
  },
}; // Replaces only the audio device and independent DSP invocation.
const sandbox = { window: windowStub, Audio: FakeAudio, performance: { now: () => 123 }, console }; // Runs the real AudioSystem and ruin dispatcher.
const audioSource = read('docs/js/audio-system.js');
assert(audioSource.includes('let deps = null;'), 'AudioSystem dependency field remains recognizable');
vm.runInNewContext(audioSource.replace('let deps = null;', 'let deps = { audioUrlFailed: () => false };'), sandbox, { filename: 'audio-system.js' }); // The test supplies only URL health; regular game boot uses init().
sandbox.AudioSystem = windowStub.AudioSystem;
vm.runInNewContext(read('docs/js/ruin-interaction-audio.js'), sandbox, { filename: 'ruin-interaction-audio.js' });
const stone = sandbox.RuinInteractionAudio; // Public size/pitch dispatch under test.

assert(stone.pitchFor('mechanism', null, { size: 8 }) < 1, 'larger doors should sound deeper');
assert(stone.pitchFor('mechanism', null, { size: 2 }) > 1, 'smaller doors should sound higher');
assert(stone.pitchFor('activator', null, { size: 0.41 }) > 1, 'smaller stone activators should sound higher');
stone.mechanism(null, { size: 8 });
assert.equal(independentCalls.length, 1);
assert.equal(independentCalls[0].url, 'stone-mechanism.m4a');
assert.equal(independentCalls[0].options.tempo, 1, 'mechanism size never controls speed');
assert(independentCalls[0].options.pitchSemitones < 0, 'door size should change pitch');
assert.equal(independentCalls[0].options.trimSilence, false);
assert.equal(independentCalls[0].options.tailPadS, 0);
assert.equal(independentCalls[0].options.edgeFadeS, 0);
assert.equal(independentCalls[0].options.preserveDurationOnFallback, true);
assert.equal(stone.debugSnapshot().lastTempo, 1, 'mobile report separates tempo from pitch');
assert.equal(stone.debugSnapshot().lastPitchMode, 'independent');

stone.activator(null, { size: 0.41 });
assert(independentCalls[1].options.pitchSemitones > 0, 'activator size should change pitch without speed');
stone.mechanism(null, { size: 4 });
assert.equal(independentCalls.length, 2, 'the reference-size recording needs no DSP');
assert.equal(audioCalls.at(-1).playbackRate, 1, 'neutral mechanism cue plays at original speed');

windowStub.AnimalVoiceIndependentPlayback = null;
stone.activator(null, { size: 0.2 });
assert.equal(audioCalls.at(-1).playbackRate, 1, 'missing DSP must not speed up stone effects');
assert.equal(stone.debugSnapshot().lastPitchMode, 'neutral');

const voiceWindow = { addEventListener() {}, AudioSystem: { gameAudioConfig: () => ({ enabled: true }) } }; // Forces the independent renderer's native fallback, as on a locked/no-WebAudio device.
const voiceDocument = { addEventListener() {} };
vm.runInNewContext(read('docs/js/animal-voice-independent-playback.js'), {
  window: voiceWindow, document: voiceDocument, Audio: FakeAudio, console, setTimeout, clearTimeout, setInterval, clearInterval,
}, { filename: 'animal-voice-independent-playback.js' });
voiceWindow.AnimalVoiceIndependentPlayback.playIndependent('stone-test.m4a', {
  tempo: 1, pitchSemitones: -7, preserveDurationOnFallback: true,
});
assert.equal(audioCalls.at(-1).playbackRate, 1, 'native fallback may lose pitch variation but never original duration');

(async () => {
  const samples = Float32Array.from({ length: 48000 }, (_, index) => Math.sin(index * 0.12) * 0.3); // One second of test sound for actual DSP duration measurements.
  const decoded = { length: samples.length, sampleRate: 48000, numberOfChannels: 1, duration: 1, getChannelData: () => samples };
  const context = { createBuffer(channels, length, sampleRate) {
    const storage = Array.from({ length: channels }, () => new Float32Array(length)); // Represents a rendered AudioBuffer with inspectable length.
    return { length, sampleRate, duration: length / sampleRate, copyToChannel(data, i) { storage[i].set(data); }, getChannelData(i) { return storage[i]; } };
  } };
  for (const pitchSemitones of [-6, 6]) {
    const rendered = await voiceWindow.AnimalVoiceIndependentPlayback.renderDecodedIndependentBuffer(decoded, context, {
      tempo: 1, pitchSemitones, trimSilence: false, tailPadS: 0, edgeFadeS: 0,
    });
    assert(Math.abs(rendered.durationS - decoded.duration) < 0.002, 'up/down pitch should retain the one-second duration');
    assert.equal(rendered.tempo, 1);
  }
  console.log('stone audio: pitch only, neutral size, mobile diagnostics, missing DSP, native fallback and rendered duration pass');
})().catch(error => { console.error(error); process.exitCode = 1; });
