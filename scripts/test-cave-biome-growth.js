'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Lightweight geometry and color stand-ins validate recipe and renderer routing without WebGL.
class Color {
  constructor(hex = 0) { this.hex = Number(hex) || 0; }
  setHSL(h, s, l) { this.hex = Math.round(h * 0xffffff); return this; }
  getHexString() { return this.hex.toString(16).padStart(6, '0'); }
}
class Geometry {
  constructor() { this.attributes = {}; this.userData = {}; }
  setAttribute(name, attr) { this.attributes[name] = attr; }
  setIndex(attr) { this.index = attr; }
  computeVertexNormals() {}
}
class Attribute {
  constructor(array, size) { this.array = array; this.itemSize = size; }
}
class Mesh {
  constructor(geometry, material) {
    this.geometry = geometry; this.material = material;
    this.isMesh = true; this.userData = {}; this.children = [];
  }
  add(child) { this.children.push(child); child.parent = this; }
}
class Material {
  constructor(opts) { Object.assign(this, opts); }
}
const three = {
  Color, BufferGeometry: Geometry, Float32BufferAttribute: Attribute,
  BufferAttribute: Attribute, Mesh, MeshBasicMaterial: Material,
  FrontSide: 0, Group: class {},
};
const context = { console, THREE: three };
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/foliage-generator.js', 'utf8'), context);
const recipes = context.FoliageGenerator.caveGrowthRecipes;
const seed = 'identical-den-id'; // Used to check that successive visits yield identical deterministic recipes.

const cloud = recipes('map_southern_cloud_forest', seed);
const mire = recipes('map_eastern_mire', seed);
const north = recipes('map_northern_cliffs', seed);
assert.equal(cloud.length, 2, 'Cloud Forest cave has roots and vines');
assert.equal(mire.length, 2, 'Eastern Mire cave has roots and vines');
assert.equal(north.length, 1, 'Northern Cliffs cave has only roots');
assert.equal(north[0].kind, 'roots');
assert.equal(cloud[0].kind, 'roots');
assert.equal(cloud[1].kind, 'vines');
assert.equal(mire[1].kind, 'vines');
for (const growth of [...cloud, ...mire, ...north]) {
  assert.equal(growth.wallOnly, true, 'no strands belong on cave floor or roof');
  assert.match(growth.texture, /^assets\/textures\/.*\.png$/, 'use the shared natural-surface texture catalog');
}
assert.equal(cloud[0].color, '#4a3b33', 'Cloud Forest roots use shadewood bark color');
assert.equal(north[0].color, '#4a3b33', 'Northern Cliffs roots use crowned pine bark color');
assert(cloud[1].hangChance > 0 && cloud[1].hangLength > 0, 'some Cloud Forest vines hang');
assert(mire[1].hangChance > 0 && mire[1].hangLength > 0, 'some Mire vines hang');
assert.equal(recipes('map_western_slope', seed).length, 0, 'Western Slope caves stay bare');
assert.equal(recipes('', seed).length, 0, 'town mine and unclassified interiors stay bare');
assert.equal(JSON.stringify(recipes('map_eastern_mire', seed)), JSON.stringify(mire), 'recipes must be stable per cave');

// Exercise the real shared-sampling path on an empty but valid triangle source.
// It deliberately avoids constructing tubes; this checks that two recipe calls
// scan the unchanged cavern mesh once, without relying on a mocked growth API.
{
  class Matrix {
    clone() { return this; }
    invert() { return this; }
    multiply() { return this; }
  }
  three.Matrix4 = Matrix; // Fake transform consumed by the surface source's coordinate conversion.
  three.Vector3 = class {}; // Empty geometry requires a scratch vector but no vector arithmetic.
  three.Group = class {
    constructor() { this.userData = {}; this.children = []; }
    add(child) { this.children.push(child); }
  };
  const emptyGeometry = new Geometry(); // Zero triangles test source selection/index reuse independent of tube tessellation.
  emptyGeometry.setAttribute('position', { count: 0 });
  emptyGeometry.drawRange = { start: 0, count: 0 };
  const shell = new Mesh(emptyGeometry, new Material({}));
  shell.matrixWorld = new Matrix();
  shell.updateWorldMatrix = () => {};
  let scans = 0; // Counts source scene traversals to detect an accidental second full cave-mesh scan.
  shell.traverse = visit => { scans++; visit(shell); };
  const first = context.FoliageGenerator.buildSurfaceGrowth(shell, cloud[0]);
  const second = context.FoliageGenerator.buildSurfaceGrowth(shell, cloud[1]);
  assert.equal(scans, 1, 'roots and vines share one source traversal for the immutable cave shell');
  assert.equal(first.userData.surfaceGrowthStats.samplingReused, false, 'roots populate a new spatial index');
  assert.equal(second.userData.surfaceGrowthStats.samplingReused, true, 'vines reuse the previously sampled cave index');
}

// The real renderer attaches the already-authored growth recipe only to qualified shells.
const built = []; // Tracks calls into the FoliageGenerator visual mesh owner without building GPU geometry.
context.FoliageGenerator.buildSurfaceGrowth = (shell, recipe) => {
  built.push({ shell, recipe });
  return { userData: { surfaceFoliage: true } };
};
vm.runInContext(fs.readFileSync('docs/js/interior-scene-builder.js', 'utf8'), context);
const data = biome => ({
  positions: [0, 0, 0, 1, 0, 0, 0, 2, 1],
  indices: [0, 1, 2],
  caveBiome: biome,
  caveGrowthSeed: seed,
});
for (const [biome, expected] of [
  ['map_southern_cloud_forest', 2],
  ['map_eastern_mire', 2],
  ['map_northern_cliffs', 1],
  ['map_western_slope', 0],
  ['', 0],
]) {
  const before = built.length;
  const shell = context.InteriorSceneBuilder.buildCarvedCavernMesh(three, data(biome));
  assert(shell.isMesh, 'cave shell must keep its existing Mesh return contract');
  assert.equal(shell.children.length, expected, `${biome || 'mine'}: expected growth groups`);
  assert.equal(built.length - before, expected, 'new geometry is created only for eligible biomes');
  assert.equal(shell.userData.caveGrowthBiome || '', expected ? biome : '', 'the visual biome remains inspectable on mobile');
}
console.log('cave biome wall growth and renderer routing regression checks passed');
