#!/usr/bin/env node
'use strict';

// Mocks the real game's browser audio transport to regression-test rain, wind,
// thunder, doorway transitions and mobile-safe fallbacks in Node.
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const musicSource = read('docs/js/music-system.js');
const audioSource = read('docs/js/audio-system.js');
const weatherSource = read('docs/js/weather-fx.js');

const check = (condition, message) => { if (!condition) throw new Error(message); };
let area = 'farm'; // Changes to a real building, returns outdoors, then visits an unrelated mine.
let audioContextState = 'running'; // Models successful Web Audio and mobile suspended-context playback.
let now = 0; // Advances the original volume-fade calculations without a real game loop.
let mediaCaptures = 0; // Counts weather media-source captures to catch duplicate routing.
const filters = []; // Records low-pass filter targets during building transitions.
const sounds = []; // Stores the actual mocked HTMLAudioElement volume targets.
const captured = new WeakSet(); // A Web Audio source cannot be created twice for one audio element.
class MockAudio {
  constructor(src) { this.src = src; this.volume = 1; this.paused = true; sounds.push(this); }
  addEventListener() {}
  load() {}
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}
const graph = {
  currentTime: 1, destination: {},
  get state() { return audioContextState; },
  resume() { return Promise.resolve(); },
  createMediaElementSource(audio) {
    check(!captured.has(audio), 'each HTML weather loop is captured only once');
    captured.add(audio); mediaCaptures++;
    return { connect(next) { return next; } };
  },
  createGain() { return { gain: { value: 1 }, connect(next) { return next; } }; },
  createBiquadFilter() {
    const filter = {
      frequency: { value: 0, cancelScheduledValues() {}, setTargetAtTime(v) { this.value = v; } },
      Q: { value: 0 },
      connect(next) { return next; },
    };
    filters.push(filter);
    return filter;
  },
};
const cfg = { enabled: true, rainVolume: 1, bgs: {
  birds: 'birds.mp3', nightbugs: 'bugs.mp3',
  wind1: 'wind1.mp3', wind2: 'wind2.mp3',
  gentlerain: 'gentle.mp3', midrain: 'mid.mp3', heavyrain: 'heavy.mp3',
} }; // Uses the game's ordinary config shape, with real authored fallback volume values.
const musicWindow = { __hobunjiGameStarted: true, _footstepAudioCtx: graph,
  AudioSystem: { gameAudioConfig: () => cfg }, addEventListener() {} };
const document = { baseURI: 'https://hobunji.test/', addEventListener() {} };
class MockURL { constructor(src, base) { this.href = base + src; } }
const performance = { now: () => (now += 250) };
const music = new Function('window','document','Audio','performance','URL',
  musicSource + '\nreturn window.Music;')(musicWindow,document,MockAudio,performance,MockURL);
const deps = { getCurrentArea: () => area, _isZoneArea: x => x === 'wild',
  _isBuildingArea: x => x === 'map_i_farmhouse', getHour: () => 12,
  calendar: { isRaining: true, rainStrength: 3 },
  clamp: (value, min, max) => Math.max(min, Math.min(max, value)), debugLog() {} };
