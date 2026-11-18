#!/usr/bin/env node
'use strict';
// Actual Three.js geometry contract for the five physical wilderness blossom trees (not the feast's table vases).
const assert = require('node:assert/strict'); // Checks measured world-scale bounds, distinct leaf canopy and tiny blossom sprigs.
let THREE; // Matches the production foliage-generator runtime.
try { THREE = require('three'); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('skip - wilderness blossom Three.js check (three not installed)');
  process.exit(0);
}
const previousTextureLoad = THREE.TextureLoader.prototype.load; // PNG fetching needs a DOM; the geometry/UVs still use real Three.js.
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
global.window = { THREE, __farmLog() {} };
global.THREE = THREE;
require('../docs/js/foliage-generator.js'); // Use the real generator and its cached variants, not a handcrafted tree fixture.
const generator = window.FoliageGenerator;
assert.ok(generator?.buildWildernessBlossomTreeMesh, 'wilderness builder is exported independently of table flowers');
assert.equal(generator.wildernessBlossomRecipe.knotTiers, 3, 'wilderness trees have three canopy branch levels');
assert.equal(generator.pottedBlossomRecipe.knotTiers, 1, 'the feast table flower stays a single-rung sapling');
for (const color of ['#00ffff','#ffffff','#ffbf00','#ff8000','#ffb3b3']) {
  const a = generator.buildWildernessBlossomTreeMesh('blossom-color-'+color,color);
  const b = generator.buildWildernessBlossomTreeMesh('blossom-color-'+color,color);
  const bounds = new THREE.Box3().setFromObject(a); // Measures seeded branches and petals after normalized world transforms.
  const size = bounds.getSize(new THREE.Vector3());
  assert.ok(size.x <= 2.001 && size.y <= 2.001 && size.z <= 2.001,
    color+': all branches, foliage and petals fit the 2×2×2-tile envelope');
  assert.ok(size.y > 1.95, color+': tree is approximately two tiles tall, not a tiny table flower');
  assert.ok(bounds.min.y >= -0.001, color+': roots begin at the wilderness floor');
  assert.equal(a.userData.wildernessBlossom.branchTiers,3);
  assert.equal(a.userData.wildernessBlossom.blossomColor,color);
  const petals = a.getObjectByName('wilderness-blossom-sprigs');
  assert.ok(petals?.isMesh && petals.geometry.attributes.uv, color+': separately tinted tiny PNG blossom planes exist');
  assert.ok(petals.geometry.attributes.position.count >= 100,
    color+': multiple outer-branch blossom sprigs are distributed across all tiers');
  const leaves = a.children.find(child => child.isMesh && child.userData.noOutline && child !== petals);
  assert.ok(leaves?.material?.map, color+': green shadewood foliage remains distinct from colored blossom planes');
  assert.notEqual(leaves.material.color.getHex(),new THREE.Color(color).getHex(),
    color+': tree leaves must not become one giant colored blossom');
  const petalsB = b.getObjectByName('wilderness-blossom-sprigs');
  assert.equal(petals.geometry,petalsB.geometry,color+': repeated tree instances reuse shared petals geometry');
  assert.equal(leaves.geometry,b.children.find(child=>child.isMesh&&child.userData.noOutline&&child!==petalsB).geometry,
    color+': repeated tree instances reuse shared leaves geometry');
}
THREE.TextureLoader.prototype.load = previousTextureLoad;
console.log('ok - blossom wilderness trees are 2×2×2 tiles, 3-tier leafy shadewood-like silhouettes with many tiny shared flower sprigs');
