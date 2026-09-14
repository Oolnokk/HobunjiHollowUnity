#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const avatarPreview = read('docs/js/npc-avatar-preview-utils.js');
const hats = read('docs/js/front-hat-head-facing.js');
const loader = read('docs/js/combat/combat-config-loader.js');
const game = read('docs/game.js');
const basicHeadband = JSON.parse(read('docs/config/cosmetics/basic_headband.json'));
const leatherHeadband = JSON.parse(read('docs/config/cosmetics/leather_headband.json'));
const wideKasa = JSON.parse(read('docs/config/cosmetics/riverlandskasa_wide.json'));

assert.ok(hats.includes('yawCutoffDegrees: 90'), 'front hats keep their exact 90-degree camera/head yaw handoff');
assert.ok(hats.includes("transition: 'hard-step'"), 'front hat visibility never fades');
assert.ok(hats.includes('TILT_CUTOFF_DEG = 35'), 'front hats keep the attack/body pitch-roll safety cutoff');
assert.ok(hats.includes('horizontalFront.set(worldFront.x, 0, worldFront.z)'), 'front hat yaw gate ignores pitch/roll');
assert.ok(hats.includes('worldUp.dot(worldVertical)'), 'front hat tilt guard measures the actual rigged head upright basis');
assert.ok(hats.includes('yawDot > 0 && uprightDot >= TILT_CUTOFF_DOT'), 'front hat visibility still requires both hard gates');
assert.doesNotMatch(hats, /smoothstep\s*\(/, 'front hat visibility stays binary');

assert.doesNotMatch(loader, /fine-hood-trim-head-facing\.js/i, 'Fine Hood angle-facing adapter is no longer bootstrapped');
assert.doesNotMatch(
  avatarPreview,
  /FineHoodTrimHeadOn|fineHoodTrimHeadOn|hobunjiFineHoodTrim|finehood-trim-head-on/i,
  'shared avatar preview has no Fine Hood angle-gating or trimless blend path'
);
assert.doesNotMatch(
  hats,
  /stripFineHoodTrim|isFineHoodTrimLayer|finehood.*trim|trim.*finehood/i,
  'hat facing never strips or gates Fine Hood trim'
);
assert.match(
  avatarPreview,
  /await window\.renderPortraitProfile\(canvas, profile, renderOptions\);\s*return true;/,
  'shared avatar preview renders the authored portrait once without Fine Hood angle substitution'
);

assert.ok(loader.includes('js/front-hat-head-facing.js'), 'front hat facing adapter remains bootstrapped');
assert.match(game, /freezePlayerAvatarPortraitComposer\(Date\.now\(\)\)/, 'player avatar rebuild freezes one portrait deformation sample');
assert.match(game, /renderProfileToCanvas\(hatlessFrontCanvas, hatlessProfile, staticRenderOptions\)/, 'hatless xray source reuses the full portrait deformation sample');
assert.match(game, /renderProfileToCanvas\(hatlessBackCanvas, hatlessProfile, \{ \.\.\.staticRenderOptions, portraitView: 'behind' \}\)/, 'rear hatless xray source reuses the same deformation sample');

const headLayers = json => Object.keys(json?.parts?.head?.layers || {});
assert.deepEqual(headLayers(basicHeadband), ['front'], 'Basic Headband is authored front-only');
assert.deepEqual(headLayers(leatherHeadband), ['front'], 'Leather Headband is authored front-only');
assert.ok(headLayers(wideKasa).includes('front') && headLayers(wideKasa).includes('back'), 'Riverland Kasa keeps authored front and back art');

console.log('Front headwear facing checks passed.');
