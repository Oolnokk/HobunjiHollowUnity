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
const structuralFaces = piece.base.faces.filter(face => face.outpostFace); // The cabin walls retain their structural bounds even after cutting the south portal.
assert(structuralFaces.every(face => face.tag === 'wall'), 'structural Outpost walls must retain stacked-log tags');
assert.deepEqual(new Set(structuralFaces.map(face => face.outpostFace)), new Set(['bottom','top','south','north','west','east']));
assert.equal(structuralFaces.filter(face => face.outpostFace === 'south').length, 3, 'south wall must have two solid jamb runs and an overhead lintel');
assert(piece.base.faces.some(face => face.tag === 'roof'), 'the Outpost must have a visible pitched roof');
const mouthFaces = piece.base.faces.filter(face => face.tag === 'entryTunnel' && face.exteriorEntryOpening); // Physical framing at the outside end of the covered tunnel.
assert(mouthFaces.length > 0 && mouthFaces.every(face => face.extensionFace === 'south'), 'the visible doorframe must face the approach');
assert.deepEqual(piece.footprint.door, { x: 13, y: 11 }, 'authored doorway belongs outside the shell, within its covered entry tunnel');
assert.deepEqual(piece.footprint.extensions.entryTunnels, [{ x: 13, y: 11 }]);
assert.equal(piece.placementOrigin, 'fullFootprint', 'the porch must determine the outpost placement envelope, not just the shell');
assert.equal(piece.entryDoorRise, 0.18, 'wooden doorway must rest on the visible raised porch');
assert.equal(piece.footprint.extensions.porches.length, 42, 'the complete original west/front wraparound deck must be restored');
assert.equal(piece.footprint.extensions.porchStairs.length, 3, 'the original three-wide stairs must be restored');
assert.equal(piece.footprint.extensions.railings.length, 20, 'the original wraparound railing posts must be restored');
const deckTops = piece.base.faces.filter(face => face.tag === 'porch' && face.fusedPorchDeck && face.extensionFace === 'top'); // Real continuous deck geometry, not invisible footprint paint.
assert.equal(deckTops.length, 2, 'two broad joined timber surfaces must represent both porch wings');
assert.equal(piece.base.faces.filter(face => face.tag === 'porchStair').length, 18, 'three full-width stair steps must be visible without creating 9 redundant boxes');
const railPosts = new Set(piece.base.faces.filter(face => face.tag === 'railing' && face.railingPart === 'post').map(face => `${face.sourceTile.x},${face.sourceTile.y}`)); // Railings need real faces on every painted post tile.
assert.equal(railPosts.size, 20, 'all twenty railing posts must have visible mesh faces');
assert(piece.base.faces.some(face => face.tag === 'railing' && face.railingPart === 'horizontalConnectorUpper') ||
  piece.base.faces.some(face => face.tag === 'railing' && face.railingPart === 'horizontalConnectorHigh'), 'upper wooden handrails must connect posts');
const fullCells = [...piece.footprint.cells, ...piece.footprint.extensions.porches, ...piece.footprint.extensions.porchStairs]; // Shared full-envelope anchor includes the walkable porch/stairs.
assert.deepEqual([Math.min(...fullCells.map(c=>c.x)),Math.max(...fullCells.map(c=>c.x)),Math.min(...fullCells.map(c=>c.y)),Math.max(...fullCells.map(c=>c.y))], [6,16,7,13]);
const shellSouthLeft = structuralFaces.find(face => face.entryPortalPart === 'leftWall'); // Left solid span, ending at the new physical opening.
const shellSouthRight = structuralFaces.find(face => face.entryPortalPart === 'rightWall'); // Right solid span, starting beyond the new physical opening.
assert(shellSouthRight.v[0][0] - shellSouthLeft.v[1][0] > 0.8, 'the south wall must contain a real full-width walkable gap');

