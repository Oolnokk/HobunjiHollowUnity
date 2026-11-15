#!/usr/bin/env node
'use strict';

// Actual production Three.js r128 geometry check for berry bushes. The fast
// regression suite can skip when optional three is absent; CI reruns after
// installing the pinned browser-test dependencies.
const assert = require('node:assert/strict'); // Validates true Three.js geometry and instanced matrices.
let THREE; // Uses the same pinned r128 release as the game's rendering runtime.
try { THREE = require('three'); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('skip - berry bush Three.js runtime check (three not installed)');
  process.exit(0);
}
const textureLoad = THREE.TextureLoader.prototype.load; // Replaced only inside this isolated Node process because PNG loading normally requires the DOM.
THREE.TextureLoader.prototype.load = function loadForGeometryTest() {
  return new THREE.Texture(); // All texture UV/alpha material properties remain the real Three.js implementations.
};
global.window = {
  THREE,
  CropVarieties: {
    ensure(key) {
      return key === 'cv_blueberries_112233_8739b7' ? { family: 'blueberries', color: 0x8739b7 } : null;
    },
    produceFamily(key) {
      return key.startsWith('cv_blueberries') ? 'blueberries' : key;
    },
  },
};
global.THREE = THREE; // vegetation-crop-rendering's classic script expects the actual browser-level THREE identifier.
require('../docs/js/foliage-generator.js'); // Existing cached eight-variant Bush preset, including the actual alpha-tested leaves.
require('../docs/js/vegetation-crop-rendering.js'); // The exact production crop renderer and fruit-placement algorithm.
THREE.TextureLoader.prototype.load = textureLoad;

const api = window.VegetationCropRendering; // Builds the same standalone crop geometry used by NPC farm plots.
const species = {
  redberries: 0xff4f62, blueberries: 0x5f80ff, yellowberries: 0xffe86a,
  whiteberries: 0xffffff, blackberries: 0x17121f,
}; // Expected palette matches the native ripe fruit colors used by crop rendering.
const instances = []; // Used to verify several independent procedural canopy variants and both native/genetic colors.
for (const [family, pigment] of Object.entries(species)) {
  const wrapper = api.buildStandaloneCropMesh(family, 1, true, Object.keys(species).indexOf(family), 2);
  assert.ok(wrapper?.mesh, family + ': bush built with real Three.js');
  const group = wrapper.mesh, shrub = group.children[0], fruit = group.children[1];
  assert.equal(group.userData.hobunjiBerryBush, true, family + ': real foliage crop');
  assert.equal(shrub.isGroup, true, family + ': retains procedural twig and leaf meshes');
  const leaves = [];
  shrub.traverse(node => { if (node.isMesh && node.userData.noOutline && node.material?.map) leaves.push(node); });
  assert.ok(leaves.length > 0, family + ': genuine PNG leaf canopy is present');
  assert.ok(leaves.every(leaf => !leaf.material.transparent && leaf.material.alphaTest > 0),
    family + ': leaf cutouts are transparent through alpha test, not opaque quads');
  assert.equal(fruit.isInstancedMesh, true, family + ': 3D berries draw as one instanced batch');
  assert.equal(fruit.count, 30, family + ': ripe bush has 10 three-fruit bunches');
  assert.equal(fruit.material.color.getHex(), pigment, family + ': native berry color');
  const leafBounds = new THREE.Box3().setFromObject(shrub); // Measures actual twig/leaf extents after cached variant transform and crop scaling.
  const matrix = new THREE.Matrix4(); // Reused to inspect every actual berry instance position.
  for (let i = 0; i < fruit.count; i++) {
    fruit.getMatrixAt(i, matrix);
    const pos = new THREE.Vector3().setFromMatrixPosition(matrix);
    assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z), family + ': finite berry transform');
    assert.ok(Math.hypot(pos.x, pos.z) <= group.userData.hobunjiBerryCanopyRadius + 0.09,
      family + ': fruit clusters stay inside measured shrub radius');
    assert.ok(pos.y >= group.userData.hobunjiBerryCanopyMinY - 0.06 && pos.y <= group.userData.hobunjiBerryCanopyMaxY + 0.06,
      family + ': fruit clusters stay inside measured leaf heights');
    assert.ok(pos.x > leafBounds.min.x - 0.15 && pos.x < leafBounds.max.x + 0.15,
      family + ': fruit overlaps real leafy geometry in X');
    assert.ok(pos.z > leafBounds.min.z - 0.15 && pos.z < leafBounds.max.z + 0.15,
      family + ': fruit overlaps real leafy geometry in Z');
  }
  instances.push(shrub.children[0].geometry); // Bushes must reuse cached branch geometry rather than allocate it anew per tile.
}
const young = api.buildStandaloneCropMesh('redberries', .2, false, 3, 4).mesh;
assert.equal(young.children.length, 1, 'young berry bush has leaves/wood but no fruit geometry');
const mature = api.buildStandaloneCropMesh('redberries', .88, false, 3, 4).mesh;
assert.equal(mature.children[1].count, 15, 'grown but unripe berry bush has fewer berries');
const hybrid = api.buildStandaloneCropMesh('cv_blueberries_112233_8739b7', 1, true, 3, 6).mesh;
assert.equal(hybrid.children[1].material.color.getHex(), 0x8739b7, 'crossbred berries use exact inherited color');
assert.equal(hybrid.children[0].children.length >= 2, true, 'crossbred bush retains original living branches and leaves');
assert.ok(instances.every(geometry => geometry?.attributes?.position?.count > 0), 'native bushes use genuine procedural geometry');
console.log('ok - real Three.js berry bushes retain leafy silhouettes, rooted 3D fruit and inherited pigments');
