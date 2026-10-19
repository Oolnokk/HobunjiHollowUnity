#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm'); // Executes the live scheduler against controlled combat/tutorial state.

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const music = source('docs/js/music-system.js');
const title = source('docs/js/title-screen-runtime.js');
const formatUtils = source('docs/js/format-utils.js');
const game = source('docs/game.js');
const fishing = source('docs/js/fishing-minigame.js'); // Verifies the successful-catch path fires the semantic gameplay music cue.
const loadingScreen = source('docs/js/loading-screen-runtime.js'); // Verifies mine destination context is visible on the shared loading overlay.
const config = source('docs/config/scratchbones-config.js');
const index = source('docs/index.html');
const nightbugsPath = path.join(__dirname, '../docs/assets/audio/sfx/bgs/bgs_nightbugs1.mp3'); // Points the asset-presence check at the normalized runtime recording.
const skirmishPath = path.join(__dirname, '../docs/assets/audio/music/bgm/bgm_skirmish.m4a'); // Confirms the authored combat loop exists at the configured runtime path.
const skirmishBinary = fs.readFileSync(skirmishPath).toString('latin1'); // Reads container metadata so the authored trim values cannot drift away from the actual M4A.
const skirmishSmpb = skirmishBinary.match(/iTunSMPB[\s\S]{0,96}?([0-9A-Fa-f]{8}) ([0-9A-Fa-f]{8}) ([0-9A-Fa-f]{8}) ([0-9A-Fa-f]{16})/); // Captures flags, encoder delay, end padding and real content-sample count.
const skirmishMp4aIndex = skirmishBinary.indexOf('mp4a'); // MP4 audio sample-entry marker used to verify the source sample rate authored in gaplessLoop metadata.
const skirmishSourceSampleRate = skirmishMp4aIndex >= 0 ? fs.readFileSync(skirmishPath).readUInt32BE(skirmishMp4aIndex + 28) / 65536 : 0; // mp4a sample-rate field is 16.16 fixed-point, 28 bytes after the box type.
const gaplessBoundsSource = music.slice(music.indexOf('  function gaplessLoopSampleBounds'), music.indexOf('\n  function preloadConfiguredGaplessLoops')); // Extracts the pure helper so CI executes its real branch code rather than only regex-checking its shape.
const gaplessLoopSampleBounds = Function(gaplessBoundsSource + '\nreturn gaplessLoopSampleBounds;')();
const remembrancePath = path.join(__dirname, '../docs/assets/audio/music/bgm/bgm_remembrance.m4a'); // Confirms the opening/title/onboarding soundtrack exists.
const quietHopePath = path.join(__dirname, '../docs/assets/audio/music/bgm/bgm_quiet_hope.m4a'); // Confirms the farm/town morning candidate exists.
const gentleTwilightPath = path.join(__dirname, '../docs/assets/audio/music/bgm/bgm_gentle_twilight.m4a'); // Confirms the farm/town 02:00-nightfall candidate exists.
const snowAndDarknessPath = path.join(__dirname, '../docs/assets/audio/music/bgm/bgm_snow_and_darkness.m4a'); // Confirms the Western Slope night song exists at the configured runtime path.
const pureFocusPath = path.join(__dirname, '../docs/assets/audio/music/bgm/bgm_pure_focus.m4a'); // Confirms the alternate combat recording exists at the configured runtime path.
const pureFocusBinary = fs.readFileSync(pureFocusPath).toString('latin1'); // Reads Pure Focus container metadata so its authored sample-accurate loop trim cannot drift from the real M4A.
const pureFocusSmpb = pureFocusBinary.match(/iTunSMPB[\s\S]{0,96}?([0-9A-Fa-f]{8}) ([0-9A-Fa-f]{8}) ([0-9A-Fa-f]{8}) ([0-9A-Fa-f]{16})/); // Captures flags, encoder delay, end padding and content-sample count.
const pureFocusMp4aIndex = pureFocusBinary.indexOf('mp4a'); // MP4 audio sample-entry marker used to verify the configured source sample rate.
const pureFocusSourceSampleRate = pureFocusMp4aIndex >= 0 ? fs.readFileSync(pureFocusPath).readUInt32BE(pureFocusMp4aIndex + 28) / 65536 : 0; // mp4a sample-rate field is 16.16 fixed-point.
const undergrowthPath = path.join(__dirname, '../docs/assets/audio/music/bgm/bgm_The_Undergrowth.ogg'); // Confirms the Cloud Forest night recording exists with its case-sensitive filename.
const fishCaughtCuePath = path.join(__dirname, '../docs/assets/audio/music/cues/gameplaycues/gpq_fish_caught.m4a'); // Confirms the catch-success sting is present.
const progressDeeperCuePath = path.join(__dirname, '../docs/assets/audio/music/cues/gameplaycues/gpq_progress_deeper.m4a'); // Confirms the mine-descent sting is present.

