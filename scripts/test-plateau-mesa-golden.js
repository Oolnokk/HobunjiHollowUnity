#!/usr/bin/env node
'use strict';
// Golden-output regression for ZonePlateauMesa.buildPlateauMesa (vertex heights, UVs, indices, material groups, normals and the
// mesaCliffFace tile flags). The function's per-vertex/per-quad bookkeeping (inMask, BFS, own-mask/ramp/carved quad gates) was
// optimized to avoid string keys and per-step allocations; these hashes come from the pre-change implementation, so any drift in
// the generated terrain fails here.
//
// Needs a real three.js (BufferGeometry/computeVertexNormals): THREE_PATH=/path/to/three.min.js or `npm i three@0.128.0`.
// Without one the test reports a skip and passes.   GEN=1 prints fresh hashes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadThree() {
  for (const candidate of [process.env.THREE_PATH, 'three'].filter(Boolean)) {
    try {
      if (candidate === 'three') return require('three');
      const sandbox = { window: {}, console }; sandbox.self = sandbox.window;
      vm.runInNewContext(fs.readFileSync(candidate, 'utf8'), sandbox);
      if (sandbox.window.THREE || sandbox.THREE) return sandbox.window.THREE || sandbox.THREE;
    } catch (_) { /* next */ }
  }
  return null;
}
const THREE = loadThree();
if (!THREE) { console.log('plateau mesa golden: SKIPPED (no three.js; set THREE_PATH or npm i three@0.128.0)'); process.exit(0); }

const sourceFile = process.env.MESA_SOURCE || path.join(__dirname, '..', 'docs/js/zone-plateau-mesa.js');
const win = { THREE, CliffRouteNetwork: null };
win.window = win;
vm.runInNewContext(fs.readFileSync(sourceFile, 'utf8'), { window: win, THREE, console: { log() {}, warn() {}, debug() {} }, Map, Set, WeakMap, WeakSet, Float32Array, Float64Array, Int32Array, Uint8Array, Uint16Array, Uint32Array, Math, Number, Object, Array, JSON, Infinity, performance: { now: () => 0 }, queueMicrotask: () => {}, setTimeout: () => 0 });
const mod = win.ZonePlateauMesa;
assert.ok(mod?.buildPlateauMesa && mod.init, 'ZonePlateauMesa installed');

const TileType = { GRASS: 0, ROCK: 1, RIVER: 3, STREAM: 4, RAMP: 5, TRENCH: 6 };
mod.init({
  NORMAL_TOP: 0, PLATEAU_UNIT: 1.5, TileType, CARVED_TILE_TYPES: new Set([TileType.RIVER, TileType.STREAM, TileType.TRENCH]),
  isSolid: () => false, tileSurfaceYInArea: () => 0, getCurrentArea: () => 'map_test', ROCK_MOUND_CELLS_PER_TILE: 4,
  resolveTileMat: type => ({ type }), _zoneScenes: new Map(), _zoneLayouts: new Map(), _zoneMesaMeshGroups: new Map(),
  displaceZoneGeometry(geo) { const p = geo.getAttribute('position'); for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + Math.sin(p.getX(i) * 3.1 + p.getZ(i) * 1.7) * 0.01); },
});

let seed = 4242;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
function makeGrid(cols, rows, tiers) {
  return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => ({ type: TileType.GRASS, elevTier: tiers(c, r), incline: false })));
}
function hash(mesh, grid) {
  let h = 2166136261 >>> 0; const f = new Float32Array(1), u = new Uint32Array(f.buffer);
  const mix = v => { h = Math.imul(h ^ v, 16777619) >>> 0; };
  for (const name of ['position', 'uv', 'normal']) { const a = mesh.geometry.getAttribute(name); for (let i = 0; i < a.array.length; i++) { f[0] = a.array[i]; mix(u[0]); } }
  for (const i of mesh.geometry.index.array) mix(i);
  for (const g of mesh.geometry.groups) { mix(g.start); mix(g.count); mix(g.materialIndex); }
  for (const row of grid) for (const t of row) mix(t.mesaCliffFace ? 1 : 0);
  return h.toString(16);
}
const maskOf = (c0, r0, c1, r1, hole) => new Set(Array.from({ length: (c1 - c0 + 1) * (r1 - r0 + 1) }, (_, i) => [c0 + i % (c1 - c0 + 1), r0 + Math.floor(i / (c1 - c0 + 1))]).filter(([c, r]) => !(hole && hole(c, r))).map(([c, r]) => `${c},${r}`));

