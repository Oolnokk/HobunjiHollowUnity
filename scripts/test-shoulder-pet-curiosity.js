#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('docs/game.js', 'utf8'); // Guards the attached-pet look-around path embedded in the main game closure.
const rigSource = fs.readFileSync('docs/config/attachment-rig-profiles.js', 'utf8'); // Guards the instantaneous horizontal mirror bridge and refreshed shoulder anchors.
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
assert.doesNotMatch(source, /SHOULDER_PET_REVERSE_SPEED_DEG|currentFacingYawDeg|targetFacingYawDeg|behaviorYawOffset/,
  'main keeps the rejected interpolated 180-degree shoulder-pet reverse/yaw experiment out');
assert.match(rigSource,
  /if \(phase === 'wait' && nextPhase === 'look'\)[\s\S]{0,260}applyShoulderPetObservationMirror\(pet, flipped\)[\s\S]{0,420}phase = nextPhase/,
  'each observation toggles the horizontal mirror synchronously before the look phase begins');
assert.match(rigSource,
  /const sign = flipped \? -1 : 1;[\s\S]{0,220}plane\.scale\.x = \(Number\.isFinite\(magnitude\)[\s\S]{0,100}\* sign/,
  'the observation change is an instantaneous X-scale mirror rather than a rotation or lerp');
assert.match(rigSource,
  /avatar\.syncMirroredPlaneScale = function[\s\S]{0,650}__hobunjiShoulderObservationFlipped[\s\S]{0,260}plane\.scale\.x/,
  'later canonical plane-scale refreshes preserve the current horizontal mirror parity');
assert.match(rigSource,
  /pet\.stableRole !== 'shoulderPet'[\s\S]{0,220}applyShoulderPetObservationMirror\(pet, false\)/,
  'leaving shoulder-pet mode restores ordinary unmirrored animal rendering');
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
  'shoulder-pet glances have a cooldown so the 250ms instrumentation scan always installs before the first observation');
assert.match(rigSource,
  /\["drenkirra"[\s\S]{0,180}\[0\.01,-0\.11914729549653388,-0\.001096892109713506\]/,
  'Drenkirra uses the supplied shoulderGrip');
assert.match(rigSource,
  /\["uumkaoii"[\s\S]{0,180}\[0\.01,-0\.3636087789187775,-0\.18395679109723\]/,
  'Uumkaoii uses the supplied shoulderGrip');
assert.match(rigSource,
  /\["kenkari::female"[\s\S]{0,100}\[-0\.12331214301269552,0\.2212216457140902,0\]/,
  'Kenkari female uses the supplied shoulderPerch');
assert.match(rigSource,
  /characterTransformAliases = Object\.freeze\(\{ rakakoan: 'kenkari' \}\)[\s\S]{0,7000}characters\[aliasKey\] = characters\[sourceKey\]/,
  'Rakakoan still shares Kenkari transform objects instead of owning independent perch transforms');
assert.match(probeSource,
  /Size class:[\s\S]{0,260}expected group scale=[\s\S]{0,500}Curiosity: phase=/,
  'the mobile pixel probe distinguishes a real genotype-scale overwrite from a curiosity pose');

console.log('Shoulder-pet curiosity regression checks passed.');
