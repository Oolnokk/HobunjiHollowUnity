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

assert.match(config, /"cameraRotateClampDeg": 45,[\s\S]{0,160}"cameraRotateUpClampDeg": 85/, 'global camera config still authors 45 down/yaw and 85 up');
assert.equal(clampPitchOffsetDeg(-120, { cameraRotateClampDeg: 45, cameraRotateUpClampDeg: 85 }), -85, 'camera module independently clamps upward pitch');
assert.equal(clampPitchOffsetDeg(80, { cameraRotateClampDeg: 45, cameraRotateUpClampDeg: 85 }), 45, 'camera module independently clamps downward pitch');
assert.equal(clampPitchOffsetDeg(-30, { cameraRotateClampDeg: 45, cameraRotateUpClampDeg: 85 }), -30, 'camera module preserves in-range pitch');
assert.match(game, /function clampCameraPitchOffsetDeg\(value\) \{[\s\S]{0,180}CameraLookClamp\.clampPitchOffsetDeg\(value, desktopControlsConfig\(\)\)/, 'game.js only bridges camera state into the isolated clamp module');
assert.equal((game.match(/cameraAngleOffsetDeg = clampCameraPitchOffsetDeg\(/g) || []).length, 3, 'mouse, touch, and controller all share the thin camera bridge');
assert.match(game, /cameraAzimuthOffsetDeg = freeRotateCameraActive\(\)[\s\S]{0,260}-clampDeg, clampDeg/, 'yaw keeps symmetric legacy clamp');
const helperIndex = index.indexOf('<script src=\"js/camera-look-clamp.js?v=20260909decouple1\"></script>');
const gameIndex = index.indexOf('<script src=\"game.js?v=20260910controller1\"></script>');
assert.ok(helperIndex >= 0 && gameIndex > helperIndex, 'camera clamp module loads before game.js without depending on controller module versions');

console.log('Directional camera look clamp checks passed.');
