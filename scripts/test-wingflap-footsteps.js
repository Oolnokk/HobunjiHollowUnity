'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const audioCode = fs.readFileSync(path.join(root, 'docs/js/audio-system.js'), 'utf8');
const voiceCode = fs.readFileSync(path.join(root, 'docs/js/animal-vocalizations.js'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(root, 'docs/config/dialogue/ambient-dialogue.json'), 'utf8'));
const sounds = []; // Tracks real native media play requests without WebAudio or a browser.
const voices = []; // Allows source-specific stop assertions and verifies startup pooling.
class FakeAudio {
  constructor(url = '') {
    this.url = url;
    this.src = url;
    this.dataset = {};
    this.readyState = 4;
    this.networkState = 1;
    this.paused = true;
    this.ended = false;
    this.playbackRate = 1;
    this.volume = 1;
    this.currentTime = 0;
    this.preservesPitch = true;
    this.listeners = []; // Ensures interrupted pooled playback never accumulates per-beat ended handlers.
    voices.push(this);
  }
  load() {}
  play() { this.paused = false; sounds.push(this); return Promise.resolve(); }
  pause() { this.paused = true; }
  addEventListener(type) { this.listeners.push(type); }
}
const deterministicMath = Object.create(Math); // Keeps the random candidate offset stable while exercising pool rollover.
deterministicMath.random = () => 0;
const window = {
  SCRATCHBONES_CONFIG: { game: { audio: {
    enabled: true, sfxVolume: 1, footsteps: { enabled: true, volume: 1, surfaces: {} },
    combatSfx: {}, objectSfx: {},
  } } },
};
let clockMs = 1000; // Advances the flock burst window for the independent overhead-flight assertions.
const context = {
  Audio: FakeAudio,
  window,
  Math: deterministicMath,
  performance: { now: () => clockMs },
  document: { addEventListener() {} },
  setTimeout,
  clearTimeout,
  console,
};
window.window = window;
vm.runInNewContext(audioCode, context, { filename: 'audio-system.js' });
vm.runInNewContext(voiceCode, context, { filename: 'animal-vocalizations.js' });
window.AnimalVocalizations.setAuthoredProfiles(config.animalVocalizations);

const player = { x: 0, y: 0, areaId: 'forest', health: 10 }; // Stationary listener for 3D audio distance tests.
window.AudioSystem.init({
  player,
  TILE: 64,
  MAX_WATER: 8,
  TileType: { GRASS: 'grass' },
  clamp: (value, lo, hi) => Math.max(lo, Math.min(hi, value)),
  _isBuildingArea: () => false,
  npcGridForArea: () => null,
  getCurrentArea: () => 'forest',
  getActorWorldY: () => 0,
  audioUrlFailed: () => false,
  isRealMediaError: () => false,
  markAudioUrlFailed: () => {},
});

