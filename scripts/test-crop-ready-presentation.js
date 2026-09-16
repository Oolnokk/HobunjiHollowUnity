#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Used to pin sparkle-only ripe presentation behavior without browser gameplay state.
const fs = require('node:fs'); // Used to load the runtime module and loader directly from the checkout.
const path = require('node:path'); // Used to resolve repository-relative files from this test.
const vm = require('node:vm'); // Used to execute the presentation wrapper against a minimal Three.js stand-in.

const source = fs.readFileSync(path.join(__dirname, '..', 'docs/js/crop-ready-presentation.js'), 'utf8'); // Used to exercise the real readiness/sparkle wrapper.
const loader = fs.readFileSync(path.join(__dirname, '..', 'docs/js/combat/combat-config-loader.js'), 'utf8'); // Used to pin loader ordering around the ready presentation layer.
let now = 1000; // Used as the deterministic legacy crop-updater timestamp for bob/spin reconstruction.

assert.match(source, /readinessSource: 'tile\.cropReady'/,
  'ripe presentation reports authoritative tile.cropReady as its readiness source');
assert.match(source, /ripePlantMotion: 'none'/,
  'ripe presentation diagnostics explicitly report stationary plants');
assert.match(source, /FOLIAGE_READY_BOB = 0\.025/,
  'foliage crops cancel the exact legacy ripe bob amplitude');
assert.match(source, /GENERIC_READY_BOB = 0\.03/,
  'generic and converted PNG crops cancel the exact legacy ripe bob amplitude');
assert.match(source, /refreshReadyRoots\(record\)/,
  'cached crop roots re-check tile.cropReady every render turn instead of waiting for another scene scan');
assert.doesNotMatch(source, /MAX_READY_ROTATION_STEP|lastMotionAt|normalizedRotationStep/,
  'readiness is no longer inferred from legacy movement');

class BufferGeometry {
  constructor() { this.attributes = {}; this.drawRange = { start: 0, count: 0 }; }
  setAttribute(name, value) { this.attributes[name] = value; }
  computeBoundingSphere() {}
  setDrawRange(start, count) { this.drawRange = { start, count }; }
}
class BufferAttribute {
  constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.needsUpdate = false; }
  setUsage() {}
}
class PointsMaterial { constructor(options) { Object.assign(this, options); } }
class Points {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.userData = {};
    this.visible = true;
    this.parent = null;
  }
}
class WebGLRenderer {}

const draws = []; // Used to inspect plant transforms and sparkle visibility at the exact draw boundary.
WebGLRenderer.prototype.render = function render(scene) {
  const ongyums = scene.children.find(child => child.userData?.testOngyums); // Used to verify generic/PNG crop motion cancellation.
  const heftroot = scene.children.find(child => child.userData?.testHeftroot); // Used to verify foliage crop motion cancellation.
  const actor = scene.children.find(child => child.userData?.testActor); // Used to ensure unrelated half-tile actors remain untouched.
  const sparkles = scene.children.find(child => child.userData?.hobunjiReadyCropSparkles); // Used to verify the existing sparkle cue remains active.
  draws.push({
    ongyumsY: ongyums?.position.y,
    ongyumsRot: ongyums?.rotation.y,
    heftrootY: heftroot?.position.y,
    heftrootRot: heftroot?.rotation.y,
    actorY: actor?.position.y,
    actorRot: actor?.rotation.y,
    sparkleVisible: sparkles?.visible,
    sparkleCoords: (sparkles?.geometry?.drawRange?.count ?? 0) * 3,
  });
  return true;
};

const THREE = {
  BufferGeometry,
  BufferAttribute,
  PointsMaterial,
  Points,
  WebGLRenderer,
  DynamicDrawUsage: 35048,
}; // Minimal Three.js surface needed by the real crop-ready presentation module.

