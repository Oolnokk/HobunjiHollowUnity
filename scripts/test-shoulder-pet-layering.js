#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('docs/game.js', 'utf8'); // Guards the live player/pet depth-order implementation.
const probeSource = fs.readFileSync('docs/js/pixel-probe.js', 'utf8'); // Guards mobile-visible diagnostics for directional rear layering and grass depth.
const configSource = fs.readFileSync('docs/config/scratchbones-config.js', 'utf8'); // Guards the authored Splayed Knot behind-view replacement consumed by the full rear canvas.

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
  let rearCharacterOcclusionEnabled = false;
  function setPlayerRearCharacterPetOcclusion(enabled, pet) { rearCharacterOcclusionEnabled = !!enabled && Math.cos((Number(pet?.shoulderCuriosity?.currentFacingYawDeg) || 0) * Math.PI / 180) >= 0; }
  ${layeringSource}
  return {
    updatePetLayering,
    isRearCharacterOcclusionEnabled: () => rearCharacterOcclusionEnabled,
    replacePlayerMaterials(front, back) {
      _playerAvatarFrontMaterial = front;
      _playerAvatarBackMaterial = back;
    },
  };
`);

const material = () => ({ depthWrite: true, depthTest: true, needsUpdate: false });
const mesh = () => ({ material: material(), renderOrder: 2 });
const front = material();
const back = material();
const pet = { shoulderCuriosity: { currentFacingYawDeg: 0 }, avatarRef: { frontPlane: mesh(), backPlane: mesh() } };
const harness = makeHarness(front, back);

harness.updatePetLayering(true, pet);
assert.equal(harness.isRearCharacterOcclusionEnabled(), true, 'character-left facing enables the full rear character occluder');
assert.equal(front.depthWrite, false, 'active pet disables the real skinned front material depth write');
assert.equal(back.depthWrite, false, 'active pet disables the real skinned back material depth write');
assert.equal(pet.avatarRef.frontPlane.material.depthWrite, false, 'active pet front plane defers depth writes');
assert.equal(pet.avatarRef.frontPlane.material.depthTest, true, 'active pet still depth-tests against billboard grass and other world geometry');
assert.equal(pet.avatarRef.backPlane.renderOrder, 6, 'active pet draws after the player portrait');

const rebuiltFront = material();
const rebuiltBack = material();
harness.replacePlayerMaterials(rebuiltFront, rebuiltBack);
harness.updatePetLayering(true, pet);
assert.equal(rebuiltFront.depthWrite, false, 'an unchanged active pet repairs a newly rebuilt front material');
assert.equal(rebuiltBack.depthWrite, false, 'an unchanged active pet repairs a newly rebuilt back material');

pet.shoulderCuriosity.currentFacingYawDeg = 180;
harness.updatePetLayering(true, pet);
assert.equal(harness.isRearCharacterOcclusionEnabled(), false, 'character-right facing lets the pet occlude the rear hood');

harness.updatePetLayering(false, null);
assert.equal(harness.isRearCharacterOcclusionEnabled(), false, 'detaching the shoulder pet hides the directional rear character occluder');
assert.equal(rebuiltFront.depthWrite, true, 'detaching the pet restores player depth writes');
assert.equal(pet.avatarRef.frontPlane.material.depthWrite, true, 'detaching the pet restores its own depth writes');
assert.equal(pet.avatarRef.frontPlane.renderOrder, 2, 'detaching the pet restores its ordinary render order');

assert.match(source,
  /function buildPlayerRearCharacterPetOcclusionOverlay[\s\S]{0,1200}makeVariantCanvas\(backCanvas, \{ flipX: true \}\)[\s\S]{0,1600}sourceGroup = skinnedSource\.geometry\.groups\[1\][\s\S]{0,1800}mesh\.renderOrder = SHOULDER_PET_PLANE_RENDER_ORDER \+ 1/,
  'the complete rear portrait, including Splayed Knot appearance art, can render after the shoulder pet');
assert.match(configSource, /"idIncludes": \["splayedknot"\][\s\S]{0,120}"url": "cosmetics\/appearance\/shared\/splayedknot-behind\.png"/,
  'the full rear portrait resolves the authored Splayed Knot behind-view sprite');
assert.match(source,
  /const facesCharacterLeft = Math\.cos\(facingYawDeg \* Math\.PI \/ 180\) >= 0;[\s\S]{0,180}overlay\.mesh\.visible = !!enabled && facesCharacterLeft/,
  'rear occlusion swaps at the turnaround midpoint according to character-relative facing');
assert.match(source,
  /function _enforceShoulderPetGrassDepth[\s\S]{0,360}grassBillboardMat\.depthTest = true[\s\S]{0,180}grassBillboardMat\.depthWrite = true/,
  'billboard grass retains a real depth barrier while shoulder-pet x-ray is active');
assert.match(source,
  /c\.stableRole === 'shoulderPet'[\s\S]{0,260}setPlayerHatXray/,
  'the feature gate is the generic shoulder-pet role rather than a creature species');
assert.doesNotMatch(source.slice(source.indexOf('function updatePetLayering'), source.indexOf('function updateCompanions')), /drenkirra/i,
  'shoulder-pet layering contains no Drenkirra-specific branch');
assert.match(probeSource, /Directional rear character-over-pet overlay:[\s\S]{0,300}roleGate=all shoulder pets/,
  'Pixel Probe exposes directional rear layering and its species-agnostic role gate');

console.log('Shoulder-pet skinned-layering regression checks passed.');
