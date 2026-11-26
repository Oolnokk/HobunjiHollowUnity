#!/usr/bin/env node
// Run with: node scripts/test-npc-yawn-rest.js
// Validates the existing in-game clock/sleep/voice/ceremonial drink seams in a minimal browser VM.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function main() {
  const expectedYawnBreathUrl = 'assets/audio/sfx/combat/sfx_heavybreath_intensity5.m4a'; // Shared test source for configured, hardcoded, and player yawn fallback playback.
  let ms = 0; // Drives the five-second yawn without real timers.
  let hour = 12; // Drives the monotonic game-hour rest/recurrence clock.
  let frame = null; // Captured RuntimeFrameScheduler callback for explicit frame steps.
  let ceremonies = 0; // Counts Slagothim Koma events without rendering Three.js.
  let interruptions = 0; // Counts aborted ceremonial drinks after combat begins.
  let audioOptions = null; // Records actual independently modulated pitch and tempo.
  const audioCalls = []; // Records recorded yawns and intensity-5 breath requests to verify the exact 0.350x playback options.
  let audioActor = null; // Used to prove spatial voice remains attached to a moving NPC.
  let playerSpatialChecks = 0; // Fails loudly if the player yawn is incorrectly gated by the NPC distance curve.
  const expressions = new Map(); // Tracks yawn mouth ownership and verifies it is cleaned up.
  const toasts = []; // Ensures the exact authored text is emitted only on the daily ritual.
  const pendingChews = new Map(); // Models the drink-strike callback being withheld until a leaf is actually chewed.
  const storage = new Map(); // Mimics per-character localStorage persistence.
  const hostiles = new Set(); // The actual Combat.deps hostile set gates NPC yawns.
  const listeners = {}; // Captures the real sleep-completion event listener added by NpcYawnRest.
  let playerKomaOptions = null; // Records action-lock and facing ownership on the player ceremony.
  let playerRested = true; // Starts protected while isolated NPC tests run, then exercises player hourly yawns explicitly.
  const playerChestChannels = new Map(); // Verifies the shared player body compositor receives and clears its yawn contribution.
  const stretchCalls = []; // Records begin, pose update and completion from the player-only final-render presentation.
  let stretchActionBlocked = false; // Simulates another action taking ownership before the next hourly yawn.
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
    PlayerYawnStretchPresentation: {
      start: entry => { stretchCalls.push({ kind: 'start', entry }); return true; },
      update: (entry, progress) => { stretchCalls.push({ kind: 'update', entry, progress }); return true; },
      end: entry => { stretchCalls.push({ kind: 'end', entry }); },
      actionBlocked: () => stretchActionBlocked,
      debugSnapshot: () => ({ test: true }),
    },
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
      getVoiceModulation: entity => {
        const appearance = entity.rec.appearance; // Species and gender must both affect the mock combat modulation shared by yawns.
        if (appearance.speciesId === 'porakaneki') return { pitchSemitones: appearance.gender === 'female' ? 11 : 9, tempo: 1, gain: 1 };
        return appearance.gender === 'female'
          ? { pitchSemitones: 7, tempo: 0.8, gain: 1.25 }
          : { pitchSemitones: 1, tempo: 1, gain: 1 };
      },
      getConfig: () => ({ assets: { breath: { '1': 'assets/audio/sfx/combat/breath.m4a', '5': expectedYawnBreathUrl } } }),
      getVoicePriority: () => 3,
    },
    AudioSystem: {
      gameAudioConfig: () => ({ enabled: true, sfxVolume: 1 }),
      combatAudioSpatial: actor => {
        if (actor.rec?.id === '__player_daily_koma__') { playerSpatialChecks++; return { gain: 0 }; }
        audioActor = actor; return { gain: 1 };
      },
    },
    AnimalVoiceIndependentPlayback: {
      playIndependent: (url, opts) => {
        audioOptions = opts;
        const call = { url, opts, stops: 0 }; // Test observes whether the renderer is interrupted before its natural onFinished event.
        audioCalls.push(call);
        return { stop() { call.stops++; } };
      },
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
  const recordedMaleVoice = await runtime._test.voiceFor('tletingan', 'male'); // An authored male yawn is already voiced for that identity.
  assert.equal(recordedMaleVoice.pitch, 0, 'dedicated male yawn recordings are not pitched twice');
  for (let i = 0; i < 8 && !audioOptions; i++) await Promise.resolve();
  assert.ok(audioOptions, 'the first yawn must actually play a voice, not merely return a playback plan');
  assert.equal(audioOptions.pitchSemitones, 6);
  assert.equal(audioOptions.tempo, 0.8);
  assert.equal(audioOptions.preservePitchOnFallback, false, 'a borrowed yawn must not discard female transposition on native-only media');
  assert.equal(audioOptions.preferPitchShiftOnFallback, true, 'native-only borrowed yawns must prioritize their relative gender pitch');
  assert.equal(audioOptions.breathYawnDurationS, undefined, 'existing male yawn recordings must not be synthesized');
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
  ms = 16700; frame({ timestamp: ms }); // A later fatigue yawn is mid-gesture before the bed claims the rig.
  assert.ok(walker.neckJoint.rotation.x < 0, 'the NPC yawn owns a temporary neck bend');
  walker._bedLieActive = true;
  ms = 16800; frame({ timestamp: ms });
  assert.equal(walker.neckJoint.rotation.x, 0, 'a bed takeover immediately releases yawn neck offset');
  assert.equal(walker.alcoholPoseGroup.rotation.x, 0, 'a bed takeover immediately releases yawn chest offset');
  assert.equal(runtime.movementMultiplier('test-npc'), 1, 'a bed takeover interrupts the yawn slow-walk state');
  walker._bedLieActive = false;
  ms = 20500; frame({ timestamp: ms });
  hour = 37; ms = 21000; frame({ timestamp: ms });
  assert.equal(ceremonies, 2, 'first eligible yawn after 24 rolling in-game hours repeats Koma');

  const noYawnClip = await runtime._test.voiceFor('kenkari', 'female');
  assert.equal(noYawnClip.source, 'breath 5 (0.350x utterance tempo)');
  assert.equal(noYawnClip.tempo, 0.35, 'missing-yawn breath always uses the exact 0.350x utterance tempo');
  assert.equal(noYawnClip.cadence, undefined, 'fallback must not include any old grain-composer cadence');
  assert.equal(noYawnClip.pitch, 7, 'fallback applies the same species/gender semitone offset as the combat voice');
  const maleFallback = await runtime._test.voiceFor('kenkari', 'male'); // Same breath recording must sound different for each NPC gender.
  assert.equal(maleFallback.pitch, 1, 'male NPC fallback keeps the male species voice offset');
  assert.equal(maleFallback.tempo, 0.35, 'male fallback keeps the authored 0.350x utterance tempo');
  const originalModulation = window.CombatVocalizations.getVoiceModulation; // Yawns must re-read edits to the shared live voice config, not cache old semitone choices.
  window.CombatVocalizations.getVoiceModulation = entity => {
    const gender = entity.rec.appearance.gender; // Simulates a mid-save voice-config reload without changing the probed recording URLs.
    return { pitchSemitones: gender === 'female' ? 12 : 2, tempo: gender === 'female' ? 0.8 : 1, gain: 1 };
  };
  assert.equal((await runtime._test.voiceFor('kenkari', 'female')).pitch, 12, 'cached missing-recording probes must not cache stale species/gender pitch');
  assert.equal((await runtime._test.voiceFor('tletingan', 'female')).pitch, 10, 'borrowed male recordings must recompute the current female-minus-male pitch offset');
  window.CombatVocalizations.getVoiceModulation = originalModulation; // Restore the test voice table for subsequent player/NPC assertions.
  assert.equal((await runtime._test.voiceFor('kenkari', 'female')).pitch, 7, 'restoring the shared voice config immediately updates the same cached fallback');
  assert.equal(noYawnClip.gain, 1, 'fallback does not apply species voice-gain modulation');
  assert.equal(noYawnClip.fallbackBreath, true, 'fallback has explicit ownership distinct from recorded yawns');
  assert.equal(noYawnClip.url, expectedYawnBreathUrl, 'missing dedicated yawns use configured intensity-5 breathing');
  const configuredGetVoice = window.CombatVocalizations.getConfig; // Restored after verifying the built-in source without a loaded combat config.
  window.CombatVocalizations.getConfig = () => ({ assets: { breath: {} } });
  const unconfiguredYawnClip = await runtime._test.voiceFor('porakaneki', 'male'); // A fresh identity bypasses the voice-plan cache for the missing-config case.
  assert.equal(unconfiguredYawnClip.url, expectedYawnBreathUrl, 'no configured source still falls back to intensity 5');
  assert.equal(unconfiguredYawnClip.pitch, 9, 'a different male species keeps its own voice pitch even when its dedicated yawn and configured breath asset are missing');
  assert.notEqual(unconfiguredYawnClip.pitch, maleFallback.pitch, 'species identity, not gender alone, determines the fallback pitch');
  window.CombatVocalizations.getConfig = configuredGetVoice;
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
  assert.ok(stretchCalls.some(call => call.kind === 'start' && call.entry.isPlayer), 'player yawn invokes the dedicated stretch presentation');
  assert.ok(stretchCalls.some(call => call.kind === 'update' && call.progress > 0), 'player yawn supplies live animation progress to the stretch');
  ms = 46000; frame({ timestamp: ms });
  assert.equal(expressions.has('player'), false, 'player mouth expression clears after the yawn');
  assert.equal(runtime.playerMovementMultiplier(), 1, 'the player speed returns to normal after five seconds');
  assert.equal(playerChestChannels.has('player-yawn-rest'), false, 'the torso channel is cleared after yawning');
  assert.ok(stretchCalls.some(call => call.kind === 'end' && call.entry.isPlayer), 'all player yawn visuals release after completion');

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
  sleepEvent({ detail: { kind: 'sleep', hours: 8 } }); // CalendarSystem is the sole waking event owner.
  hour += 25; ms += 6500; frame({ timestamp: ms });
  assert.ok(runtime.debugSnapshot().active.some(entry => entry.npcId === '__player_daily_koma__'),
    'Sleep passage wake animates the player even when other NPCs also yawn in the same frame');
  assert.equal(toasts.length, 4, 'Sleep passage wake still lets an eligible player chew their daily Koma');
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
  }; // Deliberately observes an uninterrupted eight-hour sleep to earn full 24h NPC protection.
  window._npcWalkers.push(longSleeper);
  hour = 100; ms += 500; frame({ timestamp: ms });
  hour = 108; longSleeper._bedLieActive = false; longSleeper.currentScheduleTarget = { pose: 'stand' };
  ms += 500; frame({ timestamp: ms });
  assert.equal(runtime._test.stateFor(longSleeper, hour).restedUntil, 132, 'eight hours of NPC sleep grants 24h protection');
  assert.equal(runtime._test.stateFor(longSleeper, hour).nextHour, 132, 'full NPC Well Rested also resumes fatigue at 24h, not 25h');

  playerRested = false; // A fresh fatigue cycle lets the test cover excluded player poses.
  window.__hobunjiFurnitureDebug = { sitState: { phase: 'out' } }; // Standing up still owns the body's rig until the seat state is removed.
  hour = 180; ms += 600; frame({ timestamp: ms });
  assert.equal(runtime.playerMovementMultiplier(), 1, 'the final stand-up transition must suppress a new yawn');
  window.__hobunjiFurnitureDebug.sitState = null;
  stretchActionBlocked = true; // A busy player must not begin yawning even though the fatigue timer elapsed.
  ms += 600; frame({ timestamp: ms });
  assert.equal(runtime.playerMovementMultiplier(), 1, 'an unrelated ongoing action postpones the player yawn');
  stretchActionBlocked = false;
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
  window.Fishing.state.active = false;
  window.__hobunjiPlayerProfile.appearance.speciesId = 'mao-ao';
  playerRested = false;
  hour += 2; ms += 600; frame({ timestamp: ms }); // Start an audible un-rested fallback yawn before its five-second cleanup.
  assert.equal(runtime.playerMovementMultiplier(), .25, 'the fallback voice is checked while its yawn is still active');
  for (let index = 0; index < 32; index++) await Promise.resolve(); // Await asset probes and voice planning while the yawn still owns the voice.
  const playerBreath = audioCalls.find(call => call.url === expectedYawnBreathUrl
    && call.opts.tempo === 0.35 && call.opts.pitchSemitones === 7
    && call.opts.trimSilence === false
    && !Object.hasOwn(call.opts, 'breathYawnDurationS')
    && !Object.hasOwn(call.opts, 'breathYawnCadence')); // The shared renderer handles species/gender pitch independently of yawn tempo.
  assert.ok(playerBreath, 'missing yawn recordings use untrimmed breath 5 at 0.350x with the configured species/gender pitch');
  assert.equal(playerBreath.opts.preservePitchOnFallback, false, 'native-only fallback does not silently suppress the requested player pitch');
  assert.equal(playerBreath.opts.preferPitchShiftOnFallback, true, 'native-only fallback preserves the player voice identity rather than slowing it to the wrong pitch');
  assert.equal(playerSpatialChecks, 0, 'player yawns must never be silenced by an NPC distance calculation');
  assert.ok(runtime.debugSnapshot().lastPlayerVoice, 'mobile diagnostics retain a player-specific voice status among NPC yawns');
  assert.equal(runtime.debugSnapshot().lastPlayerVoice.tempo, 0.35, 'mobile diagnostics show the exact fallback utterance tempo');
  assert.equal(runtime.debugSnapshot().lastPlayerVoice.pitch, 7, 'mobile diagnostics report the requested player species/gender pitch');
  assert.equal(runtime.debugSnapshot().lastPlayerVoice.fallbackBreath, true, 'mobile diagnostics expose stable fallback identity for audio lifetime decisions');
  assert.equal(runtime.debugSnapshot().lastPlayerVoice.composedDurationS, undefined, 'mobile diagnostics cannot report obsolete yawn synthesis');
  assert.equal(runtime.debugSnapshot().lastPlayerVoice.status, 'queued', 'voice request is not mistaken for audible playback');
  const playerEvents = audioCalls.filter(call => call.opts.sourceActor === null && call.url === expectedYawnBreathUrl);
  playerEvents[playerEvents.length - 1]?.opts.onStarted?.();
  assert.equal(runtime.debugSnapshot().lastPlayerVoice.status, 'playing', 'the actual audio start event confirms an audible player yawn');
  assert.equal(playerBreath.opts.sourceActor, null, 'player voice originates at the listener, not a movable NPC sound source');
  assert.equal(playerBreath.opts.position3d, null, 'player yawns have no directional HRTF offset');
  assert.equal(playerBreath.opts.panX, 0, 'player yawns play centered in stereo');
  assert.ok(playerBreath.opts.volume > 0.5, 'player yawn retains full local SFX volume');
  assert.ok(audioCalls.some(call => /sfx_yawn_tletingan_male/.test(call.url)
    && call.opts.breathYawnDurationS == null && call.opts.trimSilence === true), 'real yawn recordings retain their normal playback and trimming');
  // A weapon held but not yet fired has no lunge/stagger flags; yawn must not consume the input before release.
  let weaponPress = null; // Injected public Combat.input state used by the guarded player yawn query.
  let queuedAttacks = []; // Simulates attacks waiting on vocal/pose ownership.
  let strikeDelay = 0; // Represents an attack still in its authored windup/strike/hold timeline.
  window.Combat.input = {
    getState: slot => slot === 1 ? weaponPress : null,
    queueSnapshot: () => queuedAttacks,
  };
  window.CombatVocalizations.attackStartDelayS = () => strikeDelay;
  assert.equal(runtime._test.playerCanYawn(false), true, 'ordinary idle player is eligible when neither input is held nor a pose owns them');
  weaponPress = { down: true };
  assert.equal(runtime._test.playerCanYawn(false), false, 'a pressed attack input must prevent the yawn from stealing the held attack');
  weaponPress = { alignmentPending: true };
  assert.equal(runtime._test.playerCanYawn(false), false, 'target alignment must finish before the player can yawn');
  weaponPress = null;
  queuedAttacks = [1];
  assert.equal(runtime._test.playerCanYawn(false), false, 'buffered attack inputs take priority over the fatigue animation');
  queuedAttacks = [];
  strikeDelay = 0.25;
  assert.equal(runtime._test.playerCanYawn(false), false, 'real attack animation hold/windup must finish before yawning');
  strikeDelay = 0;
  window.Combat.deps.toolHolder = () => ({ userData: { authoredToolActionActive: true } }); // Game tool-work pose flag may be exposed through a getter-backed holder.
  assert.equal(runtime._test.playerCanYawn(false), false, 'active mining/hoeing or another tool-work animation overrides fatigue');
  delete window.Combat.deps.toolHolder;
  window.RangedWeapons = { playerActionState: () => ({ kind: 'load' }) };
  assert.equal(runtime._test.playerCanYawn(false), false, 'loading or firing a ranged weapon blocks the yawn');
  window.RangedWeapons = null;
  for (const transition of ['mountingUp', 'mounted', 'mountingDown', 'climbLeap']) {
    window.Mounts = { rideState: transition };
    assert.equal(runtime._test.playerCanYawn(false), false, 'mount transition ' + transition + ' must own the body');
  }
  window.Mounts = null;
  for (const [stateName, stateValue] of [['_freeJump', { phase: 'air' }], ['climbing', true],
    ['onClimbSurface', true], ['onCliffBalcony', true], ['_cliffRouteSession', {}], ['onBranch', true],
    ['knockbackT', 0.3]]) {
    window.Combat.deps.player[stateName] = stateValue;
    assert.equal(runtime._test.playerCanYawn(false), false,
      'active traversal or impact ' + stateName + ' prevents a yawn');
    delete window.Combat.deps.player[stateName];
  }
  window.PlayerCrawl = { isActive: () => true };
  assert.equal(runtime._test.playerCanYawn(false), false, 'downed crawl retains hand pose ownership');
  window.PlayerCrawl = null;
  window.PlayerDowned = { isDowned: () => true };
  assert.equal(runtime._test.playerCanYawn(false), false, 'a downed player must not yawn');
  window.PlayerDowned = null;
  assert.equal(runtime._test.playerCanYawn(false), true, 'all temporary action conditions restore eligibility afterward');

  // Deselecting the character previously stopped the scheduler while leaving a five-second yawn, hidden visuals and an action lock stranded.
  const priorPresentationEnds = stretchCalls.filter(call => call.kind === 'end').length; // Confirms the unload path owns the final release.
  window.__hobunjiPlayerProfile.characterId = null;
  ms += 16; frame({ timestamp: ms });
  assert.equal(runtime.debugSnapshot().characterId, null, 'unloaded character resets the fatigue namespace');
  assert.equal(runtime.debugSnapshot().active.length, 0, 'all NPC and player yawn states end when leaving the character');
  assert.equal(runtime.playerMovementMultiplier(), 1, 'character unload cannot strand the player at quarter-speed');
  assert.ok(stretchCalls.filter(call => call.kind === 'end').length > priorPresentationEnds,
    'character unload releases the player stretch and action ownership');
  assert.equal(runtime.debugSnapshot().playerWakePending, false, 'unloaded saves clear stale waking triggers');

  // A slowed fallback can exceed the five-second stretch pose. It must not be cut at the pose boundary.
  window.__hobunjiPlayerProfile.characterId = 'tail-test-save'; // Fresh save starts its own fatigue timer without inheriting prior Koma data.
  ms += 600; frame({ timestamp: ms }); // Initialize the new player adapter before its first hourly yawn is due.
  hour += 2; ms += 600; frame({ timestamp: ms });
  for (let index = 0; index < 32; index++) await Promise.resolve(); // Resolve cached missing-recording probes.
  const tailCall = audioCalls.filter(call => call.url === expectedYawnBreathUrl && call.opts.sourceActor === null).at(-1); // The last player-specific breath is the newly started yawn.
  assert.ok(tailCall, 'a fresh character can still start the same fallback utterance');
  tailCall.opts.onStarted?.();
  ms += 5100; frame({ timestamp: ms });
  assert.equal(runtime.playerMovementMultiplier(), 1, 'the player returns to normal speed after the five-second pose');
  assert.equal(tailCall.stops, 0, 'the five-second pose never cuts off a still-playing 0.350x breath');
  assert.equal(runtime.debugSnapshot().lastPlayerVoice.status, 'playing', 'mobile diagnostics accurately show the lingering breath');
  assert.equal(runtime.debugSnapshot().trailingBreathCount, 1, 'the tail is tracked until its renderer signals completion');
  tailCall.opts.onFinished?.(); // Simulate the shared renderer naturally ending the full-length recording.
  assert.equal(runtime.debugSnapshot().lastPlayerVoice.status, 'finished', 'natural end retains the renderer completion status');
  assert.equal(runtime.debugSnapshot().trailingBreathCount, 0, 'natural completion releases the tail without a frame callback');

  hour += 2; ms += 600; frame({ timestamp: ms }); // Start another fallback to verify unloading interrupts even a completed pose's audio.
  for (let index = 0; index < 32; index++) await Promise.resolve();
  const unloadTailCall = audioCalls.filter(call => call.url === expectedYawnBreathUrl && call.opts.sourceActor === null).at(-1);
  assert.ok(unloadTailCall && unloadTailCall !== tailCall, 'the second yawn uses a distinct voice handle');
  unloadTailCall.opts.onStarted?.();
  ms += 5100; frame({ timestamp: ms });
  assert.equal(runtime.debugSnapshot().trailingBreathCount, 1, 'second fallback is audible after its animation');
  window.__hobunjiPlayerProfile.characterId = null;
  ms += 16; frame({ timestamp: ms });
  assert.equal(unloadTailCall.stops, 1, 'leaving the save stops a fallback still playing after its pose');
  assert.equal(runtime.debugSnapshot().trailingBreathCount, 0, 'save unload clears all outstanding audio tails');

  console.log('Player/NPC fatigue, species/gender-pitched 0.350x Breath 5 fallback, natural voice tails, and rested buffs: OK');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
