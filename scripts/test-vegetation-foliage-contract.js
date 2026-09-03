const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const bridgeSource = fs.readFileSync('docs/js/livestock-nursery-install-bridge.js', 'utf8');
const vegetationSource = fs.readFileSync('docs/js/vegetation-crop-rendering.js', 'utf8');

assert(
  vegetationSource.includes("moundRoot || { _windAmp: 0 }"),
  'test still targets the known ROCK no-geometry sentinel from the decoupling pass',
);
assert(
  bridgeSource.includes("typeof mesh.traverse === 'function'"),
  'compatibility guard enforces the render loop Object3D/traverse contract',
);

const validMesh = { traverse() {} };
const meshes = [null, null];
const active = new Set();
const VegetationCropRendering = {
  vegFoliageMeshes: meshes,
  vegFoliageActive: active,
  buildTileMeshes() {
    meshes[0] = { _windAmp: 0 }; // Reproduce the current ROCK fallback bug.
    active.add(0);
    meshes[1] = validMesh;
    active.add(1);
  },
  refreshTileMesh() {
    meshes[0] = { _windAmp: 0 };
    active.add(0);
  },
  rebuildWeedTiles() {
    meshes[0] = { _windAmp: 0 };
    active.add(0);
  },
};

const context = {
  window: {
    VegetationCropRendering,
    LivestockNursery: { install() {} },
  },
  setInterval() { throw new Error('FarmPanel setter path should install synchronously'); },
  clearInterval() {},
  Object,
  Array,
  Set,
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(bridgeSource, context);

// Publishing FarmPanel is the bridge's normal parser-time install point.
context.window.FarmPanel = {};

context.window.VegetationCropRendering.buildTileMeshes();
assert.equal(meshes[0], null, 'non-Object3D ROCK sentinel is removed after full tile rebuild');
assert(!active.has(0), 'invalid ROCK sentinel is removed from the active foliage index set');
assert.equal(meshes[1], validMesh, 'real Object3D-like foliage remains untouched');
assert(active.has(1), 'real foliage remains active');

context.window.VegetationCropRendering.refreshTileMesh();
assert.equal(meshes[0], null, 'single-tile rebuild also prunes invalid foliage');
assert(!active.has(0), 'single-tile rebuild cannot re-arm an invalid foliage index');

context.window.VegetationCropRendering.rebuildWeedTiles();
assert.equal(meshes[0], null, 'weed rebuild also prunes invalid foliage');
assert(!active.has(0), 'weed rebuild cannot leave an invalid foliage index active');

console.log('vegetation foliage contract regression tests passed');