// Run the scheduler and its ended callback: tutorials must keep one combat
// transport through dialogue, idle practice, and rewards, then hand music back.
{
  const live = { combat: false, tutorial: false, exclusive: false, plays: 0, pauses: 0, resumes: 0 }; // Mutable inputs and transport observations for scheduler transitions.
  const ambient = { ended: false }; // Existing exploration track retained beneath training music.
  const state = { area: 'arena', currentBgm: ambient, mode: 'bgm', nextAt: 0, blockUntil: 0, combatOverrideActive: false }; // Scheduler slots shared with the executed production function.
  const context = { // Narrow audio boundary: scheduler decisions and callbacks remain production code.
    window: { AudioSystem: { gameAudioConfig: () => ({ combatBgm: [{ url: 'combat.m4a' }] }) }, CombatTutorial: { active: () => live.tutorial } },
    deps: { getCurrentArea: () => 'arena', isPlayerInCombat: () => live.combat },
    quietLoading: false, _startupBgm: null, _ambientCueState: state, _audioCueIndexes: new Map(),
    performance: { now: () => 1000 },
    areaBgmIncludesTrack: () => true, areaCueIncludesTrack: () => true,
    ambientMusicOwnsSoundtrack: () => live.exclusive,
    audioDebug() {}, audioTrace() {}, audioTraceEnabled: () => false,
    isAudioEntryEligible: () => true, audioUrlFailed: () => false,
    musicFadeConfig: () => ({ songFadeInMs: 0, songFadeOutMs: 0 }),
    pauseAmbientForCombat() { live.pauses++; },
    restoreAmbientSchedulerAfterCombat() {},
    resumeAmbientAfterCombat() { live.resumes++; },
    stopMusicSlot(key) { state[key] = null; },
    retireMusicTrack(sound) { sound.retired = true; },
    playMusicTrack(url) { return { src: url, currentTime: 12, listeners: {}, addEventListener(event, callback) { this.listeners[event] = callback; } }; },
    requestGameAudioPlay() { live.plays++; return Promise.resolve(); },
  };
  const schedulerSource = music.slice(music.indexOf('  function isCombatMusicRequested()'), music.indexOf('  function setLoopingBgs(')); // Includes both the live demand helper and the scheduler's real callback closure.
  vm.runInNewContext(schedulerSource, context);
  context.updateAmbientCues();
  assert.equal(state.combatOverrideActive, false, 'ordinary exploration keeps ambient music');
  live.tutorial = true;
  context.updateAmbientCues();
  const trainingTrack = state.currentCombatBgm; // Transport identity must survive changes in gameplay combat state.
  assert.ok(trainingTrack, 'an active tutorial starts combat music without gameplay combat');
  assert.equal(live.pauses, 1, 'training pauses ambient music once');
  for (const combat of [true, false, true, false]) {
    live.combat = combat;
    context.updateAmbientCues();
    assert.equal(state.currentCombatBgm, trainingTrack, 'combat changes during a lesson keep the same track');
  }
  trainingTrack.listeners.ended();
  assert.equal(live.plays, 2, 'native ended fallback immediately repeats during noncombat tutorial phases');
  assert.equal(trainingTrack.currentTime, 0, 'tutorial repeat restarts the same transport');
  assert.equal(trainingTrack.retired, undefined, 'tutorial repeat retains track ownership');
  live.tutorial = false;
  live.combat = true;
  context.updateAmbientCues();
  assert.equal(state.currentCombatBgm, trainingTrack, 'ending a lesson during real combat keeps combat music');
  live.combat = false;
  context.updateAmbientCues();
  assert.equal(state.currentCombatBgm, null, 'ending training outside combat releases its music');
  assert.equal(live.resumes, 1, 'normal ambient music resumes after training');
  trainingTrack.listeners.ended();
  assert.equal(live.plays, 2, 'a stale ended callback cannot restart music after the tutorial ends');
  live.tutorial = true;
  live.exclusive = true;
  context.updateAmbientCues();
  assert.equal(state.combatOverrideActive, false, 'existing exclusive soundtracks retain their priority');
  delete context.window.CombatTutorial;
  context.updateAmbientCues();
  assert.equal(state.combatOverrideActive, false, 'music works before the tutorial module loads');
}


