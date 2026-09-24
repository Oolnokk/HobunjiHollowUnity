#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('docs/js/portrait-plane-outline-parity.js', 'utf8');
const gameSource = fs.readFileSync('docs/game.js', 'utf8');
const rigSource = fs.readFileSync('docs/config/attachment-rig-profiles.js', 'utf8');

assert.match(source, /let mirrorShoulderPerchWithPortrait = true/,
  'mirroring the authored shoulder-perch pixel follows the flipped portrait by default');
assert.match(source, /function isShoulderPetPortraitMirrorActive\(\)[\s\S]{0,180}mirrorShoulderPerchWithPortrait && avatarApi\.getPortraitsFlipped\?\.\(\) === true/,
  'one shared predicate enables shoulder-pet mirroring only when both the dedicated toggle and portrait flip are enabled');
assert.match(source, /const renderedPixelX = isShoulderPetPortraitMirrorActive\(\)/,
  'the authored shoulder-perch X consumes the shared full-presentation mirror state');
assert.match(source, /\? pixelWidth - pixelX\s*:\s*pixelX/,
  'turning the dedicated toggle off restores the original authored pixel X');
assert.match(source, /id="settingMirrorShoulderPerchWithPortrait"/,
  'the dedicated shoulder-pet mirror checkbox is exposed in Settings');
assert.match(source, /Mirror Shoulder Pet with Portrait/,
  'the setting label describes the full shoulder-pet presentation rather than only the anchor');
assert.match(source, /SHOULDER_PERCH_MIRROR_STORAGE_KEY/,
  'the mirror choice persists independently from the portrait flip setting');
assert.match(rigSource, /const portraitMirrored = window\.HobunjiPortraitOutlineParity\?\.isShoulderPetPortraitMirrorActive\?\.\(\) === true[\s\S]{0,260}const flipped = portraitMirrored !== observationMirrored/,
  'the portrait mirror reverses the pet resting/default facing while preserving observation flips relative to that mirrored rest');
assert.match(gameSource, /const shoulderMirrorSign = window\.HobunjiPortraitOutlineParity\?\.isShoulderPetPortraitMirrorActive\?\.\(\) === true \? -1 : 1/,
  'perch-relative horizontal curiosity motion consumes the same portrait mirror state');
assert.match(gameSource, /state\.currentYawDeg \* shoulderMirrorSign/,
  'the authored shoulder-pet head-turn sequence reverses horizontally with portrait mirroring');
assert.match(source, /getElementById\?\.\('settingDisableShoulderFrontXray'\)/,
  'the existing front shoulder-pet X-ray control receives its default through its canonical setting');
assert.match(source, /checkbox\.checked = true;[^\n]*Default presentation/,
  'front-side shoulder-pet X-ray is disabled by default');
assert.match(source, /dispatchEvent\(new global\.Event\('change'/,
  'the default drives game.js through the existing setting listener instead of duplicating layering state');

console.log('Shoulder perch mirror toggle/default X-ray tests passed.');