const structuralCells = piece.footprint.cells;
const gridCenter = Math.floor((piece.gridSize || 18) / 2);
const expectedPieceBounds = [
  Math.min(...structuralCells.map(c => c.x)) - gridCenter,
  Math.max(...structuralCells.map(c => c.x)) + 1 - gridCenter,
  Math.min(...structuralCells.map(c => c.y)) - gridCenter,
  Math.max(...structuralCells.map(c => c.y)) + 1 - gridCenter,
];
const outpostVertices = structuralFaces.flatMap(face => face.v);
assert.deepEqual([
  Math.min(...outpostVertices.map(v => v[0])),
  Math.max(...outpostVertices.map(v => v[0])),
  Math.min(...outpostVertices.map(v => v[2])),
  Math.max(...outpostVertices.map(v => v[2])),
], expectedPieceBounds, 'Outpost structural wall faces must occupy the same local bounds as its painted structural footprint');

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
assert.deepEqual([outpost.gridX, outpost.gridZ, outpost.footprintW, outpost.footprintD, outpost.rotationDeg], [4,40,11,7,180], 'full porch occupies the southwest relocation with its staircase facing the town path');
assert.equal(outpost.footprintShape.cells.length, 69, 'footprint must cover all original structural/porch/stair tiles and nothing else');
const occupied = new Set(outpost.footprintShape.cells.map(c => `${outpost.gridX + outpost.footprintW - 1 - c.x},${outpost.gridZ + outpost.footprintD - 1 - c.y}`)); // Rotate the real sparse footprint to town coordinates for overlap checks.
const otherBuildings = town.buildings.filter(b => b.id !== outpost.id);
for (const b of otherBuildings) {
  const w = b.footprintW, d = b.footprintD, deg = ((b.rotationDeg || 0) % 360 + 360) % 360;
  const cells = b.footprintShape?.cells || Array.from({ length: w * d }, (_, i) => ({ x: i % w, y: Math.floor(i / w) }));
  for (const c of cells) {
    const [u, v] = deg === 90 ? [c.y, w - 1 - c.x] : deg === 180 ? [w - 1 - c.x, d - 1 - c.y] : deg === 270 ? [d - 1 - c.y, c.x] : [c.x, c.y];
    assert(!occupied.has(`${b.gridX + u},${b.gridZ + v}`), `IKMC porch must not overlap ${b.label}`);
  }
}
for (const key of occupied) assert(!['stream', 'tilled', 'trench', 'shrub', 'path'].includes(town.tiles[key]?.type), `IKMC must not cover existing stream, fields, or roadway at ${key}`);

// Festival overlays spawn their own decoration and NPC records at runtime, outside
// town.buildings/town.npcStations. Check all layouts, including festival-locale
// dimensions and nested guest slots, before accepting a building relocation.
const festivalOverlap = (col, row, width = 1, depth = 1) => {
  const left = col + 0.5 - width / 2, right = col + 0.5 + width / 2; // Decor is centered on its tile; used against the outpost's rotated occupied cells.
  const top = row + 0.5 - depth / 2, bottom = row + 0.5 + depth / 2; // Rotated outpost tile edges provide the overlap comparison.
  return [...occupied].some(key => {
    const [x, y] = key.split(',').map(Number); // One footprint tile; checks actual positive-area intersection, not harmless edge contact.
    return left < x + 1 - 1e-6 && right > x + 1e-6 && top < y + 1 - 1e-6 && bottom > y + 1e-6;
  });
};
for (const layout of town.layouts || []) {
  if (!Array.isArray(layout.decor) && !Array.isArray(layout.npcStations)) continue;
  for (const prop of layout.decor || []) {
    const col = prop.col + (prop.postX || 0), row = prop.row + (prop.postZ || 0); // Actual festival decoration center, including post-placement offsets.
    const width = Math.max(1, Number(prop.festivalLocale?.width) || 1) * Math.abs(Number(prop.postSX ?? prop.postScale ?? 1)); // Festival locale's authored activity footprint or one ordinary furniture tile.
    const depth = Math.max(1, Number(prop.festivalLocale?.depth) || 1) * Math.abs(Number(prop.postSZ ?? prop.postScale ?? 1)); // Used for large stages and dance floors, not just their central tile.
    assert(!festivalOverlap(col, row, width, depth), `${layout.id}: festival decor ${prop.id} overlaps relocated IKMC porch`);
    for (const slot of prop.festivalLocale?.slots || []) {
      const guestCol = col + (slot.dx || 0), guestRow = row + (slot.dz || 0); // Festival NPCs spawned as offsets from their activity root.
      assert(!festivalOverlap(guestCol, guestRow), `${layout.id}: festival guest ${slot.id} overlaps relocated IKMC porch`);
    }
  }
  for (const station of layout.npcStations || []) {
    assert(!festivalOverlap(station.col, station.row), `${layout.id}: festival NPC station ${station.id} overlaps relocated IKMC porch`);
  }
}
const candle = town.layouts.find(layout => layout.id === 'festival_tzizkhanash')?.decor?.find(prop => prop.id === 'tzizkhanash_candles_13'); // This one-tile candle sits immediately east of the rebuilt wraparound porch.
assert(candle && candle.col === 15 && candle.row === 42 && !festivalOverlap(candle.col, candle.row), 'adjacent Tzizkhanash candles must remain clear of the actual porch');
for (const stair of piece.footprint.extensions.porchStairs) {
  const x = outpost.gridX + (16 - stair.x), z = outpost.gridZ + (13 - stair.y);
  assert.equal(z, 40, 'relocated front stairs must point north');
  if (x === 12 || x === 13) assert.equal(town.tiles[`${x},${z - 1}`]?.type, 'path', 'steps must meet the existing town road');
}
assert.deepEqual([outpostDoor.col, outpostDoor.row, outpostDoor.targetMapId], [7,42,'map_i_ikmc_outpost']);
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

console.log('IKMC Outpost regression passed: full visible wraparound porch, southwest placement, shared full-envelope door anchor, no town overlap, NPC schedule and runtime mine config are wired.');
