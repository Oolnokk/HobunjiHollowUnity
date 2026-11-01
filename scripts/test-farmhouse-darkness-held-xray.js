'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = path => fs.readFileSync(path, 'utf8');

class StubVector {}
class StubObject {
  constructor() {
    this.userData = {};
    this.children = [];
    this.parent = null;
    this.layers = {
      mask: 1,
      set(index) { this.mask = (1 << index) >>> 0; },
      enable(index) { this.mask |= (1 << index) >>> 0; },
    };
  }
  add(...objects) {
    for (const object of objects) { this.children.push(object); object.parent = this; }
    return this;
  }
  traverse(visitor) {
    visitor(this);
    for (const child of this.children) child.traverse(visitor);
  }
}
class StubScene extends StubObject {
  constructor() { super(); this.isScene = true; }
  getObjectByName(name) {
    let found = null;
    this.traverse(object => { if (object.name === name) found = object; });
    return found;
  }
}
class StubLight extends StubObject {
  constructor(color, intensity) { super(); this.isLight = true; this.color = color; this.intensity = intensity; }
}
class StubRenderer { render() {} }
const THREE = {
  Object3D: StubObject, Scene: StubScene, WebGLRenderer: StubRenderer,
  AmbientLight: StubLight, Vector3: StubVector, Vector4: StubVector,
  Vector2: StubVector, Box3: StubVector, Matrix3: StubVector,
  Matrix4: StubVector, Frustum: StubVector,
};

let scans = 0;
const window = {
  THREE,
  GridTileAccessors: { init(deps) { this.deps = deps; } },
  CloudForestFog: { refreshLightingOverlay() {} },
  WeatherFX: { __singleFullDayLightingAuthority: true },
};
const context = { window, performance: { now: () => 1000 }, console, queueMicrotask: callback => callback(),
  setInterval: () => 1, clearInterval() {} };
vm.runInNewContext(read('docs/js/held-object-render-order.js'), context);
const scanScene = window.HeldObjectRenderOrder.scanScene;
window.HeldObjectRenderOrder.scanScene = (...args) => { scans++; return scanScene(...args); };
vm.runInNewContext(read('docs/js/farmhouse-flat-lighting.js'), context);

let farmhouseScene = null;
const buildingScenes = new Map();
const dependencies = {
  _buildingScenes: buildingScenes,
  _isBuildingArea: id => String(id).startsWith('map_i_'),
  getInteriorScene: () => {
    if (!farmhouseScene) throw new Error('interiorScene is still in its temporal dead zone');
    return farmhouseScene;
  },
};
assert.doesNotThrow(() => window.GridTileAccessors.init(dependencies),
  'grid accessors must not eagerly dereference the farmhouse scene');

const plankMaterial = { userData: { hobunjiInteriorFloorMaterial: true, hobunjiInteriorWallStyle: '' } };
const untaggedMaterial = { userData: {} };
function mesh(scene, material, userData = {}) {
  const object = new StubObject();
  object.isMesh = true;
  object.material = material;
  object.userData = userData;
  scene.add(object);
  return object;
}
const xray = window.HeldObjectRenderOrder;
const farmhouse = farmhouseScene = new StubScene();
const firstFloor = mesh(farmhouse, plankMaterial); // Models a floor created before scene registration (defensive fallback).
window.FarmhouseFlatLighting.install(farmhouse, { ambient: {}, key: {}, fill: {} });
assert.equal(farmhouse.userData.hobunjiPlayerFarmhouseInterior, true);
assert.equal(farmhouse.userData.farmhouseFlatLighting, true);
assert(scans >= 1, 'registration rescans preexisting floor geometry');
assert.equal(xray.classify(firstFloor).ground, true);

const nextFloor = mesh(farmhouse, plankMaterial); // Simulates rebuildInteriorGeometry inserting new tiles.
const furniture = mesh(farmhouse, untaggedMaterial);
const otherInterior = new StubScene();
const otherFloor = mesh(otherInterior, plankMaterial);
const exterior = new StubScene();
const grass = mesh(exterior, { userData: { hobunjiBaseGrassTerrainMaterial: true } }, { mapEditorTerrain: true });
assert.equal(xray.classify(nextFloor).ground, true);
assert.equal(xray.classify(furniture).ground, false, 'solid furniture must still hide tools');
assert.equal(xray.classify(otherFloor).ground, false, 'mine/den/other interior floors are unaffected');
assert.equal(xray.classify(grass).ground, true, 'exterior farm terrain still x-rays');
assert(xray.snapshot().farmhouseFloorMeshes >= 2, 'preexisting and newly rebuilt floors join depth replay');

const authored = new StubScene();
buildingScenes.set('map_i_temple', { scene: authored, wallStyle: 'brick' });
assert.equal(authored.userData.farmhouseFlatLighting, true, 'authored interiors retain flat lighting');
assert.notEqual(authored.userData.hobunjiPlayerFarmhouseInterior, true,
  'authored interiors do not receive the special farmhouse floor X-ray');

assert.equal(dependencies.getInteriorScene(), farmhouse,
  'the stable farmhouse scene getter is left untouched by the lighting adapter');
assert.equal(window.FarmhouseFlatLighting.debugSnapshot().playerFarmhouseSceneCount, 1,
  'rebuilding floor geometry does not install a fresh lighting adapter');

console.log('Farmhouse darkness registration and selective floor X-ray regressions passed.');
