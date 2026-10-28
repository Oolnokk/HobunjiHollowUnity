'use strict';

const assert = require('node:assert/strict'); // Checks generated farm doorframes against the shared entrance finish.
const fs = require('node:fs'); // Loads the same render modules shipped to the browser.
const vm = require('node:vm'); // Runs the classic browser modules with lightweight Three.js objects.

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  fromArray(a) { return this.set(a[0], a[1], a[2]); }
  clone() { return new Vector3(this.x, this.y, this.z); }
  sub(v) { return this.set(this.x - v.x, this.y - v.y, this.z - v.z); }
  add(v) { return this.set(this.x + v.x, this.y + v.y, this.z + v.z); }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  crossVectors(a, b) { return this.set(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
  cross(v) { return this.crossVectors(this.clone(), v); }
  lengthSq() { return this.dot(this); }
  length() { return Math.sqrt(this.lengthSq()); }
  distanceTo(v) { return this.clone().sub(v).length(); }
  normalize() { return this.multiplyScalar(1 / (this.length() || 1)); }
  multiplyScalar(n) { return this.set(this.x * n, this.y * n, this.z * n); }
  addScaledVector(v, n) { return this.set(this.x + n * v.x, this.y + n * v.y, this.z + n * v.z); }
}

class Group {
  constructor() {
    this.children = []; // Holds the generated frame, door furniture and wall cladding meshes.
    this.userData = {}; // Exposes the render and attachment diagnostics.
    this.position = new Vector3(); // Door furniture uses this when attaching to the entrance tile.
    this.rotation = { y: 0 }; // Door furniture uses this to face the entry direction.
  }
  add(child) { this.children.push(child); }
  traverse(visitor) { visitor(this); this.children.forEach(child => child.traverse?.(visitor)); }
  getObjectByName(name) { return this.children.find(child => child.name === name) || null; }
}

class Mesh {
  constructor(geometry, material) {
    this.geometry = geometry; // Keeps real triangulated HousePieceGen positions available to the UV mapper.
    this.material = material; // Replaced with the shared entrance material by the feature under test.
    this.userData = {}; // Holds housePieceDoorwayFrame markers.
    this.isMesh = true;
  }
  traverse(visitor) { visitor(this); }
}

class Geometry {
  constructor() { this.attributes = {}; } // Stores generated position/UV attributes.
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key]; }
  computeVertexNormals() {}
}

class Attribute {
  constructor(array, width) {
    this.array = array; // Stores flat triangle vertices or generated UV coordinates.
    this.count = array.length / width;
    this.itemSize = width;
  }
  getX(index) { return this.array[index * this.itemSize]; }
  getY(index) { return this.array[index * this.itemSize + 1]; }
  getZ(index) { return this.array[index * this.itemSize + 2]; }
}

class Material {
  constructor(options) {
    this.userData = {}; // HousePieceGen can read optional tiling hints from the material.
    this.color = { hex: options.color, setHex(hex) { this.hex = hex; } }; // Supports the wood fallback tint.
    this.side = options.side;
  }
}

const textureLoads = []; // Proves that all entrance pieces request only one shared PNG.
const THREE = {
  Vector3, Group, Mesh, BufferGeometry: Geometry, BufferAttribute: Attribute,
  Float32BufferAttribute: Attribute, MeshLambertMaterial: Material, MeshBasicMaterial: Material,
  TextureLoader: class { load(path) { textureLoads.push(path); } },
  FrontSide: 0, DoubleSide: 2, ClampToEdgeWrapping: 1001,
};

const windowStub = { THREE }; // Owns HousePieceGen, the door attachment bridge and the common surface module.
const browser = vm.createContext({
  window: windowStub,
  location: { search: '' },
  URLSearchParams,
  console,
}); // Loads the modules in the same order as the live game's parser and deferred feature loader.
for (const path of ['docs/js/HousePieceGen.js', 'docs/js/entry-tunnel-door-furniture.js', 'docs/js/porch-surface-material.js']) {
  vm.runInContext(fs.readFileSync(path, 'utf8'), browser, { filename: path });
}

const style = windowStub.HobunjiPorchSurfaceMaterial; // Single material authority for frames, porches, fences and doors.
const commonMaterial = style.materialForTag('door'); // Compared by identity, not merely matching color.
assert.strictEqual(style.materialForTag('porch'), commonMaterial);
assert.strictEqual(style.materialForTag('railing'), commonMaterial);
assert.equal(style.debugSnapshot().generatedTunnelPatchInstalled, true);

for (const side of ['north', 'east', 'south', 'west']) {
  const wallPanels = []; // Tracks entry wall cladding to confirm that only doorframes changed materials.
  const wallBuilder = { build(panels) { wallPanels.push(...panels); return new Group(); } };
  const entrance = windowStub.HousePieceGen.buildEntryTunnelGroup(THREE, 7, 8, side, { wallBuilder });
  const frames = entrance.children.filter(node => node.isMesh && node.userData.housePieceDoorwayFrame);
  const detail = style.debugSnapshot().lastBuild; // Reports matched and unmatched generated frame faces.
  assert(frames.length > 0, side + ': generated door jamb/lintel must have frame meshes');
  assert(frames.every(mesh => mesh.material === commonMaterial), side + ': all doorway-frame faces use common wood');
  assert(frames.every(mesh => mesh.geometry.getAttribute('uv')?.count === 6), side + ': frames have complete UVs');
  assert.equal(detail.missing, 0, side + ': no missing generated face matches');
  assert.equal(detail.frameFaces, frames.length, side + ': diagnostics count every rendered frame face');
  assert(wallPanels.length > 0, side + ': adjacent entry-tunnel walls remain under WallBuilder');
}

assert.deepEqual(textureLoads, ['assets/textures/carved_smooth.png'], 'all tested frames share the same loaded wood texture');
console.log('Generated farmhouse entrance wood material (all four orientations): ok');
