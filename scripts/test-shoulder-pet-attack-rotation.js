#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Used to guard the final-transform shoulder-pet pinning order.
assert.match(gameSource,
  /updateShoulderPetMeshPin\(\);/,
  'the gameplay loop still re-pins shoulder pets');
assert.match(gameSource,
  /faceWorldQuaternion\.clone\(\)\.multiply\(perchQuaternion\)\.multiply\(inverseGripQuaternion\)/,
  'rig-anchored shoulder pets compose live face, authored perch, and inverse grip rotations');
assert.match(gameSource,
  /const faceRotationSource = playerNeckJoint\?\.isObject3D \? playerNeckJoint : playerMesh;/,
  'authored shoulder-pet rotation follows the live neck with a body fallback');
assert.match(gameSource,
  /resolveSkinnedPixelWorldPosition\?\.\(playerMesh, perch\.sourcePixel\)[\s\S]{0,520}worldPosition: perchWorldPosition\.sub\(gripWorldOffset\)/,
  'the authored perch pixel follows the live player skin before grip alignment');
assert.match(gameSource,
  /const fallbackWorldQuaternion = playerMesh\.getWorldQuaternion[\s\S]{0,360}faceRotationSource: 'player-body-fallback-no-authored-anchors'/,
  'no-anchor fallback shoulder pets continue to inherit the avatar body transform');

console.log('shoulder pet attack rotation tests passed');
