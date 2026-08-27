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
assert.match(source,
  /const SHOULDER_PET_REVERSE_WAIT_MIN_S = 8[\s\S]{0,220}const SHOULDER_PET_REVERSE_SPEED_DEG = 540/,
  'shoulder pets have a separate infrequent, eased Y-axis turnaround');
assert.match(source,
  /state\.facingReversed = !state\.facingReversed;[\s\S]{0,180}state\.targetFacingYawDeg = state\.facingReversed \? 180 : 0/,
  'each turnaround reverses the pet by exactly 180 degrees');
assert.match(source,
  /const behaviorYawOffset = \(Number\(c\.shoulderCuriosity\?\.currentFacingYawDeg\) \|\| 0\) \* Math\.PI \/ 180;[\s\S]{0,180}selectedBillboardWorldYaw \+ behaviorYawOffset/,
  'the turnaround is applied around Y after camera-relative billboard yaw is selected');
assert.match(probeSource,
  /Size class:[\s\S]{0,260}expected group scale=[\s\S]{0,500}Curiosity: phase=[\s\S]{0,220}facingYaw=/,
  'the mobile pixel probe distinguishes a real genotype-scale overwrite from a curiosity pose');

const tickStart = source.indexOf('function _tickShoulderPetCuriosity'); // Used below to execute the production timer/easing function in isolation.
const tickEnd = source.indexOf('function _applyShoulderPetCuriosity', tickStart);
const tickSource = source.slice(tickStart, tickEnd); // Keeps the behavior check tied to game code rather than a copied implementation.
const tickCuriosity = new Function(`
  const SHOULDER_PET_CURIOUS_BODY_LEAN_MIN_DEG = 3;
  const SHOULDER_PET_CURIOUS_BODY_LEAN_MAX_DEG = 7;
  const SHOULDER_PET_CURIOUS_LOOK_MIN_S = 0.65;
  const SHOULDER_PET_CURIOUS_LOOK_MAX_S = 1.35;
  const SHOULDER_PET_CURIOUS_WAIT_MIN_S = 3.4;
  const SHOULDER_PET_CURIOUS_WAIT_MAX_S = 7.2;
  const SHOULDER_PET_CURIOUS_PITCH_DEG = 5;
  const SHOULDER_PET_CURIOUS_HEAD_TURN_MIN_DEG = 14;
  const SHOULDER_PET_CURIOUS_HEAD_TURN_MAX_DEG = 24;
  const SHOULDER_PET_CURIOUS_TURN_SPEED_DEG = 180;
  const SHOULDER_PET_REVERSE_WAIT_MIN_S = 8;
  const SHOULDER_PET_REVERSE_WAIT_MAX_S = 18;
  const SHOULDER_PET_REVERSE_SPEED_DEG = 540;
  const rnd = () => 0;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  ${tickSource}
  return _tickShoulderPetCuriosity;
`)();
const turningPet = { shoulderCuriosity: {
  phase: 'wait', timer: 999, currentLeanDeg: 0, targetLeanDeg: 0,
  currentPitchDeg: 0, targetPitchDeg: 0, baseFrontRoll: 0, baseBackRoll: 0,
  reverseTimer: 0, currentFacingYawDeg: 0, targetFacingYawDeg: 0, facingReversed: false,
} }; // Minimal pet state used to verify a full out-and-back Y-axis turn.
tickCuriosity(turningPet, 0.02);
assert.equal(turningPet.shoulderCuriosity.facingReversed, true, 'elapsed turnaround timer selects the reverse orientation');
assert.equal(turningPet.shoulderCuriosity.currentFacingYawDeg, 10.8, 'turnaround eases instead of snapping straight to 180 degrees');
for (let i = 0; i < 20; i++) tickCuriosity(turningPet, 0.02);
assert.equal(turningPet.shoulderCuriosity.currentFacingYawDeg, 180, 'turnaround settles at exactly 180 degrees');
turningPet.shoulderCuriosity.reverseTimer = 0;
tickCuriosity(turningPet, 0.02);
assert.equal(turningPet.shoulderCuriosity.facingReversed, false, 'the next elapsed timer turns the pet back around');
for (let i = 0; i < 20; i++) tickCuriosity(turningPet, 0.02);
assert.equal(turningPet.shoulderCuriosity.currentFacingYawDeg, 0, 'return turn settles at the original camera-relative orientation');

console.log('Shoulder-pet curiosity regression checks passed.');
