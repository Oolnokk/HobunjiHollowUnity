'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..'); // Repository root used for all production-file assertions below.
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const config = JSON.parse(read('docs/config/harlyao-night-march.json')); // Authored nightly route/equipment/visual contract under test.
const runtimeSource = read('docs/js/harlyao-night-march-runtime.js'); // Corrected controller that owns hourly chunk-only simulation and observed marching.
const ghostifySource = read('docs/js/ghostify.js'); // Shared spectral material/darkness-lighting helper used by Harlyao.
const probeSource = read('docs/js/harlyao-night-march-pixel-probe.js'); // Mobile report adapter that exposes route/visibility/provocation without console access.
const loaderSource = read('docs/js/house-pieces.js'); // Parser-time bootstrap currently responsible for loading all Harlyao march support modules.
const species = JSON.parse(read('docs/config/species/harlyao.json')); // Confirms the forced army clothing is legal for either Harlyao gender.

assert.equal(config.memberCount, 20, 'the travelling army should contain about twenty Harlyao');
assert.deepEqual(
  config.routesClockwise.map(route => [route.zoneId, route.axis, route.direction]),
  [
    ['map_northern_cliffs', 'x', 1],
    ['map_eastern_mire', 'z', 1],
    ['map_southern_cloud_forest', 'x', -1],
    ['map_western_slope', 'z', -1],
  ],
  'daily wilderness cycle must be north W→E, east N→S, south E→W, west S→N',
);
assert.deepEqual(config.equipment.forcedCosmetics, ['rugged_poncho'], 'every marcher wears the rugged poncho');
assert.deepEqual(config.equipment.weaponShapes, ['daggerSword', 'hatchet', 'fishingspear'], 'army weapon pool is dagger-sword, hatchet, or fishing spear only');
assert.equal(config.activeHours.start, 0, 'march starts at civil midnight');
assert.equal(config.activeHours.end, 6, 'march disappears at 06:00');
assert.equal(config.activeHours.coarseStepHours, 1, 'offscreen route state advances only once per game hour');
assert.equal(config.visuals.color.toLowerCase(), '#4fd9c6', 'spectral fill stays blue-green');
assert(config.visuals.opacity > 0 && config.visuals.opacity < 1, 'spectral body remains semi-transparent');
assert(config.visuals.emissiveIntensity > 0, 'spectral body emits light visually');

for (const gender of ['male', 'female']) {
  assert(species[gender].allowedCosmetics.includes('rugged_poncho'), `${gender} Harlyao must allow the army's rugged poncho`);
}

