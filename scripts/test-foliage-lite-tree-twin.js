#!/usr/bin/env node
'use strict';
// Far-distance twins of shared procedural tree variants: every part (trunk,
// roots, branches, vines) kept on the same spines with coarser tubes
// (FoliageGenerator.liteTreeGeometry, drawn by dense-forest-wall-batches.js)
// and the dense wall's instancing of only the meshes a placed tree draws
// (border-terrain.js). Runs the real generator with real three r128 geometry.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let THREE;
try { THREE = require('three'); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('skip - lite tree twins (three not installed)');
  process.exit(0);
}
THREE.TextureLoader.prototype.load = () => new THREE.Texture(); // Leaf PNGs need a DOM; geometry does not.
global.window = { THREE, __farmLog() {} };
global.THREE = THREE;
require('../docs/js/foliage-generator.js');
const generator = window.FoliageGenerator;
assert.equal(typeof generator.liteTreeGeometry, 'function');

const triangles = g => g.index.count / 3;
const box = g => { g.computeBoundingBox(); return g.boundingBox.clone(); };
const rolesOf = tree => {
  const out = new Map();
  tree.traverse(o => { if (o.isMesh) out.set(o.userData.treePartRole || 'other', o); });
  return out;
};

for (const [label, build] of [['shadewood', (c, r) => generator.buildShadewoodMesh(c, r)], ['crowned pine', (c, r) => generator.buildCrownedPineMesh(c, r)]]) {
  const tree = build(4, 9);
  const parts = rolesOf(tree);
  const wood = parts.get('wood');
  assert.ok(wood, label + ': the merged bark mesh is tagged');
  const lite = generator.liteTreeGeometry(wood.geometry);
  assert.ok(lite?.isBufferGeometry, label + ': bark has a lite twin');
  assert.strictEqual(generator.liteTreeGeometry(wood.geometry), lite, label + ': the twin is built once and cached');
  assert.strictEqual(generator.liteTreeGeometry(build(4, 9).children.find(o => o.userData.treePartRole === 'wood').geometry), lite,
    label + ': every placed clone of the variant shares the twin');
  assert.ok(triangles(lite) * 2.5 < triangles(wood.geometry), label + ': at least 2.5x fewer bark triangles (trunk is kept at full detail; ' + triangles(wood.geometry) + ' -> ' + triangles(lite) + ')');
  assert.ok(lite.attributes.normal, label + ': twin has smooth normals for the same Lambert shading');
  // Same spines: the canopy/branch extent matches; only the below-ground roots are gone.
  const full = box(wood.geometry), small = box(lite);
  for (const axis of ['x', 'z']) {
    assert.ok(Math.abs(full.min[axis] - small.min[axis]) < 0.05 && Math.abs(full.max[axis] - small.max[axis]) < 0.05,
      label + ': branch tips reach the same ' + axis + ' extent');
  }
  assert.ok(Math.abs(full.max.y - small.max.y) < 0.05, label + ': same top');
  assert.ok(small.min.y >= full.min.y - 1e-6 && small.min.y - full.min.y < 0.2, label + ': roots are kept, nothing extends below the full tree');
  const leaves = [...parts.values()].find(o => o.userData.noOutline && o.material?.map !== undefined && !o.userData.treePartRole);
  if (leaves) assert.equal(generator.liteTreeGeometry(leaves.geometry), undefined, label + ': leaf cards are kept as they are');
  if (parts.get('vines')) {
    const vines = parts.get('vines').geometry, vinesLite = generator.liteTreeGeometry(vines);
    assert.ok(vinesLite && triangles(vinesLite) <= triangles(vines) * 0.6, label + ': vines keep a coarser twin (they are part of the look)');
    const a = box(vines), b = box(vinesLite);
    assert.ok(a.min.distanceTo(b.min) < 0.5 && a.max.distanceTo(b.max) < 0.5, label + ': and follow the same wrap around the trunk');
  }
  if (parts.get('climb')) {
    const climbLite = generator.liteTreeGeometry(parts.get('climb').geometry);
    assert.ok(climbLite && triangles(climbLite) < triangles(parts.get('climb').geometry), label + ': climb branch has its own twin');
  }
}
assert.equal(generator.liteTreeGeometry(new THREE.BoxGeometry()), undefined, 'unknown geometry is left alone');
const stats = generator.liteTreeStats();
assert.ok(stats.variantsBuilt >= 2 && stats.liteTriangles < stats.sourceTriangles, 'mobile-visible counters');

// Full-detail variants are unchanged by the lite path (rebuilding the same
// seed after a twin was built gives the same triangle count).
const shade = generator.buildShadewoodMesh(4, 9);
const before = triangles(shade.children.find(o => o.userData.treePartRole === 'wood').geometry);
assert.equal(before, 2592, 'full shadewood bark keeps its authored tessellation');

// border-terrain.js: a dense-wall tree contributes only the meshes it draws.
const src = fs.readFileSync(path.resolve(__dirname, '..', 'docs/js/border-terrain.js'), 'utf8');
const start = src.indexOf('function forEachDrawnTreeMesh(');
const end = src.indexOf('function instanceDenseShadewoodForest(');
assert.ok(start > 0 && end > start, 'helper present');
const forEachDrawnTreeMesh = vm.runInNewContext('(' + src.slice(start, end).trim() + ')');
const visited = [];
const climbRoot = new THREE.Group();
const visibleMesh = new THREE.Mesh(new THREE.BoxGeometry());
const hiddenBranch = new THREE.Mesh(new THREE.BoxGeometry()); hiddenBranch.visible = false;
const lod = new THREE.LOD();
const nearLevel = new THREE.Mesh(new THREE.BoxGeometry()), farLevel = new THREE.Mesh(new THREE.BoxGeometry());
lod.addLevel(nearLevel, 0); lod.addLevel(farLevel, 3);
climbRoot.add(visibleMesh, hiddenBranch, lod);
forEachDrawnTreeMesh(climbRoot, mesh => visited.push(mesh));
assert.deepEqual(visited, [visibleMesh, nearLevel], 'hidden climb branches and non-first LOD levels are not instanced');

console.log('ok - lite tree twins: same spines and parts, coarser tubes, leaves kept; wall instances drawn meshes only');
