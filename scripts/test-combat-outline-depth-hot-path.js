#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Verifies render-order, material restoration, and single registry walks.
const fs = require('node:fs'); // Loads the actual shipped PNG occlusion owner.
const vm = require('node:vm'); // Runs the browser module without WebGL.

const source = fs.readFileSync('docs/js/png-plane-outline-occluder.js', 'utf8'); // Source exercised in its complete IIFE.
const browser = { window: {}, THREE: { LessEqualDepth: 'less-equal' } }; // The only Three constant used by the replay.
vm.runInNewContext(source, browser, { filename: 'png-plane-outline-occluder.js' });
const occluder = browser.window.PngPlaneOutlineOccluder; // Real runtime API, not a reimplementation.
assert(occluder?.renderDepth && occluder?.prune);

let parentReads = 0; // Measures the number of ancestry lookups across the actual registered meshes.
function withParent(object, initialParent = null) {
  let parent = initialParent; // Mutable test parent allows detached actors to simulate a despawn.
  Object.defineProperty(object, 'parent', {
    get() { parentReads++; return parent; },
    set(value) { parent = value; },
  });
  return object;
}
function scene() { return withParent({ isScene: true }); }
function mesh(parent, material, visible = true) {
  return withParent({
    isMesh: true, visible, userData: {},
    material,
    layers: {
      mask: 1,
      enable(layer) { this.mask |= 1 << layer; },
    },
  }, parent);
}

const active = scene(); // Only this area's PNG sprites may affect the active render target.
const inactive = scene(); // A second cached area must retain registrations without replaying its materials.
const activeRoot = withParent({}, active);
const inactiveRoot = withParent({}, inactive);
const material = {
  colorWrite: true, depthWrite: false, depthTest: false,
  depthFunc: 'original', alphaTest: 0.02, map: { isTexture: true },
};
const offscreenMaterial = { colorWrite: true, depthWrite: false };
const activeMesh = mesh(activeRoot, material);
const inactiveMesh = mesh(inactiveRoot, offscreenMaterial);
const hiddenMesh = mesh(activeRoot, { colorWrite: true }, false);
occluder.registerDepthMesh(activeMesh);
occluder.registerDepthMesh(inactiveMesh);
occluder.registerDepthMesh(hiddenMesh);
occluder.registerDepthMesh(activeMesh);
assert.equal(occluder.snapshot().registered, 3, 'repeat registration is idempotent');

const camera = { layers: { mask: 0xffffffff, set(layer) { this.mask = 1 << layer; } } };
let renders = 0; // Counts real depth replays and inspects their temporarily overridden material state.
const renderer = {
  render(renderScene, renderCamera) {
    renders++;
    assert.strictEqual(renderScene, active);
    assert.strictEqual(renderCamera, camera);
    assert.equal(camera.layers.mask, 1 << 4, 'the depth replay uses the dedicated PNG layer');
    assert.equal(material.colorWrite, false);
    assert.equal(material.depthWrite, true);
    assert.equal(material.depthTest, true);
    assert.equal(material.depthFunc, 'less-equal');
    assert.equal(material.alphaTest, 0.35, 'the solid-coverage alpha cutoff is preserved');
    assert.equal(offscreenMaterial.colorWrite, true, 'inactive-area sprites are never mutated');
  },
};
occluder.init({ renderer, camera });

parentReads = 0;
occluder.prune();
const onceReads = parentReads; // Reference cost of precisely one ancestry walk per registered mesh.
assert(onceReads > 0);
parentReads = 0;
occluder.renderDepth(active);
assert.equal(parentReads, onceReads, 'renderDepth must prune and select active sprites in one ancestry pass');
assert.equal(renders, 1);
assert.equal(camera.layers.mask, 0xffffffff, 'camera layer selection is restored');
assert.equal(material.colorWrite, true);
assert.equal(material.depthWrite, false);
assert.equal(material.depthTest, false);
assert.equal(material.depthFunc, 'original');
assert.equal(material.alphaTest, 0.02, 'source alpha tests are restored');
assert.equal(occluder.snapshot().registered, 3, 'inactive and hidden sprites remain registered');

const successfulRender = renderer.render; // Reinstalled after deliberately throwing from the render hook.
renderer.render = () => { throw new Error('injected WebGL failure'); };
assert.throws(() => occluder.renderDepth(active), /injected WebGL failure/, 'depth pass propagates the original renderer error');
renderer.render = successfulRender;
assert.equal(camera.layers.mask, 0xffffffff, 'camera layers also restore after a failed depth draw');
assert.equal(material.colorWrite, true);
assert.equal(material.depthWrite, false);
assert.equal(material.depthTest, false);
assert.equal(material.depthFunc, 'original');
assert.equal(material.alphaTest, 0.02, 'temporary material changes cannot survive a failed depth draw');

activeMesh.parent = null;
occluder.renderDepth(active);
assert.equal(renders, 1, 'no render is issued when no active visible depth planes remain');
assert.equal(occluder.snapshot().registered, 2, 'despawned registrations are retired even with outlines on');
inactiveMesh.parent = null;
occluder.prune();
assert.equal(occluder.snapshot().registered, 1, 'outlines-off pruning still retires detached registrations');
console.log('PNG outline depth one-pass collection and restoration passed');
