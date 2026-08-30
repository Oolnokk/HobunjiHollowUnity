'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let saveMeta = JSON.stringify({ worlds: [{ id: 'world-1' }] });
let currentYear = 7;
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
  currentTothalYear: () => currentYear,
  showToast: message => toasts.push(message),
  _isZoneArea: () => true,
  getCurrentArea: () => 'zone-a',
  player: { x: 0, y: 0 }, TILE: 1, npcWalkers: [], WMAP_ZONE_LABELS: {},
});

const den = {
  id: 'threat:den:zone-a:1', source: 'threat', threatKey: 'den:zone-a:1',
  label: 'Animal Den', category: 'den', zoneId: 'zone-a', col: 12.5, row: 8.5,
};
context.WildernessMap.rememberDiscoveredThreat(den.threatKey, { ...den, kind: 'den' });
assert(context.WildernessMap.getDiscoveredThreats()[den.threatKey], 'companion-discovered den should be written to the world save');
assert(JSON.parse(saveMeta).worlds[0].discoveredThreats.markers[den.threatKey], 'saved den marker should survive a page reload through save metadata');
context.WildernessMap.setWaypoint(den);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.WildernessMap.getCompassWaypoint())),
  { ...den, year: 7 },
  'selected temporary landmark should be saved with its Tothal year and returned to the compass',
);
assert.match(toasts.at(-1), /Compass waypoint: Animal Den/);

context.WildernessMap.forgetDiscoveredThreat('different-threat');
assert(context.WildernessMap.getCompassWaypoint(), 'clearing a different threat must preserve the selected waypoint');
context.WildernessMap.forgetDiscoveredThreat(den.threatKey);
assert.equal(context.WildernessMap.getCompassWaypoint(), null, 'cleared threat should remove its saved discovery and compass waypoint');

const campKey = 'camp:zone-a:slot:0';
context.WildernessMap.rememberDiscoveredThreat(campKey, { kind: 'camp', zoneId: 'zone-a', col: 4, row: 6, label: 'Bandit Camp' });
context.WildernessMap.reconcileDiscoveredCamps('zone-a', [{ discoveryKey: campKey, col: 9, row: 11, label: 'Bandit Camp' }]);
assert.equal(context.WildernessMap.getDiscoveredThreats()[campKey].col, 9, 'restored camp discovery should follow its regenerated current-session camp position');
context.WildernessMap.setWaypoint({ id: `threat:${campKey}`, source: 'threat', threatKey: campKey, label: 'Bandit Camp', category: 'camp', zoneId: 'zone-a', col: 9, row: 11 });
context.WildernessMap.reconcileDiscoveredCamps('zone-a', []);
assert(!context.WildernessMap.getDiscoveredThreats()[campKey], 'removed camp should be pruned from persistent discoveries');
assert.equal(context.WildernessMap.getCompassWaypoint(), null, 'removed camp should also clear its saved waypoint');

context.WildernessMap.setWaypoint({
  id: 'locale:locale_leaf_pahu_house', source: 'locale', localeId: 'locale_leaf_pahu_house',
  label: "Leaf & Pahu's House", category: 'dwelling', zoneId: 'map_eastern_mire', col: 34, row: 29,
});
assert.equal(context.WildernessMap.getCompassWaypoint().source, 'locale', 'permanent authored locations should also be selectable');
assert.equal(context.WildernessMap.getCompassWaypoint().col, 34.5, 'authored locale waypoint should resolve to the center of its current tile');
assert(context.WildernessMap.getCompassWaypoint(), 'permanent authored-location waypoints should remain independent of temporary threat cleanup');

context.WildernessMap.rememberDiscoveredThreat(den.threatKey, { ...den, kind: 'den' });
currentYear = 8;
assert.deepEqual(JSON.parse(JSON.stringify(context.WildernessMap.getDiscoveredThreats())), {}, 'a new Tothal year should expire old den/camp discoveries');

const index = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
const game = fs.readFileSync(path.join(__dirname, '..', 'docs', 'game.js'), 'utf8');
const banditCamps = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'bandit-camps.js'), 'utf8');
assert(!index.includes('minimapWidget'), 'minimap DOM should be removed');
assert(!game.includes('renderMinimap'), 'minimap redraw loop should be removed');
assert(index.includes('wmapLandmarkList'), 'Map tab should expose the discovered-location waypoint list');
assert(banditCamps.includes('rememberDiscoveredThreat'), 'companion perception should persist newly discovered dens and camps');
assert(banditCamps.includes('reconcileDiscoveredCamps'), 'saved camp discoveries should reconnect to regenerated camp instances after reload');
assert.match(index, /wmap-map-column[\s\S]+wildernessMapCanvas[\s\S]+wmap-info-column[\s\S]+wmapZoneTabs[\s\S]+wmapLandmarkList/, 'Map tab should keep only the canvas left of all controls and supporting information');
const mapColumnMarkup = index.match(/<div class="wmap-column wmap-map-column">([\s\S]*?)<\/div>\s*<div class="wmap-column wmap-info-column">/)?.[1] || '';
assert(mapColumnMarkup.includes('wildernessMapCanvas'), 'left Map-tab column should contain the map');
assert(!mapColumnMarkup.includes('wmapZoneTabs'), 'zone selectors belong in the right information column, not beside the map');

const style = fs.readFileSync(path.join(__dirname, '..', 'docs', 'style.css'), 'utf8');
assert.match(style, /\.wmap-layout\s*\{[\s\S]*?grid-template-columns:/, 'Map tab should use two explicit side-by-side columns');
assert.match(style, /#wildernessMapCanvas\s*\{[\s\S]*?width:\s*min\(100%, 410px\)/, 'map width must shrink within its own column instead of overlapping the information column');
assert.match(style, /\.wmap-map-column\s*\{[\s\S]*?padding:\s*10px/, 'map should retain a small even margin inside its container');

console.log('wilderness map waypoint tests passed');
