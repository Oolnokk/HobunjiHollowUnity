'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('docs/js/western-slope-mountain-backdrops.js', 'utf8'); // Production backdrop module exercised by the THREE shim below.
const environmentBootstrap = fs.readFileSync('docs/js/environment-surface-runtime.js', 'utf8'); // Existing environment compatibility slot must load the backdrop module before game boot.

assert.match(environmentBootstrap, /western-slope-mountain-backdrops\.js\?v=20261003a/, 'environment bootstrap must load the Western Slope mountain module');
assert.match(source, /const WESTERN_SLOPE_ID = 'map_western_slope'/, 'module must remain scoped to Western Slope');
assert.match(source, /MIN_WIDTH_MULTIPLIER = 2\.75/, 'every layer must stay wider than the wilderness footprint');
assert.match(source, /WEST_LAYER_GAP_MULTIPLIER = 0\.85/, 'deep backdrop spacing must remain explicit and map-scaled');

class Node3D {
  constructor() {
    this.children = [];
    this.parent = null;
    this.userData = {};
    this.position = { x: 0, y: 0, z: 0, set: (x, y, z) => Object.assign(this.position, { x, y, z }) };
    this.rotation = { x: 0, y: 0, z: 0 };
  }
  add(object) {
    if (object.parent) object.parent.remove(object);
    object.parent = this;
    this.children.push(object);
  }
  remove(object) {
    this.children = this.children.filter(child => child !== object);
    if (object) object.parent = null;
  }
  getObjectByName(name) {
    if (this.name === name) return this;
    for (const child of this.children) {
      const found = child.getObjectByName?.(name) || (child.name === name ? child : null);
      if (found) return found;
    }
    return null;
  }
}
class Group extends Node3D {}
class PlaneGeometry {
  constructor(width, height) { this.width = width; this.height = height; this.disposed = false; }
  dispose() { this.disposed = true; }
}
class MeshBasicMaterial {
  constructor(options) { Object.assign(this, options); this.userData = {}; this.toneMapped = true; this.disposed = false; }
  dispose() { this.disposed = true; }
}
class Mesh extends Node3D {
  constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; this.isMesh = true; }
}

const imageSizes = {
  'assets/backdrops/bd_mountains_1.png': [1200, 500],
  'assets/backdrops/bd_mountains_2.png': [900, 650],
  'assets/backdrops/bd_mountains_3.png': [1400, 700],
}; // Deliberately different aspect ratios prove all layers share one source-pixel scale instead of one forced plane size.
class TextureLoader {
  load(url, onLoad, _onProgress, onError) {
    const size = imageSizes[url];
    if (!size) { onError(new Error(`missing ${url}`)); return; }
    queueMicrotask(() => onLoad({
      image: { width: size[0], height: size[1] },
      userData: {},
      disposed: false,
      dispose() { this.disposed = true; },
    }));
  }
}

const THREE = { Group, PlaneGeometry, MeshBasicMaterial, Mesh, TextureLoader, FrontSide: 'front' };
const window = { THREE };
window.BorderTerrain = {
  buildZoneBorderTerrain(scene, cols, rows, mapId) {
    scene.borderBuilds = (scene.borderBuilds || 0) + 1;
    return { cols, rows, mapId };
  },
};
window.WildernessChunks = {
  destroyZone(mapId) { this.lastDestroyed = mapId; return true; },
};

vm.runInNewContext(source, {
  window,
  console,
  queueMicrotask,
  Promise,
  Map,
  WeakSet,
  Object,
  Math,
  Number,
  Array,
  String,
  Error,
});

(async () => {
  assert(window.WesternSlopeMountainBackdrops?.installed, 'public backdrop API missing');

  const unrelatedScene = new Group();
  window.BorderTerrain.buildZoneBorderTerrain(unrelatedScene, 200, 200, 'map_cloud_forest');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(unrelatedScene.children.length, 0, 'non-Western wilderness must not receive mountain planes');

  const scene = new Group();
  window.BorderTerrain.buildZoneBorderTerrain(scene, 200, 200, 'map_western_slope');
  await window.WesternSlopeMountainBackdrops.attach(scene, 200, 200, 'map_western_slope');

  const root = scene.getObjectByName('WesternSlopeMountainBackdrops');
  assert(root, 'Western Slope backdrop root missing');
  assert.equal(root.children.length, 3, 'exactly three authored mountain layers must be present');
  assert.deepEqual(root.children.map(mesh => mesh.position.x), [-24, -194, -364], 'layers must progress far west from the Western Slope edge');
  assert(root.children.every(mesh => Math.abs(mesh.rotation.y - Math.PI / 2) < 1e-9), 'planes must face east toward the playable wilderness');
  assert(root.children.every(mesh => mesh.geometry.width >= 550 && mesh.geometry.height >= 320), 'all mountain layers must be gargantuan relative to a 200x200 wilderness');

  const pixelScales = root.children.map((mesh, index) => {
    const sourceWidth = imageSizes[`assets/backdrops/bd_mountains_${index + 1}.png`][0];
    return mesh.geometry.width / sourceWidth;
  });
  assert(pixelScales.every(value => Math.abs(value - pixelScales[0]) < 1e-10), 'all mountain PNGs must use the exact same world-units-per-pixel scale');
  assert.deepEqual(root.children.map(mesh => mesh.renderOrder), [-101, -102, -103], 'farthest transparent layer must render before nearer layers');
  assert(root.children.every(mesh => mesh.material.depthWrite === false && mesh.material.fog === false), 'background planes must not write depth or inherit near-ground fog');

  window.BorderTerrain.buildZoneBorderTerrain(scene, 200, 200, 'map_western_slope');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(scene.children.filter(child => child.name === 'WesternSlopeMountainBackdrops').length, 1, 'repeated zone-border builds must not duplicate mountain stacks');

  const geometries = root.children.map(mesh => mesh.geometry);
  const materials = root.children.map(mesh => mesh.material);
  const textures = root.children.map(mesh => mesh.material.map);
  assert.equal(window.WildernessChunks.destroyZone('map_western_slope'), true, 'wrapped destroyZone must preserve original return value');
  assert(!scene.getObjectByName('WesternSlopeMountainBackdrops'), 'destroyZone must detach backdrop root');
  assert(geometries.every(geometry => geometry.disposed), 'destroyZone must dispose backdrop geometry');
  assert(materials.every(material => material.disposed), 'destroyZone must dispose backdrop materials');
  assert(textures.every(texture => texture.disposed), 'destroyZone must dispose loaded PNG textures');

  const debug = window.__westernSlopeMountainBackdropsDebug();
  assert.equal(debug.active, false, 'mobile debug snapshot must report disposed scene as inactive');
  assert.equal(debug.completedBuilds, 1, 'debug snapshot must count the completed stack');
  assert.equal(debug.disposedBuilds, 1, 'debug snapshot must count lifecycle cleanup');
  assert.equal(debug.lastLayout.length, 3, 'debug snapshot must expose all authored layer transforms');

  console.log('Western Slope mountain backdrop checks passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
