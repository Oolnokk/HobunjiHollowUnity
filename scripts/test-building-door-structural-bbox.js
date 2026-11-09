#!/usr/bin/env node
'use strict';

// An authored door is anchored to the structural shell (footprint.cells), the same
// bounding box HousePieceGen rotates around, so porches/chimneys/tunnels that extend
// the full footprint must not change the box the door is rotated within.
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
  const cells = piece?.footprint?.cells || [];
  if (!cells.length || !Number.isFinite(door?.x) || !Number.isFinite(door?.y)) continue;
  const minX = Math.min(...cells.map(c => c.x)), maxX = Math.max(...cells.map(c => c.x));
  const minY = Math.min(...cells.map(c => c.y)), maxY = Math.max(...cells.map(c => c.y));
  const entrance = BuildingDoor.resolveDoorEntrance(piece);
  assert.equal(entrance.bboxW, maxX - minX + 1, `${name}: bboxW is the structural width`);
  assert.equal(entrance.bboxD, maxY - minY + 1, `${name}: bboxD is the structural depth`);
  assert.deepEqual(entrance.cells, [{ x: door.x - minX, y: door.y - minY }], `${name}: door is relative to the structural origin`);
  checked++;
}
assert(checked >= 4, 'covers the authored-door pieces, including porched ones');

// Porches extend general-store east/south of its shell; rotating 90 deg must use the 7x4 shell, not the 7x7 full footprint.
const store = JSON.parse(fs.readFileSync(path.join(dir, 'general-store.json'), 'utf8'));
const storeDoor = BuildingDoor.resolveDoorEntrance(store);
assert.deepEqual([storeDoor.bboxW, storeDoor.bboxD], [7, 4]);
assert.deepEqual(BuildingDoor.rotateCell(storeDoor.cells[0].x, storeDoor.cells[0].y, storeDoor.bboxW, storeDoor.bboxD, 90), { x: 3, y: 4 });
console.log(`building door structural bbox ok (${checked} pieces)`);
