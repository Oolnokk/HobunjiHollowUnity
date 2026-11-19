#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let THREE;
try {
  THREE = require('three');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('SKIPPED mist redraw: three@0.128.0 is unavailable.');
  process.exit(0);
}

const noop = () => {};
const context2d = {
  clearRect: noop, beginPath: noop, arc: noop, fill: noop,
  createRadialGradient: () => ({ addColorStop: noop }),
};
const win = {
  THREE: { ...THREE, TextureLoader: class { load() {} } },
  document: { createElement: () => ({ getContext: () => context2d }) },
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  performance: { now: () => 1000 },
};
win.window = win;
vm.runInNewContext(fs.readFileSync('docs/js/cloud-forest-fog.js', 'utf8'), win);
const fog = win.CloudForestFog;
const forest = new THREE.Scene();
forest.fog = new THREE.FogExp2(0xffffff, 0.055);
const otherZone = new THREE.Scene();
let activeScene = forest;
let area = 'map_southern_cloud_forest';

fog.init({
  THREE: win.THREE, TILE: 10, player: { x: 30, y: 60 },
  getPlayerGroundY: () => 4,
  isCloudForestArea: () => area === 'map_southern_cloud_forest',
  getCurrentArea: () => area, getActiveScene: () => activeScene,
});
fog.update(0.016);
const worldMist = forest.getObjectByName('cloud_forest_mist_cylinders');
assert.equal(worldMist.children.length, 3);
worldMist.children[2].scale.x = 19; // An existing developer override runs after Fog.update.
forest.updateMatrixWorld();

const camera = new THREE.PerspectiveCamera();
camera.layers.enableAll();
const cameraMask = camera.layers.mask;
let draws = 0;
let lastScene;
const renderer = {
  autoClear: true,
  render(scene, sceneCamera) {
    draws++;
    lastScene = scene;
    assert.notEqual(scene, forest);
    assert.equal(scene.children.length, 3, 'the renderer starts with only the mist meshes');
    assert.equal(scene.fog, forest.fog, 'the live fog parameters reach the redraw shader');
    assert.equal(scene.background, null, 'the redraw never paints over the world background');
    assert.equal(this.autoClear, false, 'uses the caller’s existing color and depth');
    assert.equal(sceneCamera.layers.mask, 1 << 5);
    for (const [index, mesh] of scene.children.entries()) {
      const source = worldMist.children[index];
      assert.equal(mesh.material, source.material);
      assert.equal(mesh.geometry, source.geometry);
      assert.equal(mesh.renderOrder, source.renderOrder);
      assert.equal(mesh.visible, source.visible);
      if (mesh.visible) assert(mesh.matrixWorld.equals(source.matrixWorld), 'matches the base render pose');
    }
  },
};
fog.renderOutlineMist(renderer, camera, forest);
assert.equal(draws, 1);
assert.equal(camera.layers.mask, cameraMask);
assert.equal(renderer.autoClear, true);
assert.equal(fog.getDebugState().outlineMistRedrawLayers, 3);

fog.setLayerOpacity(1, 0);
fog.update(0.016);
forest.updateMatrixWorld();
fog.renderOutlineMist(renderer, camera, forest);
assert.equal(lastScene.children[1].visible, false);
assert.equal(fog.getDebugState().outlineMistRedrawLayers, 2);

const failure = new Error('renderer failed');
assert.throws(() => fog.renderOutlineMist({ autoClear: true, render() { throw failure; } }, camera, forest), failure);
assert.equal(camera.layers.mask, cameraMask, 'render failures still restore camera layers');

fog.renderOutlineMist(renderer, camera, otherZone);
fog.setEnabled(false);
fog.renderOutlineMist(renderer, camera, forest);
assert.equal(draws, 2, 'stale or disabled fog never draws');
fog.setLayerOpacity(0, 0);
fog.setLayerOpacity(2, 0);
fog.update(0.016);
fog.renderOutlineMist(renderer, camera, forest);
assert.equal(draws, 2, 'all-zero layers skip the submission');

area = 'town';
activeScene = otherZone;
fog.update(0.016);
assert.equal(worldMist.parent, null);
fog.renderOutlineMist(renderer, camera, forest);
assert.equal(draws, 2, 'leaving the biome detaches the base mist and skips its redraw');
console.log('Cloud Forest mist redraw passed.');
