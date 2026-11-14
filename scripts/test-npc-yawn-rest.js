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
  let audioActor = null; // Used to prove spatial voice remains attached to a moving NPC.
  const expressions = new Map(); // Tracks yawn mouth ownership and verifies it is cleaned up.
  const toasts = []; // Ensures the exact authored text is emitted only on the daily ritual.
  const pendingChews = new Map(); // Models the drink-strike callback being withheld until a leaf is actually chewed.
  const storage = new Map(); // Mimics per-character localStorage persistence.
  const hostiles = new Set(); // The actual Combat.deps hostile set gates NPC yawns.
  const listeners = {}; // Captures the real sleep-completion event listener added by NpcYawnRest.
  let playerKomaOptions = null; // Records action-lock and facing ownership on the player ceremony.
  let completedBedSleeps = 0; // Legacy BedLiePose can finish sleep without the newer time-passage event.
  let playerRested = true; // Starts protected while isolated NPC tests run, then exercises player hourly yawns explicitly.
  const playerChestChannels = new Map(); // Verifies the shared player body compositor receives and clears its yawn contribution.
  const walker = {
    rec: { id: 'test-npc', appearance: { speciesId: 'tletingan', gender: 'female' } },
    root: { parent: {}, position: { x: 2, z: 3 } },
    area: 'farm', neckJoint: { rotation: { x: 0 } }, alcoholPoseGroup: { rotation: { x: 0 } },
    state: 'idle', currentScheduleTarget: { pose: 'stand' }, _bedLieActive: false,
  }; // Same public shape as game.js's makeNpcWalker.
  const playerRoot = { parent: {}, position: { x: 1, z: 1 }, rotation: { x: 0, y: 0 } }; // Same outer world root as game.js playerMesh.
  const playerAvatar = { parent: playerRoot, userData: { neckRig: { neckJoint: { rotation: { x: 0 } } } } }; // WorldPortraitLife exposes the current player portrait.
  const window = {
    _npcWalkers: [walker],
    __hobunjiPlayerProfile: { characterId: 'character-a', appearance: { speciesId: 'mao-ao', gender: 'female' } },
    WorldPortraitLife: { getPlayerAvatar: () => ({ group: playerAvatar }) },
    PlayerBodyTransformComposer: {
      setChannel: (name, channel) => playerChestChannels.set(name, channel),
      clearChannel: name => playerChestChannels.delete(name),
    },
    TemplePrayerRestBlessings: { isRested: () => playerRested, isWellRested: () => false },
    BedLiePose: { debug: () => ({ completed: completedBedSleeps }) },
    CalendarSystem: {
      isInitialized: () => true,
      getAbsoluteGameHour: () => hour, // Full-day clock remains monotonic at midnight and at the 06:00 rollover.
      constants: { FULL_DAY_CYCLE: true, DAY_ROLLOVER_HOUR: 6 },
      timeDebugSnapshot: () => ({ rawDay: Math.floor(hour / 24), time01: (hour % 24) / 24, fullDayClock: true, dayRolloverHour: 6 }),
    },
    RuntimeFrameScheduler: { register: (id, cb, options) => { assert.equal(id, 'npc-yawn-rest'); assert.equal(options.phase, 'pre-render'); frame = cb; } },
    Combat: { deps: { TILE: 64, player: { id: 'real-player' }, hostileObjects: hostiles, getCurrentArea: () => 'farm' } },
    NpcDrinkInteraction: {
      playDailyKoma: (actor, onDrink, durationS, options = {}) => {
        ceremonies++; assert.equal(durationS, 5);
        if (actor.rec.id === '__player_daily_koma__') {
          playerKomaOptions = options;
          assert.equal(options.participantId, 'player', 'the real player actions must be locked, never npc:player');
          assert.equal(options.preserveFacing, true);
          assert.equal(options.allowWalking, true, 'player Koma still allows the quarter-speed yawn walk');
        }
        if (actor.rec.id === 'longoran-retry') pendingChews.set(actor.rec.id, onDrink);
        else onDrink();
        return 5000;
      },
      stopAutonomous: (actor, itemKey) => {
        assert.equal(itemKey, '__daily_koma_leaf__');
        pendingChews.delete(actor.rec.id); interruptions++;
      },
    },
    ToastNotifications: { showToast: text => toasts.push(text) },
    DialogueContent: { dialogueSeatId: walker => walker.rec.id, npcRestingExpression: () => 'neutral' },
    portraitBreathingComposer: {
      getExpression: id => expressions.get(id) || 'neutral',
      setExpression: (id, value) => expressions.set(id, value),
      clearExpression: id => expressions.delete(id),
    },
    CombatVocalizations: {
      getVoiceModulation: entity => entity.rec.appearance.gender === 'female'
        ? { pitchSemitones: 7, tempo: 0.8, gain: 1.25 }
        : { pitchSemitones: 1, tempo: 1, gain: 1 },
      getConfig: () => ({ assets: { breath: { '1': 'assets/audio/sfx/combat/breath.m4a' } } }),
      getVoicePriority: () => 3,
    },
    AudioSystem: {
      gameAudioConfig: () => ({ enabled: true, sfxVolume: 1 }),
      combatAudioSpatial: actor => { audioActor = actor; return { gain: 1 }; },
    },
    AnimalVoiceIndependentPlayback: {
      playIndependent: (_url, opts) => { audioOptions = opts; return { stop() {} }; },
    },
    CharacterVoiceOwner: { request: () => ({}), bindStop() {}, release() {} },
    __farmLog() {}, addEventListener(name, callback) { listeners[name] = callback; },
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
  assert.equal(runtime._test.nowGameHour(), 12, 'the yawn timer uses actual game hours, not 24 * normalized time01');
  const initial = runtime._test.stateFor(walker, hour).nextHour;
  const another = runtime._test.stateFor({ rec: { id: 'another-npc' } }, hour).nextHour;
  assert.notEqual(initial, another, 'villagers must not all yawn simultaneously when spawned on the same hour');
  assert.ok(initial > 12 && initial <= 13 && another > 12 && another <= 13);
  const authoritativeHour = window.CalendarSystem.getAbsoluteGameHour;
  window.CalendarSystem.getAbsoluteGameHour = null;
  window.CalendarSystem.timeDebugSnapshot = () => ({ rawDay: 3, time01: .5, fullDayClock: true, dayRolloverHour: 6 });
  assert.equal(runtime._test.nowGameHour(), 3 * 24 + 6 + 12, '24h fallback maps a half-day to 18:00 after the 06:00 rollover');
  window.CalendarSystem.timeDebugSnapshot = () => ({ rawDay: 3, time01: .75, fullDayClock: true });
  const midnight = runtime._test.nowGameHour();
  window.CalendarSystem.timeDebugSnapshot = () => ({ rawDay: 3, time01: .76, fullDayClock: true });
  assert.ok(runtime._test.nowGameHour() > midnight, 'absolute time never jumps backward as the sky clock wraps past midnight');
  window.CalendarSystem.timeDebugSnapshot = () => ({ rawDay: null, time01: null });
  assert.ok(Number.isNaN(runtime._test.nowGameHour()), 'uninitialized calendar must not seed fake fatigue clocks');
  window.CalendarSystem.getAbsoluteGameHour = authoritativeHour;
  hour = 13; ms = 500; frame({ timestamp: ms });
  assert.equal(runtime.movementMultiplier('test-npc'), 0.25);
  assert.equal(ceremonies, 1, 'first Slagothim yawn of day chews Koma');
  assert.deepEqual(toasts, [], 'an NPC Koma chew must NEVER display a toast addressed to the player');
  assert.equal(runtime.debugSnapshot().lastYawn.reason, 'hourly fatigue');
  assert.equal(expressions.get('test-npc'), 'yap', 'use the existing mouth-open sprite during a yawn');
  assert.ok(storage.has('hobunji_npc_yawn_rest_v2:character-a'));

  const femaleVoice = await runtime._test.voiceFor('tletingan', 'female');
  assert.equal(femaleVoice.source, 'male yawn, relative female modulation');
  assert.equal(femaleVoice.pitch, 6, 'female pitch must be relative to the male source');
  assert.equal(femaleVoice.tempo, 0.8);
  assert.equal(femaleVoice.gain, 1.25);
  for (let i = 0; i < 8 && !audioOptions; i++) await Promise.resolve();
  assert.ok(audioOptions, 'the first yawn must actually play a voice, not merely return a playback plan');
  assert.equal(audioOptions.pitchSemitones, 6);
  assert.equal(audioOptions.tempo, 0.8);
  assert.equal(audioOptions.volume, Math.min(1, 0.72 * 1.25));
  assert.equal(audioActor?.x, 128);
  walker.root.position.x = 6;
  assert.equal(audioActor?.x, 384, 'the playing voice must follow a moving walker instead of freezing its starting position');
  walker.root.position.x = 2;

  ms = 3000; frame({ timestamp: ms });
  assert.ok(walker.neckJoint.rotation.x < -0.20, 'head must stretch during the yawn');
  assert.ok(walker.alcoholPoseGroup.rotation.x < -0.05, 'torso should contribute visible chest extension');
  ms = 5500; frame({ timestamp: ms });
  assert.equal(runtime.movementMultiplier('test-npc'), 1, 'speed must restore after exactly five seconds');
  assert.equal(walker.neckJoint.rotation.x, 0, 'head pose must restore without residual additive offsets');
  assert.equal(walker.alcoholPoseGroup.rotation.x, 0, 'torso pose must restore without residual offsets');
  assert.equal(expressions.has('test-npc'), false, 'resting mouth must return when yawn finishes');
  hour = 14; ms = 6000; frame({ timestamp: ms });
  assert.equal(ceremonies, 1, 'hourly yawns must not consume another Koma leaf on the same day');

  ms = 6500;
  hostiles.add({ health: 5, areaId: 'farm', state: 'chase' });
  frame({ timestamp: ms });
  assert.equal(runtime.movementMultiplier('test-npc'), 1, 'combat interrupts an active yawn');
  hour = 15; ms = 7000; frame({ timestamp: ms });
  assert.equal(runtime.debugSnapshot().active.length, 0, 'combat prevents new hourly yawns');
  hostiles.clear();
  walker.state = 'alcohol-blackout';
  ms = 7400; frame({ timestamp: ms });
  assert.equal(runtime.debugSnapshot().active.length, 0, 'a blacked-out NPC cannot yawn');
  walker.state = 'idle';
  window.FestivalWheelDanceRuntime = { isPartner: () => true };
  ms = 7800; frame({ timestamp: ms });
  assert.equal(runtime.debugSnapshot().active.length, 0, 'partner dances must own their body pose');
  window.FestivalWheelDanceRuntime = null;

  walker.currentScheduleTarget = { pose: 'lie' };
  walker._bedLieActive = true;
  ms = 8200; frame({ timestamp: ms });
  hour = 18; ms = 8600; frame({ timestamp: ms });
  walker.currentScheduleTarget = { pose: 'stand' };
  walker._bedLieActive = false;
  ms = 9000; frame({ timestamp: ms });
  assert.equal(runtime.debugSnapshot().lastYawn.reason, 'waking');
  assert.equal(runtime.movementMultiplier('test-npc'), 0.25);
  ms = 14000; frame({ timestamp: ms });
  hour = 20.99; ms = 14900; frame({ timestamp: ms });
  assert.equal(runtime.debugSnapshot().active.length, 0, 'three-hour NPC Rested protects until its actual expiry');
  hour = 21; ms = 15400; frame({ timestamp: ms });
  assert.equal(runtime.debugSnapshot().lastYawn.reason, 'hourly fatigue', 'NPC yawns resume at the three-hour boundary, without a hidden extra hour');
  assert.equal(ceremonies, 1, 'Koma cannot refresh merely because midnight passed');
  ms = 20500; frame({ timestamp: ms });
  hour = 37; ms = 21000; frame({ timestamp: ms });
  assert.equal(ceremonies, 2, 'first eligible yawn after 24 rolling in-game hours repeats Koma');

  const noYawnClip = await runtime._test.voiceFor('kenkari', 'female');
  assert.equal(noYawnClip.source, 'breathing x4 duration');
  assert.equal(noYawnClip.tempo, 0.2, 'female tempo 0.8/4 is a genuine fourfold duration');
  assert.equal(noYawnClip.pitch, 7, 'breath fallback keeps the full female species modulation');
  assert.equal(noYawnClip.url, 'assets/audio/sfx/combat/breath.m4a');
  assert.equal(interruptions, 0, 'only currently active Koma events require interruption cleanup');

  const retryNpc = {
    rec: { id: 'longoran-retry', appearance: { speciesId: 'longoran', gender: 'male' } },
    root: { parent: {}, position: { x: 4, z: 2 } }, area: 'farm', state: 'idle',
    neckJoint: { rotation: { x: 0 } }, alcoholPoseGroup: { rotation: { x: 0 } },
    currentScheduleTarget: { pose: 'stand' }, _bedLieActive: false,
  }; // Second independent NPC whose first Koma ceremony is interrupted before the drink's strike.
  window._npcWalkers.push(retryNpc);
  hour = 38; ms = 27000; frame({ timestamp: ms }); // Initializes its first yawn in a different game hour.
  hour = 39; ms = 27500; frame({ timestamp: ms });
  assert.equal(ceremonies, 3, 'the Longoran begins its first daily ceremony');
  assert.ok(pendingChews.has('longoran-retry'));
  hostiles.add({ health: 5, areaId: 'farm', state: 'chase' });
  ms = 28000; frame({ timestamp: ms });
  assert.equal(interruptions, 1, 'combat cancels the unfinished daily Koma ceremony');
  assert.equal(pendingChews.has('longoran-retry'), false, 'cancellation must not invoke the drink strike');
  hostiles.clear();
  hour = 40; ms = 33000; frame({ timestamp: ms });
  assert.equal(ceremonies, 4, 'interrupted Koma is retried at the next yawn, not suppressed for 24 hours');
  assert.ok(pendingChews.has('longoran-retry'));
  pendingChews.get('longoran-retry')();
  assert.equal(toasts.length, 0, 'no NPC toast even when an interrupted ceremony is successfully retried');

  const sleepEvent = listeners['hobunji-time-passage'];
  assert.equal(typeof sleepEvent, 'function', 'the system must listen for actual player sleep completion');
  sleepEvent({ detail: { kind: 'wait', hours: 8 } });
  hour = 41; ms = 39000; frame({ timestamp: ms });
  assert.equal(runtime.debugSnapshot().playerWakePending, false, 'waiting does not make the player yawn');

  sleepEvent({ detail: { kind: 'sleep', hours: 8 } });
  hour = 42; ms = 40000; frame({ timestamp: ms });
  assert.equal(runtime.debugSnapshot().lastYawn.reason, 'player waking');
  assert.equal(ceremonies, 4, 'Mao-ao players never chew ceremonial Koma');
  assert.equal(toasts.length, 0, 'Mao-ao player has no Koma toast');
  assert.equal(expressions.get('player'), 'yap', 'the player wakes with the existing mouth-open yawn expression');
  assert.equal(runtime.playerMovementMultiplier(), .25, 'player waking yawn slows walking to 25% like NPC fatigue');
  ms = 43000; frame({ timestamp: ms });
  assert.ok(playerChestChannels.has('player-yawn-rest'), 'player torso uses the shared body transform compositor');
  ms = 46000; frame({ timestamp: ms });
  assert.equal(expressions.has('player'), false, 'player mouth expression clears after the yawn');
  assert.equal(runtime.playerMovementMultiplier(), 1, 'the player speed returns to normal after five seconds');
  assert.equal(playerChestChannels.has('player-yawn-rest'), false, 'the torso channel is cleared after yawning');

  for (const species of ['tletingan', 'nuhongan', 'longoran']) {
    window.__hobunjiPlayerProfile.appearance.speciesId = species; // Simulates each playable subspecies in turn without rebuilding the harness.
    sleepEvent({ detail: { kind: 'sleep', hours: 8 } });
    hour += 25; ms += 6500; frame({ timestamp: ms });
    assert.equal(toasts.length, ['tletingan', 'nuhongan', 'longoran'].indexOf(species) + 1, 'each eligible player subspecies receives exactly its own successful-chew toast');
    assert.equal(toasts.at(-1), 'You chew your daily koma leaves so that you may run and jump as the outlanders do.');
    assert.equal(playerKomaOptions.participantId, 'player');
    ms += 5100; frame({ timestamp: ms });
  }
  window.__hobunjiPlayerProfile.appearance.speciesId = 'slagothim';
  sleepEvent({ detail: { kind: 'sleep', hours: 8 } });
  hour += 25; ms += 6500; frame({ timestamp: ms });
  assert.equal(toasts.length, 3, 'generic Slagothim are not an eligible player subspecies');
  ms += 5100; frame({ timestamp: ms });
  window.__hobunjiPlayerProfile.appearance.speciesId = 'tletingan';
  completedBedSleeps++; // Legacy bed sleep completes with no hobunji-time-passage event.
  hour += 25; ms += 6500; frame({ timestamp: ms });
  assert.ok(runtime.debugSnapshot().active.some(entry => entry.npcId === '__player_daily_koma__'),
    'legacy bed wake animates the player even when other NPCs also yawn in the same frame');
  assert.equal(toasts.length, 4, 'legacy bed wake still lets an eligible player chew their daily Koma');
  assert.equal(runtime.playerMovementMultiplier(), .25, 'player Koma yawn still uses the quarter-speed movement multiplier');
  ms += 6000; frame({ timestamp: ms });
  playerRested = false;
  hour += 2; ms += 600; frame({ timestamp: ms });
  assert.ok(runtime.debugSnapshot().active.some(entry => entry.npcId === '__player_daily_koma__'),
    'an un-rested player yawns hourly, even when they did not just wake from Sleep');
  assert.equal(runtime.playerMovementMultiplier(), .25, 'hourly player yawns apply 75% slowdown too');
  ms += 5200; frame({ timestamp: ms });
  assert.equal(runtime.playerMovementMultiplier(), 1, 'hourly player yawn finishes after five seconds');
  playerRested = true; // Rested and Well Rested both prevent new fatigue yawns.
  hour += 2; ms += 500; frame({ timestamp: ms });
  assert.equal(runtime.playerMovementMultiplier(), 1, 'Rested prevents the next hourly player fatigue event');

  const longSleeper = {
    rec: { id: 'full-night-sleeper', appearance: { speciesId: 'mao-ao', gender: 'male' } },
    root: { parent: {}, position: { x: 4, z: 4 } }, area: 'farm', state: 'idle',
    neckJoint: { rotation: { x: 0 } }, alcoholPoseGroup: { rotation: { x: 0 } },
    currentScheduleTarget: { pose: 'lie' }, _bedLieActive: true,
  }; // Deliberately observes an uninterrupted eight-hour sleep to earn full 16h NPC protection.
  window._npcWalkers.push(longSleeper);
  hour = 100; ms += 500; frame({ timestamp: ms });
  hour = 108; longSleeper._bedLieActive = false; longSleeper.currentScheduleTarget = { pose: 'stand' };
  ms += 500; frame({ timestamp: ms });
  assert.equal(runtime._test.stateFor(longSleeper, hour).restedUntil, 124, 'eight hours of NPC sleep grants 16h protection');
  assert.equal(runtime._test.stateFor(longSleeper, hour).nextHour, 124, 'full NPC Well Rested also resumes fatigue at 16h, not 17h');

  playerRested = false; // A fresh fatigue cycle lets the test cover excluded player poses.
  window.__hobunjiFurnitureDebug = { sitState: { phase: 'out' } }; // Standing up still owns the body's rig until the seat state is removed.
  hour = 180; ms += 600; frame({ timestamp: ms });
  assert.equal(runtime.playerMovementMultiplier(), 1, 'the final stand-up transition must suppress a new yawn');
  window.__hobunjiFurnitureDebug.sitState = null;
  window.Combat.deps.player.prone = true; // Native impact poses are not compatible with yawn chest/neck animation.
  ms += 600; frame({ timestamp: ms });
  assert.equal(runtime.playerMovementMultiplier(), 1, 'a prone player must not begin an hourly yawn');
  window.Combat.deps.player.prone = false;
  ms += 600; frame({ timestamp: ms });
  assert.equal(runtime.playerMovementMultiplier(), .25, 'a player who has finished standing and recovering may yawn normally');
  window.Combat.deps.player.prone = true;
  ms += 600; frame({ timestamp: ms });
  assert.equal(runtime.playerMovementMultiplier(), 1, 'becoming prone interrupts and fully restores the player yawn speed');
  assert.equal(playerChestChannels.has('player-yawn-rest'), false, 'prone interruption removes the additive player torso pose');
  window.Combat.deps.player.prone = false;
  window.Fishing = { state: { active: true } };
  hour += 2; ms += 600; frame({ timestamp: ms });
  assert.equal(runtime.playerMovementMultiplier(), 1, 'active fishing animation owns the body and defers yawns');
  console.log('Player/NPC hourly yawns, 75% slow, guarded stand/prone/tool poses, short Rested and eight-hour Well Rested: OK');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
