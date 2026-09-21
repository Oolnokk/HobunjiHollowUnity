#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const music = source('docs/js/music-system.js');
const title = source('docs/js/title-screen-runtime.js');
const formatUtils = source('docs/js/format-utils.js');
const game = source('docs/game.js');
const config = source('docs/config/scratchbones-config.js');
const index = source('docs/index.html');
const nightbugsPath = path.join(__dirname, '../docs/assets/audio/sfx/bgs/bgs_nightbugs1.mp3'); // Points the asset-presence check at the normalized runtime recording.
const skirmishPath = path.join(__dirname, '../docs/assets/audio/music/bgm/bgm_skirmish.m4a'); // Confirms the authored combat loop exists at the configured runtime path.
const remembrancePath = path.join(__dirname, '../docs/assets/audio/music/bgm/bgm_remembrance.m4a'); // Confirms the opening/title/onboarding soundtrack exists.
const quietHopePath = path.join(__dirname, '../docs/assets/audio/music/bgm/bgm_quiet_hope.m4a'); // Confirms the farm/town morning candidate exists.
const gentleTwilightPath = path.join(__dirname, '../docs/assets/audio/music/bgm/bgm_gentle_twilight.m4a'); // Confirms the farm/town 02:00-nightfall candidate exists.
const snowAndDarknessPath = path.join(__dirname, '../docs/assets/audio/music/bgm/bgm_snow_and_darkness.m4a'); // Confirms the Western Slope night song exists at the configured runtime path.

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
assert.match(title, /document\.documentElement\.classList\.add\('hobunji-title-active'\);[\s\S]*?tryStartStartupBgm\(\);[\s\S]*?loadTitleSky\(\)/,
  'Remembrance is attempted immediately when the title screen itself is installed');
assert.match(title, /function beginStart\([\s\S]*?tryStartStartupBgm\('title input: ' \+ source\);[\s\S]*?hobunji-title-starting/,
  'the accepted title input retries autoplay synchronously before the swallowed input is released');
assert.match(title, /claimStartupBgmAudio,[\s\S]*?cancelStartupBgmAudio/,
  'the title runtime exposes one-way startup-audio handoff/cancellation APIs');
assert.match(music, /function startStartupBgm\(\)[\s\S]*?audioCfg\.startupBgm[\s\S]*?claimStartupBgmAudio\?\.\(track\.url\)[\s\S]*?existingAudio: earlyTitleAudio[\s\S]*?requestGameAudioPlay\(snd\)/,
  'Music adopts the title runtime\'s existing Remembrance element/playhead and keeps the shared playback gate');
assert.match(music, /function playMusicTrack\([\s\S]*?existingAudio = null[\s\S]*?const snd = existingAudio \|\| makeGameAudio/,
  'the shared music player can adopt an already-playing title soundtrack without creating a duplicate element');
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
assert.match(music, /combatOverrideActive = playerInCombat && !combatOverrideSuppressed/,
  'existing gameplay combat state drives the override while existing exclusive soundtrack owners can suppress it');
assert.match(music, /exclusiveSoundtrack === true/,
  'combat suppression reuses the existing exclusiveSoundtrack metadata instead of inventing a second exemption flag');
assert.doesNotMatch(music, /combatBgmExempt/,
  'music scheduler does not carry a duplicate combat-specific soundtrack exemption concept');
assert.match(music, /playMusicTrack\(track\.url, baseVol \* trackVolMul,[\s\S]*?\{ loop: track\.loop !== false \}\)/,
  'combat BGM loops by default until combat ends');
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
assert.match(config, /"combatBgm": \[[\s\S]*?"url": "assets\/audio\/music\/bgm\/bgm_skirmish\.m4a", "loop": true/,
  'Skirmish is the configured looping combat soundtrack');
assert.match(config, /"startupBgm": \{ "url": "assets\/audio\/music\/bgm\/bgm_remembrance\.m4a", "loop": true \}/,
  'Remembrance loops throughout the opening/title/save/onboarding sequence');
assert.equal((config.match(/"url": "assets\/audio\/music\/bgm\/bgm_quiet_hope\.m4a", "startHour": 6, "endHour": 12/g) || []).length, 2,
  'Quiet Hope is authored only in the farm and town morning pools');
assert.equal((config.match(/"url": "assets\/audio\/music\/bgm\/bgm_gentle_twilight\.m4a", "startHour": 2, "endHour": 19/g) || []).length, 2,
  'Gentle Twilight is authored only in farm and town from 02:00 until nightfall');
assert.match(config, /"map_western_slope": \[[\s\S]*?"url": "assets\/audio\/music\/bgm\/bgm_snow_and_darkness\.m4a", "nightOnly": true, "exclusiveSoundtrack": true/,
  'Snow and Darkness is a Western Slope night track that retains soundtrack ownership during combat');
assert.match(config, /"nightbugsVolume": 0\.34/,
  'nightbugs use the reviewed post-normalization mix level');
assert.match(config, /"nightbugs": "assets\/audio\/sfx\/bgs\/bgs_nightbugs1\.mp3"/,
  'runtime config uses the normalized nightbugs recording');
assert.equal((config.match(/"url": "assets\/audio\/music\/bgm\/bgm_farm1\.m4a", "fallback": true, "rainingOnly": true/g) || []).length, 2,
  'the shared farm/town theme is authored as rain-only in both playlists');
assert.match(index, /scratchbones-config\.js\?v=20260920newbgm1/,
  'the browser cache key loads the expanded authored BGM playlists');
assert.match(formatUtils, /title-screen-runtime\.js\?v=20260920startupbgm1/,
  'the parser-synchronous title loader cache-busts the earliest Remembrance bootstrap');
assert.match(index, /music-system\.js\?v=20260920startupcontinuity2/,
  'the browser cache key loads startup-title audio adoption plus per-song gain behavior');
assert.match(index, /audio-track-gain-settings\.js\?v=20260920trackgain2/,
  'the browser loads the per-song gain Settings controller before game startup');
assert.match(index, /town-mine\.js\?v=20260919combatbgm2/,
  'the browser cache key loads the Ghoul soundtrack combat exemption');

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

console.log('music system tests passed');
