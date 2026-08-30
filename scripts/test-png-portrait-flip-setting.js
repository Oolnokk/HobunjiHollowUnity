#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const avatarSource = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8'); // Guards the shared front/back portrait texture implementation.
const paritySource = fs.readFileSync('docs/js/portrait-plane-outline-parity.js', 'utf8'); // Guards CPU source-pixel skinning parity with Three.js's rendered SkinnedMesh path.
const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Guards dev-only setting visibility and the shoulder-pet hat overlay.
const indexSource = fs.readFileSync('docs/index.html', 'utf8'); // Guards the player-facing checkbox and cache-busted runtime include.
const portraitSource = fs.readFileSync('docs/js/portrait-utils.js', 'utf8'); // Guards cosmetic metadata propagation into runtime profiles.
const frontHatSource = fs.readFileSync('docs/js/front-hat-head-facing.js', 'utf8'); // Guards ordinary headband behavior and auxiliary texture parity.
const previewSource = fs.readFileSync('docs/js/npc-avatar-preview-utils.js', 'utf8'); // Guards alternate Fine Hood composite texture parity.
const attachmentRigSource = fs.readFileSync('docs/config/attachment-rig-profiles.js', 'utf8'); // Guards the authored shoulder-perch pixel handoff into gameplay anchors.
const basicHeadband = JSON.parse(fs.readFileSync('docs/config/cosmetics/basic_headband.json', 'utf8')); // Authored opt-out for the cloth headband.
const leatherHeadband = JSON.parse(fs.readFileSync('docs/config/cosmetics/leather_headband.json', 'utf8')); // Authored opt-out for the leather headband.

const defaultSandbox = { window: {}, localStorage: { getItem: () => null, setItem() {} } }; // Simulates a new player with no saved portrait preference or browser document.
vm.runInNewContext(avatarSource, defaultSandbox, { filename: 'png-plane-avatar.js' });
assert.equal(defaultSandbox.window.PNGPlaneAvatar.getPortraitsFlipped(), true,
  'a new player receives flipped character portraits without changing any setting');
const legacySandbox = { window: {}, localStorage: { getItem: () => '0', setItem() {} } }; // Simulates an explicit developer opt-out retained from an earlier session.
vm.runInNewContext(avatarSource, legacySandbox, { filename: 'png-plane-avatar.js' });
assert.equal(legacySandbox.window.PNGPlaneAvatar.getPortraitsFlipped(), false,
  'the hidden developer comparison remains reversible and persistent');
const nestedPortraitRoot = {
  userData: {
    neckRig: { available: true, skinnedPlane: { isSkinnedMesh: true, skeleton: { bones: [{}] } } },
    sourceCanvas: { width: 256, height: 256 },
    portraitModelWidth: 1,
    portraitModelHeight: 1,
  },
}; // Minimal live PNG-avatar node shape required by the authored source-pixel resolver.
const outerPlayerRoot = {
  userData: {},
  traverse(visitor) { visitor(this); visitor(nestedPortraitRoot); },
}; // Mirrors game.js passing the outer player object rather than the nested PNG avatar node.
assert.equal(legacySandbox.window.PNGPlaneAvatar.resolveSkinnedPortraitRoot(outerPlayerRoot), nestedPortraitRoot,
  'shoulder-pet source-pixel placement resolves the live PNG avatar beneath the outer player root');
const attachmentSandbox = { window: {} }; // Loads authored attachment data without game startup so runtime anchor shape can be verified directly.
vm.runInNewContext(attachmentRigSource, attachmentSandbox, { filename: 'attachment-rig-profiles.js' });
for (const profile of Object.values(attachmentSandbox.window.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters)) {
  const rulePixel = profile?.shoulderPerchRule?.sourcePixel;
  if (!rulePixel) continue;
  assert.deepEqual(profile?.anchors?.shoulderPerch?.sourcePixel, rulePixel,
    `${profile.species}/${profile.gender} shoulder-perch anchor exposes its authored portrait pixel to gameplay`);
}

assert.match(avatarSource, /let portraitsFlipped = true/,
  'horizontal flipping is the default PNG character presentation');
assert.match(avatarSource, /if \(savedPortraitFlip !== null\) portraitsFlipped = savedPortraitFlip !== '0'/,
  'a missing preference keeps the new default while an explicit dev choice remains reversible');

assert.match(avatarSource, /frontOriginal: trackPortraitTexture\([\s\S]{0,240}'front'\)/,
  'the authored front character portrait is registered for horizontal flipping');
assert.match(avatarSource, /backForOriginal: trackPortraitTexture\([\s\S]{0,360}'back'\)/,
  'the authored back character portrait is registered independently for horizontal flipping');
assert.match(avatarSource, /texture\.repeat\.x = portraitsFlipped \? -state\.baseRepeatX : state\.baseRepeatX/,
  'horizontal mirroring uses UVs instead of a negative mesh scale that could reverse face culling');
assert.match(avatarSource, /texture\.offset\.x = portraitsFlipped \? state\.baseOffsetX \+ state\.baseRepeatX : state\.baseOffsetX/,
  'mirrored UVs retain the full portrait rather than sampling outside its image');
