#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Used for focused crop-art regression assertions.
const fs = require('node:fs'); // Used to load the runtime module and current integration source directly from the repository checkout.
const path = require('node:path'); // Used to resolve repository-relative source paths from this test file.
const vm = require('node:vm'); // Used to exercise the future CookingSystem hook without requiring a browser or Three.js renderer.

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const cropArtSource = source('docs/js/crop-sprite-art.js'); // Used to validate both static world-routing policy and executable item-art integration.
const loaderSource = source('docs/js/combat/combat-config-loader.js'); // Used to ensure crop art initializes before inventory metadata synchronization.
const cropRenderingSource = source('docs/js/vegetation-crop-rendering.js'); // Used to pin the existing foliage/placeholder crop ownership that must remain untouched.
const gameSource = source('docs/game.js'); // Used to verify source-colored crop PNGs bypass the shared recolor pipeline in both inventory and held-item rendering.

const foliageFamiliesMatch = cropRenderingSource.match(/const FOLIAGE_CROPS = new Set\(\[([^\]]+)\]\);/); // Reads the actual foliage family list rather than freezing it to two crop IDs.
assert.ok(foliageFamiliesMatch, 'crop foliage renderer exposes its foliage-crop family set');
const foliageFamilies = [...foliageFamiliesMatch[1].matchAll(/'([^']+)'/g)].map(match => match[1]); // Parsed family IDs let this test permit future foliage crops.
for (const family of ['needlegrain', 'heftroot', 'blackMustard', 'greenMustard', 'redberries', 'blueberries', 'yellowberries', 'whiteberries', 'blackberries']) {
  assert.ok(foliageFamilies.includes(family), `${family} remains owned by the foliage renderer lifecycle`);
}
for (const billboardCrop of ['garlink', 'ongyums']) {
  assert.ok(!foliageFamilies.includes(billboardCrop), `${billboardCrop} remains in the separate authored PNG cluster pipeline`);
}
assert.match(cropRenderingSource, /assets\/leaves\/small_leaf\.png/, 'outer mushtard leaves reuse existing lobed source PNG');
assert.match(cropRenderingSource, /assets\/leaves\/speartip_leaf\.png/, 'inner mushtard leaves reuse existing pointed source PNG');
assert.match(cropRenderingSource, /new THREE\.InstancedMesh\(/, 'mushtard leaf cards are batched for mobile rendering');
assert.match(cropRenderingSource, /group\.userData\.hobunjiMustardLeafCount/, 'mushtard rosettes expose debug leaf counts');
assert.match(cropRenderingSource, /buildShrubMesh\?\.\(col, row\)/, 'berry bushes reuse the cached existing shrub foliage builder');
assert.match(cropRenderingSource, /new THREE\.SphereGeometry\(/, 'fruit clusters use actual 3D spheres, not billboard decorations');
for (const family of ['redberries', 'blueberries', 'yellowberries', 'whiteberries', 'blackberries']) {
  assert.match(cropArtSource, new RegExp(family + ": Object\\.freeze\\(\\{ spriteIcon: 'berries\\.png', worldMode: 'procedural'"), family + ' must bypass the sprite-cube conversion route');
}
assert.match(cropRenderingSource, /Temporary cube anchors for garlink\/ongyums PNG clusters/,
  'only garlink and ongyums still pass through PNG cube anchors; every berry species grows a real bush');
assert.match(cropArtSource, /garlink:\s*Object\.freeze\(\{ spriteIcon: 'garlink_bunch\.png', worldMode: 'billboard', ingredientColor: 0xD1D1CB \}\)/,
  'garlink uses its PNG for held/icon art and world billboard clusters');
assert.match(cropArtSource, /ongyums:\s*Object\.freeze\(\{ spriteIcon: 'ongyum\.png', worldMode: 'billboard', ingredientColor: 0x627F20 \}\)/,
  'ongyums uses the authored PNG for held/icon art and world billboard clusters');
assert.match(cropArtSource, /CLUSTER_OFFSETS = Object\.freeze\([\s\S]*?-0\.20[\s\S]*?0\.22[\s\S]*?-0\.22/,
  'garlink/ongyums reuse the legacy three-heftroot triangle footprint');
assert.match(cropArtSource, /CLUSTER_PLANT_SCALE = 0\.25/,
  'each garlink/ongyums cluster member is half the size of the former 0.5-scale single billboard');
assert.match(cropArtSource, /hobunjiCropClusterCount = CLUSTER_OFFSETS\.length/,
  'converted crop anchors expose the three-member cluster count');
assert.match(cropArtSource, /for \(let index = 0; index < CLUSTER_OFFSETS\.length; index\+\+\)[\s\S]*?mesh\.add\(makeClusterPlant/,
  'each converted garlink/ongyums tile receives all three visible plant planes');
assert.match(cropArtSource, /new window\.THREE\.BufferGeometry\(\)/,
  'the former generic cube becomes a non-rendering transform anchor rather than a fourth visible plant');
assert.match(cropArtSource, /plant\.quaternion\.copy\(camera\.quaternion\)/,
  'every cluster member faces the active camera at the render boundary');
assert.match(cropArtSource, /hobunjiCropRootKey = cropKey/,
  'generic crop roots are tagged for the shared flood/soil presentation correction');
assert.match(cropArtSource, /buildNeedlegrainMesh = function taggedNeedlegrainMesh/,
  'procedural needlegrain receives only a root tag so flood anchoring can include it without replacing its geometry');

assert.match(gameSource, /const hasSpriteColor = def\.spriteColor != null && Number\.isFinite\(Number\(def\.spriteColor\)\);[\s\S]*?if \(!hasSpriteColor\) \{ el\.dataset\.itemSpriteState = 'source'; return; \}/,
  'inventory icons keep authored source PNG colors when spriteColor is absent instead of defaulting to white');
assert.match(gameSource, /const hasSpriteColor = def\.spriteColor != null && Number\.isFinite\(Number\(def\.spriteColor\)\);[^\n]*held PNG[\s\S]*?if \(def\.spriteIcon && hasSpriteColor && window\.SpriteRecolor\)/,
  'held authored item sprites also bypass recoloring unless their definition explicitly supplies spriteColor');
assert.doesNotMatch(gameSource, /def\.spriteColor \?\? 0xFFFFFF/,
  'missing spriteColor is never converted into an implicit white tint');

const cropModuleIndex = loaderSource.search(/crop-sprite-art\.js\?v=[A-Za-z0-9_.-]+/); // Used to confirm crop item metadata is installed before generic inventory metadata synchronization.
const inventoryMetadataIndex = loaderSource.indexOf('inventory-action-metadata-bridge.js'); // Used as the ordering boundary for selectable item metadata synchronization.
assert.ok(cropModuleIndex >= 0 && inventoryMetadataIndex > cropModuleIndex,
  'crop sprite art loads before inventory action metadata synchronization');

let fakeNowMs = 1000; // Used to advance the crop discovery clock without waiting in the regression test.
function FakeWebGlRenderer() {} // Used to exercise the module's real render-hook throttle without loading Three.js.
FakeWebGlRenderer.prototype.render = function render() { return 'rendered'; };
const sandboxWindow = {
  THREE: { WebGLRenderer: FakeWebGlRenderer },
}; // Used as a browser-global stand-in for testing render throttling plus late CookingSystem assignment/init wrapping.
vm.runInNewContext(cropArtSource, { window: sandboxWindow, performance: { now: () => fakeNowMs } });
const artApi = sandboxWindow.HobunjiCropSpriteArt; // Used to inspect the public crop-art mapping and invoke item metadata synchronization.
assert.ok(artApi, 'crop sprite art exposes its runtime API');
assert.deepEqual({ ...artApi.getArt('needlegrain') }, { spriteIcon: 'pile_needlegrain.png', worldMode: 'procedural', ingredientColor: 0x293827 });
assert.deepEqual({ ...artApi.getArt('heftroot') }, { spriteIcon: 'heftroot.png', worldMode: 'procedural', ingredientColor: 0xAAA07C });
assert.deepEqual({ ...artApi.getArt('garlink') }, { spriteIcon: 'garlink_bunch.png', worldMode: 'billboard', ingredientColor: 0xD1D1CB });
assert.deepEqual({ ...artApi.getArt('ongyums') }, { spriteIcon: 'ongyum.png', worldMode: 'billboard', ingredientColor: 0x627F20 });

let firstSceneTraversals = 0; // Counts full-scene crop discovery passes in a crop-free wilderness-style scene.
const firstScene = { traverse() { firstSceneTraversals++; } };
const camera = { quaternion: {} };
const renderer = new sandboxWindow.THREE.WebGLRenderer();
assert.equal(renderer.render(firstScene, camera), 'rendered', 'crop hook preserves the underlying renderer return value');
renderer.render(firstScene, camera);
assert.equal(firstSceneTraversals, 1, 'a crop-free scene is scanned once, not again on every render merely because activeBillboards is empty');
fakeNowMs += 249;
renderer.render(firstScene, camera);
assert.equal(firstSceneTraversals, 1, 'crop discovery remains throttled until the configured deadline');
fakeNowMs += 1;
renderer.render(firstScene, camera);
assert.equal(firstSceneTraversals, 2, 'crop discovery resumes after the 250 ms deadline so newly planted crops still appear promptly');
let secondSceneTraversals = 0; // Confirms each independently rendered scene owns its own deadline.
renderer.render({ traverse() { secondSceneTraversals++; } }, camera);
assert.equal(secondSceneTraversals, 1, 'a second scene receives its own immediate discovery scan');


class FakeColor { // Three.js-style color getter/setter used to check that the renderer preserves mixed pigment every frame.
  constructor(hex) { this.hex = hex; }
  getHex() { return this.hex; }
  setHex(hex) { this.hex = hex; return this; }
}
class FakeMaterial { // Minimal Lambert/Basic material interface used by the authored billboard bridge.
  constructor(opts = {}) { this.color = new FakeColor(opts.color ?? 0xffffff); this.isMeshLambertMaterial = false; }
  dispose() {}
}
class FakeLambertMaterial extends FakeMaterial { constructor(opts) { super(opts); this.isMeshLambertMaterial = true; } }
class FakeMesh { // World crop cube and subsequently converted PNG planes share this minimal object API.
  constructor(geometry, material) {
    this.geometry = geometry; this.material = material; this.userData = {}; this.children = [];
    this.isMesh = true; this.parent = null; this.position = { x: .5, y: 0, z: .5, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
    this.scale = { x: .7, y: .7, z: .7, setScalar(v) { this.x = v; this.y = v; this.z = v; } };
    this.quaternion = { identity() {}, copy() {} };
  }
  add(child) { child.parent = this; this.children.push(child); child.dispatchEvent?.({type:'added'}); }
  addEventListener(type, fn) { // Three.js deduplicates identical listeners.
    this.listeners ??= new Map();
    if (!this.listeners.has(type)) this.listeners.set(type,new Set());
    this.listeners.get(type).add(fn);
  }
  dispatchEvent(event) { for (const fn of this.listeners?.get(event.type) || []) fn.call(this,event); }
}
sandboxWindow.THREE = {
  WebGLRenderer: FakeWebGlRenderer, Mesh: FakeMesh, MeshLambertMaterial: FakeLambertMaterial, MeshBasicMaterial: FakeMaterial,
  BufferGeometry: class {}, PlaneGeometry: class { constructor(width, height) { this.width = width; this.height = height; } },
  TextureLoader: class { load(path, ready) { const texture = { image: { width: 24, height: 32 } }; ready(texture); return texture; } },
  DoubleSide: 2,
};
const coloredCube = new FakeMesh(
  { type: 'BoxGeometry', parameters: { width: 1, height: 1, depth: 1 }, dispose() {} },
  new FakeLambertMaterial({ color: 0xb6a0c9 }),
); // Imported garlink cube has an arbitrary hybrid color absent from the legacy fixed-color palette.
coloredCube.parent = {};
coloredCube.userData.hobunjiCropBaseKey = 'garlink'; // New farm renderer supplies species identity directly.
coloredCube.userData.hobunjiCropVarietyColor = 0xb6a0c9; // Exact inherited RGB must be visible on the authored PNG cluster.
fakeNowMs += 250;
const cultivarScene = { traverse(callback) { callback(coloredCube); } };
renderer.render(cultivarScene, camera);
assert.equal(coloredCube.children.length, 3, 'hybrid garlink still becomes the three-plant authored PNG cluster');
assert.equal(coloredCube.userData.hobunjiCropSpriteKey, 'garlink', 'hybrid retains species art after conversion');
for (const plant of coloredCube.children) assert.equal(plant.material.color.getHex(), 0xb6a0c9, 'authored hybrid PNG is tinted to its inherited mixed color');
renderer.render(cultivarScene, camera);
for (const plant of coloredCube.children) assert.equal(plant.material.color.getHex(), 0xb6a0c9, 'render updates never reset a hybrid plant to native color');

const fakeDefs = {
  needlegrain: { icon: '🌾' },
  heftroot: { icon: '🟡' },
  garlink: { icon: '🧄' },
  ongyums: { icon: '🧅' },
};
const fakeEntries = Object.keys(fakeDefs).map(key => ({ key, icon: fakeDefs[key].icon }));
const fakeCookingSystem = { init(deps) { return deps; } };
sandboxWindow.CookingSystem = fakeCookingSystem;
sandboxWindow.CookingSystem.init({ ITEM_DEFS: fakeDefs, inventoryItems: fakeEntries });

for (const cropKey of Object.keys(fakeDefs)) {
  const art = artApi.getArt(cropKey);
  assert.equal(fakeDefs[cropKey].spriteIcon, art.spriteIcon, `${cropKey} canonical definition receives authored spriteIcon`);
  assert.equal(fakeDefs[cropKey].spriteMode, 'direct', `${cropKey} canonical definition uses direct PNG color`);
  assert.equal(fakeDefs[cropKey].ingredientColor, art.ingredientColor, `${cropKey} canonical definition receives the sampled ingredient color`);
  assert.equal(Object.hasOwn(fakeDefs[cropKey], 'spriteColor'), false, `${cropKey} canonical definition intentionally has no tint`);
  const entry = fakeEntries.find(item => item.key === cropKey);
  assert.equal(entry.spriteIcon, art.spriteIcon, `${cropKey} selectable entry receives authored spriteIcon`);
  assert.equal(entry.spriteMode, 'direct', `${cropKey} selectable entry uses direct PNG color`);
  assert.equal(entry.ingredientColor, art.ingredientColor, `${cropKey} selectable entry mirrors the sampled ingredient color`);
  assert.equal(Object.hasOwn(entry, 'spriteColor'), false, `${cropKey} selectable entry intentionally has no tint`);
}

assert.equal(artApi.getDebug().patchedDefs, 4, 'all four canonical crop definitions were patched');
assert.equal(artApi.getDebug().patchedEntries, 4, 'all four selectable crop entries were patched');
assert.equal(artApi.getDebug().clusterCount, 3, 'world crop cluster diagnostics report three members');
assert.equal(artApi.getDebug().clusterPlantScale, 0.25, 'world crop cluster diagnostics report the requested reduced scale');
assert.equal(artApi.getDebug().discoveryScanIntervalMs, 250, 'crop diagnostics report the time-based discovery interval');
assert.equal(artApi.getDebug().discoveryScanCount, 4, 'crop diagnostics include the extra hybrid-cultivar scene scan');
assert.match(artApi.getDebug().lastChange, /time-throttled per scene/, 'crop diagnostics summarize the latest performance correction');
// Modern game sources register newly planted anchors without rescanning
// the scene; mixed-version/standalone pages retain the original fallback.
sandboxWindow.VegetationCropRendering = { registersCropSpritePlaceholders: true };
sandboxWindow.NpcFarmPlots = { registersCropSpritePlaceholders: true };
let modernTraversals = 0;
const modernScene = { traverse() { modernTraversals++; } };
renderer.render(modernScene, camera);
fakeNowMs += 1000;
renderer.render(modernScene, camera);
assert.equal(modernTraversals, 1, 'modern scenes have one adoption scan, not periodic scans');
assert.equal(artApi.getDebug().periodicDiscovery, false);
function newCrop() {
  const mesh = new FakeMesh({ type:'BoxGeometry', parameters:{width:1,height:1,depth:1}, dispose() {} },
    new FakeLambertMaterial({color:0xb6a0c9}));
  mesh.parent = modernScene;
  mesh.userData.hobunjiCropBaseKey = 'garlink';
  mesh.userData.hobunjiCropVarietyColor = 0xb6a0c9;
  return mesh;
}
const planted = newCrop();
const harvested = newCrop();
assert.equal(artApi.registerPlaceholder(planted), true);
artApi.registerPlaceholder(planted); // The producer and its attach hook may both notify.
artApi.registerPlaceholder(harvested);
harvested.parent = null;
renderer.render(modernScene, camera);
assert.equal(planted.children.length, 3, 'new modern plant converts without a discovery scan');
assert.equal(harvested.children.length, 0, 'harvest before render cancels pending conversion');
assert.equal(modernTraversals, 1);
assert.equal(artApi.getDebug().registeredCropCount, 2, 'duplicate notifications are coalesced');
assert.equal(artApi.getDebug().pendingRegisteredCrops, 0);
sandboxWindow.NpcFarmPlots.registersCropSpritePlaceholders = false;
renderer.render(modernScene, camera);
assert.equal(modernTraversals, 2, 'mixed-version sources automatically restore legacy discovery');
sandboxWindow.NpcFarmPlots.registersCropSpritePlaceholders = true;
artApi.setLegacyDiscoveryEnabled(true);
fakeNowMs += 250;
renderer.render(modernScene, camera);
assert.equal(modernTraversals, 3, 'debug override restores periodic compatibility scans');
artApi.setLegacyDiscoveryEnabled(false);

// Standalone producers register before their caller attaches the mesh.
// Moving an existing billboard out and back must resume camera-facing
// updates even in a scene that has finished its one adoption scan.
const standalone = newCrop();
standalone.parent = null;
const countBefore = artApi.getDebug().registeredCropCount;
assert.equal(artApi.registerPlaceholder(standalone),true);
assert.equal(artApi.getDebug().registeredCropCount,countBefore,'detached registration waits for attachment');
standalone.parent = modernScene;
standalone.dispatchEvent({type:'added'});
renderer.render(modernScene,camera);
assert.equal(standalone.children.length,3,'standalone crop converts after its first attachment');
const activeBefore = artApi.getDebug().activeBillboards;
standalone.parent = null;
standalone.dispatchEvent({type:'removed'});
assert.equal(artApi.getDebug().activeBillboards,activeBefore-1,'detached crop leaves the live update list immediately');
standalone.parent = modernScene;
standalone.dispatchEvent({type:'added'});
assert.equal(artApi.getDebug().activeBillboards,activeBefore,'reattached crop rejoins the live update list');
let facingUpdates = 0;
standalone.children[0].quaternion.copy = () => facingUpdates++;
renderer.render(modernScene,camera);
assert.equal(facingUpdates,1,'reattached crop faces the active camera again');
assert.equal(standalone.children.length,3,'reattachment never duplicates plant planes');
const invalid = newCrop();
invalid.geometry.type = 'SphereGeometry';
artApi.registerPlaceholder(invalid);
renderer.render(modernScene,camera);
assert.equal(invalid.children.length,0,'a tag alone cannot convert non-placeholder geometry');
assert.equal(modernTraversals,3,'these lifecycle operations never require another discovery walk');
console.log('authored crop sprite art tests passed');
