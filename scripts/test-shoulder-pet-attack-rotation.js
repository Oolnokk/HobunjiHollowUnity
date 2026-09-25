#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const gameSource = fs.readFileSync('docs/game.js', 'utf8');
const indexSource = fs.readFileSync('docs/index.html', 'utf8');

assert.match(gameSource, /updateShoulderPetMeshPin\(\);/, 'gameplay still re-pins shoulder pets after player/tool pose');
assert.match(gameSource, /const s_shoulderPetRotationSource = 'head';/,
  'head/neck remains the fixed authored shoulder rotation frame');
assert.doesNotMatch(indexSource, /Shoulder-Pet Rotation Source|Invert Selected Shoulder Rotation|Cancel Shoulder-Pet Rotational Offset/,
  'shoulder presentation tuning controls are no longer exposed in Settings');
assert.match(gameSource, /const SHOULDER_PET_HALF_TURN_QUATERNION = new THREE\.Quaternion\(\)\.setFromAxisAngle\(new THREE\.Vector3\(0, 1, 0\), Math\.PI\);/,
  'shoulder facing swap is authored as an exact 180-degree local-Y quaternion');
assert.match(gameSource,
  /const facingTowardPlayerCenter = pet\?\.__hobunjiShoulderFacingInward === true;[\s\S]{0,3200}const shoulderFacingTurnDeg = facingTowardPlayerCenter \? 180 : 0;/,
  'brief inward/front state selects the 180-degree local transform while outward/behind stays at zero extra turn');
assert.match(gameSource,
  /worldQuaternion\.multiply\(authoredRotationOffset\);[\s\S]{0,180}worldQuaternion\.multiply\(SHOULDER_PET_HALF_TURN_QUATERNION\)/,
  'the half-turn is applied after the authored perch/grip correction in pet-local space');
assert.doesNotMatch(gameSource, /authoredRotationOffset\.invert\(\)/,
  'opposite shoulder facing never inverts the authored quaternion');
assert.doesNotMatch(gameSource, /desiredVisualFacingSign|observationMirrored|canonicalFacingSign/,
  'shoulder facing no longer computes or requests sprite mirror parity');
assert.match(gameSource,
  /facingTowardPlayerCenter: finalTransform\.facingTowardPlayerCenter === true[\s\S]{0,180}shoulderFacingTurnDeg:[\s\S]{0,120}spriteMirrored: false/,
  'final diagnostics record 0/180 local turn and guarantee no sprite mirror');
assert.match(gameSource,
  /worldPosition: perchWorldPosition\.clone\(\)\.sub\(gripWorldOffset\)/,
  'the pet root is re-solved after rotation so shoulderGrip remains pinned to shoulderPerch');
assert.match(gameSource, /authoritativeRootTransform: true/,
  'final attachment remains authoritative');
console.log('shoulder pet direction-signed rotation tests passed');
