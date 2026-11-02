#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const config = fs.readFileSync('docs/config/scratchbones-config.js', 'utf8');
const game = fs.readFileSync('docs/game.js', 'utf8');
const index = fs.readFileSync('docs/index.html', 'utf8');
const clampSource = fs.readFileSync('docs/js/camera-look-clamp.js', 'utf8');
const context = { window: {} };
vm.runInNewContext(clampSource, context);
const clampPitchOffsetDeg = context.window.CameraLookClamp.clampPitchOffsetDeg;

assert.match(config, /"cameraRotateClampDeg": 45/, 'the existing limited-yaw clamp remains configured');
assert.doesNotMatch(config, /cameraRotateUpClampDeg/, 'the obsolete fixed upward-pitch clamp is removed');
assert.equal(context.window.CameraLookClamp.defaults.downDeg, 90, 'downward look reaches true vertical');
assert.equal(context.window.CameraLookClamp.defaults.upDeg, 90, 'upward look reaches true vertical');
assert.equal(clampPitchOffsetDeg(-120, {}, 9), -99, 'upward offset accounts for the authored 9-degree camera base and stops at vertical');
assert.equal(clampPitchOffsetDeg(120, {}, 9), 81, 'downward offset accounts for the authored 9-degree camera base and stops at vertical');
assert.equal(clampPitchOffsetDeg(-30, {}, 9), -30, 'camera module preserves in-range pitch offsets');
assert.equal(clampPitchOffsetDeg(120), 90, 'the standalone clamp defaults to absolute vertical');
assert.equal(clampPitchOffsetDeg(NaN, {}, 9), 0, 'invalid pitch input safely resets to neutral');
assert.equal(clampPitchOffsetDeg(Infinity, {}, 9), 0, 'infinite pitch input safely resets to neutral');
assert.match(game, /function clampCameraPitchOffsetDeg\(value, baseAngleDeg = Number\(cameraModeConfig\(activeCameraMode\)/, 'game.js supplies the active camera mode base angle to the shared clamp');
assert.match(game, /CameraLookClamp\.clampPitchOffsetDeg\(value, desktopControlsConfig\(\), baseAngleDeg\)/, 'game.js passes the base angle into the isolated clamp module');
assert.equal((game.match(/cameraAngleOffsetDeg = clampCameraPitchOffsetDeg\(/g) || []).length, 5, 'mouse, touch, controller, mobile autotarget, and seated look share the camera pitch bridge');
assert.match(game, /getCameraBaseAngleDeg: \(\) => Number\(cameraModeConfig\(activeCameraMode\)/, 'Kurraya receives the live camera base angle');
assert.match(game, /pitchSafeSetback = upwardPitchRad > 1e-4[\s\S]{0,220}targetHeadroom \/ Math\.tan\(upwardPitchRad\)/, 'upward look reduces the body-safe setback as the camera approaches vertical');
assert.match(game, /cameraAzimuthOffsetDeg = freeRotateCameraActive\(\)[\s\S]{0,260}-clampDeg, clampDeg/, 'yaw keeps symmetric legacy clamp');
const helperIndex = index.search(/<script src="js\/camera-look-clamp\.js\?v=[A-Za-z0-9_-]+"><\/script>/);
const gameIndex = index.search(/<script src="game\.js\?v=[A-Za-z0-9_-]+"><\/script>/);
assert.ok(helperIndex >= 0 && gameIndex > helperIndex, 'camera clamp module loads before game.js without depending on controller module versions');

console.log('Directional camera look clamp checks passed.');