// Long BGM cannot starve a regional cue; its playhead survives the overlay.
{
  const live = { now: 1000, plays: 0, ducks: [] }; // Controllable wall clock and audio decisions for the production scheduler.
  const song = { ended: false, currentTime: 77, _musicEntry: { url: 'bgm.ogg' }, _setDuck(value) { live.ducks.push(value); } }; // Existing song must remain in its scheduler slot.
  const state = { area: 'town', indexId: 'general', mode: 'bgm', currentBgm: song, currentCue: null, currentCombatBgm: null, combatOverrideActive: false, blockUntil: 0, nextAt: 0, cueOverlayNextAt: 0, cueOverlayDucking: false }; // Same scheduler fields as the runtime.
  const context = {
    window: { AudioSystem: { gameAudioConfig: () => ({ enabled: true, bgmVolume: 0.48, ambientCuesOverBgm: true, ambientCueOverlayMinDelaySec: 1, ambientCueOverlayMaxDelaySec: 1 }) } },
    deps: { getCurrentArea: () => 'town', isPlayerInCombat: () => false },
    performance: { now: () => live.now },
    quietLoading: false, _startupBgm: null, _ambientCueState: state,
    _audioCueIndexes: new Map([['general', { __basePath: 'cues/general/', ambient_cues: [{ id: 'to1', file: 'to1.ogg', volume: 0.7 }] }]]),
    _lyreDucked: false, _gameplayCueDuckOwners: new Set(),
    audioDebug() {}, audioTrace() {}, audioTraceEnabled: () => false,
    areaBgmIncludesTrack: () => true, areaCueIncludesTrack: () => true,
    isAudioEntryEligible: () => true, audioUrlFailed: () => false,
    musicFadeConfig: () => ({ cueFadeMs: 280, songFadeInMs: 2200, songFadeOutMs: 2600 }),
    ambientMusicOwnsSoundtrack: () => false,
    retireMusicTrack(audio) { audio.retired = true; },
    playMusicTrack(url) {
      return { src: url, listeners: {}, addEventListener(event, cb) { this.listeners[event] = cb; }, _watchForStall() {} };
    },
    requestGameAudioPlay(audio) { live.plays++; audio.listeners.play?.(); return Promise.resolve(); },
  };
  const cueSchedulerSource = music.slice(music.indexOf('  function scheduleNextOverlayCueDelay()'), music.indexOf('  function setLoopingBgs(')); // Tests actual cue timing and selection functions.
  vm.runInNewContext(cueSchedulerSource, context);
  context.updateAmbientCues();
  assert.equal(state.cueOverlayNextAt, 2000, 'regional cue scheduled while a full BGM track is still active');
  assert.equal(live.plays, 0, 'cue is not launched before its interval');
  live.now = 2100;
  context.updateAmbientCues();
  assert.equal(live.plays, 1, 'cue begins without waiting for the full song to end');
  assert.equal(state.currentCue.src, 'cues/general/to1.ogg', 'correct regional asset selected');
  assert.equal(state.currentBgm, song, 'the active background song is preserved');
  assert.equal(song.currentTime, 77, 'the active song does not rewind');
  assert.equal(state.cueOverlayDucking, false, 'starting a media element does not duck music while the cue is buffering');
  assert.deepEqual(live.ducks, [], 'no silent interval before the cue becomes audible');
  state.currentCue.listeners.playing();
  assert.equal(state.cueOverlayDucking, true, 'cue ducks BGM on actual playback readiness');
  assert.deepEqual(live.ducks, [true], 'background duck begins with audible playback');
  state.currentCue.listeners.waiting();
  assert.equal(state.cueOverlayDucking, false, 'buffering releases the overlay duck');
  assert.deepEqual(live.ducks, [true, false], 'BGM returns while regional cue is buffering');
  state.currentCue.listeners.playing();
  assert.equal(state.cueOverlayDucking, true, 'buffering recovery re-engages the cue duck');
  state.currentCue.listeners.ended();
  assert.equal(state.currentCue, null, 'cue slot is released on completion');
  assert.equal(state.currentBgm, song, 'full song survives cue completion');
  assert.equal(state.cueOverlayDucking, false, 'cue duck releases at completion');
  assert.deepEqual(live.ducks, [true, false], 'background volume is restored');
  live.now = 3000;
  context.updateAmbientCues();
  assert.equal(live.plays, 1, 'another cue cannot immediately replay');
  song._musicEntry.exclusiveSoundtrack = true;
  live.now = 5000;
  context.updateAmbientCues();
  assert.equal(live.plays, 1, 'exclusive authored scores never get overlaid by regional cues');
}

