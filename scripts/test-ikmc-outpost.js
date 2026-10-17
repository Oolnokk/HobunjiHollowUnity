#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));

const piece = read('docs/config/pieces/ikmc-outpost.json');
assert.equal(piece.name, 'IKMC Outpost');
assert.equal(piece.preset, 'outpost');
assert.equal(piece.wallStyle, 'logs', 'IKMC Outpost exterior must use stacked generated logs');
assert.equal(piece.base.faces.length, 6, 'Outpost shipping piece must retain the exact six-face prism');
assert(piece.base.faces.every(face => face.tag === 'wall'), 'all six Outpost prism faces must remain tagged wall');
assert.deepEqual(new Set(piece.base.faces.map(face => face.outpostFace)), new Set(['bottom','top','south','north','west','east']));

const structuralCells = piece.footprint.cells;
const gridCenter = Math.floor((piece.gridSize || 18) / 2);
const expectedPieceBounds = [
  Math.min(...structuralCells.map(c => c.x)) - gridCenter,
  Math.max(...structuralCells.map(c => c.x)) + 1 - gridCenter,
  Math.min(...structuralCells.map(c => c.y)) - gridCenter,
  Math.max(...structuralCells.map(c => c.y)) + 1 - gridCenter,
];
const outpostVertices = piece.base.faces.flatMap(face => face.v);
assert.deepEqual([
  Math.min(...outpostVertices.map(v => v[0])),
  Math.max(...outpostVertices.map(v => v[0])),
  Math.min(...outpostVertices.map(v => v[2])),
  Math.max(...outpostVertices.map(v => v[2])),
], expectedPieceBounds, 'Outpost six-face prism must occupy the same local bounds as its painted structural footprint');

const interior = read('docs/config/maps/map_i_ikmc_outpost.json');
assert.equal(interior.wallStyle, 'logs', 'IKMC Outpost interior walls must use the shared stacked-log renderer');
assert.equal(interior.furniture.filter(f => f.itemKey === 'basicBedFurniture').length, 1, 'Outpost must have exactly one bedroom bed');
assert(interior.furniture.some(f => f.id === 'f_ikmc_counter' && f.itemKey === 'counterFurniture'), 'Outpost needs its office counter');
assert(interior.furniture.some(f => f.id === 'f_ikmc_hark_chair' && f.itemKey === 'chairSimpleFurniture'), 'Harkhanash needs a chair behind the counter');
assert(interior.furniture.some(f => f.id === 'f_ikmc_hark_wardrobe' && f.npcWardrobeFor === 'khannibarri_agent'), 'bedroom storage must belong to Harkhanash');
assert(interior.npcStations.some(s => s.id === 'station_ikmc_hark_counter' && s.pose === 'sit'), 'day station must seat Harkhanash behind the counter');
assert(interior.npcStations.some(s => s.id === 'station_ikmc_hark_bed' && s.pose === 'lie'), 'overnight station must put Harkhanash in his bed');

const index = read('docs/config/maps/index.json');
assert(index.maps.some(m => m.id === 'map_i_ikmc_outpost' && m.file === 'config/maps/map_i_ikmc_outpost.json'), 'Outpost interior must be indexed');

const schedule = read('docs/config/npcs/schedule-overrides.json');
const hark = (schedule.scheduleReplacements || []).find(r => r.npcId === 'khannibarri_agent');
assert(hark, 'Harkhanash needs a runtime schedule replacement');
assert.equal(hark.scheduleHooks.defaultMapId, 'map_i_ikmc_outpost');
assert.equal(hark.scheduleHooks.defaultStationId, 'station_ikmc_hark_counter');
assert(hark.scheduleHooks.rules.some(r => r.stationId === 'station_ikmc_hark_bed' && /sleep/i.test(r.activity)), 'Harkhanash must sleep in the Outpost bed');
assert(hark.scheduleHooks.rules.every(r => r.mapId === 'map_i_ikmc_outpost'), 'Harkhanash replacement schedule must never send him back to the general store');
assert(!JSON.stringify(hark).includes('map_i_general_store'), 'Harkhanash replacement schedule must contain no general-store destination');

