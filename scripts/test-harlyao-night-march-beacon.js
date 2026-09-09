'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..'); // Repository root used for all production-file assertions below.
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const config = JSON.parse(read('docs/config/harlyao-night-march.json')); // Authored beacon radius/intensity live beside the army's existing spectral tuning.
const beaconSource = read('docs/js/harlyao-night-march-beacon.js'); // One cheap distant glow provider that follows the controller's chunk state.
const runtimeSource = read('docs/js/harlyao-night-march-runtime.js'); // Confirms full humanoids still materialize only when the player reaches the beacon chunk.
const loaderSource = read('docs/js/house-pieces.js'); // Parser-time order must put the beacon after Ghostify + march state.

assert(config.visuals.beaconGlowRadiusTiles >= 20, 'distant army beacon should be substantially larger than the close formation glow');
assert(config.visuals.beaconGlowRadiusTiles > config.visuals.formationGlowRadiusTiles, 'distant beacon radius must exceed the individual-army formation halo');
assert(config.visuals.beaconGlowIntensity > 0 && config.visuals.beaconGlowIntensity <= 1, 'beacon intensity stays visible without invalid overlay alpha');

assert.match(beaconSource, /window\.HarlyaoNightMarch\?\.debugSnapshot/, 'beacon reads the existing hourly\/live route state instead of simulating a second army');
assert.match(beaconSource, /march\?\.visible && march\?\.liveChunk \? march\.liveChunk : scheduled\?\.chunk/, 'visible beacon follows the physical army while hidden beacon follows the scheduled effective chunk');
assert.match(beaconSource, /currentArea === zoneId/, 'beacon only renders while the player is actually inside the army\'s active wilderness zone');
assert.match(beaconSource, /window\.Ghostify\.registerGlowSource\(glowSource\)/, 'distant beacon reuses the existing cheap WeatherFX\/Ghostify light bridge');
assert.doesNotMatch(beaconSource, /new THREE\.PointLight/, 'distant beacon must not create a real Three.js light');
assert.doesNotMatch(beaconSource, /makeEntity\(/, 'beacon module itself must never materialize soldier entities');
assert.doesNotMatch(beaconSource, /moveCreatureToward/, 'beacon module itself must have no pathfinding or movement simulation');
assert.match(runtimeSource, /if \(!sameChunk\(playerChunk\(\), chunk\)\) return;/, 'actual army entities remain absent until the player enters the same chunk as the beacon');
assert.match(runtimeSource, /else materialize\(s, chunk\)/, 'crossing into the beacon chunk still triggers normal army materialization');

assert.match(loaderSource, /\['HarlyaoNightMarchBeacon', 'harlyao-night-march-beacon\.js\?v=[^']+'\]/, 'persistent beacon adapter loads in gameplay');
assert(loaderSource.indexOf("['Ghostify'") < loaderSource.indexOf("['HarlyaoNightMarchBeacon'"), 'Ghostify must exist before the beacon registers its glow provider');
assert(loaderSource.indexOf("['HarlyaoNightMarch'") < loaderSource.indexOf("['HarlyaoNightMarchBeacon'"), 'march route state must exist before the beacon reads it');

new vm.Script(beaconSource, { filename: 'harlyao-night-march-beacon.js' }); // Syntax-checks the browser adapter independently of runtime rendering.

const context = {
  console,
  fetch: async () => ({ ok: true, json: async () => config }),
  window: {
    WildernessChunks: { constants: { CHUNK_TILES: 16 } },
    BanditCombat: { init() {} },
    Ghostify: { registerGlowSource: () => () => {} },
    HarlyaoNightMarch: { debugSnapshot: () => null },
    setInterval: () => 0,
    __farmLog: () => {},
  },
}; // Minimal host used only to expose/test the pure chunk-center helper.
vm.runInNewContext(beaconSource, context, { filename: 'harlyao-night-march-beacon.js' });
const testApi = context.window.HarlyaoNightMarchBeacon?.__test;
assert(testApi, 'beacon exposes its pure chunk-center helper for regression coverage');
assert.deepEqual(
  JSON.parse(JSON.stringify(testApi.chunkCenter({ cx: 0, cz: 0 }, 'map_northern_cliffs'))),
  { x: 7.5, z: 7.5, col: 7, row: 7 },
  'first chunk beacon is centered on the exact 16x16 chunk the army materializes into',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(testApi.chunkCenter({ cx: 12, cz: 12 }, 'map_northern_cliffs'))),
  { x: 195.5, z: 195.5, col: 195, row: 195 },
  'partial final wilderness chunk clamps its beacon to the real 200x200 map rather than placing it beyond the edge',
);

console.log('Harlyao night march beacon regression passed.');
