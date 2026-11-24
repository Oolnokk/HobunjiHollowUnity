'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const wetRequests = []; // Verify explicit native echo ownership and delayed-start cancellation.
const played = []; // Records native voices while a mobile browser's play() promise remains pending.
let clockMs = 1000; // Same-tick launch deliberately exercises the paused-but-reserved native pool race.
class FakeAudio {
  constructor(url = '') {
    this.url = url;
    this.src = url;
    this.dataset = {};
    this.paused = true; // Mobile audio can remain paused until its asynchronous start resolves.
    this.ended = false;
    this.readyState = 1;
    this.volume = 1;
    this.playbackRate = 1;
    this.pauseCount = 0; // Ensures a second bird never cancels this pending recording.
    this.listeners = {};
  }
  load() {}
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  play() { played.push(this); return new Promise(() => {}); } // Never resolves; retains a real pending lease.
  pause() { this.paused = true; this.pauseCount++; }
  emit(type) { for (const callback of this.listeners[type] || []) callback(); }
}
const math = Object.create(Math);
math.random = () => 0;
const W = {
  EnvironmentalReverb: { playWetUrl(url, opts) {
    const request = { url, opts, stopped: false };
    wetRequests.push(request);
    return { stop() { request.stopped = true; } };
  } },
  AnimalVocalizations: { creatureSizeClass: () => 'large', sizePitchDifferenceFromLarge: () => 0 },
  SCRATCHBONES_CONFIG: { game: { audio: { enabled: true, sfxVolume: 1,
    footsteps: { enabled: true, volume: 1, surfaces: {} }, combatSfx: {}, objectSfx: {} } } },
};
W.window = W;
const context = {
  window: W, Audio: FakeAudio, Math: math, console,
  performance: { now: () => clockMs },
  document: { addEventListener() {} }, setTimeout, clearTimeout,
};
vm.runInNewContext(fs.readFileSync(path.join(root, 'docs/js/audio-system.js'), 'utf8'), context,
  { filename: 'audio-system.js' });
W.AudioSystem.init({
  TILE: 32, player: { x: 0, y: 0 }, getCurrentArea: () => 'forest',
  MAX_WATER: 8, TileType: {}, clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
  _isBuildingArea: () => false, npcGridForArea: () => null,
  audioUrlFailed: () => false, isRealMediaError: () => false, markAudioUrlFailed() {},
});
const audio = W.AudioSystem;
const bird = id => ({ id, areaId: 'forest', creatureKey: 'skeeri-large', health: 10, x: 32, y: 0 });
(async () => {
const birds = Array.from({ length: 6 }, (_, i) => bird('pending-' + i));
for (const flyer of birds) assert.equal(audio.playWingflapSfx(flyer), true);
assert.equal(played.length, 6, 'all six outstanding mobile play requests get a voice');
assert.equal(new Set(played).size, 6, 'each pending native play reserves a distinct voice');
assert(played.every(voice => voice.paused), 'test never relies on media play promises resolving');
assert(played.every(voice => voice.pauseCount === 0), 'no outstanding request was stolen or cancelled');
assert.equal(audio.wingflapSfxDebugSnapshot().active, 6);
assert(played.every(voice => voice.dataset.environmentalReverb === 'off'), 'generic HTML media reverb cannot duplicate owned wing echoes');
await Promise.resolve();
assert.equal(wetRequests.length, 0, 'pending playback cannot start an echo before actual media starts');
const sounding = played[1]; // A different bird successfully starts while other voices remain pending.
sounding.paused = false;
sounding.currentTime = 0.12;
sounding.emit('playing');
await Promise.resolve();
assert.equal(wetRequests.length, 1);
const wet = wetRequests[0];
assert.equal(wet.opts.area, 'forest');
assert.equal(wet.opts.playbackRate, 1);
assert(wet.opts.extraWet > 0.026);
assert.equal(wet.opts.getOffsetS(), 0.12, 'native wet layer synchronizes with current sample position');
wet.opts.onStarted({ wet: 0.1, profile: { preset: 'forest' } });
assert.equal(wet.stopped, false);
clockMs += 110;
assert.equal(audio.playWingflapSfx(bird('seventh')), false, 'seventh bird cannot steal a pending native voice');

const first = played[0];
first.emit('ended');
assert.equal(audio.stopWingflapSfx(birds[0]), false, 'natural native end releases its specific actor lease');
assert.equal(audio.wingflapSfxDebugSnapshot().active, 5);
assert.equal(audio.playWingflapSfx(birds[0]), true, 'finished native voice is reusable');
assert.equal(played.at(-1), first, 'the original native pool slot was reused instead of allocating a new Audio object');
assert.equal(first.listeners.playing.length, 1, 'repeated or interrupted playback installs only one playing event handler');
assert.equal(first.listeners.ended.length, 1, 'repeat wingbeats share a single natural-end listener');
assert.equal(audio.stopWingflapSfx(birds[0]), true, 'gliding can stop an unresolved native playback request');
assert.equal(first.pauseCount, 1);
assert(played.slice(1, 6).every(voice => voice.pauseCount === 0), 'glide never stops a different bird');
assert.equal(wet.stopped, false, 'another bird retains its echo');
first.paused = false;
first.emit('playing');
await Promise.resolve();
assert.equal(wetRequests.length, 1, 'late playing notification after glide cannot start a phantom echo');
assert.equal(audio.stopWingflapSfx(birds[1]), true);
assert.equal(wet.stopped, true, 'glide stops the owned wet input');
assert.equal(wet.opts.getOffsetS(), null, 'late wet decode cannot inject a new flap after glide');

for (const flyer of birds) audio.stopWingflapSfx(flyer);
assert.equal(audio.wingflapSfxDebugSnapshot().active, 0);
console.log('Wingflap pending native playback: six unique reserved voices, no stealing, owned native echo and safe end/glide cleanup PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
