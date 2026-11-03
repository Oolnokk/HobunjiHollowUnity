#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const G = require('../docs/js/cell-grid-3d.js');
const CS = require('../docs/js/climb-surfaces.js');
const FE = require('../docs/js/furniture-elevation.js');
const CWT = require('../docs/js/climb-wall-tiles.js');
const near = (a, b, msg) => assert(Math.abs(a - b) < 1e-6, `${msg || ''} expected ${b}, got ${a}`);

const DIR_DIR = path.join(__dirname, '..', 'docs', 'config', 'furniture-authored');
const load = key => JSON.parse(fs.readFileSync(path.join(DIR_DIR, `${key}.json`), 'utf8'));
const KEYS = { mid: 'ruinClimbHoldsMid', endLeft: 'ruinClimbHoldsEndLeft', endRight: 'ruinClimbHoldsEndRight', single: 'ruinClimbHoldsSingle' };
const pieces = Object.fromEntries(Object.entries(KEYS).map(([role, key]) => [role, load(key)]));

// --- the authored set is internally consistent ------------------------------------
assert.deepEqual(CWT.validateSet(KEYS.mid, key => load(key).climbWall), [], 'the shipped set validates');
const index = JSON.parse(fs.readFileSync(path.join(DIR_DIR, 'index.json'), 'utf8')).furniture.map(e => e.key);
for (const key of Object.values(KEYS)) assert(index.includes(key), `${key} is listed in the authored furniture index`);

// Axis-aligned bounds of a piece built only from unrotated boxes (what these pieces are).
function bounds(data, filter = () => true) {
  const b = { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } };
  for (const p of data.parts.filter(filter)) {
    const t = p.transform; assert.equal(p.kind, 'box'); assert(!t.rx && !t.ry && !t.rz, 'unrotated');
    for (const [a, c, s] of [['x', t.x, t.sx], ['y', t.y, t.sy], ['z', t.z, t.sz]]) { b.min[a] = Math.min(b.min[a], c - s / 2); b.max[a] = Math.max(b.max[a], c + s / 2); }
  }
  return b;
}
for (const [role, data] of Object.entries(pieces)) {
  const measured = FE.measureBounds(bounds(data));
  assert.deepEqual([measured.cellsW, measured.cellsD, measured.cellsH], [1, 1, 1], `${role}: exactly one cell wide, deep and tall (full tile height)`);
  assert.deepEqual(FE.checkCells(data.elevation, { cellsW: 1, cellsH: 1 }), [], `${role}: elevation block agrees`);
  for (const k of ['sizeX', 'sizeY', 'sizeZ', 'minY', 'maxY', 'cellsW', 'cellsD', 'cellsH']) near(data.elevation.measured[k], measured[k], `${role}: stored elevation.measured.${k} matches the geometry`);
  const b = bounds(data);
  near(b.min.x, -0.5); near(b.max.x, 0.5); near(b.min.y, 0); near(b.max.y, 1);
  const face = data.climbWall.face.offset, slabFront = data.parts.find(p => p.id === 'slab').transform;
  near(slabFront.z + slabFront.sz / 2, face, `${role}: climbWall.face.offset is the slab's front plane`);
}

// --- seamless: neighbouring tiles continue the pattern ---------------------------------
const mid = pieces.mid, holds = mid.parts.filter(p => p.id.startsWith('hold_')).map(p => p.transform);
for (const h of holds) assert(h.x - h.sx / 2 >= -0.5 && h.x + h.sx / 2 <= 0.5, 'no hold straddles a tile boundary');
for (const row of new Set(holds.map(h => h.y))) {
  const xs = []; for (let tile = 0; tile < 3; tile++) for (const h of holds.filter(q => q.y === row)) xs.push(h.x + tile);
  xs.sort((a, b) => a - b);
  const gaps = xs.slice(1).map((x, i) => x - xs[i]); gaps.forEach(g => near(g, 0.5, 'hold spacing is uniform across tile boundaries'));
}
const slabs = pieces.mid.parts.find(p => p.id === 'slab').transform;
near(slabs.sx, 1); near(slabs.x, 0); near(slabs.sy, 1, 'slab fills the cell height, so tiles also stack vertically');
for (const role of ['endLeft', 'endRight', 'single']) {
  const own = pieces[role].parts, extra = own.filter(p => !mid.parts.some(m => m.id === p.id));
  assert(extra.length >= 1 && extra.every(p => p.id.startsWith('post_')), `${role} differs from mid only by end posts`);
  for (const post of extra) {
    near(Math.abs(post.transform.x) + post.transform.sx / 2, 0.5, `${role}: end post is flush with the tile edge`);
    for (const h of holds) assert(Math.abs(post.transform.x - h.x) > (post.transform.sx + h.sx) / 2, `${role}: post clears the handholds`);
  }
}
assert.deepEqual(pieces.endLeft.parts.filter(p => p.id.startsWith('post_')).map(p => p.id), ['post_L']);
assert.deepEqual(pieces.endRight.parts.filter(p => p.id.startsWith('post_')).map(p => p.id), ['post_R']);
assert.deepEqual(pieces.single.parts.filter(p => p.id.startsWith('post_')).map(p => p.id).sort(), ['post_L', 'post_R']);

