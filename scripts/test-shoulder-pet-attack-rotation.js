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
  /settingDisableShoulderFrontXray[\s\S]{0,900}settingDisableShoulderBackXray/,
  'front and back shoulder x-ray controls remain independently wired');
assert.match(gameSource,
  /worldPosition: perchWorldPosition\.clone\(\)\.sub\(gripWorldOffset\)/,
  'the authored perch position is aligned to the pet grip after surface resolution');
assert.match(gameSource,
  /const fallbackWorldQuaternion = playerMesh\.getWorldQuaternion[\s\S]{0,360}faceRotationSource: 'player-body-fallback-no-authored-anchors'/,
  'no-anchor fallback shoulder pets continue to inherit the avatar body transform');

console.log('shoulder pet attack rotation tests passed');
