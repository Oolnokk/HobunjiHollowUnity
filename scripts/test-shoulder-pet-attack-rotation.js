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
  /const facingTowardPlayerCenter = pet\?\.__hobunjiShoulderFacingInward === true;[\s\S]{0,500}const desiredVisualFacingSign = facingTowardPlayerCenter \? -shoulderSideSign : shoulderSideSign;[\s\S]{0,350}const observationMirrored = desiredVisualFacingSign !== canonicalFacingSign;/,
  'semantic inward/outward state resolves the correct mirrored visual facing for the active shoulder');
assert.match(gameSource,
  /const authoredRotationSign = facingTowardPlayerCenter \? 1 : -1;[\s\S]{0,240}authoredRotationOffset\.invert\(\)/,
  'inward/front uses the authored rotation while outward/behind uses its exact opposite');
assert.match(gameSource,
  /if \(!s_cancelShoulderPetRotationalOffset\) worldQuaternion\.multiply\(authoredRotationOffset\)/,
  'the direction-signed authored offset is the final shoulder correction');
assert.match(gameSource,
  /facingTowardPlayerCenter: finalTransform\.facingTowardPlayerCenter === true[\s\S]{0,300}observationMirrored:/,
  'final attachment diagnostics record semantic facing and resolved mirror parity');
assert.match(gameSource,
  /worldPosition: perchWorldPosition\.clone\(\)\.sub\(gripWorldOffset\)/,
  'signed rotation still offsets the pet root so its authored grip remains on the perch');
assert.match(gameSource, /authoritativeRootTransform: true/,
  'final attachment remains authoritative');
console.log('shoulder pet direction-signed rotation tests passed');
