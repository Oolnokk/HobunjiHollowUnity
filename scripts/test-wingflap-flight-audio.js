'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const records = []; // Captures the actual pooled recorded clips, playback rates, and native pitch-preservation flags.
const created = []; // Confirms no new Audio elements are allocated during a wingbeat after preloading.
let clockMs = 1000; // Controlled audio clock exercises the bounded synchronized-flock burst window.
class FakeAudio {
  constructor(url = '') {
    this.url = url;
    this.src = url;
    this.dataset = {};
    this.readyState = 4;
    this.networkState = 1;
    this.paused = true;
    this.ended = false;
    this.volume = 1;
    this.playbackRate = 1;
    this.preservesPitch = true;
    created.push(this);
  }
  load() {}
  pause() { this.paused = true; }
  addEventListener() {}
  play() {
    this.paused = false;
    records.push({ url: this.url, rate: this.playbackRate, preservesPitch: this.preservesPitch, volume: this.volume });
    return Promise.resolve();
  }
}

const math = Object.create(Math);
math.random = () => 0; // Every wingbeat uses the first of the three real, preloaded recordings.
const W = {
  SCRATCHBONES_CONFIG: {
    game: { audio: { enabled: true, sfxVolume: 1,
      footsteps: { enabled: true, volume: 1, surfaces: {} }, combatSfx: {}, objectSfx: {} } },
  },
};
const context = {
  window: W, Audio: FakeAudio, Math: math, console, setTimeout, clearTimeout,
  performance: { now: () => clockMs },
  document: { addEventListener() {} },
};
W.window = W;
for (const file of ['animal-vocalizations.js', 'audio-system.js']) {
  vm.runInNewContext(fs.readFileSync(path.join(root, 'docs/js', file), 'utf8'), context, { filename: file });
}
const voices = W.AnimalVocalizations;
const config = JSON.parse(fs.readFileSync(path.join(root, 'docs/config/dialogue/ambient-dialogue.json'), 'utf8'));
voices.setAuthoredProfiles(config.animalVocalizations);
const animal = (creatureKey, sizeClass, extras = {}) => ({
  id: creatureKey + ':' + sizeClass, creatureKey, sizeClass, x: 32, y: 0,
  areaId: 'map_test', health: 10, ...extras,
});
const large = animal('tzatzul', 'large');
const medium = animal('pingdort', 'medium');
const small = animal('skeeri-small', 'large'); // Skeeri's explicit variant key takes precedence over the genotype.
assert.equal(voices.creatureSizeClass(small), 'small');
assert.equal(voices.sizePitchDifferenceFromLarge(large), 0);
assert.equal(voices.sizePitchDifferenceFromLarge(medium), 2.5);
assert.equal(voices.sizePitchDifferenceFromLarge(small), 5);

W.AudioSystem.init({
  TILE: 32, MAX_WATER: 8, TileType: {}, clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
  player: { x: 0, y: 0 }, getCurrentArea: () => 'map_test',
  _isBuildingArea: () => false, npcGridForArea: () => null,
  audioUrlFailed: () => false, isRealMediaError: () => false, markAudioUrlFailed() {},
});
const audio = W.AudioSystem;
const afterPreload = created.length;
assert.equal(created.filter(sound => /sfx_wingflap_/.test(sound.url)).length, 6,
  'three wingflap recordings must each get two gesture-unlockable pooled voices');
for (const bird of [large, medium, small]) {
  clockMs += 110;
  assert.equal(audio.playWingflapSfx(bird), true);
}
assert.equal(records.length, 3);
assert(records.every(sound => /^assets\/audio\/sfx\/footsteps\/sfx_wingflap_[123]\.mp3$/.test(sound.url)),
  'flying footsteps must select the wing recordings, never ground-step or wet-step recordings');
assert.equal(records[0].rate, 1, 'large wings retain the intended original pitch');
assert(Math.abs(records[1].rate - Math.pow(2, 2.5 / 12)) < 1e-10,
  'medium wings transpose by one authored size step');
assert(Math.abs(records[2].rate - Math.pow(2, 5 / 12)) < 1e-10,
  'small wings transpose by two authored size steps');
assert(records.every(sound => sound.preservesPitch === false),
  'native HTML audio must actually shift pitch instead of time-stretching');
assert.equal(created.length, afterPreload, 'wingbeats reuse existing preloaded voices');

const beforeSilence = records.length;
assert.equal(audio.playWingflapSfx(animal('tzatzul', 'small', { x: 5000 })), false,
  'distant flight should not cost a decoded or native-audio play');
assert.equal(audio.playWingflapSfx(animal('tzatzul', 'small', { areaId: 'other_map' })), false,
  'a flyer in another zone stays silent');
assert.equal(audio.playWingflapSfx(animal('tzatzul', 'small', { health: 0 })), false,
  'dead birds do not flap');
assert.equal(records.length, beforeSilence);
assert.equal(created.length, afterPreload);

