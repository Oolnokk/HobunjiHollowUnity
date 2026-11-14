'use strict';

// Live scenery integration tests for the single Northern Cliffs plateau.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const moduleSource = fs.readFileSync('docs/js/northern-cliffs-plateau-backdrop.js', 'utf8'); // Production module under test.
const backdropSource = fs.readFileSync('docs/js/western-slope-mountain-backdrops.js', 'utf8'); // Shared mountain API must keep exporting the depth shader.
const bootstrap = fs.readFileSync('docs/js/environment-surface-runtime.js', 'utf8'); // One ordered boot slot loads both scenery modules.
assert.match(backdropSource, /getDebugState:debug,keepInFrontOfSky/);
assert.match(bootstrap, /'NorthernCliffsPlateauBackdrop'/);
assert(bootstrap.indexOf("'WesternSlopeMountainBackdrops'") < bootstrap.indexOf("'NorthernCliffsPlateauBackdrop'"), 'mountains must be ready before their dependent plateau module');

class Node3D {
  constructor() {
    this.children = []; this.parent = null; this.userData = {}; this.visible = true;
  }
  add(node) { node.parent = this; this.children.push(node); }
  remove(node) { this.children.splice(this.children.indexOf(node), 1); node.parent = null; }
  getObjectByName(name) {
    if (this.name === name) return this;
    for (const child of this.children) {
      const found = child.getObjectByName(name);
      if (found) return found;
    }
    return null;
  }
}
class Group extends Node3D {}
class Attribute {
  constructor(values, size) { this.array = values; this.itemSize = size; this.count = values.length / size; }
  getX(i) { return this.array[i * this.itemSize]; }
  getY(i) { return this.array[i * this.itemSize + 1]; }
  getZ(i) { return this.array[i * this.itemSize + 2]; }
}
class Geometry {
  constructor() { this.attributes = {}; this.disposed = false; }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key]; }
  computeVertexNormals() { this.normalsComputed = true; }
  dispose() { this.disposed = true; }
}
class Material {
  constructor() { this.userData = {}; this.disposed = false; }
  clone() { return new Material(); }
  dispose() { this.disposed = true; }
}
class Mesh extends Node3D {
  constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; }
}
const THREE = { Group, Mesh, BufferGeometry: Geometry, Float32BufferAttribute: Attribute, MeshStandardMaterial: Material, DoubleSide: 2 };
const sources = []; // Every temporary rock generated to measure the true world-space mountain height.
const stone = new Material();
const west = {
  constants: { ROCKS_PER_LAYER: 8, ROCK_SEED_BASE: 1731, ROCK_HEIGHT_FRACTION: 0.72 },
  resolveLayoutFromSizes(_sizes, cols, rows) {
    assert.equal(cols, 200); assert.equal(rows, 200);
    return [{
      index: 0, layer: 1, visible: true, width: 8, height: 0.72, targetLength: 40,
      scale: [2, 1.5, 1.25], position: [-12, 20, 10], rotationDeg: [0, 0, 0],
    }];
  },
  keepInFrontOfSky(material) { material.userData.distantDepthShader = true; },
};
const window = {
  THREE, WesternSlopeMountainBackdrops: west,
  TerrainGeometry: {
    buildRockTileGeo(_col, _row) {
      const g = new Geometry();
      g.setAttribute('position', new Attribute([-0.5, 0, -0.5, 0, 1, 0, 0.5, 0, 0.5], 3));
      sources.push(g); return { stoneGeo: g };
    },
  },
  OreRockTextures: { materialFor(_, name) { assert.equal(name, 'stone'); return stone; } },
  BorderTerrain: {
    buildZoneBorderTerrain(scene, cols, rows, mapId) { scene.borderBuilds = (scene.borderBuilds || 0) + 1; return { cols, rows, mapId }; },
  },
  WildernessChunks: { destroyZone(mapId) { return mapId; } },
};
vm.runInNewContext(moduleSource, { window, Math, Number, Object, Array, Map, WeakSet, Error, String });
const api = window.NorthernCliffsPlateauBackdrop;
assert(api?.installed, 'Northern Cliffs backdrop API missing');
assert.equal(api.constants.HEIGHT_RATIO, 0.7);
assert.equal(api.constants.BORDER_WIDTH, 18);
assert.equal(api.constants.BORDER_CLEARANCE, 6);

