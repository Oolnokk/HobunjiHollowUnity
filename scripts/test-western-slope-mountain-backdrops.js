'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('docs/js/western-slope-mountain-backdrops.js', 'utf8'); // Production backdrop module exercised by the THREE shim below.
const snowSurfaceSource = fs.readFileSync('docs/js/environment-surface-micro-plateau.js', 'utf8'); // Canonical snow material owner shared by each decorative cap.
const environmentBootstrap = fs.readFileSync('docs/js/environment-surface-runtime.js', 'utf8'); // Loads the production backdrop module before game boot.
const author = fs.readFileSync('docs/tools/background-scenery-author/index.html', 'utf8'); // The author preview must load the same runtime module.
const mountainAuthor = fs.readFileSync('docs/tools/background-scenery-author/mountain-backdrop-author.js', 'utf8'); // Existing author controls retain their transform API.

assert.match(environmentBootstrap, /western-slope-mountain-backdrops\.js\?v=[A-Za-z0-9_-]+/, 'environment bootstrap must load the Western Slope scenery module');
assert.match(source, /const WESTERN_SLOPE_ID = 'map_western_slope'/, 'module must remain scoped to Western Slope');
assert.match(source, /const ROCKS_PER_LAYER = 8/, 'each former PNG layer must become exactly eight rocks');
assert.match(source, /const RIDGE_LENGTH_MAP_MULTIPLIER = 2/, 'each complete rock ridge must span twice the map north-south edge');
assert.match(source, /const SNOW_CAP_HEIGHT_FRACTION = 2 \/ 3/, 'snow must cover the upper two-thirds of each rock');
assert.match(source, /farm-cliff-planar-stretch/, 'snow cap UVs must use the same planar stretch-to-fit method as farm cliffs');
assert.match(source, /new T\.LineSegments/, 'the stone/snow boundary must retain a visible outline');
assert.match(snowSurfaceSource, /getSnowMaterial: \(\) => material\('snow'\)/, 'rock caps must reuse the canonical Western Slope snow material');
assert.match(snowSurfaceSource, /bindSnowTexture\(target\)/, 'cap material clones must receive the asynchronously loaded snow texture');
assert.match(snowSurfaceSource, /unbindSnowTexture\(target\)/, 'disposed cap clones must unregister from the snow texture loader');
assert.match(source, /decorativeRockRidges:true/, 'replacement scenery must identify itself as decorative ridges');
assert.match(source, /visualOnly:true/, 'replacement scenery must be visual only');
assert.doesNotMatch(source, /diggableRockOre|mineableRocksByTile|oreKey/, 'backdrop rocks must never register as mineable resources');
assert.match(source, /WEST_LAYER_GAP_MULTIPLIER = 0\.85/, 'deep scenery spacing must remain explicit and map-scaled');
assert.match(source, /WEST_STACK_SHIFT_MULTIPLIER = 0\.25/, 'the complete default stack must retain its westward shift');
assert.match(source, /AUTHOR_STORAGE_KEY = 'hobunjiWesternSlopeMountainBackdrops\.v1'/, 'runtime and author tool must share the existing local transform override key');
assert.match(author, /western-slope-mountain-backdrops\.js\?v=[A-Za-z0-9_-]+/, 'Background Scenery Author must load the replacement module');
assert.match(mountainAuthor, /Western Slope rock ridges/, 'author bridge must identify the replacement scenery');
const terrainGeometryScript = author.indexOf('../../js/terrain-geometry.js?'); // The standalone author page needs the same mine-rock geometry builder as gameplay.
const oreTexturesScript = author.indexOf('../../js/ore-rock-textures.js?'); // The preview uses the live mine-rock material and UV treatment.
const backdropScript = author.indexOf('../../js/western-slope-mountain-backdrops.js?'); // Runtime must load only after both mine-rock dependencies.
assert(terrainGeometryScript >= 0 && terrainGeometryScript < backdropScript, 'author page must load terrain geometry before the rock-ridge runtime');
assert(oreTexturesScript >= 0 && oreTexturesScript < backdropScript, 'author page must load mine-rock textures before the rock-ridge runtime');
const authorAssetBase = author.indexOf("window.OreRockTexturesAssetBase='../../';"); // The shared mine texture is rooted at docs/ in the standalone nested tool.
assert(authorAssetBase >= 0 && authorAssetBase < oreTexturesScript, 'author page must configure the texture base before loading mine-rock materials');
assert.match(author, /ore-rock-textures\.js\?v=[A-Za-z0-9_-]+/, 'author page must load the versioned shared mine-texture module');
assert.match(mountainAuthor, /8 decorative mine rocks/, 'author bridge must no longer present the PNG as the live scenery');
assert.match(mountainAuthor, /mountainPosX/, 'author bridge must retain position controls');
assert.match(mountainAuthor, /mountainRotY/, 'author bridge must retain rotation controls');
assert.match(mountainAuthor, /mountainScaleZ/, 'author bridge must retain scale controls');