assert.match(avatarSource, /const renderedPixelX = portraitsFlipped \? pixelWidth - pixelX : pixelX/,
  'authored portrait landmarks mirror horizontally with the rendered portrait');
assert.match(avatarSource, /-modelWidth \/ 2 \+ \(renderedPixelX \/ pixelWidth\) \* modelWidth/,
  'skinned source-pixel world placement uses the rendered portrait X coordinate');
assert.match(avatarSource, /avatarRoot\?\.traverse\?\.\(candidate =>/,
  'authored source-pixel placement searches below an outer player root for the live PNG portrait rig');
assert.match(paritySource, /const bindPoint = localPoint\.clone\(\)\.applyMatrix4\(skinnedPlane\.bindMatrix\)/,
  'CPU source-pixel skinning enters the same bind space used by the Three.js SkinnedMesh shader');
assert.match(paritySource, /boneMatrix\.fromArray\(skeleton\.boneMatrices, i \* 16\)/,
  'CPU source-pixel skinning consumes the renderer-compatible weighted bone matrices');
assert.match(paritySource, /deformed\.applyMatrix4\(skinnedPlane\.bindMatrixInverse\)/,
  'CPU source-pixel skinning returns from bind space to mesh-local space before world placement');
assert.ok(paritySource.indexOf('deformed.applyMatrix4(skinnedPlane.bindMatrixInverse)') < paritySource.indexOf('skinnedPlane.localToWorld(deformed)'),
  'the skinned shoulder point is mesh-local before localToWorld, preventing the player world transform from being applied twice');
assert.match(attachmentRigSource, /shoulderPerch: \{ \.\.\.identityAnchor\(perch\), sourcePixel: \{ \.\.\.shoulderPerchRule\.sourcePixel \} \}/,
  'the gameplay-facing shoulder-perch anchor carries the same authored pixel used by its rule');
assert.match(avatarSource, /for \(const texture of trackedPortraitTextures\) applyPortraitTextureFlip\(texture\)/,
  'changing the setting updates already-spawned PNG character portraits immediately');
assert.match(avatarSource, /localStorage\.setItem\(PORTRAIT_FLIP_STORAGE_KEY, portraitsFlipped \? '1' : '0'\)/,
  'the portrait flip preference persists across sessions');
assert.match(indexSource, /id="settingFlipPngPortraitsRow" hidden style="display:none"/,
  'the portrait comparison row is hidden before Dev Mode initialization');
assert.ok(indexSource.indexOf('id="settingDevMode"') < indexSource.indexOf('id="settingFlipPngPortraitsRow"'),
  'the portrait comparison setting lives behind the Dev Mode control');
assert.match(gameSource, /settingFlipPngPortraitsRow\.style\.display = s_devMode \? '' : 'none'/,
  'Dev Mode is the only UI path that reveals the portrait comparison setting');
assert.match(avatarSource, /checkbox\.checked = portraitsFlipped/,
  'the checkbox initializes from the persisted renderer state');
assert.match(avatarSource, /checkbox\.addEventListener\('change', event => setPortraitsFlipped\(event\.target\.checked\)\)/,
  'the checkbox applies its value through the shared PNG avatar renderer');
assert.match(avatarSource, /getPortraitFlipDebugState: \(\) => \(\{ enabled: portraitsFlipped, trackedTextureCount: trackedPortraitTextures\.size \}\)/,
  'the renderer exposes its current state and tracked texture count for in-file diagnostics');
assert.match(avatarSource, /if \(typeof document !== 'undefined'\)/,
  'headless avatar tools can load the shared renderer without a browser document');
assert.equal(basicHeadband.specialHeadwearRules, false,
  'the Basic Headband behaves like an ordinary baked head cosmetic');
assert.equal(leatherHeadband.specialHeadwearRules, false,
  'the Leather Headband behaves like an ordinary baked head cosmetic');
assert.match(portraitSource, /specialHeadwearRules = json\.specialHeadwearRules !== false/,
  'headwear special-rule metadata survives cosmetic loading');
assert.match(frontHatSource, /hat\.specialHeadwearRules !== false/,
  'ordinary headbands bypass the front-hat shader substitution rules');
assert.match(gameSource, /hat\.specialHeadwearRules === false/,
  'ordinary headbands bypass shoulder-pet xray extraction and remain in the normal portrait texture');
assert.match(gameSource, /trackPortraitTexture\?\.\(THREE, texture, facingBack \? 'back' : 'front'\)/,
  'special tall-hat xray overlays flip with their matching portrait face');
assert.match(frontHatSource, /trackPortraitTexture\?\.\(THREE, hatlessTexture, 'front'\)/,
  'the front-hat fallback composite cannot jump back to the legacy orientation');
assert.match(previewSource, /trackPortraitTexture\?\.\(THREE, trimlessTexture, 'front'\)/,
  'the Fine Hood fallback composite cannot jump back to the legacy orientation');

console.log('PNG portrait flip setting tests passed.');
