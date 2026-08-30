#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Used to guard the final-transform shoulder-pet pinning order.
assert.match(gameSource,
  /updateToolMesh\\(dt\\);/,
  'the gameplay loop still updates the tool mesh');
assert.match(gameSource,
  /updateShoulderPetMeshPin\\(\\);/,
  'the gameplay loop still re-pins shoulder pets');
assert.match(gameSource,
  /faceWorldQuaternion\.clone\(\)\.multiply\(perchQuaternion\)\.multiply\(inverseGripQuaternion\)/,
  'rig-anchored shoulder pets compose live face, authored perch, and inverse grip rotations');
assert.match(gameSource,
  /const faceRotationSource = playerNeckJoint\?\.isObject3D \? playerNeckJoint : playerMesh;/,
  'authored shoulder-pet rotation follows the live neck with a body fallback');
assert.match(gameSource,
  /const perchWorldPosition = playerMesh\.localToWorld[\s\S]{0,420}worldPosition: perchWorldPosition\.sub\(gripWorldOffset\)/,
  'the body-local perch position stays fixed while the pet pivots around its aligned grip');
assert.match(gameSource,
  /const fallbackWorldQuaternion = playerMesh\.getWorldQuaternion[\s\S]{0,360}faceRotationSource: 'player-body-fallback-no-authored-anchors'/,
  'no-anchor fallback shoulder pets continue to inherit the avatar body transform');

console.log('shoulder pet attack rotation tests passed');
