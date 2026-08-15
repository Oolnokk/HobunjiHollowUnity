#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Used to pin the restored presentation behavior without depending on browser gameplay state.
const fs = require('node:fs'); // Used to load the runtime module and loader directly from the checkout.
const path = require('node:path'); // Used to resolve repository-relative files from this test.
const vm = require('node:vm'); // Used to execute the presentation wrapper against a minimal Three.js stand-in.

const source = fs.readFileSync(path.join(__dirname, '..', 'docs/js/crop-ready-presentation.js'), 'utf8');
const loader = fs.readFileSync(path.join(__dirname, '..', 'docs/js/combat/combat-config-loader.js'), 'utf8');
let now = 1000; // Used to drive deterministic two-frame ripe-spin detection.

class BufferGeometry {
  constructor() { this.attributes = {}; }
  setAttribute(name, value) { this.attributes[name] = value; }
  computeBoundingSphere() {}
}
class BufferAttribute { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; } }
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
const draws = []; // Used to inspect the temporary presentation transforms at the exact draw boundary.
WebGLRenderer.prototype.render = function(scene) {
  const crop = scene.children.find(child => child.userData?.testCrop);
  const actor = scene.children.find(child => child.userData?.testActor);
  const sparkles = scene.children.find(child => child.userData?.hobunjiReadyCropSparkles);
  draws.push({
    cropY: crop?.position.y,
    cropRot: crop?.rotation.y,
    actorRot: actor?.rotation.y,
    sparkleVisible: sparkles?.visible,
    sparkleCoords: sparkles?.geometry?.attributes?.position?.array?.length || 0,
  });
  return true;
};

const THREE = { BufferGeometry, BufferAttribute, PointsMaterial, Points, WebGLRenderer };
const scene = {
  children: [],
  add(object) { if (!this.children.includes(object)) this.children.push(object); object.parent = this; },
};
const crop = {
  isMesh: true,
  parent: scene,
  children: [],
  userData: { testCrop: true },
  geometry: { type: 'BoxGeometry', parameters: { width: 1, height: 1, depth: 1 } },
  material: { isMeshLambertMaterial: true },
  scale: { x: 0.96, y: 0.96, z: 0.96 },
  position: { x: 4.5, y: 0.53, z: 7.5 },
  rotation: { y: 10 },
}; // Used to model game.js's generic ready-crop root signature.
const actor = {
  isGroup: true,
  parent: scene,
  children: [{}],
  userData: { testActor: true },
  scale: { x: 0.7, y: 0.7, z: 0.7 },
  position: { x: 4.5, y: 0.4, z: 7.5 },
  rotation: { y: 2 },
}; // Used to ensure half-tile animated character-like Groups never get treated as crops.
scene.children.push(crop, actor);

const context = { window: { THREE }, performance: { now: () => now }, Date, Math, Number, Float32Array };
vm.runInNewContext(source, context);
const renderer = new THREE.WebGLRenderer();

renderer.render(scene, {});
assert.equal(draws.at(-1).cropRot, 10, 'first observation does not guess that a static crop is ripe');

now += 16;
crop.rotation.y = 10.01;
crop.position.y = 0.55;
actor.rotation.y = 2.02;
renderer.render(scene, {});
assert.equal(draws.at(-1).cropRot, 0, 'detected ripe crop is drawn without the game.js rotation');
assert.ok(Math.abs(draws.at(-1).cropY - 0.54) < 1e-9, 'detected ripe crop is drawn at the learned bob midpoint');
assert.equal(draws.at(-1).actorRot, 2.02, 'unmarked animated groups are not neutralized as crops');
assert.equal(draws.at(-1).sparkleVisible, true, 'detected ripe crop enables the shared sparkle cue');
assert.equal(draws.at(-1).sparkleCoords, 12, 'four sparkles create four xyz triplets for one ripe crop');
assert.equal(crop.rotation.y, 10.01, 'game-owned ripe rotation is restored immediately after drawing');
assert.equal(crop.position.y, 0.55, 'game-owned ripe bob position is restored immediately after drawing');

const billboardIndex = loader.indexOf('crop-billboard-presentation.js'); // Used to preserve current sizing/clustering/flood anchoring before the ripe presentation wrapper installs.
const readyIndex = loader.indexOf('crop-ready-presentation.js?v=20260815a');
const metadataIndex = loader.indexOf('inventory-action-metadata-bridge.js');
assert.ok(billboardIndex >= 0 && readyIndex > billboardIndex && metadataIndex > readyIndex,
  'ripe sparkle presentation loads after current crop presentation and before unrelated inventory metadata');

console.log('ripe crop sparkle presentation tests passed');
