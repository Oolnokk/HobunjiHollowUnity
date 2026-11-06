'use strict';
// RuinWallFaces: voxel faces merge into maximal rectangles with exact coverage, wind outward, stay
// upright, split into stretch-to-fit patches no bigger than the limit, and thin edge walls get two faces.
const assert = require('node:assert/strict');
const W = require('../docs/js/ruin-wall-faces.js');

const area = r => (r.a1 - r.a0) * (r.b1 - r.b0);

// --- mergeMask ---------------------------------------------------------------------
{
  const full = W.mergeMask(new Uint8Array(6).fill(1), 3, 2);
  assert.deepEqual(full, [{ i0:0, j0:0, i1:3, j1:2 }], 'a full mask is one rectangle');
  const ell = W.mergeMask(Uint8Array.from([1, 1, 1, 1, 0, 0]), 3, 2); // top row of 3, bottom row of 1
  assert.equal(ell.reduce((s, r) => s + (r.i1 - r.i0) * (r.j1 - r.j0), 0), 4, 'an L covers exactly its cells');
  assert.equal(ell.length, 2);
  const hole = W.mergeMask(Uint8Array.from([1, 1, 1, 1, 0, 1, 1, 1, 1]), 3, 3);
  assert.equal(hole.reduce((s, r) => s + (r.i1 - r.i0) * (r.j1 - r.j0), 0), 8, 'a ring leaves its hole empty');
  assert.deepEqual(W.mergeMask(new Uint8Array(4), 2, 2), [], 'an empty mask has no rectangles');
}

// --- voxelFaces ----------------------------------------------------------------------
const gridOf = (cols, rows, levels, solidCells) => {
  const set = new Set(solidCells.map(c => c.join(',')));
  return { cols, rows, levels, isSolid:(c, r, l) => set.has(c + ',' + r + ',' + l) };
};
const brute = grid => { // One unit face per solid cell side that touches in-bounds air.
  let n = 0;
  for (let l = 0; l < grid.levels; l++) for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
    if (!grid.isSolid(c, r, l)) continue;
    for (const [dc, dr, dl] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const nc = c + dc, nr = r + dr, nl = l + dl;
      if (nc >= 0 && nr >= 0 && nl >= 0 && nc < grid.cols && nr < grid.rows && nl < grid.levels && !grid.isSolid(nc, nr, nl)) n++;
    }
  }
  return n;
};
{
  const single = gridOf(3, 3, 3, [[1, 1, 1]]);
  const faces = W.voxelFaces(single);
  assert.equal(faces.length, 6, 'one cube: one face per side');
  assert.ok(faces.every(f => area(f) === 1));
  assert.deepEqual([...new Set(faces.map(f => f.axis + f.side))].sort(), ['x-1', 'x1', 'y-1', 'y1', 'z-1', 'z1']);

  const slab = gridOf(5, 3, 4, [[1, 1, 1], [2, 1, 1], [3, 1, 1], [1, 1, 2], [2, 1, 2], [3, 1, 2]]); // 3 x 1 x 2 block, clear of every grid edge
  const merged = W.voxelFaces(slab);
  assert.equal(merged.length, 6, 'a solid block merges to one rectangle per side, however many cells');
  assert.equal(merged.reduce((s, f) => s + area(f), 0), brute(slab), 'and covers exactly the exposed unit faces');

  // A hollow room: a solid ring of walls around an air interior. Each inner wall is one big rectangle.
  const cells = [];
  for (let l = 0; l < 3; l++) for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) if (c === 0 || r === 0 || c === 6 || r === 6) cells.push([c, r, l]);
  const room = gridOf(7, 7, 3, cells);
  const inner = W.voxelFaces(room).filter(f => (f.axis === 'x' && (f.plane === 1 || f.plane === 6)) || (f.axis === 'z' && (f.plane === 1 || f.plane === 6)));
  assert.equal(inner.length, 4, 'each of the four inner walls is a single merged rectangle');
  assert.ok(inner.every(f => area(f) === 5 * 3), 'spanning the full room width and height');
  assert.equal(W.voxelFaces(room).reduce((s, f) => s + area(f), 0), brute(room), 'exact coverage');

  // Cells outside the grid are unknown, never solid: a doorway through the edge of the grid stays open.
  const tunnel = gridOf(4, 3, 1, [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [0, 2, 0], [1, 2, 0], [2, 2, 0], [3, 2, 0]]); // air row at r=1 runs out both ends
  const open = W.voxelFaces(tunnel);
  assert.ok(!open.some(f => f.axis === 'x' && (f.plane === 0 || f.plane === 4)), 'no wall is invented across the tunnel mouths');
  assert.equal(open.reduce((s, f) => s + area(f), 0), brute(tunnel));
  assert.equal(W.voxelFaces(gridOf(2, 2, 2, [])).length, 0, 'an empty grid has no faces');
  assert.equal(W.voxelFaces(gridOf(2, 2, 2, [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]])).length, 0, 'a fully solid grid has no interior faces');
}

