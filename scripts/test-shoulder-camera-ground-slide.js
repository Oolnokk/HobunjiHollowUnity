'use strict';

const assert = require('node:assert/strict'); // Checks the live solver's positions and angles.
const fs = require('node:fs'); // Reads the actual game-owned camera implementation.
const vm = require('node:vm'); // Runs camera math without loading the full renderer.
const game = fs.readFileSync('docs/game.js', 'utf8'); // Source for both terrain and mesh collision solves.
const start = game.indexOf('      const CAMERA_FLOOR_CLEARANCE ='); // Begins at the solver's shared constants and smoothing state.
const end = game.indexOf('      // How far under a tree canopy', start); // Ends after the complete game-owned boom implementation.
assert.ok(start >= 0 && end > start, 'live camera solver must be available');
const context = vm.createContext({
  activeCameraMode: 'shoulderSurf', SHOULDER_SURF_MODE: 'shoulderSurf',
  cutscenePreviewActive: false, dialogueZoomActive: () => false,
  camTargetY: 0, _playerGroundY: () => 0,
  activeSurfaceYAtWorld: () => 0,
  currentArea: 'farm', _isBuildingArea: () => false,
  currentAreaOcclusionMeshes: () => [],
  performance: { now: () => 1000 },
  THREE: { MathUtils: { degToRad: degrees => degrees * Math.PI / 180 } },
  window: { FormatUtils: { clamp: (n, lo, hi) => Math.max(lo, Math.min(hi, n)) } },
  _cameraOcclusionOriginVec: { set() { return this; } },
  _cameraOcclusionDirVec: { set() { return this; } },
  _cameraOcclusionRaycaster: { set() {}, intersectObjects: () => [] },
}); // Supplies only existing game dependencies, with controllable terrain and walls.
vm.runInContext(game.slice(start, end) + '\nthis.solve = occlusionSafeCameraPosition; this.debug = () => _cameraBoomDebug;', context);

function aim(height, pitch, distance = 1.3, x = 0, z = 0) {
  const angle = pitch * Math.PI / 180; // Converts requested upward pitch to the target-to-camera ray.
  return context.solve(x, height, z, x, height - Math.sin(angle) * distance, z + Math.cos(angle) * distance);
}
function pitchOf(position, height, x = 0, z = 0) {
  return Math.atan2(height - position.y, Math.hypot(position.x - x, position.z - z)) * 180 / Math.PI;
}

for (const height of [0.04, 0.1, 0.15, 0.2, 0.465, 0.62, 0.95]) {
  let previousDistance = Infinity; // Verifies the boom slides progressively closer as upward pitch increases.
  for (const pitch of [0, 5, 15, 30, 45, 60, 76]) {
    const result = aim(height, pitch); // Executes the complete wall/ground solver for short and reference characters.
    const boom = context.debug(); // Reads the same values delivered to mobile Pixel Probe.
    assert.ok(Math.abs(pitchOf(result, height) - pitch) < 1e-7, `height ${height}: preserves ${pitch} degree upward aim`);
    assert.ok(result.y >= boom.floorY + boom.floorClearance - 1e-9, 'camera stays above terrain');
    assert.ok(boom.solvedDistance > 0, 'short characters never collapse onto the look target');
    assert.ok(boom.solvedDistance <= previousDistance + 1e-6, 'greater upward pitch brings camera closer');
    previousDistance = boom.solvedDistance;
  }
}

context.currentAreaOcclusionMeshes = () => [{}];
context._cameraOcclusionRaycaster.intersectObjects = () => [{ distance: 0.48 }];
const wallResult = aim(0.465, 20); // Exercises outdoor walls inside the old three-tile minimum.
assert.ok(context.debug().solvedDistance <= 0.23 + 1e-9, 'outdoor shoulder boom retracts in front of nearby walls');
assert.ok(Math.abs(pitchOf(wallResult, 0.465) - 20) < 1e-7, 'wall collision preserves upward aim instead of lifting the camera');
context._cameraOcclusionRaycaster.intersectObjects = () => [{ distance: 0.15 }];
const nearWall = aim(0.15, 0, 0.3); // A zoomed boom shorter than half a tile must still raycast walls.
assert.ok(Math.hypot(nearWall.z, nearWall.y - 0.15) <= 0.04 + 1e-9, 'short booms still collide with nearby walls');
context.currentAreaOcclusionMeshes = () => [];
context.performance.now = () => 1100;
const recovering = aim(0.15, 0, 0.3); // Clearing a wall eases the boom outward instead of snapping back.
assert.ok(recovering.z > nearWall.z && recovering.z < 0.3, 'unobstructed wall recovery is smoothed');
vm.runInContext('_seatedOcclusionDistance = null; _seatedOcclusionUpdatedAt = 0;', context);