// Execute the author field formatter: unset coordinates must display resolved defaults.
const inputs = Object.fromEntries(['x', 'y', 'z'].map(id => [id, { dataset: {} }]));
const formatterSource = mountainAuthor.slice(mountainAuthor.indexOf('  function displayVector('), mountainAuthor.indexOf('  function syncUi('));
const formatterContext = { $: id => inputs[id] };
vm.createContext(formatterContext);
vm.runInContext(formatterSource, formatterContext);
formatterContext.displayVector(['x','y','z'], [null,null,null], [-194,160,100], [0,0,0]);
assert.deepEqual(Object.values(inputs).map(input => input.value), [-194,160,100], 'automatic coordinates must retain resolved positions');
formatterContext.displayVector(['x','y','z'], [0,-4,12], [-194,160,100], [0,0,0]);
assert.deepEqual(Object.values(inputs).map(input => input.value), [0,-4,12], 'explicit zero and negative positions must survive');

function transformSlot(defaults = { x: 0, y: 0, z: 0 }) {
  return { ...defaults, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
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
class FakeBufferAttribute {
  constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; }
  getX(index) { return this.array[index * this.itemSize]; }
  getY(index) { return this.array[index * this.itemSize + 1] ?? 0; }
  getZ(index) { return this.array[index * this.itemSize + 2] ?? 0; }
  setXY(index, x, y) { this.array[index * this.itemSize] = x; this.array[index * this.itemSize + 1] = y; }
}
class FakeGeometry {
  constructor(seed) { this.seed = seed; this.disposed = false; this.attributes = {}; this.index = null; this.userData = {}; }
  setAttribute(name, attribute) { this.attributes[name] = attribute; return this; }
  getAttribute(name) { return this.attributes[name] || null; }
  setIndex(index) { this.index = index; return this; }
  computeVertexNormals() { return this; }
  computeBoundingSphere() { return this; }
  dispose() { this.disposed = true; }
}
class FakeMaterial {
  constructor(options = {}) { Object.assign(this, { depthTest: true, depthWrite: true, fog: true }, options); this.userData = {}; this.disposed = false; }
  clone() { const cloned = new this.constructor(this); cloned.userData = { ...this.userData }; return cloned; }
  dispose() { this.disposed = true; }
}
class MeshStandardMaterial extends FakeMaterial {}
class MeshBasicMaterial extends FakeMaterial {}
class LineBasicMaterial extends FakeMaterial {}
class Mesh extends Node3D {
  constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; this.isMesh = true; }
}
class LineSegments extends Node3D {
  constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; this.isLineSegments = true; }
}

