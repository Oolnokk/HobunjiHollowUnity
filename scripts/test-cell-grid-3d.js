#!/usr/bin/env node
'use strict';
const assert = require('assert');
const G = require('../docs/js/cell-grid-3d.js');
const { KIND, DIR } = G;

// --- units & measuring -------------------------------------------------------
assert.equal(G.UNITS.CELL_SIZE, 1);
assert.equal(G.UNITS.CELL_HEIGHT, 1);
assert(G.UNITS.CELL_HEIGHT > G.UNITS.MAX_STEP_HEIGHT, 'a cube is taller than the step limit, so it is never walked up');
assert.equal(G.heightToCells(3.2), 4, 'a 3.2 tall ladder occupies 4 cells');
assert.equal(G.heightToCells(2), 2, 'exact multiples do not round up');
assert.equal(G.heightToCells(0), 0);
assert.deepEqual(
  (({ cellsW, cellsD, cellsH }) => ({ cellsW, cellsD, cellsH }))(G.measureBox({ minX: 0.1, maxX: 1.9, minZ: 0, maxZ: 1, minY: 0, maxY: 2.4 })),
  { cellsW: 2, cellsD: 1, cellsH: 3 });

// --- a vertical shaft hub: 7x7 room, 12 levels tall, hollow 3x3 core ----------
// Solid ring walls 2 thick, a ground floor, and balconies cantilevered into the shaft.
const g = G.create({ cols: 9, rows: 9, levels: 12, originX: 2, originZ: 2, baseY: 0 });
g.fillBox(0, 0, 0, 8, 8, 11, KIND.SOLID);        // everything solid...
g.fillBox(3, 3, 0, 5, 5, 11, KIND.AIR);          // ...carve the 3x3 shaft, floor to roof
g.fillBox(3, 3, 0, 5, 5, 0, KIND.SOLID);         // shaft floor is the bottom solid cell
g.fillBox(3, 2, 6, 5, 2, 6, KIND.AIR);           // a doorway cut into the north wall at level 6/7...
g.fillBox(3, 2, 7, 5, 2, 7, KIND.AIR);
g.fillBox(3, 1, 6, 5, 1, 7, KIND.AIR);           // ...opening into a side room 2 cells deep
g.fillBox(3, 3, 5, 5, 3, 5, KIND.SOLID);         // balcony slab on the shaft's north edge at level 5 (top at y=6)
g.fillBox(3, 3, 6, 5, 3, 6, KIND.AIR);

// Standing: shaft floor top is y=1 (level 1), balcony top is y=6 (level 6).
assert(g.canStand(4, 4, 1), 'can stand on the shaft floor');
assert(!g.canStand(4, 4, 3), 'no floor mid-shaft');
assert(g.canStand(4, 3, 6), 'can stand on the balcony');
assert.equal(g.levelToY(6), 6);
assert.equal(g.yToLevel(6.0), 6);
assert.equal(g.yToLevel(5.999999), 6, 'tolerates float fuzz at a boundary');
assert.equal(g.yToLevel(5.9), 5);

// The same (col,row) is open at one level and solid at another: the point of a 3D grid.
const floorSlice = g.projectSlice(1), balconySlice = g.projectSlice(6);
const at = (slice, c, r) => slice[r * g.cols + c];
assert.equal(at(floorSlice, 4, 4), 0, 'shaft core is open to someone standing on the shaft floor');
assert.equal(at(floorSlice, 4, 3), 0, 'the cell under the balcony is open too (balcony starts at level 5)');
assert.equal(at(floorSlice, 4, 2), 1, 'but the wall is solid');
assert.equal(at(balconySlice, 4, 3), 0, 'standing on the balcony the balcony cell is open');
assert.equal(at(balconySlice, 4, 2), 0, 'and the doorway behind it is open');
assert.equal(at(balconySlice, 1, 4), 1, 'the side wall is still solid');

