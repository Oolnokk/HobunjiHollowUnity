#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const music = source('docs/js/music-system.js');
const game = source('docs/game.js');
const config = source('docs/config/scratchbones-config.js');
const index = source('docs/index.html');
const nightbugsPath = path.join(__dirname, '../docs/assets/audio/sfx/bgs/bgs_nightbugs1.mp3'); // Points the asset-presence check at the normalized runtime recording.

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
assert.match(music, /stopMusicSlot\('currentBgm', 'bgm conditions expired', musicFadeConfig\(\)\.songFadeOutMs\)/,
  'BGM whose live conditions expire uses the slow authored song fade');
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
assert.match(config, /"nightbugsVolume": 0\.34/,
  'nightbugs use the reviewed post-normalization mix level');
assert.match(config, /"nightbugs": "assets\/audio\/sfx\/bgs\/bgs_nightbugs1\.mp3"/,
  'runtime config uses the normalized nightbugs recording');
assert.equal((config.match(/"url": "assets\/audio\/music\/bgm\/bgm_farm1\.m4a", "fallback": true, "rainingOnly": true/g) || []).length, 2,
  'the shared farm/town theme is authored as rain-only in both playlists');
assert.match(index, /scratchbones-config\.js\?v=20260821alchemy2/,
  'the browser cache key loads the rain-only playlist');
assert.match(index, /music-system\.js\?v=20260814a/,
  'the browser cache key loads the fixed scheduler');

assert.ok(fs.statSync(nightbugsPath).size > 600000,
  'normalized nightbugs recording must be present and nontrivial');

console.log('music system tests passed');
