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
  /updatePlayerHeadAim\(\);[\s\S]{0,260}prepareNeckForAttachmentSampling\?\.\(\);[\s\S]{0,260}updateShoulderPetMeshPin\(\);/,
  'the final physical neck pose is resolved before the live shoulder-perch frame is sampled');
assert.match(gameSource,
  /const worldQuaternion = selectedRotationQuaternion\.clone\(\);/,
  'shoulder pets begin with whichever rotation frame is selected');
for (const source of ['pixel', 'body', 'bodyNeckMidpoint', 'head', 'world']) {
  assert.match(gameSource, new RegExp(`case '${source}'`), `rotation source option ${source} is implemented`);
}
assert.match(gameSource,
  /const SHOULDER_PET_BODY_NECK_BLEND = 0\.5;/,
  'body/neck midpoint uses an equal 50/50 quaternion blend');
assert.match(gameSource,
  /bodyRotationQuaternion\.clone\(\)\.slerp\(neckRotationQuaternion, SHOULDER_PET_BODY_NECK_BLEND\)\.normalize\(\)/,
  'midpoint rotation uses quaternion SLERP rather than Euler averaging');
assert.match(gameSource,
  /resolvedRotationSource = 'player-body-neck-midpoint';/,
  'midpoint mode reports its resolved rotation source');
assert.match(gameSource,
  /let s_shoulderPetRotationSource = 'head';/,
  'fresh gameplay state defaults shoulder-pet rotation to the head/neck frame');
assert.match(gameSource,
  /String\(e\.target\.value \|\| 'head'\)[\s\S]{0,300}\? requestedSource : 'head';/,
  'empty or invalid shoulder-pet rotation settings fall back to the head/neck frame');
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
  /const SHOULDER_PET_LAYER_FACE_HYSTERESIS = 0\.1;/,
  'shoulder-pet layer arbitration has an angular hysteresis band around the edge-on boundary');
assert.match(gameSource,
  /const logicalYaw = Number\.isFinite\(facingAngle\)[\s\S]{0,180}-facingAngle \+ Math\.PI \/ 2[\s\S]{0,420}const normalizedFaceZ = Math\.cos\(logicalYaw - cameraBearing\)/,
  'shoulder-pet layer classification uses unclamped logical player facing instead of the portrait deadzone-snapped render yaw');
assert.doesNotMatch(gameSource,
  /_playerAvatarFrontMesh\.worldToLocal\(_shoulderPetLayerCameraLocal\)/,
  'layer classification no longer derives front/back from the deadzone-snapped portrait mesh');
assert.match(gameSource,
  /_shoulderPetLayerFrontVisible && normalizedFaceZ < -SHOULDER_PET_LAYER_FACE_HYSTERESIS[\s\S]{0,350}!_shoulderPetLayerFrontVisible && normalizedFaceZ > SHOULDER_PET_LAYER_FACE_HYSTERESIS/,
  'the whole-sprite arbiter keeps the previous side until logical facing decisively crosses the portrait plane');
assert.match(gameSource,
  /const nextPet = active \? pet : null;[\s\S]{0,260}_petLayeringPet !== nextPet\)[\s\S]{0,160}_shoulderPetLayerFrontVisible = null;[\s\S]{0,120}_shoulderPetLayerDecision = null;/,
  'layer-side hysteresis and diagnostics reset whenever the active shoulder attachment changes');
assert.match(gameSource,
  /const playerDrawsOnTop = frontVisible[\s\S]{0,500}PLAYER_OVER_SHOULDER_PET_RENDER_ORDER : PLAYER_BACK_PLANE_RENDER_ORDER/,
  'the visible character and shoulder pet resolve to one clean whole-sprite draw order');
assert.match(gameSource,
  /_setLayerDepthWrite\(_playerAvatarFrontMaterial, !active\)/,
  'attached player front material stops depth-writing while the pet is active');
assert.match(gameSource,
  /for \(const m of \[pet\.avatarRef\?\.frontPlane\?\.material, pet\.avatarRef\?\.backPlane\?\.material\]\)[\s\S]{0,180}_setLayerDepthWrite\(m, false\)/,
  'attached pet cutouts stop depth-writing against the player while retaining depth tests');

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
