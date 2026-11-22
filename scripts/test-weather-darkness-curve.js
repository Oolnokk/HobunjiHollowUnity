#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Used to guard outdoor weather intensity, tint, and transition behavior.
const fs = require('node:fs'); // Used to execute the real sky lighting implementation.
const path = require('node:path'); // Used to locate the runtime from the repository root.
const vm = require('node:vm'); // Used to exercise sky lighting without creating a browser or WebGL scene.

const source = fs.readFileSync(path.join(__dirname, '..', 'docs/js/sky-dome.js'), 'utf8'); // Authoritative sky/time/weather lighting code.
const initHooks = '  installClockHook(); installWeatherHook(); installRainHook();'; // Swapped only inside this test harness to supply an in-memory calendar.
assert(source.includes(initHooks), 'sky dome initialization hooks should be reachable');
const harnessHooks = `  window.__testSkyLighting = {
    attach(calendar) { deps = { calendar }; overcastLevel = 0; overcastInitialized = false; },
    sample: fullDayLightingState,
    cloudBucket: currentCloudBucket,
    advance: advanceOvercast,
  };`; // Uses original production functions; only the costly real scene hooks are bypassed.
const testWindow = { CalendarSystem: { getHour: () => testHour } }; // Supplies the same hour accessor used in game.
let testHour = 12; // Used by the calendar stub to compare the same midday across all weather states.
vm.runInNewContext(source.replace(initHooks, harnessHooks), {
  window: testWindow,
  Math, Number, Object, Uint8Array, Uint16Array, console, performance: { now: () => 0 },
}, { filename: 'sky-dome.js' });
const sky = testWindow.__testSkyLighting; // Exposes a deterministic hook into the actual overcast lighting math.
assert(sky, 'the harness should expose the live sky lighting functions');

function sample(weather, rainStrength, isRaining = rainStrength > 0) {
  const calendar = { weather, rainStrength, isRaining }; // Used to simulate the canonical rain strength and forecast fields.
  sky.attach(calendar);
  return sky.sample();
}
function brightness(state) {
  const tintLuminance = (0.2126 * state.r + 0.7152 * state.g + 0.0722 * state.b) / 255; // Weighted RGB reflectance of the screen-space tint.
  return 1 - state.a * (1 - tintLuminance);
}

const clear = sample('clear', 0); // Clear noon is the baseline for every darkness comparison.
const light = sample('rain', 1); // Light precipitation must visibly darken even without a storm.
const heavy = sample('rain', 2); // The nonlinear curve makes heavy rain substantially gloomier.
const storm = sample('storm', 3); // Peak weather must approach the look of nighttime.
assert.equal(clear.overcastDarkness, 0, 'clear daytime weather must retain its original lighting');
assert(light.weatherDarknessAddedAlpha > 0.15, 'even light rain should add meaningful darkness');
assert(heavy.weatherDarknessAddedAlpha > light.weatherDarknessAddedAlpha * 2, 'heavier rain must darken steeply');
assert(storm.weatherDarknessAddedAlpha > heavy.weatherDarknessAddedAlpha + 0.2, 'storms must have a dramatic final step');
assert(brightness(light) < brightness(clear) - 0.08, 'light rain visibly dims the scene');
assert(brightness(heavy) < brightness(light) - 0.18, 'heavy rain creates a distinctly dark atmosphere');
assert(brightness(storm) < brightness(heavy) - 0.2, 'storm light is markedly darker than ordinary rain');
assert(brightness(storm) < 0.45, 'daytime storms approach nighttime brightness');
assert(storm.lanternActivation >= light.lanternActivation, 'higher rain darkness must not suppress lanterns');
assert(storm.a <= 0.86, 'the outdoor overlay remains within its original alpha safety ceiling');