music.init(deps);
music.updateExteriorBgs();
music.updateRainAudio();
let mix = music.getWeatherAudioDebugState();
check(mix.loops.rainheavy.target === 0.65, 'outdoor rain intensity unchanged');
check(mix.loops.wind2.target > 0 && !mix.loops.wind2.filtered, 'outdoor wind is full fidelity');
area = 'map_i_farmhouse';
music.updateExteriorBgs();
music.updateRainAudio();
mix = music.getWeatherAudioDebugState();
check(mix.indoors && mix.cutoffHz === 780, 'building receives indoor acoustic profile');
check(Math.abs(mix.loops.rainheavy.target - 0.208) < 1e-9, 'heavy rain stays audible at 32% indoors');
check(mix.loops.wind1.target > 0 && mix.loops.wind2.target > 0, 'both weather winds audible indoors');
check(mix.loops.rainheavy.filtered && mix.loops.wind2.filtered, 'rain and wind are low-pass filtered');
check(filters.length === 5 && filters.every(f => f.frequency.value === 780), 'all five weather layers use muffled cutoff');
const birds = sounds.find(s => s.src.includes('birds')); // Confirms non-weather wildlife does not leak into a building.
check(birds._bgsTargetVolume === 0, 'birds remain silent indoors');
const count = mediaCaptures; // Used to verify filter nodes are reused after entering the building again.
area = 'farm';
music.updateExteriorBgs();
music.updateRainAudio();
check(filters.every(f => f.frequency.value === 18000), 'outdoor transition restores bright weather');
check(music.getWeatherAudioDebugState().loops.rainheavy.target === 0.65, 'outdoor volume recovers');
area = 'map_i_farmhouse';
music.updateExteriorBgs();
music.updateRainAudio();
check(mediaCaptures === count, 'no duplicate MediaElementAudioSourceNode on reentry');
deps.calendar.isRaining = false;
music.updateRainAudio();
check(music.getWeatherAudioDebugState().loops.rainheavy.target === 0, 'dry weather fades rain indoors');
area = 'mine';
deps.calendar.isRaining = true;
music.updateExteriorBgs();
music.updateRainAudio();
check(music.getWeatherAudioDebugState().loops.rainheavy.target === 0, 'unrelated mines stay dry');
check(music.getWeatherAudioDebugState().loops.wind2.target === 0, 'weather does not leak into mines');
const sfxBody = audioSource.slice(audioSource.indexOf('  function playSfxAudioElement('),
  audioSource.indexOf('\n  function playObjectSfx(')); // Executes the production filtered one-shot function.
const sfx = new Function('window',sfxBody+'\nreturn playSfxAudioElement;')({
  AudioContext: class { constructor() { return graph; } }, _footstepAudioCtx: graph,
});
audioContextState = 'running';
const thunder = new MockAudio('thunder.mp3');
sfx(thunder, 0.288, 1, 780);
check(!thunder.paused && filters.at(-1).frequency.value === 780, 'one-shot thunder is filtered and plays');
const normalSfx = new MockAudio('ordinary.mp3');
sfx(normalSfx, 0.5, 1);
check(normalSfx.volume === 0.5 && filters.length === 6, 'non-weather SFX retain direct playback');
audioContextState = 'suspended';
const fallback = new MockAudio('fallback.mp3');
sfx(fallback, 0.288, 1, 780);
check(!fallback.paused && fallback.volume === 0.288 && filters.length === 6, 'suspended audio context uses audible direct fallback');
const thunderBody = weatherSource.slice(weatherSource.indexOf('  function playThunderSfx()'),
  weatherSource.indexOf('  let debugWeatherOverride = null;')); // Executes the actual weather-system thunder routing.
const thunderCalls = []; // Records object-SFX parameters passed from weather to the shared player.
const thunderWindow = { Music: music, AudioSystem: { playObjectSfx: (...args) => thunderCalls.push(args) } };
const weatherThunder = new Function('window','deps','THUNDER_SFX','Audio','thunderPreload',
  thunderBody+'\nreturn playThunderSfx;')(thunderWindow,deps,{url:'thunder.mp3',volume:0.9},MockAudio,null);
area = 'map_i_farmhouse';
weatherThunder();
check(thunderCalls[0][0].lowpassHz === 780 && thunderCalls[0][1] === 0.32, 'indoor thunder is muffled');
area = 'farm';
weatherThunder();
check(thunderCalls[1][0].lowpassHz === undefined && thunderCalls[1][1] === 1, 'outdoor thunder stays unchanged');
console.log('Indoor weather audio tests passed:', { weatherFilters: count, indoorHeavyRain: 0.208, mediaCaptures });
