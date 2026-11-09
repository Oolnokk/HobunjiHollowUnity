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

  const screamUrl = 'assets/audio/sfx/utterances/sfx_maskbound_scream.mp3'; // Single MP3 must supply every guardian combat utterance.
  const guardian = { id: 'maskbound-1', rosterRecord: { maskboundTroop: 'sentinel', appearance: { speciesId: 'maskbound-guardian', gender: 'male' } }, health: 50, maxHealth: 100, stamina: 15, maxStamina: 100 };
  const voiceRequests = []; // Records the public guardian voice-variant selection path by combat event.
  window.MaskboundGuardianCombat = {
    voiceSource: screamUrl,
    voiceVariantFor(entity, event) {
      if (entity !== guardian) return null;
      voiceRequests.push(event);
      return { url: screamUrl, pitchOffsetSemitones: 4.5, tempoMultiplier: 1.3, event };
    },
  };
  const screamRendersBefore = renders.length;
  const screamPreset = api.prewarmStrikeGrunt(guardian, 'combo', releaseS);
  assert.equal(screamPreset.url, screamUrl);
  assert.equal(screamPreset.voiceVariant.tempoMultiplier, 1.3);
  await flush();
  assert.equal(renders.length, screamRendersBefore + 1, 'guardian scream is rendered ahead of the strike');
  const screamPrewarm = renders.at(-1).opts;
  assert.equal(screamPrewarm.pitchSemitones, 4.5, 'guardian-specific vocal pitch is applied before strike');
  assert(Math.abs(screamPrewarm.tempo - (decoded.duration / releaseS) * 1.3) < 1e-9, 'guardian-specific tempo changes independently of pitch');
  api.playStrikeGrunt(guardian, 'combo', 'woodenSwing', releaseS, 0, screamPreset);
  await flush();
  assert.deepEqual(renders.at(-1).opts, screamPrewarm, 'attack windup and strike share the same transposed and time-stretched recording');

  const oneShots = []; // Captures dodge and pain playback through the generic voice owner and independent-pitch route.
  window.AnimalVoiceIndependentPlayback.playIndependent = (url, opts) => {
    oneShots.push({ url, ...opts }); return { independentPitch: true, stop() {} };
  };
  api.playDodge(guardian);
  assert.equal(oneShots.at(-1).url, screamUrl, 'guardian dodge uses the same maskbound sound file');
  assert.equal(oneShots.at(-1).pitchSemitones, 4.5, 'dodge pitch is applied without changing the source recording');
  assert(oneShots.at(-1).tempo > 1, 'dodge tempo is independently changed from the original source');
  assert(voiceRequests.includes('dodge') && voiceRequests.includes('strike'), 'combat events request distinct variants from one sound source');
  assert.equal(api.debugSnapshot().maskboundVoiceSource, screamUrl, 'on-device diagnostics expose the active guardian voice recording');

  console.log('Combat release grunt is pre-rendered during the windup, guardian variant included: ok');
})().catch(error => { console.error(error); process.exit(1); });
