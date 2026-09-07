#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const avatarSource = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8');
const rotationSource = fs.readFileSync('docs/js/perp-rotation.js', 'utf8');

function angleDiff(target, current) {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

assert.match(avatarSource,
  /const cameraSafeVisualYawDeg = requestedYawDeg =>[\s\S]{0,300}owner\?\.pngRot[\s\S]{0,450}window\.PerpRotation[\s\S]{0,1400}CREATURE_PERP_DEAD_RAD/,
  'animal head yaw is visually clamped from the rendered body-plane rotation using the global animal deadzone');
assert.match(avatarSource,
  /const requestedTarget = clamp\(finite\(degrees, 0\)[\s\S]{0,220}cameraSafeVisualYawDeg\(requestedTarget\)[\s\S]{0,500}state\.requestedYawDeg = requestedTarget/,
  'the caller-provided ray yaw is retained separately from the safe visual yaw target');
assert.match(avatarSource,
  /_headDeadzoneDebug = \{ rawVisualRot, effectiveVisualRot: clamped\.effectiveTarget, requestedYawDeg, safeYawDeg \}/,
  'visual clamp diagnostics expose requested and rendered rotations without feeding gameplay');
assert.match(rotationSource,
  /function creatureSnapSwayTarget\([\s\S]{0,180}state\.cameraPerpsRad = perps\.slice\(\)/,
  'the existing body-plane step publishes its exact live camera deadzone centers to visual child planes');
assert.match(rotationSource, /const CREATURE_PLANE_ROT_MODE = 'snap'/,
  'the existing whole-body animal rotation behavior remains unchanged');

global.THREE = { MathUtils: { degToRad: degrees => degrees * Math.PI / 180 } };
global.window = { SCRATCHBONES_CONFIG: { game: { movement: { creaturePerpRotDeadzoneDeg: 27.5 } } } };
require('../docs/js/perp-rotation.js');
window.PerpRotation.init({ angleDiff });

const deadRadius = window.PerpRotation.CREATURE_PERP_DEAD_RAD;
const cameraCenter = 0;
const bodyPlaneRot = cameraCenter - deadRadius;
const centers = [cameraCenter, Math.PI];
const visualState = {
  perpSides: centers.map(center => angleDiff(bodyPlaneRot, center) >= 0 ? 1 : -1),
  locked: centers.map(() => false),
};
const requestedHeadVisualRot = cameraCenter;
const safeHeadVisualRot = window.PerpRotation.perpClamp(visualState, requestedHeadVisualRot, centers, deadRadius).effectiveTarget;
assert.ok(Math.abs(angleDiff(safeHeadVisualRot, bodyPlaneRot)) < 1e-9,
  'a head counter-rotating toward the camera visually halts at the body plane deadzone edge');
assert.ok(Math.abs(angleDiff(safeHeadVisualRot, cameraCenter)) >= deadRadius - 1e-9,
  'the interior PNG head planes never enter the configured global animal deadzone');

console.log('Animal visual-head camera-deadzone checks passed.');
