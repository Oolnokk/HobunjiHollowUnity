#!/usr/bin/env node
'use strict';
// Playback-level regression for pitched Kurraya ruin motifs and the muted-SFX edge case.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/game-feel.js', 'utf8');

async function main() {
  const played = []; // Recorded sample sources and scheduled note times for all three ruin motifs.
  let oscillators = 0; // A decoded Kurraya asset should never use oscillator-based bell fallback.
  const gain = () => ({ gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} });
  class FakeAudioContext {
    constructor() { this.state = 'running'; this.currentTime = 12; this.destination = {}; }
    decodeAudioData() { return Promise.resolve({ duration: 3 }); }
    createGain() { return gain(); }
    createBufferSource() {
      const event = { rate: 0, at: null, stoppedAt: null }; // A note must transpose C4 using the sampler's real MIDI-60 root.
      return { buffer: null, playbackRate: { setValueAtTime: v => { event.rate = v; } },
        connect() {}, start: at => { event.at = at; played.push(event); }, stop: at => { event.stoppedAt = at; } };
    }
    createOscillator() { oscillators++; throw new Error('unexpected synthesizer oscillator'); }
  }
  let enabled = true; // Mirrors the actual SFX mute setting across a later cue.
  const window = { AudioContext: FakeAudioContext, AudioSystem: { gameAudioConfig: () => ({ enabled, sfxVolume: 1 }) } };
  const context = { window, performance: { now: () => 100 }, localStorage: { getItem: () => '1' },
    fetch: async url => {
      assert.equal(url, 'assets/audio/music/instruments/sfx_kurraya_pluck.m4a');
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    } };
  vm.runInNewContext(source, context);
  const feel = window.GameFeel;
  feel.init({ getCurrentArea: () => 'map_i_dev_random_ruin' }); // Start decode at game init, before the first treasure or puzzle.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(feel.solveChime(), true);
  assert.equal(feel.progressNote(3, 5), true);
  assert.equal(feel.treasureFanfare(3), true);
  assert.equal(played.length, 15, 'solve has six plucks, progress one, and tier-three treasure has eight');
  assert(Math.abs(played[0].rate - 587.33 / 261.625565) < 0.001, 'the opening solve pitch is C4-relative');
  assert.equal(played[1].at - played[0].at > 0.1, true, 'solve motif preserves its note spacing');
  assert.equal(oscillators, 0, 'all ruin cues use the recorded Kurraya pluck when decoded');
  assert.equal(feel.debugSnapshot().lastRuinNoteSource, 'kurraya-pluck', 'mobile diagnostics show the real sample backend');
  const before = played.length;
  enabled = false;
  assert.equal(feel.solveChime(), false, 'SFX disabled silences the solve motif');
  assert.equal(feel.progressNote(1, 4), false, 'SFX disabled silences progress');
  assert.equal(feel.treasureFanfare(), false, 'SFX disabled silences treasure');
  assert.equal(played.length, before);

  // Missing asset: keep the old bell fallback instead of leaving ruin rewards silent.
  let fallbackOscillators = 0; // Counts synthesized partials only when the pluck asset cannot load.
  const fallbackContext = { ...context, window: {
    AudioContext: class extends FakeAudioContext {
      createOscillator() {
        fallbackOscillators++;
        return { type: '', frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} };
      }
    },
    AudioSystem: { gameAudioConfig: () => ({ enabled: true, sfxVolume: 1 }) },
  }, fetch: async () => ({ ok: false, status: 404 }) };
  vm.runInNewContext(source, fallbackContext);
  fallbackContext.window.GameFeel.init({});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fallbackContext.window.GameFeel.solveChime(), true, 'missing sample falls back to a playable cue');
  assert.equal(fallbackOscillators, 18, 'six chord/melody notes each synthesize three bell partials');
  assert.equal(fallbackContext.window.GameFeel.debugSnapshot().lastRuinNoteSource, 'bell-fallback');
  console.log('Kurraya ruin MIDI cue playback: OK');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
