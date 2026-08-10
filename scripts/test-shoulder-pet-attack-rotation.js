#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Used to guard the final-transform shoulder-pet pinning order.
assert.match(gameSource,
  /updateToolMesh\(dt\);[\s\S]{0,600}updateShoulderPetMeshPin\(\);/,
  'shoulder pets are re-pinned after attack and tool body rotation');
assert.match(gameSource,
  /group\.rotation\.y = playerMesh\.rotation\.y - gripYawRad;/,
  'rig-anchored shoulder pets inherit the avatar body yaw');
assert.match(gameSource,
  /group\.rotation\.y = playerMesh\.rotation\.y;/,
  'fallback shoulder pets inherit the avatar body yaw');
assert.match(gameSource,
  /position\.x = playerMesh\.position\.x - Math\.sin\(playerMesh\.rotation\.y\) \* 0\.3;/,
  'fallback shoulder-pet position follows the rotated avatar');
assert.match(gameSource,
  /position\.z = playerMesh\.position\.z - Math\.cos\(playerMesh\.rotation\.y\) \* 0\.3;/,
  'fallback shoulder-pet position follows the rotated avatar');

console.log('shoulder pet attack rotation tests passed');
