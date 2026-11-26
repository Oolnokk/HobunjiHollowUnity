#!/usr/bin/env node
'use strict';
// Golden-output regression for HobunjiSurfaceStretchUV.mapGeometry. The topology step interns vertex keys to integers and
// uses numeric edge keys (a wilderness zone's mesa build was dominated by string edge keys); this proves the UVs are
// bit-identical to what the original string-key implementation produced for the same deterministic meshes (hashes below
// were generated from the pre-change code).
//
// Needs a real three.js (BufferGeometry/Vector3/MathUtils). The repo vendors none (it loads r128 from a CDN), so point
// THREE_PATH at a three.min.js (or `npm i three@0.128.0`); without one the test reports a skip and passes.
//   GEN=1 node scripts/test-surface-stretch-topology-equivalence.js   -> prints fresh hashes
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadThree() {
  const candidates = [process.env.THREE_PATH, 'three'].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (candidate === 'three') return require('three');
      const sandbox = { window: {}, self: {}, console };
      sandbox.self = sandbox.window; sandbox.globalThis = sandbox.window;
      vm.runInNewContext(fs.readFileSync(candidate, 'utf8'), sandbox);
      if (sandbox.window.THREE || sandbox.THREE) return sandbox.window.THREE || sandbox.THREE;
    } catch (_) { /* try next */ }
  }
  return null;
}
const THREE = loadThree();
if (!THREE) { console.log('surface stretch topology equivalence: SKIPPED (no three.js; set THREE_PATH or npm i three@0.128.0)'); process.exit(0); }

const sourceFile = process.env.STRETCH_SOURCE || path.join(__dirname, '..', 'docs/js/surface-stretch-uv-furniture.js');
const win = { THREE, __farmLog() {} };
win.window = win;
vm.runInNewContext(fs.readFileSync(sourceFile, 'utf8'), { window: win, console: { debug() {}, warn() {}, log() {} }, Map, Set, WeakMap, WeakSet, Float32Array, Float64Array, Uint8Array, Uint16Array, Uint32Array, Math, Number, Object, Array, JSON, Infinity, performance: { now: () => 0 } });
const mapper = win.HobunjiSurfaceStretchUV;
assert.ok(mapper?.mapGeometry, 'mapper installed');

let seed = 20261126;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// A tiered heightfield mesa: indexed top grid + vertical cliff skirts wherever neighbouring heights differ.
function mesa(cols, rows, { holes = false, pieces = false, groups = false } = {}) {
  const h = Array.from({ length: rows + 1 }, (_, r) => Array.from({ length: cols + 1 }, (_, c) => {
    const edge = c < 2 || r < 2 || c > cols - 2 || r > rows - 2;
    return edge ? 0 : (Math.floor(((c * 7 + r * 13) % 5) / 2) * 1.5 + rnd() * 0.12);
  }));
  const pos = [], index = [], pieceIds = [];
  const vert = (x, y, z, piece = 0) => { pos.push(x, y, z); pieceIds.push(piece); return pos.length / 3 - 1; };
  const quad = (a, b, c, d) => index.push(a, b, c, a, c, d);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (holes && c > 5 && c < 9 && r > 5 && r < 9) continue; // an interior hole -> extra boundary loop
    const piece = pieces && c >= cols / 2 ? 1 : 0;
    quad(vert(c, h[r][c], r, piece), vert(c, h[r + 1][c], r + 1, piece), vert(c + 1, h[r + 1][c + 1], r + 1, piece), vert(c + 1, h[r][c + 1], r, piece));
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c + 1 < cols; c++) { // skirts between columns
    const a = h[r][c + 1], b = h[r + 1][c + 1];
    if (Math.abs(a - 0) > 0.8 && c === 1) quad(vert(c + 1, 0, r), vert(c + 1, a, r), vert(c + 1, b, r + 1), vert(c + 1, 0, r + 1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (pieces) g.setAttribute('surfacePieceId', new THREE.Float32BufferAttribute(pieceIds, 1));
  g.setIndex(index);
  if (groups) { g.clearGroups(); g.addGroup(0, Math.floor(index.length / 2 / 3) * 3, 0); g.addGroup(Math.floor(index.length / 2 / 3) * 3, index.length - Math.floor(index.length / 2 / 3) * 3, 1); }
  return g;
}

function hashUv(geometry) {
  let h = 2166136261 >>> 0;
  const f = new Float32Array(1), u = new Uint32Array(f.buffer);
  for (const name of ['position', 'uv']) {
    const a = geometry.getAttribute(name);
    if (!a) { h = Math.imul(h ^ 7, 16777619) >>> 0; continue; }
    for (let i = 0; i < a.array.length; i++) { f[0] = a.array[i]; h = Math.imul(h ^ u[0], 16777619) >>> 0; }
  }
  return h.toString(16);
}

const cases = {
  mesa_plain: () => mapper.mapGeometry(mesa(24, 24)),
  mesa_holes: () => mapper.mapGeometry(mesa(18, 18, { holes: true })),
  mesa_pieces: () => mapper.mapGeometry(mesa(20, 16, { pieces: true })),
  mesa_material_slot: () => mapper.mapGeometry(mesa(20, 20, { groups: true }), { materialIndex: 1 }),
  mesa_angle_tight: () => mapper.mapGeometry(mesa(22, 22), { angleToleranceDeg: 8, splitAtThreshold: true }),
  mesa_quad_pairs: () => mapper.mapGeometry(mesa(16, 16), { preserveQuadPairs: true, avoidCollapsedUvs: true }),
  mesa_edge_opts: () => mapper.mapGeometry(mesa(20, 20), { edgeSourceFraction: 0.2, edgeReferenceWorldSize: 4, ignoreReversedCoplanarFaces: true }),
};
const GOLDEN = {
  mesa_plain: 'ddd153f1',
  mesa_holes: '69422e43',
  mesa_pieces: 'adc79e14',
  mesa_material_slot: 'af72cab6',
  mesa_angle_tight: '80fff0dc',
  mesa_quad_pairs: 'b096f5c4',
  mesa_edge_opts: '660f863a',
};
const results = {};
for (const [name, build] of Object.entries(cases)) { seed = 20261126 + name.length; results[name] = hashUv(build()); }
if (process.env.GEN) { console.log(JSON.stringify(results, null, 2)); process.exit(0); }
for (const [name, hash] of Object.entries(results)) assert.equal(hash, GOLDEN[name], `${name}: UVs changed (${hash} vs golden ${GOLDEN[name]})`);
console.log('surface stretch topology equivalence passed (' + Object.keys(results).length + ' meshes bit-identical)');
