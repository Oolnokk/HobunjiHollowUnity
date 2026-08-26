#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('docs/game.js', 'utf8'); // Guards the attached-pet look-around path embedded in the main game closure.
const probeSource = fs.readFileSync('docs/js/pixel-probe.js', 'utf8'); // Guards the mobile-visible size/curiosity diagnostic added for shoulder pets.

assert.match(source,
  /function _tickShoulderPetCuriosity\(c, dt\)[\s\S]{0,1800}state\.phase = 'look'[\s\S]{0,700}targetLeanDeg/,
  'shoulder pets own a randomized look phase instead of turning every frame');
assert.match(source,
  /function _applyShoulderPetCuriosity\(c, dt\)[\s\S]{0,1200}frontPlane\.rotation\.z = state\.baseFrontRoll \+ leanRadians[\s\S]{0,260}backPlane\.rotation\.z = state\.baseBackRoll - leanRadians/,
  'curiosity leans within the visible pet planes without perspective foreshortening');
const applyCuriositySource = source.slice(source.indexOf('function _applyShoulderPetCuriosity'), source.indexOf('function _isPlayerGenuinelyIdle')); // Used below to forbid perspective-changing Y rotation in this one pose function.
assert.doesNotMatch(applyCuriositySource, /frontPlane\.rotation\.y|backPlane\.rotation\.y/,
  'curiosity never yaws a flat animal plane and therefore cannot imitate a size-class change');
assert.match(source,
  /_applyShoulderPetCuriosity\(c, dt\);[\s\S]{0,180}if \(perch && grip\)/,
  'the curiosity pose is applied inside the shoulder-pet branch before attachment pinning');
assert.match(source,
  /_updateCompanionHeadRotation\(c, _companionHeadRestDeg\(c\) \+ state\.currentPitchDeg, dt\)/,
  'shoulder-pet glances add a small pitch when the authored head rig is available');
assert.match(source,
  /const SHOULDER_PET_CURIOUS_HEAD_TURN_MIN_DEG = 14/,
  'shoulder-pet glances give the head its own visible turn instead of only rotating the body planes');
assert.match(source,
  /const SHOULDER_PET_CURIOUS_BODY_LEAN_MAX_DEG = 7/,
  'the whole-body curiosity lean stays subtle and scale-stable');
assert.match(source,
  /state\.targetPitchDeg = side \* \(SHOULDER_PET_CURIOUS_HEAD_TURN_MIN_DEG/,
  'curiosity applies the separate head turn in the same direction as its body glance');
assert.match(source,
  /const SHOULDER_PET_CURIOUS_WAIT_MIN_S = 3\.4/,
  'shoulder-pet glances have a cooldown so they remain spontaneous');
assert.match(probeSource,
  /Size class:[\s\S]{0,260}expected group scale=[\s\S]{0,500}Curiosity: phase=/,
  'the mobile pixel probe distinguishes a real genotype-scale overwrite from a curiosity pose');

console.log('Shoulder-pet curiosity regression checks passed.');
