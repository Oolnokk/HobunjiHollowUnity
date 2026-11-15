#!/usr/bin/env node
'use strict';

// Exercise the production crop renderer with mixed native/imported mushtard and
// legacy cube meshes. This protects both leaf cutouts and save-restore behavior.
const assert = require('node:assert/strict'); // Used for the observable crop-mesh and material assertions.
const fs = require('node:fs'); // Loads the real renderer rather than duplicating its crop-selection rules.
const path = require('node:path'); // Resolves the module relative to this regression test.
const vm = require('node:vm'); // Executes the classic browser script with lightweight Three.js stand-ins.

class Color {
  constructor(value = 0xffffff) { this.value = value; }
  setHSL() { return this; }
  setHex(value) { this.value = value; return this; }
  getHex() { return this.value; }
  lerp(other, weight) { this.value = Math.round(this.value * (1 - weight) + other.value * weight); return this; }
}
class Geometry {
  constructor(width = 1, height = 1, depth = 1) {
    this.type = 'BoxGeometry'; this.parameters = { width, height, depth };
    this.boundingSphere = { center: { set() {} }, radius: 1 };
  }
  translate() { return this; }
  getAttribute() {
    return { count: 3, getX: index => index / 2 - 0.5, getY: index => index / 2, setXYZ() {}, needsUpdate: false };
  }
  computeVertexNormals() {}
  computeBoundingSphere() {}
  dispose() {}
}
class PlaneGeometry extends Geometry { constructor(...args) { super(...args); this.type = 'PlaneGeometry'; } }
class Material {
  constructor(options = {}) { Object.assign(this, options); this.color = new Color(options.color ?? 0xffffff); }
  clone() { return new this.constructor({ ...this, color: this.color.getHex() }); }
  dispose() {}
}
class MeshBasicMaterial extends Material {}
class MeshLambertMaterial extends Material { constructor(options) { super(options); this.isMeshLambertMaterial = true; } }
const position = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { Object.assign(this, { x, y, z }); } }); // Shared Three-like transform contract for plant groups and instances.
const scale = () => ({ x: 1, y: 1, z: 1, set(x, y, z) { Object.assign(this, { x, y, z }); }, setScalar(v) { this.set(v, v, v); } }); // Lets native and imported crops grow identically.
class Group {
  constructor() {
    this.children = []; this.userData = {}; this.position = position(); this.scale = scale();
    this.rotation = { y: 0, set(x, y, z) { this.y = y; } };
  }
  add(child) { this.children.push(child); child.parent = this; }
  traverse(fn) { fn(this); for (const child of this.children) child.traverse ? child.traverse(fn) : fn(child); }
}
class Mesh extends Group {
  constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; this.isMesh = true; this.layers = { marked: false, enable() { this.marked = true; } }; }
}
class InstancedMesh extends Mesh {
  constructor(geometry, material, count) { super(geometry, material); this.count = count; this.instanceMatrix = { needsUpdate: false }; }
  setMatrixAt() {}
}
class Object3D extends Group {
  constructor() { super(); this.matrix = {}; }
  updateMatrix() {}
  rotateY() {}
}
class TextureLoader {
  load(url, onLoad) {
    const texture = { image: { width: 76, height: 153 } }; // Authored PNG dimensions; test only needs a ready texture reference.
    if (!url.endsWith('/grass_1.png')) onLoad?.(texture); // Skip unrelated farm-grass creation during the crop-only test.
    return texture;
  }
}
const THREE = {
  BoxGeometry: Geometry, PlaneGeometry, MeshBasicMaterial, MeshLambertMaterial,
  Mesh, Group, InstancedMesh, Object3D, TextureLoader, Color,
  Vector3: class { constructor() { this.set(0, 0, 0); } set(x, y, z) { Object.assign(this, { x, y, z }); return this; } },
  MathUtils: { degToRad: degrees => degrees * Math.PI / 180 },
  NearestFilter: 1, DoubleSide: 2, sRGBEncoding: 3,
};
const cultivarKey = 'cv_greenMustard_111111_aabbcc'; // Simulates a saved cultivar whose cropData entry lacks the newer baseCrop field.
const window = {
  FoliageGenerator: {},
  CropVarieties: {
    produceFamily: key => key === cultivarKey ? 'greenMustard' : ['blackMustard', 'greenMustard', 'ongyums'].includes(key) ? key : null,
    ensure: key => key === cultivarKey ? { family: 'greenMustard', color: 0xaabbcc } : null,
  },
};
const context = vm.createContext({ window, THREE, performance: { now: () => 1000 }, Math, Map, Set, console }); // Runs the real crop module with deterministic time.
const source = fs.readFileSync(path.resolve(__dirname, '../docs/js/vegetation-crop-rendering.js'), 'utf8'); // Exact production module under test.
vm.runInContext(source, context, { filename: 'vegetation-crop-rendering.js' });
const renderer = window.VegetationCropRendering; // Public entry point used by game.js and NPC farm plots.
const crops = {
  blackMustard: { growDays: 5 },
  greenMustard: { growDays: 5 },
  [cultivarKey]: { growDays: 5, varietyColor: 0xaabbcc }, // Missing baseCrop must not force a generic cube.
  ongyums: { growDays: 5 },
};
const grid = [[
  { crop: 'blackMustard', type: 'tilled', water: 0, cropAge: 2, cropReady: false },
  { crop: cultivarKey, type: 'tilled', water: 0, cropAge: 2, cropReady: false },
  { crop: 'greenMustard', type: 'tilled', water: 0, cropAge: 2, cropReady: false },
]];
const scene = { children: [], add(node) { this.children.push(node); }, remove(node) { this.children = this.children.filter(item => item !== node); } };
const markOutline = node => node.traverse(child => { if (child.isMesh && !child.userData?.noOutline) child.layers.enable(1); }); // Models the game's silhouette-layer enrollment.
renderer.init({ COLS: 3, ROWS: 1, cropData: crops, getGrid: () => grid, scene, WATER_UNIT: .1, tileSurfaceY: () => 0, markOutline });