for (const bird of [large, medium, small]) assert.equal(audio.stopWingflapSfx(bird), true);
clockMs += 110;
for (let i = 0; i < 12; i++) audio.playWingflapSfx(animal('pingdort', 'small', { id: 'flock:' + i }));
assert.equal(records.length, beforeSilence + 6, 'one flock stroke is capped to the six pooled native voices');
assert.equal(audio.footstepSfxDebugSnapshot().wingflap.suppressed, 6);
assert.equal(audio.footstepSfxDebugSnapshot().wingflap.active, 6);
clockMs += 110;
assert.equal(audio.playWingflapSfx(animal('skeeri-medium', 'medium', { id: 'late-flock' })), false,
  'the strict six-voice limit survives beyond the 85ms burst window while earlier clips are still playing');
assert.equal(audio.footstepSfxDebugSnapshot().wingflap.suppressed, 7);
for (const voice of created.filter(sound => /sfx_wingflap_/.test(sound.url))) { voice.ended = true; voice.paused = true; } // Simulate the six simultaneous recordings naturally ending.
assert.equal(audio.playWingflapSfx(large), true, 'a later stroke can play when the previous six clips finish');
assert.equal(audio.footstepSfxDebugSnapshot().wingflap.active, 1, 'naturally finished voices reclaim the bounded slots');
const wingflapDebug = audio.footstepSfxDebugSnapshot().wingflap;
assert.equal(wingflapDebug.last.size, 'large');
assert.equal(wingflapDebug.last.pitchSemitones, 0);
assert(wingflapDebug.requests >= 10, 'mobile diagnostics expose actually requested wingbeats');

async function testVisualCadence() {
  const cues = []; // The live three-species rig presentation must schedule sound without a second RAF.
  W.AudioSystem = { playWingflapSfx: actor => cues.push(actor.creatureKey) };
  const makeRig = () => {
    const rigRoot = { parent: null, visible: true,
      rotation: { y: 0, z: 0 }, position: { y: 0 }, scale: { setScalar() {} } };
    return { root: rigRoot, flapHz: 2, update() {}, dispose() {}, restoreTint() { return false; } };
  };
  W.TzatzulRegistration = {
    KIND: 'tzatzul', HATCHLING_KIND: 'tzatzul-hatchling',
    identityFor: () => ({ color: 'brown' }), createRig: () => makeRig(),
    HATCHLING_SCALE: { x: 1, y: 1 },
  };
  W.PingdortRegistration = { createRig: () => makeRig() };
  W.SkeeriRuins = { SPECIES: { small: { key: 'skeeri-small' } }, createRig: () => makeRig() };
  const actor = (key, poseField, flags = {}) => {
    const group = { parent: {}, children: [], userData: {},
      add(child) { child.parent = this; this.children.push(child); } };
    return { id: key, creatureKey: key, health: 10, x: 32, y: 0,
      areaId: 'map_test', avatarRef: { group }, [poseField]: 'flap', ...flags };
  };
  const birds = [
    actor('tzatzul', 'tzatzulFlightPose'),
    actor('pingdort', 'pingdortFlightPose', { isWildPingdort: true }),
    actor('skeeri-small', 'skeeriFlightPose', { isRuinSkeeri: true }),
    actor('tzatzul-hatchling', 'tzatzulFlightPose'),
  ];
  vm.runInNewContext(fs.readFileSync(path.join(root, 'docs/js/tzatzul-live-visuals.js'), 'utf8'), context,
    { filename: 'tzatzul-live-visuals.js' });
  const visuals = W.TzatzulLiveVisuals;
  const hostileObjects = new Set(birds);
  visuals.init({ hostileObjects, companionObjects: new Set(),
    getCurrentArea: () => 'map_test', TILE: 32, player: { x: 0, y: 0 } });
  visuals.tick(0.1, 'map_test'); // Registers birds and asynchronously mounts the native rigs.
  await new Promise(resolve => setImmediate(resolve));
  visuals.tick(0.1, 'map_test');
  assert.deepEqual(cues, ['tzatzul', 'pingdort', 'skeeri-small'],
    'three native flying species start wingbeat sounds, but a hatchling never does');
  visuals.tick(0.1, 'map_test');
  assert.equal(cues.length, 3, 'no sound is emitted on every visual frame');
  visuals.tick(0.25, 'map_test');
  visuals.tick(0.25, 'map_test');
  assert.equal(cues.length, 6, 'each bird beats again at its authored 2 Hz, not at frame rate');
  birds[0].tzatzulFlightPose = 'glide';
  birds[1].pingdortFlightPose = 'perched';
  birds[2].skeeriFlightPose = 'perched';
  visuals.tick(0.25, 'map_test');
  assert.equal(cues.length, 6, 'gliding/perching reset and silence all native wingbeat sounds');
  birds[0].tzatzulFlightPose = 'flap';
  visuals.tick(0.1, 'map_test');
  assert.equal(cues.length, 7, 'resuming active flight immediately sounds one beat');
  birds[0].prone = true;
  visuals.tick(0.25, 'map_test');
  assert.equal(cues.length, 7, 'knockdown suppresses flapping');
}
testVisualCadence().then(() => {
  console.log('Wingflap size/pitch, pooled playback, spatial silence, flock limit and native rig cadence: PASS');
}).catch(error => { console.error(error); process.exitCode = 1; });
