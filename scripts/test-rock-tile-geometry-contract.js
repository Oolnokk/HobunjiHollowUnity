#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Used for fail-fast runtime and source-contract assertions.
const fs = require('node:fs'); // Used to execute the real terrain module and inspect its live callers.
const vm = require('node:vm'); // Used to load the browser-style terrain module inside a tiny Three.js test harness.

const terrainSource = fs.readFileSync('docs/js/terrain-geometry.js', 'utf8'); // Production geometry source exercised below.
const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Wilderness/cavern callers must keep consuming the split return object.
const farmSource = fs.readFileSync('docs/js/vegetation-crop-rendering.js', 'utf8'); // Farm ROCK rendering must consume the same split API.
const houseLoader = fs.readFileSync('docs/js/house-pieces.js', 'utf8'); // The source fix must not depend on a late compatibility monkey-patch.

class FakeBufferAttribute {
  constructor(array, itemSize) {
    this.array = ArrayBuffer.isView(array) ? array : new Float32Array(array); // Preserves index-vs-float storage so production constructors behave normally.
    this.itemSize = itemSize; // Used by getX/getY/getZ and count below.
    this.count = this.array.length / itemSize; // Mirrors Three.js BufferAttribute's public count contract.
  }
  getX(index) { return this.array[index * this.itemSize]; }
  getY(index) { return this.array[index * this.itemSize + 1]; }
  getZ(index) { return this.array[index * this.itemSize + 2]; }
}

class FakeFloat32BufferAttribute extends FakeBufferAttribute {
  constructor(array, itemSize) { super(new Float32Array(array), itemSize); }
}

class FakeBufferGeometry {
  constructor() {
    this.attributes = {}; // Stores the production position/uv channels for direct inspection.
    this.index = null; // Stores the production triangle index buffer for winding/count checks.
    this.normalsComputed = false; // Records that production requested normal generation on each split geometry.
  }
  setAttribute(name, attribute) { this.attributes[name] = attribute; return this; }
  getAttribute(name) { return this.attributes[name]; }
  setIndex(attribute) { this.index = attribute; return this; }
  computeVertexNormals() { this.normalsComputed = true; }
}

const THREE = { // Minimal surface required by buildRockTileGeo; other terrain functions remain defined but uncalled.
  BufferGeometry: FakeBufferGeometry,
  BufferAttribute: FakeBufferAttribute,
  Float32BufferAttribute: FakeFloat32BufferAttribute,
};
const context = { window: {}, THREE, console, Math, Float32Array, Uint16Array, Uint32Array, Set, Map }; // Browser-like global scope for the real module.
vm.createContext(context);
vm.runInContext(terrainSource, context, { filename: 'terrain-geometry.js' });

const terrain = context.window.TerrainGeometry; // Production API exported by terrain-geometry.js.
assert.equal(typeof terrain?.buildRockTileGeo, 'function', 'TerrainGeometry must export buildRockTileGeo directly');
assert.ok(!houseLoader.includes('RockTileGeometryContract'), 'rock geometry must not depend on the house loader compatibility shim');

function geometrySnapshot(col, row) {
  const result = terrain.buildRockTileGeo(col, row); // Exercises the production implementation with deterministic coordinates.
  assert.ok(result && typeof result === 'object' && !ArrayBuffer.isView(result), 'buildRockTileGeo returns a split object, not one bare geometry');
  assert.ok(result.stoneGeo instanceof FakeBufferGeometry, 'split result contains stoneGeo');
  assert.ok(result.grassGeo instanceof FakeBufferGeometry, 'split result contains grassGeo');
  assert.ok(result.stoneGeo.normalsComputed && result.grassGeo.normalsComputed, 'both split geometries request vertex normals');

  const stonePos = result.stoneGeo.getAttribute('position'); // Shared 7x7 mound vertex field.
  const grassPos = result.grassGeo.getAttribute('position'); // Same vertex field viewed through the grass subset.
  const stoneUv = result.stoneGeo.getAttribute('uv'); // World-space UVs used by the natural-surface rock mapper.
  assert.equal(stonePos.count, 49, 'rock mound retains the 7x7 vertex field');
  assert.equal(grassPos.count, 49, 'grass rim shares the complete 7x7 vertex field');
  assert.equal(stoneUv.count, 49, 'rock mound retains one UV per vertex');
  assert.ok(result.stoneGeo.index.count > 0, 'rock mound has visible stone triangles');
  assert.ok(result.grassGeo.index.count > 0, 'rock mound has a visible grass blending rim');
  assert.equal(result.stoneGeo.index.count + result.grassGeo.index.count, 6 * 6 * 6,
    'stone and grass subsets partition every triangle in the 6x6 cell mound exactly once');

  const maxY = Math.max(...Array.from(stonePos.array).filter((_value, index) => index % 3 === 1)); // Confirms the extraction's flat ROCK_H sheet is gone.
  assert.ok(maxY > 0.25, `irregular rock mound rises above the ground plane (maxY=${maxY})`);

  const first = [result.stoneGeo.index.getX(0), result.stoneGeo.index.getX(1), result.stoneGeo.index.getX(2)]; // First stone triangle for winding verification.
  const [a, b, c] = first.map(index => [stonePos.getX(index), stonePos.getY(index), stonePos.getZ(index)]);
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; // Triangle edge AB.
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; // Triangle edge AC.
  const normalY = ab[2] * ac[0] - ab[0] * ac[2]; // Y component of AB x AC; positive means upward-facing winding.
  assert.ok(normalY > 0, 'stone triangles retain the corrected upward-facing winding');

  return {
    stonePositions: Array.from(stonePos.array),
    stoneIndices: Array.from(result.stoneGeo.index.array),
    grassIndices: Array.from(result.grassGeo.index.array),
  };
}

for (const [col, row] of [[0, 0], [4, 7], [19, 31]]) {
  const first = geometrySnapshot(col, row); // First build used as deterministic baseline.
  const second = geometrySnapshot(col, row); // Same coordinates must reproduce exactly the same mound.
  assert.deepEqual(second, first, `rock geometry at ${col},${row} is deterministic`);
}

assert.match(terrainSource, /const PEAK = 0\.32 \+ rng\(\) \* 0\.38/,
  'source keeps the pre-extraction loose-rock height range');
assert.match(terrainSource, /return \{ stoneGeo: makeGeo\(stoneIdx\), grassGeo: makeGeo\(grassIdx\) \}/,
  'source keeps the split object every live caller expects');
assert.doesNotMatch(terrainSource, /const TOP = deps\.ROCK_H \/ 2 - deps\.SLAB_H \/ 2/,
  'the accidental flat single-geometry extraction implementation stays removed');
assert.match(gameSource, /const \{ stoneGeo, grassGeo \} = window\.TerrainGeometry\.buildRockTileGeo\(c, r\)/,
  'wilderness ROCK rendering consumes the repaired split API');
assert.match(gameSource, /const \{ stoneGeo \} = window\.TerrainGeometry\.buildRockTileGeo\(rock\.col, rock\.row\)/,
  'cavern ore rendering consumes the repaired split API');
assert.match(farmSource, /const \{ stoneGeo, grassGeo \} = window\.TerrainGeometry\.buildRockTileGeo\(col, row\)/,
  'farm ROCK rendering consumes the repaired split API');

console.log('rock tile geometry contract checks passed.');