const unrelated = new Group();
window.BorderTerrain.buildZoneBorderTerrain(unrelated, 200, 200, 'map_western_slope');
assert.equal(unrelated.children.length, 0, 'Northern plateau must not leak into Western Slope');
const scene = new Group(); scene.items = [];
window.BorderTerrain.buildZoneBorderTerrain(scene, 200, 200, 'map_northern_cliffs');
const root = scene.getObjectByName('NorthernCliffsDistantPlateau');
assert(root, 'Northern Cliffs must render a plateau during border construction');
assert.equal(root.children.length, 1, 'mesa must be one mesh, not a chain of separate peaks');
assert(scene.items.includes(root), 'plateau must register with the existing scenery lifecycle');
assert.equal(sources.length, 8, 'height measurement must sample all eight reference mountain rocks');
assert(sources.every(geo => geo.disposed), 'reference stone geometries must not leak');
const mesh = root.children[0], geo = mesh.geometry, layout = api.getDebugState().lastLayout;
assert(mesh.material.userData.distantDepthShader, 'distant plateau must use the Western Slope depth shader');
assert.equal(mesh.material.userData.northernCliffsDistantPlateau, true);
assert.equal(mesh.raycast.toString().includes('=>'), true, 'decoration must use a no-op raycast');
assert.equal(mesh.castShadow, false, 'distant plateau must not cast shadow');
assert.equal(mesh.frustumCulled, false, 'distant background uses the mountain far-depth path');
assert.equal(layout.topWorldY, layout.referencePeakWorldY * 0.7, 'mesa height must be exactly 70% of the world-space maximum');
assert.equal(layout.width, layout.referenceMountainChainWidth, 'mesa footprint must equal the reference mountain chain width');
assert.equal(layout.baseFrontZ, -24, 'the northmost playable edge and 18-unit scenic skirt must both be cleared');
assert.equal(layout.outsideSceneryClearance, 6, 'footprint must remain six additional units beyond the skirt');
assert.equal(layout.triangleCount, 210, 'mesa must retain a very low triangle count');
assert(geo.normalsComputed, 'flat-shaded mesa facets must have normals');
const vertices = geo.getAttribute('position');
let minBaseX = Infinity, maxBaseX = -Infinity, furthestSouthBaseZ = -Infinity, highest = -Infinity;
for (let i = 0; i < vertices.count; i++) {
  const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i);
  highest = Math.max(highest, y);
  if (Math.abs(y) < 1e-6) {
    minBaseX = Math.min(minBaseX, x);
    maxBaseX = Math.max(maxBaseX, x);
    furthestSouthBaseZ = Math.max(furthestSouthBaseZ, z);
  }
}
assert(Math.abs(maxBaseX - minBaseX - layout.width) < 1e-5, 'base must span the full mountain-chain width');
assert(furthestSouthBaseZ < -24, 'no base vertex may overlap playable Northern Cliffs or its scenery border');
assert(Math.abs(highest - layout.topWorldY) < 1e-5, 'mesa top must use world-space height without local scaling leakage');
assert.equal(api.getDebugState().clearOfPlayableMap, true, 'mobile diagnostics must confirm boundary clearance');
assert.strictEqual(api.attach(scene, 200, 200), root, 'repeated zone attach cannot build duplicates');
assert.equal(sources.length, 8, 'duplicate attach must not regenerate reference mountains');
window.WildernessChunks.destroyZone('map_northern_cliffs');
assert.equal(scene.children.length, 0, 'destroying the zone must detach its plateau');
assert.equal(scene.items.length, 0, 'destroy must remove the root from scene items');
assert(geo.disposed && mesh.material.disposed, 'destroy must dispose geometry and owned material');
assert.equal(api.getDebugState().attached, false);
window.BorderTerrain.buildZoneBorderTerrain(scene, 200, 200, 'map_northern_cliffs');
assert.equal(scene.children.length, 1, 'subsequent zone visit must recreate one plateau');

console.log('Northern Cliffs giant distant plateau geometry, map clearance, height, and lifecycle checks passed.');
