#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const avatarSource = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8'); // Guards the shared front/back portrait texture implementation.
const indexSource = fs.readFileSync('docs/index.html', 'utf8'); // Guards the player-facing checkbox and cache-busted runtime include.

assert.match(avatarSource, /frontOriginal: trackPortraitTexture\([\s\S]{0,240}'front'\)/,
  'the authored front character portrait is registered for horizontal flipping');
assert.match(avatarSource, /backForOriginal: trackPortraitTexture\([\s\S]{0,360}'back'\)/,
  'the authored back character portrait is registered independently for horizontal flipping');
assert.match(avatarSource, /texture\.repeat\.x = portraitsFlipped \? -state\.baseRepeatX : state\.baseRepeatX/,
  'horizontal mirroring uses UVs instead of a negative mesh scale that could reverse face culling');
assert.match(avatarSource, /texture\.offset\.x = portraitsFlipped \? state\.baseOffsetX \+ state\.baseRepeatX : state\.baseOffsetX/,
  'mirrored UVs retain the full portrait rather than sampling outside its image');
assert.match(avatarSource, /for \(const texture of trackedPortraitTextures\) applyPortraitTextureFlip\(texture\)/,
  'changing the setting updates already-spawned PNG character portraits immediately');
assert.match(avatarSource, /localStorage\.setItem\(PORTRAIT_FLIP_STORAGE_KEY, portraitsFlipped \? '1' : '0'\)/,
  'the portrait flip preference persists across sessions');
assert.match(indexSource, /id="settingFlipPngPortraits"/,
  'the Settings panel exposes the PNG portrait flip checkbox');
assert.match(avatarSource, /checkbox\.checked = portraitsFlipped/,
  'the checkbox initializes from the persisted renderer state');
assert.match(avatarSource, /checkbox\.addEventListener\('change', event => setPortraitsFlipped\(event\.target\.checked\)\)/,
  'the checkbox applies its value through the shared PNG avatar renderer');
assert.match(avatarSource, /getPortraitFlipDebugState: \(\) => \(\{ enabled: portraitsFlipped, trackedTextureCount: trackedPortraitTextures\.size \}\)/,
  'the renderer exposes its current state and tracked texture count for in-file diagnostics');

console.log('PNG portrait flip setting tests passed.');
