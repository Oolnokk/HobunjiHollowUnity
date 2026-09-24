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

const layeringStart = source.indexOf('let _petLayeringActive = false;'); // Used below to execute the real reconciliation functions in isolation.
const layeringEnd = source.indexOf('function updateCompanions(dt)', layeringStart);
assert.ok(layeringStart >= 0 && layeringEnd > layeringStart, 'shoulder-pet layering implementation is present');
const layeringSource = source.slice(layeringStart, layeringEnd); // Keeps the regression harness tied to production code instead of a copied implementation.

const makeHarness = new Function('initialFront', 'initialBack', `
  const PLAYER_FRONT_PLANE_RENDER_ORDER = 2;
  const PLAYER_BACK_PLANE_RENDER_ORDER = 4;
  const SHOULDER_PET_PLANE_RENDER_ORDER = 6;
  const PLAYER_OVER_SHOULDER_PET_RENDER_ORDER = 8;
  const SHOULDER_PET_LAYER_FACE_HYSTERESIS = 0.1;
  const makeVec = () => ({ x: 0, y: 0, z: 0, copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; } });
  const _shoulderPetLayerPlayerWorld = makeVec();
  const _shoulderPetLayerCameraWorld = makeVec();
  let _shoulderPetLayerFrontVisible = null;
  let _shoulderPetLayerDecision = null;
  let facingAngle = Math.PI / 2;
  const playerMesh = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { y: 0 },
    updateWorldMatrix() {},
    getWorldPosition(out) { return out.copy(this.position); },
  };
  const camera = {
    position: { x: 0, y: 4, z: 10 },
    updateWorldMatrix() {},
    getWorldPosition(out) { return out.copy(this.position); },
  };
  let _playerAvatarFrontMaterial = initialFront;
  let _playerAvatarBackMaterial = initialBack;
  let _playerAvatarFrontMesh = null;
  let _playerAvatarBackMesh = null;
  let s_disableShoulderFrontXray = false;
  let s_disableShoulderBackXray = false;
  let s_frontSpriteXrayThroughShoulderPet = false;
  let s_backSpriteXrayThroughShoulderPet = false;
  ${layeringSource}
  return {
    updatePetLayering,
    cameraSeesFront: _cameraSeesPlayerFrontFace,
    resetLayerFace() { _shoulderPetLayerFrontVisible = null; },
    setFacingAngle(value) { facingAngle = value; },
    setRenderedYaw(value) { playerMesh.rotation.y = value; },
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

harness.resetLayerFace();
harness.setFacingAngle(Math.PI / 2);
harness.setRenderedYaw(Math.PI);
assert.equal(harness.cameraSeesFront(), true, 'portrait render-yaw snaps cannot turn a logically front-facing player into the back layer');
harness.setFacingAngle(-Math.PI / 2);
assert.equal(harness.cameraSeesFront(), false, 'layer side changes when the unclamped logical player facing actually crosses behind the camera');
harness.resetLayerFace();
harness.setFacingAngle(Math.PI / 2);
harness.setRenderedYaw(0);

harness.updatePetLayering(true, pet);
assert.equal(front.depthWrite, false, 'active pet disables the real skinned front material depth write');
assert.equal(back.depthWrite, false, 'active pet disables the real skinned back material depth write');
assert.equal(pet.avatarRef.frontPlane.material.depthWrite, false, 'active pet front plane defers depth writes');
assert.equal(pet.avatarRef.backPlane.renderOrder, 6, 'active pet draws after the player portrait');

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

console.log('Shoulder-pet skinned-layering regression checks passed.');
