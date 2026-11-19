'use strict';

// Node-only regression harness for the shared rain / Western Slope blizzard
// plane renderer. No browser, WebGL context, or external dependencies needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/rain-planes.js', 'utf8'); // Renderer under test, loaded through its normal window API.
let temporarySetCreations = 0; // Tracks the transient Set allocations the old row allocator made every frame.
class CountingSet extends Set {
  constructor(values) { super(values); temporarySetCreations++; }
}
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
class Matrix3 {
  setUvTransform(x, y, sx, sy, rotation, cx, cy) {
    assert.deepEqual([rotation, cx, cy], [0, 0, 0]);
    this.elements = [sx, 0, 0, 0, sy, 0, x, y, 1];
  }
}
class CanvasTexture {
  constructor(image) { this.image = image; }
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
  Vector3: Vec3, Euler, Matrix3, CanvasTexture, MeshBasicMaterial, Group, Mesh,
  ShaderChunk: {
    uv_pars_vertex: 'uniform mat3 uvTransform;',
    uv_vertex: 'vUv = ( uvTransform * vec3( uv, 1 ) ).xy;',
  },
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
vm.runInNewContext(source, { window, document, Math, Uint8ClampedArray, Set: CountingSet });
const rain = window.RainPlanes;
assert.ok(rain, 'renderer registers the public RainPlanes API');

const scene = new Group(); // Original Three.js scene used for checking attachment and group reuse.
let activeScene = scene; // Tracks scene switches so old weather roots can be checked for leaks.
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
  getActiveScene: () => activeScene,
  getCurrentArea: () => area,
  isOutdoorArea: () => outdoor,
  getPlayerGroundY: () => 0,
}; // All inputs consumed by RainPlanes for its regular update path.
rain.init(deps);
rain.update(1 / 60);
function compileLayer(mesh) {
  const shader = { uniforms: {}, vertexShader: '#include <uv_pars_vertex>\nvoid main() {\n#include <uv_vertex>\n}' }; // Exercises the same UV chunks Three injects before linking a MeshBasicMaterial.
  mesh.material.onBeforeCompile(shader);
  assert.match(shader.vertexShader, /uniform mat3 hobunjiPrecipitationUvTransform;/);
  assert.match(shader.vertexShader, /vUv = \( hobunjiPrecipitationUvTransform \* vec3/);
  return shader.uniforms.hobunjiPrecipitationUvTransform.value.elements;
}
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
assert.equal(state.precipitationTextureCount, 1, 'rain does not generate snow canvases');
assert.ok(group.children.every(mesh => mesh.material.map === rainTexture), 'rain sheets share one GPU texture');
assert.ok(group.children.every(mesh => !Object.hasOwn(mesh, 'onBeforeRender')),
  'precipitation must remain eligible for the held-object depth replay skip');
const leadingUv = compileLayer(group.children[0]); // Holds a live reference to Three's uniform matrix during weather updates.
const nextUv = compileLayer(group.children[1]); // Another material using the same rain map and shader program.
const initialUvY = leadingUv[7]; // UV movement must remain active on a reused mesh.
assert.notEqual(nextUv[7], initialUvY, 'shared artwork keeps independent sheet phases');
assert.equal(nextUv[0], 9, 'each sheet applies its own texture repetition');
rain.update(1 / 60);
state = rain.getDebugState();
assert.equal(state.rowReassignments, 17, 'stationary rows keep their existing meshes');
assert.notEqual(leadingUv[7], initialUvY, 'rain texture still scrolls each frame');
for (let frame = 0; frame < 120; frame++) rain.update(1 / 60); // Exercise two seconds of steady rain without creating new row descriptors.
assert.equal(temporarySetCreations, 0, 'steady rain must not allocate transient Sets for row matching');
assert.equal(rain.getDebugState().rowAssignmentScratchSize, 17, 'row assignment storage stays bounded after 120 frames');
assert.equal(rain.getDebugState().rowReassignments, 17, 'stationary rain must not cause row-pool churn');
assert.equal(rain.getDebugState().rowAssignmentPasses, 1, 'stationary rain must not repeatedly search the pool');

deps.player.y += 1; // Move off the exact starting boundary and into a row interval.
rain.update(1 / 60);
const withinRowPasses = rain.getDebugState().rowAssignmentPasses; // Compare after moving within the same interval.
const withinRowPosition = group.children[1].position.y; // The live placement must still follow the camera.
const withinRowOpacity = group.children[1].material.opacity; // Fade still advances on animation updates.
deps.player.y += 1;
camera.position.y += 1;
rain.update(1 / 60);
assert.equal(rain.getDebugState().rowAssignmentPasses, withinRowPasses, 'walking within one interval reuses assignments');
assert.notEqual(group.children[1].position.y, withinRowPosition, 'sheet geometry still tracks the camera');
assert.notEqual(group.children[1].material.opacity, withinRowOpacity, 'sheet opacity still updates');
deps.player.y -= 2;
rain.update(1 / 60);

// The old renderer identifies a row by side + world coordinate, NOT by the
// index within a spacing preset. +5 units is the same row in both presets.
const sharedRowMesh = group.children[1]; // Existing +5 front row should retain its fade when spacing doubles.
const sharedRowOpacity = sharedRowMesh.material.opacity; // Compares the previous row fade against its reused continuation.
rain.setSettings({ rowSpacingTiles: 5 });
rain.update(1 / 60);
assert.ok(sharedRowMesh.material.opacity >= sharedRowOpacity,
  'row coordinates shared by two spacing presets must retain the existing fade');
rain.setSettings({ rowSpacingTiles: 2.5 });
rain.update(1 / 60);

const beforeWalkReassignments = rain.getDebugState().rowReassignments; // Delta baseline excludes the deliberate spacing-preset transitions above.
deps.player.y += 40;
rain.update(1 / 60);
state = rain.getDebugState();
assert.ok(state.rowReassignments > beforeWalkReassignments, 'walking through row boundaries assigns replacement bands');
assert.ok(state.rowReassignments < beforeWalkReassignments + 17, 'most mesh identities survive a modest row crossing');
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
calendar.isRaining = false;
rain.update(1 / 60);
assert.equal(rain.getDebugState().layerCount, 0, 'clear weather outdoors must also stay invisible');
const pausedRainOffset = leadingUv[7]; // Rain phase should resume when switching back from snow.
calendar.isRaining = true;
area = 'map_western_slope';
rain.update(1 / 60);
assert.equal(rain.getDebugState().activeContent, 'blizzard');
assert.notEqual(group.children[0].material.map, rainTexture, 'Western Slope really swaps the same material to snow artwork');
assert.equal(group.children.length, 17, 'snow reuses the precipitation pool');
assert.equal(rain.getDebugState().precipitationTextureCount, 4, 'one rain texture and three snow families are cached');
assert.equal(group.children[0].material.map, group.children[3].material.map, 'sheets share snow artwork within each depth family');
assert.notEqual(group.children[0].material.map, group.children[1].material.map, 'snow depth families retain distinct artwork');
assert.ok(group.children.every(mesh => mesh.material.map.image.width === 640),
  'all active snow planes must use blizzard artwork, not the rain texture');
rain.setSettings({ frontCount: 12, behindCount: 12 });
rain.update(1 / 60);
assert.equal(group.children.length, 24, 'expanding bands must allocate only the additional pool members');
assert.ok(group.children.every(mesh => mesh.material.map.image.width === 640),
  'new bands created during a blizzard must inherit snow artwork');
rain.setSettings({ frontCount: 5, behindCount: 12 });
rain.update(1 / 60);

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
assert.equal(group.children[0].material.map, rainTexture, 'returning to the farm restores the original rain texture');
assert.ok(Math.abs(leadingUv[7] - (pausedRainOffset + 1.08 * 3 / 60) % 1) < 1e-10,
  'each weather type resumes the sheet phase it had before switching');
assert.equal(geometryCreations, 1, 'mode switches never allocate duplicate plane geometry');

const nextScene = new Group(); // Another outdoor map scene, to verify precipitation is transferred rather than duplicated.
activeScene = nextScene;
rain.update(1 / 60);
assert.equal(scene.children.includes(group), false, 'scene transitions detach the previous precipitation group');
assert.equal(nextScene.children.filter(node => node.name === 'world_rain_planes').length, 1,
  'the new scene receives exactly one reused precipitation group');
activeScene = scene;
rain.update(1 / 60);

rain.init(deps);
rain.update(1 / 60);
assert.equal(scene.children.filter(node => node.name === 'world_rain_planes').length, 1,
  'repeated init must not duplicate the weather scene root');
assert.equal(rain.getDebugState().repeatedInitCount, 1);
console.log('Rain and blizzard plane performance regression checks passed.');
