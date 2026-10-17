#!/usr/bin/env node
'use strict';

// The release ("strike") voice must already be rendered when the windup ends.
// It used to be pitch-rolled and WSOLA-rendered only at that moment; with a new
// random pitch every swing the render cache never hit, so on slower devices it
// started late or not at all and only the windup grunt (ending at the strike)
// was heard. prewarmStrikeGrunt rolls the pitch and renders at attack start;
// playStrikeGrunt with that preset must request the identical render.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'combat', 'combat-vocalizations.js'), 'utf8');

const renders = [];
const started = [];
function fakeBuffer(durationS) {
  return { duration: durationS, length: Math.round(durationS * 44100), sampleRate: 44100, numberOfChannels: 1, getChannelData: () => new Float32Array(8) };
}
const decoded = fakeBuffer(0.55);
const param = () => ({ value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} });
class FakeAudioContext {
  constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; }
  decodeAudioData(data, ok) { ok(decoded); return Promise.resolve(decoded); }
  createGain() { return { gain: param(), connect() {}, disconnect() {} }; }
  createStereoPanner() { return { pan: param(), connect() {}, disconnect() {} }; }
  createBufferSource() { return { playbackRate: param(), connect() {}, disconnect() {}, start(when, offset) { started.push({ when, offset, buffer: this.buffer }); }, stop() {} }; }
}

const player = { health: 100, maxHealth: 100, stamina: 100, maxStamina: 100 };
const window = {
  AudioContext: FakeAudioContext,
  Combat: { deps: { player } },
  AudioSystem: { gameAudioConfig: () => ({ enabled: true, sfxVolume: 1 }) },
  AnimalVoiceIndependentPlayback: {
    trimDecodedSilence: buffer => ({ buffer }), // Cached per buffer in the real module: same object every call.
    renderDecodedIndependentBuffer(buffer, ctx, opts) {
      renders.push({ buffer, opts: { ...opts } });
      const durationS = buffer.duration / opts.tempo;
      return Promise.resolve({ buffer: fakeBuffer(durationS), playbackRate: 1, durationS });
    },
  },
  addEventListener() {},
  localStorage: { getItem: () => null },
};
window.window = window;
const context = {
  window, console, Math, Number, Object, Array, Map, Set, WeakMap, WeakSet, Promise, JSON, Error,
  performance: { now: () => 1000 },
  document: { addEventListener() {} },
  localStorage: window.localStorage,
  setTimeout: () => 0, clearTimeout() {},
  fetch: async url => (String(url).endsWith('.json') || String(url).includes('.json?')
    ? { ok: false, json: async () => null }
    : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'combat-vocalizations.js' });

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

(async () => {
  const api = window.CombatVocalizations;
  await api.configPromise;
  await flush();
  renders.length = 0;

  const releaseS = 1.07;
  const preset = api.prewarmStrikeGrunt(player, 'combo', releaseS);
  assert.ok(preset?.url, 'prewarm picks the release clip up front');
  assert.ok(Number.isFinite(preset.pitchOffsetSemitones), 'prewarm rolls the release pitch up front');
  await flush();
  assert.equal(renders.length, 1, 'the release voice is rendered at attack start, during the windup');

  api.playStrikeGrunt(player, 'combo', 'swingCombo', releaseS, 0, preset);
  await flush();
  assert.equal(renders.length, 2);
  assert.equal(renders[1].buffer, renders[0].buffer, 'same trimmed source buffer');
  assert.deepEqual(renders[1].opts, renders[0].opts, 'windup-end playback requests the identical (cached) render');
  assert.ok(started.length >= 1 && started.at(-1).offset === 0, 'release voice starts from its beginning');
  assert.ok(Math.abs(started.at(-1).buffer.duration - releaseS) < 1e-9, 'release voice is stretched over the full release span');

  console.log('Combat release grunt is pre-rendered during the windup: ok');
})().catch(error => { console.error(error); process.exit(1); });
