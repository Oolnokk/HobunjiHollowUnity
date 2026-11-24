'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const sources = []; // Captures every decoded Web Audio wing source and verifies bounded playback and prompt cancellation.
const nativeVoices = []; // Tracks fallback HTML audio separately from the real decoded 3D route.
let clockMs = 1000; // Controlled beat clock crosses multiple flock burst windows while clips remain audible.
let sampleChoice = 0; // Prewarms all three authored files, then selects the first one for all concurrent birds.
class FakeAudio {
  constructor(url = '') {
    this.url = url;
    this.src = url;
    this.dataset = {};
    this.readyState = 4;
    this.paused = true;
    this.ended = false;
    this.playbackRate = 1;
    this.volume = 1;
    nativeVoices.push(this);
  }
  load() {}
  addEventListener(type, callback) {
    (this.listeners ||= {})[type] ||= [];
    this.listeners[type].push(callback);
  }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}

const nodes = []; // Retain the real graph topology so the test can verify the shared echo bus.
const node = (kind = 'generic') => {
  const value = { kind, links: [], disconnects: 0, connect(target) { this.links.push(target); return target; }, disconnect() { this.disconnects++; this.links.length = 0; } };
  nodes.push(value);
  return value;
};
class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = node('destination');
    this.sampleRate = 32; // Small real impulse buffers keep this graph regression inexpensive.
  }
  decodeAudioData() {
    return Promise.resolve({
      duration: 2,
      numberOfChannels: 1,
      getChannelData() { return new Float32Array([0, 0.5]); },
    });
  }
  createBufferSource() {
    const src = {
      ...node('source'),
      playbackRate: { value: 1 },
      stopped: false,
      start() { sources.push(this); },
      stop() {
        if (this.stopped) return;
        this.stopped = true;
        this.onended?.();
      },
    };
    return src;
  }
  createGain() { const value = node('gain'); value.gain = { value: 1 }; return value; }
  createBiquadFilter() { const value = node('filter'); value.frequency = { value: 0 }; return value; }
  createDelay() { const value = node('delay'); value.delayTime = { value: 0 }; return value; }
  createConvolver() { return node('convolver'); }
  createBuffer(channels, length) { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { getChannelData: channel => data[channel] }; }
  createPanner() {
    return { ...node(), positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 } };
  }
}
const math = Object.create(Math);
math.random = () => sampleChoice / 3;
const mockFetch = () => Promise.resolve({
  ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
});
const W = {
  AudioContext: FakeAudioContext,
  fetch: mockFetch,
  AnimalVocalizations: { creatureSizeClass: () => 'large', sizePitchDifferenceFromLarge: () => 0 },
  SCRATCHBONES_CONFIG: {
    game: { audio: { enabled: true, sfxVolume: 1,
      footsteps: { enabled: true, volume: 1, surfaces: {} }, combatSfx: {}, objectSfx: {} } },
  },
};
W.window = W;
const context = {
  window: W, Audio: FakeAudio, Math: math, console, fetch: mockFetch,
  performance: { now: () => clockMs },
  document: { addEventListener() {} }, setTimeout, clearTimeout,
};
vm.runInNewContext(fs.readFileSync(path.join(root, 'docs/js/audio-system.js'), 'utf8'), context,
  { filename: 'audio-system.js' });
vm.runInNewContext(fs.readFileSync(path.join(root, 'docs/js/environmental-reverb.js'), 'utf8'), context,
  { filename: 'environmental-reverb.js' }); // Exercise the actual area-aware reverb implementation, not a stub.
W.AudioSystem.init({
  TILE: 32, player: { x: 0, y: 0 }, MAX_WATER: 8, TileType: {},
  clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  getCurrentArea: () => 'forest', _isBuildingArea: () => false, npcGridForArea: () => null,
  audioUrlFailed: () => false, isRealMediaError: () => false, markAudioUrlFailed() {},
});
const audio = W.AudioSystem;
const bird = id => ({ id, creatureKey: 'skeeri-large', areaId: 'forest', x: 32, y: 0, health: 10 });

