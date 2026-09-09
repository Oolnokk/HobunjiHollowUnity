#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const config = fs.readFileSync('docs/config/scratchbones-config.js', 'utf8');
const game = fs.readFileSync('docs/game.js', 'utf8');
const index = fs.readFileSync('docs/index.html', 'utf8');

assert.match(config, /\"cameraRotateClampDeg\": 45,[\s\S]{0,160}\"cameraRotateUpClampDeg\": 85/, 'config authors 45 down/yaw and 85 up');
assert.match(game, /function clampCameraPitchOffsetDeg\(value\)[\s\S]{0,700}cameraRotateUpClampDeg[\s\S]{0,300}-upClampDeg, downClampDeg/, 'shared helper applies directional pitch bounds');
assert.equal((game.match(/cameraAngleOffsetDeg = clampCameraPitchOffsetDeg\(/g) || []).length, 3, 'mouse, touch, and controller all use shared pitch clamp');
assert.match(game, /cameraAzimuthOffsetDeg = freeRotateCameraActive\(\)[\s\S]{0,260}-clampDeg, clampDeg/, 'yaw keeps symmetric legacy clamp');
assert.match(index, /game\.js\?v=20260909lookclamp1/, 'game cache key is bumped');

console.log('Directional camera look clamp checks passed.');
