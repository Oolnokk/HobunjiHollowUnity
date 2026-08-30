#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const fineHood = read('docs/js/fine-hood-trim-head-facing.js');
const hats = read('docs/js/front-hat-head-facing.js');
const portraitUtils = read('docs/js/portrait-utils.js');
const pngAvatar = read('docs/js/png-plane-avatar.js');
const loader = read('docs/js/combat/combat-config-loader.js');
const game = read('docs/game.js');
const basicHeadband = JSON.parse(read('docs/config/cosmetics/basic_headband.json'));
const leatherHeadband = JSON.parse(read('docs/config/cosmetics/leather_headband.json'));
const wideKasa = JSON.parse(read('docs/config/cosmetics/riverlandskasa_wide.json'));

for (const source of [fineHood, hats]) {
  assert.ok(source.includes('yawCutoffDegrees: 90'), 'camera/head yaw handoff stays exactly at 90 degrees');
  assert.ok(source.includes("transition: 'hard-step'"), 'headwear visibility never fades');
  assert.ok(source.includes('TILT_CUTOFF_DEG = 35'), 'attack/body pitch-roll safety cutoff remains 35 degrees');
  assert.ok(source.includes('horizontalFront.set(worldFront.x, 0, worldFront.z)'), 'yaw gate ignores pitch/roll');
  assert.ok(source.includes('worldUp.dot(worldVertical)'), 'tilt guard measures the actual rigged head upright basis');
  assert.ok(source.includes('yawDot > 0 && uprightDot >= TILT_CUTOFF_DOT'), 'visibility requires both the hard 90 yaw gate and safe attack tilt');
  assert.doesNotMatch(source, /smoothstep\s*\(/, 'runtime headwear-facing adapters do not fade');
}

assert.ok(loader.includes('js/fine-hood-trim-head-facing.js'), 'Fine Hood facing adapter is bootstrapped');
assert.ok(loader.includes('js/front-hat-head-facing.js'), 'front hat facing adapter is bootstrapped');
assert.match(game, /freezePlayerAvatarPortraitComposer\(Date\.now\(\)\)/, 'player avatar rebuild freezes one portrait deformation sample');
assert.match(game, /renderProfileToCanvas\(hatlessFrontCanvas, hatlessProfile, staticRenderOptions\)/, 'hatless xray source reuses the full portrait deformation sample');
assert.match(game, /renderProfileToCanvas\(hatlessBackCanvas, hatlessProfile, \{ \.\.\.staticRenderOptions, portraitView: 'behind' \}\)/, 'rear hatless xray source reuses the same deformation sample');
assert.match(portraitUtils, /const blinkIdentity = renderOptions\?\.blinkId \?\? seatId;/, 'player and NPC seats receive independent blink identities');
assert.match(portraitUtils, /shouldRenderBlink\(headUrl, nowMs, blinkIdentity\)/, 'live portrait renders advance their own blink clock');
assert.match(pngAvatar, /'hobunjiFineHoodTrimlessTexture', '__hobunjiFineHoodTrimlessCanvas'/, 'live refresh updates the Fine Hood companion face texture');
assert.match(pngAvatar, /'hobunjiFrontHatlessTexture', '__hobunjiFrontHatlessCanvas'/, 'live refresh updates the front-hat companion face texture');
assert.match(game, /if \(composer\) liveRenderOptions\.breathingComposer = composer;/, 'world blinking remains active without the optional breathing composer');

const headLayers = json => Object.keys(json?.parts?.head?.layers || {});
assert.deepEqual(headLayers(basicHeadband), ['front'], 'Basic Headband is authored front-only');
assert.deepEqual(headLayers(leatherHeadband), ['front'], 'Leather Headband is authored front-only');
assert.ok(headLayers(wideKasa).includes('front') && headLayers(wideKasa).includes('back'), 'Riverland Kasa keeps authored front and back art');

console.log('Front headwear facing checks passed.');