(async () => {
  for (let i = 0; i < 3; i++) {
    sampleChoice = i;
    clockMs += 110;
    const warm = bird('warm' + i);
    assert.equal(audio.playWingflapSfx(warm), true);
    assert.equal(audio.stopWingflapSfx(warm), true);
  }
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); // Flush the real shared decode queue.
  assert.equal(audio.wingflapSfxDebugSnapshot().active, 0, 'native prewarming releases its actors');

  sampleChoice = 0;
  const birds = Array.from({ length: 6 }, (_, i) => bird('flying' + i));
  for (const flyer of birds) {
    clockMs += 110; // Each bird starts in a different 85 ms burst window.
    assert.equal(audio.playWingflapSfx(flyer), true);
  }
  assert.equal(sources.length, 6, 'all six wingbeats use decoded positional Web Audio, not the native fallback');
  assert.equal(audio.wingflapSfxDebugSnapshot().active, 6);
  const echo = audio.wingflapSfxDebugSnapshot().last;
  assert.equal(echo.wetRoute, 'decoded-wet');
  assert.equal(echo.wetPreset, 'forest');
  assert( echo.wetGain > W.EnvironmentalReverb.profileForArea('forest').wet, 'wingbeat adds animal and distance wetness');
  const convolvers = nodes.filter(value => value.kind === 'convolver');
  assert.equal(convolvers.length, 1, 'six birds share a single convolution bus');
  const convolver = convolvers[0];
  const originalImpulse = convolver.buffer;
  assert(originalImpulse, 'real forest impulse response is populated');
  const sourceGain = sources[0].links[0]; // Source splits into a dry directional branch and a wet branch.
  assert(sourceGain.links.some(value => value.kind === 'gain' && value.links.length > 0), 'decoded wing source connects to its wet send');

  clockMs += 110;
  const seventh = bird('seventh');
  assert.equal(audio.playWingflapSfx(seventh), false,
    'a seventh overlapping 3D wingbeat must be suppressed even in another start window');
  assert.equal(sources.length, 6);
  assert.equal(audio.wingflapSfxDebugSnapshot().suppressed, 1);

  sources[1].onended(); // Real source completion invokes the same lifecycle hook.
  assert.equal(audio.stopWingflapSfx(birds[1]), false, 'natural completion unpins the specific bird');
  assert.equal(audio.wingflapSfxDebugSnapshot().active, 5);
  assert.equal(audio.playWingflapSfx(seventh), true, 'completed source frees a slot without waiting for a future zone scan');
  assert.equal(sources.length, 7);

  assert.equal(audio.stopWingflapSfx(birds[0]), true);
  assert.equal(sources[0].stopped, true, 'glide stops its exact Web Audio source immediately');
  assert.equal(sources[2].stopped, false, 'glide does not stop another flying bird');
  assert.equal(convolver.disconnects, 0, 'glide disconnects only the source, not the reverb bus');
  assert.equal(convolver.buffer, originalImpulse, 'already injected echo decays naturally in the shared impulse response');
  assert.equal(audio.wingflapSfxDebugSnapshot().active, 5);

  clockMs += 110;
  assert.equal(audio.playWingflapSfx(birds[0]), true);
  assert.equal(sources.length, 8);
  W.SCRATCHBONES_CONFIG.game.audio.footsteps.volume = 0;
  assert.equal(audio.playWingflapSfx(birds[0]), false, 'zero footstep-mixer volume is an actual mute');
  assert.equal(sources[7].stopped, true, 'mixer mute silences the existing stroke as well');
  W.SCRATCHBONES_CONFIG.game.audio.footsteps.volume = 1;

  for (const flyer of [...birds, seventh]) audio.stopWingflapSfx(flyer);
  assert.equal(audio.wingflapSfxDebugSnapshot().active, 0,
    'all decoded sources and actor references are released after landing');
  // The actual area preset follows the source, including cavern/ruin reverb.
  clockMs += 110;
  W.SCRATCHBONES_CONFIG.game.audio.environmentalReverb = { byArea: { forest: { preset: 'cavern' } } };
  const distant = { ...bird('distant'), x: 32 * 12 };
  assert.equal(audio.playWingflapSfx(distant), true);
  const cavernEcho = audio.wingflapSfxDebugSnapshot().last;
  assert.equal(cavernEcho.wetPreset, 'cavern');
  assert(cavernEcho.wetGain > echo.wetGain, 'distant cavern wingflaps have more reflected sound');
  assert.equal(nodes.filter(value => value.kind === 'convolver').length, 1, 'area changes reuse the bus');
  audio.stopWingflapSfx(distant);
  W.SCRATCHBONES_CONFIG.game.audio.environmentalReverb.enabled = false;
  clockMs += 110;
  assert.equal(audio.playWingflapSfx(bird('dry')), true, 'reverb disabled must not silence dry wingbeats');
  assert.equal(audio.wingflapSfxDebugSnapshot().last.wetRoute, 'none');
  console.log('Wingflap decoded HRTF: strict voice cap, real environmental reverb, natural echo tail, glide stop and mute PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
