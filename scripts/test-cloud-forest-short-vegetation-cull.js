#!/usr/bin/env node
'use strict';

// Exercises game.js's actual vegetation culling functions without booting WebGL.
// The baked tree batcher uses the same corridor gate via CloudForestFog.init.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const game = fs.readFileSync('docs/game.js', 'utf8');
const html = fs.readFileSync('docs/index.html', 'utf8');
const start = game.indexOf('      // The camera corridor is shared with the baked-tree chunk culler.');
const end = game.indexOf('      // ── Lighting ─', start);
assert(start > -1 && end > start, 'the shipped game retains the authoritative vegetation corridor');

const state = {
  VEG_CULL_FORWARD_TILES: 42,
  VEG_CULL_WIDTH_TILES: 30,
  VEG_CULL_REAR_TILES: 2,
  VEG_CULL_HYSTERESIS_TILES: 1,
  currentArea: 'map_southern_cloud_forest',
  EXTERIOR_ZONES: { map_southern_cloud_forest: { cloudForest: true }, map_western_slope: {} },
  s_cloudForestShortCull: true,
  s_cloudForestCullRadiusTiles: 30,
  s_cloudForestFadeStartFrac: 0.70,
  s_cloudForestOutlineFrac: 0.40,
  camera: { position: { x: 0, z: 0 } },
  camTargetX: 0, camTargetZ: 1,
  player: { x: 0, y: 0 },
  TILE: 1,
  _isZoneArea: () => true,
  _zoneScenes: new Map(),
  companionObjects: [],
  activeCameraMode: 'normal',
  SHOULDER_SURF_MODE: 'shoulder',
  OCCLUSION_XZ_RADIUS_MUL: 1,
  TREE_FADE_OPACITY: 0.4,
  window: { FormatUtils: { clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)) } },
  setTreeOutlineEnabled(obj, enabled) { obj.outline = enabled; },
};
const fades = new Map(); // Tracks the real game function's requested tree opacity and reset.
state.window.ZoneTreeFade = {
  setTarget(obj, opacity, blocking) { fades.set(obj, { opacity, blocking }); },
  reset(obj) { fades.delete(obj); },
  isBetweenCameraAndPlayer2D() { return false; },
};
vm.runInNewContext(game.slice(start, end) + `
  globalThis.cull = { zoneVegetationCullBasis, vegetationCorridorContains, updateZoneVegetationCulling };
`, state, { filename: 'game.js:vegetation-corridor' });

function tree(x, z, radius = 0, xzRadius = radius) {
  return { visible: false, userData: { cullSphere: { x, z, radius, xzRadius } } };
}
function apply(...trees) {
  state._zoneScenes.set(state.currentArea, { cullables: trees });
  state.cull.updateZoneVegetationCulling();
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

state.s_cloudForestShortCull = true;
state.currentArea = 'map_western_slope';
apply(distant, side);
assert.equal(distant.visible, true, 'other zones retain the ordinary forward corridor');
assert.equal(side.visible, true, 'other zones retain the ordinary width');

assert.match(html, /id="settingCloudForestShortCull"/);
assert.match(game, /getVegetationCullMode: \(\) =>/);
assert.match(game, /isVegetationChunkInView: \(sphere, wasVisible\) => vegetationCorridorContains/);
console.log('Cloud Forest vegetation: compact corridor, yaw, fade, hysteresis, slider, baked hook and ordinary-zone parity passed.');