// --- buildQuads: winding, UVs, patches --------------------------------------------------
const triNormals = data => {
  const out = [];
  for (let i = 0; i < data.indices.length; i += 3) {
    const v = k => [data.positions[data.indices[i + k] * 3], data.positions[data.indices[i + k] * 3 + 1], data.positions[data.indices[i + k] * 3 + 2]];
    const a = v(0), b = v(1), c = v(2), e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    out.push({ n, area:Math.hypot(...n) / 2, stored:[data.normals[data.indices[i] * 3], data.normals[data.indices[i] * 3 + 1], data.normals[data.indices[i] * 3 + 2]] });
  }
  return out;
};
{
  const origin = { x:10, y:4, z:20 }, size = { x:1, y:1, z:1 };
  const room = []; for (let l = 0; l < 4; l++) for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (c === 0 || r === 0 || c === 8 || r === 8) room.push([c, r, l]);
  const grid = gridOf(9, 9, 4, room);
  const data = W.buildQuads(W.voxelFaces(grid), { origin, size, patch:{ h:6, v:6 } });
  const tris = triNormals(data);
  assert.ok(tris.length > 0);
  for (const t of tris) {
    assert.ok(t.n[0] * t.stored[0] + t.n[1] * t.stored[1] + t.n[2] * t.stored[2] > 0, 'every triangle winds counter-clockwise seen from outside');
    assert.ok(Math.abs(Math.hypot(...t.stored) - 1) < 1e-6, 'stored normals are unit length');
  }
  assert.equal(Math.round(tris.reduce((s, t) => s + t.area, 0)), brute(grid), 'patch splitting preserves the total surface area');
  for (const u of data.uvs) assert.ok(u >= 0 && u <= 1, 'UVs are 0..1: each patch is one stretched texture');
  // Every patch is at most 6 world units each way, so an 8-wide wall becomes two patches, not one stretched across 8.
  for (let q = 0; q < data.positions.length / 12; q++) {
    const p = i => [data.positions[(q * 4 + i) * 3], data.positions[(q * 4 + i) * 3 + 1], data.positions[(q * 4 + i) * 3 + 2]];
    const box = [0, 1, 2].map(axis => Math.max(...[0, 1, 2, 3].map(i => p(i)[axis])) - Math.min(...[0, 1, 2, 3].map(i => p(i)[axis])));
    assert.ok(Math.max(...box) <= 6 + 1e-6, 'no patch exceeds the limit');
  }
  const innerNorth = tris.filter(t => Math.abs(t.stored[2] - 1) < 1e-6);
  assert.ok(innerNorth.length >= 4, 'the long inner wall was split into more than one patch');

  // Walls are upright: along a vertical wall, v follows world y and u follows the horizontal tangent.
  const wall = W.buildQuads([{ axis:'z', side:1, plane:2, a0:0, a1:4, b0:0, b1:3 }], { origin:{ x:0, y:0, z:0 }, size:{ x:1, y:1, z:1 }, patch:{ h:99, v:99 } });
  for (let i = 0; i < 4; i++) {
    const y = wall.positions[i * 3 + 1], v = wall.uvs[i * 2 + 1], x = wall.positions[i * 3], u = wall.uvs[i * 2];
    assert.equal(v, y / 3, 'texture v runs with world height');
    assert.equal(u, x / 4, 'texture u runs along the wall');
  }
  assert.equal(W.buildQuads([], { origin, size }).positions.length, 0);
  // Cell size and origin carry through to world units.
  const scaled = W.buildQuads([{ axis:'x', side:-1, plane:1, a0:0, a1:1, b0:0, b1:1 }], { origin:{ x:1, y:2, z:3 }, size:{ x:2, y:4, z:2 }, patch:{ h:99, v:99 } });
  assert.deepEqual([...new Set([0, 1, 2, 3].map(i => scaled.positions[i * 3]))], [3], 'plane x = origin + plane * cell size');
  assert.deepEqual([0, 1, 2, 3].map(i => scaled.positions[i * 3 + 1]).sort((a, b) => a - b), [2, 2, 6, 6], 'y spans one cell height');
}

