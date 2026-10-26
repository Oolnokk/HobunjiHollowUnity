// Headless regression tests for the low-frequency honeyfuzzle soundscape.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let now = 1000, interval = null, fetchCount = 0, startCount = 0, stopCount = 0;
let requestedAudioUrl = null; // Captures the real fetch URL so the regression verifies the actual committed asset path.
const events = {}; // Keeps gesture callbacks for autoplay-unlock checks.
const world = { area: 'map_test', player: { x: 40 * 10, y: 40 * 10 }, actors: new Set() }; // Fake 40px tiles and the active world.
const sources = []; // AudioBufferSourceNode mocks reveal restarts and pitch automation.

class Param {
  constructor(value = 0) { this.value = value; this.targets = []; }
  setTargetAtTime(value) { this.value = value; this.targets.push(value); }
}
class Node {
  connect() { return this; }
  disconnect() {}
}
class Source extends Node {
  constructor() { super(); this.playbackRate = new Param(1); sources.push(this); }
  start() { startCount++; }
  stop() { stopCount++; }
}
class Gain extends Node { constructor() { super(); this.gain = new Param(0); } }
class Panner extends Node {
  constructor() { super(); this.positionX = new Param(0); this.positionY = new Param(0); this.positionZ = new Param(0); }
}
class Context {
  constructor() { this.state = 'running'; this.currentTime = 10; this.destination = new Node(); }
  createBufferSource() { return new Source(); }
  createGain() { return new Gain(); }
  createPanner() { return new Panner(); }
  createBuffer(channels, length, sampleRate) {
    const samples = new Float32Array(length);
    return { length, sampleRate, numberOfChannels: channels, duration: length / sampleRate, getChannelData: () => samples };
  }
  decodeAudioData() {
    return Promise.resolve({ sampleRate: 1000, length: 2000, numberOfChannels: 1,
      getChannelData: () => Float32Array.from({ length: 2000 }, (_, i) => Math.sin(i / 10)) });
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}
const deps = { TILE: 40, player: world.player, hostileObjects: world.actors, getCurrentArea: () => world.area,
  getCamera: () => ({ matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] } }) };
const fakeHives = { zoneId: world.area, excluded: false, hives: [
  { key: 'live', col: 11, row: 10, standing: true },
  { key: 'collapsed', col: 12, row: 10, standing: false },
  { key: 'distant', col: 100, row: 10, standing: true },
] };
const windowObject = {
  Combat: { deps }, AudioContext: Context,
  AudioSystem: { gameAudioConfig: () => ({ enabled: true, sfxVolume: 1 }) },
  HoneyfuzzleHives: { census: () => fakeHives },
  HoneyfuzzleHouse: { forEachAudioSource: callback => callback('farm-house', 11, 10) },
};
const context = { window: windowObject, performance: { now: () => now }, document: {
  hidden: false,
  addEventListener(type, fn) { events[type] = fn; },
  removeEventListener() {},
}, setInterval(fn) { interval = fn; return 1; }, clearInterval() {},
  fetch: url => { requestedAudioUrl = url; fetchCount++; return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }); },
  Math, Number, String, Map, Set, Array, Promise, Float32Array };
vm.runInNewContext(fs.readFileSync('docs/js/honeyfuzzle-audio.js', 'utf8'), context);
const audio = windowObject.HoneyfuzzleAudio;
const advance = (ms = 100) => { now += ms; interval(); };

assert.equal(audio.dopplerRate(2, 0, -4, 0, 0, 0) > 1, true, 'approaching sources pitch up');
assert.equal(audio.dopplerRate(2, 0, 4, 0, 0, 0) < 1, true, 'receding sources pitch down');
assert.equal(audio.aggression({ _territorialBehavior: { phase: 'warning' } }), 0.48);
assert.equal(audio.aggression({ _territorialBehavior: { phase: 'fight' } }), 1);
assert.equal(audio.aggression({ _hiveTucked: true, state: 'chase' }), 0);

const actor = { id: 'swarm-one', hiveKey: 'map_test:hive:live', creatureKey: 'honeyfuzzle', health: 20, x: 12 * 40, y: 10 * 40, state: 'idle' };
const dead = { id: 'dead', creatureKey: 'honeyfuzzle', health: 0, x: 11 * 40, y: 10 * 40 };
world.actors.add(actor); world.actors.add(dead);
advance(400);
assert.equal(audio.debugSnapshot().candidateCount, 2, 'standing hive + nearby wild swarm; not dead, collapsed or distant');
(async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve(); // Fetch/decode are deliberately deferred off the gameplay tick.
  assert.equal(fetchCount, 1, 'one recording fetched for all emitters');
  assert.equal(requestedAudioUrl, 'assets/audio/sfx/utterances/sfx_honeyfuzzle_buzz.m4a', 'fetches the existing M4A asset in utterances without the restored suffix');
  advance(400);
  assert.equal(audio.debugSnapshot().activeVoices, 2, 'one voice per emitter');
  assert.equal(startCount, 2, 'only two reusable sources started');
  const voice = sources[1];
  const calm = voice.playbackRate.value;
  actor._territorialBehavior = { phase: 'fight' };
  actor.x -= 40 * 0.4;
  advance(100);
  assert.equal(voice.playbackRate.value > calm, true, 'aggression and approach change live playback rate');
  assert.equal(startCount, 2, 'no loop restart on pitch change');
  world.area = 'farm';
  advance(400);
  assert.equal(audio.debugSnapshot().candidateCount, 1, 'farm occupied house becomes audible');
  advance(1000);
  assert.equal(stopCount >= 2, true, 'out-of-area voices are released');
  audio.silence();
  assert.equal(audio.debugSnapshot().activeVoices, 0, 'intro silence clears every active emitter');
  audio.dispose();
  console.log('Honeyfuzzle spatial buzz: all regression assertions passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
