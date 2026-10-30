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
const loadingScreen = source('docs/js/loading-screen-runtime.js'); // Loading context remains independent from in-world mine titles.
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
  const live = { combat: false, tutorial: false, exclusive: false, plays: 0, pauses: 0, resumes: 0, clock: 1000 }; // Mutable inputs and transport observations for scheduler transitions.
  const ambient = { ended: false }; // Existing exploration track retained beneath training music.
  const state = { area: 'arena', currentBgm: ambient, mode: 'bgm', nextAt: 0, blockUntil: 0, combatOverrideActive: false }; // Scheduler slots shared with the executed production function.
  const context = { // Narrow audio boundary: scheduler decisions and callbacks remain production code.
    window: { AudioSystem: { gameAudioConfig: () => ({ combatBgm: [{ url: 'combat.m4a' }] }) }, CombatTutorial: { active: () => live.tutorial } },
    deps: { getCurrentArea: () => 'arena', isPlayerInCombat: () => live.combat },
    quietLoading: false, _startupBgm: null, _ambientCueState: state,
    _cuePlaybackStats: { requested: 0, started: 0, completed: 0, failed: 0, lastError: '', lastPhaseExit: '' }, // Production cue counters observed by the scheduler helpers.
    _audioCueIndexes: new Map(),
    performance: { now: () => live.clock },
    areaBgmIncludesTrack: () => true, areaCueIncludesTrack: () => true,
    ambientMusicOwnsSoundtrack: () => live.exclusive,
    audioDebug() {}, audioTrace() {}, audioTraceEnabled: () => false,
    isAudioEntryEligible: () => true, audioUrlFailed: () => false, festivalSilencesAmbient: () => false, ruinVaultSilencesAmbient: () => false, // No generated ruin in the isolated scheduler fixtures.
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
  assert.equal(state.currentCombatBgm, trainingTrack, 'a momentary gap between opponents holds the combat track instead of fading out and back in');
  live.clock += 3001; // Past the hold: a genuine end of combat releases the music.
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

// Verify the authored music cycle: complete song -> 120 seconds of separate cues -> next song.
{
  const live = { now: 1000, area: 'town', starts: [], cuesAvailable: true, bgmAvailable: true, nextSong: 0 }; // Deterministic stage clock, transport log, and simulated authoring availability.
  const state = { area: 'town', indexId: 'general', mode: 'bgm', nextAt: 0, blockUntil: 0, currentBgm: null, currentCue: null, currentCombatBgm: null, combatOverrideActive: false, cuePhaseEndsAt: 0, lastCueId: '' }; // The scheduler's production stage ownership fields.
  const config = { enabled: true, bgmVolume: 0.48, ambientCueMinDelaySec: 5, ambientCueMaxDelaySec: 5, ambientCuePhaseDurationSec: 120 }; // Fixed cue gaps make the clock checks reproducible.
  const context = {
    window: { AudioSystem: { gameAudioConfig: () => config } },
    deps: { getCurrentArea: () => live.area, isPlayerInCombat: () => false },
    performance: { now: () => live.now },
    quietLoading: false, _startupBgm: null, _ambientCueState: state,
    _cuePlaybackStats: { requested: 0, started: 0, completed: 0, failed: 0, lastError: '', lastPhaseExit: '' }, // Production cue counters observed by the scheduler helpers.
    _audioCueIndexes: new Map([['general', { __basePath: 'cues/general/', ambient_cues: [{ id: 'to1', file: 'to1.ogg', volume: 0.7 }, { id: 'to2', file: 'to2.ogg', volume: 0.7 }] }]]),
    _dailyBgmPlayed: new Set(),
    audioDebug() {}, audioTrace() {}, audioTraceEnabled: () => false,
    areaBgmIncludesTrack: () => true, areaCueIncludesTrack: () => true,
    resolveAreaAudioIndex: () => 'general', // Shared cue library across farm and town.
    isAudioEntryEligible: () => live.cuesAvailable, audioUrlFailed: () => false, festivalSilencesAmbient: () => false, ruinVaultSilencesAmbient: () => false, // No generated ruin in the isolated scheduler fixtures.
    musicFadeConfig: () => ({ cueFadeMs: 280, songFadeInMs: 2200, songFadeOutMs: 2600 }),
    ambientMusicOwnsSoundtrack: () => false,
    resolveAreaBgm: () => live.bgmAvailable ? { url: 'song-' + (++live.nextSong) + '.ogg', loop: true } : null, // Even a mistakenly looping ordinary BGM must advance the sequential cycle.
    retireMusicTrack(audio) { audio.retired = true; audio.ended = true; audio.paused = true; },
    playMusicTrack(url, _volume, _fadeIn, _fadeOut, options = {}) {
      assert.equal(!!state.currentBgm && !state.currentBgm.ended && url.startsWith('cues/'), false, 'a cue cannot begin over a BGM');
      assert.equal(!!state.currentCue && !state.currentCue.ended && url.startsWith('song-'), false, 'a BGM cannot begin over a cue');
      live.starts.push(url);
      return { src: url, loop: options.loop === true, ended: false, paused: false, listeners: {},
        addEventListener(event, callback) { this.listeners[event] = callback; },
        _watchForStall(_ms, callback) { this.stall = callback; } };
    },
    requestGameAudioPlay() { return Promise.resolve(); },
    markAudioUrlFailed() {}, isRealMediaError: () => true,
  };
  const sourceStart = music.indexOf('  function scheduleNextCueDelay()'); // Includes the production cue-window helpers and scheduler.
  const sourceEnd = music.indexOf('  function setLoopingBgs('); // Excludes unrelated weather/background layer code.
  vm.runInNewContext(music.slice(sourceStart, sourceEnd), context);
  context.updateAmbientCues();
  const firstSong = state.currentBgm; // Actual song transport being held until its complete-ended event.
  assert.equal(firstSong.src, 'song-1.ogg', 'stage A chooses the eligible full song');
  assert.equal(firstSong.loop, false, 'ordinary BGM cannot loop indefinitely and starve cue stage B');
  live.now = 139000;
  context.updateAmbientCues();
  assert.equal(state.currentBgm, firstSong, 'stage A never cuts its song to start cues early');
  assert.equal(state.currentCue, null, 'no ambient cues overlap a full song');
  firstSong.listeners.ended();
  assert.equal(state.currentBgm, null, 'completed BGM vacates its transport slot');
  assert.equal(state.mode, 'cue_wait', 'stage B begins after the song finishes');
  assert.equal(state.cuePhaseEndsAt, 259000, 'cue stage spans precisely two minutes');
  context.updateAmbientCues();
  const firstCue = state.currentCue; // First standalone regional motif within the two-minute stage.
  assert.ok(firstCue && firstCue.src.startsWith('cues/general/'), 'stage B launches its first cue without playing a song');
  assert.equal(state.currentBgm, null, 'regional cues have exclusive use of ambient music');
  live.now = 142000;
  firstCue.listeners.ended();
  assert.equal(state.mode, 'cue_wait', 'one cue ending does not end the entire cue stage');
  assert.equal(state.nextAt, 147000, 'the existing random cue interval separates cues');
  live.area = 'farm'; // Crossing between areas sharing general cues must not restart the soundtrack cycle.
  context.updateAmbientCues();
  assert.equal(state.area, 'farm', 'the cue stage follows a move to an area with the same library');
  assert.equal(state.mode, 'cue_wait', 'the quiet gap remains inside stage B after travel');
  assert.equal(state.cuePhaseEndsAt, 259000, 'the shared-area transition preserves the original cue deadline');
  live.now = 146000;
  context.updateAmbientCues();
  assert.equal(state.currentCue, null, 'stage B honors the quiet gap between motifs');
  live.now = 147000;
  context.updateAmbientCues();
  const secondCue = state.currentCue; // Second motif proves the stage plays a series, not one cue.
  assert.ok(secondCue, 'another cue starts during the same two-minute stage');
  assert.notEqual(secondCue.src, firstCue.src, 'alternatives prevent identical consecutive motifs');
  secondCue.listeners.ended();
  live.now = 258900;
  context.updateAmbientCues();
  const lastCue = state.currentCue; // The stage deadline must never cut an already-playing cue short.
  assert.ok(lastCue, 'a cue may begin just before the two-minute deadline');
  live.now = 259500;
  context.updateAmbientCues();
  assert.equal(state.currentCue, lastCue, 'cue playback continues past the stage deadline');
  assert.equal(state.currentBgm, null, 'the next song cannot start while the final cue plays');
  live.now = 261000;
  lastCue.listeners.ended();
  assert.equal(state.mode, 'bgm', 'stage B finishes after the last complete cue');
  context.updateAmbientCues();
  assert.equal(state.currentBgm.src, 'song-2.ogg', 'stage C repeats with a newly chosen full song');
  assert.equal(state.currentCue, null, 'the new song never plays over a cue');
  assert.equal(state.cuePhaseEndsAt, 0, 'the next cycle clears the previous cue deadline');

  // A missing BGM pool still leaves the regional cue fallback available.
  state.currentBgm.listeners.ended();
  live.cuesAvailable = false;
  context.updateAmbientCues();
  assert.equal(state.mode, 'bgm', 'an empty cue pool cannot strand the soundtrack in silence');
  assert.equal(state.currentCue, null, 'ineligible cues are never played');
  live.now += 5000;
  context.updateAmbientCues();
  assert.equal(state.currentBgm.src, 'song-3.ogg', 'song selection resumes after the empty-pool retry gap');
  live.bgmAvailable = false;
  state.currentBgm.listeners.ended();
  context.updateAmbientCues();
  assert.equal(state.mode, 'bgm', 'the empty cue library safely returns to the song-selection stage');
}

// Northern Cliffs must resolve its authored cue library even when a generated
// wilderness zone has no audioIndex metadata (the actual reported repeat bug).
{
  const northern = JSON.parse(source('docs/assets/audio/music/cues/northern_cliffs/index.json'));
  assert.equal(northern.id, 'northern_cliffs', 'the Northern Cliffs cue file declares the expected index id');
  assert.equal(northern.ambient_cues.length, 14, 'the Northern Cliffs index has all fourteen regional motifs');
  for (const cue of northern.ambient_cues) {
    assert.ok(fs.existsSync(path.join(__dirname, '../docs/assets/audio/music/cues/northern_cliffs', cue.file)), 'the authored Northern Cliffs asset exists: ' + cue.file);
  }
  assert.match(config, /"map_northern_cliffs": \[\s*\{ "url": "assets\/audio\/music\/bgm\/bgm_what_the_winds_carry\.mp3"/,
    'the actual Northern Cliffs fallback track is the one being exercised');

  const zoneContext = {
    _mapAudioIndexes: new Map(),
    deps: {
      _isZoneArea: area => area === 'map_northern_cliffs' || area === 'map_western_slope',
      EXTERIOR_ZONES: { map_northern_cliffs: {}, map_western_slope: {} },
      getWorkspaceMaps: () => [],
    },
  };
  const resolveSource = music.slice(music.indexOf('  function resolveAreaAudioIndex('), music.indexOf('  function resetAmbientCueTimer('));
  vm.runInNewContext(resolveSource, zoneContext);
  const northernId = zoneContext.resolveAreaAudioIndex('map_northern_cliffs');
  assert.equal(northernId, 'northern_cliffs', 'Northern Cliffs maps directly to its motifs without zone metadata');
  assert.equal(zoneContext.resolveAreaAudioIndex('map_western_slope'), northernId, 'Western Slope shares the northern cue library');

  const live = { now: 1000, plays: [] };
  const state = { area: 'map_northern_cliffs', indexId: northernId, mode: 'bgm', nextAt: 0, blockUntil: 0, currentBgm: null, currentCue: null, currentCombatBgm: null, combatOverrideActive: false, cuePhaseEndsAt: 0, lastCueId: '' };
  northern.__basePath = 'assets/audio/music/cues/northern_cliffs/';
  const context = {
    window: { AudioSystem: { gameAudioConfig: () => ({ enabled: true, bgmVolume: 0.48, ambientCuePhaseDurationSec: 120, ambientCueMinDelaySec: 20, ambientCueMaxDelaySec: 45 }) } },
    deps: { getCurrentArea: () => 'map_northern_cliffs', isPlayerInCombat: () => false },
    performance: { now: () => live.now }, quietLoading: false, _startupBgm: null, _ambientCueState: state,
    _cuePlaybackStats: { requested: 0, started: 0, completed: 0, failed: 0, lastError: '', lastPhaseExit: '' }, // Production cue counters observed by the scheduler helpers.
    _audioCueIndexes: new Map([['northern_cliffs', northern]]),
    _lyreDucked: false, _gameplayCueDuckOwners: new Set(), _dailyBgmPlayed: new Set(),
    audioDebug() {}, audioTrace() {}, audioTraceEnabled: () => false,
    areaBgmIncludesTrack: () => true, areaCueIncludesTrack: () => true,
    isAudioEntryEligible: () => true, audioUrlFailed: () => false, festivalSilencesAmbient: () => false, ruinVaultSilencesAmbient: () => false, // No generated ruin in the isolated scheduler fixtures.
    musicFadeConfig: () => ({ cueFadeMs: 280, songFadeInMs: 2200, songFadeOutMs: 2600 }),
    ambientMusicOwnsSoundtrack: () => false,
    resolveAreaBgm: () => ({ url: 'assets/audio/music/bgm/bgm_what_the_winds_carry.mp3' }),
    retireMusicTrack(sound) { sound.ended = true; },
    playMusicTrack(url, _volume, _fadeIn, _fadeOut, options) {
      live.plays.push({ url, loop: !!options?.loop });
      return { src: url, ended: false, listeners: {},
        addEventListener(event, callback) { this.listeners[event] = callback; },
        _watchForStall() {} };
    },
    requestGameAudioPlay() { return Promise.resolve(); },
  };
  const schedulerSource = music.slice(music.indexOf('  function scheduleNextCueDelay()'), music.indexOf('  function setLoopingBgs('));
  vm.runInNewContext(schedulerSource, context);
  context.updateAmbientCues();
  const northernBgm = state.currentBgm;
  assert.equal(northernBgm.src, 'assets/audio/music/bgm/bgm_what_the_winds_carry.mp3', 'the configured Northern Cliffs song starts stage A');
  assert.equal(live.plays[0].loop, false, 'the Northern Cliffs song must not be placed in a native playback loop');
  northernBgm.listeners.ended();
  assert.equal(state.mode, 'cue_wait', 'the completed Northern Cliffs song enters the cue stage');
  assert.equal(state.cuePhaseEndsAt, 121000, 'Northern Cliffs begins its own two-minute cue stage');
  context.updateAmbientCues();
  assert.match(state.currentCue.src, /assets\/audio\/music\/cues\/northern_cliffs\/mas\d+\.ogg$/,
    'Northern Cliffs actually plays one of its fourteen regional cue files, not another BGM');
  assert.equal(state.currentBgm, null, 'no Northern Cliffs BGM plays under a regional motif');
}

// Combat suspends the cue-stage clock as well as the time between cues.
{
  const state = { nextAt: 90000, cuePhaseEndsAt: 180000, combatSchedulerPausedAt: 30000 }; // Simulated in-progress stage before combat.
  const context = { _ambientCueState: state, performance: { now: () => 60000 } };
  const start = music.indexOf('  function restoreAmbientSchedulerAfterCombat()');
  const end = music.indexOf('  function resumeMusicSlotAfterCombat(', start);
  vm.runInNewContext(music.slice(start, end), context);
  context.restoreAmbientSchedulerAfterCombat();
  assert.equal(state.nextAt, 120000, 'combat extends the pending interval instead of consuming it');
  assert.equal(state.cuePhaseEndsAt, 210000, 'combat extends the two-minute cue deadline');
  assert.equal(state.combatSchedulerPausedAt, 0, 'the combat clock is cleared on restoration');
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
assert.match(game, /if \(t\.mineDynamicDescent && proceduralMineTarget\) \{\s*window\.LocationArrival\.mineDescent\(t\.targetMapId\)/,
  'only discovered mine holes request the unified post-load title and cue');
assert.doesNotMatch(game, /playGameplayCue\?\.\('progressDeeper'\)/,
  'mine loading cannot play a progress cue before the destination is visible');
assert.match(game, /LoadingScreenRuntime\?\.show\(loadingMineFloor \? \{ reason: 'mine-floor-load' \} : undefined\)/,
  'the mine loading overlay has progress information but no floor-number heading');
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
  'the browser cache key loads the completion notification for arrival titles');
assert.match(index, /location-arrival\.js\?v=[A-Za-z0-9_-]+/,
  'the shared arrival coordinator is loaded before gameplay');
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

// After each cue the gap is one of a few authored delays, shorter ones likelier.
{
  const state = { nextAt: 0 };
  const choices = [{ sec: 0, weight: 5 }, { sec: 4, weight: 4 }, { sec: 8, weight: 3 }, { sec: 12, weight: 2 }, { sec: 16, weight: 1 }];
  let roll = 0;
  const context = {
    window: { AudioSystem: { gameAudioConfig: () => ({ ambientCueDelayChoicesSec: choices, ambientCueMinDelaySec: 20, ambientCueMaxDelaySec: 45 }) } },
    performance: { now: () => 1000 }, _ambientCueState: state,
    Math: Object.create(Math, { random: { value: () => roll } }),
  };
  const delaySource = music.slice(music.indexOf('  function scheduleNextCueDelay()'), music.indexOf('  function beginAmbientCuePhase('));
  vm.runInNewContext(delaySource, context);
  const pickAt = r => { roll = r; context.scheduleNextCueDelay(); return (state.nextAt - 1000) / 1000; };
  assert.equal(pickAt(0), 0, 'lowest roll picks the zero-second gap');
  assert.equal(pickAt(5 / 15 - 1e-9), 0, 'zero seconds owns the largest weight band');
  assert.equal(pickAt(5 / 15), 4, 'next band is four seconds');
  assert.equal(pickAt(14 / 15), 16, 'top band is the rare sixteen-second gap');
  const counts = new Map();
  for (let i = 0; i < 15; i++) { const sec = pickAt((i + 0.5) / 15); counts.set(sec, (counts.get(sec) || 0) + 1); }
  assert.deepEqual([...counts], [[0, 5], [4, 4], [8, 3], [12, 2], [16, 1]], 'shorter gaps are proportionally more likely');
  context.window.AudioSystem.gameAudioConfig = () => ({ ambientCueMinDelaySec: 7, ambientCueMaxDelaySec: 7 });
  assert.equal(pickAt(0.5), 7, 'without a choice list the legacy min/max range still applies');
}

console.log('music system tests passed');

