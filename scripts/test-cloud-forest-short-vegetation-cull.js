#!/usr/bin/env node
'use strict';

// Exercises the shipped vegetation corridor (docs/js/zone-vegetation-cull.js,
// extracted from game.js) through its real init(deps) API without WebGL.
// The baked tree batcher uses the same corridor gate via CloudForestFog.init.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const game = fs.readFileSync('docs/game.js', 'utf8');
const html = fs.readFileSync('docs/index.html', 'utf8');
const source = fs.readFileSync('docs/js/zone-vegetation-cull.js', 'utf8');

const state = {
  currentArea: 'map_southern_cloud_forest',
  EXTERIOR_ZONES: { map_southern_cloud_forest: { cloudForest: true }, map_western_slope: {} },
  s_cloudForestShortCull: true,
  s_cloudForestCullRadiusTiles: 30,
  s_cloudForestFadeStartFrac: 0.70,
  s_cloudForestOutlineFrac: 0.40,
  camera: { position: { x: 0, z: 0 } },
  camTargetX: 0, camTargetZ: 1,
  player: { x: 0, y: 0 },
  zoneScenes: new Map(),
};
const fades = new Map(); // Tracks the real module's requested tree opacity and reset.
const fadedOut = new Set(); // Trees the fade double reports as settled at opacity 0.
const windowObject = {
  ZoneTreeFade: {
    init() {},
    isFadedOut(obj) { return fadedOut.has(obj); },
    setTarget(obj, opacity, blocking) { fades.set(obj, { opacity, blocking }); },
    reset(obj) { fades.delete(obj); },
    isBetweenCameraAndPlayer2D() { return false; },
  },
};
vm.runInNewContext(source, { window: windowObject, globalThis: {} }, { filename: 'zone-vegetation-cull.js' });
const cullApi = windowObject.ZoneVegetationCull;
cullApi.init({
  camera: state.camera,
  getCamTargetX: () => state.camTargetX,
  getCamTargetZ: () => state.camTargetZ,
  getCurrentArea: () => state.currentArea,
  isZoneArea: () => true,
  getZoneScene: area => state.zoneScenes.get(area),
  exteriorZones: state.EXTERIOR_ZONES,
  getPlayerTile: out => { out.x = state.player.x; out.z = state.player.y; return out; },
  companionObjects: [], TILE: 1,
  isShoulderSurf: () => false,
  clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
  settings: {
    shortCloudForestCull: () => state.s_cloudForestShortCull,
    cloudForestCullRadiusTiles: () => state.s_cloudForestCullRadiusTiles,
    cloudForestFadeStartFrac: () => state.s_cloudForestFadeStartFrac,
    cloudForestOutlineFrac: () => state.s_cloudForestOutlineFrac,
  },
});
assert.equal(cullApi.CORRIDOR.FORWARD_TILES, 42, 'ordinary corridor reach is unchanged');
assert.equal(cullApi.CORRIDOR.WIDTH_TILES, 30);

function tree(x, z, radius = 0, xzRadius = radius) {
  const meshes = [];
  return {
    visible: false, userData: { cullSphere: { x, z, radius, xzRadius } },
    traverse(fn) { for (const mesh of meshes) fn(mesh); },
    get outline() { return this.userData._outlineEnabled; },
  };
}
function apply(...trees) {
  state.zoneScenes.set(state.currentArea, { cullables: trees });
  cullApi.update();
}
const near = tree(0, 10);
const distant = tree(0, 28);
const side = tree(12, 10);
const boundary = tree(10.2, 5);
const canopy = tree(10.2, 5, 12, 0); // A tall tree's 3D sphere must not widen the Cloud Forest corridor.
const fadeEdge = tree(0, 18);
apply(near, distant, side, boundary, canopy, fadeEdge);
assert.equal(near.visible, true, 'near tree remains in view');
assert.equal(distant.visible, false, '21-tile forward corridor hides trees the old 30-tile circle kept');
assert.equal(side.visible, false, '9.6-tile half-width removes off-axis trees');
assert.equal(boundary.visible, false);
assert.equal(canopy.visible, false, 'tall canopy height does not inflate horizontal visibility');
assert.equal(fadeEdge.visible, true);
assert(fades.get(fadeEdge).opacity > 0 && fades.get(fadeEdge).opacity < 1,
  'Cloud Forest tree fading follows the tighter forward edge');
