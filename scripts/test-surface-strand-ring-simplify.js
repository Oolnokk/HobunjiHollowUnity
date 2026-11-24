#!/usr/bin/env node
'use strict';
// Surface-growth tubes (roots/vines on houses, temple, caves, furniture) drop
// redundant rings after shrinkwrap (FoliageGenerator.simplifySurfaceStrandRings).
// Executes the real generator on real three r128 geometry.
const assert = require('node:assert/strict');
let THREE;
try { THREE = require('three'); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('skip - surface strand ring simplification (three not installed)');
  process.exit(0);
}
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
global.window = { THREE, __farmLog() {} };
global.THREE = THREE;
require('../docs/js/foliage-generator.js');
const generator = window.FoliageGenerator;
assert.equal(typeof generator.simplifySurfaceStrandRings, 'function');

// A stride-6 strand like buildMeshFromSpineWithRadiusFn(stretchUv) emits:
// 5 sides + a seam duplicate per ring, uv.v running 0..1 along the strand.
function strand(centers, radius, radiusAt = () => radius) {
  const positions = [], uvs = [], indices = [];
  centers.forEach((c, i) => {
    const t = i / (centers.length - 1), r = radiusAt(t);
    for (let j = 0; j < 6; j++) {
      const a = (j / 5) * Math.PI * 2;
      positions.push(c.x, c.y + Math.cos(a) * r, c.z + Math.sin(a) * r); // Tube around +X.
      uvs.push(j / 5, t);
    }
  });
  for (let i = 0; i < centers.length - 1; i++) {
    const r0 = i * 6, r1 = (i + 1) * 6;
    for (let j = 0; j < 5; j++) indices.push(r0 + j, r0 + j + 1, r1 + j, r1 + j, r0 + j + 1, r1 + j + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.userData = { surfaceGrowthRadius: radius };
  return g;
}
const ringCenters = g => {
  const p = g.getAttribute('position'), out = [];
  for (let i = 0; i < p.count / 6; i++) {
    const c = new THREE.Vector3();
    for (let j = 0; j < 5; j++) c.add(new THREE.Vector3().fromBufferAttribute(p, i * 6 + j));
    out.push(c.multiplyScalar(0.2));
  }
  return out;
};
const distToPolyline = (point, line) => {
  let best = Infinity; const seg = new THREE.Line3(), q = new THREE.Vector3();
  for (let i = 0; i < line.length - 1; i++) { seg.set(line[i], line[i + 1]); seg.closestPointToPoint(point, true, q); best = Math.min(best, q.distanceTo(point)); }
  return best;
};

const radius = 0.2, tol = radius * 0.12;
// Straight run of 40 rings, a right-angle corner, a gentle wave of 40 rings.
const centers = [];
for (let i = 0; i <= 40; i++) centers.push(new THREE.Vector3(i * 0.14, 0, 0));
for (let i = 1; i <= 40; i++) centers.push(new THREE.Vector3(40 * 0.14, 0, i * 0.14 + 0).add(new THREE.Vector3(Math.sin(i * 0.14 * 4.4) * 0.09, 0, 0)));
const source = strand(centers, radius, t => radius * (1 - 0.75 * t));
const sourceUv = source.getAttribute('uv').array.slice();
const geometries = [source];
const report = generator.simplifySurfaceStrandRings(geometries, { radius });
const out = geometries[0];
assert.notEqual(out, source, 'a reducible strand is replaced by a new geometry');
assert.equal(report.strandRingsBefore, 81);
assert.ok(report.strandRingsAfter < 81 * 0.6, 'at least ~40% of rings dropped (' + report.strandRingsAfter + '/81)');
const kept = ringCenters(out);
assert.ok(kept[0].distanceTo(centers[0]) < 1e-5 && kept[kept.length - 1].distanceTo(centers[centers.length - 1]) < 0.01, 'both ends kept');
assert.ok(kept.some(c => c.distanceTo(new THREE.Vector3(40 * 0.14, 0, 0)) < 1e-5), 'the corner ring is kept');
for (const c of ringCenters(strand(centers, radius))) assert.ok(distToPolyline(c, kept) <= tol + 1e-5, 'every dropped ring lies within the tolerance of the new tube');
// Kept rings keep their exact vertices and their PNG stretch coordinates.
const outUv = out.getAttribute('uv').array;
for (let r = 0; r < kept.length; r++) {
  const v = outUv[r * 12 + 1];
  const src = Math.round(v * 80);
  for (let k = 0; k < 12; k++) assert.ok(Math.abs(outUv[r * 12 + k] - sourceUv[src * 12 + k]) < 1e-6, 'uv copied from its source ring');
}
assert.equal(out.index.count, (kept.length - 1) * 30, 'five quads per kept segment, same topology as the builder');
assert.equal(out.userData.surfaceGrowthRadius, radius, 'per-strand metadata survives');
// Gaps are bounded even on a perfectly straight run.
const straight = [strand(Array.from({ length: 60 }, (_, i) => new THREE.Vector3(i * 0.14, 0, 0)), radius)];
const straightReport = generator.simplifySurfaceStrandRings(straight, { radius });
assert.ok(straightReport.strandRingsAfter >= Math.ceil(59 / 12) + 1, 'never more than 12 ring gaps per segment');
// Nothing to drop: the original geometry object is kept.
const tight = [];
for (let i = 0; i < 10; i++) tight.push(new THREE.Vector3(Math.cos(i) * 2, 0, Math.sin(i) * 2));
const tightGeometries = [strand(tight, 0.02)];
const tightOriginal = tightGeometries[0];
generator.simplifySurfaceStrandRings(tightGeometries, { radius: 0.02 });
assert.equal(tightGeometries[0], tightOriginal, 'a strand with no redundant rings is left as it is');

// Integration: the real growth builder on a wall reports the reduction.
const wall = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 0.4, 6, 4, 1), new THREE.MeshBasicMaterial());
const parent = new THREE.Group(); parent.add(wall); parent.updateMatrixWorld(true);
const growth = generator.buildSurfaceGrowth(parent, { kind: 'roots', style: 'natural', count: 6, length: 3, radius: 0.05, seed: 'ring-test', shrinkwrapFinal: false });
const stats = growth.userData.surfaceGrowthStats;
assert.ok(stats.strandRingsBefore > 0 && stats.strandRingsAfter <= stats.strandRingsBefore, 'build reports ring counts');
const mesh = growth.children.find(o => o.isMesh);
assert.ok(mesh && mesh.geometry.index.count / 3 === (stats.strandRingsAfter - growth.userData.generatedStrands) * 10, 'merged mesh has exactly the kept segments');
console.log('ok - surface strand rings: redundant rings dropped within ' + (100 * 0.12) + '% of radius; ends, corners, uvs and shrinkwrapped vertices kept');
