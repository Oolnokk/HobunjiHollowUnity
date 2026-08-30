#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Used to guard the final-transform shoulder-pet pinning order.
assert.match(gameSource,
  /updateShoulderPetMeshPin\(\);/,
  'the gameplay loop still re-pins shoulder pets');
assert.match(gameSource,
  /const worldQuaternion = selectedRotationQuaternion\.clone\(\)\.multiply\(perchQuaternion\)\.multiply\(inverseGripQuaternion\)/,
  'shoulder pets compose the selected rotation frame, authored perch, and inverse grip rotations');
for (const source of ['pixel', 'body', 'head', 'world']) {
  assert.match(gameSource, new RegExp(`case '${source}'`), `rotation source option ${source} is implemented`);
}
assert.match(gameSource,
  /if \(s_invertShoulderPetRotationSource\) selectedRotationQuaternion\.invert\(\);/,
  'the inversion toggle inverses whichever rotation frame is selected');
assert.match(gameSource,
  /if \(!s_cancelShoulderPetRotationalOffset\) worldQuaternion\.multiply\(perchQuaternion\)\.multiply\(inverseGripQuaternion\)/,
  'the rotational-offset checkbox can omit only the authored perch and inverse-grip corrections');
assert.match(gameSource,
  /buildShoulderPetBodyXrayOverlay[\s\S]{0,3200}SHOULDER_PET_PLANE_RENDER_ORDER \+ 1/,
  'face-only player overlays can explicitly render after the shoulder pet while retaining world depth');
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