const rainyForecast = sample('rain', 0, false); // Cloudy gaps in the daily rain forecast retain the same sky policy.
const stormForecast = sample('storm', 0, false); // A storm forecast should be gloomy but cannot simulate peak precipitation all day.
const stormAfterDownpour = sample('storm', 2, true); // The scheduled second storm window is heavy rain, not a lightning-intensity downpour.
const staleDryStrength = sample('clear', 3, false); // Saved rainStrength data must not darken a sky while precipitation is inactive.
assert(rainyForecast.weatherDarknessAddedAlpha > 0, 'rain forecast cloud cover remains overcast between showers');
sky.attach({ weather: 'storm', isRaining: false, rainStrength: 0 });
const dryStormBucket = sky.cloudBucket(); // Original all-day storm atlas should be reused before, during, and after the actual downpour.
sky.attach({ weather: 'storm', isRaining: true, rainStrength: 3 });
assert.equal(sky.cloudBucket(), dryStormBucket, 'storms cannot trigger extra cloud-atlas rebuilds at rain window boundaries');
sky.attach({ weather: 'storm', isRaining: true, rainStrength: 2 });
assert.equal(sky.cloudBucket(), dryStormBucket, 'heavy evening rain must reuse the same storm cloud atlas');
sky.attach({ weather: 'rain', isRaining: false, rainStrength: 0 });
const dryRainBucket = sky.cloudBucket(); // Ordinary rainy days should also retain their preexisting atlas bucket.
sky.attach({ weather: 'rain', isRaining: true, rainStrength: 2 });
assert.equal(sky.cloudBucket(), dryRainBucket, 'regular showers must not repeatedly rebuild the large cloud atlas');
assert(stormForecast.a > rainyForecast.a && stormForecast.a < storm.a,
  'a dry interval on a storm day is heavily overcast but not full-storm dark');
assert(Math.abs(stormForecast.a - heavy.a) < 1e-12,
  'storm forecast without active rainfall uses heavy-cloud rather than maximum darkness');
assert(Math.abs(stormAfterDownpour.a - heavy.a) < 1e-12,
  'the storm forecast must not override its actual rain strength of two');
assert.equal(staleDryStrength.a, clear.a, 'a dry clear-weather frame must ignore stale precipitation strength');

testHour = 2;
const nightClear = sample('clear', 0); // Full-night baseline must still be dark with no rain.
const nightStorm = sample('storm', 3); // Storms at night must retain the existing weaker night influence.
assert(nightStorm.a >= nightClear.a && nightStorm.a <= 0.86, 'night weather stays capped instead of stacking unlimited darkness');
assert(nightStorm.weatherDarknessAddedAlpha < storm.weatherDarknessAddedAlpha * 0.5,
  'the existing nighttime reduction still prevents full daytime storm darkness stacking at night');
assert(Math.abs(nightStorm.weatherDarknessAddedAlpha - (nightStorm.a - nightClear.a)) < 1e-12,
  'mobile weather diagnostics must report the applied darkness after nighttime clamping');

testHour = 12;
const mutableCalendar = { weather: 'clear', rainStrength: 0, isRaining: false }; // Reused during the transition test to mimic live weather changes.
sky.attach(mutableCalendar);
const initial = sky.sample().a;
Object.assign(mutableCalendar, { weather: 'storm', rainStrength: 3, isRaining: true });
assert.equal(sky.sample().a, initial, 'a weather change must not jump before the overcast animation advances');
sky.advance(1.5);
const midTransition = sky.sample().a;
assert(midTransition > initial && midTransition < storm.a, 'storm darkening must ease rather than snap');
sky.advance(60);
assert(Math.abs(sky.sample().a - storm.a) < 0.001, 'the overcast transition must settle on its full storm value');
Object.assign(mutableCalendar, { weather: 'storm', rainStrength: 0, isRaining: false });
sky.advance(1.5);
assert(sky.sample().a < storm.a && sky.sample().a > stormForecast.a,
  'a storm stopping should brighten smoothly toward its heavy-cloud forecast, not jump to clear');
sky.advance(60);
assert(Math.abs(sky.sample().a - stormForecast.a) < 0.001,
  'dry intervals on a storm day settle on the heavy-cloud brightness');
Object.assign(mutableCalendar, { weather: 'clear', rainStrength: 0, isRaining: false });
sky.advance(1.5);
assert(sky.sample().a < stormForecast.a && sky.sample().a > clear.a,
  'clearing storm clouds restore normal daylight smoothly');

console.log('Rain and storm ambient darkness curve regression passed.');