const make = (id, key, sizeClass) => ({
  id, creatureKey: key, genotype: { sizeClass }, x: 64, y: 0,
  areaId: 'forest', health: 12,
}); // Same-size individuals use one source recording, while their authored size controls transposition.
const large = make('large', 'tzatzul', 'large');
const medium = make('medium', 'pingdort', 'medium');
const small = make('small', 'skeeri-small', 'large');
const vocal = window.AnimalVocalizations;
assert.equal(vocal.creatureSizeClass(small), 'small', 'fixed Skeeri species size wins over inherited size');
assert.equal(vocal.creatureSizeClass(make('hatch', 'tzatzul-hatchling', 'large')), 'small');
assert.equal(vocal.sizePitchDifferenceFromLarge(large), 0);
assert.equal(vocal.sizePitchDifferenceFromLarge(medium), 2.5);
assert.equal(vocal.sizePitchDifferenceFromLarge(small), 5);
const audio = window.AudioSystem;
const initialVoices = voices.length;
assert.equal(audio.playWingflapSfx(large), true);
assert.equal(audio.footstepSfxDebugSnapshot().wingflap.last.pitchSemitones, 0);
const largeVoice = sounds.at(-1);
assert.equal(largeVoice.playbackRate, 1, 'large birds retain the source pitch');
assert.equal(largeVoice.preservesPitch, false, 'native voice must actually transpose on rate changes');
assert.equal(audio.playWingflapSfx(medium), true);
const mediumVoice = sounds.at(-1);
assert(Math.abs(mediumVoice.playbackRate - Math.pow(2, 2.5 / 12)) < 1e-8);
assert.equal(audio.playWingflapSfx(small), true);
const smallVoice = sounds.at(-1);
assert(Math.abs(smallVoice.playbackRate - Math.pow(2, 5 / 12)) < 1e-8);
assert(smallVoice.playbackRate > mediumVoice.playbackRate && mediumVoice.playbackRate > largeVoice.playbackRate);
assert.equal(voices.length, initialVoices, 'flapping uses only the preloaded footstep pool');
assert(sounds.every(voice => /sfx_wingflap_[123]\.mp3$/.test(voice.src)), 'flight steps never fall through to ground surfaces');
assert.equal(audio.stopWingflapSfx(large), true);
assert.equal(largeVoice.paused, true, 'large bird stops when its wing animation ends');
assert.equal(mediumVoice.paused, false, 'stopping one bird must not stop another bird');
assert.equal(smallVoice.paused, false, 'stopping one bird must not stop another bird');
assert.equal(audio.stopWingflapSfx(large), false, 'repeated rest frames should be harmless');
assert.equal(largeVoice.listeners.filter(type => type === 'ended').length, 1);
assert.equal(audio.playWingflapSfx(large), true, 'reentering flight reuses the same native voice');
assert.equal(sounds.at(-1), largeVoice, 'paused native voice is reused');
assert.equal(largeVoice.listeners.filter(type => type === 'ended').length, 1, 'flap/glide cycles never add more ended listeners');
assert.equal(audio.stopWingflapSfx(large), true);
assert.equal(audio.stopWingflapSfx(small), true);
assert.equal(smallVoice.paused, true);

const requests = sounds.length;
window.SCRATCHBONES_CONFIG.game.audio.footsteps.enabled = false;
assert.equal(audio.playWingflapSfx(large), false, 'footstep mute also applies to flight steps');
window.SCRATCHBONES_CONFIG.game.audio.footsteps.enabled = true;
assert.equal(audio.playWingflapSfx(make('far', 'tzatzul', 'small')), true);
assert.equal(audio.playWingflapSfx({ ...large, id: 'another-map', areaId: 'mine' }), false, 'inactive areas cannot be audible');
assert.equal(audio.playWingflapSfx({ ...large, id: 'distant', x: 64 * 25 }), false, 'farther than earshot cannot be audible');
assert.equal(audio.playWingflapSfx({ ...large, id: 'dead', health: 0 }), false);
assert.equal(sounds.length, requests + 1, 'muted, distant, dead and other-area birds produce no media playback');
const shot = audio.footstepSfxDebugSnapshot();
assert.equal(shot.wingflap.last.size, 'small');
assert(shot.wingflap.requests >= 4);
assert.equal(shot.playbackFailures, 0);

// An adult Tzatzul above the listener should not disappear at the ground-footstep radius.
audio.stopWingflapSfx(medium);
clockMs += 100;
const overhead = { ...large, id: 'overhead-tzatzul', x: 0, worldY: 14 };
assert.equal(audio.playWingflapSfx(overhead), true, 'large Tzatzul audible fourteen tiles overhead');
const overheadShot = audio.wingflapSfxDebugSnapshot();
assert.equal(overheadShot.last.distanceTiles, 14);
assert.equal(overheadShot.last.earshotTiles, 24);
assert(overheadShot.last.volume > 0.05, 'overhead adult remains meaningfully audible');
assert.equal(audio.stopWingflapSfx(overhead), true);
assert.equal(audio.playWingflapSfx({ ...small, id: 'small-overhead', x: 0, worldY: 14 }), false,
  'small wings retain their short earshot');
assert.equal(audio.playWingflapSfx({ ...large, id: 'very-far', x: 0, worldY: 25 }), false,
  'even a large bird has a finite 3D earshot');
const rejected = audio.wingflapSfxDebugSnapshot();
assert.equal(rejected.lastRejection.actor, 'very-far');
assert.equal(rejected.lastRejection.distanceTiles, 25);
assert.equal(rejected.lastRejection.earshotTiles, 24);
assert(rejected.attempts > rejected.requests, 'mobile diagnostics expose rejected cues as well as playback');
console.log('Native wingflap footsteps: size pitch, pool reuse, per-actor stop and 3D gating PASS');
