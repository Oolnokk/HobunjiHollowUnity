// Run with: node scripts/test-farmhouse-room-planner.js
// Full-size indoor rooms, a true one-cell gap, section-owned wall edits and legacy migration.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const scope = { window: {} }; // Loads the actual browser module without a DOM.
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../docs/js/farmhouse-room-planner.js'), 'utf8'), scope);
const planner = scope.window.FarmhouseRoomPlanner;
const pieces = [ // Two exterior house sections touching along the east-west seam.
  { id: 'main', col: 1, row: 1, w: 4, h: 3, stage: 'built' },
  { id: 'annex', col: 5, row: 1, w: 3, h: 3, stage: 'built' },
];
const saved = []; // Tracks world-layout writes without persisting transient first-corner selections.
let occupied = new Set(); // Furniture occupancy hook blocks illegal manual wall construction and door moves.
let entrances = []; // Optional protected indoor arrivals for subdivisions.
planner.init({ canEdit: () => true, canBlockCell: (c, r) => !occupied.has(`${c},${r}`),
  canHostDoor: (c, r) => !occupied.has(`${c},${r}`),
  rebuild: () => rebuild(), save: () => saved.push(planner.serialize()), refresh: () => {} });

function rebuild() {
  planner.layoutBuiltRooms(pieces);
  const floorSet = new Set(); // Unlike the previous carved-strip implementation, *all* original room tiles remain.
  for (const piece of pieces.filter(p => p.stage === 'built')) {
    const room = planner.roomRect(piece);
    for (let r = room.row; r < room.row + room.h; r++) for (let c = room.col; c < room.col + room.w; c++) {
      floorSet.add(`${c},${r}`);
    }
  }
  const exitSet = new Set(['6,1']); // One floorless outdoor entrance, unaffected by indoor-only offsets.
  return planner.apply({ floorSet, exitSet, doors: entrances, hearths: [] }, pieces);
}
let layout = rebuild();
assert.equal(planner.roomRect('main').col, 2);
assert.equal(planner.roomRect('annex').col, 11, 'annex starts after the entire 8-tile main room plus 1 separation tile');
assert.equal(layout.floorSet.size, 8 * 6 + 6 * 6 + 1, 'one corridor tile joins TWO full-size rooms');
assert.equal(layout.wallCells.size, 0, 'joined rooms do not sacrifice any of their pre-existing interior floor tiles');
assert.equal(layout.floorSet.has('10,5'), true, 'the only painted tile in the gap is the doorway');
assert.equal(layout.floorSet.has('10,4'), false, 'the rest of the gap remains empty to generate real walls');
assert.equal(layout.partitions.length, 1);
assert.equal(layout.partitions[0].door.c, 10);
assert.equal(layout.exitSet.has('6,1'), true);
assert.equal(layout.floorSet.has('6,1'), false, 'entrance remains floorless');
const first = layout.partitions[0]; // Stable join id allows door relocation after room movements.
assert.equal(planner.armDoor(first.id), true);
assert.equal(planner.confirm(10, 3).ok, true);
layout = rebuild();
assert.equal(layout.partitions[0].door.r, 3);
assert.equal(layout.floorSet.has('10,3'), true);
assert.equal(layout.floorSet.has('10,5'), false, 'old gap doorway must close when moved');
assert.equal(saved.length, 1);

planner.armWall();
assert.equal(planner.confirm(4, 2).ok, true);
assert.equal(planner.isArmed(), true, 'Action 1 only selects the first custom wall corner');
assert.equal(planner.confirm(4, 6).ok, true);
layout = rebuild();
assert.equal(layout.partitions.length, 2);
assert.equal(layout.wallCells.size, 4, 'manual subdivisions still remove every non-door wall tile');
const originalWall = planner.serialize().walls[0];
assert.equal(originalWall.ownerPieceId, 'main');
assert.equal(originalWall.a.c, 2, 'saved manual wall corners use room-local coordinates');
assert.equal(originalWall.a.r, 0);
assert.equal(originalWall.b.r, 4);
assert.equal(saved.length, 2);
planner.restore(planner.serialize());
assert.equal(rebuild().partitions.length, 2, 'modern room-local walls survive save/load');

