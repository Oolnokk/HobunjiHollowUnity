#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('docs/js/portrait-plane-outline-parity.js', 'utf8');
const indexSource = fs.readFileSync('docs/index.html', 'utf8');

assert.match(source, /const mirrorShoulderPerchWithPortrait = true/,
  'authored shoulder-perch pixels always follow the flipped portrait');
assert.match(source, /mirrorShoulderPerchWithPortrait && avatarApi\.getPortraitsFlipped\?\.\(\)/,
  'CPU source-pixel mapping still mirrors with the visible portrait');
assert.doesNotMatch(source, /settingMirrorShoulderPerchWithPortrait|SHOULDER_PERCH_MIRROR_STORAGE_KEY/,
  'the old shoulder-perch presentation setting and persistence are removed');
assert.doesNotMatch(indexSource, /settingDisableShoulderFrontXray|settingShoulderPetRotationSource/,
  'the shoulder presentation settings section is no longer in Settings');
console.log('Shoulder perch fixed-mirror/no-settings checks passed.');