// --- validateSet catches authoring mistakes ---------------------------------------------
const bad = structuredClone(Object.fromEntries(Object.values(KEYS).map(k => [k, load(k)])));
bad.ruinClimbHoldsEndLeft.climbWall.face.offset = -0.1;
bad.ruinClimbHoldsEndRight.climbWall.role = 'endLeft';
bad.ruinClimbHoldsSingle.climbWall.style = 'ivy';
const problems = CWT.validateSet(KEYS.mid, k => bad[k]?.climbWall);
assert.equal(problems.length, 3); assert(problems.some(p => /face plane/.test(p)) && problems.some(p => /role "endRight"/.test(p)) && problems.some(p => /style/.test(p)));
assert(CWT.validateSet('nope', () => null)[0].includes('no enabled climbWall'));
assert.equal(CWT.normalize({ enabled: false }), null);
assert.equal(CWT.normalize({ enabled: true, role: 'bogus', face: { side: 'up' } }).role, 'mid');
assert.equal(CWT.normalize({ enabled: true, face: { side: 'up' } }).face.side, '+z');

// --- run resolution ----------------------------------------------------------------------
const S = { x: 0, z: 1 }, N = { x: 0, z: -1 }, E = { x: 1, z: 0 }, W = { x: -1, z: 0 };
const T = (id, col, row, normal, level = 0, style = 'holds') => ({ id, col, row, level, normal, style });
const roles = tiles => Object.fromEntries([...CWT.resolveRuns(tiles).variants]);

assert.deepEqual(roles([T('a', 3, 4, S)]), { a: 'single' });
assert.deepEqual(roles([T('a', 3, 4, S), T('b', 4, 4, S)]), { a: 'endLeft', b: 'endRight' }, 'facing a +z wall, right is +x');
assert.deepEqual(roles([T('a', 3, 4, N), T('b', 4, 4, N)]), { a: 'endRight', b: 'endLeft' }, 'facing a -z wall, right is -x');
assert.deepEqual(roles([T('a', 4, 3, E), T('b', 4, 4, E)]), { a: 'endRight', b: 'endLeft' }, 'facing a +x wall, right is -z');
assert.deepEqual(roles([T('a', 4, 3, W), T('b', 4, 4, W)]), { a: 'endLeft', b: 'endRight' }, 'facing a -x wall, right is +z');
assert.deepEqual(roles([T('a', 0, 0, S), T('b', 1, 0, S), T('c', 2, 0, S), T('d', 3, 0, S)]), { a: 'endLeft', b: 'mid', c: 'mid', d: 'endRight' });
assert.deepEqual(roles([T('a', 0, 0, S), T('b', 1, 0, S), T('c', 3, 0, S)]), { a: 'endLeft', b: 'endRight', c: 'single' }, 'a gap splits runs');
assert.deepEqual(roles([T('a', 0, 0, S), T('b', 1, 0, S, 1)]), { a: 'single', b: 'single' }, 'different levels never join');
assert.deepEqual(roles([T('a', 0, 0, S), T('b', 1, 0, S, 0, 'ivy')]), { a: 'single', b: 'single' }, 'different styles never join');
assert.deepEqual(roles([T('a', 0, 0, S), T('b', 1, 1, S)]), { a: 'single', b: 'single' }, 'different wall planes never join');
assert.deepEqual(roles([T('a', 0, 0, S), T('b', 1, 0, N)]), { a: 'single', b: 'single' }, 'opposite facings never join');
const dup = CWT.resolveRuns([T('a', 0, 0, S), T('b', 0, 0, S), T('c', 1, 0, S)]);
assert.deepEqual(dup.duplicates, ['b']); assert.deepEqual(dup.runs, [['a', 'c']]);
assert.deepEqual(CWT.resolveRuns([T('x', 2, 0, S), T('w', 0, 0, S), T('y', 1, 0, S)]).runs, [['w', 'y', 'x']], 'input order does not matter');

