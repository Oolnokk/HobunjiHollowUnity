#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Guards the production full-transform shoulder pin.
const planeSource = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8'); // Guards the exact render-time world-yaw compensation.
assert.match(gameSource,
  /function _applyShoulderPetFinalTransform\(c, finalTransform\)[\s\S]{0,1800}group\.quaternion\.copy\(localQuaternion\)/,
  'shoulder-pet full-transform helper applies the face-relative root quaternion');
assert.match(gameSource,
  /const planeDelta = billboardWorldYaw - finalGroupRotY;[\s\S]{0,300}frontPlane\.rotation\.y = planeDelta \+ Math\.PI \/ 2;[\s\S]{0,180}backPlane\.rotation\.y = planeDelta - Math\.PI \/ 2;/,
  'legacy first-frame planes counter-rotate the final attachment yaw');
assert.match(planeSource,
  /const worldYaw = owner\.pngRot \+ faceYaw;[\s\S]{0,800}parentWorld\.invert\(\)\.multiply\(desiredWorld\)/,
  'render-time shoulder-pet planes preserve their explicit camera-relative world yaw');
assert.match(planeSource,
  /plane\.matrix\.compose\(plane\.position, localWorldCompensated, plane\.scale\)/,
  'render-time billboard compensation preserves the authored plane scale');

console.log('Shoulder-pet billboard-yaw regression checks passed.');
