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
  /const setCanonicalPlaneRotation = \(plane, y\) => \{[\s\S]{0,200}plane\.rotation\.set\(0, y, 0\);[\s\S]{0,300}setCanonicalPlaneRotation\(c\.avatarRef\.frontPlane, Math\.PI \/ 2\);[\s\S]{0,120}setCanonicalPlaneRotation\(c\.avatarRef\.backPlane, -Math\.PI \/ 2\);/,
  'final-transform attachment restores the canonical mirrored plane rotations');
assert.match(planeSource,
  /const worldYaw = owner\.pngRot \+ faceYaw;[\s\S]{0,800}parentWorld\.invert\(\)\.multiply\(desiredWorld\)/,
  'render-time shoulder-pet planes preserve their explicit camera-relative world yaw');
assert.match(planeSource,
  /plane\.matrix\.compose\(plane\.position, localWorldCompensated, plane\.scale\)/,
  'render-time billboard compensation preserves the authored plane scale');

console.log('Shoulder-pet billboard-yaw regression checks passed.');