const cases = {
  rectangle_no_mask: () => { const g = makeGrid(24, 24, () => 0); return [g, { minC: 4, minR: 4, maxC: 17, maxR: 15, fromTier: 0, toTier: 1 }]; },
  irregular_mask: () => { const g = makeGrid(30, 30, () => 0); return [g, { minC: 3, minR: 3, maxC: 24, maxR: 22, fromTier: 0, toTier: 1, maskWorldKeys: maskOf(3, 3, 24, 22, (c, r) => (c * 3 + r * 5) % 7 === 0 || (c > 10 && c < 14 && r > 8 && r < 15)) }]; },
  neighbour_mesa_raised: () => { const g = makeGrid(30, 24, c => (c >= 18 ? 1 : 0)); return [g, { minC: 4, minR: 3, maxC: 17, maxR: 19, fromTier: 0, toTier: 1, maskWorldKeys: maskOf(4, 3, 17, 19) }]; },
  with_ramps: () => { const g = makeGrid(26, 26, () => 0); for (let r = 8; r < 14; r++) for (let c = 9; c < 12; c++) { g[r][c].type = TileType.RAMP; g[r][c].rampElevation = (r - 8) / 5 * 1; } return [g, { minC: 3, minR: 3, maxC: 22, maxR: 22, fromTier: 0, toTier: 1, maskWorldKeys: maskOf(3, 3, 22, 22) }]; },
  with_carved_and_inclines: () => { const g = makeGrid(26, 26, () => 0); for (let r = 6; r < 18; r++) { g[r][12].type = TileType.RIVER; g[r][13].type = TileType.STREAM; } for (let c = 5; c < 10; c++) g[20][c].incline = true; return [g, { minC: 2, minR: 2, maxC: 23, maxR: 23, fromTier: 0, toTier: 1, maskWorldKeys: maskOf(2, 2, 23, 23, (c, r) => c === 6 && r < 10) }]; },
  upper_tier_on_lower: () => { const g = makeGrid(28, 28, (c, r) => (c > 6 && c < 20 && r > 6 && r < 20 ? 1 : 0)); return [g, { minC: 9, minR: 9, maxC: 16, maxR: 16, fromTier: 1, toTier: 2, maskWorldKeys: maskOf(9, 9, 16, 16) }]; },
  large_world_coords: () => { const g = makeGrid(130, 120, (c, r) => (c >= 95 && c < 110 && r > 40 && r < 90 ? 1 : 0)); for (let r = 50; r < 56; r++) { g[r][70].type = TileType.RAMP; g[r][70].rampElevation = 0.5; } return [g, { minC: 60, minR: 38, maxC: 94, maxR: 92, fromTier: 0, toTier: 1, maskWorldKeys: maskOf(60, 38, 94, 92, (c, r) => (c * 7 + r * 3) % 13 === 0) }]; },
  edge_of_world: () => { const g = makeGrid(16, 16, () => 0); return [g, { minC: 0, minR: 0, maxC: 15, maxR: 15, fromTier: 0, toTier: 1, maskWorldKeys: maskOf(0, 0, 15, 15) }]; },
};
const GOLDEN = {
  rectangle_no_mask: 'edf6144f',
  irregular_mask: '1d521db',
  neighbour_mesa_raised: '94a91626',
  with_ramps: '28bc0299',
  with_carved_and_inclines: 'a9138884',
  upper_tier_on_lower: 'f8f40c19',
  large_world_coords: '3fc8df0f',
  edge_of_world: 'ac90ca2a',
};
const results = {};
const zScene = { add() {} };
for (const [name, build] of Object.entries(cases)) {
  seed = 4242 + name.length;
  const [grid, bb] = build();
  const mesh = mod.buildPlateauMesa(zScene, 'map_test', name, bb, (bb.toTier - bb.fromTier) * 1.5, bb.fromTier * 1.5, grid);
  results[name] = hash(mesh, grid);
}
if (process.env.GEN) { console.log(JSON.stringify(results, null, 2)); process.exit(0); }
for (const [name, value] of Object.entries(results)) assert.equal(value, GOLDEN[name], `${name}: generated mesa changed (${value} vs golden ${GOLDEN[name]})`);
console.log(`plateau mesa golden passed (${Object.keys(results).length} meshes bit-identical)`);
