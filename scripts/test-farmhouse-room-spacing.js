#!/usr/bin/env node
'use strict';
// node scripts/test-farmhouse-room-spacing.js
// Real farmhouse geometry and window projection; outdoor house records remain untouched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = file => fs.readFileSync(path.join(__dirname, '../docs/js/', file), 'utf8'); // Test checked-in modules, not parallel reimplementations.
const context = vm.createContext({ window: { THREE: {} }, console }); // Wall-panel generation requires only the existing Three.js presence guard.
for (const file of ['farmhouse-room-planner.js', 'house-pieces-core.js', 'interior-scene-builder.js', 'interior-door-tiles.js', 'house-window-linkage.js']) {
  vm.runInContext(source(file), context, { filename: file });
}
const { FarmhouseRoomPlanner: planner, HousePieces: house, InteriorDoorTiles: doorApi, InteriorSceneBuilder: walls, HouseWindowLinkage: windows } = context.window;
const pieces = [ // One exterior boundary shared by the starter section and annex.
  { id:'house_starter', col:2, row:2, w:4, h:3, stage:'built', features:[
    { id:'entry', lx:1, ly:2, side:'south', edgeSlot:1, type:'entrance', _doorObj:{} },
    { id:'chimney', lx:2, ly:0, side:'north', type:'chimney' },
  ] },
  { id:'house_starter_annex', col:6, row:2, w:3, h:3, stage:'built', features:[] },
];
let saveCount = 0;
house.init({ TileType:{}, getHousePieces:() => pieces, hasFarmPermission:() => true, saveFarmLayout:() => { saveCount++; }, debugLog() {} });
planner.restore(null);
let layout = house.computeInteriorLayout();
const main = planner.roomRect(pieces[0]), annex = planner.roomRect(pieces[1]);
assert.equal(main.col, 4);
assert.equal(annex.col, main.col + main.w + 1, 'complete rooms have exactly one indoor-only gap');
assert.equal(pieces[1].col, 6, 'exterior farmhouse coordinates never change');
assert.equal(layout.floorSet.size, main.w * main.h + annex.w * annex.h + 1);
assert.equal(layout.exitSet.size, 1, 'only exterior doors trigger Exit House');
assert.equal(layout.doors.length, 1);
const exit = layout.doors[0], outside = exit.exitCells[0];
assert.equal(layout.floorSet.has(outside), false, 'the exterior marker is floorless');
assert.equal(exit.enter.c, main.col + 3);
assert.equal(exit.enter.r, main.row + 5);
assert.equal(layout.hearths.length, 1);
assert.equal(layout.hearths[0].cx, main.col + 5);
const beforeShiftExit = layout.doors[0].enter.c;
const beforeShiftHearth = layout.hearths[0].cx;
assert.equal(house.shiftInteriorFeature(pieces[0].id, 'entry', 1).ok, true);
assert.equal(house.shiftInteriorFeature(pieces[0].id, 'chimney', 1).ok, true);
layout = house.computeInteriorLayout();
assert.equal(layout.doors[0].enter.c, beforeShiftExit - 1, 'entrance shifts one interior tile right from inside on a south wall');
assert.equal(layout.hearths[0].cx, beforeShiftHearth + 1, 'fireplace shifts one interior tile right from inside on a north wall');
assert.equal(saveCount, 2, 'each explicit fixture adjustment is persisted');
assert.equal(house.shiftInteriorFeature(pieces[0].id, 'entry', -1).ok, true);
assert.equal(house.shiftInteriorFeature(pieces[0].id, 'chimney', -1).ok, true);
layout = house.computeInteriorLayout();
assert.equal(layout.doors[0].enter.c, beforeShiftExit, 'left adjustment reverses entrance shift');
const entry = pieces[0].features.find(feature => feature.id === 'entry');
for (const [side, edgeSlot, axis, delta] of [
  ['north', 0, 'c', 1], ['south', 1, 'c', -1],
  ['west', 1, 'r', -1], ['east', 0, 'r', 1],
]) {
  entry.side = side; entry.edgeSlot = edgeSlot; entry.interiorShift = 0;
  const before = house.computeInteriorLayout().doors.find(door => door.featureId === 'entry').enter;
  assert.equal(house.shiftInteriorFeature(pieces[0].id, 'entry', 1).ok, true, side + ' entrance shifts right');
  const after = house.computeInteriorLayout().doors.find(door => door.featureId === 'entry').enter;
  assert.equal(after[axis] - before[axis], delta, side + ' entrance right follows the wall tangent');
  assert.equal(house.shiftInteriorFeature(pieces[0].id, 'entry', 1).ok, false, side + ' entrance cannot leave its two-cell wall span');
  assert.equal(house.shiftInteriorFeature(pieces[0].id, 'entry', -1).ok, true, side + ' entrance shift reverses');
}
const chimney = pieces[0].features.find(feature => feature.id === 'chimney');
for (const [side, axis, delta] of [
  ['north', 'cx', 1], ['south', 'cx', -1],
  ['west', 'cz', -1], ['east', 'cz', 1],
]) {
  chimney.side = side; chimney.interiorShift = 0;
  const before = house.computeInteriorLayout().hearths[0][axis];
  assert.equal(house.shiftInteriorFeature(pieces[0].id, 'chimney', 1).ok, true, side + ' fireplace shifts right');
  assert.equal(house.shiftInteriorFeature(pieces[0].id, 'chimney', 1).ok, false, side + ' fireplace cannot shift more than one interior tile');
  const after = house.computeInteriorLayout().hearths[0][axis];
  assert.equal(after - before, delta, side + ' fireplace right follows the wall tangent');
  assert.equal(house.shiftInteriorFeature(pieces[0].id, 'chimney', -1).ok, true, side + ' fireplace shift reverses');
}
chimney.side = 'north';
assert.equal(layout.hearths[0].cx, beforeShiftHearth, 'left adjustment reverses fireplace shift');
const join = layout.partitions[0];
assert.equal(join.door.c, main.col + main.w);
assert.equal(layout.floorSet.has(join.door.c + ',' + join.door.r), true);
const wallPanels = walls.buildWallPanels(layout.floorSet, layout.exitSet, 1.75);
assert.ok(wallPanels.length > 0, 'the room floor boundaries generate actual wall panels');
const doorGroups = doorApi.doorGroupsOf({
  doorTiles: layout.doorTiles,
  exits: [{ id:'entry', tiles:[outside.split(',').map(Number)], direction:'north', generateDoor:true }],
}, layout.floorSet);
assert.equal(doorGroups.length, 2, 'one entrance door and one inter-room door');
assert.equal(doorGroups.filter(d => d.exitId).length, 1);
assert.equal(doorGroups.filter(d => !d.exitId).length, 1);

