#!/usr/bin/env node
// Run with: node scripts/test-npc-yawn-rest.js
// Validates the existing in-game clock/sleep/voice/ceremonial drink seams in a minimal browser VM.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function main() {
  let ms = 0; // Drives the five-second yawn without real timers.
  let hour = 12; // Drives the monotonic game-hour rest/recurrence clock.
  let frame = null; // Captured RuntimeFrameScheduler callback for explicit frame steps.
  let ceremonies = 0; // Counts Slagothim Koma events without rendering Three.js.
  let interruptions = 0; // Counts aborted ceremonial drinks after combat begins.
  let audioOptions = null; // Records actual independently modulated pitch and tempo.
  const toasts = []; // Ensures the exact authored text is emitted only on the daily ritual.
  const storage = new Map(); // Mimics per-character localStorage persistence.
  const hostiles = new Set(); // The actual Combat.deps hostile set gates NPC yawns.
  const walker = {
    rec: { id: 'test-npc', appearance: { speciesId: 'tletingan', gender: 'female' } },
    root: { parent: {}, position: { x: 2, z: 3 } },
    area: 'farm', neckJoint: { rotation: { x: 0 } },
    state: 'idle', currentScheduleTarget: { pose: 'stand' }, _bedLieActive: false,
  }; // Same public shape as game.js's makeNpcWalker.
  const window = {
    _npcWalkers: [walker],
    __hobunjiPlayerProfile: { characterId: 'character-a' },
    CalendarSystem: { timeDebugSnapshot: () => ({ rawDay: Math.floor(hour / 24), time01: (hour % 24) / 24 }) },
    RuntimeFrameScheduler: { register: (id, cb, options) => { assert.equal(id, 'npc-yawn-rest'); assert.equal(options.phase, 'pre-render'); frame = cb; } },
    Combat: { deps: { TILE: 64, hostileObjects: hostiles, getCurrentArea: () => 'farm' } },
    NpcDrinkInteraction: {
      playDailyKoma: (_walker, onDrink, durationS) => { ceremonies++; assert.equal(durationS, 5); onDrink(); return 5000; },
      stopAutonomous: (_walker, itemKey) => { assert.equal(itemKey, '__daily_koma_leaf__'); interruptions++; },
    },
    ToastNotifications: { showToast: text => toasts.push(text) },
    CombatVocalizations: {
      getVoiceModulation: entity => entity.rec.appearance.gender === 'female'
        ? { pitchSemitones: 7, tempo: 0.8, gain: 1.25 }
        : { pitchSemitones: 1, tempo: 1, gain: 1 },
      getConfig: () => ({ assets: { breath: { '1': 'assets/audio/sfx/combat/breath.m4a' } } }),
      getVoicePriority: () => 3,
    },
    AudioSystem: {
      gameAudioConfig: () => ({ enabled: true, sfxVolume: 1 }),
      combatAudioSpatial: () => ({ gain: 1 }),
    },
    AnimalVoiceIndependentPlayback: {
      playIndependent: (_url, opts) => { audioOptions = opts; return { stop() {} }; },
    },
    CharacterVoiceOwner: { request: () => ({}), bindStop() {}, release() {} },
    __farmLog() {}, addEventListener() {},
  };
  const localStorage = {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
  };
  const fetch = async url => ({ ok: /sfx_yawn_tletingan_male\.ogg$/.test(url) }); // Female borrows the male clip; other species lack a yawn.
  const source = fs.readFileSync(path.join(__dirname, '../docs/js/npc-yawn-rest.js'), 'utf8');
  vm.runInNewContext(source, { window, localStorage, performance: { now: () => ms }, fetch, Promise });
  const runtime = window.NpcYawnRest;
  assert.equal(typeof frame, 'function', 'module must register its live scheduler');

  frame({ timestamp: ms });
  assert.equal(runtime.debugSnapshot().active.length, 0, 'new awake NPC begins with one full game-hour grace');
  hour = 13; ms = 500; frame({ timestamp: ms });
  assert.equal(runtime.movementMultiplier('test-npc'), 0.25);
  assert.equal(ceremonies, 1, 'first Slagothim yawn of day chews Koma');
  assert.deepEqual(toasts, ['You chew your daily koma leaves so that you may run and jump as the outlanders do.']);
  assert.equal(runtime.debugSnapshot().lastYawn.reason, 'hourly fatigue');
  assert.ok(storage.has('hobunji_npc_yawn_rest_v1:character-a'));

  const femaleVoice = await runtime._test.voiceFor('tletingan', 'female');
  assert.equal(femaleVoice.source, 'male yawn, relative female modulation');
  assert.equal(femaleVoice.pitch, 6, 'female pitch must be relative to the male source');
  assert.equal(femaleVoice.tempo, 0.8);
  assert.equal(femaleVoice.gain, 1.25);

  ms = 5500; frame({ timestamp: ms });
  assert.equal(runtime.movementMultiplier('test-npc'), 1, 'speed must restore after exactly five seconds');
  hour = 14; ms = 6000; frame({ timestamp: ms });
  assert.equal(ceremonies, 1, 'hourly yawns must not consume another Koma leaf on the same day');

  ms = 6500;
  hostiles.add({ health: 5, areaId: 'farm', state: 'chase' });
  frame({ timestamp: ms });
  assert.equal(runtime.movementMultiplier('test-npc'), 1, 'combat interrupts an active yawn');
  hour = 15; ms = 7000; frame({ timestamp: ms });
  assert.equal(runtime.debugSnapshot().active.length, 0, 'combat prevents new hourly yawns');
  hostiles.clear();

  walker.currentScheduleTarget = { pose: 'lie' };
  walker._bedLieActive = true;
  ms = 7500; frame({ timestamp: ms });
  hour = 18; ms = 8000; frame({ timestamp: ms });
  walker.currentScheduleTarget = { pose: 'stand' };
  walker._bedLieActive = false;
  ms = 8500; frame({ timestamp: ms });
  assert.equal(runtime.debugSnapshot().lastYawn.reason, 'waking');
  assert.equal(runtime.movementMultiplier('test-npc'), 0.25);
  ms = 14000; frame({ timestamp: ms });
  hour = 33; ms = 14500; frame({ timestamp: ms });
  assert.equal(runtime.debugSnapshot().active.length, 0, '16-hour post-sleep rest buff suppresses fatigue');
  hour = 35; ms = 15000; frame({ timestamp: ms });
  assert.equal(runtime.debugSnapshot().lastYawn.reason, 'hourly fatigue');
  assert.equal(ceremonies, 2, 'first next-day yawn repeats the Koma ritual');

  const noYawnClip = await runtime._test.voiceFor('kenkari', 'female');
  assert.equal(noYawnClip.source, 'breathing x4 duration');
  assert.equal(noYawnClip.tempo, 0.2, 'female tempo 0.8/4 is a genuine fourfold duration');
  assert.equal(noYawnClip.pitch, 7, 'breath fallback keeps the full female species modulation');
  assert.equal(noYawnClip.url, 'assets/audio/sfx/combat/breath.m4a');
  assert.equal(interruptions, 0, 'only currently active Koma events require interruption cleanup');
  console.log('NPC yawn, wake, hourly rest, combat suppression, female voice and daily Koma: OK');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
