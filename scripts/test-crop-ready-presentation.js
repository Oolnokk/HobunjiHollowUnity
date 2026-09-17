#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const billboardSource = fs.readFileSync(path.join(__dirname, '..', 'docs/js/crop-billboard-presentation.js'), 'utf8'); // Supplies the real crop-render -> FarmPanel scene dependency link.
const readySource = fs.readFileSync(path.join(__dirname, '..', 'docs/js/crop-ready-presentation.js'), 'utf8'); // Exercises the existing sparkle-only draw presentation.
const loader = fs.readFileSync(path.join(__dirname, '..', 'docs/js/combat/combat-config-loader.js'), 'utf8');
let now = 1000; // Drives deterministic two-observation ripe-motion detection.

class BufferGeometry {
  constructor() { this.attributes = {}; }
  setAttribute(name, value) { this.attributes[name] = value; }
  computeBoundingSphere() {}
  setDrawRange(start, count) { this.drawRange = { start, count }; }
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
const draws = [];
WebGLRenderer.prototype.render = function render(scene) {
  const crop = scene.children.find(child => child.userData?.testCrop);
  const actor = scene.children.find(child => child.userData?.testActor);
  const sparkles = scene.children.find(child => child.userData?.hobunjiReadyCropSparkles);
  draws.push({
    cropY: crop?.position.y,
    cropRot: crop?.rotation.y,
    actorRot: actor?.rotation.y,
    sparkleVisible: sparkles?.visible,
    sparkleCoords: (sparkles?.geometry?.drawRange?.count ?? 0) * 3,
  });
  return true;
};

const THREE = { BufferGeometry, BufferAttribute, PointsMaterial, Points, WebGLRenderer };
const scene = {
  children: [],
  add(object) { if (!this.children.includes(object)) this.children.push(object); object.parent = this; },
  traverse(callback) {
    callback(this);
    for (const child of this.children) {
      callback(child);
      child.traverse?.(callback);
    }
  },
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
};
const actor = {
  isGroup: true,
  parent: scene,
  children: [{}],
  userData: { testActor: true },
  scale: { x: 0.7, y: 0.7, z: 0.7 },
  position: { x: 4.5, y: 0.4, z: 7.5 },
  rotation: { y: 2 },
};
scene.children.push(crop, actor);

let panelInitDeps = null;
let vegetationInitDeps = null;
const window = {
  THREE,
  FarmPanel: { init(injectedDeps) { panelInitDeps = injectedDeps; return injectedDeps; } },
  VegetationCropRendering: { init(injectedDeps) { vegetationInitDeps = injectedDeps; return injectedDeps; } },
};
const context = {
  window,
  performance: { now: () => now },
  Date,
  Math,
  Number,
  Object,
  Map,
  Float32Array,
  queueMicrotask,
};
vm.runInNewContext(billboardSource, context, { filename: 'crop-billboard-presentation.js' });
vm.runInNewContext(readySource, context, { filename: 'crop-ready-presentation.js' });

const grid = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => ({ crop: null, water: 0 })));
grid[7][4] = { crop: 'ongyums', water: 0, cropReady: true };
const panelDeps = { getGrid: () => grid }; // Deliberately omits scene, matching the panel's real state/UI dependency contract.
window.FarmPanel.init(panelDeps);
window.VegetationCropRendering.init({ getGrid: () => grid, scene });
assert.strictEqual(panelInitDeps, panelDeps, 'FarmPanel still receives its original dependency object');
assert.strictEqual(vegetationInitDeps.scene, scene, 'crop renderer receives the authoritative farm scene');
assert.strictEqual(panelDeps.scene, scene, 'ripe presentation sees that scene through the crop dependency bridge');

const renderer = new THREE.WebGLRenderer();

(async () => {
  renderer.render(scene, {});
  assert.equal(draws.at(-1).cropRot, 10, 'first observation does not guess that a static crop is ripe');

  now += 100;
  crop.rotation.y = 10.01;
  crop.position.y = 0.55;
  actor.rotation.y = 2.02;
  await new Promise(resolve => setImmediate(resolve)); // Lets crop-ready-presentation reset its once-per-turn scan gate.
  renderer.render(scene, {});

  assert.equal(draws.at(-1).cropRot, 0, 'ripe crop is drawn without the legacy root spin');
  assert.ok(Math.abs(draws.at(-1).cropY - 0.54) < 1e-9, 'ripe crop is drawn at the learned stationary bob midpoint');
  assert.equal(draws.at(-1).actorRot, 2.02, 'unmarked animated groups are not neutralized as crops');
  assert.equal(draws.at(-1).sparkleVisible, true, 'ripe crop enables the shared sparkle cue');
  assert.equal(draws.at(-1).sparkleCoords, 12, 'one ripe crop gets the existing four sparkle points');
  assert.equal(crop.rotation.y, 10.01, 'game-owned rotation is restored after the draw');
  assert.equal(crop.position.y, 0.55, 'game-owned bob position is restored after the draw');

  const billboardIndex = loader.indexOf('crop-billboard-presentation.js');
  const readyIndex = loader.search(/crop-ready-presentation\.js\?v=\d+\w*/);
  assert.ok(billboardIndex >= 0 && readyIndex > billboardIndex,
    'soil grounding installs before ripe sparkle presentation so both share the linked farm scene');

  console.log('ripe crop sparkle presentation dependency tests passed');
})();