// Old save/load runtimes may have left a green mushtard cube on the same tile.
const staleCube = new Mesh(new Geometry(), new MeshLambertMaterial({ color: 0x6da64a })); // Legacy placeholder to replace, not preserve.
staleCube.userData.hobunjiCropRootKey = 'greenMustard';
renderer.cropMeshes[2] = staleCube;
scene.add(staleCube);
renderer.updateCropMeshes();
for (let i = 0; i < 3; i++) {
  const group = renderer.cropMeshes[i]; // Current native or cultivar plant, never the previous placeholder.
  assert.equal(group?.userData?.hobunjiCropRootKey, i === 0 ? 'blackMustard' : 'greenMustard');
  assert.equal(group?.userData?.hobunjiFoliageMesh, true, 'mushtard variety uses foliage, not generic cube');
  assert.equal(group.children.length, 2, 'growth-stage rosette has two batched leaf shapes');
  for (const leaf of group.children) {
    assert.equal(leaf.userData.noOutline, true, 'flat leaf PNG is not painted opaque by the shell-outline layer');
    assert.equal(leaf.layers.marked, false, 'alpha cutouts are absent from shell outline pass');
    assert.equal(leaf.material.transparent, false, 'opaque alpha-test queue avoids overlapping-leaf sorting errors');
    assert.equal(leaf.material.alphaTest, 0.5, 'fully transparent source PNG pixels are discarded');
  }
}
assert.ok(!scene.children.includes(staleCube), 'the restored placeholder cube was removed');

// Replanting a different species in the same tile must rebuild even without a growth-stage change.
const priorGreen = renderer.cropMeshes[1]; // Remember the previous cultivar root for identity checking.
grid[0][1].crop = 'blackMustard';
renderer.updateCropMeshes();
assert.notEqual(renderer.cropMeshes[1], priorGreen, 'a newly planted native mushtard cannot inherit an old cultivar mesh');
assert.equal(renderer.cropMeshes[1].userData.hobunjiCropRootKey, 'blackMustard');
grid[0][0].crop = 'ongyums';
renderer.updateCropMeshes();
assert.equal(renderer.cropMeshes[0].isMesh, true, 'switching from foliage to non-foliage creates the expected placeholder instead of crashing');

const townPlant = renderer.buildStandaloneCropMesh(cultivarKey, .8, false, 4, 6); // NPC plots need the same genotype fallback as the player farm.
assert.equal(townPlant.mesh.userData.hobunjiCropRootKey, 'greenMustard');
assert.equal(townPlant.mesh.userData.hobunjiFoliageMesh, true);
assert.equal(townPlant.mesh.children[0].userData.noOutline, true);
console.log('ok - native, restored and NPC mushtard plants use alpha-cutout foliage, never legacy cubes');
