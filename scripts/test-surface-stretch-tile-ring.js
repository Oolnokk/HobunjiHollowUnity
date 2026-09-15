#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/surface-stretch-tile-ring.js'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'docs/js/house-pieces.js'), 'utf8');

const waterAt = loader.indexOf("['WaterCanvasStretchOverlay', 'water-canvas-stretch-overlay.js");
const tileRingAt = loader.indexOf("['HobunjiSurfaceTileRing', 'surface-stretch-tile-ring.js");
assert.ok(waterAt >= 0 && tileRingAt > waterAt, 'tile ring loads after the water bank UV fit');
assert.match(source, /const DEFAULT_TILE_RING_WORLD_WIDTH = 1;/, 'protected ring defaults to one world tile');
assert.match(source, /const requestedEdge = Number\(options\.sourceEdgeFraction\)/,
  'protected source width must be supplied per surface instead of globally retuning cliffs/grass');
assert.match(source, /sourceEdge \* Math\.max\(0, Math\.min\(1, distance \/ ringWidth\)\)/,
  'outer source band consumes exactly the requested world ring');
assert.match(source, /sourceEdge \+ \(0\.5 - sourceEdge\) \* interiorT/,
  'remaining source image stretches only beyond the protected ring');
assert.match(source, /sourceEdgeFraction: configuredSourceEdge\(\)/,
  'water renderer path reads the scoped water/snow config value');
assert.match(source, /representation\.startsWith\('tile-merged'\)/,
  'literal water-ring correction only runs where tile-scale vertices still exist');
assert.match(source, /invertedSkips\+\+;/,
  'dense rectangle water retains its existing optimization');

class MockAttribute {
  constructor(values, itemSize) {
    this.values = values.slice();
    this.itemSize = itemSize;
    this.count = this.values.length / itemSize;
    this.needsUpdate = false;
  }
  getX(index) { return this.values[index * this.itemSize]; }
  getY(index) { return this.values[index * this.itemSize + 1]; }
  getZ(index) { return this.values[index * this.itemSize + 2]; }
  setXY(index, x, y) { this.values[index * this.itemSize] = x; this.values[index * this.itemSize + 1] = y; }
  clone() { return new MockAttribute(this.values, this.itemSize); }
}

const sandboxWindow = { NaturalSurfaceMaterialConfig: { perimeterFrame: { sourceEdgeFraction: 0.45, tileRingWorldWidth: 1 } } };
sandboxWindow.window = sandboxWindow;
const sandbox = { window: sandboxWindow, console: { debug() {}, warn() {} }, Float32Array, Int32Array, Map, Math, Number, Object };
vm.runInNewContext(source, sandbox, { filename: 'surface-stretch-tile-ring.js' });
assert.equal(sandboxWindow.HobunjiSurfaceTileRing.installed, true, 'tile-ring runtime API installs without a renderer');

const threeByThree = [];
for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) threeByThree.push({ col, row, visible: true });
const topology = sandboxWindow.HobunjiSurfaceTileRing.buildTileComponents(threeByThree);
assert.equal(topology.components.length, 1, 'one contiguous 3x3 patch is one component');
assert.equal(topology.components[0].boundarySegments.length, 12, '3x3 patch exposes twelve shoreline segments');

const split = sandboxWindow.HobunjiSurfaceTileRing.buildTileComponents([
  { col: 0, row: 0, visible: true }, { col: 1, row: 0, visible: true }, { col: 5, row: 5, visible: true },
]);
assert.equal(split.components.length, 2, 'disconnected tile clusters stay separate');

const fiveByFive = [];
for (let row = 0; row < 5; row++) for (let col = 0; col < 5; col++) fiveByFive.push({ col, row, visible: true });
const positions = [];
const fittedUvs = [];
function appendTriangle(a, b, c) {
  for (const [x, z] of [a, b, c]) { positions.push(x, 0, z); fittedUvs.push(x / 5, z / 5); }
}
for (let row = 0; row < 5; row++) for (let col = 0; col < 5; col++) {
  appendTriangle([col, row], [col, row + 1], [col + 1, row + 1]);
  appendTriangle([col, row], [col + 1, row + 1], [col + 1, row]);
}
const positionAttribute = new MockAttribute(positions, 3);
const stretchAttribute = new MockAttribute(fittedUvs, 2);
const geometry = {
  userData: {},
  getAttribute(name) { return name === 'position' ? positionAttribute : (name === 'aStretchUv' ? stretchAttribute : null); },
  setAttribute(name, attribute) { if (name === 'aStretchUv') this.stretch = attribute; },
};
const report = sandboxWindow.HobunjiSurfaceTileRing.applyTileMeasuredRingUv(geometry, fiveByFive, {
  attributeName: 'aStretchUv', tileRingWorldWidth: 1, sourceEdgeFraction: 0.45,
});
assert.ok(report && report.remappedVertices === positionAttribute.count, 'every water-bank triangle corner is remapped');
const measuredUv = geometry.stretch;
function depthsAt(x, z) {
  const depths = [];
  for (let index = 0; index < positionAttribute.count; index++) {
    if (positionAttribute.getX(index) !== x || positionAttribute.getZ(index) !== z) continue;
    const u = measuredUv.getX(index);
    const v = measuredUv.getY(index);
    depths.push(Math.min(u, v, 1 - u, 1 - v));
  }
  return depths;
}
for (const depth of depthsAt(0, 0)) assert.ok(Math.abs(depth) < 1e-6, 'shoreline stays on source perimeter');
for (const depth of depthsAt(1, 1)) assert.ok(Math.abs(depth - 0.45) < 1e-6, 'one tile inward lands on the 0.45 protected-band inner edge');
for (const depth of depthsAt(2, 2)) assert.ok(Math.abs(depth - 0.5) < 1e-6, 'deep interior reaches source center');

console.log('scoped surface tile ring tests passed');
