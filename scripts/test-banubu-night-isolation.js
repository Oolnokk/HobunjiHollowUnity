#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const placement = require('../docs/js/locale-terrain-placement.js');

const root = { id: 'root', cols: 32, rows: 12, tiles: {}, generatedFrom: { seed: 'banubu-remote-test', note: 'Flattened after 1x tile-density expansion.' } }; // Two-dimensional legal site grid for the remote-placement test.
for (let row = 0; row < root.rows; row++) {
  for (let col = 0; col < root.cols; col++) {
    root.tiles[`${col},${row}`] = { type: 'grass', crop: '', ...(col > 27 && row > 8 ? { generatedObjectType: 'shrub' } : {}) };
  }
}
const workspace = {
  maps: [root], localeInstances: [{ localeId: 'locale_researchers_tent', name: "Garanki's Tent", x: 2, y: 8 }],
  entry: { col: 0, row: 5 }, objects: [],
}; // Researcher tent and entry must push Banubu toward the opposite side of this test map.
const cave = {
  id: 'locale_banubu_shrine', name: "Banubu's Cave", category: 'great_fey_shrine',
  tiles: { '0,0': { type: 'grass' } },
  terrainAnchors: { '0,0': { terrain: 'free', strength: 'required', facing: 'any', height: { mode: 'any' } } },
  connectors: [{ col: 0, row: 0, side: 'north' }],
  objects: [{ id: 'cave', key: 'cave_small', kind: 'structure', col: 0, row: 0, w: 1, h: 1 }],
  placement: { preferIsolation: true, placeLast: true, clearanceTiles: 0, requiresFlatGround: false },
}; // Simple one-tile locale isolates site ranking from Banubu's separately-tested authored cliff probes.
placement.placeTerrainAwareLocales(workspace, [cave], { seed: 'banubu-remote-test', scale: 1 });
const selected = workspace.localeTerrainDiagnostics[0]?.selected;
assert(selected, 'a valid remote site must be selected');
assert(selected.anchorC >= 27, 'site must maximize separation from the entry and Garanki before probe score');
assert(Number.isFinite(selected.isolation?.priorityDistance), 'placement diagnostics must retain the winning separation distance');
const campAvoid = placement.isolatedLocaleAvoidPoints({ ...workspace, cols: root.cols, rows: root.rows });
assert.strictEqual(campAvoid.length, 1, 'late camp systems must have a shared cave exclusion point');
assert.strictEqual(campAvoid[0].col, workspace.localeInstances.at(-1).connectors[0].x);
assert.strictEqual(campAvoid[0].row, workspace.localeInstances.at(-1).connectors[0].y);
assert(campAvoid[0].minDistance >= 16, 'late camps must stay at least one chunk away whenever legal');

const rendererContext = { window: {}, console }; // Browser-free renderer exposes the twilight opacity function without GLB loading.
vm.runInNewContext(fs.readFileSync('docs/js/zone-den-totem-features.js', 'utf8'), rendererContext);
const alpha = rendererContext.window.ZoneDenTotemFeatures.banubuCaveAlpha;
for (const [hour, expected] of [[0, 1], [5, 1], [6.5, 0.5], [8, 0], [12, 0], [17, 0], [18.5, 0.5], [20, 1], [23, 1]]) {
  assert(Math.abs(alpha(hour) - expected) < 1e-9, `incorrect Banubu visibility at ${hour}:00`);
}

const store = new Map([['hobunjiSaveMeta', JSON.stringify({ worlds: [{ id: 'test-world' }] })]]); // Mock persistent save metadata for map-discovery testing.
let area = 'map_northern_cliffs'; // The map stays undiscovered during outdoor proximity and becomes known only inside Banubu's interior.
const browser = {
  WildernessMapGenerator: { zoneMapIds: () => ['map_northern_cliffs'] },
  document: { getElementById: () => null },
  localStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value) },
  BountyBoard: { markers: new Map() },
  CaveSiteSystem: { sitesForZone: () => [] },
  BanditCamps: { perceivedThreats: new Map() },
};
browser.window = browser;
vm.runInNewContext(fs.readFileSync('docs/js/wilderness-map.js', 'utf8'), browser);
browser.WildernessMap.init({
  _zoneLayouts: new Map([['map_northern_cliffs', { localeInstances: [{ localeId: 'locale_banubu_shrine', name: "Banubu's Cave", x: 28, y: 21, alwaysVisible: true }] }]]),
  tothalWorldId: () => 'test-world', currentTothalYear: () => 1, getCurrentArea: () => area,
  showToast: () => {},
});
assert.strictEqual(browser.WildernessMap._test.visibleLandmarks('map_northern_cliffs').length, 0, 'a stale alwaysVisible flag must not reveal the cave');
assert.strictEqual(browser.WildernessMap.discoverEnteredLocale('locale_banubu_shrine'), false, 'standing outside must not reveal it');
area = 'map_i_den_banubu';
assert.strictEqual(browser.WildernessMap.discoverEnteredLocale('locale_banubu_shrine'), true, 'entering the interior must discover Banubu');
assert.strictEqual(browser.WildernessMap._test.visibleLandmarks('map_northern_cliffs')[0]?.localeId, 'locale_banubu_shrine');
assert.strictEqual(browser.WildernessMap.discoverEnteredLocale('locale_banubu_shrine'), false, 'reentry cannot duplicate discovery');

const bandits = fs.readFileSync('docs/js/bandit-camps.js', 'utf8'); // Structural integration checks for the actual two late camp placement callers.
const tribes = fs.readFileSync('docs/js/porakaneki-camps-runtime.js', 'utf8');
assert(bandits.includes('LocaleTerrainPlacement?.isolatedLocaleAvoidPoints?.'), 'bandits must use the canonical isolation constraint');
assert(tribes.includes('LocaleTerrainPlacement?.isolatedLocaleAvoidPoints?.'), 'both barbarian tribes must use the canonical isolation constraint');

console.log('Banubu isolation, shared camp exclusion, twilight fades and enter-only discovery tests passed.');
