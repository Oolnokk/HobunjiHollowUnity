#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('docs/game.js', 'utf8'); // Guards the production shoulder-pin billboard correction.
const avatarSource = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8'); // Guards the final onBeforeRender matrix that owns the visible shoulder-pet orientation.
const helperStart = source.indexOf('function _applyShoulderPetFinalRotation'); // Used below to execute the real helper rather than a copied implementation.
const helperEnd = source.indexOf('function updateShoulderPetMeshPin()', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'shoulder-pet final-rotation helper is present');

const helperSource = source.slice(helperStart, helperEnd); // Contains only the production helper and its comments.
const applyFinalRotation = new Function(`${helperSource}; return _applyShoulderPetFinalRotation;`)();
assert.match(avatarSource,
  /const behaviorYaw = \(Number\(owner\.shoulderCuriosity\?\.currentFacingYawDeg\) \|\| 0\) \* Math\.PI \/ 180;[\s\S]{0,180}owner\.pngRot \+ behaviorYaw \+ faceYaw/,
  'the render-authoritative shoulder-pet matrix preserves the behavior turnaround');
const plane = () => ({ rotation: { y: 0 } });
const pet = {
  groupRot: 0.35,
  pngRot: -0.42,
  avatarRef: {
    group: { rotation: { y: 0.35 }, scale: { x: 1, y: 0.9, z: 0.9 } },
    frontPlane: plane(),
    backPlane: plane(),
  },
};

const expectedScale = { ...pet.avatarRef.group.scale }; // Used below to prove the fix cannot impersonate a genotype-size change.
for (const finalBodyYaw of [-2.2, -0.6, 0.8, 2.45]) {
  applyFinalRotation(pet, finalBodyYaw);
  const frontWorldYaw = pet.avatarRef.group.rotation.y + pet.avatarRef.frontPlane.rotation.y; // Reconstructs the rendered front-card yaw.
  const backWorldYaw = pet.avatarRef.group.rotation.y + pet.avatarRef.backPlane.rotation.y; // Reconstructs the rendered mirrored-card yaw.
  assert.ok(Math.abs(frontWorldYaw - (pet.pngRot + Math.PI / 2)) < 1e-12, 'front billboard world yaw is invariant across final body yaw');
  assert.ok(Math.abs(backWorldYaw - (pet.pngRot - Math.PI / 2)) < 1e-12, 'back billboard world yaw is invariant across final body yaw');
  assert.deepEqual(pet.avatarRef.group.scale, expectedScale, 'body-yaw correction never changes genotype scale');
}

console.log('Shoulder-pet billboard-yaw regression checks passed.');
