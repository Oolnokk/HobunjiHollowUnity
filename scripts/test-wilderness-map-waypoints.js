'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let saveMeta = JSON.stringify({ worlds: [{ id: 'world-1' }] });
const toasts = [];
const context = {
  console, Math, Number, Object, Array, Map, Uint8Array,
  btoa: value => Buffer.from(value, 'binary').toString('base64'),
  atob: value => Buffer.from(value, 'base64').toString('binary'),
  localStorage: {
    getItem(key) { return key === 'hobunjiSaveMeta' ? saveMeta : null; },
    setItem(key, value) { if (key === 'hobunjiSaveMeta') saveMeta = value; },
  },
  document: { getElementById() { return null; } },
  window: null,
};
context.window = context;
context.BanditCamps = { perceivedThreats: new Map() };
context.BountyBoard = { markers: new Map() };

vm.createContext(context);
const sourcePath = path.join(__dirname, '..', 'docs', 'js', 'wilderness-map.js');
vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath });

context.WildernessMap.init({
  _zoneLayouts: new Map(),
  tothalWorldId: () => 'world-1',
  currentTothalYear: () => 7,
  showToast: message => toasts.push(message),
  _isZoneArea: () => true,
  getCurrentArea: () => 'zone-a',
  player: { x: 0, y: 0 }, TILE: 1, npcWalkers: [], WMAP_ZONE_LABELS: {},
});

const den = {
  id: 'threat:den:zone-a:1', source: 'threat', threatKey: 'den:zone-a:1',
  label: 'Animal Den', category: 'den', zoneId: 'zone-a', col: 12.5, row: 8.5,
};
context.WildernessMap.setWaypoint(den);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.WildernessMap.getCompassWaypoint())),
  { ...den, year: 7 },
  'selected temporary landmark should be saved with its Tothal year and returned to the compass',
);
assert.match(toasts.at(-1), /Compass waypoint: Animal Den/);

context.WildernessMap.clearWaypointForThreat('different-threat');
assert(context.WildernessMap.getCompassWaypoint(), 'clearing a different threat must preserve the selected waypoint');
context.WildernessMap.clearWaypointForThreat(den.threatKey);
assert.equal(context.WildernessMap.getCompassWaypoint(), null, 'cleared den/camp should remove its stale compass waypoint');

context.WildernessMap.setWaypoint({
  id: 'locale:locale_leaf_pahu_house', source: 'locale', localeId: 'locale_leaf_pahu_house',
  label: "Leaf & Pahu's House", category: 'dwelling', zoneId: 'map_eastern_mire', col: 34, row: 29,
});
assert.equal(context.WildernessMap.getCompassWaypoint().source, 'locale', 'permanent authored locations should also be selectable');
assert.equal(context.WildernessMap.getCompassWaypoint().col, 34.5, 'authored locale waypoint should resolve to the center of its current tile');
context.WildernessMap.clearTemporaryWaypointForZone('map_eastern_mire');
assert(context.WildernessMap.getCompassWaypoint(), 'wilderness reshaping must not clear permanent authored-location waypoints');

const index = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
const game = fs.readFileSync(path.join(__dirname, '..', 'docs', 'game.js'), 'utf8');
assert(!index.includes('minimapWidget'), 'minimap DOM should be removed');
assert(!game.includes('renderMinimap'), 'minimap redraw loop should be removed');
assert(index.includes('wmapLandmarkList'), 'Map tab should expose the discovered-location waypoint list');

console.log('wilderness map waypoint tests passed');
