#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const game = fs.readFileSync('docs/game.js', 'utf8'); // Verifies live dialogue staging, camera framing, and eye-contact ownership.
const config = fs.readFileSync('docs/config/scratchbones-config.js', 'utf8'); // Verifies the authored ordinary-dialogue camera side angle.
const weaponStances = fs.readFileSync('docs/js/weapon-tool-stances.js', 'utf8'); // Verifies holstered weapons stop contributing idle body yaw through the normal held-mode contract.

assert.match(
  game,
  /const cinematicActive = !!window\.CinematicCameraRuntime\?\.isActive\?\.\(\);[\s\S]{0,1600}currentPlayerStage\?\.\(\)[\s\S]{0,1600}kind: 'authored'/,
  'authored cinematic player staging must retain priority over ordinary dialogue presentation',
);
const dialogueContent = fs.readFileSync('docs/js/dialogue-content.js', 'utf8'); // Verifies camera-node swaps can refresh authored player blocking.
assert(
  game.includes("refreshDialogueStaging: () => { if (_dialogueWalker) beginNpcDialogueStaging(_dialogueWalker); }"),
  'mid-dialogue authored camera swaps must be able to refresh player blocking',
);
assert(
  dialogueContent.includes("if (node.cameraId && appliedDialogueCamera) deps?.refreshDialogueStaging?.();"),
  'dialogue node camera changes must immediately re-evaluate authored player staging',
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
  game,
  /function holsterToolForDialogue\(\)[\s\S]{0,600}heldMode === 'tool'[\s\S]{0,500}putAwayHeldEquipment\(\{ silent: true \}\)/,
  'dialogue must silently holster whichever tool or weapon is currently drawn',
);
assert.match(
  game,
  /function restoreToolAfterDialogue\(\)[\s\S]{0,900}setActiveTool\(snapshot\.tool, \{ silent: true \}\)[\s\S]{0,500}activeAction = snapshot\.action/,
  'dialogue close must restore the exact previously drawn tool/weapon and selected action',
);
assert.match(
  game,
  /dialogueEntryCameraAzimuthDeg = THREE\.MathUtils\.radToDeg\(activeCameraAzimuthRad\(\)\);[\s\S]{0,250}holsterToolForDialogue\(\);[\s\S]{0,250}dialogueOpen\s*=\s*true;/,
  'dialogue must holster before entering dialogue presentation state',
);
assert.match(
  game,
  /_npcDialogueEl\.setAttribute\('aria-hidden', 'true'\);[\s\S]{0,250}restoreToolAfterDialogue\(\);/,
  'dialogue close must redraw the prior tool/weapon automatically',
);
assert.match(
  game,
  /getActiveTool: \(\) => activeTool,[\s\S]{0,180}getHeldMode: \(\) => heldMode/,
  'WeaponToolStances must receive the shared held-mode state',
);
assert.match(
  weaponStances,
  /const heldMode = deps\?\.getHeldMode\?\.\(\);[\s\S]{0,500}heldMode !== 'tool'[\s\S]{0,500}reason = 'held-equipment-put-away'/,
  'holstering through heldMode must naturally remove weapon idle body yaw without a dialogue-specific yaw override',
);

console.log('Dialogue tool holster/restore checks passed.');

assert.match(
  game,
  /function applyNpcDialogueFacingExact\(walker, rawRot, lerp\)[\s\S]{0,1800}walker\.root\.rotation\.y = walker\.rot;/,
  'NPC dialogue body facing must bypass the camera-relative billboard deadzone',
);
assert.match(
  game,
  /if \(walker\.rec\?\.id !== 'banubu'\) applyNpcDialogueFacingExact\(walker, npcTargetRot/,
  'ordinary NPC dialogue must use exact face-to-player body yaw while Banubu keeps authored posing',
);
