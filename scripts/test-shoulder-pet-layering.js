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
  /function updatePetLayering\(active, pet\)[\s\S]{0,1400}_setLayerDepthWrite\(_playerAvatarFrontMaterial, true\)[\s\S]{0,250}_setLayerDepthWrite\(_playerAvatarBackMaterial, true\)[\s\S]{0,650}_setLayerDepthWrite\(m, true\)/,
  'player and pet keep ordinary depth writes while shoulder-attached');
assert.match(source,
  /depthMode: 'ordinary-depth'[\s\S]{0,180}xrayEnabled: false|xrayEnabled: false[\s\S]{0,180}depthMode: 'ordinary-depth'/,
  'runtime diagnostics identify the ordinary-depth shoulder presentation');
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
console.log('Shoulder-pet ordinary-depth layering checks passed.');