// Headroom: standing at level 4 under the balcony slab (level 5) with a 2-cell player is blocked.
assert(!g.hasHeadroom(4, 3, 4), 'balcony slab sits within a 2-cell body at level 4');
assert(g.hasHeadroom(4, 3, 3), 'one cell lower there is room');
assert.equal(g.floorLevelAt(4, 4, 4, { maxDrop: 2 }), -1, 'nothing to stand on mid-shaft within a short drop');
assert.equal(g.floorLevelAt(4, 4, 5, { maxDrop: 2 }), -1);
assert.equal(g.floorLevelAt(4, 4, 4), 1, 'unbounded, the same fall ends on the shaft floor');
assert.equal(g.floorLevelAt(4, 4, 11, { maxDrop: 20 }), 1, 'falling from the top lands on the shaft floor');
assert.equal(g.floorLevelAt(4, 3, 11, { maxDrop: 20 }), 6, 'falling above the balcony lands on the balcony, not the floor');

// Walking never climbs a cube, may drop one.
assert.equal(g.walkDestinationLevel(4, 4, 1), 1, 'flat walk');
assert.equal(g.walkDestinationLevel(4, 2, 1), -1, 'cannot walk into the wall');
assert.equal(g.walkDestinationLevel(4, 3, 6, { maxDrop: 0 }), 6);
assert.equal(g.walkDestinationLevel(4, 4, 6, { maxDrop: 1 }), -1, 'stepping off the balcony into the shaft is more than a one-cell drop');
assert.equal(g.walkDestinationLevel(4, 4, 6, { maxDrop: 20 }), 1, 'but a deliberate fall is allowed when the caller allows it');

// Legacy-shaped tile grid for existing 2D code.
const tiles = g.sliceToTileGrid(1, 2, (c, r) => ({ type: 'rock', c, r }), (c, r) => ({ type: 'floor', c, r }));
assert.equal(tiles.length, g.rows);
assert.equal(tiles[0].length, g.cols);
assert.equal(tiles[4][4].type, 'floor');
assert.equal(tiles[2][4].type, 'rock');

// --- DynamicSurfaces bridge ---------------------------------------------------
const registered = [];
const n = g.registerWith({ registerSurface: d => registered.push(d) }, { scope: 'test' });
assert(n > 0 && n === registered.length);
const balconySurface = registered.find(s => s.id === 'cg3d-4,3,6');
assert(balconySurface, 'balcony top registered');
assert.equal(balconySurface.topY, 6);
assert.deepEqual(balconySurface.bounds, { minX: 6, maxX: 7, minZ: 5, maxZ: 6 }, 'bounds are offset by the grid origin');
assert(registered.find(s => s.id === 'cg3d-4,4,1'), 'shaft floor registered');
assert(!registered.find(s => s.id === 'cg3d-4,4,3'), 'no surface mid-air');

// --- climbable faces ----------------------------------------------------------
// The shaft's west wall (col 2) faces east into the shaft at cols 3..5, levels 1..11.
assert.equal(g.paintClimbFaces(2, 3, 1, 2, 5, 11, DIR.E, 'ivy'), 32, 'the cell beside the balcony slab (level 5, row 3) has no reachable face, so 33 - 1');
g.clearClimbFace(2, 3, 1, DIR.E); // reset row 3 to keep the rest of this test on a clean rectangle
for (let l = 2; l <= 11; l++) g.clearClimbFace(2, 3, l, DIR.E);
assert.equal(g.setClimbFace(1, 4, 1, DIR.E, 'ivy'), false, 'a face with a solid neighbour is not reachable');
assert.equal(g.setClimbFace(4, 4, 3, DIR.E, 'ivy'), false, 'air cells have no faces');
assert.equal(g.climbFaceAt(2, 4, 5, DIR.E), 'ivy');
assert.equal(g.climbFaceAt(2, 4, 5, DIR.W), null);

