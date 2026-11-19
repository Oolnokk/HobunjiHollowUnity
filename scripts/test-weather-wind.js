#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let seconds = 0; // Drives deterministic clock sampling without relying on timing or sleeps.
let calendar = { isRaining: false, rainStrength: 0 }; // Changes between weather assertions; shared by the production wind owner.
const win = {
  WeatherFX: { getProjection: () => ({ calendar }) },
  performance: { now: () => seconds * 1000 },
};
win.window = win;
vm.runInNewContext(fs.readFileSync('docs/js/weather-wind.js', 'utf8'), win);
const wind = win.WeatherWind;
const sample = (zone, at = seconds) => wind.getStrengthForArea(zone, calendar, at); // Samples actual exported zone/weather wind.

const lowlands = ['farm', 'town', 'map_eastern_mire', 'map_southern_cloud_forest'];
const highlands = ['map_western_slope', 'map_northern_cliffs'];
for (const at of Array.from({ length: 400 }, (_, i) => i)) {
  const sheltered = lowlands.map(zone => sample(zone, at));
  const katabatic = highlands.map(zone => sample(zone, at));
  assert(katabatic.every(value => value > Math.max(...sheltered)),
    'mountain/Highplains funnel remains much windier than every sheltered biome, even in dry weather');
  assert([...sheltered, ...katabatic].every(value => value >= 0 && value <= 1),
    'wind is a bounded normalized strength');
}

const slopeSamples = Array.from({ length: 400 }, (_, i) => sample('map_western_slope', i));
assert(Math.min(...slopeSamples) < 0.68 && Math.max(...slopeSamples) > 0.75,
  'slope gusts alternately clear and lift snow without snowfall');
const northSamples = Array.from({ length: 400 }, (_, i) => sample('map_northern_cliffs', i));
assert(Math.max(...northSamples) - Math.min(...northSamples) > 0.12,
  'northern katabatic winds also vary instead of being a fixed audio volume');
assert(Math.min(...northSamples) > 0.6, 'northern cliffs remain windblown even in calm, dry conditions');

seconds = 18;
const dry = sample('map_western_slope');
const dryMire = sample('map_eastern_mire'); // Verifies wet-weather strengthening against the identical sheltered-zone phase.
calendar = { isRaining: true, rainStrength: 2 };
assert(sample('map_western_slope') > dry, 'snowstorm boosts the pre-existing real wind');
assert(sample('map_eastern_mire') > dryMire, 'other zones strengthen in rain without inheriting mountain baselines');
calendar = { isRaining: true, rainStrength: 3 };
assert.equal(sample('map_western_slope'), 1, 'proper blizzard reaches the wind cap');
assert(wind.vegetationSwayForArea('map_western_slope') > wind.vegetationSwayForArea('farm'),
  'vegetation receives a scaled version of the same wind strength');

calendar = { isRaining: false, rainStrength: 0 };
assert.equal(wind.getDebugState('map_western_slope').profile.source,
  'mountain/Highplains katabatic funnel', 'mobile debug describes the authored highland wind');
assert(wind.getDebugState('map_western_slope').strength > wind.getDebugState('town').strength,
  'debug strength agrees with the live regional values');
assert(wind.getStrengthForArea('unknown_map') < 0.5, 'unknown areas use a safe ordinary-weather fallback');

const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Guards against a later main-loop overwrite bypassing the shared zone wind.
const fogSource = fs.readFileSync('docs/js/cloud-forest-fog.js', 'utf8'); // Ensures Slope snow samples the same wind as audio.
const musicSource = fs.readFileSync('docs/js/music-system.js', 'utf8'); // Ensures SFX strength no longer derives solely from rainfall.
const startup = fs.readFileSync('docs/index.html', 'utf8'); // Verifies the shared wind module loads before consumers.
assert.match(gameSource, /zoneGrassWindMat\.uniforms\.uStrength\.value = s_billWind[\s\S]{0,160}WeatherWind\?\.vegetationSwayForArea/,
  'wilderness billboard wind updates from the shared biome signal at constant cost');
assert.match(musicSource, /WeatherWind\?\.getStrengthForArea\?\.\(windRegion, deps\.calendar\)/,
  'wind SFX consume the actual regional strength and calendar');
assert.match(fogSource, /slopeWindStrength = clamp01\(window\.WeatherWind\?\.getStrengthForArea/,
  'windblown snow consumes shared strength instead of a private gust oscillator');
assert(startup.indexOf('js/weather-wind.js?v=') > 0
  && startup.indexOf('js/weather-wind.js?v=') < startup.indexOf('js/cloud-forest-fog.js?v=')
  && startup.indexOf('js/weather-wind.js?v=') < startup.indexOf('src="game.js?v='),
  'wind authority boots ahead of both fog and the game loop');
console.log('Weather wind passed: regional katabatic baselines, gusts, storms, vegetation, SFX integration and diagnostics.');
