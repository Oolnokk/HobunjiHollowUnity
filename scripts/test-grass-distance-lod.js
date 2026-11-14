#!/usr/bin/env node
'use strict';

// The one grass billboard material (farm, town, town border, every wilderness
// zone) thins distant blades in its vertex shader. This loads the production
// vegetation module, lets it build the real material, and checks the wiring:
// only that material opts into the LOD define, every outdoor map shares one
// tunable uniform, and the A/B switch really disables the thinning.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}
class Geometry { translate() { return this; } }
class Color { setHSL() { return this; } set() { return this; } }
const materials = [];
class ShaderMaterial {
  constructor(def) { Object.assign(this, def); this.defines = def.defines || {}; materials.push(this); }
}
class TextureLoader { load(_url, onLoad) { onLoad({}); } }
class InstancedMesh {
  constructor(_g, material, capacity) {
    this.material = material; this.userData = {}; this.count = capacity;
    this.instanceMatrix = { array: new Float32Array(capacity * 16), needsUpdate: false };
  }
  setMatrixAt() {} computeBoundingBox() {} computeBoundingSphere() {}
}
class Object3D {
  constructor() {
    this.position = { set() {} }; this.rotation = { set() {} }; this.scale = { set() {} };
    this.matrix = { elements: new Float32Array(16) };
  }
  updateMatrix() {}
}
const THREE = {
  Vector3, Color, ShaderMaterial, TextureLoader, InstancedMesh, Object3D, Mesh: class { constructor() { this.userData = {}; this.position = { set() {} }; this.layers = { enable() {} }; } },
  PlaneGeometry: Geometry, BoxGeometry: Geometry,
  MathUtils: { degToRad: d => d * Math.PI / 180 },
  NearestFilter: 'nearest', DoubleSide: 'double', AdditiveBlending: 'add',
};
const window = {
  FarmPathBricks: { suppressesGrassAt: () => false },
  TerrainGeometry: { makeFloorGeo: () => new Geometry(), buildTerrainTileGeo: () => ({ dirtGeo: new Geometry(), grassGeo: null }) },
};
const context = vm.createContext({ window, THREE, Float32Array, Map, Set, Math, Number, Object, console });
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'docs/js/vegetation-crop-rendering.js'), 'utf8'), context, { filename: 'vegetation-crop-rendering.js' });
const veg = window.VegetationCropRendering;
const scene = { children: [], add(m) { this.children.push(m); }, remove() {} };
veg.init({
  COLS: 1, ROWS: 1, PLATEAU_UNIT: 2.5, TileType: { GRASS: 'grass', WEEDS: 'weeds' }, scene,
  getGrid: () => [[{ type: 'grass', crop: '' }]], getGrassEnabled: () => true, getWeed3D: () => false,
  getTownSceneBuilt: () => false, applySeasonalGrassAppearance() {},
  combatConfig: () => ({ cuttableTargetGlow: {} }), tileSurfaceY: () => 0,
  tileYCenter: () => 0, resolveTileMat: () => ({}), markTerrainEdgeId() {},
  terrainCategoryFor: t => t, NORMAL_TOP: 0,
});

const grass = veg.getGrassBillboardMat();
assert.ok(grass, 'the shared grass billboard material is built');
assert.equal(grass.defines.HOBUNJI_GRASS_DISTANCE_LOD, 1, 'grass material opts into distance thinning');
assert.match(grass.vertexShader, /#ifdef HOBUNJI_GRASS_DISTANCE_LOD[\s\S]*uniform vec3 uGrassLod/, 'LOD uniform is declared only under the define');
const others = materials.filter(m => m !== grass && m.vertexShader === grass.vertexShader);
assert.ok(others.length >= 1, 'the cuttable glow reuses the same vertex shader');
for (const m of others) {
  assert.ok(!m.defines.HOBUNJI_GRASS_DISTANCE_LOD, 'other users of the vertex shader keep the original path (they carry no uGrassLod)');
}

const lod = grass.uniforms.uGrassLod.value;
const defaults = veg.getGrassDistanceLod();
assert.equal(defaults.enabled, true, 'thinning is on by default');
assert.ok(defaults.near > 0 && defaults.far > defaults.near && defaults.minKeep > 0 && defaults.minKeep < 1, 'sane defaults');
assert.deepEqual([lod.x, lod.y, lod.z], [defaults.near, defaults.far, defaults.minKeep], 'uniform mirrors the reported settings');

veg.setGrassDistanceLod(false);
assert.equal(veg.getGrassDistanceLod().enabled, false, 'A/B switch disables thinning');
assert.ok(!(grass.uniforms.uGrassLod.value.y > grass.uniforms.uGrassLod.value.x), 'shader branch (y > x) is off');

veg.setGrassDistanceLod({ near: 5, far: 3, minKeep: 7 });
const clamped = veg.getGrassDistanceLod();
assert.ok(clamped.far > clamped.near && clamped.minKeep === 1, 'bad input is clamped to a valid, enabled range');
veg.setGrassDistanceLod(true);
assert.deepEqual(veg.getGrassDistanceLod(), defaults, 'true restores the defaults');
assert.equal(grass.uniforms.uGrassLod.value, lod, 'one shared vector: every outdoor map retunes together');
console.log('ok - grass distance LOD is wired to the shared grass material only, with a working A/B switch');