let surfaces = g.collectClimbSurfaces();
assert.equal(surfaces.length, 1, 'a full rectangle merges to one surface');
let s = surfaces[0];
assert.equal(s.facing, 'E');
assert.equal(s.style, 'ivy');
assert.deepEqual(s.normal, { x: 1, z: 0 });
assert.equal(s.axis, 'z');
assert.equal(s.plane, 5, 'east face of col 2 lies at x = originX(2) + 3');
assert.equal(s.u0, 6); assert.equal(s.u1, 8, 'rows 4..5 -> z 6..8');
assert.equal(s.y0, 1); assert.equal(s.y1, 12);

// Removing a cell splits the rectangle; a different style never merges.
g.set(2, 4, 6, KIND.AIR);
assert.equal(g.climbFaceAt(2, 4, 6, DIR.E), null, 'removing a solid drops its faces');
surfaces = g.collectClimbSurfaces();
assert(surfaces.length >= 3, 'hole splits the wall into several rectangles');
const area = r => (r.u1 - r.u0) * (r.y1 - r.y0);
assert.equal(surfaces.reduce((a, r) => a + area(r), 0), 21, 'rectangles cover exactly the remaining 21 faces (2 columns x 11 levels - 1)');
g.setClimbFace(2, 3, 1, DIR.E, 'rungs');
const styles = new Set(g.collectClimbSurfaces().map(r => r.style));
assert(styles.has('rungs') && styles.has('ivy'));

// A south-facing wall puts u along x and the plane on z.
const h = G.create({ cols: 4, rows: 4, levels: 4, originX: 10, originZ: 20 });
h.fillBox(0, 0, 0, 3, 0, 3, KIND.SOLID);
h.paintClimbFaces(0, 0, 0, 3, 0, 3, DIR.S, 'holds');
const [hs] = h.collectClimbSurfaces();
assert.equal(hs.axis, 'x'); assert.equal(hs.plane, 21); assert.equal(hs.u0, 10); assert.equal(hs.u1, 14); assert.deepEqual(hs.normal, { x: 0, z: 1 });
assert.equal(h.collectClimbSurfaces().length, 1);

// --- lifting a legacy heightfield ---------------------------------------------
const lifted = G.fromHeightfield({
  cols: 4, rows: 1, levels: 6,
  heightAt: c => [0, 0.42, 1.0, null][c], // flat, one legacy plateau step, one full cube, a void
});
assert.equal(lifted.grid.get(0, 0, 0), KIND.AIR, 'height 0 is just bedrock');
assert.equal(lifted.grid.get(1, 0, 0), KIND.AIR, '0.42 is below one cube: quantised down to the floor');
assert.equal(lifted.grid.get(2, 0, 0), KIND.SOLID, '1.0 is exactly one cube');
assert(Math.abs(lifted.maxQuantizationError - 0.42) < 1e-9, 'the lost 0.42 is reported, not hidden');
assert.equal(lifted.grid.get(3, 0, 0), KIND.AIR, 'void columns are untouched');
assert(lifted.grid.canStand(2, 0, 1));

// An entire intervening wall can be crossed within one projectile update.
{
  const shaft = G.create({ cols: 5, rows: 1, levels: 5, originX: 10, baseY: 3 });
  shaft.set(2, 0, 0, KIND.SOLID);
  shaft.set(2, 0, 3, KIND.SOLID);
  const horizontalHit = (start, end, {box}, radius) => {
    if (start.y < box.min.y - radius || start.y > box.max.y + radius) return null;
    const enter = (box.min.x - radius - start.x) / (end.x - start.x);
    return enter >= 0 && enter <= 1 ? {enter} : null;
  };
  const sweep = (y, radius = 0) => shaft.solidSegmentHit(
    {x:10.5,y,z:.5}, {x:14.5,y,z:.5}, radius, horizontalHit);
  assert.equal(sweep(3.5), .375, 'a ground-level shot hits the intervening solid');
  assert.equal(sweep(5), null, 'a higher shot passes through open air in the same column');
  assert.equal(sweep(6.5), .375, 'the ceiling-level solid also blocks');
  assert(Math.abs(sweep(4.1, .2) - .325) < 1e-9, 'the projectile radius catches the wall edge');
}

console.log('cell-grid-3d: ok');
