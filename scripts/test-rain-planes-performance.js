'use strict';

// Node-only regression harness for the shared rain / Western Slope blizzard
// plane renderer. No browser, WebGL context, or external dependencies needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/rain-planes.js', 'utf8'); // Renderer under test, loaded through its normal window API.
let geometryCreations = 0; // Confirms every active plane reuses a single immutable quad.
class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}
class Euler extends Vec3 {
  set(x, y, z) { super.set(x, y, z); return this; }
  setFromQuaternion() { return this.set(0, 0, 0); }
}
class Vec2 {
  constructor() { this.x = 0; this.y = 0; }
  set(x, y) { this.x = x; this.y = y; return this; }
}
class CanvasTexture {
  constructor(image) {
    this.image = image;
    this.offset = new Vec2();
    this.repeat = new Vec2();
  }
  clone() { return new CanvasTexture(this.image); }
}
class MeshBasicMaterial {
  constructor(options) {
    Object.assign(this, options);
    this.color = { set: value => { this.colorValue = value; } };
  }
}
class Group {
  constructor() { this.children = []; this.position = new Vec3(); this.userData = {}; }
  add(node) { this.children.push(node); node.parent = this; }
  remove(node) { this.children.splice(this.children.indexOf(node), 1); node.parent = null; }
  getObjectByName(name) { return this.children.find(child => child.name === name) || null; }
  traverse(fn) { fn(this); this.children.forEach(child => fn(child)); }
}
class Mesh {
  constructor(geometry, material) {
    this.geometry = geometry; this.material = material;
    this.position = new Vec3(); this.rotation = new Euler(); this.scale = new Vec3();
    this.userData = {};
  }
}
const THREE = {
  Vector3: Vec3, Euler, CanvasTexture, MeshBasicMaterial, Group, Mesh,
  PlaneGeometry: class { constructor() { geometryCreations++; } },
  RepeatWrapping: 1, LinearFilter: 2, NearestFilter: 3,
  DoubleSide: 4, MathUtils: { degToRad: angle => angle * Math.PI / 180 },
}; // Small Three.js interface exercised by this renderer.
const ctx = {
  clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, putImageData() {},
  createImageData: (width, height) => ({
    width, height, data: new Uint8ClampedArray(width * height * 4),
  }),
}; // Fake canvas context for one-time procedural texture generation.
const document = {
  readyState: 'complete',
  createElement: type => {
    assert.equal(type, 'canvas');
    return { width: 0, height: 0, getContext: () => ctx };
  },
}; // Lets the real source build textures without using a browser.
const window = {
  HobunjiSkyDome: {}, EnvironmentSurfaceRuntime: {},
}; // Stubs parser-loaded siblings; their behavior is not under test.
vm.runInNewContext(source, { window, document, Math, Uint8ClampedArray });
const rain = window.RainPlanes;
assert.ok(rain, 'renderer registers the public RainPlanes API');

const scene = new Group(); // Current Three.js scene used for checking attachment and group reuse.
const camera = {
  position: new Vec3(0, 8, 10),
  quaternion: {},
  fov: 60, aspect: 16 / 9,
  getWorldDirection: out => out.set(0, -0.45, -0.89),
}; // Camera angled toward the world, as in outdoor gameplay.
let outdoor = true; // Simulates entrance/exit transitions independently of weather.
let area = 'farm'; // Switched to Western Slope to check blizzard texture reuse.
const calendar = { isRaining: true, rainStrength: 2 }; // Drives rain visibility and intensity.
const deps = {
  THREE, camera, calendar, TILE: 10, player: { x: 20, y: 20 },
  getActiveScene: () => scene,
  getCurrentArea: () => area,
  isOutdoorArea: () => outdoor,
  getPlayerGroundY: () => 0,
}; // All inputs consumed by RainPlanes for its regular update path.
rain.init(deps);
rain.update(1 / 60);
const group = scene.getObjectByName('world_rain_planes');
assert.ok(group, 'precipitation group is attached to the active scene');
assert.equal(group.children.length, 17, 'default row mode creates five near and twelve far planes');
assert.equal(geometryCreations, 1, 'all precipitation planes share the same geometry');
assert.ok(group.children.every(mesh => mesh.frustumCulled), 'offscreen transparent sheets are frustum culled');
assert.ok(group.children.every(mesh => mesh.geometry === group.children[0].geometry));
assert.equal(group.children.filter(mesh => mesh.visible).length, 15, 'only the two fully faded far-edge rows stay hidden');
let state = rain.getDebugState();
assert.equal(state.layerPoolSize, 17);
assert.equal(state.rowAssignmentScratchSize, 17);
assert.equal(state.rowReassignments, 17);
const rainTexture = group.children[0].material.map; // Original rain map used to check weather-content swaps.
const initialUvY = rainTexture.offset.y; // UV movement must remain active on a reused mesh.
rain.update(1 / 60);
state = rain.getDebugState();
assert.equal(state.rowReassignments, 17, 'stationary rows keep their existing meshes');
assert.notEqual(rainTexture.offset.y, initialUvY, 'rain texture still scrolls each frame');

deps.player.y += 40;
rain.update(1 / 60);
state = rain.getDebugState();
assert.ok(state.rowReassignments > 17, 'walking through row boundaries assigns replacement bands');
assert.ok(state.rowReassignments < 34, 'most mesh identities survive a modest row crossing');
assert.equal(geometryCreations, 1, 'movement does not allocate new quads');
const walkedReassignments = state.rowReassignments; // Row identities must change when the arena adjusts band spacing.
rain.setSettings({ rowSpacingTiles: 3 });
rain.update(1 / 60);
assert.ok(rain.getDebugState().rowReassignments > walkedReassignments,
  'adjusting spacing must not incorrectly reuse an old row fade');
rain.setSettings({ rowSpacingTiles: 2.5 });
rain.update(1 / 60);

outdoor = false;
rain.update(1 / 60);
assert.equal(rain.getDebugState().layerCount, 0, 'entering an interior hides existing precipitation');
rain.update(1 / 60);
assert.equal(rain.getDebugState().layerCount, 0, 'dry/interior frames keep the pool hidden');
outdoor = true;
area = 'map_western_slope';
rain.update(1 / 60);
assert.equal(rain.getDebugState().activeContent, 'blizzard');
assert.ok(group.children.some(mesh => mesh.material.map !== rainTexture), 'Western Slope switches to snow artwork');
assert.equal(group.children.length, 17, 'snow reuses the precipitation pool');

rain.setSettings({ mode: 'camera' });
rain.update(1 / 60);
assert.equal(rain.getDebugState().layerCount, 3, 'camera-sheet test mode only shows three planes');
rain.setSettings({ mode: 'rows', frontCount: 0, behindCount: 0 });
rain.update(1 / 60);
assert.equal(rain.getDebugState().layerCount, 0, 'zero row counts do not leave stale pool meshes visible');
rain.setSettings({ frontCount: 5, behindCount: 12 });
area = 'farm';
rain.update(1 / 60);
assert.equal(rain.getDebugState().activeContent, 'rain', 'returning from Western Slope restores rain');
assert.equal(geometryCreations, 1, 'mode switches never allocate duplicate plane geometry');

rain.init(deps);
rain.update(1 / 60);
assert.equal(scene.children.filter(node => node.name === 'world_rain_planes').length, 1,
  'repeated init must not duplicate the weather scene root');
assert.equal(rain.getDebugState().repeatedInitCount, 1);
console.log('Rain and blizzard plane performance regression checks passed.');
