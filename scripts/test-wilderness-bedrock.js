#!/usr/bin/env node
'use strict';

// Executes js/wilderness-bedrock.js against a synthetic zone grid with a minimal
// THREE stand-in and checks the geometric invariants that keep it safe:
// every bedrock surface stays below the real ground, tier steps get risers, and
// a waterfall cell above a lower neighbour gets a backing wall at the shared edge.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class Attr { constructor(array, size) { this.array = Array.from(array); this.itemSize = size; this.count = this.array.length / size; } }
class BufferGeometry {
  constructor() { this.attributes = {}; this.index = null; }
  setAttribute(name, attr) { this.attributes[name] = attr; }
  setIndex(attr) { this.index = attr; }
  computeVertexNormals() {}
  computeBoundingSphere() {}
}
class Material {
  constructor(opts = {}) { Object.assign(this, opts); this.color = { multiplyScalar() {} }; }
  clone() { return new Material(this); }
}
class Mesh { constructor(geometry, material) { this.geometry = geometry; this.material = material; this.userData = {}; } }
const THREE = {
  BufferGeometry, Mesh, DoubleSide: 2,
  Float32BufferAttribute: Attr,
  BufferAttribute: Attr,
  MeshLambertMaterial: Material,
};
const context = { window: { THREE } };
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/wilderness-bedrock.js', 'utf8'), context);
const { WildernessBedrock } = context.window;
assert(WildernessBedrock, 'wilderness-bedrock.js must expose window.WildernessBedrock');

const TileType = { GRASS: 'grass', RAMP: 'ramp', RIVER: 'river', STREAM: 'stream', WATERFALL: 'waterfall', TRENCH: 'trench' };
const NORMAL_TOP = 0, PLATEAU_UNIT = 2.5;
const DEPRESSION_TOP = { trench: -0.5, river: -0.55, stream: -0.55, waterfall: -0.55 };
const added = [];
const edgeMarks = [];
WildernessBedrock.init({
  NORMAL_TOP, PLATEAU_UNIT, TileType, DEPRESSION_TOP,
  displaceZoneGeometry: g => g,
  markTerrainEdgeId: (mesh, category) => edgeMarks.push([mesh, category]),
  edgeCategory: 'rock',
});

// 6x4 zone: tier-0 ground in the west half, tier-2 plateau in the east half,
// and a waterfall cell on the plateau lip beside the lower ground.
const cols = 6, rows = 4;
const grid = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => ({ type: TileType.GRASS, elevTier: c >= 3 ? 2 : 0 })));
grid[1][3] = { type: TileType.WATERFALL, elevTier: 2 };
const scene = { add: o => added.push(o) };

const mesh = WildernessBedrock.build(scene, grid, cols, rows, 'map_test');
assert(mesh && added[0] === mesh, 'build must add one persistent mesh to the zone scene');
assert.strictEqual(mesh.userData.wildernessBedrock, true);
assert.strictEqual(mesh.material.side, THREE.DoubleSide, 'risers are viewed from either side');
assert(mesh.material.polygonOffset, 'bedrock must be pushed back in depth so real surfaces win coplanar overlaps');
assert.strictEqual(edgeMarks.length, 1, 'bedrock joins the terrain edge-id pass like other ground meshes');

const pos = mesh.geometry.attributes.position.array;
const quads = pos.length / 12;
assert(quads > 0, 'expected bedrock quads');
const snap = WildernessBedrock.snapshot().map_test;
assert.strictEqual(snap.quads, quads);
assert(snap.backingWalls >= 1, 'the waterfall cell above lower ground needs a backing wall');

// Flat bedrock surfaces never reach any real ground: the highest ground
// anywhere is the tier-2 plateau (5.0), and flat tops sit 0.9 below the local
// minimum. Walls may only reach the water bed seat (inside the bed's own cut wall).
const flatTops = [];
let maxWall = -Infinity;
for (let q = 0; q < quads; q++) {
  const ys = [pos[q * 12 + 1], pos[q * 12 + 4], pos[q * 12 + 7], pos[q * 12 + 10]];
  if (ys.every(y => y === ys[0])) flatTops.push(ys[0]);
  else maxWall = Math.max(maxWall, ...ys);
}
assert(Math.max(...flatTops) <= 2 * PLATEAU_UNIT - 0.9 + 1e-6, `flat bedrock must stay below the plateau surface (max y ${Math.max(...flatTops)})`);
assert(maxWall <= 2 * PLATEAU_UNIT - 0.55 + 0.05 + 1e-4, `walls must stop inside the water bed (max y ${maxWall})`);

// Flat tops: west cells see only tier 0 except the column beside the plateau,
// whose 3x3 neighbourhood includes the tier-2 cells but still bottoms at tier 0.
assert(flatTops.some(y => Math.abs(y + 0.9) < 1e-5), 'lowland tops sit BEDROCK_DEPTH below tier 0');

// A riser must span the tier step: some wall quad reaching from the lowland
// bedrock level up to the plateau-side bedrock level on a constant-X plane.
const stepRiser = [...Array(quads).keys()].some(q => {
  const xs = [0, 3, 6, 9].map(k => pos[q * 12 + k]);
  const ys = [1, 4, 7, 10].map(k => pos[q * 12 + k]);
  return xs.every(x => x === xs[0]) && Math.min(...ys) <= -0.9 + 1e-5 && Math.max(...ys) > Math.min(...ys);
});
assert(stepRiser, 'expected a riser where neighbouring bedrock heights differ');

// The waterfall at (3,1) sits at tier 2 beside lower ground at (2,1): its backing
// wall lies on the shared edge x=3, spanning row 1, from lower bedrock to just above the bed.
const bed = 2 * PLATEAU_UNIT - 0.55;
const backing = [...Array(quads).keys()].some(q => {
  const xs = [0, 3, 6, 9].map(k => pos[q * 12 + k]);
  const zs = [2, 5, 8, 11].map(k => pos[q * 12 + k]);
  const ys = [1, 4, 7, 10].map(k => pos[q * 12 + k]);
  return xs.every(x => x === 3) && Math.min(...zs) === 1 && Math.max(...zs) === 2 &&
    Math.abs(Math.max(...ys) - (bed + 0.05)) < 1e-6;
});
assert(backing, 'expected a backing wall behind the waterfall at its lower-neighbour edge');

console.log('wilderness bedrock: ok (' + quads + ' quads)');
