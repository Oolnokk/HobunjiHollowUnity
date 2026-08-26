#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('docs/game.js', 'utf8'); // Guards the attached-pet look-around path embedded in the main game closure.

assert.match(source,
  /function _tickShoulderPetCuriosity\(c, dt\)[\s\S]{0,1800}state\.phase = 'look'[\s\S]{0,700}targetYawDeg/,
  'shoulder pets own a randomized look phase instead of turning every frame');
assert.match(source,
  /function _applyShoulderPetCuriosity\(c, dt\)[\s\S]{0,700}frontPlane\.rotation\.y \+= yawRadians[\s\S]{0,260}backPlane\.rotation\.y \+= yawRadians/,
  'curiosity turns the visible pet planes without moving the attachment root');
assert.match(source,
  /_applyShoulderPetCuriosity\(c, dt\);[\s\S]{0,180}if \(perch && grip\)/,
  'the curiosity pose is applied inside the shoulder-pet branch before attachment pinning');
assert.match(source,
  /_updateCompanionHeadRotation\(c, _companionHeadRestDeg\(c\) \+ state\.currentPitchDeg, dt\)/,
  'shoulder-pet glances add a small pitch when the authored head rig is available');
assert.match(source,
  /const SHOULDER_PET_CURIOUS_WAIT_MIN_S = 3\.4/,
  'shoulder-pet glances have a cooldown so they remain spontaneous');

console.log('Shoulder-pet curiosity regression checks passed.');