assert.equal(fadeEdge.outline, false, 'outline work is omitted past the inner corridor');

boundary.visible = true;
apply(boundary);
assert.equal(boundary.visible, true, 'hysteresis keeps an already-visible edge tree stable');
boundary.visible = false;
apply(boundary);
assert.equal(boundary.visible, false, 'an outside tree remains outside the tighter boundary');

state.s_cloudForestCullRadiusTiles = 10;
apply(near);
assert.equal(near.visible, false, 'the live Cloud Forest slider actually changes forward reach');
state.s_cloudForestCullRadiusTiles = 30;

state.camTargetX = 1;
state.camTargetZ = 0;
const aheadAfterTurn = tree(15, 0);
const behindAfterTurn = tree(0, 15);
apply(aheadAfterTurn, behindAfterTurn);
assert.equal(aheadAfterTurn.visible, true, 'corridor follows camera yaw');
assert.equal(behindAfterTurn.visible, false, 'former forward direction is now off to the side');

state.s_cloudForestShortCull = false; // Dev A/B toggle: ordinary directional bounds.
state.camTargetX = 0;
state.camTargetZ = 1;
apply(distant, side);
assert.equal(distant.visible, true, 'Cloud Forest A/B toggle restores normal 42-tile forward corridor');
assert.equal(side.visible, true, 'normal wilderness half-width is 15 tiles');

// A tree the edge fade has settled at opacity 0 is left undrawn (it only drew depth ghosts),
// keeps its corridor hysteresis, and is drawn again once its fade target rises.
state.s_cloudForestShortCull = true;
state.camTargetX = 0;
state.camTargetZ = 1;
const ghost = tree(0, 20);
apply(ghost);
assert.equal(ghost.visible, true, 'in the corridor, fading');
fadedOut.add(ghost);
apply(ghost);
assert.equal(ghost.visible, false, 'faded fully out: not drawn');
assert.equal(cullApi.snapshot().lastFadedOutHidden, 1);
assert.equal(cullApi.snapshot().lastVisible, 1, 'still counted as in the corridor');
const ghostEdge = tree(10.2, 5);
ghostEdge.visible = true;
apply(ghostEdge);
assert.equal(ghostEdge.visible, true, 'hysteresis holds the edge tree');
fadedOut.add(ghostEdge);
apply(ghostEdge);
assert.equal(ghostEdge.visible, false);
fadedOut.delete(ghostEdge);
apply(ghostEdge);
assert.equal(ghostEdge.visible, true, 'an undrawn faded-out tree keeps its hysteresis, so it returns rather than flickering out');
fadedOut.delete(ghost);
apply(ghost);
assert.equal(ghost.visible, true, 'drawn again when no longer faded out');
fadedOut.add(ghost);
assert.equal(cullApi.setHideFadedOut(false), false);
apply(ghost);
assert.equal(ghost.visible, true, 'A/B: faded-out trees drawn as before');
cullApi.setHideFadedOut(true);
fadedOut.clear();

state.s_cloudForestShortCull = true;
state.currentArea = 'map_western_slope';
apply(distant, side);
assert.equal(distant.visible, true, 'other zones retain the ordinary forward corridor');
assert.equal(side.visible, true, 'other zones retain the ordinary width');

assert.match(html, /id="settingCloudForestShortCull"/);
assert.match(game, /getVegetationCullMode: \(\) =>/);
assert.match(game, /isVegetationChunkInView: \(sphere, wasVisible\) => window\.ZoneVegetationCull\.isChunkInView\(sphere, wasVisible\)/);
assert.equal(cullApi.isChunkInView({ x: 0, z: 10, radius: 0 }, false), true, 'baked chunk gate uses the same corridor');
assert.equal(cullApi.isChunkInView({ x: 0, z: -10, radius: 0 }, false), false);
const html2 = require('./classic-script-group-index.js').expandClassicScriptGroups();
assert.ok(html2.indexOf('js/zone-vegetation-cull.js?v=') > 0 && html2.indexOf('js/zone-vegetation-cull.js?v=') < html2.indexOf('src="game.js'), 'module loads before game.js');
console.log('Cloud Forest vegetation: compact corridor, yaw, fade, hysteresis, slider, baked hook and ordinary-zone parity passed.');