const wardrobes = read('docs/config/npcs/placeholder-wardrobes.json');
assert.deepEqual(
  { area: wardrobes.assignments.khannibarri_agent.area, furnitureId: wardrobes.assignments.khannibarri_agent.furnitureId, reason: wardrobes.assignments.khannibarri_agent.reason },
  { area: 'map_i_ikmc_outpost', furnitureId: 'f_ikmc_hark_wardrobe', reason: 'authored:npcWardrobeFor' }
);

const town = read('docs/config/maps/hobunji_hollow_town.map.json');
const mine = town.buildings.find(b => b.id === 'bldg_town_mine_entry');
const mineDoor = town.transitions.find(t => t.id === 'spot_town_mine');
const outpost = town.buildings.find(b => b.id === 'bldg_ikmc_outpost');
const outpostDoor = town.transitions.find(t => t.id === 'spot_ikmc_outpost');
const carpenter = town.buildings.find(b => b.id === 'bldg_pb9bn');
assert.deepEqual([mine.gridX, mine.gridZ], [9,3], 'mine building must move toward the river on the northern boundary');
assert.deepEqual([mineDoor.col, mineDoor.row], [10,5], 'mine door transition must move with the building');
assert(outpost && outpost.pieceFile === 'config/pieces/ikmc-outpost.json', 'town must place the authored IKMC Outpost piece');
assert.equal(outpost.gridZ, mine.gridZ, 'mine and Outpost must share the same northern placement line');
assert.deepEqual([outpostDoor.col, outpostDoor.row, outpostDoor.targetMapId], [15,7,'map_i_ikmc_outpost']);

const doorContext = { window: {}, console };
doorContext.window.window = doorContext.window;
vm.createContext(doorContext);
vm.runInContext(fs.readFileSync('docs/js/building-door.js', 'utf8'), doorContext, { filename: 'building-door.js' });
const buildingDoor = doorContext.window.BuildingDoor;
const liveOutpostDoor = buildingDoor.doorWorldFromBuilding(
  buildingDoor.resolveDoorEntrance(piece), outpost.gridX, outpost.gridZ, outpost.rotationDeg || 0, town.rows - 1
);
assert.deepEqual([liveOutpostDoor.col, liveOutpostDoor.row], [outpostDoor.col, outpostDoor.row],
  'live BuildingDoor resolution must preserve the authored Outpost transition even when porch extensions extend west of the shell');
assert(mine.gridX + mine.footprintW <= outpost.gridX, 'mine and Outpost structural footprints must not overlap');
assert(outpost.gridX + outpost.footprintW <= carpenter.gridX, 'Outpost and Carpenter structural footprints must not overlap');

const stream = Object.entries(town.tiles || {}).filter(([,tile]) => tile?.type === 'stream').map(([key]) => key.split(',').map(Number));
const riverDistance = Math.min(...stream.map(([c,r]) => Math.abs(c - mineDoor.col) + Math.abs(r - mineDoor.row)));
assert(riverDistance <= 2, `mine entrance must be within two tiles of river; got ${riverDistance}`);
const mineCenter = mine.gridX + mine.footprintW / 2;
const outpostCenter = outpost.gridX + outpost.footprintW / 2;
const carpenterCenter = carpenter.gridX + carpenter.footprintW / 2;
assert(Math.abs(Math.abs(outpostCenter - mineCenter) - Math.abs(carpenterCenter - outpostCenter)) <= 1.5,
  'Outpost should sit roughly equidistant between mine and carpenter along the northern boundary');

console.log('IKMC Outpost regression passed: authored log building/interior, Harkhanash bed+counter schedule, and northern-town placement are wired.');
