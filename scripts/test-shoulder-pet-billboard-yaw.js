#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const attachmentSource = fs.readFileSync('docs/js/shoulder-pet-attachment-runtime.js', 'utf8'); // Guards the production pin now owned by the feature module.
const planeSource = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8'); // Guards the exact render-time world-yaw compensation.
assert.match(attachmentSource,
  /function _applyShoulderPetFinalTransform\(c, finalTransform\)[\s\S]{0,1800}group\.quaternion\.copy\(localQuaternion\)/,
  'shoulder-pet full-transform helper applies the face-relative root quaternion');
assert.match(attachmentSource,
  /const setCanonicalPlaneRotation = \(plane, y\) => \{[\s\S]{0,200}plane\.rotation\.set\(0, y, 0\);/,
  'the same canonical plane-angle helper is reused for attachment and detachment');
assert.match(attachmentSource,
  /setCanonicalPlaneRotation\(c\.avatarRef\.frontPlane, -Math\.PI \/ 2\);[\s\S]{0,120}setCanonicalPlaneRotation\(c\.avatarRef\.backPlane, Math\.PI \/ 2\);/,

  'shoulder attachment reverses its front/back image-plane normals without changing the grip-pinned root');
assert.match(attachmentSource,
  /function restoreDetachedAvatar\(avatar\)[\s\S]{0,200}setCanonicalPlaneRotation\(avatar\.frontPlane, Math\.PI \/ 2\);[\s\S]{0,120}setCanonicalPlaneRotation\(avatar\.backPlane, -Math\.PI \/ 2\);/,
  'unshouldering restores the original animal sprite directions');
assert.match(planeSource,
  /const worldYaw = owner\.pngRot \+ faceYaw;[\s\S]{0,800}parentWorld\.invert\(\)\.multiply\(desiredWorld\)/,
  'render-time shoulder-pet planes preserve their explicit camera-relative world yaw');
assert.match(planeSource,
  /plane\.matrix\.compose\(plane\.position, localWorldCompensated, plane\.scale\)/,
  'render-time billboard compensation preserves the authored plane scale');

console.log('Shoulder-pet billboard-yaw regression checks passed.');
