#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const game = fs.readFileSync('docs/game.js', 'utf8'); // Verifies live dialogue staging, camera framing, and eye-contact ownership.
const config = fs.readFileSync('docs/config/scratchbones-config.js', 'utf8'); // Verifies the authored ordinary-dialogue camera side angle.
const weaponIdleYaw = fs.readFileSync('docs/js/weapon-idle-body-yaw-runtime.js', 'utf8'); // Verifies held weapon stance cannot add body yaw over dialogue facing.

assert.match(
  game,
  /const cinematicActive = !!window\.CinematicCameraRuntime\?\.isActive\?\.\(\);[\s\S]{0,1600}currentPlayerStage\?\.\(\)[\s\S]{0,1600}kind: 'authored'/,
  'authored cinematic player staging must retain priority over ordinary dialogue presentation',
);
assert.match(
  game,
  /npcDialogueStaging = null;[\s\S]{0,500}if \(!cinematicActive && walker\?\.rec\?\.id !== 'banubu'\)[\s\S]{0,900}interactionAzimuthDeg \+ cameraSideAngleDeg - dialogueBaseAzimuthDeg/,
  'ordinary dialogue must leave the player in place and shift from the interaction-time camera angle, while Banubu bypasses the generic camera offset',
);
assert.match(config, /"cameraSideAngleDeg": 15/, 'ordinary dialogue camera offset must be authored as 15 degrees');
assert.match(
  game,
  /dialogueEntryCameraAzimuthDeg = THREE\.MathUtils\.radToDeg\(activeCameraAzimuthRad\(\)\);[\s\S]{0,500}activeCameraMode\s*=\s*npcDialogueCameraMode\(\);/,
  'dialogue must capture the real camera azimuth before switching into dialogue camera mode',
);
assert.match(
  game,
  /interactionAzimuthDeg \+ cameraSideAngleDeg - dialogueBaseAzimuthDeg/,
  'the 15-degree dialogue angle must be relative to the interaction-time camera azimuth, not an absolute world angle',
);
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

assert.match(
  game,
  /else if \(dialogueOpen && _dialogueWalker\?\.root\)[\s\S]{0,900}playerFacing = -facingAngle \+ Math\.PI \/ 2;[\s\S]{0,300}playerMesh\.rotation\.y = playerFacing;/,
  'dialogue must render the player at the true unclamped body yaw instead of the camera-relative perp deadzone',
);
assert.match(
  game,
  /function _aimNeckAtWorldPoint\([\s\S]{0,1800}neckJoint\.rotation\.set\(pitchDeg \* Math\.PI \/ 180, yawDeg \* Math\.PI \/ 180, 0\);/,
  'dialogue eye contact must author both neck pitch and yaw',
);
assert.match(
  game,
  /function updatePlayerHeadAim\(\)[\s\S]{0,800}if \(dialogueOpen\) return;/,
  'normal player head/camera tracking must not overwrite dialogue neck yaw or pitch',
);

console.log('Dialogue presentation checks passed.');

assert.match(
  weaponIdleYaw,
  /const dialogueOpen = !!global\.Combat\?\.deps\?\.isDialogueOpen\?\.\(\);[\s\S]{0,400}if \(!dialogueOpen && resolved\.active/,
  'weapon idle body-yaw channel must be suppressed while dialogue owns exact body facing',
);

console.log('Dialogue weapon-yaw suppression check passed.');
