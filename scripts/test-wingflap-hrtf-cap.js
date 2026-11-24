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

const node = () => ({ connect() {}, disconnect() {} }); // Minimal valid graph node for source, gain, filter and spatial routing.
class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = node();
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
      ...node(),
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
  createGain() { return { ...node(), gain: { value: 1 } }; }
  createBiquadFilter() { return { ...node(), frequency: { value: 0 } }; }
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
  console.log('Wingflap decoded HRTF: strict voice cap, natural-end cleanup, glide stop and mute PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
