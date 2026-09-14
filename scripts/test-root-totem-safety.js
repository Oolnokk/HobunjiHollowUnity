'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');
const parses = file => {
  const source = read(file); // Used by every syntax/source regression assertion below.
  assert.doesNotThrow(() => new vm.Script(source, { filename: file }));
  return source;
};

function grassWorkspace() {
  const cols = 60, rows = 60; // Used to give each one-per-quadrant Root Totem enough room for a 12-tile combat buffer.
  const tiles = {}; // Used by RootTotemSafety's exported-map candidate scan.
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) tiles[`${col},${row}`] = { type: 'grass', elevTier: 0 };
  }
  return {
    maps: [{ id: 'map_test', cols, rows, tiles, buildings: [], transitions: [] }],
    rootTotems: [
      { id: 'unsafe', x: 12, y: 12, pathAnchor: { x: 13, y: 12 } },
      { id: 'safe', x: 45, y: 45, pathAnchor: { x: 46, y: 45 } },
    ],
    animalDens: [{ id: 'den', x: 15, y: 12, w: 3, h: 3, mouthAnchor: { x: 16, y: 15 } }],
    localeInstances: [],
  };
}

function distanceToRect(point, rect) {
  const nearestX = Math.max(rect.x, Math.min(point.x, rect.x + rect.w - 1)); // Used to verify the same footprint-distance rule as runtime safety placement.
  const nearestY = Math.max(rect.y, Math.min(point.y, rect.y + rect.h - 1)); // Used with nearestX for the den clearance assertion.
  return Math.hypot(point.x - nearestX, point.y - nearestY);
}

const safetySource = parses('docs/js/root-totem-safety.js');
const configSource = parses('docs/config/root-totem-config.js');
const gameSource = read('docs/game.js');
assert(configSource.includes('combatPoiClearanceTiles:12'), 'Root Totem combat clearance must stay centrally tuned.');
assert(configSource.includes("../js/root-totem-safety.js"), 'Root Totem config must synchronously load the placement-safety companion.');

// Wilderness Root Totem revives already own the requested half-health behavior;
// lock it down here so later respawn refactors cannot silently restore full HP.
const rootToastAt = gameSource.indexOf("showToast('You awaken at the nearest Root Totem...'"); // Locates the wilderness checkpoint branch, not farm/farmhouse fallbacks.
assert(rootToastAt >= 0, 'Wilderness Root Totem respawn branch must exist.');
const halfHealthAt = gameSource.lastIndexOf('player.health = Math.round(player.maxHealth * 0.5);', rootToastAt); // Must occur immediately before the Root Totem wake toast.
assert(halfHealthAt >= 0 && rootToastAt - halfHealthAt < 500, 'Wilderness Root Totem revive must restore exactly half max health.');

let capturedStamp = null; // Receives the final TemporaryLocales options so the injected Root Totem avoidance can be asserted.
const window = {
  HOBUNJI_ROOT_TOTEM_CONFIG: { placement: { combatPoiClearanceTiles: 12 } },
  WildernessMapGenerator: {
    generateWorkspace() { return grassWorkspace(); },
    generateZoneWorkspace() { return grassWorkspace(); },
    zoneMapIds() { return ['map_test']; },
  },
  TemporaryLocales: {
    stamp(zone, locale, opts) { capturedStamp = { zone, locale, opts }; return { ok: true }; },
  },
};
window.window = window;
const context = vm.createContext({ window, console, globalThis: window }); // Browser-shaped sandbox used to exercise the actual adapter code.
new vm.Script(safetySource, { filename: 'docs/js/root-totem-safety.js' }).runInContext(context);

const workspace = window.WildernessMapGenerator.generateZoneWorkspace('map_test', 'seed', []); // Runs the installed generator wrapper and static den avoidance.
const moved = workspace.rootTotems[0]; // Unsafe first-quadrant checkpoint should be relocated, while the safe opposite-quadrant one remains untouched.
assert(moved.x < 30 && moved.y < 30, 'Relocated Root Totem must stay in its original quadrant.');
assert(distanceToRect(moved, workspace.animalDens[0]) >= 12, 'Root Totem tile must keep the configured distance from the den footprint.');
assert(distanceToRect(moved.pathAnchor, workspace.animalDens[0]) >= 12, 'Actual revive pathAnchor must keep the same den clearance.');
assert.deepStrictEqual(JSON.parse(JSON.stringify(workspace.rootTotems[1])), { id: 'safe', x: 45, y: 45, pathAnchor: { x: 46, y: 45 } }, 'Already-safe Root Totems should not move.');

const zoneTiles = Array.from({ length: 60 }, () => Array.from({ length: 60 }, () => ({ occupiedBy: null }))); // Mimics BanditCamps/PorakanekiCamps' copied TemporaryLocales zone view.
for (const totem of workspace.rootTotems) zoneTiles[totem.y][totem.x].occupiedBy = 'root-totem-blocker';
const zone = { cols: 60, rows: 60, tiles: zoneTiles }; // Matched back to map_test by Root Totem blocker occupancy.
window.TemporaryLocales.stamp(
  zone,
  { id: 'bandit', category: 'bandit_camp', tags: ['hostile'], placement: {} },
  { avoidPoints: [{ col: 2, row: 2, minDistance: 3 }] },
);
assert(capturedStamp.opts.avoidPoints.some(point => point.col === moved.x && point.row === moved.y && point.minDistance === 12), 'Bandit camp placement must inherit Root Totem keep-away points.');
assert(capturedStamp.opts.avoidPoints.some(point => point.col === 2 && point.row === 2 && point.minDistance === 3), 'Existing temporary-locale avoidance rules must be preserved.');

window.TemporaryLocales.stamp(
  zone,
  { id: 'house', category: 'dwelling', tags: [], placement: {} },
  { avoidPoints: [{ col: 2, row: 2, minDistance: 3 }] },
);
assert.strictEqual(capturedStamp.opts.avoidPoints.length, 1, 'Non-combat temporary locales must not be pushed away from Root Totems.');

const debug = window.RootTotemSafety.debugSnapshot(); // Mobile-friendly diagnostic state should expose what the adapter actually did.
assert.strictEqual(debug.totemsMoved, 1);
assert.strictEqual(debug.temporaryCombatSitesProtected, 1);
assert.strictEqual(debug.configuredClearanceTiles, 12);

console.log('root-totem revive/safety regression checks: PASS');
