#!/usr/bin/env node
'use strict';

// Ordinary authored doors keep their structural-shell origin; explicitly fullFootprint
// authored buildings (e.g. the IKMC wraparound porch) instead anchor to the entire
// visible footprint. Both must match HousePieceGen's placement and rotation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.window = global;
global.document = { querySelector: () => null, createElement: () => ({ dataset: {} }), head: { appendChild() {} } };
global.location = { pathname: '/' };
require('../docs/js/building-door.js');
const BuildingDoor = global.BuildingDoor;
assert(BuildingDoor?.resolveDoorEntrance, 'BuildingDoor must be exposed');

const dir = path.join(__dirname, '..', 'docs', 'config', 'pieces');
let checked = 0;
for (const name of fs.readdirSync(dir).filter(file => file.endsWith('.json'))) {
  const piece = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const door = piece?.footprint?.door;
  const structuralCells = piece?.footprint?.cells || [];
  if (!structuralCells.length || !Number.isFinite(door?.x) || !Number.isFinite(door?.y)) continue;
  const cells = piece.placementOrigin === 'fullFootprint' ? BuildingDoor.footprintCells(piece) : structuralCells; // Explicit mode selects the same origin used for mesh placement.
  const minX = Math.min(...cells.map(c => c.x)), maxX = Math.max(...cells.map(c => c.x));
  const minY = Math.min(...cells.map(c => c.y)), maxY = Math.max(...cells.map(c => c.y));
  const entrance = BuildingDoor.resolveDoorEntrance(piece);
  assert.equal(entrance.bboxW, maxX - minX + 1, `${name}: bboxW follows its authored placement-origin mode`);
  assert.equal(entrance.bboxD, maxY - minY + 1, `${name}: bboxD follows its authored placement-origin mode`);
  assert.deepEqual(entrance.cells, [{ x: door.x - minX, y: door.y - minY }], `${name}: door is relative to the configured placement origin`);
  checked++;
}
assert(checked >= 4, 'covers the authored-door pieces, including porched ones');

// Porches extend general-store east/south of its shell; rotating 90 deg must use the 7x4 shell, not the 7x7 full footprint.
const store = JSON.parse(fs.readFileSync(path.join(dir, 'general-store.json'), 'utf8'));
const storeDoor = BuildingDoor.resolveDoorEntrance(store);
assert.deepEqual([storeDoor.bboxW, storeDoor.bboxD], [7, 4]);
assert.deepEqual(BuildingDoor.rotateCell(storeDoor.cells[0].x, storeDoor.cells[0].y, storeDoor.bboxW, storeDoor.bboxD, 90), { x: 3, y: 4 });
const outpost = JSON.parse(fs.readFileSync(path.join(dir, 'ikmc-outpost.json'), 'utf8')); // Validates the large west-and-front porch against the screenshot-independent placement contract.
const outpostDoor = BuildingDoor.resolveDoorEntrance(outpost);
assert.deepEqual([outpostDoor.bboxW, outpostDoor.bboxD], [11, 7]);
assert.deepEqual(outpostDoor.cells, [{ x: 7, y: 4 }]);
assert.deepEqual(BuildingDoor.rotateCell(7, 4, 11, 7, 180), { x: 3, y: 2 });
assert.deepEqual(
  (({ col, row }) => ({ col, row }))(BuildingDoor.doorWorldFromBuilding(outpostDoor, 4, 40, 180, 49)),
  { col: 7, row: 42 },
  'full-porch building entrance must land exactly on its rotated physical door in town'
);
console.log(`building door structural bbox ok (${checked} pieces)`);