assert.match(loaderSource, /\['Ghostify', 'ghostify\.js\?v=[^']+'\]/, 'Ghostify loads before the night march');
assert.match(loaderSource, /\['HarlyaoNightMarch', 'harlyao-night-march-runtime\.js\?v=[^']+'\]/, 'corrected Harlyao controller is the one loaded by gameplay');
assert.match(loaderSource, /\['HarlyaoNightMarchPixelProbe', 'harlyao-night-march-pixel-probe\.js\?v=[^']+'\]/, 'mobile Pixel Probe bridge loads with the march runtime');
assert.doesNotMatch(loaderSource, /harlyao-night-march\.js\?v=/, 'superseded first-pass controller must not remain in the loader');
assert(loaderSource.indexOf("['Ghostify'") < loaderSource.indexOf("['HarlyaoNightMarch'"), 'Ghostify must load before HarlyaoNightMarch registers its formation glow');
assert(loaderSource.indexOf("['HarlyaoNightMarch'") < loaderSource.indexOf("['HarlyaoNightMarchPixelProbe'"), 'march state must exist before its Pixel Probe adapter loads');

assert.match(runtimeSource, /const hour = Math\.floor\(gameHour\(\)\)/, 'offscreen schedule keys use whole game-hours only');
assert.match(runtimeSource, /const key = `\$\{day\}:\$\{hour\}`/, 'civil day + whole hour is the coarse simulation cache key');
assert.match(runtimeSource, /if \(!sameChunk\(playerChunk\(\), chunk\)\) return;/, 'hidden army does no entity work unless player shares its cached chunk');
assert.match(runtimeSource, /deps\.moveCreatureToward\?\.\(/, 'observed formation physically paths toward its next chunk');
assert.match(runtimeSource, /detectHit\(\)/, 'visible formation checks for player provocation');
assert.match(runtimeSource, /state\.provoked = true/, 'provoking one marcher promotes the whole formation to combat state');
assert.match(runtimeSource, /Math\.max\(MIN_MARCH_SPEED_TILES_S, Number\(cfg\?\.formation\?\.marchSpeedTilesPerSecond\) \|\| 1\.15\)/, 'observed march speed keeps the authored 1.15 tiles/s instead of an accidental high minimum');

assert.match(ghostifySource, /pixels\.data\[i \+ 3\]/, 'Ghostify preserves source alpha while replacing visible RGB');
assert.match(ghostifySource, /new THREE\.CanvasTexture\(canvas\)/, 'Ghostify builds an alpha-preserving recolored texture');
assert.match(ghostifySource, /material\.transparent = true/, 'Ghostify materials are explicitly transparent');
assert.match(ghostifySource, /material\.emissive\.copy\(color\)/, 'lit materials receive the spectral emissive color');
assert.match(ghostifySource, /registerGlowSource/, 'Ghostify exposes reusable formation/object glow registration');
assert.match(ghostifySource, /destination-out/, 'spectral glow clears the existing darkness overlay like lanterns do');
assert.doesNotMatch(ghostifySource, /new THREE\.PointLight/, 'twenty ghosts must not become twenty real Three.js lights');

assert.match(probeSource, /debugProbeResult/, 'march diagnostics append to the existing copyable Pixel Probe result surface');
assert.match(probeSource, /window\.HarlyaoNightMarch/, 'Pixel Probe adapter reads the controller instead of reimplementing march state');
assert.match(probeSource, /debugSnapshot\?\.\(\)/, 'Pixel Probe line comes from the structured runtime snapshot');
assert.match(probeSource, /MutationObserver/, 'Pixel Probe adapter follows asynchronous report publication on mobile');
assert.match(probeSource, /scheduled=.*playerChunk=.*liveChunk=.*members=.*visible=.*provoked=.*reason=/, 'copied line carries route, chunk, LOD, population, hostility, and lifecycle reason');

const context = {
  console,
  performance: { now: () => 0 },
  fetch: async () => ({ ok: true, json: async () => config }),
  window: {
    WildernessChunks: { constants: { CHUNK_TILES: 16 } },
    Ghostify: { registerGlowSource: () => () => {} },
    setInterval: () => 0,
    __farmLog: () => {},
  },
}; // Minimal browser-like host: pure route helpers are exposed before any actual game dependency is required.
vm.runInNewContext(runtimeSource, context, { filename: 'harlyao-night-march-runtime.js' });
const testApi = context.window.HarlyaoNightMarch?.__test;
assert(testApi, 'night march exposes pure route helpers for regression tests and mobile-safe diagnostics');

assert.equal(testApi.chunkCount(200), 13, '200 wilderness tiles span thirteen 16-tile simulation chunks');
assert.equal(testApi.routeForDay(1, config).zoneId, 'map_northern_cliffs');
assert.equal(testApi.routeForDay(2, config).zoneId, 'map_eastern_mire');
assert.equal(testApi.routeForDay(3, config).zoneId, 'map_southern_cloud_forest');
assert.equal(testApi.routeForDay(4, config).zoneId, 'map_western_slope');
assert.equal(testApi.routeForDay(5, config).zoneId, 'map_northern_cliffs', 'daily route repeats clockwise after western zone');

const expectedForward = [0, 2, 5, 7, 10, 12]; // Six hourly slots stretched over the current thirteen-chunk route axis.
const expectedReverse = [...expectedForward].reverse(); // Physical indices for east→west and south→north legs.
for (let hour = 0; hour < 6; hour++) {
  const north = testApi.coarseStateFor(1, hour, config, { cols: 200, rows: 200 });
  assert.equal(north.cx, expectedForward[hour], `Northern Cliffs hour ${hour} maps west→east across actual chunk count`);
  assert.equal(north.cz, 6, 'Northern Cliffs keeps one central north/south lane');

  const east = testApi.coarseStateFor(2, hour, config, { cols: 200, rows: 200 });
  assert.equal(east.cz, expectedForward[hour], `Eastern Mire hour ${hour} maps north→south across actual chunk count`);
  assert.equal(east.cx, 6, 'Eastern Mire keeps one central west/east lane');

  const south = testApi.coarseStateFor(3, hour, config, { cols: 200, rows: 200 });
  assert.equal(south.cx, expectedReverse[hour], `Southern Cloud Forest hour ${hour} maps east→west across actual chunk count`);
  assert.equal(south.cz, 6, 'Southern Cloud Forest keeps one central north/south lane');

  const west = testApi.coarseStateFor(4, hour, config, { cols: 200, rows: 200 });
  assert.equal(west.cz, expectedReverse[hour], `Western Slope hour ${hour} maps south→north across actual chunk count`);
  assert.equal(west.cx, 6, 'Western Slope keeps one central west/east lane');
}

assert.equal(testApi.coarseStateFor(1, 6, config, { cols: 200, rows: 200 }).active, false, '06:00 is outside the nightly presence window');
assert.equal(testApi.coarseStateFor(1, 23, config, { cols: 200, rows: 200 }).active, false, 'army does not appear before civil midnight');

const shortNorth = Array.from({ length: 6 }, (_, hour) => testApi.coarseStateFor(1, hour, config, { cols: 97, rows: 65 }).cx);
assert.deepEqual(shortNorth, [0, 1, 2, 4, 5, 6], 'hour mapping derives from the live route-axis chunk count rather than assuming thirteen chunks');

assert.equal(typeof context.window.HarlyaoNightMarch.debugSnapshot, 'function', 'mobile-accessible structured night-march diagnostics remain exposed');
assert.equal(typeof context.window.HarlyaoNightMarch.formatDebug, 'function', 'mobile-accessible copyable night-march diagnostics remain exposed');

console.log('Harlyao night march regression passed.');
