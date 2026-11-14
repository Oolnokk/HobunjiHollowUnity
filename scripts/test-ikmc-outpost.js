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
assert.deepEqual([mine.gridX, mine.gridZ, mine.footprintW, mine.footprintD], [12,0,2,2], 'Mine must match the screenshot-approved northern town placement');
assert.deepEqual([mineDoor.col, mineDoor.row], [13,2], 'Mine door transition must move with the approved building');
assert(outpost && outpost.pieceFile === 'config/pieces/ikmc-outpost.json', 'town must place the authored IKMC Outpost piece');
assert.deepEqual([outpost.gridX, outpost.gridZ, outpost.footprintW, outpost.footprintD], [15,18,11,7], 'IKMC Outpost must use the screenshot-approved southern placement and larger footprint');
assert.deepEqual([outpostDoor.col, outpostDoor.row, outpostDoor.targetMapId], [17,22,'map_i_ikmc_outpost']);
const mineConfig = read('docs/config/town-mine.json').townEntrance; // Runtime TownMine.decorateTownMap overrides the building/door from this config on every load.
assert.deepEqual([mineConfig.gridX, mineConfig.gridZ, mineConfig.doorCol, mineConfig.doorRow, mineConfig.rotationDeg],
  [mine.gridX, mine.gridZ, mineDoor.col, mineDoor.row, mine.rotationDeg],
  'Town Mine runtime decorator must not move the screenshot-approved mine or its entrance');

// Execute the shared runtime entrance resolver here so exterior extensions cannot silently move this authored door later.
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
const rectanglesOverlap = (a,b) => a.gridX < b.gridX + b.footprintW && a.gridX + a.footprintW > b.gridX
  && a.gridZ < b.gridZ + b.footprintD && a.gridZ + a.footprintD > b.gridZ; // Preserve meaningful collision protection without assuming the old northern lineup.
assert(!rectanglesOverlap(mine, outpost), 'Mine and IKMC Outpost must not overlap');
assert(!rectanglesOverlap(outpost, carpenter), 'IKMC Outpost and Carpenter must not overlap');
assert(!rectanglesOverlap(mine, carpenter), 'Mine and Carpenter must not overlap');

console.log('IKMC Outpost regression passed: authored building/interior, NPC schedules, approved town placement and runtime mine config are wired.');
