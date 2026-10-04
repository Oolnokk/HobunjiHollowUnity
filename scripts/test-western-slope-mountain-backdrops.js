'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('docs/js/western-slope-mountain-backdrops.js', 'utf8'); // Production backdrop module exercised by the THREE shim below.
const environmentBootstrap = fs.readFileSync('docs/js/environment-surface-runtime.js', 'utf8'); // Existing environment compatibility slot must load the backdrop module before game boot.
const author = fs.readFileSync('docs/tools/background-scenery-author/index.html', 'utf8'); // Background author must synchronously load the mountain integration before its first map resolve.
const mountainAuthor = fs.readFileSync('docs/tools/background-scenery-author/mountain-backdrop-author.js', 'utf8'); // Additive tool integration exposes real PNGs and transform controls.

assert.match(environmentBootstrap, /western-slope-mountain-backdrops\.js\?v=[A-Za-z0-9_-]+/, 'environment bootstrap must load the Western Slope mountain module');
assert.match(source, /const WESTERN_SLOPE_ID = 'map_western_slope'/, 'module must remain scoped to Western Slope');
assert.match(source, /MIN_WIDTH_MULTIPLIER = 2\.75/, 'every layer must stay wider than the wilderness footprint');
assert.match(source, /WEST_LAYER_GAP_MULTIPLIER = 0\.85/, 'deep backdrop spacing must remain explicit and map-scaled');
assert.match(source, /AUTHOR_STORAGE_KEY = 'hobunjiWesternSlopeMountainBackdrops\.v1'/, 'runtime and author tool must share the same local transform override key');
assert.match(author, /western-slope-mountain-backdrops\.js\?v=[A-Za-z0-9_-]+/, 'Background Scenery Author must load the runtime transform contract before authoring');
assert.match(author, /mountain-backdrop-author\.js\?v=[A-Za-z0-9_-]+/, 'Background Scenery Author must load its mountain UI/preview bridge');
assert.match(mountainAuthor, /Mountain backdrop layers/, 'author bridge must expose mountain transform controls');
assert.match(mountainAuthor, /mountainPosX/, 'author bridge must expose position controls');
assert.match(mountainAuthor, /mountainRotY/, 'author bridge must expose rotation controls');
assert.match(mountainAuthor, /mountainScaleZ/, 'author bridge must expose scale controls');
assert.match(mountainAuthor, /assetBase:\s*'\.\.\/\.\.\/'/, '3D author preview must resolve the real repository PNGs from the tool directory');
assert.match(mountainAuthor, /Frame mountains/, 'author bridge must provide a camera fit for the gargantuan westward stack');

// Execute the author field formatter: unset coordinates must display resolved defaults,
// so editing rotation cannot accidentally snap all three positions to zero.
const inputs = Object.fromEntries(['x', 'y', 'z'].map(id => [id, { dataset: {} }])); // Fake number inputs consumed by the production formatter.
const formatterSource = mountainAuthor.slice(mountainAuthor.indexOf('  function displayVector('), mountainAuthor.indexOf('  function syncUi(')); // Only this pure UI formatter needs a DOM shim.
const formatterContext = { $: id => inputs[id] }; // Supplies the formatter's element lookup.
vm.createContext(formatterContext);
vm.runInContext(formatterSource, formatterContext);
formatterContext.displayVector(['x','y','z'], [null,null,null], [-194,160,100], [0,0,0]);
assert.deepEqual(Object.values(inputs).map(input => input.value), [-194,160,100], 'automatic coordinates must retain resolved positions');
formatterContext.displayVector(['x','y','z'], [0,-4,12], [-194,160,100], [0,0,0]);
assert.deepEqual(Object.values(inputs).map(input => input.value), [0,-4,12], 'explicit zero and negative positions must survive');

function transformSlot(defaults = { x: 0, y: 0, z: 0 }) {
  return {
    ...defaults,
    set(x, y, z) { this.x = x; this.y = y; this.z = z; },
  };
}
class Node3D {
  constructor() {
    this.children = [];
    this.parent = null;
    this.userData = {};
    this.visible = true;
    this.position = transformSlot();
    this.rotation = transformSlot();
    this.scale = transformSlot({ x: 1, y: 1, z: 1 });
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

const localStorageData = new Map();
const localStorage = {
  getItem(key) { return localStorageData.has(key) ? localStorageData.get(key) : null; },
  setItem(key, value) { localStorageData.set(key, String(value)); },
  removeItem(key) { localStorageData.delete(key); },
};
const THREE = {
  Group, PlaneGeometry, MeshBasicMaterial, Mesh, TextureLoader, FrontSide: 'front',
  MathUtils: { degToRad: degrees => degrees * Math.PI / 180 },
};
const window = { THREE, localStorage };
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
  const api = window.WesternSlopeMountainBackdrops;
  assert(api?.installed, 'public backdrop API missing');

  const unrelatedScene = new Group();
  window.BorderTerrain.buildZoneBorderTerrain(unrelatedScene, 200, 200, 'map_cloud_forest');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(unrelatedScene.children.length, 0, 'non-Western wilderness must not receive mountain planes');

  const scene = new Group();
  window.BorderTerrain.buildZoneBorderTerrain(scene, 200, 200, 'map_western_slope');
  await api.attach(scene, 200, 200, 'map_western_slope');

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

  const authored = api.readAuthorConfig();
  authored.layers[0].transform.position = [-40, 180, 95];
  authored.layers[0].transform.rotationDeg = [4, 82, -2];
  authored.layers[0].transform.scale = [1.2, 0.85, 1];
  authored.layers[1].visible = false;
  api.saveAuthorConfig(authored);
  api.applyAuthorConfigToGroup(root, 200, 200, api.readAuthorConfig());
  assert.deepEqual([root.children[0].position.x, root.children[0].position.y, root.children[0].position.z], [-40, 180, 95], 'editor-authored position must reach the live plane');
  assert(Math.abs(root.children[0].rotation.y - (82 * Math.PI / 180)) < 1e-9, 'editor-authored Y rotation must reach the live plane');
  assert.deepEqual([root.children[0].scale.x, root.children[0].scale.y, root.children[0].scale.z], [1.2, 0.85, 1], 'editor-authored scale must reach the live plane');
  assert.equal(root.children[1].visible, false, 'per-layer visibility must be authorable');

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
  assert.deepEqual(debug.lastLayout[0].position, [-40, 180, 95], 'debug snapshot must expose the author-edited transform');

  console.log('Western Slope mountain backdrop checks passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
