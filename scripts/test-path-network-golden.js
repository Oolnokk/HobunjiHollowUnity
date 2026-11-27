#!/usr/bin/env node
'use strict';
// Golden-output regression for TerrainGeometry.buildPathNetworkGeo (the zone-wide worn-path heightfield): positions, shared split
// normals, path/grass index lists and the tile exclusion query. The route mask build and its 3x blur were optimized to avoid
// per-vertex allocations while keeping the exact float summation order; hashes come from the pre-change implementation.
//
// Needs a real three.js: THREE_PATH=/path/to/three.min.js or `npm i three@0.128.0`; otherwise this reports a skip and passes.
// GEN=1 prints fresh hashes.
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
if (!THREE) { console.log('path network golden: SKIPPED (no three.js; set THREE_PATH or npm i three@0.128.0)'); process.exit(0); }

const sourceFile = process.env.TERRAIN_SOURCE || path.join(__dirname, '..', 'docs/js/terrain-geometry.js');
const win = { THREE, location: { search: '' } };
win.window = win;
vm.runInNewContext(fs.readFileSync(sourceFile, 'utf8'), { window: win, THREE, console: { log() {}, warn() {}, debug() {} }, Map, Set, WeakMap, WeakSet, Float32Array, Float64Array, Int32Array, Uint8Array, Uint16Array, Uint32Array, Math, Number, Object, Array, JSON, Infinity, performance: { now: () => 0 }, queueMicrotask: () => {}, setTimeout: () => 0 });
const mod = win.TerrainGeometry;
assert.ok(mod?.buildPathNetworkGeo && mod.init, 'TerrainGeometry installed');

const TileType = { GRASS: 0, PATH: 1, RIVER: 2, STREAM: 3, WATERFALL: 4, TRENCH: 5, RAISED: 6, SHRUB: 7, ROCK: 8, TILLED: 9, RAMP: 10, PADDY: 11 };
mod.init({
  TileType, CARVED_TILE_TYPES: new Set([TileType.RIVER, TileType.STREAM, TileType.WATERFALL, TileType.TRENCH, TileType.RAISED]),
  PLATEAU_UNIT: 1.5, NORMAL_TOP: 0, SLAB_H: 0.2, debugLog() {}, getGrid: () => [], sameWaterway: () => false,
});

let seed = 777;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
function makeGrid(cols, rows, fn) { return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => Object.assign({ type: TileType.GRASS, elevTier: 0 }, fn(c, r)))); }
function hashNetwork(net, cols, rows) {
  let h = 2166136261 >>> 0; const f = new Float32Array(1), u = new Uint32Array(f.buffer);
  const mix = v => { h = Math.imul(h ^ v, 16777619) >>> 0; };
  for (const key of ['pathGeo', 'grassGeo']) {
    const g = net[key]; if (!g) { mix(9); continue; }
    for (const name of ['position', 'normal']) { const a = g.getAttribute(name); for (let i = 0; i < a.array.length; i++) { f[0] = a.array[i]; mix(u[0]); } }
    for (const i of g.index.array) mix(i);
  }
  for (let r = -1; r <= rows; r++) for (let c = -1; c <= cols; c++) { mix(net.inBounds(c, r) ? 1 : 0); mix(net.isExcludedTile(c, r) ? 1 : 0); }
  return h.toString(16);
}

const cases = {
  winding_road: () => { const g = makeGrid(60, 50, (c, r) => ({ type: Math.abs(r - (25 + Math.round(10 * Math.sin(c / 6)))) <= 0 ? TileType.PATH : TileType.GRASS })); return [g, 60, 50]; },
  mixed_surfaces: () => { const g = makeGrid(64, 48, (c, r) => {
    if (r === 24 && c > 4 && c < 58) return { type: TileType.PATH };
    if (c === 30 && r > 10 && r < 40) return { type: TileType.PATH };
    if (c > 36 && c < 40 && r > 26 && r < 34) return { type: TileType.RIVER };
    if (c > 12 && c < 16 && r > 14 && r < 20) return { type: TileType.SHRUB };
    if (c > 44 && c < 50 && r > 28 && r < 32) return { type: TileType.RAMP, skipFloor: true };
    if (c === 20 && r > 26 && r < 36) return { type: TileType.GRASS, incline: true };
    if (c > 8 && c < 12 && r > 30 && r < 34) return { type: TileType.GRASS, mesaCliffFace: true, mesaGroundOwned: true };
    return {};
  }); return [g, 64, 48]; },
  plateau_route: () => { const g = makeGrid(50, 50, (c, r) => ({ type: (c === r || c === r + 1) && c > 4 && c < 45 ? TileType.PATH : TileType.GRASS, elevTier: c > 25 ? 1 : 0 })); return [g, 50, 50]; },
  scattered_stubs: () => { const g = makeGrid(48, 40, () => ({ type: rnd() < 0.04 ? TileType.PATH : TileType.GRASS })); return [g, 48, 40]; },
  edge_hugging: () => { const g = makeGrid(30, 30, (c, r) => ({ type: c === 0 || r === 0 || c === 29 || r === 29 ? TileType.PATH : TileType.GRASS })); return [g, 30, 30]; },
  large_zone: () => { const g = makeGrid(130, 120, (c, r) => ({ type: (Math.abs(r - (60 + Math.round(22 * Math.sin(c / 11)))) <= 1 || (c % 37 === 0 && r > 20)) ? TileType.PATH : TileType.GRASS, elevTier: (c > 90 && r < 50) ? 1 : 0 })); return [g, 130, 120]; },
};
const GOLDEN = {
  winding_road: '19c67329',
  mixed_surfaces: '376fba77',
  plateau_route: '683be6bd',
  scattered_stubs: 'd94bb145',
  edge_hugging: '43e21b65',
  large_zone: '936ad109',
};
const results = {};
for (const [name, build] of Object.entries(cases)) {
  seed = 777 + name.length;
  const [grid, cols, rows] = build();
  const net = mod.buildPathNetworkGeo(grid, cols, rows);
  results[name] = net ? hashNetwork(net, cols, rows) : 'null';
}
assert.equal(mod.buildPathNetworkGeo(makeGrid(8, 8, () => ({})), 8, 8), null, 'no path tiles -> null');
if (process.env.GEN) { console.log(JSON.stringify(results, null, 2)); process.exit(0); }
for (const [name, value] of Object.entries(results)) assert.equal(value, GOLDEN[name], `${name}: path network changed (${value} vs golden ${GOLDEN[name]})`);
console.log(`path network golden passed (${Object.keys(results).length} networks bit-identical)`);
