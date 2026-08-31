#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Used to guard the final-transform shoulder-pet pinning order.
const indexSource = fs.readFileSync('docs/index.html', 'utf8'); // Guards the Settings UI default shown on fresh sessions.
assert.match(gameSource,
  /updateShoulderPetMeshPin\(\);/,
  'the gameplay loop still re-pins shoulder pets');
assert.match(gameSource,
  /const worldQuaternion = selectedRotationQuaternion\.clone\(\);/,
  'shoulder pets begin with whichever rotation frame is selected');
for (const source of ['pixel', 'body', 'head', 'world']) {
  assert.match(gameSource, new RegExp(`case '${source}'`), `rotation source option ${source} is implemented`);
}
assert.match(gameSource,
  /let s_shoulderPetRotationSource = 'head';/,
  'fresh gameplay state defaults shoulder-pet rotation to head/neck');
assert.match(gameSource,
  /String\(e\.target\.value \|\| 'head'\)[\s\S]{0,240}\? requestedSource : 'head';/,
  'empty or invalid shoulder-pet rotation settings fall back to head/neck');
assert.match(indexSource,
  /<option value="head" selected>Head \/ Neck \(default\)<\/option>/,
  'the Settings dropdown presents head/neck as the default');
assert.match(gameSource,
  /if \(s_invertShoulderPetRotationSource\) selectedRotationQuaternion\.invert\(\);/,
  'the inversion toggle inverses whichever rotation frame is selected');
assert.match(gameSource,
  /if \(!s_cancelShoulderPetRotationalOffset\) worldQuaternion\.multiply\(perchQuaternion\)\.multiply\(inverseGripQuaternion\)/,
  'the rotational-offset checkbox can omit only the authored perch and inverse-grip corrections');
assert.doesNotMatch(gameSource,
  /buildShoulderPetBodyXrayOverlay|shoulderPetXrayLocalNormalZ|SHOULDER_PET_STENCIL_BIT/,
  'shoulder layering no longer creates duplicate face overlays or stencil intersections');
assert.match(gameSource,
  /function _cameraSeesPlayerFrontFace\(\)[\s\S]{0,450}_shoulderPetLayerCameraLocal\.z >= 0/,
  'the whole-sprite arbiter selects settings from the camera-visible character face');
assert.match(gameSource,
  /const playerDrawsOnTop = frontVisible[\s\S]{0,500}PLAYER_OVER_SHOULDER_PET_RENDER_ORDER : PLAYER_BACK_PLANE_RENDER_ORDER/,
  'the visible character and shoulder pet resolve to one clean whole-sprite draw order');
assert.match(gameSource,
  /_setLayerDepthWrite\(_playerAvatarFrontMaterial, !active\)[\s\S]{0,900}_setLayerDepthWrite\(m, false\)/,
  'attached character and pet cutouts stop depth-writing against each other while retaining depth tests');

assert.match(gameSource,
  /settingDisableShoulderFrontXray[\s\S]{0,900}settingDisableShoulderBackXray/,
  'front and back shoulder x-ray controls remain independently wired');
assert.match(gameSource,
  /worldPosition: perchWorldPosition\.clone\(\)\.sub\(gripWorldOffset\)/,
  'the pet root is offset by the same authored grip transform used for rendering');
assert.match(gameSource,
  /alignedGripWorldPosition = finalTransform\.worldPosition\.clone\(\)\.add\(finalTransform\.gripWorldOffset/,
  'the runtime diagnostic reconstructs the grip point to verify perch coincidence');
assert.match(gameSource,
  /authoritativeRootTransform: true/,
  'the final attachment marks its root transform as authoritative');
assert.match(gameSource,
  /const fallbackWorldQuaternion = playerMesh\.getWorldQuaternion[\s\S]{0,360}faceRotationSource: 'player-body-fallback-no-authored-anchors'/,
  'no-anchor fallback shoulder pets continue to inherit the avatar body transform');

console.log('shoulder pet attack rotation tests passed');
