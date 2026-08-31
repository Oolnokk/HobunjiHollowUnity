#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('docs/game.js', 'utf8');
const farmSource = fs.readFileSync('docs/js/farm-animals.js', 'utf8');

assert.match(source,
  /const livestockLookCandidate = def\.hostile === false[\s\S]{0,180}LIVESTOCK_LOOK_RANGE_PX/,
  'passive livestock get a bounded approach-range face-look candidate');
assert.match(source,
  /if \(def\.hostile === false[\s\S]{0,900}_updateCreatureLookAtFace\(c, targetPlayer, entityDt\)[\s\S]{0,300}_restoreCompanionHead\(c, entityDt\)/,
  'livestock look at the player while nearby and restore their head when the player leaves');
assert.match(source,
  /function _updateCreatureLookAtFace\(c, master, dt\)[\s\S]{0,1000}_updateCompanionHeadRotation\(c, pitchDeg, dt\)/,
  'livestock and companion gaze drives the authored head rotation toward the face target');
assert.match(source,
  /exactLookRotY = -c\._headLookWorldBearing \+ Math\.PI \/ 2[\s\S]{0,300}headYawForDeadzone\(exactLookRotY, c\.pngRot, c\._headLookYawLimitDeg\)[\s\S]{0,180}updateHeadYaw\(headYawDeg, dt\)/,
  'wild and companion head yaw absorbs the rotation withheld by the visible animal plane deadzone');
assert.match(source,
  /function _playerFaceTarget\(master = player\)/,
  'all player-facing animal behavior targets the character face height rather than the feet');
assert.match(source,
  /CreatureHeadCache\.getHeadWorld\(player, 'player', \{ x: player\.x, y: player\.y, mesh: playerMesh, avatarModelHeight: playerAvatarModelHeight \}\)/,
  'the shared face target carries the portrait face height');
assert.match(source,
  /getPlayerFaceTarget: \(\) => \{[\s\S]{0,260}CreatureHeadCache\.getHeadWorld\(player, 'player'[\s\S]{0,180}worldY: pos\.worldY/,
  'the farm loop receives the player face target in tile/world coordinates');
assert.match(farmSource,
  /const LIVESTOCK_LOOK_RANGE_TILES = 3\.75[\s\S]{0,1800}function _farmAnimalFaceLook\(animal, dt\)/,
  'farm livestock has its own bounded approach gaze instead of relying on hostile wildlife');
assert.match(farmSource,
  /function _farmAnimalFaceLook\(animal, dt\)[\s\S]{0,1800}animal\.avatarRef\.updateHeadRotation\(pitchDeg, dt\)[\s\S]{0,600}faceTargetRot = -Math\.atan2\(dz, dx\) \+ Math\.PI \/ 2[\s\S]{0,260}return faceTargetRot/,
  'farm livestock turns its body and authored head toward the player face');
assert.match(farmSource,
  /function _farmAnimalLookTarget\(animal, dt, idle\)[\s\S]{0,320}_restoreFarmAnimalHead\(animal, dt\)/,
  'farm livestock restores its authored head rest angle after the approach');
assert.match(farmSource,
  /function _applyFarmAnimalDeadzoneHeadYaw\(animal, dt\)[\s\S]{0,620}headYawForDeadzone\(animal\._headLookTargetRot, animal\.groupRot, yawLimitDeg\)[\s\S]{0,180}updateHeadYaw\(headYawDeg, dt\)/,
  'farm livestock uses the same body-deadzone remainder as local head yaw');
assert.match(farmSource,
  /creatureId: kind[\s\S]{0,160}headRig: window\.CreatureGeneticsRender\?\.headRigForKind\?\./,
  'farm species receive their explicit authored head rigs too');

console.log('Livestock face-look regression checks passed.');
