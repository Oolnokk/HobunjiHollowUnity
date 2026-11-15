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
assert.match(config, /id: 'shoulder-player-over'/);
assert.match(config, /id: 'shoulder-pet-over'/);
assert.match(config, /id: 'shoulder-world-depth'/);
assert.match(config, /default: 'authored'/, 'authored pose is the shipped shoulder-pet default');
for (const id of [
  'settingDisableHatXray', 'settingShoulderPetRotationSource',
  'settingInvertShoulderPetRotationSource', 'settingCancelShoulderPetRotationalOffset',
  'settingFrontSpriteXrayThroughShoulderPet', 'settingBackSpriteXrayThroughShoulderPet',
  'settingDisableShoulderFrontXray', 'settingDisableShoulderBackXray',
]) assert.doesNotMatch(index, new RegExp('id="'+id+'"'), 'retired independent pet control stays absent: '+id);

const start = render.indexOf('  const SHOULDER_PET_RENDER_ORDERS');
const end = render.indexOf('  const maskedHands =', start);
assert.ok(start > 0 && end > start, 'shoulder presentation and stencil setup reside inside HeldObjectRenderOrder');
let mode = 'authored';
const masks = new Set();
let synced = 0;
const windowStub = { HobunjiShoulderSplitLayerParity: { syncAvatar: () => { synced++; } } };
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
  const petSplit = makeMesh('pet_split');
  petSplit.userData.hobunjiShoulderSplitOverlay = true;
  return { __hobunjiShoulderFacingInward: false, avatarRef: {
    group: { userData: {}, children: [petFront, petBack, petSplit] },
    frontPlane: petFront, backPlane: petBack, petSplit,
  } };
};
const pet = makePet();
const use = (companion, viewerSeesFront) => api.setShoulderPetLayering(
  companion, front, back, front.material, back.material, viewerSeesFront);

use(pet, true);
assert.equal(front.material.depthWrite, false, 'active pet disables player front depth writing only by compositor policy');
assert.equal(back.material.depthWrite, false);
assert.equal(pet.avatarRef.frontPlane.material.depthWrite, false);
assert.equal(pet.avatarRef.backPlane.material.depthWrite, false);
assert.equal(front.renderOrder, 8, 'authored outward pose: player appears in front from the front camera');
assert.equal(masks.has(pet.avatarRef.frontPlane), false, 'background pet front cannot hide held gear');
assert.equal(masks.has(pet.avatarRef.backPlane), false, 'background pet back cannot hide held gear');
assert.equal(pet.avatarRef.frontPlane.renderOrder, 6);
assert.equal(pet.avatarRef.group.userData.hobunjiShoulderPetLayering.playerDrawsOnTop, true);
assert.ok(masks.has(front), 'the owner front portrait is explicitly available to stencil even without depth writes');
assert.ok(front.layers.mask & (1 << 24), 'owner front portrait has the dedicated private stencil camera layer');
assert.equal(api.state.mode, 'authored');

use(pet, false);
assert.equal(front.renderOrder, 4, 'rear view reverses the authored shoulder foreground decision');
for (const plane of pet.avatarRef.group.children) {
  assert.equal(masks.has(plane), true, 'foreground pet front/back/split plane joins the player owner stencil');
  assert.equal(plane.userData.hobunjiShoulderPetStencilForeground, true, 'pet foreground mask state is tagged');
  assert.ok(plane.layers.mask & (1 << 24), 'pet source/split card is in private stencil camera layer');
}
pet.__hobunjiShoulderFacingInward = true;
use(pet, false);
assert.equal(front.renderOrder, 8, 'inward pose reverses foreground again');
for (const plane of pet.avatarRef.group.children) {
  assert.equal(masks.has(plane), false, 'background pet no longer masks player gear');
  assert.equal(plane.userData.hobunjiShoulderPetStencilForeground, undefined);
  assert.equal(plane.layers.mask & (1 << 24), 0, 'background pet mask layer cleaned');
}

mode = 'player-over';
api.syncShoulderPetLayering();
assert.equal(front.renderOrder, 8, 'front-of-pet preset overrides camera/pose');
mode = 'pet-over';
api.syncShoulderPetLayering();
assert.equal(front.renderOrder, 4, 'behind-pet preset overrides camera/pose');
assert.equal(masks.has(pet.avatarRef.petSplit), true, 'pet-over preset masks split artwork too');

front.material.depthWrite = true;
front.renderOrder = 91;
api.syncShoulderPetLayering();
assert.equal(front.material.depthWrite, false, 'late actor-depth changes are repaired before the compositor draw');
assert.equal(front.renderOrder, 4, 'late actor draw-order changes are repaired before the compositor draw');

mode = 'world-depth';
api.syncShoulderPetLayering();
assert.equal(front.material.depthWrite, true, 'legacy-depth preset is reproducible');
assert.equal(pet.avatarRef.frontPlane.material.depthWrite, true);
assert.equal(pet.avatarRef.group.userData.hobunjiShoulderPetLayering.depthMode, 'legacy-world-depth');

mode = 'authored';
api.syncShoulderPetLayering();
const replacement = makePet();
use(replacement, true);
assert.equal(pet.avatarRef.frontPlane.material.depthWrite, true, 'replacing pets restores the previous pet material');
assert.equal(pet.avatarRef.frontPlane.renderOrder, 2, 'old pet rejoins normal actor sprite order');
assert.equal(pet.avatarRef.group.userData.hobunjiShoulderPetLayering, undefined, 'removed pet no longer masquerades as player-attached');
assert.equal(masks.has(pet.avatarRef.petSplit), false, 'replaced pet has no stale owner mask');
assert.equal(replacement.avatarRef.frontPlane.material.depthWrite, false);

use(null, false);
assert.equal(front.material.depthWrite, true, 'detaching restores player portrait depth writing');
assert.equal(back.material.depthWrite, true);
assert.equal(front.renderOrder, 2, 'detaching restores ordinary front sprite order');
assert.equal(back.renderOrder, 4, 'detaching restores ordinary rear sprite order');
assert.equal(replacement.avatarRef.frontPlane.material.depthWrite, true, 'detaching restores pet depth');
assert.equal(api.state.active, false);
assert.ok(synced >= 5, 'split shoulder sprites are synchronized whenever policy changes');

console.log('Shoulder pet unified compositor and presets: ok');
