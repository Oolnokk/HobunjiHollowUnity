#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('docs/game.js', 'utf8'); // Guards the live player/pet depth-order implementation.
const probeSource = fs.readFileSync('docs/js/pixel-probe.js', 'utf8'); // Guards the mobile-visible back-plane diagnostic added with this rule.

assert.match(source,
  /const childMaterials = Array\.isArray\(child\.material\) \? child\.material : \[child\.material\];[\s\S]{0,180}mats\.push\(\.\.\.childMaterials\.filter\(Boolean\)\)/,
  'ordinary-companion depth ranking flattens a skinned portrait material array');
assert.match(source,
  /const _skinnedBodyPlane = avatarGroup\.userData\?\.neckRig\?\.available[\s\S]{0,700}_playerAvatarFrontMaterial = _skinnedBodyMaterials\?\.\[0\][\s\S]{0,220}_playerAvatarBackMaterial = _skinnedBodyMaterials\?\.\[1\]/,
  'player avatar refresh resolves the skinned mesh front/back materials individually');
assert.match(source, /getPlayerAvatarBackMaterial: \(\) => _playerAvatarBackMaterial/,
  'Pixel Probe registration exposes the back portrait material');
assert.match(probeSource, /\['player back plane', 'depthWrite', true, _playerAvatarBackMaterial\.depthWrite\]/,
  'Pixel Probe reports if the back portrait stops occluding the shoulder pet');
assert.match(source,
  /function _buildPlayerBackPetOcclusionOverlay[\s\S]{0,2800}geometry\.addGroup\(sourceGroup\.start, sourceGroup\.count, 0\)[\s\S]{0,700}mesh\.renderOrder = PLAYER_BACK_PLANE_RENDER_ORDER[\s\S]{0,500}hobunjiShoulderPetBackOcclusionReplay = true/,
  'skinned avatars replay only their rear geometry after the shoulder pet');
assert.match(source,
  /child\.userData\?\.hobunjiShoulderPetBackOcclusionReplay/,
  'the back replay stays outside ordinary companion depth arbitration');
assert.match(probeSource, /\['player back-over-pet replay', 'present', true/,
  'Pixel Probe detects a missing skinned back replay');

const layeringStart = source.indexOf('let _petLayeringActive = false;'); // Used below to execute the real reconciliation functions in isolation.
const layeringEnd = source.indexOf('function updateCompanions(dt)', layeringStart);
assert.ok(layeringStart >= 0 && layeringEnd > layeringStart, 'shoulder-pet layering implementation is present');
const layeringSource = source.slice(layeringStart, layeringEnd); // Keeps the regression harness tied to production code instead of a copied implementation.

const makeHarness = new Function('initialFront', 'initialBack', `
  const PLAYER_FRONT_PLANE_RENDER_ORDER = 2;
  const SHOULDER_PET_PLANE_RENDER_ORDER = 3;
  let _playerAvatarFrontMaterial = initialFront;
  let _playerAvatarBackMaterial = initialBack;
  let backReplayEnabled = false;
  function setPlayerBackPetOcclusion(enabled) { backReplayEnabled = !!enabled; }
  ${layeringSource}
  return {
    updatePetLayering,
    isBackReplayEnabled: () => backReplayEnabled,
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
const harness = makeHarness(front, back);

harness.updatePetLayering(true, pet);
assert.equal(harness.isBackReplayEnabled(), true, 'attaching a shoulder pet enables the skinned back replay');
assert.equal(front.depthWrite, false, 'active pet disables the real skinned front material depth write');
assert.equal(back.depthWrite, true, 'active pet leaves the real skinned back material able to occlude it');
assert.equal(pet.avatarRef.frontPlane.material.depthWrite, false, 'active pet front plane defers depth writes');
assert.equal(pet.avatarRef.backPlane.renderOrder, 3, 'active pet draws after the front portrait but below the rigid back portrait');

const rebuiltFront = material();
const rebuiltBack = material();
harness.replacePlayerMaterials(rebuiltFront, rebuiltBack);
harness.updatePetLayering(true, pet);
assert.equal(rebuiltFront.depthWrite, false, 'an unchanged active pet repairs a newly rebuilt front material');
assert.equal(rebuiltBack.depthWrite, true, 'an unchanged active pet preserves a newly rebuilt back material depth write');

harness.updatePetLayering(false, null);
assert.equal(harness.isBackReplayEnabled(), false, 'detaching a shoulder pet hides the skinned back replay');
assert.equal(rebuiltFront.depthWrite, true, 'detaching the pet restores player depth writes');
assert.equal(pet.avatarRef.frontPlane.material.depthWrite, true, 'detaching the pet restores its own depth writes');
assert.equal(pet.avatarRef.frontPlane.renderOrder, 2, 'detaching the pet restores its ordinary render order');

console.log('Shoulder-pet skinned-layering regression checks passed.');