assert.match(music, /const log = deps\?\.debugLog \|\| window\.__farmLog/, 'pre-init audio unlock logging cannot dereference null Music deps');
assert.equal((music.match(/snd\.play\(\)/g) || []).length, 1,
  'all managed audio playback must pass through the single pending-play gate');
assert.match(music, /if \(errName === 'NotAllowedError'\) return; \/\/ Remains the sole owner/,
  'an autoplay-blocked cue remains scheduler-owned until gesture retry');
assert.match(music, /if \(errName === 'NotAllowedError'\) return; \/\/ Keep ownership/,
  'an autoplay-blocked BGM remains scheduler-owned until gesture retry');
assert.match(music, /const ownsSlot = _ambientCueState\.currentCue === snd;[\s\S]*?if \(ownsSlot\)/,
  'stale cue callbacks cannot advance the current scheduler state');
assert.match(music, /const ownsSlot = _ambientCueState\.currentBgm === snd;[\s\S]*?if \(ownsSlot\)/,
  'stale BGM callbacks cannot advance the current scheduler state');
assert.match(music, /const keepCue =[\s\S]*?areaCueIncludesTrack\(currentArea, _ambientCueState\.currentCue\)/,
  'shared-map cues continue instead of being interrupted at every doorway');
assert.match(music, /cue conditions expired[\s\S]*?bgm conditions expired/,
  'active authored conditions are rechecked while music is playing');
assert.match(music, /isAudioEntryEligible\(cue, currentArea\)/,
  'ineligible weather/map/time cues are excluded before selection');
assert.match(music, /if \(track\.rainingOnly && !deps\.calendar\.isRaining\) return false;/,
  'rain-only BGM uses the live rain window rather than the daily forecast');
assert.match(music, /function isAuthoredHourWindowEligible\(track\)[\s\S]*?start < end \? \(hour >= start && hour < end\) : \(hour >= start \|\| hour < end\)/,
  'authored BGM hour windows support both ordinary and midnight-wrapping ranges');
assert.match(title, /const STARTUP_BGM_URL = 'assets\/audio\/music\/bgm\/bgm_remembrance\.m4a'/,
  'the earliest title runtime points at the authored Remembrance startup track');
assert.match(title, /document\.documentElement\.classList\.add\([^;]*'hobunji-title-active'\);[\s\S]*?tryStartStartupBgm\(\);[\s\S]*?loadTitleSky\(\)/,
  'Remembrance is attempted immediately after the title/pre-world lifecycle classes are installed');
