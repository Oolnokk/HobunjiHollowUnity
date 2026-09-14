#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const avatarPreview = read('docs/js/npc-avatar-preview-utils.js');
const hats = read('docs/js/front-hat-head-facing.js');
const hatXray = read('docs/js/hat-xray-head-facing.js');
const loader = read('docs/js/combat/combat-config-loader.js');
const game = read('docs/game.js');
const basicHeadband = JSON.parse(read('docs/config/cosmetics/basic_headband.json'));
const leatherHeadband = JSON.parse(read('docs/config/cosmetics/leather_headband.json'));
const wideKasa = JSON.parse(read('docs/config/cosmetics/riverlandskasa_wide.json'));

const forbiddenAngleBehavior = /TILT_CUTOFF|yawCutoff|tiltCutoff|FacingGate|facingUniform|worldFront|worldUp|toCamera|uprightDot|yawDot|smoothstep\s*\(|hobunjiFrontHatless|material\.opacity\s*=|currentMaterial\.opacity\s*=/i;
assert.doesNotMatch(hats, forbiddenAngleBehavior, 'normal hats have no camera/head-angle visibility system');
assert.doesNotMatch(hatXray, forbiddenAngleBehavior, 'hat x-rays have no camera/head-angle visibility system');
assert.match(hats, /angleVisibility:\s*'disabled'/, 'legacy normal-hat adapter explicitly reports angle visibility disabled');
assert.match(hatXray, /angleVisibility:\s*'disabled'/, 'hat x-ray debug explicitly reports angle visibility disabled');
assert.doesNotMatch(hats, /renderProfileToCanvas|buildSinglePlaneAvatarModel|onBeforeCompile|onBeforeRender/, 'normal-hat compatibility shim installs no rendering hooks');

assert.doesNotMatch(loader, /fine-hood-trim-head-facing\.js/i, 'Fine Hood angle-facing adapter is no longer bootstrapped');
assert.doesNotMatch(
  avatarPreview,
  /FineHoodTrimHeadOn|fineHoodTrimHeadOn|hobunjiFineHoodTrim|finehood-trim-head-on/i,
  'shared avatar preview has no Fine Hood angle-gating or trimless blend path'
);
assert.match(
  avatarPreview,
  /await window\.renderPortraitProfile\(canvas, profile, renderOptions\);\s*return true;/,
  'shared avatar preview renders authored headwear without angle substitution'
);

assert.ok(loader.includes('js/front-hat-head-facing.js'), 'legacy front-hat shim remains loadable without a missing-script request');
assert.ok(loader.includes('js/hat-xray-head-facing.js'), 'hat x-ray coplanar correction remains bootstrapped');
assert.match(game, /freezePlayerAvatarPortraitComposer\(Date\.now\(\)\)/, 'player avatar rebuild freezes one portrait deformation sample');
assert.match(game, /renderProfileToCanvas\(hatlessFrontCanvas, hatlessProfile, staticRenderOptions\)/, 'hatless xray source reuses the full portrait deformation sample');
assert.match(game, /renderProfileToCanvas\(hatlessBackCanvas, hatlessProfile, \{ \.\.\.staticRenderOptions, portraitView: 'behind' \}\)/, 'rear hatless xray source reuses the same deformation sample');

const headLayers = json => Object.keys(json?.parts?.head?.layers || {});
assert.deepEqual(headLayers(basicHeadband), ['front'], 'Basic Headband is authored front-only');
assert.deepEqual(headLayers(leatherHeadband), ['front'], 'Leather Headband is authored front-only');
assert.ok(headLayers(wideKasa).includes('front') && headLayers(wideKasa).includes('back'), 'Riverland Kasa keeps authored front and back art');

console.log('Headwear angle-visibility removal checks passed.');
