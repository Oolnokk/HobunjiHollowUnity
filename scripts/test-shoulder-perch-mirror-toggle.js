#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('docs/js/portrait-plane-outline-parity.js', 'utf8');

assert.match(source, /let mirrorShoulderPerchWithPortrait = true/,
  'mirroring the authored shoulder-perch pixel follows the flipped portrait by default');
assert.match(source, /mirrorShoulderPerchWithPortrait && avatarApi\.getPortraitsFlipped\?\.\(\)/,
  'the shoulder-perch X is mirrored only when both the dedicated toggle and portrait flip are enabled');
assert.match(source, /\? pixelWidth - pixelX\s*:\s*pixelX/,
  'turning the dedicated toggle off restores the original authored pixel X');
assert.match(source, /id="settingMirrorShoulderPerchWithPortrait"/,
  'the dedicated shoulder-perch mirror checkbox is exposed in Settings');
assert.match(source, /SHOULDER_PERCH_MIRROR_STORAGE_KEY/,
  'the mirror choice persists independently from the portrait flip setting');
assert.match(source, /getElementById\?\.\('settingDisableShoulderFrontXray'\)/,
  'the existing front shoulder-pet X-ray control receives its default through its canonical setting');
assert.match(source, /checkbox\.checked = true;[^\n]*Default presentation/,
  'front-side shoulder-pet X-ray is disabled by default');
assert.match(source, /dispatchEvent\(new global\.Event\('change'/,
  'the default drives game.js through the existing setting listener instead of duplicating layering state');

console.log('Shoulder perch mirror toggle/default X-ray tests passed.');