const sharedMineMaterial = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, map: { shared: true } });
const sharedSnowMaterial = new MeshBasicMaterial({ color: 0xffffff, map: { sharedSnow: true }, depthTest: true, depthWrite: true, fog: true });
const snowMaterialBindings = new Set(); // Verifies the cap clone remains synchronized without changing the ground material.
const sourceGeometries = [];
const unusedGrassGeometries = [];
let geometryCalls = 0;
let fitCalls = 0;
const THREE = {
  Group, Mesh, LineSegments, MeshStandardMaterial, MeshBasicMaterial, LineBasicMaterial,
  BufferGeometry: FakeGeometry,
  BufferAttribute: FakeBufferAttribute,
  Float32BufferAttribute: FakeBufferAttribute,
  MathUtils: { degToRad: degrees => degrees * Math.PI / 180 },
};
const localStorageData = new Map();
const localStorage = {
  getItem(key) { return localStorageData.has(key) ? localStorageData.get(key) : null; },
  setItem(key, value) { localStorageData.set(key, String(value)); },
  removeItem(key) { localStorageData.delete(key); },
};
const window = {
  THREE,
  localStorage,
  EnvironmentSurfaceMicroPlateau: {
    getSnowMaterial: () => sharedSnowMaterial,
    bindSnowTexture: material => { material.map = sharedSnowMaterial.map; snowMaterialBindings.add(material); return true; },
    unbindSnowTexture: material => snowMaterialBindings.delete(material),
    debugSnapshot: () => ({ textureState: 'shade-filled-white-canvas-png' }),
  },
  TerrainGeometry: {
    buildRockTileGeo(col, row) {
      geometryCalls++;
      const geometry = new FakeGeometry(col + row);
      geometry.setAttribute('position', new FakeBufferAttribute(new Float32Array([
        -0.5,0,-0.5,  0,1,0,  0.5,0,-0.5,  0.5,0,0.5,  -0.5,0,0.5,
      ]), 3));
      geometry.setAttribute('uv', new FakeBufferAttribute(new Float32Array([0,0, 0.5,0.5, 1,0, 1,1, 0,1]), 2));
      geometry.setIndex(new FakeBufferAttribute(new Uint16Array([0,1,2, 2,1,3, 3,1,4, 4,1,0]), 1));
      sourceGeometries.push(geometry);
      const grassGeo = new FakeGeometry(-1); unusedGrassGeometries.push(grassGeo);
      return { stoneGeo: geometry, grassGeo, heightTiles: 0.55 };
    },
  },
  OreRockTextures: {
    materialFor(_three, key) {
      assert.equal(key, 'stone', 'scenery must reuse the mine-rock stone appearance, not create ore nodes');
      return sharedMineMaterial;
    },
    fitRockMesh(mesh) {
      fitCalls++;
      mesh.userData.mineRockUvsApplied = true;
      return true;
    },
  },
};
window.BorderTerrain = {
  buildZoneBorderTerrain(scene, cols, rows, mapId) {
    scene.borderBuilds = (scene.borderBuilds || 0) + 1;
    return { cols, rows, mapId };
  },
};
window.WildernessChunks = {
  destroyZone(mapId) { this.lastDestroyed = mapId; return true; },
};

vm.runInNewContext(source, { window, console, Promise, Map, WeakSet, Object, Math, Number, Array, String, Error });

