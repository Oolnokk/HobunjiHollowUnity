#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const game = fs.readFileSync('docs/game.js', 'utf8'); // Verifies live dialogue staging, camera framing, and eye-contact ownership.
const config = fs.readFileSync('docs/config/scratchbones-config.js', 'utf8'); // Verifies the authored ordinary-dialogue camera side angle.

assert.match(
  game,
  /const cinematicActive = !!window\.CinematicCameraRuntime\?\.isActive\?\.\(\);[\s\S]{0,1600}currentPlayerStage\?\.\(\)[\s\S]{0,1600}kind: 'authored'/,
  'authored cinematic player staging must retain priority over ordinary dialogue presentation',
);
assert.match(
  game,
  /npcDialogueStaging = null;[\s\S]{0,500}if \(!cinematicActive && walker\?\.rec\?\.id !== 'banubu'\)[\s\S]{0,500}cameraAzimuthOffsetDeg = cameraSideAngleDeg;/,
  'ordinary dialogue must leave the player in place and shift the camera instead, while Banubu bypasses the generic camera offset',
);
assert.match(config, /"cameraSideAngleDeg": 15/, 'ordinary dialogue camera offset must be authored as 15 degrees');
assert.doesNotMatch(
  game,
  /playerDiagonalOffsets\(\)[\s\S]{0,1200}npcDialogueStaging = \{ walker, targetX: target\.x, targetZ: target\.z \}/,
  'ordinary dialogue must not use the legacy top-down diagonal player staging path',
);

assert.match(
  game,
  /function _playerFaceWorldPosition\(\)[\s\S]{0,900}CreatureHeadCache\?\.getHeadWorld/,
  'player dialogue eye height must come from the live head resolver',
);
assert.match(
  game,
  /const playerFaceWorld = _playerFaceWorldPosition\(\);[\s\S]{0,300}const npcFaceWorld = _npcFaceWorldPosition\(walker\);/,
  'dialogue must resolve both participants actual face positions each frame',
);
assert.match(
  game,
  /_aimNeckAtWorldPoint\([\s\S]{0,500}walker\.neckJoint[\s\S]{0,900}playerFaceWorld[\s\S]{0,1200}_aimNeckAtWorldPoint\([\s\S]{0,500}playerNeckJoint[\s\S]{0,900}npcFaceWorld/,
  'NPC and player necks must both aim at the other participant face height',
);
assert.match(
  game,
  /if \(dialogueOpen\) faceNpcDialogueParticipants\(\);/,
  'eye contact must be refreshed continuously while dialogue remains open',
);

console.log('Dialogue presentation checks passed.');
