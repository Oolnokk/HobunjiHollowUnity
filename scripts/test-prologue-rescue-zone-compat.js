'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/prologue-rescue-zone-compat.js', 'utf8'); // Runtime under test: delayed rescue EXTERIOR_ZONES classification.
const loaderSource = fs.readFileSync('docs/js/character-action-locks.js', 'utf8'); // Parser-time loader whose ordering must keep map injection ahead of classification/transport.
const timers = []; // Captures retry scheduling without letting a headless test spin indefinitely.
const logs = []; // Captures mobile-visible diagnostics for assertions/debugging on CI failures.
let playerReadyHandler = null; // Receives the runtime's owner-ready listener so the test can simulate a real world selection.
let originalGridInitDeps = null; // Verifies the compatibility wrapper preserves GridTileAccessors.init behavior.
const zoneLayouts = new Map(); // Simulates game.js's private authored/generated zone layout registry.
const exteriorZones = {
  map_southern_cloud_forest: {
    name: 'Southern Cloud Forest',
    cols: 50,
    rows: 50,
    entryCol: 25,
    entryRow: 49,
    fogDensity: 0.055,
    vegCullRadiusTiles: 34,
    packSpecies: ['dabinggi-hound'],
    herbivoreSpecies: ['test-herbivore'],
  },
}; // Simulates the exact mutable EXTERIOR_ZONES object shared by game.js helpers.

const windowObject = {
  GridTileAccessors: {
    init(deps) { originalGridInitDeps = deps; },
  },
  __farmLog(message, level) { logs.push({ message, level }); },
  dispatchEvent() {},
}; // Supplies only the browser globals used by the compatibility adapter.

const context = {
  window: windowObject,
  document: {
    addEventListener(type, handler) {
      if (type === 'hobunjiPlayerReady') playerReadyHandler = handler;
    },
  },
  localStorage: {
    getItem(key) {
      if (key !== 'hobunjiSaveMeta') return null;
      return JSON.stringify({
        worlds: [{ id: 'world-test', prologue: { stage: 'rescue', completed: false } }],
      });
    },
  },
  console,
  CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init?.detail; },
  setTimeout(callback, delay) {
    timers.push({ callback, delay });
    return timers.length;
  },
  clearTimeout() {},
}; // Headless VM context used to exercise the real browser module without game.js.
context.window.window = context.window;
context.window.__hobunjiPlayerProfile = null;

vm.runInNewContext(source, context, { filename: 'prologue-rescue-zone-compat.js' });
assert.equal(typeof windowObject.PrologueRescueZoneCompat?.prepareZoneTransport, 'function', 'compat debug/control API must be exported');
assert.equal(typeof playerReadyHandler, 'function', 'owner-ready listener must be installed');

const injectedDeps = { _zoneLayouts: zoneLayouts, EXTERIOR_ZONES: exteriorZones }; // Mirrors the two private references needed from the real GridTileAccessors.init bundle.
windowObject.GridTileAccessors.init(injectedDeps);
assert.equal(originalGridInitDeps, injectedDeps, 'GridTileAccessors.init must still receive the original dependency object');
assert.equal(exteriorZones.map_prologue_rescue, undefined, 'rescue must NOT become EXTERIOR_ZONES before its authored layout exists');

const player = { worldId: 'world-test', characterId: 'character-test', isWorldOwner: true, isNewWorld: false }; // Simulates re-entering an unfinished owner rescue.
windowObject.__hobunjiPlayerProfile = player;
playerReadyHandler({ detail: player });
assert.equal(windowObject.PrologueRescueZoneCompat.prepareZoneTransport(), false, 'transport must remain gated while the authored layout is absent');
assert.equal(windowObject.PrologueRescueZoneCompat.debugSnapshot().lastStatus, 'waiting-authored-layout');
assert.equal(exteriorZones.map_prologue_rescue, undefined, 'failed readiness checks must not poison workspace loading by classifying early');

zoneLayouts.set('map_prologue_rescue', { id: 'map_prologue_rescue', cols: 10, rows: 10 });
assert.equal(windowObject.PrologueRescueZoneCompat.prepareZoneTransport(), true, 'transport becomes ready immediately after the authored layout appears');
const rescueZone = exteriorZones.map_prologue_rescue; // Session-only zone profile produced after the safe ordering barrier.
assert.ok(rescueZone, 'rescue must be present in the live EXTERIOR_ZONES registry');
assert.equal(rescueZone.cols, 10);
assert.equal(rescueZone.rows, 10);
assert.equal(rescueZone.entryCol, 4);
assert.equal(rescueZone.entryRow, 4);
assert.equal(rescueZone.fogDensity, exteriorZones.map_southern_cloud_forest.fogDensity, 'Cloud Forest biome profile must be inherited');
assert.deepEqual(rescueZone.packSpecies, [], 'prologue clearing must not inherit ordinary Cloud Forest pack spawns');
assert.deepEqual(rescueZone.herbivoreSpecies, [], 'prologue clearing must not inherit ordinary Cloud Forest herbivore spawns');
assert.equal(windowObject.PrologueRescueZoneCompat.debugSnapshot().authoredLayoutPresent, true);
assert.equal(windowObject.PrologueRescueZoneCompat.debugSnapshot().rescueZoneRegistered, true);

const mapLoaderIndex = loaderSource.indexOf('prologue-rescue-map-runtime.js'); // Must inject the authored map before compatibility classification is even possible.
const compatLoaderIndex = loaderSource.indexOf('prologue-rescue-zone-compat.js'); // Must capture GridTileAccessors before game.js initializes it.
const controllerLoaderIndex = loaderSource.indexOf('prologue-system.js'); // Normal prologue controller should run only after transport compatibility is installed.
const backstopLoaderIndex = loaderSource.indexOf('prologue-startup-entry-bridge.js'); // Retry backstop also consumes the now-valid normal zone path.
assert.ok(mapLoaderIndex >= 0 && compatLoaderIndex > mapLoaderIndex, 'rescue map adapter must load before rescue zone compatibility');
assert.ok(controllerLoaderIndex > compatLoaderIndex, 'rescue zone compatibility must load before PrologueSystem');
assert.ok(backstopLoaderIndex > controllerLoaderIndex, 'startup retry bridge must remain after the normal prologue controller');

console.log('prologue rescue zone compatibility regression passed');
