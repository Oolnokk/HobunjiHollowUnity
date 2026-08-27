#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Used to guard the final-transform shoulder-pet pinning order.
assert.match(gameSource,
  /updateToolMesh\(dt\);[\s\S]{0,600}updateShoulderPetMeshPin\(\);/,
  'shoulder pets are re-pinned after attack and tool body rotation');
assert.match(gameSource,
  /const finalGroupRotY = playerMesh\.rotation\.y - gripYawRad;[\s\S]{0,180}_applyShoulderPetFinalRotation\(c, finalGroupRotY\);/,
  'rig-anchored shoulder pets inherit the avatar body yaw');
assert.match(gameSource,
  /const finalGroupRotY = playerMesh\.rotation\.y;[\s\S]{0,180}_applyShoulderPetFinalRotation\(c, finalGroupRotY\);/,
  'fallback shoulder pets inherit the avatar body yaw');
assert.match(gameSource,
  /const planeDelta = billboardWorldYaw - finalGroupRotY;[\s\S]{0,260}frontPlane\.rotation\.y = planeDelta \+ Math\.PI \/ 2;[\s\S]{0,180}backPlane\.rotation\.y = planeDelta - Math\.PI \/ 2;/,
  'final body yaw is counter-rotated out of both shoulder-pet billboard planes');
assert.match(gameSource,
  /position\.x = playerMesh\.position\.x - Math\.sin\(playerMesh\.rotation\.y\) \* 0\.3;/,
  'fallback shoulder-pet position follows the rotated avatar');
assert.match(gameSource,
  /position\.z = playerMesh\.position\.z - Math\.cos\(playerMesh\.rotation\.y\) \* 0\.3;/,
  'fallback shoulder-pet position follows the rotated avatar');

console.log('shoulder pet attack rotation tests passed');