function makeRoot(props = {}) {
  return {
    isMesh: props.isMesh ?? false,
    parent: null,
    children: props.children || [],
    userData: props.userData || {},
    geometry: props.geometry || null,
    material: props.material || null,
    scale: props.scale || { x: 0.96, y: 0.96, z: 0.96 },
    position: props.position || { x: 0.5, y: 0, z: 0.5 },
    rotation: props.rotation || { y: 0 },
    traverse(callback) {
      callback(this);
      for (const child of this.children) child.traverse ? child.traverse(callback) : callback(child);
    },
  }; // Three-like crop root used by plausibleCropRoot and authored-sprite traversal.
}

const scene = {
  children: [],
  add(object) {
    if (!this.children.includes(object)) this.children.push(object);
    object.parent = this;
  },
}; // Farm scene stand-in used by the module's scene-scoped crop-root discovery.

const grid = Array.from({ length: 8 }, () => Array.from({ length: 6 }, () => ({ crop: null, cropReady: false }))); // Authoritative farm-grid stand-in read through FarmPanel deps.
const ongyumsTile = grid[7][4]; // Used as a ready generic/PNG crop tile at world position 4.5, 7.5.
Object.assign(ongyumsTile, { crop: 'ongyums', cropReady: true });
const heftrootTile = grid[3][2]; // Used as a ready foliage crop tile at world position 2.5, 3.5.
Object.assign(heftrootTile, { crop: 'heftroot', cropReady: true });

const ongyumsBaseY = 0.50; // Used as the stationary baseline that must be recovered from the legacy 0.03 ripe bob.
const ongyumsBob = Math.sin(now / 500 + 4 + 7) * 0.03; // Mirrors vegetation-crop-rendering's generic ripe bob for the test timestamp.
const ongyums = makeRoot({
  isMesh: true,
  userData: { testOngyums: true, hobunjiCropRootKey: 'ongyums', hobunjiCropClusterCount: 3 },
  geometry: { type: 'BufferGeometry', parameters: {} },
  material: { visible: false },
  position: { x: 4.5, y: ongyumsBaseY + ongyumsBob, z: 7.5 },
  rotation: { y: now / 1200 + 4 },
}); // Converted PNG crop root carrying the generic branch's legacy bob/spin values.

const heftrootBaseY = 0.21; // Used as the stationary foliage baseline that must be recovered from the legacy 0.025 ripe bob.
const heftrootBob = Math.sin(now / 500 + 2 + 3) * 0.025; // Mirrors vegetation-crop-rendering's foliage ripe bob for the same timestamp.
const heftroot = makeRoot({
  userData: { testHeftroot: true, hobunjiCropRootKey: 'heftroot' },
  position: { x: 2.5, y: heftrootBaseY + heftrootBob, z: 3.5 },
  rotation: { y: now / 2200 + 2 },
}); // Foliage crop root carrying the foliage branch's legacy bob/spin values.

const actor = makeRoot({
  userData: { testActor: true },
  scale: { x: 0.7, y: 0.7, z: 0.7 },
  position: { x: 1.5, y: 0.4, z: 1.5 },
  rotation: { y: 2 },
}); // Half-tile actor-like object used to prove unrelated scene roots are untouched.

scene.add(ongyums);
scene.add(heftroot);
scene.add(actor);

const fakeFarmPanel = { init(deps) { return deps; } }; // Receives the module's dependency-capture wrapper before rendering.
const context = {
  window: { THREE, FarmPanel: fakeFarmPanel },
  performance: { now: () => now },
  Date,
  Math,
  Number,
  Float32Array,
  queueMicrotask,
}; // Browser-global stand-in for executing the real presentation module.
vm.runInNewContext(source, context);
context.window.FarmPanel.init({ getGrid: () => grid, scene });
const renderer = new THREE.WebGLRenderer(); // Exercises the installed render wrapper against both crop renderer branches.

