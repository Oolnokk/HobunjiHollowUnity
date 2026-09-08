'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/prologue-rescue-zone-compat.js', 'utf8'); // Runtime under test: delayed rescue layout expansion + EXTERIOR_ZONES classification.
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

const rescueLayout = { id: 'map_prologue_rescue', cols: 25, rows: 25, tiles: [] }; // Simulates the compact indexed JSON descriptor after _loadTownFromWorkspace has accepted it.
zoneLayouts.set('map_prologue_rescue', rescueLayout);
assert.equal(windowObject.PrologueRescueZoneCompat.prepareZoneTransport(), true, 'transport becomes ready immediately after the authored layout appears');
assert.equal(rescueLayout.cols, 25);
assert.equal(rescueLayout.rows, 25);
assert.equal(rescueLayout.tiles.length, 625, 'compact descriptor expands to every tile in the 25x25 map before buildZoneScene');
const tileByKey = new Map(rescueLayout.tiles.map(tile => [`${tile.c},${tile.r}`, tile])); // Used to validate the generated 2.5x-scaled topology independent of array order.
let grassCount = 0; // Counts the exact 15x15 central walkable area.
let shrubCount = 0; // Counts the five-tile-deep vegetation frame around that clearing.
let copseCount = 0; // Counts outermost tiles that will receive Shadewood boundary trees.
for (let row = 0; row < 25; row++) {
  for (let col = 0; col < 25; col++) {
    const tile = tileByKey.get(`${col},${row}`); // Reads the generated tile at this exact enlarged-map coordinate.
    assert.ok(tile, `generated rescue tile ${col},${row} must exist`);
    const inWalkable = col >= 5 && col <= 19 && row >= 5 && row <= 19; // Defines the centered 15x15 clearing scaled from the former 6x6 center.
    const outermost = col === 0 || row === 0 || col === 24 || row === 24; // Defines the enlarged map's Shadewood anchor perimeter.
    if (inWalkable) {
      assert.equal(tile.type, 'grass', `walkable ${col},${row} must be grass`);
      grassCount++;
    } else {
      assert.equal(tile.type, 'shrub', `boundary ${col},${row} must remain blocked vegetation`);
      shrubCount++;
    }
    if (outermost) {
      assert.equal(tile.floraKind, 'copse', `outermost ${col},${row} must request Shadewood/copse treatment`);
      copseCount++;
    }
  }
}
assert.equal(grassCount, 225, 'walkable rescue clearing is exactly 15x15');
assert.equal(shrubCount, 400, 'five-tile vegetation frame surrounds the enlarged clearing');
assert.equal(copseCount, 96, 'outermost 25x25 perimeter contains 96 Shadewood tree anchors');
assert.equal(rescueLayout.prologueRescue.walkableRect.c, 5);
assert.equal(rescueLayout.prologueRescue.walkableRect.r, 5);
assert.equal(rescueLayout.prologueRescue.walkableRect.w, 15);
assert.equal(rescueLayout.prologueRescue.walkableRect.h, 15);

const rescueZone = exteriorZones.map_prologue_rescue; // Session-only zone profile produced after the safe ordering barrier.
assert.ok(rescueZone, 'rescue must be present in the live EXTERIOR_ZONES registry');
assert.equal(rescueZone.cols, 25);
assert.equal(rescueZone.rows, 25);
assert.equal(rescueZone.entryCol, 12);
assert.equal(rescueZone.entryRow, 12);
assert.equal(rescueZone.fogDensity, exteriorZones.map_southern_cloud_forest.fogDensity, 'Cloud Forest biome profile must be inherited');
assert.equal(Array.isArray(rescueZone.packSpecies) && rescueZone.packSpecies.length === 0, true, 'prologue clearing must not inherit ordinary Cloud Forest pack spawns');
assert.equal(Array.isArray(rescueZone.herbivoreSpecies) && rescueZone.herbivoreSpecies.length === 0, true, 'prologue clearing must not inherit ordinary Cloud Forest herbivore spawns');
const snapshot = windowObject.PrologueRescueZoneCompat.debugSnapshot(); // Used to confirm mobile diagnostics expose the enlarged layout state.
assert.equal(snapshot.authoredLayoutPresent, true);
assert.equal(snapshot.authoredLayoutSize, '25x25');
assert.equal(snapshot.authoredTileCount, 625);
assert.equal(snapshot.layoutNormalized, true);
assert.equal(snapshot.rescueZoneRegistered, true);

const mapLoaderIndex = loaderSource.indexOf('prologue-rescue-map-runtime.js'); // Must inject the authored map before compatibility classification is even possible.
const compatLoaderIndex = loaderSource.indexOf('prologue-rescue-zone-compat.js'); // Must capture GridTileAccessors before game.js initializes it.
const controllerLoaderIndex = loaderSource.indexOf('prologue-system.js'); // Normal prologue controller should run only after transport compatibility is installed.
const backstopLoaderIndex = loaderSource.indexOf('prologue-startup-entry-bridge.js'); // Retry backstop also consumes the now-valid normal zone path.
assert.ok(mapLoaderIndex >= 0 && compatLoaderIndex > mapLoaderIndex, 'rescue map adapter must load before rescue zone compatibility');
assert.ok(controllerLoaderIndex > compatLoaderIndex, 'rescue zone compatibility must load before PrologueSystem');
assert.ok(backstopLoaderIndex > controllerLoaderIndex, 'startup retry bridge must remain after the normal prologue controller');

console.log('prologue rescue zone compatibility regression passed');