(async () => {
  const api = window.WesternSlopeMountainBackdrops;
  assert(api?.installed, 'public backdrop API missing');

  const unrelatedScene = new Group();
  window.BorderTerrain.buildZoneBorderTerrain(unrelatedScene, 200, 200, 'map_cloud_forest');
  assert.equal(unrelatedScene.children.length, 0, 'non-Western wilderness must not receive the decorative rocks');

  const scene = new Group();
  window.BorderTerrain.buildZoneBorderTerrain(scene, 200, 200, 'map_western_slope');
  await api.attach(scene, 200, 200, 'map_western_slope');

  const root = scene.getObjectByName('WesternSlopeMountainBackdrops');
  assert(root, 'Western Slope scenery root missing');
  assert.equal(root.children.length, 3, 'the three original PNG layers must remain three separately authorable ridges');
  assert.deepEqual(root.children.map(group => group.position.x), [-74, -244, -414], 'all ridges must retain the original westward shift and spacing');
  assert.deepEqual(root.children.map(group => group.position.z), [100, 300, 100], 'the second ridge must be staggered by one original map-edge length');
  assert(root.children.every(group => Math.abs(group.rotation.y) < 1e-9), 'mine-rock rows must stay upright instead of inheriting the old PNG plane rotation');
  const migratedOldConfig = api.normalizeAuthorConfig({ layers: [{ transform: { rotationDeg: [0, 90, 0] } }] });
  assert.deepEqual(migratedOldConfig.layers[0].transform.rotationDeg, [0, 0, 0], 'saved PNG-facing defaults must migrate to the upright rock-row orientation');
  assert(root.children.every(group => group.children.length === 8), 'each ridge must contain exactly eight rock assemblies');
  assert.equal(geometryCalls, 24, 'exactly 24 mine-rock geometries must be built');
  assert.equal(fitCalls, 24, 'every stone base must retain the normal mine-rock surface treatment');
  assert.equal(root.children.reduce((sum, group) => sum + group.children.length, 0), 24, 'the complete replacement must contain 24 rocks');
  assert(sourceGeometries.every(geometry => geometry.disposed), 'source mine-rock geometries must be disposed after the snow/stone split');
  assert(unusedGrassGeometries.every(geometry => !geometry.disposed), 'the unused grass half must retain its shared-attribute lifecycle');

  const expectedWidths = [768, 576, 896];
  const allParts = root.children.flatMap(group => group.children.flatMap(rock => rock.children));
  root.children.forEach((group, index) => {
    assert(Math.abs(group.userData.baseWorldWidth - expectedWidths[index]) < 1e-9, 'each rock row must preserve its former PNG reference width');
    assert(group.userData.visualOnly && group.userData.snowCapped, 'each ridge must be marked visual-only and snow-capped');
    assert(Math.abs(group.userData.worldNorthSouthLength - 400) < 1e-8, 'each completed ridge must span exactly twice the map north-south edge');
    assert(Math.abs(group.userData.ridgeLocalDepth * group.scale.z - 400) < 1e-8, 'parent-group scaling must fit the generated rock geometry to the target length');
    assert.equal(group.children.length, 8, 'ridge scaling must not increase the eight-rock count');
    assert(group.children.every(rock => rock instanceof Group && rock.children.length === 3), 'each rock assembly must contain stone, snow and a boundary line');
    const stoneMaterials = new Set(group.children.map(rock => rock.children[0].material));
    assert.equal(stoneMaterials.size, 1, 'each ridge must share one owned stone material');
    for (const rock of group.children) {
      const [stone, snow, boundary] = rock.children;
      assert.equal(rock.userData.snowCoverageHeightFraction, 2 / 3, 'snow must cover the upper two-thirds of the original rock bounds');
      assert(stone.geometry instanceof FakeGeometry && snow.geometry instanceof FakeGeometry, 'split stone/snow surfaces must use generated buffer geometry');
      assert(stone.userData.visualOnly && snow.userData.visualOnly, 'both surfaces must remain decorative-only');
      assert(stone.userData.mineRockUvsApplied, 'stone bases must retain the mine-rock texture treatment');
      assert.notEqual(snow.material, sharedSnowMaterial, 'distant snow caps must clone the canonical material instead of changing ground snow rendering');
      assert.equal(snow.material.map, sharedSnowMaterial.map, 'snow cap clones must reuse the exact shared snow texture');
      assert(boundary.isLineSegments && boundary.userData.westernSlopeSnowBoundary, 'each cap must have its own stone/snow outline');
      assert(typeof boundary.raycast === 'function' && boundary.raycast() === undefined, 'snow boundary lines must not intercept targeting');
      const stonePositions = stone.geometry.getAttribute('position'), snowPositions = snow.geometry.getAttribute('position');
      const cutY = rock.userData.snowLineLocalY;
      for (let v = 0; v < stonePositions.count; v++) assert(stonePositions.getY(v) <= cutY + 1e-6, 'stone geometry must stop at the snow boundary');
      for (let v = 0; v < snowPositions.count; v++) assert(snowPositions.getY(v) >= cutY - 1e-6, 'snow geometry must contain only the upper cap');
      const uv = snow.geometry.getAttribute('uv');
      assert(Math.min(...Array.from({ length: uv.count }, (_, v) => uv.getX(v))) < 1e-6, 'farm-cliff stretch U must begin at zero');
      assert(Math.max(...Array.from({ length: uv.count }, (_, v) => uv.getX(v))) > 0.999, 'farm-cliff stretch U must fill the cap width');
      assert(Math.min(...Array.from({ length: uv.count }, (_, v) => uv.getY(v))) < 1e-6, 'farm-cliff stretch V must begin at zero');
      assert(Math.max(...Array.from({ length: uv.count }, (_, v) => uv.getY(v))) > 0.999, 'farm-cliff stretch V must fill the cap height');
      const linePositions = boundary.geometry.getAttribute('position');
      assert(linePositions.count >= 4, 'the snow outline must include multiple boundary segments');
      assert(Array.from({ length: linePositions.count }, (_, v) => linePositions.getY(v)).every(y => Math.abs(y - cutY - 0.00015) < 1e-6), 'the outline must sit just above the geometric stone/snow seam');
      for (const part of rock.children) assert(typeof part.raycast === 'function' && part.raycast() === undefined, 'decorative rock parts must never receive pointer raycasts');
    }
  });

  const firstMaterial = root.children[0].children[0].children[0].material;
  const skySource = fs.readFileSync('docs/js/sky-dome.js', 'utf8'); // Compare the real sky depth policy with the replacement rock material.
  const skyContext = { window: {}, console };
  vm.runInNewContext(skySource.replace('  installClockHook(); installWeatherHook(); installRainHook();',
    '  window.testSkyDepth = { setSkyLayerDepth, CLOUD_DEPTH_NDC, CELESTIAL_DEPTH_NDC };'), skyContext);
  const skyDepth = skyContext.window.testSkyDepth;
  assert.equal(firstMaterial.fog, false, 'distant rock ridges must not inherit near-ground fog');
  assert.equal(firstMaterial.depthWrite, false, 'distant rocks must not write depth over foreground terrain');
  assert.equal(firstMaterial.depthTest, true, 'foreground terrain must continue to occlude distant rocks');
  const backgroundShader = { uniforms: {}, vertexShader: 'void main(){ gl_Position = vec4(1.0); }' };
  firstMaterial.onBeforeCompile(backgroundShader);
  const backgroundMax = backgroundShader.uniforms.uBackgroundMaxDepth.value;
  assert.match(backgroundShader.vertexShader, /min\(gl_Position\.z, gl_Position\.w \* uBackgroundMaxDepth\)/);
  assert.equal(backgroundMax, 1 - 5 * (2 / 65535), 'rock ridges must retain the prior sky-depth ordering');
  assert(allParts.every(part => part.frustumCulled === false), 'far-plane CPU culling must not discard depth-clamped rock parts');
  const snowShader = { uniforms: {}, vertexShader: 'void main(){ gl_Position = vec4(1.0); }' };
  root.children[0].children[0].children[1].material.onBeforeCompile(snowShader);
  assert.match(snowShader.vertexShader, /uBackgroundMaxDepth/, 'snow cap clones must share the far-background depth ordering');
  assert.equal(sharedSnowMaterial.onBeforeCompile, undefined, 'ground snow must retain its original terrain depth shader');
  for (const depth of [...skyDepth.CLOUD_DEPTH_NDC, skyDepth.CELESTIAL_DEPTH_NDC]) {
    const skyMaterial = { userData: {} }; // Isolates each real sky layer's shader state.
    const skyShader = { uniforms: {}, vertexShader: 'void main(){ gl_Position = vec4(1.0); }' };
    skyDepth.setSkyLayerDepth(skyMaterial, depth);
    skyMaterial.onBeforeCompile(skyShader);
    assert.match(skyShader.vertexShader, /gl_Position.z = gl_Position.w \* uSkyLayerDepth/);
    assert.equal(skyShader.uniforms.uSkyLayerDepth.value, depth);
    assert(backgroundMax < depth && depth < 1, 'sky masks must remain behind rocks but inside the far plane');
    for (const originalDepth of [0.9, 0.99999, 1.2]) {
      assert(Math.min(originalDepth, backgroundMax) < depth, 'near, distant, and beyond-far rocks must pass sky masks');
      assert(0.8 < Math.min(originalDepth, backgroundMax), 'foreground terrain must still occlude every rock ridge');
    }
  }
  assert(skyDepth.CLOUD_DEPTH_NDC.every((depth, index, depths) => index === 0 || depths[index - 1] < depth), 'cloud masks must retain their near-to-far order');
  assert(skyDepth.CLOUD_DEPTH_NDC.every(depth => depth < skyDepth.CELESTIAL_DEPTH_NDC), 'cloud masks must continue to occlude the sun and moon');
  for (const bits of [16, 24]) {
    const maxDepth = 2 ** bits - 1;
    const encodedDepths = [backgroundMax, ...skyDepth.CLOUD_DEPTH_NDC, skyDepth.CELESTIAL_DEPTH_NDC]
      .map(depth => (Math.fround(depth) * 0.5 + 0.5) * maxDepth);
    const depthSlots = encodedDepths.map(depth => Math.round(depth));
    if (bits === 16) assert(encodedDepths.every(depth => Math.abs(depth - Math.round(depth)) < 0.25),
      '16-bit depth values must stay away from rounding boundaries');
    assert(depthSlots.every((slot, index) => index === 0 || depthSlots[index - 1] < slot),
      'background, cloud masks, and celestial PNGs must occupy distinct ordered depth slots');
  }

  const authored = api.readAuthorConfig();
  authored.layers[0].transform.position = [-40, 180, 95];
  authored.layers[0].transform.rotationDeg = [4, 82, -2];
  authored.layers[0].transform.scale = [1.2, 0.85, 1];
  authored.layers[1].visible = false;
  api.saveAuthorConfig(authored);
  api.applyAuthorConfigToGroup(root, 200, 200, api.readAuthorConfig());
  assert.deepEqual([root.children[0].position.x, root.children[0].position.y, root.children[0].position.z], [-40, 180, 95], 'editor-authored position must reach the complete ridge');
  assert(Math.abs(root.children[0].rotation.y - (82 * Math.PI / 180)) < 1e-9, 'editor-authored Y rotation must reach the complete ridge');
  assert.equal(root.children[0].scale.x, 1.2, 'editor-authored X scale must reach the complete ridge');
  assert.equal(root.children[0].scale.y, 0.85, 'editor-authored Y scale must reach the complete ridge');
  assert(Math.abs(root.children[0].scale.z - root.children[0].userData.ridgeLengthScale) < 1e-9, 'automatic ridge-length normalization must compose with author Z scale');
  assert.equal(root.children[1].visible, false, 'per-layer visibility must remain authorable');

  window.BorderTerrain.buildZoneBorderTerrain(scene, 200, 200, 'map_western_slope');
  assert.equal(scene.children.filter(child => child.name === 'WesternSlopeMountainBackdrops').length, 1, 'repeated zone-border builds must not duplicate the rock ridges');

  const geometries = allParts.map(part => part.geometry);
  const ridgeMaterials = [...new Set(allParts.map(part => part.material).filter(material => material !== sharedSnowMaterial))];
  assert.equal(window.WildernessChunks.destroyZone('map_western_slope'), true, 'wrapped destroyZone must preserve its original return value');
  assert(!scene.getObjectByName('WesternSlopeMountainBackdrops'), 'destroyZone must detach the decorative scenery');
  assert(geometries.every(geometry => geometry.disposed), 'destroyZone must dispose all stone, snow and seam geometries');
  assert(ridgeMaterials.every(material => material.disposed), 'destroyZone must dispose every ridge-owned stone and outline material');
  assert.equal(sharedMineMaterial.disposed, false, 'destroyZone must not dispose the shared mine material');
  assert.equal(sharedSnowMaterial.disposed, false, 'destroyZone must not dispose the shared environment snow material');
  assert.equal(snowMaterialBindings.size, 0, 'destroyZone must unbind disposed cap clones from the asynchronous snow texture loader');
  assert.equal(geometries.length, 72, 'all three drawable geometries per rock must be accounted for during cleanup');

  const debug = window.__westernSlopeMountainBackdropsDebug();
  assert.equal(debug.active, false, 'debug snapshot must report disposed scenery as inactive');
  assert.equal(debug.completedBuilds, 1, 'debug snapshot must count the completed ridge stack');
  assert.equal(debug.disposedBuilds, 1, 'debug snapshot must count lifecycle cleanup');
  assert.equal(debug.lastLayout.length, 3, 'debug snapshot must expose all three authorable ridges');
  assert.equal(debug.rocksPerLayer, 8, 'debug snapshot must expose the eight-rock layer contract');
  assert.equal(debug.totalDecorativeRocks, 24, 'debug snapshot must expose the total decorative rock count');
  assert.equal(debug.snowCapsBuilt, 24, 'debug snapshot must report every completed snow cap');
  assert.equal(debug.snowBoundaryLinesBuilt, 24, 'debug snapshot must report every stone/snow outline');
  assert.equal(debug.snowCapHeightFraction, 2 / 3, 'debug snapshot must expose the snow coverage setting');
  assert.equal(debug.visualOnly, true, 'debug snapshot must make the non-interactive scenery status explicit');
  assert.deepEqual(debug.lastLayout[0].position, [-40, 180, 95], 'debug snapshot must expose the author-edited transform');
  assert.equal(debug.lastLayout[0].worldNorthSouthLength, 400, 'debug layout must report the complete doubled ridge length');

  console.log('Western Slope mine-rock ridge checks passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});