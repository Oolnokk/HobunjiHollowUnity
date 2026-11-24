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
let testSeconds = 1; // Controls the exact wind-gust phase for deterministic Western Slope weather tests.
let snowStrength = 0; // Supplies the live weather intensity used by Slope fog rather than forecast labels.
const snowCalendar = { get isRaining() { return snowStrength > 0; }, get rainStrength() { return snowStrength; } }; // One authoritative weather state for the wind and mist tests.
const win = {
  THREE: { ...THREE, TextureLoader: class { load() {} } },
  document: { createElement: () => ({ getContext: () => context2d }) },
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  performance: { now: () => testSeconds * 1000 },
  WeatherFX: { getPrecipitationStrength: () => snowStrength, getProjection: () => ({ calendar: snowCalendar }) },
};
win.window = win;
vm.runInNewContext(fs.readFileSync('docs/js/weather-wind.js', 'utf8'), win);
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
    assert.equal(scene.fog, activeScene.fog, 'the live fog parameters reach the redraw shader');
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

// Western Slope uses the same three mesh objects instead of allocating a second fog stack.
fog.setLayerOpacity(0, 0.14);
fog.setLayerOpacity(1, 0.26);
fog.setLayerOpacity(2, 0.46);
const slope = new THREE.Scene();
const slopeFog = new THREE.FogExp2(0xa3bdd3, 0.018);
const slopeBackground = new THREE.Color(0x56799c);
const sky = new THREE.Group();
sky.name = 'hobunji_dynamic_skydome';
slope.fog = slopeFog;
slope.background = slopeBackground;
slope.add(sky);
let slopeLightingSamples = 0; // Counts actual sky-light sampling, not the number of rendered snow frames.
win.HobunjiSkyDome = {
  getLightingState: () => { slopeLightingSamples++; return { r: 230, g: 235, b: 250, a: 0 }; },
  lunarIllumination: () => 1,
  getDebugState: () => { throw new Error('mist lighting must use the lunar sampler directly'); },
}; // The Western Slope retains its own daylight sky; only fog-material tint is sampled.
area = 'map_western_slope';
activeScene = slope;
const policy = fog.__test;
const calmSecond = Array.from({ length: 400 }, (_, i) => i).find(t => win.WeatherWind.strengthForArea(area, { isRaining: false }, t) < 0.675);
const windySecond = Array.from({ length: 400 }, (_, i) => i).find(t => win.WeatherWind.strengthForArea(area, { isRaining: false }, t) > 0.75);
assert.notEqual(calmSecond, undefined);
assert.notEqual(windySecond, undefined);
const advance = (seconds = 3) => {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) fog.update(1 / 60);
}; // Exercise the eased transition rather than bypassing it.

testSeconds = calmSecond;
snowStrength = 0;
fog.update(1 / 60);
assert.equal(worldMist.parent, slope);
assert.equal(worldMist.visible, false, 'clear and calm weather submits no mist');
assert.equal(slope.fog, slopeFog, 'native slope fog must never be replaced');
assert.equal(slope.background, slopeBackground, 'native slope background must never be replaced');
assert.equal(sky.visible, true, 'slope sky remains visible behind blowing snow');
fog.renderOutlineMist(renderer, camera, slope);
assert.equal(draws, 2, 'calm air saves the separate mist redraw');

testSeconds = windySecond;
advance();
assert(worldMist.visible, 'clear-weather gusts kick loose snow into the air');
assert(worldMist.children.every(layer => layer.material.opacity <= 0.46), 'gust haze remains below Cloud Forest density');
assert(fog.getDebugState().westernSlopeSnow.windStrength > 0.75, 'mobile snapshot exposes the shared wind strength');
const clearGustScale = fog.getDebugState().westernSlopeSnow.opacityScale;

snowStrength = 2;
advance();
assert(fog.getDebugState().westernSlopeSnow.opacityScale > clearGustScale, 'falling snow adds density beyond clear-weather gusts');
assert(fog.getDebugState().westernSlopeSnow.opacityScale < 1, 'non-blizzard weather cannot reach the density cap');
slope.updateMatrixWorld();
fog.renderOutlineMist(renderer, camera, slope);
assert.equal(draws, 3, 'blowing snow shares the existing outline mist redraw');
assert.equal(fog.getDebugState().outlineMistRedrawLayers, 3);

snowStrength = 3;
advance(6);
assert(Math.abs(worldMist.children[0].material.opacity - 0.14) < 0.001, 'blizzard reaches the first Cloud Forest layer cap');
assert(Math.abs(worldMist.children[1].material.opacity - 0.26) < 0.001, 'blizzard reaches the middle Cloud Forest layer cap');
assert(Math.abs(worldMist.children[2].material.opacity - 0.46) < 0.001, 'blizzard reaches the outer Cloud Forest layer cap');
assert.equal(policy.westernSlopeSnowOpacity(3, 1), 1, 'full blizzard target is capped at one');
const tintSamplesBefore = slopeLightingSamples; // Establishes how many sky lighting reads one continuous two-second interval needs.
for (let i = 0; i < 120; i++) {
  testSeconds += 1 / 60;
  fog.update(1 / 60);
}
const tintRefreshes = slopeLightingSamples - tintSamplesBefore; // Expected: ~10 samples instead of 120 frame-by-frame reads.
assert(tintRefreshes >= 8 && tintRefreshes <= 12,
  'slope snow tint refreshes at about 5Hz rather than on every frame');
assert.equal(slope.fog, slopeFog, 'throttled snow tint must not overwrite native depth fog');
assert.equal(slope.background, slopeBackground, 'throttled snow tint must not overwrite native sky colors');
fog.setLayerOpacity(2, 0.23);
advance();
assert(worldMist.children[2].material.opacity <= 0.23, 'custom layer tuning remains the absolute blizzard cap');

snowStrength = 0;
testSeconds = calmSecond;
advance(8);
assert.equal(worldMist.visible, false, 'clearing skies and quiet wind fade the snow layers away');
assert.equal(fog.getDebugState().westernSlopeSnow.meshCount, 0);
assert.equal(slope.fog, slopeFog);
assert.equal(slope.background, slopeBackground);
assert.equal(sky.visible, true);
area = 'town';
activeScene = otherZone;
fog.update(0.016);
assert.equal(worldMist.parent, null, 'leaving the Western Slope detaches the shared group');
assert.equal(fog.getDebugState().westernSlopeSnow.opacityScale, 0, 'area changes discard stale storm density');

console.log('Cloud Forest / Western Slope mist redraw passed.');
