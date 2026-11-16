#!/usr/bin/env node
'use strict';

// Exercises production compositor policy without WebGL. Render-list and GPU masking
// receive separate source guards because this fixture has no framebuffer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const game = fs.readFileSync('docs/game.js', 'utf8');
const render = fs.readFileSync('docs/js/held-object-render-order.js', 'utf8');
const config = fs.readFileSync('docs/js/xray-hierarchy.js', 'utf8');
const index = fs.readFileSync('docs/index.html', 'utf8');

assert.match(game, /const SHOULDER_PET_XRAY_ENABLED = false/, 'retired pet-specific x-ray remains off');
assert.match(game, /function updatePetLayering\(active, pet\)[\s\S]*?HeldObjectRenderOrder\?\.setShoulderPetLayering\?\.\(/,
  'gameplay delegates player/pet visual decisions to the shared compositor');
assert.doesNotMatch(game, /function _setLayerDepthWrite\(/, 'gameplay no longer writes shoulder-pet depth independently');
assert.doesNotMatch(game, /function _setPlayerBodyRenderOrder\(/, 'gameplay no longer reorders shoulder-pet portraits independently');
assert.match(render, /if \(isBaseWorldPass\(scene, camera\)\) syncShoulderPetLayering\(\)/,
  'the compositor restores its shared policy immediately before a real world draw');
assert.match(render, /const needsOwnerMask = lastBaseStencilBits >= 8 && held\.some\(isPortraitMaskedGear\)/,
  'held owners still receive front-art masks in scenes with no nearby ground/water');
assert.match(render, /frontPortraitMaskReason: lastFrontPortraitMaskReason/,
  'mobile diagnostics explain zero eligible/masked gear rather than silently reporting 0\/0');
assert.doesNotMatch(config, /'shoulderPet\\.presentation':\\s*\\{/, 'no independent pet x-ray mode');
assert.doesNotMatch(game, /_cameraSeesPlayerFrontFace/, 'camera side never decides pet occlusion');
for (const id of [
  'settingDisableHatXray', 'settingShoulderPetRotationSource',
  'settingInvertShoulderPetRotationSource', 'settingCancelShoulderPetRotationalOffset',
  'settingFrontSpriteXrayThroughShoulderPet', 'settingBackSpriteXrayThroughShoulderPet',
  'settingDisableShoulderFrontXray', 'settingDisableShoulderBackXray',
]) assert.doesNotMatch(index, new RegExp('id="'+id+'"'), 'retired independent pet control stays absent: '+id);

const start = render.indexOf('  const SHOULDER_PET_RENDER_ORDERS');
const end = render.indexOf('  const maskedHands =', start);
assert.ok(start > 0 && end > start, 'shoulder presentation and stencil setup reside inside HeldObjectRenderOrder');
let mode = 'unused';
const masks = new Set();
let synced = 0;
const windowStub = { HobunjiShoulderSplitLayerParity: { syncAvatar(avatar) { synced++; for (const split of avatar?.group?.children || []) { if (!split.userData?.hobunjiShoulderSplitOverlay) continue; const source = split.userData.hobunjiPlaneFace === 'front' ? avatar.frontPlane : avatar.backPlane; split.renderOrder = source.renderOrder + 0.01; split.material.depthWrite = source.material.depthWrite; } } } };
const registry = { has: mesh => masks.has(mesh), add: mesh => masks.add(mesh), delete: mesh => masks.delete(mesh) };
const api = new Function('window', 'forEachMaterial', 'xrayRule', 'isFrontPortraitMesh',
  'hasLayer', 'frontPortraitRegistry', 'FRONT_PORTRAIT_MASK_LAYER',
  render.slice(start, end) +
  '\nreturn { setShoulderPetLayering, syncShoulderPetLayering, orders: SHOULDER_PET_RENDER_ORDERS, get state() { return lastShoulderPetDecision; } };')(
    windowStub,
    (material, fn) => { for (const entry of Array.isArray(material) ? material : [material]) if (entry) fn(entry); },
    key => key === 'shoulderPet.presentation' ? mode : null,
    mesh => mesh?.name === 'player_avatar_front_plane',
    (mesh, layer) => !!(mesh.layers.mask & (1 << layer)),
    registry, 24,
  );
const makeMesh = name => ({
  name, isMesh: true, renderOrder: 2, material: { depthWrite: true },
  layers: { mask: 1, enable(layer) { this.mask |= 1 << layer; }, disable(layer) { this.mask &= ~(1 << layer); } },
  userData: {},
});
const front = makeMesh('player_avatar_front_plane');
const back = makeMesh('player_avatar_back_plane');
const makePet = () => {
  const petFront = makeMesh('pet_front');
  const petBack = makeMesh('pet_back');
  const splitFront = makeMesh('pet_split_front');
  const splitBack = makeMesh('pet_split_back');
  splitFront.userData = { hobunjiShoulderSplitOverlay: true, hobunjiPlaneFace: 'front' };
  splitBack.userData = { hobunjiShoulderSplitOverlay: true, hobunjiPlaneFace: 'back' };
  return { __hobunjiShoulderFacingInward: false, avatarRef: {
    group: { userData: {}, children: [petFront, petBack, splitFront, splitBack] },
    frontPlane: petFront, backPlane: petBack, splitFront, splitBack,
  } };
};
const pet = makePet();
const use = (companion, viewerSeesFront) => api.setShoulderPetLayering(
  companion, front, back, front.material, back.material, viewerSeesFront);

function testFacing(inward) {
  pet.__hobunjiShoulderFacingInward = inward;
  use(pet, true);
  const a = pet.avatarRef;
  assert.equal(front.renderOrder, api.orders.front, 'owner front order remains authoritative');
  assert.equal(back.renderOrder, api.orders.back, 'owner back order remains authoritative');
  for (const material of [front.material, back.material, a.frontPlane.material, a.backPlane.material]) {
    assert.equal(material.depthWrite, false, 'attached owner/pet remain depth-write-free');
  }
  assert.equal(a.frontPlane.renderOrder, inward ? api.orders.frontAbove : api.orders.frontBehind);
  assert.equal(a.backPlane.renderOrder, inward ? api.orders.backBehind : api.orders.backAbove);
  assert.equal(a.frontPlane.renderOrder > front.renderOrder, inward, 'front plane swaps across owner front');
  assert.equal(a.backPlane.renderOrder > back.renderOrder, !inward, 'back plane swaps across owner back');
  assert.equal(a.splitFront.renderOrder, a.frontPlane.renderOrder + 0.01, 'split front inherits front stage');
  assert.equal(a.splitBack.renderOrder, a.backPlane.renderOrder + 0.01, 'split back inherits back stage');
  assert.equal(a.splitFront.userData.hobunjiShoulderPortraitFace, 'front', 'split front inherits manual-sort portrait category');
  assert.equal(a.splitBack.userData.hobunjiShoulderPortraitFace, 'back', 'split back inherits manual-sort portrait category');
  assert.equal(a.frontPlane.userData.hobunjiShoulderPortraitFace, 'front');
  assert.equal(a.backPlane.userData.hobunjiShoulderPortraitFace, 'back');
  for (const [mesh, shouldMask] of [
    [a.frontPlane, inward], [a.splitFront, inward],
    [a.backPlane, !inward], [a.splitBack, !inward],
  ]) {
    assert.equal(masks.has(mesh), shouldMask, 'only the above-owner face joins the held stencil');
    assert.equal(mesh.userData.hobunjiShoulderPetStencilForeground === true, shouldMask);
  }
  assert.equal(api.state.mode, 'owner-portrait-stages');
  assert.equal(api.state.frontForeground, inward);
  assert.equal(api.state.backForeground, !inward);
  assert.equal(a.group.userData.hobunjiShoulderPetLayering.xrayEnabled, false);
  assert.ok(masks.has(front), 'owner front portrait remains eligible for the private stencil');
}
// Manual ordering must not classify a rear split as a front sprite merely
// because a skinned helper material happens to have a front-material name.
const layerStart = render.indexOf('  function visualLayerFor(');
const layerEnd = render.indexOf('  function protectedDrawPhase(', layerStart);
assert.ok(layerStart >= 0 && layerEnd > layerStart);
const visualLayerFor = new Function('isPresentationBackdrop', 'heldPriorityLayer', 'surfaceKindForObject',
  render.slice(layerStart, layerEnd) + '\\nreturn visualLayerFor;')(
    () => false, () => 'actor.hands', () => 'solid');
assert.equal(visualLayerFor({object: {name:'split',userData:{hobunjiShoulderPortraitFace:'front'}},
  material: {name:'avatar_skinned_back_material'}}), 'actor.front');
assert.equal(visualLayerFor({object: {name:'split',userData:{hobunjiShoulderPortraitFace:'back'}},
  material: {name:'avatar_skinned_front_material'}}), 'actor.rear');

testFacing(false);
testFacing(true);
use(pet, false);
assert.equal(pet.avatarRef.frontPlane.renderOrder, api.orders.frontAbove, 'camera side must not flip the pose');
assert.equal(pet.avatarRef.backPlane.renderOrder, api.orders.backBehind);
testFacing(false);

front.material.depthWrite = true;
front.renderOrder = 91;
api.syncShoulderPetLayering();
assert.equal(front.material.depthWrite, false, 'late depth-write changes are repaired before draw');
assert.equal(front.renderOrder, api.orders.front, 'owner front priority is restored before draw');

const replacement = makePet();
use(replacement, true);
assert.equal(pet.avatarRef.frontPlane.material.depthWrite, true, 'old pet depth restored');
assert.equal(pet.avatarRef.frontPlane.renderOrder, api.orders.front, 'old pet joins regular actor sort');
assert.equal(pet.avatarRef.frontPlane.userData.hobunjiShoulderPortraitFace, undefined);
assert.equal(pet.avatarRef.group.userData.hobunjiShoulderPetLayering, undefined);
assert.equal(masks.has(pet.avatarRef.backPlane), false, 'old pet cannot mask owner tools');
assert.equal(masks.has(replacement.avatarRef.backPlane), true, 'new outward pet masks only its back');

use(null, false);
assert.equal(front.material.depthWrite, true, 'detaching restores owner front depth');
assert.equal(back.material.depthWrite, true, 'detaching restores owner back depth');
assert.equal(front.renderOrder, api.orders.front);
assert.equal(back.renderOrder, api.orders.back);
assert.equal(replacement.avatarRef.frontPlane.material.depthWrite, true);
assert.equal(replacement.avatarRef.group.userData.hobunjiShoulderPetLayering, undefined);
assert.equal(masks.has(replacement.avatarRef.backPlane), false);
assert.equal(api.state.active, false);
assert.ok(synced >= 5, 'split sprites synchronized on swaps and detachment');

console.log('Shoulder pet paired front/back occlusion: ok');
