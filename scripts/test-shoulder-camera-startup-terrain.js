'use strict';

const assert = require('node:assert/strict'); // Validates camera startup against actual terrain functions.
const fs = require('node:fs'); // Reads the production initialization sequence.
const vm = require('node:vm'); // Reproduces lexical initialization order without a renderer.
const game = fs.readFileSync('docs/game.js', 'utf8'); // Uses the game-owned camera and terrain implementations.
const segments = []; // Selected declarations and boot call, sorted into their actual production order below.
function addRange(start, end) {
  assert.ok(start >= 0 && end > start, 'production code segment must exist');
  segments.push({ start, source: game.slice(start, end) });
}
function addFunction(name) {
  const start = game.indexOf(`      function ${name}(`); // Locates the complete production function.
  const end = game.indexOf('\n      }', start) + '\n      }'.length; // Its outer closing brace uses the owning scope's indentation.
  addRange(start, end);
}
const terrainStart = game.indexOf('      // ── World Z levels'); // Captures the canonical constants with their real initialization position.
const terrainEnd = game.indexOf('\n', game.indexOf('      const VEG_H =', terrainStart)); // Ends at the final terrain constant even when the block moves ahead of the camera.
addRange(terrainStart, terrainEnd);
for (const name of ['tileSurfaceY', 'tileSurfaceYInArea', 'farmSurfaceYAtWorld', 'activeSurfaceYAtWorld']) addFunction(name);
const boomStart = game.indexOf('      const CAMERA_FLOOR_CLEARANCE ='); // Captures camera collision constants, state, and both solver functions.
addRange(boomStart, game.indexOf('      // How far under a tree canopy', boomStart));
addFunction('updateCameraPosition');
const bootStart = game.indexOf('      updateCameraPosition();', game.indexOf('      function updateCameraPosition()')); // Executes the actual synchronous camera boot call, before any later terrain constants.
addRange(bootStart, bootStart + '      updateCameraPosition();'.length);
segments.sort((a, b) => a.start - b.start);

const TileType = Object.fromEntries(['GRASS', 'TRENCH', 'RIVER', 'STREAM', 'WATERFALL', 'RAISED', 'ROCK', 'RAMP'].map(name => [name, name.toLowerCase()])); // Mirrors tile identities needed by real surface lookups.
const grid = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => ({ type: TileType.GRASS }))); // Ensures boot samples a real farm tile rather than taking the missing-tile fallback.
const mode = { distanceTiles: 1.3, angleFromGroundDeg: 9, targetYOffsetTiles: 0.15, ignoreGlobalZoom: true }; // Short-character framing for startup and subsequent upward aim.
const camera = {
  position: { set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
  lookAt(x, y, z) { this.target = { x, y, z }; },
  updateProjectionMatrix() {},
}; // Records the final pose produced by the real update function.
const context = vm.createContext({
  TileType, MAX_WATER: 3, grid, camera,
  currentArea: 'farm', _isZoneArea: () => false, _isBuildingArea: () => false,
  activeCameraMode: 'shoulderSurf', SHOULDER_SURF_MODE: 'shoulderSurf',
  cutscenePreviewActive: false, dialogueZoomActive: () => false,
  camTargetX: 0.5, camTargetZ: 0.5, camTargetY: 0,
  cameraAngleOffsetDeg: 0, cameraAzimuthOffsetDeg: 0, s_zoomScale: 1.5,
  s_shoulderSurfOffsetH_current: 0, s_shoulderSurfOffsetV_current: 0,
  applyAuthoredCinematicCamera: () => false,
  cameraModeConfig: () => mode, cameraContainerAspect: () => 1,
  dialoguePortraitCameraAim: () => null, _lastCameraLookPoint: { set() {} },
  currentAreaOcclusionMeshes: () => [], performance: { now: () => 1000 },
  THREE: { MathUtils: { degToRad: n => n * Math.PI / 180 } },
  window: { FormatUtils: { clamp: (n, lo, hi) => Math.max(lo, Math.min(hi, n)) } },
}); // Stubs rendering/input only; all terrain math and initialization remain production code.
assert.doesNotThrow(() => vm.runInContext(segments.map(segment => segment.source).join('\n'), context),
  'initial shoulder camera must read real farm terrain without uninitialized constants');
assert.ok(Number.isFinite(camera.position.y), 'boot positions the camera successfully');
assert.equal(context.activeSurfaceYAtWorld(0.5, 0.5), 0, 'real grass surface is initialized');
grid[0][0].type = TileType.RAISED;
assert.equal(context.activeSurfaceYAtWorld(0.5, 0.5), 0.5, 'raised surface constant is initialized');
grid[0][0].type = TileType.RAMP;
grid[0][0].rampElevation = 1;
assert.equal(context.activeSurfaceYAtWorld(0.5, 0.5), 2.5, 'ramp tier constant is initialized');
grid[0][0] = { type: TileType.GRASS };
context.cameraAngleOffsetDeg = -85;
context.updateCameraPosition();
const pitch = Math.atan2(camera.target.y - camera.position.y, Math.hypot(camera.position.x - camera.target.x, camera.position.z - camera.target.z)) * 180 / Math.PI; // Confirms the startup fix retains the requested upward aim.
assert.ok(Math.abs(pitch - 76) < 1e-7, 'short-character upward aim survives real terrain integration');
console.log('Shoulder camera startup with real grass, raised, ramp, and upward-aim terrain functions passed.');
