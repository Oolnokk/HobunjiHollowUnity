#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const gainSettingsSource = source('docs/js/audio-track-gain-settings.js');
const musicSource = source('docs/js/music-system.js');
const indexSource = source('docs/index.html');

assert.match(indexSource, />Audio<\/div>[\s\S]*?id="settingMusicTrackGainSong"[\s\S]*?id="settingMusicTrackGain"[^>]*max="500"/,
  'Settings exposes an Audio section with one song dropdown and a gain slider reaching 500%');
assert.match(indexSource, /audio-track-gain-settings\.js\?v=20260920trackgain2/,
  'the per-song gain settings runtime is loaded by the game page');
assert.match(musicSource, /window\._footstepAudioCtx = _musicAudioCtx/,
  'music reuses the proven shared boosted-audio context rather than an isolated destination');
assert.match(musicSource, /createMediaElementSource\(snd\)[\s\S]*?source\.connect\(gain\)\.connect\(ctx\.destination\)/,
  'music uses a real Web Audio GainNode so values above 100% can exceed HTMLMediaElement.volume');
assert.match(musicSource, /if \(ctx\.state !== 'running'\)[\s\S]*?ctx\.resume\(\)\.then\([\s\S]*?snd\._refreshMusicTarget\?\.\(120\)[\s\S]*?return null;/,
  'a live track is never captured into a non-running AudioContext; it stays on audible plain volume until resume succeeds');
assert.match(musicSource, /const initialTarget = Math\.max\(0, Math\.min\(1, Number\(snd\.volume\) \|\| 0\)\)/,
  'GainNode promotion starts from the currently audible media-element level so >100% tracks keep their fade instead of jumping to full gain');
assert.match(musicSource, /const musicCtx = getMusicAudioCtx\(\)[\s\S]*?musicCtx\?\.state === 'suspended'[\s\S]*?musicCtx\.resume\(\)/,
  'trusted input proactively creates/resumes the music context before later automatic >100% songs need it');
assert.match(musicSource, /snd\.volume = 1; \/\/ GainNode is the sole audible level control/,
  'routed music keeps media-element volume at unity so gain is not applied twice');
assert.match(musicSource, /AudioTrackGainSettings\?\.hasTrack\?\.\(url\)[\s\S]*?_musicLoudnessGain\.set\(resolved, 1\)/,
  'authored BGM bypasses the older RMS normalizer so LUFS reference calibration is not double-applied');
assert.match(musicSource, /Math\.max\(0, baseVolume\) \* measuredGain \* userTrackGain/,
  'per-song gain remains layered into the common playback target while unlisted cue files may still use measuredGain');
assert.match(musicSource, /hobunji-track-gain-changed[\s\S]*?_refreshMusicTarget/,
  'moving the Settings slider retunes a matching currently-playing track immediately');
assert.doesNotMatch(musicSource, /function attachMusicGain\(snd\) \{\s*return null;/,
  'the old disabled music gain path is no longer active');

const storage = new Map();
const events = [];
const sandbox = {
  console,
  Option: function Option(label, value) { this.label = label; this.value = value; },
  CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init?.detail; },
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
  },
  document: {
    readyState: 'complete',
    getElementById() { return null; },
    addEventListener() {},
  },
  window: {
    dispatchEvent(event) { events.push(event); },
  },
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(gainSettingsSource, sandbox, { filename: 'audio-track-gain-settings.js' });

const api = sandbox.window.AudioTrackGainSettings;
assert(api, 'gain settings runtime publishes its API');
assert.equal(api.tracks.length, 10, 'dropdown covers all ten current BGM files');
assert.equal(api.gainPercentForUrl('assets/audio/music/bgm/bgm_follow_the_signs.ogg'), 100,
  'Follow the Signs is the 100% loudness reference');
assert.equal(api.gainPercentForUrl('assets/audio/music/bgm/bgm_farm1.m4a'), 60,
  'Farm 1 defaults to its Follow-the-Signs calibration');
assert.equal(api.gainPercentForUrl('assets/audio/music/bgm/bgm_gentle_twilight.m4a'), 170,
  'Gentle Twilight defaults to its Follow-the-Signs calibration');
assert.equal(api.gainPercentForUrl('assets/audio/music/bgm/bgm_just_beyond_the_torchlight.ogg'), 180,
  'Torchlight calibration accounts for its existing 2x authored runtime multiplier');
assert.equal(api.gainPercentForUrl('assets/audio/music/bgm/bgm_quiet_hope.m4a'), 335,
  'Quiet Hope gets enough real gain to reach the reference band');
assert.equal(api.gainPercentForUrl('assets/audio/music/bgm/bgm_remembrance.m4a'), 145,
  'Remembrance defaults near the reference band');
assert.equal(api.gainPercentForUrl('assets/audio/music/bgm/bgm_skirmish.m4a'), 70,
  'Skirmish is attenuated into the reference band');
assert.equal(api.gainPercentForUrl('assets/audio/music/bgm/bgm_snow_and_darkness.m4a'), 95,
  'Snow and Darkness stays close to unity because its master is already near the reference');
assert.equal(api.gainPercentForUrl('assets/audio/music/bgm/bgm_still_waking_up.mp3'), 30,
  'Still Waking Up is substantially attenuated to match the reference');
assert.equal(api.gainPercentForUrl('assets/audio/music/bgm/bgm_what_the_winds_carry.mp3'), 65,
  'What the Winds Carry is attenuated into the reference band');

const integratedLufs = {
  'bgm_farm1.m4a': -13.98,
  'bgm_follow_the_signs.ogg': -18.51,
  'bgm_gentle_twilight.m4a': -23.23,
  'bgm_just_beyond_the_torchlight.ogg': -29.72,
  'bgm_quiet_hope.m4a': -28.96,
  'bgm_remembrance.m4a': -21.63,
  'bgm_skirmish.m4a': -15.39,
  'bgm_snow_and_darkness.m4a': -18.10,
  'bgm_still_waking_up.mp3': -8.05,
  'bgm_what_the_winds_carry.mp3': -14.44,
};
const referenceLufs = integratedLufs['bgm_follow_the_signs.ogg'];
for (const track of api.tracks) {
  const authoredMultiplier = track.id === 'bgm_just_beyond_the_torchlight.ogg' ? 2 : 1;
  const effectiveGain = api.gainForUrl(track.url) * authoredMultiplier;
  const effectiveLufs = integratedLufs[track.id] + 20 * Math.log10(effectiveGain);
  assert(Math.abs(effectiveLufs - referenceLufs) <= 0.5,
    track.id + ' should land within 0.5 dB of Follow the Signs; got ' + effectiveLufs.toFixed(2) + ' LUFS');
}

assert.equal(api.setGainPercent('bgm_quiet_hope.m4a', 235, { emit: false }), 235,
  'a song can still be manually moved away from its calibrated reference');
assert.equal(api.gainForUrl('https://example.test/game/assets/audio/music/bgm/bgm_quiet_hope.m4a?v=1'), 2.35,
  'saved override resolves from full/cache-busted runtime URLs');
assert.equal(api.setGainPercent('bgm_quiet_hope.m4a', 999, { emit: false }), 500,
  'gain is safely bounded at the 500% Settings maximum');
assert.equal(api.setGainPercent('bgm_quiet_hope.m4a', api.referencePercentForUrl('bgm_quiet_hope.m4a'), { emit: false }), 335,
  'Reference returns the song to its Follow-the-Signs calibrated default');
assert.equal(api.gainForUrl('bgm_quiet_hope.m4a'), 3.35,
  'the calibrated reference remains the default after clearing the manual override');
api.setGainPercent('bgm_remembrance.m4a', 150);
assert.equal(events.at(-1)?.type, 'hobunji-track-gain-changed',
  'editing a song emits the live-refresh event');
assert.equal(events.at(-1)?.detail?.gain, 1.5,
  'live-refresh event carries the exact multiplier Music should apply');
assert.equal(api.referencePercentForUrl('bgm_remembrance.m4a'), 145,
  'the UI can expose the selected song\'s calibrated reference for the Reference button');

console.log('music track gain settings tests passed');