// --- thin edge walls ---------------------------------------------------------------------
{
  const unit = (along, line, from) => ({ along, line, from, to:from + 1 });
  const runs = W.mergeEdges([unit('x', 5, 3), unit('x', 5, 1), unit('x', 5, 2), unit('x', 9, 3), unit('z', 5, 3), unit('x', 5, 7)]);
  assert.deepEqual(runs.filter(r => r.along === 'x' && r.line === 5).map(r => [r.from, r.to]), [[1, 4], [7, 8]], 'touching unit edges on one line merge; a gap keeps two runs');
  assert.equal(runs.length, 4, 'other lines and the other axis stay separate');
  const quads = W.buildEdgeWallQuads([{ along:'x', line:5, from:1, to:4 }], { y0:4, y1:6.3, thickness:.14, patch:{ h:6, v:6 } });
  const tris = triNormals(quads);
  assert.equal(tris.length, 4, 'one run = two faces, one each way');
  assert.deepEqual([...new Set(tris.map(t => t.stored[2]))].sort(), [-1, 1]);
  for (const t of tris) assert.ok(t.n[0] * t.stored[0] + t.n[1] * t.stored[1] + t.n[2] * t.stored[2] > 0, 'both faces wind outward');
  const zs = [...new Set(Array.from({ length:quads.positions.length / 3 }, (_, i) => quads.positions[i * 3 + 2]))].sort((a, b) => a - b);
  assert.ok(Math.abs(zs[0] - 4.93) < 1e-6 && Math.abs(zs[1] - 5.07) < 1e-6, 'faces sit half a thickness either side of the line');
  const long = W.buildEdgeWallQuads([{ along:'z', line:0, from:0, to:13 }], { y0:0, y1:2.3, thickness:.14, patch:{ h:6, v:6 } });
  assert.equal(triNormals(long).length, 2 * 3 * 2, 'a 13-long wall is split into three patches per side');
}

// --- single-sided walls: a wall remembers which way it faces -----------------------------
{
  const e = (along, line, from, side) => ({ along, line, from, to:from + 1, side });
  const runs = W.mergeEdges([e('x', 5, 1, 1), e('x', 5, 2, 1), e('x', 5, 1, -1), e('x', 5, 2, -1), e('x', 5, 3, -1)]);
  assert.equal(runs.length, 2, 'the two sides of one line never merge into each other');
  assert.deepEqual(runs.map(r => [r.side, r.from, r.to]).sort((a, b) => a[0] - b[0]), [[-1, 1, 4], [1, 1, 3]], 'but touching edges on the same side still do');
  const facing = W.buildEdgeWallQuads([{ along:'z', line:7, from:0, to:3, side:-1 }], { y0:0, y1:2, thickness:.2, patch:{ h:6, v:6 } });
  const tris = triNormals(facing);
  assert.equal(tris.length, 2, 'a run with a side gets exactly one face');
  assert.deepEqual([...new Set(tris.map(t => t.stored[0]))], [-1], 'facing the way it was told');
  for (const t of tris) assert.ok(t.n[0] * t.stored[0] + t.n[1] * t.stored[1] + t.n[2] * t.stored[2] > 0, 'wound outward');
  assert.deepEqual([...new Set(Array.from({ length:facing.positions.length / 3 }, (_, i) => facing.positions[i * 3]))].map(v => +v.toFixed(6)), [6.9], 'set half a thickness toward the side it faces');
  const sideless = W.mergeEdges([{ along:'x', line:1, from:0, to:1 }, { along:'x', line:1, from:1, to:2 }]);
  assert.equal(sideless.length, 1); assert.equal(sideless[0].side, undefined, 'a wall with no side stays two-faced');
}

console.log('ruin wall faces regression passed');
