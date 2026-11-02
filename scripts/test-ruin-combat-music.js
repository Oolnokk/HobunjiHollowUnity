#!/usr/bin/env node
'use strict';
// Runs the live combat-music scheduler with the real ConditionRegistry and the real authored config:
// generated ruins (Harlyao ruins and the Hachutu Root Temple share one map id) fight to "Just Beyond the Torchlight",
// everywhere else keeps the ordinary combat track. Also pins the sanctum door's +5 semitone shift of that same track.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const music = read('docs/js/music-system.js');
const TORCHLIGHT = 'assets/audio/music/bgm/bgm_just_beyond_the_torchlight.ogg';
const NORMAL = 'assets/audio/music/bgm/bgm_pure_focus.m4a';
const RUIN = 'map_i_dev_random_ruin';

const registryWindow = {};
vm.runInNewContext(read('docs/js/condition-registry.js'), { window: registryWindow, console });
const Registry = registryWindow.ConditionRegistry;
assert(Registry?.entryEligible, 'ConditionRegistry loads');

// The authored config itself (array literal extracted so the real flags/conditions are what's tested).
const configText = read('docs/config/scratchbones-config.js');
const arrayStart = configText.indexOf('"combatBgm": [') + '"combatBgm": '.length;
let depth = 0, arrayEnd = arrayStart;
for (let i = arrayStart; i < configText.length; i++) { if (configText[i] === '[') depth++; if (configText[i] === ']' && --depth === 0) { arrayEnd = i + 1; break; } }
const combatBgm = JSON.parse(configText.slice(arrayStart, arrayEnd));
assert(fs.existsSync(path.join(__dirname, '..', 'docs', TORCHLIGHT)), 'the torchlight recording exists at its configured path');

function play(area) {
  const state = { area, currentBgm: { ended: false }, mode: 'bgm', nextAt: 0, blockUntil: 0, combatOverrideActive: false };
  const plays = [];
  const context = {
    window: { AudioSystem: { gameAudioConfig: () => ({ combatBgm }) } },
    deps: { getCurrentArea: () => area, isPlayerInCombat: () => true },
    quietLoading: false, _startupBgm: null, _ambientCueState: state,
    _cuePlaybackStats: { requested: 0, started: 0, completed: 0, failed: 0, lastError: '', lastPhaseExit: '' },
    _audioCueIndexes: new Map(),
    performance: { now: () => 1000 },
    areaBgmIncludesTrack: () => true, areaCueIncludesTrack: () => true, ambientMusicOwnsSoundtrack: () => false,
    audioDebug() {}, audioTrace() {}, audioTraceEnabled: () => false,
    isAudioEntryEligible: entry => Registry.entryEligible(entry, { maps: area }), // Production rule, real registry.
    audioUrlFailed: () => false, festivalSilencesAmbient: () => false, ruinVaultSilencesAmbient: () => false,
    musicFadeConfig: () => ({ songFadeInMs: 0, songFadeOutMs: 0 }),
    pauseAmbientForCombat() {}, restoreAmbientSchedulerAfterCombat() {}, resumeAmbientAfterCombat() {},
    stopMusicSlot(key) { state[key] = null; }, retireMusicTrack() {},
    playMusicTrack(url) { plays.push(url); return { src: url, currentTime: 0, addEventListener() {} }; },
    requestGameAudioPlay() { return Promise.resolve(); },
  };
  vm.runInNewContext(music.slice(music.indexOf('  function isCombatMusicRequested()'), music.indexOf('  function setLoopingBgs(')), context);
  context.updateAmbientCues();
  return plays;
}

for (let i = 0; i < 20; i++) assert.deepEqual(play(RUIN), [TORCHLIGHT], 'generated ruins (Harlyao and Hachutu) fight to Just Beyond the Torchlight');
for (const area of ['farm', 'town', 'map_northern_cliffs', 'arena']) {
  for (let i = 0; i < 5; i++) assert.deepEqual(play(area), [NORMAL], 'combat in ' + area + ' keeps the ordinary track');
}

// Sanctum door: same recording, shifted up five semitones through the furniture-source pitch option.
const sanctum = read('docs/js/dev-random-ruin-sanctum.js');
assert.match(sanctum, /const DOOR_SEMITONES = 5;/, 'the sanctum door shifts its track up five semitones');
const factory = music.slice(music.indexOf('  function registerFurnitureSfxSource('), music.indexOf('  function unregisterFurnitureSfxSource('));
const sources = [];
const audio = {};
const registered = vm.runInNewContext(factory + '\nregisterFurnitureSfxSource', {
  makeGameAudio: () => audio, _furnitureSfxSources: sources, audioDebug() {}, Number, Math,
});
const source = registered(RUIN, 3.5, 4.5, { url: TORCHLIGHT, rangeTiles: 16, volume: .8, semitones: 5 });
assert.equal(source.semitones, 5);
assert.equal(audio.preservesPitch, false, 'pitch must follow playback rate, not be corrected back');
assert.ok(Math.abs(audio.playbackRate - Math.pow(2, 5 / 12)) < 1e-12, 'playbackRate is 2^(5/12) for +5 semitones');
const plain = {};
const unshifted = vm.runInNewContext(factory + '\nregisterFurnitureSfxSource', { makeGameAudio: () => plain, _furnitureSfxSources: [], audioDebug() {}, Number, Math });
unshifted(RUIN, 0, 0, { url: TORCHLIGHT });
assert.equal(plain.playbackRate, undefined, 'sources without semitones are untouched');
console.log('PASS ruin combat music: torchlight in generated ruins, ordinary track elsewhere, door shifted +5 semitones');
