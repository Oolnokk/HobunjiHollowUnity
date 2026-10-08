#!/usr/bin/env node
// The Southern Cloud Forest gets a second road mouth on its south border (the
// region's exit, used by Slagothim caravans): workspace.tradeExit is exported
// on the south edge, the gate is carved as road, and a caravan route from the
// town gate reaches it (docs/js/slagothim-traders.js's own router, run on the
// same folded tiles game.js stores in _zoneLayouts). Other zones get none.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const G = require('../docs/js/wilderness-map-generator.js');
const TP = require('../docs/js/terrain-preview.js');

const ws = G.generateZoneWorkspace('map_southern_cloud_forest', 'trade_exit_test');
assert.ok(ws.tradeExit, 'cloud forest exports a trade exit');
assert.equal(ws.tradeExit.side, 'south');
const merged = TP.buildMergedZoneGrid(ws, ws.maps[0].id);
assert.equal(ws.tradeExit.row, merged.rows - 1, 'trade exit sits on the south border');
const tiles = [...merged.tiles.values()];
const byKey = new Map(tiles.map(tile => [`${tile.c},${tile.r}`, tile]));
let roadNearExit = 0;
for (let r = merged.rows - 12; r < merged.rows; r++) for (let c = ws.tradeExit.col - 3; c <= ws.tradeExit.col + 3; c++) if (byKey.get(`${c},${r}`)?.type === 'path') roadNearExit++;
assert.ok(roadNearExit > 0, 'the trade exit is carved as road');

const window = { __farmLog: () => {}, CalendarSystem: { constants: { TARGET_DAY_LENGTH_SECONDS: 672 } } };
window.window = window;
vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/js/slagothim-traders.js'), 'utf8'), vm.createContext(window));
const layout = { cols: merged.cols, rows: merged.rows, tiles, toTownExit: { col: ws.entry.col, row: ws.entry.row }, tradeExit: ws.tradeExit, buildings: merged.buildings || [], dens: ws.animalDens || [], localeInstances: ws.localeInstances || [] };
window.SlagothimTraders.init({ getZoneLayout: () => layout, EXTERIOR_ZONES: {}, calendar: { day: 1, time01: 0.3 } });
const caravan = { legs: [{ area: 'map_southern_cloud_forest', from: { k: 'tradeExit' }, to: { k: 'zoneGate' } }], legIndex: 0, dist: 0 };
const route = window.SlagothimTraders.__test.legRoute(caravan, 0);
assert.ok(route && route.length > merged.rows * 0.6, 'a caravan route crosses the zone from the trade exit to the town gate');
const grid = route.grid;
let onRoad = 0, samples = 0;
for (let d = 0; d < route.length; d += 1) {
  const p = window.SlagothimTraders.__test.pointAt(route, d);
  samples++;
  if (grid.cost[Math.floor(p.z) * grid.cols + Math.floor(p.x)] === 1) onRoad++;
}
assert.ok(onRoad / samples > 0.5, `caravan route mostly follows the road (${(onRoad / samples).toFixed(2)})`);

const other = G.generateZoneWorkspace('map_western_slope', 'trade_exit_test');
assert.equal(other.tradeExit, null, 'zones without tradeExitSide get no trade exit');
console.log('cloud forest trade exit: ok');