(async () => {
  assert.equal(renderer.render(scene, {}), true, 'ripe presentation preserves the underlying renderer return value');
  const first = draws.at(-1); // Used to inspect the very first authoritative-ready draw.
  assert.ok(Math.abs(first.ongyumsY - ongyumsBaseY) < 1e-9,
    'ready PNG/generic crop is stationary instead of floating with the legacy bob');
  assert.equal(first.ongyumsRot, 0,
    'ready PNG/generic crop no longer spins when ripe');
  assert.ok(Math.abs(first.heftrootY - heftrootBaseY) < 1e-9,
    'ready foliage crop is stationary instead of floating with the legacy bob');
  assert.equal(first.heftrootRot, 0,
    'ready foliage crop no longer spins when ripe');
  assert.equal(first.actorY, 0.4, 'unrelated half-tile actor Y is untouched');
  assert.equal(first.actorRot, 2, 'unrelated half-tile actor rotation is untouched');
  assert.equal(first.sparkleVisible, true, 'authoritative ready crops keep the existing shared sparkle cue');
  assert.equal(first.sparkleCoords, 24, 'two ripe crops produce four xyz sparkle points each');
  assert.ok(Math.abs(ongyums.position.y - (ongyumsBaseY + ongyumsBob)) < 1e-9,
    'game-owned generic crop transform is restored immediately after drawing');
  assert.ok(Math.abs(heftroot.position.y - (heftrootBaseY + heftrootBob)) < 1e-9,
    'game-owned foliage crop transform is restored immediately after drawing');

  ongyumsTile.cropReady = false;
  heftrootTile.cropReady = false;
  now += 1; // Deliberately stays well inside the 100 ms scene-discovery interval.
  await new Promise(resolve => setImmediate(resolve)); // Flushes the module's per-turn reset without permitting a membership rescan.
  renderer.render(scene, {});
  const second = draws.at(-1); // Used to prove tile.cropReady changes are reflected without waiting for the next 10 Hz scene scan.
  assert.equal(second.sparkleVisible, false, 'sparkles disappear immediately when authoritative cropReady flags clear');
  assert.equal(second.sparkleCoords, 0, 'non-ready crops leave no active sparkle points');
  assert.equal(context.window.HobunjiCropReadyPresentation.getDebug().readyCrops, 0,
    'diagnostics follow tile.cropReady immediately rather than stale cached readiness');

  ongyumsTile.cropReady = true;
  heftrootTile.cropReady = true;
  now += 1; // Still inside the original membership-scan window so only the cheap cached-root readiness pass can react.
  await new Promise(resolve => setImmediate(resolve));
  renderer.render(scene, {});
  const third = draws.at(-1); // Used to verify the same cached roots become stationary/sparkling immediately when ripeness returns.
  assert.equal(third.sparkleVisible, true, 'sparkles return immediately when authoritative cropReady flags become true');
  assert.equal(third.ongyumsRot, 0, 'cached PNG crop is immediately stationary when it becomes ripe');
  assert.equal(third.heftrootRot, 0, 'cached foliage crop is immediately stationary when it becomes ripe');
  assert.equal(context.window.HobunjiCropReadyPresentation.getDebug().readinessSource, 'tile.cropReady',
    'diagnostics expose the direct readiness source');
  assert.equal(context.window.HobunjiCropReadyPresentation.getDebug().ripePlantMotion, 'none',
    'diagnostics expose sparkle-only ripe presentation');

  const billboardIndex = loader.indexOf('crop-billboard-presentation.js'); // Used to preserve PNG/flood/soil grounding before the ripe presentation wrapper installs.
  const readyIndex = loader.search(/crop-ready-presentation\.js\?v=\d+\w*/); // Used to locate the sparkle-only presentation module in bootstrap order.
  const metadataIndex = loader.indexOf('inventory-action-metadata-bridge.js'); // Used as the unrelated later-module ordering boundary.
  assert.ok(billboardIndex >= 0 && readyIndex > billboardIndex && metadataIndex > readyIndex,
    'ripe sparkle presentation loads after crop soil grounding and before unrelated inventory metadata');

  console.log('ripe crop sparkle-only presentation tests passed');
})();