// Moving the entire exterior house leaves room-local walls identical.
const before = planner.serialize().walls[0];
const oldMain = { col: pieces[0].col, row: pieces[0].row, w: pieces[0].w, h: pieces[0].h };
pieces[0].col += 1; pieces[1].col += 1;
planner.transformWithPiece('main', oldMain, { ...oldMain, col: oldMain.col + 1 }, false);
layout = rebuild();
assert.equal(planner.serialize().walls[0].a.c, before.a.c);
assert.equal(layout.partitions.find(p => !p.builtIn).strip[0].c, 6, 'world wall moves while local wall stays put');
assert.equal(layout.partitions.find(p => p.builtIn).door.c, 12, 'joined door follows the moved rooms');
const movedMain = { ...oldMain, col: pieces[0].col };
planner.transformWithPiece('main', movedMain, { ...movedMain, w: 3, h: 4 }, true);
const rotated = planner.serialize().walls[0];
assert.equal(rotated.a.r, rotated.b.r, 'a 90-degree room rotation also rotates its subdivision');
planner.onPieceRemoved('main');
assert.equal(planner.serialize().walls.length, 0);

// Older branch saves stored walls in exterior×2 absolute coordinates, not room-local coordinates.
pieces[0] = { id:'main', col:1, row:1, w:4, h:3, stage:'built' };
pieces[1] = { id:'annex', col:5, row:1, w:3, h:3, stage:'built' };
planner.restore({ walls:[{ id:'old', ownerPieceId:'main', a:{c:4,r:2}, b:{c:4,r:6}, door:{c:4,r:4} }] });
layout = rebuild();
assert.equal(layout.partitions.length, 2);
assert.equal(planner.serialize().walls[0].a.c, 2, 'legacy absolute coordinate migrated once');
assert.equal(planner.serialize().roomSpaceVersion, 2);
planner.restore(null);
assert.equal(rebuild().partitions.length, 1, 'legacy worlds without manual walls receive only generated joins');

// A manual wall must not sever an outside arrival. The occupied arrival becomes its door.
entrances = [{ enter: { c:4, r:3 } }];
planner.armWall();
assert.equal(planner.confirm(4,2).ok, true);
assert.equal(planner.confirm(4,6).ok, true);
layout = rebuild();
assert.equal(layout.partitions.find(part => !part.builtIn).door.r, 3);
planner.restore(null);
entrances = [];
occupied = new Set(['4,4']);
rebuild();
planner.armWall();
assert.equal(planner.canTarget(4,4), false);
assert.equal(planner.confirm(4,2).ok, true);
assert.equal(planner.canTarget(4,6), false, 'walls cannot be placed through furniture');
planner.cancel();
occupied.clear();
const narrow = [ // Two interior rows produce a real gap door without losing a floor tile.
 { id:'short-left', col:0, row:0, w:2, h:1, stage:'built' },
 { id:'short-right', col:2, row:0, w:1, h:1, stage:'built' },
];
planner.layoutBuiltRooms(narrow);
const nFloor = new Set();
narrow.forEach(piece => { const r=planner.roomRect(piece); for(let x=r.col;x<r.col+r.w;x++)for(let y=r.row;y<r.row+r.h;y++)nFloor.add(`${x},${y}`); });
const narrowLayout = planner.apply({ floorSet:nFloor, exitSet:new Set(), doors:[], hearths:[] }, narrow);
assert.equal(narrowLayout.partitions.length, 1);
assert.equal(narrowLayout.wallCells.size, 0);
assert.equal(narrowLayout.floorSet.size, 4*2 + 2*2 + 1);
console.log('Farmhouse room planner: complete-footprint and save regressions passed.');