// Reversible wall projection uses a resolved room record, without requiring a live farm-editor adapter.
const directRun = { pieceId:pieces[1].id, piece:pieces[1], side:'north' };
const interiorPoint = windows.__test.toIndoorPoint(directRun, 7, 2, 0.875);
assert.equal(interiorPoint[0], annex.col + 2);
assert.equal(interiorPoint[2], annex.row);
const back = windows.__test.fromIndoorPoint(directRun, interiorPoint);
assert.equal(back[0], 7); assert.equal(back[1], 2);
for (const [side, expected] of [['north', 11], ['south', 9], ['west', 19], ['east', 21]]) {
  const shifted = windows.__test.shiftInteriorPoint([10, 0, 20], side, 1);
  assert.equal(side === 'north' || side === 'south' ? shifted[0] : shifted[2], expected,
    side + ' interior right shift follows the wall-local tangent');
}

// Offset every exterior piece. The indoor relative layout and the full
// footprint must remain stable, including the attached entrance and hearth.
pieces.forEach(piece => { piece.col += 2; piece.row += 3; });
layout = house.computeInteriorLayout();
const nextMain = planner.roomRect(pieces[0]), nextAnnex = planner.roomRect(pieces[1]);
assert.equal(nextAnnex.col - (nextMain.col + nextMain.w), 1);
assert.equal(layout.floorSet.size, main.w * main.h + annex.w * annex.h + 1);
assert.equal(layout.doors[0].enter.c - exit.enter.c, 4);
assert.equal(layout.hearths[0].cz -  (main.row + 0.5), 6);
console.log('Farmhouse full-size geometry, exit, wall, and window regressions passed.');
