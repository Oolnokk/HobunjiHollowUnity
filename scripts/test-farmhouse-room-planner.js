// Run with: node scripts/test-farmhouse-room-planner.js
// Verifies that house section seams, floorless exits, and editable partitions
// remain deterministic across world save/load without a browser.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const scope = { window: {} }; // Isolates the browser-global planner in a Node VM.
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../docs/js/farmhouse-room-planner.js'), 'utf8'), scope);
const planner = scope.window.FarmhouseRoomPlanner;
const pieces = [ // Two adjacent sections share a six-tile-high interior boundary.
  { id: 'main', col: 1, row: 1, w: 4, h: 3, stage: 'built' },
  { id: 'annex', col: 5, row: 1, w: 3, h: 3, stage: 'built' },
];
const floorSet = new Set(); // 2x farmhouse floor, before the join strip is removed.
for (let r = 2; r < 8; r++) for (let c = 2; c < 16; c++) floorSet.add(`${c},${r}`);
const base = { floorSet, exitSet: new Set(['6,1']), doors: [], hearths: [] };
const saved = []; // Counts transactions that should write through FarmEditor.
const rebuild = () => planner.apply(base, pieces);
planner.init({ canEdit: () => true, rebuild, save: () => saved.push(planner.serialize()), refresh: () => {} });
let layout = rebuild();
assert.equal(layout.partitions.length, 1);
assert.equal(layout.wallCells.size, 5);
assert.equal(layout.doorTiles.length, 1);
assert.equal(layout.floorSet.has(layout.doorTiles[0].join(',')), true);
assert.equal(layout.exitSet.has('6,1'), true);
assert.equal(layout.floorSet.has('6,1'), false, 'floorless entrance must not be accidentally painted');
const firstDoor = layout.partitions[0];
assert.equal(planner.armDoor(firstDoor.id), true);
assert.equal(planner.confirm(firstDoor.strip[1].c, firstDoor.strip[1].r).ok, true);
layout = rebuild();
assert.equal(layout.partitions[0].door.r, firstDoor.strip[1].r);
assert.equal(planner.armWall(), true);
assert.equal(planner.confirm(4, 2).ok, true);
assert.equal(planner.isArmed(), true, 'first corner keeps the tool armed');
assert.equal(planner.confirm(4, 6).ok, true);
layout = rebuild();
assert.equal(layout.partitions.length, 2);
assert.equal(saved.length, 2);
const snapshot = planner.serialize(); // Saved walls and moved doors should roundtrip.
planner.restore(null);
assert.equal(rebuild().partitions.length, 1, 'older saves receive only generated join walls');
planner.restore(snapshot);
assert.equal(rebuild().partitions.length, 2);
const custom = rebuild().partitions.find(part => !part.builtIn);
assert.equal(planner.removeWall(custom.id).ok, true);
assert.equal(rebuild().partitions.length, 1);
planner.restore({ walls: [{ id: 'bad', a: { c: 2, r: 2 }, b: { c: 3, r: 3 } }] });
assert.equal(rebuild().partitions.length, 1, 'diagonal walls must never be loaded');
// Narrow wings still need a door and at least one partition cell.
const narrowPieces = [
  { id: 'tiny-a', col: 0, row: 0, w: 2, h: 1, stage: 'built' },
  { id: 'tiny-b', col: 2, row: 0, w: 1, h: 1, stage: 'built' },
];
const narrowFloor = new Set(); // Includes both 2x-scaled house-piece interiors.
for (let c = 0; c < 6; c++) for (let r = 0; r < 2; r++) narrowFloor.add(`${c},${r}`);
const narrowLayout = planner.apply({ floorSet: narrowFloor, exitSet: new Set(), doors: [], hearths: [] }, narrowPieces);
assert.equal(narrowLayout.partitions.length, 1);
assert.equal(narrowLayout.wallCells.size, 1);
assert.equal(narrowLayout.doorTiles.length, 1);
// A manual wall is attached to its room and follows 2x-scaled house movement and 90° rotation.
planner.restore(null);
rebuild();
planner.armWall();
assert.equal(planner.confirm(4, 2).ok, true);
assert.equal(planner.confirm(4, 6).ok, true);
const beforeMove = planner.serialize().walls[0];
assert.equal(beforeMove.ownerPieceId, 'main');
planner.transformWithPiece('main', { col: 1, row: 1, w: 4, h: 3 }, { col: 2, row: 1, w: 4, h: 3 }, false);
const moved = planner.serialize().walls[0];
assert.equal(moved.a.c, beforeMove.a.c + 2);
planner.transformWithPiece('main', { col: 2, row: 1, w: 4, h: 3 }, { col: 2, row: 1, w: 3, h: 4 }, true);
const rotated = planner.serialize().walls[0];
assert.equal(rotated.a.r, rotated.b.r);
planner.onPieceRemoved('main');
assert.equal(planner.serialize().walls.length, 0);
console.log('Farmhouse room planner: all regression assertions passed.');
