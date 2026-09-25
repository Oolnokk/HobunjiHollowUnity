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
assert.match(gameSource,
  /function _shoulderPetSurfaceTransform\(perch, grip, pet\)[\s\S]{0,2600}const shoulderSideSign = Math\.sign\(perchLocalToPlayer\.x[\s\S]{0,1500}const canonicalFacingSign = [\s\S]{0,900}const facingTowardPlayerCenter = visualFacingSign === towardCenterSign/,
  'shoulder side plus mirrored animal-art facing determines inward versus outward');
assert.match(gameSource,
  /const authoredRotationSign = facingTowardPlayerCenter \? 1 : -1;[\s\S]{0,240}authoredRotationOffset\.invert\(\)/,
  'outward-facing shoulder pets use the exact opposite authored rotation offset');
assert.match(gameSource,
  /if \(!s_cancelShoulderPetRotationalOffset\) worldQuaternion\.multiply\(authoredRotationOffset\)/,
  'the direction-signed authored offset is the final shoulder correction');
assert.match(gameSource,
  /facingTowardPlayerCenter: finalTransform\.facingTowardPlayerCenter === true[\s\S]{0,240}authoredRotationSign:/,
  'final attachment diagnostics record inward/outward signed rotation');
assert.match(gameSource,
  /worldPosition: perchWorldPosition\.clone\(\)\.sub\(gripWorldOffset\)/,
  'signed rotation still offsets the pet root so its authored grip remains on the perch');
assert.match(gameSource, /authoritativeRootTransform: true/,
  'final attachment remains authoritative');
console.log('shoulder pet direction-signed rotation tests passed');
