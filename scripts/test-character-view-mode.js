#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const game = fs.readFileSync('docs/game.js', 'utf8');
const index = fs.readFileSync('docs/index.html', 'utf8');
const pixelProbe = fs.readFileSync('docs/js/pixel-probe.js', 'utf8');

assert.match(game, /id: 'character-view'[\s\S]*setCharacterViewMode\(!characterViewMode\.enabled\)/, 'the utilities wheel exposes the character-view toggle');
assert.match(game, /characterViewMode\.enabled \|\| cameraModeConfig\(activeCameraMode\)\.freeRotate === true/, 'character view grants full camera orbit');
assert.match(game, /viewModeMoveMagnitude > 0\.08 \|\| viewModeForcedMovement[\s\S]*setCharacterViewMode\(false, 'movement'\)/, 'manual or forced movement disables character view');
assert.match(game, /if \(characterViewMode\.enabled\) \{[\s\S]*facingAngle = characterViewMode\.lockedFacingAngle;[\s\S]*player\.angle = characterViewMode\.lockedPlayerAngle;/, 'logical face and aim yaw stay pinned while viewing');
assert.match(game, /else if \(characterViewMode\.enabled\) \{[\s\S]*playerFacing = characterViewMode\.lockedPlayerFacing;[\s\S]*playerMesh\.rotation\.y = playerFacing;/, 'camera-relative billboard rotation stays pinned while viewing');
assert.match(game, /playerNeckJoint\.rotation\.x = characterViewMode\.lockedNeckX;[\s\S]*playerNeckJoint\.rotation\.y = characterViewMode\.lockedNeckY;/, 'the neck remains pinned while viewing');
assert.match(pixelProbe, /Character View: \$\{characterView\.enabled \? 'ON' : 'off'\}/, 'Pixel Probe includes mobile-copyable character-view state');
assert.match(index, /game\.js\?v=20260829charview2/, 'the game script cache is invalidated');
assert.match(index, /pixel-probe\.js\?v=20260829charview2/, 'the updated mobile diagnostic is cache-invalidated');

console.log('Character view mode checks passed.');