assert.match(title, /function beginStart\([\s\S]*?tryStartStartupBgm\('title input: ' \+ source\);[\s\S]*?hobunji-title-starting/,
  'the accepted title input retries autoplay synchronously before the swallowed input is released');
assert.match(title, /claimStartupBgmAudio,[\s\S]*?cancelStartupBgmAudio/,
  'the title runtime exposes one-way startup-audio handoff/cancellation APIs');
assert.match(music, /function startStartupBgm\(\)[\s\S]*?audioCfg\.startupBgm[\s\S]*?claimStartupBgmAudio\?\.\(track\.url\)[\s\S]*?existingAudio: earlyTitleAudio[\s\S]*?requestGameAudioPlay\(snd\)/,
  'Music adopts the title runtime\'s existing Remembrance element/playhead and keeps the shared playback gate');
assert.match(music, /function playMusicTrack\([\s\S]*?existingAudio = null[\s\S]*?gaplessLoopSpec = null[\s\S]*?const snd = existingAudio \|\| gaplessSnd \|\| makeGameAudio/,
  'the shared music player can adopt an already-playing title soundtrack while allowing explicitly-authored gapless loops to use the decoded transport');
assert.doesNotMatch(music, /__hobunjiGameStarted === true \|\| window\.__hobunjiPlayerProfile/,
  'loading/selecting a profile no longer falsely ends the title/save/onboarding soundtrack');
assert.match(music, /window\.addEventListener\('hobunji-title-starting',[\s\S]*?unlockGameAudio\('title start'\)/,
  'the full music system still retries a claimed autoplay-blocked Remembrance element on title input');
assert.match(music, /document\.addEventListener\('hobunjiPlayerReady', finishStartupWhenGameActuallyStarts\)/,
  'player-ready begins the final loading handoff without stopping Remembrance');
assert.match(music, /function finishStartupWhenGameActuallyStarts\(\)[\s\S]*?window\.__hobunjiGameStarted === true[\s\S]*?stopStartupBgm\('game started'\)[\s\S]*?setInterval\([\s\S]*?50\)/,
  'startup music waits through loading until game.js marks the selected world fully hydrated');
assert.match(music, /if \(_startupBgm && window\.__hobunjiGameStarted === true\) stopStartupBgm\('game started'\)/,
  'the first gameplay audio tick provides a redundant no-gap stop fallback once the world is actually playable');
assert.doesNotMatch(music, /stopStartupBgm\('player ready'\)/,
  'opening/loading a selected world cannot fade Remembrance merely because player-ready fired');
assert.match(music, /existingAudio: earlyTitleAudio \}\); \/\/ Persists continuously across title, every pre-game menu\/loading surface, and world hydration/,
  'Music keeps ownership of the title element/playhead throughout the complete pre-game sequence');
assert.match(music, /Math\.max\(0, Number\(snd\._musicTarget\) \|\| 0\) > 1\.0001/,
  'gesture unlock promotes only tracks that actually need gain above the HTML volume ceiling');
assert.doesNotMatch(music, /plainVolumeOnly|_forcePlainMusicVolume/,
  'startup Remembrance is not exempt from manual >100% gain once Web Audio is safely running');
assert.doesNotMatch(music, /if \(!_musicGainNodes\.has\(snd\)\) attachMusicGain\(snd\)/,
  'ordinary music is never unconditionally rerouted through the historically fragile GainNode path');
assert.match(music, /if \(_startupBgm && !_startupBgm\._musicRetired\)[\s\S]*?return;/,
  'ordinary area/combat music cannot interrupt the startup soundtrack');
assert.match(music, /stopMusicSlot\('currentBgm', 'bgm conditions expired', musicFadeConfig\(\)\.songFadeOutMs\)/,
  'BGM whose live conditions expire uses the slow authored song fade');
assert.match(music, /snd\._pauseMusic = [\s\S]*?snd\.pause\(\)/,
  'scheduler pause support fades and pauses the current music track instead of retiring it');
assert.match(music, /snd\._resumeMusic = [\s\S]*?requestGameAudioPlay\(snd\)/,
  'scheduler resume support restarts the preserved track from its existing playhead');
assert.match(music, /const resumeFadeMs = key === 'currentCue' \? fade\.cueFadeMs : fade\.songFadeInMs;/,
  'resumed cues use the short cue fade while resumed BGM keeps the song fade');
assert.match(music, /combatSchedulerPausedAt = performance\.now\(\)[\s\S]*?_ambientCueState\.nextAt > pausedAt[\s\S]*?_ambientCueState\.nextAt \+= pausedMs/,
  'combat freezes the pending normal cue/BGM scheduler delay instead of letting it elapse underneath Skirmish');
assert.match(music, /activeKind = _ambientCueState\.currentCombatBgm \? 'combat-bgm'/,
  'mobile audio diagnostics identify the combat soundtrack as the active music owner');
assert.match(music, /' combatOverride=' \+ _ambientCueState\.combatOverrideActive[\s\S]*?' ambientPaused=' \+ !!ambientSnd\?\.paused/,
  'mobile audio diagnostics expose combat override and preserved ambient pause state');
assert.match(music, /combatOverrideActive = combatMusicRequested && !combatOverrideSuppressed/,
  'combat music demand drives the override while existing exclusive soundtrack owners can suppress it');
assert.match(music, /exclusiveSoundtrack === true/,
  'combat suppression reuses the existing exclusiveSoundtrack metadata instead of inventing a second exemption flag');
assert.doesNotMatch(music, /combatBgmExempt/,
  'music scheduler does not carry a duplicate combat-specific soundtrack exemption concept');
assert.match(music, /const repeatWhileCombat = track\.loop !== false;[\s\S]*?const gaplessLoopSpec = repeatWhileCombat \? track\.gaplessLoop : null;[\s\S]*?playMusicTrack\(track\.url, baseVol \* trackVolMul,[\s\S]*?\{ loop: repeatWhileCombat, gaplessLoopSpec \}\)/,
  'combat BGM routes explicitly-authored gapless loops through the shared music transport');
assert.match(music, /combatTracks\[Math\.floor\(Math\.random\(\) \* combatTracks\.length\)\]/,
  'combat starts choose uniformly from the configured eligible combat tracks');
assert.match(music, /function playGameplayCue\(key\)[\s\S]*?audioCfg\.gameplayCues\?\.\[key\][\s\S]*?playMusicTrack\(cue\.url, baseVolume, 0, 0\)[\s\S]*?requestGameAudioPlay\(snd\)/,
  'explicit gameplay stings reuse the managed music transport without taking an ambient scheduler slot');
assert.match(music, /function makeGaplessLoopAudio\([\s\S]*?ctx\.createBufferSource\(\)[\s\S]*?source\.loop = true;[\s\S]*?source\.loopStart = state\.loopStartSec;[\s\S]*?source\.loopEnd = state\.loopEndSec;/,
  'gapless combat playback uses AudioBufferSourceNode loop boundaries rather than waiting for a media-element ended event');
assert.match(music, /function gaplessLoopSampleBounds\([\s\S]*?sourceSampleRate[\s\S]*?resampleRatio[\s\S]*?decoder-trimmed-both[\s\S]*?encoded-padding-present[\s\S]*?untrimmed-metadata-mismatch/,
  'gapless loop trimming adapts to decoder padding behavior and AudioContext resampling');
const gaplessSpec = { sourceSampleRate: 48000, encoderDelaySamples: 2048, paddingSamples: 745, contentSamples: 1256727 };
for (const decodedRate of [44100, 48000, 96000]) {
  const ratio = decodedRate / gaplessSpec.sourceSampleRate;
  const delay = Math.round(gaplessSpec.encoderDelaySamples * ratio);
  const padding = Math.round(gaplessSpec.paddingSamples * ratio);
  const contentSamples = Math.round(gaplessSpec.contentSamples * ratio);
  const fullyPadded = gaplessLoopSampleBounds({ length: delay + contentSamples + padding, sampleRate: decodedRate }, gaplessSpec);
  assert.equal(fullyPadded.mode, 'encoded-padding-present',
    'fully padded Skirmish decode is recognized at ' + decodedRate + ' Hz');
  assert.equal(fullyPadded.startSample, delay,
    'Skirmish encoder delay is trimmed in decoded-sample space at ' + decodedRate + ' Hz');
  assert.equal(fullyPadded.endSample, delay + contentSamples,
    'Skirmish end padding is trimmed in decoded-sample space at ' + decodedRate + ' Hz');
  const decoderTrimmed = gaplessLoopSampleBounds({ length: contentSamples, sampleRate: decodedRate }, gaplessSpec);
  assert.equal(decoderTrimmed.mode, 'decoder-trimmed-both',
    'already-trimmed Skirmish decode remains untrimmed at ' + decodedRate + ' Hz');
}
assert.match(music, /transport=' \+ \(activeSnd\?\._gaplessLoopAudio \? \(activeSnd\._gaplessNativeFallback \? 'html-fallback' : 'buffer-loop'\) : 'html'\)/,
  'mobile audio diagnostics expose the active music transport');
assert.match(music, /const mediaElement = snd\?\._gaplessNativeFallback \? snd\._gaplessNativeAudio : snd;[\s\S]*?createMediaElementSource\(mediaElement\)/,
  'native fallback playback can still use the existing GainNode path for user track boosts above 100%');
assert.match(music, /finishCombatBgm = \(\{ repeatIfStillInCombat = true \} = \{\}\) => \{[\s\S]*?isCombatMusicRequested\(\)[\s\S]*?snd\.currentTime = 0;[\s\S]*?requestGameAudioPlay\(snd\)[\s\S]*?return;[\s\S]*?retireMusicTrack\(snd\)/,
  'if a looping combat M4A still emits ended, the same element restarts immediately while combat remains active instead of entering the scheduler/fade-in path');
assert.match(music, /snd\.addEventListener\('ended', finishCombatBgm\);/,
  'combat ended fallback remains reusable across repeated same-element restarts');
assert.match(music, /Math\.exp\(-4\.6 \* elapsedMs \/ fadeMs\)/,
  'looping background layers converge smoothly when weather or area changes');
assert.match(music, /if \(intensity <= 0\) return \{ gentle: 0, mid: 0, heavy: 0 \};/,
  'dry weather assigns zero weight to every rain layer');
assert.match(music, /exterior && night && !rainy/,
  'nightbugs play only during eligible clear exterior nights');
assert.match(music, /currentArea === 'town' \|\| deps\._isZoneArea\(currentArea\)/,
  'layered rain audio includes exterior wilderness maps');

assert.match(game, /getTimeOfDay: \(\) => window\.Fishing\?\.timeOfDay\?\.\(\),[\s\S]*?currentWeekdayName:[\s\S]*?currentSeason:/,
  'music condition evaluation receives the shared calendar condition values');
assert.match(config, /"bgsFadeMs": 1600/,
  'background-loop fading remains authored in audio config');
assert.match(config, /"combatBgm": \[\s*\{ "url": "assets\/audio\/music\/bgm\/bgm_pure_focus\.m4a", "loop": true, "gaplessLoop": \{ "sourceSampleRate": 44100, "encoderDelaySamples": 2048, "paddingSamples": 631, "contentSamples": 5667209 \} \}\s*\]/,
  'Pure Focus is the sole combat track and carries its AAC priming/padding metadata for sample-accurate looping');
assert.doesNotMatch(config, /"combatBgm": \[[\s\S]*?bgm_skirmish\.m4a[\s\S]*?\n        \],/,
  'Skirmish is not eligible for combat playback');

assert.match(config, /"gameplayCues": \{[\s\S]*?"fishCaught": \{ "url": "assets\/audio\/music\/cues\/gameplaycues\/gpq_fish_caught\.m4a", "volume": 1, "duckBackground": true, "duckOutMs": 90, "duckInMs": 260 \}[\s\S]*?"progressDeeper": \{ "url": "assets\/audio\/music\/cues\/gameplaycues\/gpq_progress_deeper\.m4a", "volume": 1 \}/,
  'semantic catch and mine-progress cues resolve to the authored gameplay-cue files, with the catch sting temporarily ducking background music');
assert.ok(skirmishSmpb, 'Skirmish M4A must retain iTunSMPB gapless metadata');
assert.equal(skirmishSourceSampleRate, 48000,
  'configured Skirmish source sample rate matches the M4A mp4a sample entry');
assert.equal(parseInt(skirmishSmpb[2], 16), 2048,
  'configured Skirmish encoder delay matches the M4A iTunSMPB metadata');
assert.equal(parseInt(skirmishSmpb[3], 16), 745,
  'configured Skirmish end padding matches the M4A iTunSMPB metadata');
assert.equal(parseInt(skirmishSmpb[4], 16), 1256727,
  'configured Skirmish content length matches the M4A iTunSMPB metadata');
assert.ok(pureFocusSmpb, 'Pure Focus M4A must retain iTunSMPB gapless metadata');
assert.equal(pureFocusSourceSampleRate, 44100,
  'configured Pure Focus source sample rate matches the M4A mp4a sample entry');
assert.equal(parseInt(pureFocusSmpb[2], 16), 2048,
  'configured Pure Focus encoder delay matches the M4A iTunSMPB metadata');
assert.equal(parseInt(pureFocusSmpb[3], 16), 631,
  'configured Pure Focus end padding matches the M4A iTunSMPB metadata');
assert.equal(parseInt(pureFocusSmpb[4], 16), 5667209,
  'configured Pure Focus content length matches the M4A iTunSMPB metadata');
assert.match(config, /"startupBgm": \{ "url": "assets\/audio\/music\/bgm\/bgm_remembrance\.m4a", "loop": true \}/,
  'Remembrance loops throughout the opening/title/save/onboarding sequence');
assert.equal((config.match(/"url": "assets\/audio\/music\/bgm\/bgm_quiet_hope\.m4a", "startHour": 6, "endHour": 12/g) || []).length, 2,
  'Quiet Hope is authored only in the farm and town morning pools');
assert.equal((config.match(/"url": "assets\/audio\/music\/bgm\/bgm_gentle_twilight\.m4a", "startHour": 2, "endHour": 19/g) || []).length, 2,
  'Gentle Twilight is authored only in farm and town from 02:00 until nightfall');
assert.match(config, /"map_western_slope": \[[\s\S]*?"url": "assets\/audio\/music\/bgm\/bgm_snow_and_darkness\.m4a", "nightOnly": true, "exclusiveSoundtrack": true/,
  'Snow and Darkness is a Western Slope night track that retains soundtrack ownership during combat');
assert.match(config, /"map_southern_cloud_forest": \[[\s\S]*?"url": "assets\/audio\/music\/bgm\/bgm_The_Undergrowth\.ogg", "nightOnly": true, "exclusiveSoundtrack": true/,
  'The Undergrowth mirrors the Western Slope night-only exclusive-soundtrack pattern in the Cloud Forest');
assert.match(fishing, /playGameplayCue\?\.\('fishCaught'\)/,
  'a committed successful catch fires the authored catch gameplay cue');
assert.match(game, /const mineDescentFloor = t\.mineDynamicDescent && proceduralMineTarget[\s\S]*?enterBuilding\([^\n]*mineDescentFloor \? `Floor \${mineDescentFloor}` : ''\)[\s\S]*?if \(mineDescentFloor\)[\s\S]*?playGameplayCue\?\.\('progressDeeper'\)/,
  'only a discovered mine-hole transition supplies the destination floor heading and fires the progress-deeper gameplay cue');
assert.match(game, /function enterBuilding\(mapId, defaultCol, defaultRow, targetSpotId = '', loadingContextText = ''\)[\s\S]*?LoadingScreenRuntime\?\.show\(loadingContextText \? \{ reason: loadingMineFloor \? 'mine-floor-load' : 'map-change', contextText: loadingContextText \} : undefined\)/,
  'ordinary mine loads keep the lore loading screen but cannot invent a Floor N heading without hole-descent context');
assert.match(loadingScreen, /id="hlsContext"[\s\S]*?contextText = typeof options === 'string' \? '' : \(options\?\.contextText \|\| ''\)/,
  'the loading screen renders caller-supplied destination context separately from rotating Compendium tips');
assert.match(config, /"nightbugsVolume": 0\.34/,
  'nightbugs use the reviewed post-normalization mix level');
assert.match(config, /"nightbugs": "assets\/audio\/sfx\/bgs\/bgs_nightbugs1\.mp3"/,
  'runtime config uses the normalized nightbugs recording');
assert.equal((config.match(/"url": "assets\/audio\/music\/bgm\/bgm_farm1\.m4a", "fallback": true, "rainingOnly": true/g) || []).length, 2,
  'the shared farm/town theme is authored as rain-only in both playlists');
assert.match(index, /config\/scratchbones-config\.js\?v=\d{8}[a-z0-9]+/,
  'the browser loads the Pure Focus-only combat playlist through a cache-busted config URL (content is asserted above)');
assert.match(formatUtils, /title-screen-runtime\.js\?v=[A-Za-z0-9_.-]+/,
  'the parser-synchronous title loader cache-busts the earliest Remembrance bootstrap');
assert.match(index, /music-system\.js\?v=[A-Za-z0-9_-]+/,
  'the browser cache key loads the sample-accurate Skirmish loop transport');
assert.match(index, /audio-track-gain-settings\.js\?v=[A-Za-z0-9_.-]+/,
  'the browser loads the per-song gain Settings controller before game startup');
assert.match(index, /town-mine\.js\?v=[A-Za-z0-9_.-]+/,
  'the browser cache key loads the Ghoul soundtrack combat exemption');
assert.match(index, /loading-screen-runtime\.js\?v=[A-Za-z0-9_-]+/,
  'the browser cache key loads destination-floor context on mine loading screens');
assert.match(index, /fishing-minigame\.js\?v=[A-Za-z0-9_-]+/,
  'the browser cache key loads the successful-catch music cue hook');
assert.match(index, /"game\.js\?v=\d{8}[A-Za-z0-9_-]+"/,
  'the browser cache key loads the mine-hole cue and floor-number handoff');

assert.ok(fs.statSync(nightbugsPath).size > 600000,
  'normalized nightbugs recording must be present and nontrivial');
assert.ok(fs.statSync(skirmishPath).size > 100000,
  'Skirmish combat music must be present and nontrivial');
assert.ok(fs.statSync(remembrancePath).size > 1000000,
  'Remembrance must be present and nontrivial');
assert.ok(fs.statSync(quietHopePath).size > 1000000,
  'Quiet Hope must be present and nontrivial');
assert.ok(fs.statSync(gentleTwilightPath).size > 1000000,
  'Gentle Twilight must be present and nontrivial');
assert.ok(fs.statSync(snowAndDarknessPath).size > 1000000,
  'Snow and Darkness must be present as the real recording, not a placeholder');
assert.ok(fs.statSync(pureFocusPath).size > 100000,
  'Pure Focus combat music must be present as a nontrivial recording');
assert.ok(fs.statSync(undergrowthPath).size > 1000,
  'The Undergrowth Cloud Forest night music must be present and nonempty');
assert.ok(fs.statSync(fishCaughtCuePath).size > 1000,
  'fish-caught gameplay cue must be present and nonempty');
assert.ok(fs.statSync(progressDeeperCuePath).size > 1000,
  'progress-deeper gameplay cue must be present and nonempty');

console.log('music system tests passed');