assert.equal(CWT.variantKey(KEYS.mid, mid.climbWall, 'mid'), KEYS.mid);
assert.equal(CWT.variantKey(KEYS.mid, mid.climbWall, 'endLeft'), KEYS.endLeft);
assert.equal(CWT.variantKey(KEYS.mid, { enabled: true, variants: {} }, 'single'), KEYS.mid, 'missing variants fall back to mid');

// --- the end posts land at the correct end of the run, for every orientation ----------------
const geom = { originX: 4, originZ: 7, baseY: 2, cellSize: 1, cellHeight: 1 };
for (const normal of [S, N, E, W]) {
  const right = CWT.rightOf(normal), along = normal.x ? 'row' : 'col'; // tiles run along row for E/W walls
  const tiles = [0, 1, 2].map(i => ({ ...T('t' + i, 5, 5, normal), [along]: 5 + i }));
  const { variants } = CWT.resolveRuns(tiles);
  const world = {};
  for (const t of tiles) {
    const role = variants.get(t.id), data = load(KEYS[role]), pl = CWT.placementFor(t, geom, data.climbWall), yaw = pl.yawDeg * Math.PI / 180;
    // three.js rotation.y: local (lx, 0, lz) -> (lx cos + lz sin, -lx sin + lz cos)
    const rot = (lx, lz) => ({ x: pl.x + lx * Math.cos(yaw) + lz * Math.sin(yaw), z: pl.z - lx * Math.sin(yaw) + lz * Math.cos(yaw) });
    // the piece's local +z (its face) must point along the wall normal
    const faceDir = rot(0, 1); near(faceDir.x - pl.x, normal.x, 'face points along normal'); near(faceDir.z - pl.z, normal.z, 'face points along normal');
    world[t.id] = { role, posts: data.parts.filter(p => p.id.startsWith('post_')).map(p => rot(p.transform.x, p.transform.z)), center: pl };
  }
  const dotRight = p => p.x * right.x + p.z * right.z;
  const outer = Object.values(world).flatMap(w => w.posts.map(p => dotRight(p)));
  const centers = Object.values(world).map(w => dotRight(w.center));
  const lo = Math.min(...centers) - 0.5, hi = Math.max(...centers) + 0.5;
  assert.equal(outer.length, 2, 'a 3-tile run has exactly two end posts');
  near(Math.min(...outer), lo + 0.06, 'the left post sits at the run\'s left edge');
  near(Math.max(...outer), hi - 0.06, 'the right post sits at the run\'s right edge');
  const leftPost = world.t0 ? Object.values(world).find(w => w.role === 'endLeft').posts[0] : null;
  assert(dotRight(leftPost) < Math.min(...centers), 'the endLeft piece\'s post is on the left side');
}

// --- surfaces agree with the placed art ----------------------------------------------------
for (const normal of [S, N, E, W]) {
  const along = normal.x ? 'row' : 'col';
  const tiles = [0, 1, 2].map(i => ({ ...T('t' + i, 5, 5, normal, 1), [along]: 5 + i }));
  const surfaces = CWT.toSurfaces(tiles, mid.climbWall, geom);
  assert.equal(surfaces.length, 1, 'a run merges into one wall');
  const s = surfaces[0], pl = CWT.placementFor(tiles[0], geom, mid.climbWall);
  const planePos = normal.x ? pl.x + normal.x * mid.climbWall.face.offset : pl.z + normal.z * mid.climbWall.face.offset;
  near(s.plane, planePos, 'surface plane equals the slab front in world space');
  near(s.u1 - s.u0, 3, 'three tiles wide'); near(s.y0, 3, 'baseY + level'); near(s.y1, 4, 'one cell tall');
  assert.deepEqual(s.normal, normal); assert.equal(s.style, 'holds');
}

// --- end to end: register and grab ---------------------------------------------------------
CS.clearScope('cwt-test');
const run = [0, 1, 2].map(i => T('t' + i, 5 + i, 5, S));
assert.equal(CWT.register(CS, run, mid.climbWall, geom, { scope: 'cwt-test' }), 1);
const front = { x: 4 + 6.5, z: 7 + 5.5 + (-0.3) + 0.5, y: 0 + 2 };   // half a tile in front of the face, standing on the floor under it
const hit = CS.findGrabTarget(front, Math.atan2(-1, 0), { scope: 'cwt-test' });
assert(hit, 'a player facing the tile run can grab it');
assert.equal(hit.surface.style, 'holds');
assert.equal(CS.findGrabTarget({ ...front, x: 4 + 9.2 }, Math.atan2(-1, 0), { scope: 'cwt-test' }), null, 'beyond the end of the run there is nothing to grab');

console.log('climb-wall-tiles: ok');
