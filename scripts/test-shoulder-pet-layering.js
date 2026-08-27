#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('docs/game.js', 'utf8'); // Guards the live player/pet depth-order implementation.

assert.match(source,
  /const childMaterials = Array\.isArray\(child\.material\) \? child\.material : \[child\.material\];[\s\S]{0,180}mats\.push\(\.\.\.childMaterials\.filter\(Boolean\)\)/,
  'ordinary-companion depth ranking flattens a skinned portrait material array');
assert.match(source,
  /const _skinnedBodyPlane = avatarGroup\.userData\?\.neckRig\?\.available[\s\S]{0,700}_playerAvatarFrontMaterial = _skinnedBodyMaterials\?\.\[0\][\s\S]{0,220}_playerAvatarBackMaterial = _skinnedBodyMaterials\?\.\[1\]/,
  'player avatar refresh resolves the skinned mesh front/back materials individually');
assert.match(source,
  /const SHOULDER_PET_PLAYER_OCCLUSION_ENABLED = false;/,
  'legacy character-over-pet occlusion remains preserved but disabled by default');

const layeringStart = source.indexOf('let _petLayeringActive = false;'); // Used below to execute the real reconciliation functions in isolation.
const layeringEnd = source.indexOf('function updateCompanions(dt)', layeringStart);
assert.ok(layeringStart >= 0 && layeringEnd > layeringStart, 'shoulder-pet layering implementation is present');
const layeringSource = source.slice(layeringStart, layeringEnd); // Keeps the regression harness tied to production code instead of a copied implementation.

const makeHarness = new Function('initialFront', 'initialBack', 'playerOcclusionEnabled', `
  const PLAYER_FRONT_PLANE_RENDER_ORDER = 2;
  const PLAYER_BACK_PLANE_RENDER_ORDER = 4;
  const LEGACY_SHOULDER_PET_PLANE_RENDER_ORDER = 3;
  const SHOULDER_PET_PLAYER_OCCLUSION_ENABLED = playerOcclusionEnabled;
  const SHOULDER_PET_PLANE_RENDER_ORDER = SHOULDER_PET_PLAYER_OCCLUSION_ENABLED
    ? LEGACY_SHOULDER_PET_PLANE_RENDER_ORDER
    : PLAYER_BACK_PLANE_RENDER_ORDER + 2;
  let _playerAvatarFrontMaterial = initialFront;
  let _playerAvatarBackMaterial = initialBack;
  ${layeringSource}
  return {
    updatePetLayering,
    replacePlayerMaterials(front, back) {
      _playerAvatarFrontMaterial = front;
      _playerAvatarBackMaterial = back;
    },
  };
`);

const material = () => ({ depthWrite: true, needsUpdate: false });
const mesh = () => ({ material: material(), renderOrder: 2 });
const front = material();
const back = material();
const pet = { avatarRef: { frontPlane: mesh(), backPlane: mesh() } };
const harness = makeHarness(front, back, false);

harness.updatePetLayering(true, pet);
assert.equal(front.depthWrite, false, 'default mode disables the real skinned front material depth write');
assert.equal(back.depthWrite, false, 'default mode disables the real skinned back material depth write');
assert.equal(pet.avatarRef.frontPlane.material.depthWrite, false, 'active pet front plane defers depth writes');
assert.equal(pet.avatarRef.backPlane.renderOrder, 6, 'default mode draws the pet after the complete player portrait');

const rebuiltFront = material();
const rebuiltBack = material();
harness.replacePlayerMaterials(rebuiltFront, rebuiltBack);
harness.updatePetLayering(true, pet);
assert.equal(rebuiltFront.depthWrite, false, 'an unchanged active pet repairs a newly rebuilt front material');
assert.equal(rebuiltBack.depthWrite, false, 'an unchanged active pet repairs a newly rebuilt back material');

harness.updatePetLayering(false, null);
assert.equal(rebuiltFront.depthWrite, true, 'detaching the pet restores player depth writes');
assert.equal(pet.avatarRef.frontPlane.material.depthWrite, true, 'detaching the pet restores its own depth writes');
assert.equal(pet.avatarRef.frontPlane.renderOrder, 2, 'detaching the pet restores its ordinary render order');

const legacyFront = material();
const legacyBack = material();
const legacyPet = { avatarRef: { frontPlane: mesh(), backPlane: mesh() } };
const legacyHarness = makeHarness(legacyFront, legacyBack, true);
legacyHarness.updatePetLayering(true, legacyPet);
assert.equal(legacyFront.depthWrite, false, 'legacy mode still lets the pet beat the player front face');
assert.equal(legacyBack.depthWrite, true, 'legacy mode restores only the historical back-player depth occlusion');
assert.equal(legacyPet.avatarRef.frontPlane.renderOrder, 3, 'legacy mode restores front-player < pet < back-player ordering');

console.log('Shoulder-pet skinned-layering regression checks passed.');
