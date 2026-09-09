'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const config = JSON.parse(read('docs/config/harlyao-night-march.json'));
const beaconSource = read('docs/js/harlyao-night-march-beacon.js');
const runtimeSource = read('docs/js/harlyao-night-march-runtime.js');
const loaderSource = read('docs/js/house-pieces.js');
const rootTotemConfigSource = read('docs/config/root-totem-config.js');

function rgb(hex) {
  const value = Number.parseInt(String(hex).replace('#', ''), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

assert(config.visuals.beaconGlowRadiusTiles >= 20, 'army locator keeps a substantial world-space radius nearby');
assert(config.visuals.beaconGlowRadiusTiles > config.visuals.formationGlowRadiusTiles, 'distant beacon radius must exceed the close formation halo');
assert(config.visuals.beaconGlowIntensity >= 0.9 && config.visuals.beaconGlowIntensity <= 1, 'locator is deliberately strong enough to find');
assert.equal(config.visuals.beaconShape, 'serpentine', 'army locator uses the requested irregular snake-like silhouette');
assert(config.visuals.beaconMinScreenRadiusPx >= 96, 'distance cannot shrink the locator below a large, clearly visible on-screen footprint');
assert(config.visuals.beaconMaxScreenRadiusPx >= 200, 'nearby locator may grow large enough to remain unmistakable without becoming unbounded');
assert(config.visuals.beaconMaxScreenRadiusPx >= config.visuals.beaconMinScreenRadiusPx, 'screen locator radius clamp remains valid');
assert(config.visuals.beaconEdgeMarginPx >= 24, 'off-screen locator stays visibly inset from the viewport edge');
assert.equal(config.visuals.beaconGlowColor.toLowerCase(), '#b0f0ff', 'army locator uses the authored pale icy-aqua Harlyao ghost shade');

const rootColorMatch = rootTotemConfigSource.match(/colors:\s*\{\s*liquid:\s*'([^']+)'/);
assert(rootColorMatch, 'Root Totem liquid/glow color should remain authored in root-totem-config');
const rootColor = rgb(rootColorMatch[1]);
const beaconColor = rgb(config.visuals.beaconGlowColor);
const bodyColor = rgb(config.visuals.color);
const rootDistance = Math.hypot(beaconColor.r - rootColor.r, beaconColor.g - rootColor.g, beaconColor.b - rootColor.b);
const bodyDistance = Math.hypot(beaconColor.r - bodyColor.r, beaconColor.g - bodyColor.g, beaconColor.b - bodyColor.b);
assert(rootDistance >= 70, 'Harlyao locator shade must remain visually distinct from Root Totem mint-blue-green');
assert(bodyDistance <= 140, 'locator should remain in the same broad spectral family as the Harlyao ghost body rather than becoming an unrelated color');
assert(beaconColor.g >= 230 && beaconColor.b >= 245 && beaconColor.b > beaconColor.g, 'locator stays a pale icy aqua/cyan rather than Root Totem green-mint');
assert.notEqual(config.visuals.beaconGlowColor.toLowerCase(), config.visuals.color.toLowerCase(), 'locator gets a unique colder ghost shade while ordinary Harlyao ghosts keep their authored teal');

assert.match(beaconSource, /window\.HarlyaoNightMarch\?\.debugSnapshot/, 'beacon reads existing hourly/live route state instead of simulating a second army');
assert.match(beaconSource, /march\?\.visible && march\?\.liveChunk \? march\.liveChunk : scheduled\?\.chunk/, 'visible locator follows the physical army while hidden locator follows its scheduled effective chunk');
assert.match(beaconSource, /currentArea === zoneId/, 'locator only renders in the army\'s active wilderness zone');
assert.match(beaconSource, /SNAKE_LOBES/, 'locator is assembled from multiple irregular overlapping lobes instead of a circular light');
assert.match(beaconSource, /beaconMinScreenRadiusPx/, 'locator has an authored fixed minimum apparent radius');
assert.match(beaconSource, /clampOffscreenPoint/, 'off-screen army location is clamped to a visible viewport-edge cue');
assert.match(beaconSource, /projected\?\.visible/, 'on-screen world projection is preserved when the army is actually in view');
assert.match(beaconSource, /globalCompositeOperation = 'screen'/, 'serpentine locator paints a visible spectral bloom above the darkness overlay');
assert.match(beaconSource, /globalCompositeOperation = 'destination-out'/, 'serpentine locator also punches through darkness like a supernatural light source');
assert.match(beaconSource, /redrawn = true/, 'locator draws only after a real lighting-overlay redraw instead of accumulating every game frame');
assert.match(beaconSource, /LOCATOR_REFRESH_MS = 100/, 'locator work stays on the low-frequency lighting cadence');
assert.doesNotMatch(beaconSource, /registerGlowSource/, 'all-distance locator no longer depends on Ghostify world-light frustum visibility');
assert.doesNotMatch(beaconSource, /new THREE\.PointLight/, 'locator must not create a real Three.js light');
assert.doesNotMatch(beaconSource, /makeEntity\(/, 'beacon module itself must never materialize soldier entities');
assert.doesNotMatch(beaconSource, /moveCreatureToward/, 'beacon module itself has no pathfinding or movement simulation');
assert.match(runtimeSource, /if \(!sameChunk\(playerChunk\(\), chunk\)\) return;/, 'actual army entities remain absent until the player enters the same chunk as the locator');
assert.match(runtimeSource, /else materialize\(s, chunk\)/, 'crossing into the locator chunk still triggers normal army materialization');

assert.match(loaderSource, /\['HarlyaoNightMarchBeacon', 'harlyao-night-march-beacon\.js\?v=[^']+'\]/, 'persistent locator adapter loads in gameplay');
assert(loaderSource.indexOf("['Ghostify'") < loaderSource.indexOf("['HarlyaoNightMarchBeacon'"), 'Ghostify/lighting bridge exists before the locator adapter');
assert(loaderSource.indexOf("['HarlyaoNightMarch'") < loaderSource.indexOf("['HarlyaoNightMarchBeacon'"), 'march route state exists before the locator reads it');

new vm.Script(beaconSource, { filename: 'harlyao-night-march-beacon.js' });

const context = {
  console,
  performance: { now: () => 0 },
  fetch: async () => ({ ok: true, json: async () => config }),
  window: {
    WildernessChunks: { constants: { CHUNK_TILES: 16 } },
    BanditCombat: { init() {} },
    HarlyaoNightMarch: { debugSnapshot: () => null },
    setInterval: () => 0,
    clearInterval: () => {},
    __farmLog: () => {},
  },
};
vm.runInNewContext(beaconSource, context, { filename: 'harlyao-night-march-beacon.js' });
const testApi = context.window.HarlyaoNightMarchBeacon?.__test;
assert(testApi, 'beacon exposes pure geometry helpers for regression coverage');
assert.deepEqual(
  JSON.parse(JSON.stringify(testApi.chunkCenter({ cx: 0, cz: 0 }, 'map_northern_cliffs'))),
  { x: 7.5, z: 7.5, col: 7, row: 7 },
  'first chunk locator is centered on the exact 16x16 chunk the army materializes into',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(testApi.chunkCenter({ cx: 12, cz: 12 }, 'map_northern_cliffs'))),
  { x: 195.5, z: 195.5, col: 195, row: 195 },
  'partial final wilderness chunk clamps its locator to the real 200x200 map',
);
const edge = testApi.clampOffscreenPoint({ x: 900, y: 250, visible: false }, { width: 400, height: 300 }, 96);
assert(edge.edge, 'off-screen projected location is explicitly marked as an edge locator');
assert(edge.x < 400 && edge.x > 200, 'right-side off-screen army produces a visible right-edge cue');
assert(edge.y > 0 && edge.y < 300, 'edge locator stays within viewport height');

console.log('Harlyao night march beacon regression passed.');