context.activeSurfaceYAtWorld = (x, z) => 2 + z * 0.3;
context.camTargetY = 2;
const rampResult = aim(2.15, 30); // Elevated rising ramp should stop the camera at local terrain, preserving its angle.
assert.ok(rampResult.y >= context.activeSurfaceYAtWorld(rampResult.x, rampResult.z) + context.debug().floorClearance - 1e-9);
assert.ok(Math.abs(pitchOf(rampResult, 2.15) - 30) < 1e-7);
context.activeSurfaceYAtWorld = (x, z) => z >= 0.3 && z < 0.65 ? 0.5 : 0;
context.camTargetY = 0;
const ridgeResult = aim(0.4, 0); // Checks the whole boom: its endpoint is clear but an intervening raised tile blocks it.
assert.ok(ridgeResult.z < 0.3, 'boom cannot pass through an intervening ridge to reach a clear endpoint');
context.activeSurfaceYAtWorld = (x, z) => -z;
const downhillResult = aim(0.15, 30); // Descending terrain provides more clearance than the player's own ground plane.
assert.ok(Math.abs(Math.hypot(downhillResult.z, downhillResult.y - 0.15) - 1.3) < 1e-9, 'downhill terrain allows the full boom');

context.activeCameraMode = 'seated';
context.activeSurfaceYAtWorld = () => 0;
const seatedResult = aim(0.9, 30); // Existing seated floor behavior remains compatible with its wall-side search.
assert.ok(Math.abs(pitchOf(seatedResult, 0.9) - 30) < 1e-7);
assert.equal(context.debug(), null, 'scripted/seated cameras do not report a manual shoulder solve');
// Execute the normal camera update too, so the actual input-to-solver path,
// lowered offset guard, and near-plane behavior are covered together.
const updateStart = game.indexOf('      function updateCameraPosition() {'); // Locates the real gameplay camera integration.
const updateEnd = game.indexOf('      updateCameraPosition();', updateStart); // Excludes boot-time invocation after the function.
const mode = { distanceTiles: 1.3, angleFromGroundDeg: 9, targetYOffsetTiles: 0.15, fovDeg: 55, ignoreGlobalZoom: true }; // Representative short-character Shoulder Cam framing.
const camera = {
  position: { set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
  lookAt(x, y, z) { this.target = { x, y, z }; },
  updateProjectionMatrix() {},
}; // Records the final camera pose and projection parameters without WebGL.
Object.assign(context, {
  activeCameraMode: 'shoulderSurf', camera,
  applyAuthoredCinematicCamera: () => false, cameraModeConfig: () => mode,
  cameraContainerAspect: () => 1, camTargetX: 0, camTargetY: 0, camTargetZ: 0,
  cameraAngleOffsetDeg: -85, cameraAzimuthOffsetDeg: 0, s_zoomScale: 1.5,
  portraitAim: null, dialoguePortraitCameraAim: () => null,
  s_shoulderSurfOffsetH_current: 0, s_shoulderSurfOffsetV_current: 0,
  _lastCameraLookPoint: { set() {} },
});
vm.runInContext(game.slice(updateStart, updateEnd) + '\nthis.updateCamera = updateCameraPosition;', context);
context.updateCamera();
assert.ok(Math.abs(pitchOf(camera.position, camera.target.y) - 76) < 1e-7, 'gameplay update retains maximum upward pitch for a short character');
assert.ok(camera.near < 0.1 && camera.near < context.debug().solvedDistance, 'near plane shrinks when the camera approaches the character');
context.s_shoulderSurfOffsetV_current = -0.4;
context.updateCamera();
assert.equal(camera.target.y, 0.04, 'a lowered Settings offset cannot bury the aim target');
assert.ok(Math.abs(pitchOf(camera.position, camera.target.y) - 76) < 1e-7, 'lowered offset still permits upward aim');
context.activeCameraMode = 'default';
context.updateCamera();
assert.equal(camera.near, 0.1, 'switching camera modes restores the normal near plane');

console.log('Shoulder camera ground slide: short-character pitch sweeps, close walls, ramps, ridges, downhill ground, and seated compatibility passed.');
