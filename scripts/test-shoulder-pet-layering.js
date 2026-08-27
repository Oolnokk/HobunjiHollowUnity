#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('docs/game.js', 'utf8'); // Guards the live player/pet depth-order implementation.
const probeSource = fs.readFileSync('docs/js/pixel-probe.js', 'utf8'); // Guards mobile-visible diagnostics for the rear head pass.

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
  const SHOULDER_PET_PLANE_RENDER_ORDER = 6;
  let _playerAvatarFrontMaterial = initialFront;
  let _playerAvatarBackMaterial = initialBack;
  let rearHeadOcclusionEnabled = false;
  function setPlayerRearHeadPetOcclusion(enabled) { rearHeadOcclusionEnabled = !!enabled; }
  ${layeringSource}
  return {
    updatePetLayering,
    isRearHeadOcclusionEnabled: () => rearHeadOcclusionEnabled,
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
assert.equal(harness.isRearHeadOcclusionEnabled(), true, 'attaching any shoulder pet enables the rear head/cosmetic occluder');
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
assert.equal(harness.isRearHeadOcclusionEnabled(), false, 'detaching the shoulder pet hides the rear head/cosmetic occluder');
assert.equal(rebuiltFront.depthWrite, true, 'detaching the pet restores player depth writes');
assert.equal(pet.avatarRef.frontPlane.material.depthWrite, true, 'detaching the pet restores its own depth writes');
assert.equal(pet.avatarRef.frontPlane.renderOrder, 2, 'detaching the pet restores its ordinary render order');

assert.match(source,
  /async function buildPlayerRearHeadPetOcclusionOverlay[\s\S]{0,1800}omitHeadSpriteAndCosmetics: true[\s\S]{0,2600}sourceGroup = skinnedSource\.geometry\.groups\[1\][\s\S]{0,1800}mesh\.renderOrder = SHOULDER_PET_PLANE_RENDER_ORDER \+ 1/,
  'the isolated rear head and head-cosmetic pass renders after the shoulder pet');
assert.match(source,
  /c\.stableRole === 'shoulderPet'[\s\S]{0,260}setPlayerHatXray/,
  'the feature gate is the generic shoulder-pet role rather than a creature species');
assert.doesNotMatch(source.slice(source.indexOf('function updatePetLayering'), source.indexOf('function updateCompanions')), /drenkirra/i,
  'shoulder-pet layering contains no Drenkirra-specific branch');
assert.match(probeSource, /Rear head-over-pet overlay:[\s\S]{0,220}roleGate=all shoulder pets/,
  'Pixel Probe exposes the rear head overlay and its species-agnostic role gate');

console.log('Shoulder-pet skinned-layering regression checks passed.');
