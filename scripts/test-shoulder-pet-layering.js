#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('docs/game.js', 'utf8');
const indexSource = fs.readFileSync('docs/index.html', 'utf8');

assert.match(source, /const SHOULDER_PET_XRAY_ENABLED = false/,
  'shoulder-specific x-ray presentation is permanently disabled');
assert.match(source,
  /function setPlayerHatXray\(enabled\)[\s\S]{0,180}enabled = SHOULDER_PET_XRAY_ENABLED && !!enabled/,
  'legacy hat x-ray requests are hard-gated off');
assert.match(source,
  /async function buildPlayerHatXrayOverlay[\s\S]{0,220}if \(!SHOULDER_PET_XRAY_ENABLED\) return/,
  'fresh player avatars never split out a hat x-ray overlay');
assert.doesNotMatch(source, /^\s*buildPlayerHatXrayOverlay\(avatarGroup, profile/m,
  'player avatar refresh no longer invokes the hat x-ray builder');
assert.match(source,
  /function updatePetLayering\(active, pet\)[\s\S]{0,1800}const inwardFrontPose = pet\.__hobunjiShoulderFacingInward === true;[\s\S]{0,500}_setLayerDepthWrite\(_playerAvatarFrontMaterial, false\)[\s\S]{0,220}_setLayerDepthWrite\(_playerAvatarBackMaterial, false\)[\s\S]{0,650}_setLayerDepthWrite\(m, false\)/,
  'attached player and pet keep depth testing but stop writing depth into their intersecting masked cards');
assert.match(source,
  /const viewerSeesPlayerFront = _cameraSeesPlayerFrontFace\(\);[\s\S]{0,240}const playerDrawsOnTop = viewerSeesPlayerFront \? !inwardFrontPose : inwardFrontPose;/,
  'front view keeps the established pose ordering while rear view uses its exact inverse');
assert.match(source,
  /playerDrawsOnTop \? PLAYER_OVER_SHOULDER_PET_RENDER_ORDER : PLAYER_BACK_PLANE_RENDER_ORDER/,
  'the resolved front/back-view ordering still drives one deterministic whole-sprite render layer');
assert.match(source,
  /HobunjiShoulderSplitLayerParity\?\.syncAvatar\?\.\(pet\.avatarRef\)/,
  'split shoulder overlays immediately inherit the base pet depth/render state');
assert.match(source,
  /depthMode: 'whole-sprite-no-depth-write'[\s\S]{0,220}xrayEnabled: false|xrayEnabled: false[\s\S]{0,220}depthMode: 'whole-sprite-no-depth-write'/,
  'runtime diagnostics distinguish stable whole-sprite layering from retired x-rays');
for (const id of [
  'settingDisableHatXray',
  'settingShoulderPetRotationSource',
  'settingInvertShoulderPetRotationSource',
  'settingCancelShoulderPetRotationalOffset',
  'settingFrontSpriteXrayThroughShoulderPet',
  'settingBackSpriteXrayThroughShoulderPet',
  'settingDisableShoulderFrontXray',
  'settingDisableShoulderBackXray',
]) {
  assert.doesNotMatch(indexSource, new RegExp(`id="${id}"`), `${id} is hidden/removed from Settings`);
}
console.log('Shoulder-pet whole-sprite layering checks passed.');
