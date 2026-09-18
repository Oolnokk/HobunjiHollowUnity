#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const avatarSource = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8'); // Guards the shared animal head-rig yaw implementation itself.
const perpSource = fs.readFileSync('docs/js/perp-rotation.js', 'utf8'); // Guards the generic camera-relative helper used by every rigged animal avatar.
const materialSource = fs.readFileSync('docs/js/animal-head-material-response.js', 'utf8'); // Guards compatibility with the newer Compressibility/Stretchability wrapper.
const bridgeSource = fs.readFileSync('docs/js/player-body-attachment-bridge.js', 'utf8'); // Ensures shoulder presentation no longer owns head-deadzone math.
const indexSource = fs.readFileSync('docs/index.html', 'utf8'); // Guards delivery of both changed runtime files through browser caches.

const yawStart = avatarSource.indexOf('const headYawPerpState =');
const yawEnd = avatarSource.indexOf('avatarRef.setHeadAdditiveRotation =', yawStart);
assert(yawStart >= 0 && yawEnd > yawStart, 'shared animal head-rig deadzone block is present');
const yawSource = avatarSource.slice(yawStart, yawEnd);

const updateYawStart = yawSource.indexOf('avatarRef.updateHeadYaw =');
const updateYawSource = yawSource.slice(updateYawStart); // Excludes pitch/updateHeadRotation's independent turn-speed step from ordering checks below.
const solveIndex = updateYawSource.indexOf('const solved = solveCameraSafeHeadYaw(degrees)');
const stepIndex = updateYawSource.indexOf('const step = rig.turnSpeedDeg * delta', solveIndex);
const stateWriteIndex = updateYawSource.indexOf('state.currentYawDeg =', stepIndex);
const boneWriteIndex = updateYawSource.indexOf('applyYawDegrees(state.currentYawDeg)', stateWriteIndex);
assert(updateYawStart >= 0 && solveIndex >= 0 && stepIndex > solveIndex && stateWriteIndex > stepIndex && boneWriteIndex > stateWriteIndex,
  'camera-safe target and state integration happen before the head bones are written');
assert.match(yawSource, /nearestReachableSafeYaw[\s\S]*no-camera-safe-yaw-within-authored-neck-range/,
  'head yaw chooses a reachable camera-safe angle inside the authored neck range instead of clamping a forbidden target back into the deadzone');
assert.match(yawSource, /clamped\?\.snapTo[\s\S]*snapYawDeg[\s\S]*Swap directly across the flat-card edge-on interval/,
  'crossing from one camera-safe side to the other uses the shared deadzone side-swap rather than smoothing through the forbidden interval');
assert.match(yawSource, /matrixWorld\?\.determinant[\s\S]*visualParity/,
  'mirrored shoulder-pet cards reverse local-yaw visual parity in the shared math');
assert.match(yawSource, /elements\?\.\[8\][\s\S]*elements\?\.\[10\][\s\S]*Math\.PI \/ 2/,
  'visible body yaw comes from the rendered front card world basis, including ordinary planeDelta and authoritative shoulder-root transforms');
assert.doesNotMatch(yawSource, /onBeforeRender|requestAnimationFrame/,
  'animal head deadzone owns no render hook or independent per-frame correction loop');

assert.match(perpSource, /function cameraPerpsForObject\(object, fallbackPerps = null\)/,
  'PerpRotation exposes camera centers for animal roots that do not own a registered perpState');
assert.match(perpSource, /cameraRelativePerpsAtWorldPosition,[\s\S]{0,120}cameraPerpsForObject,[\s\S]{0,120}perspectivePerpsForState/,
  'generic object camera-perp resolution is exported beside the existing subject-aware resolver');

assert.match(materialSource, /wrapAfter\('updateHeadYaw'\)/,
  'newer Stretchability response remains outside updateHeadYaw so it observes the final constrained yaw');
assert.match(materialSource, /const result = original\.apply\(this, args\);[\s\S]{0,100}applyCurrentResponse\(\)/,
  'material response still refreshes only after the shared yaw math finishes');
assert.doesNotMatch(bridgeSource, /HeadDeadzone|headDeadzone|head-yaw deadzone/i,
  'player body/shoulder attachment bridge owns no animal head-deadzone behavior');
assert.equal(fs.existsSync('docs/js/animal-head-yaw-deadzone.js'), false,
  'no standalone wrapper module remains; the behavior lives in shared head rotation math');

assert.match(indexSource, /png-plane-avatar\.js\?v=20260918headdeadzone1/,
  'game cache-busts the changed shared animal head-rig runtime');
assert.match(indexSource, /perp-rotation\.js\?v=20260918headdeadzone1/,
  'game cache-busts the changed camera-deadzone helper');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}
let nowMs = 100;
const context = {
  console,
  Math,
  Number,
  Array,
  Object,
  WeakMap,
  Date,
  performance: { now: () => nowMs },
  THREE: {
    MathUtils: { degToRad: degrees => degrees * Math.PI / 180 },
    Vector3,
  },
  window: {
    SCRATCHBONES_CONFIG: { game: { movement: { creaturePerpRotDeadzoneDeg: 27.5 } } },
    __hobunjiFurnitureDebug: { camState: { position: { x: 0, y: 4, z: 0 } } },
  },
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(perpSource, context, { filename: 'perp-rotation.js' });
context.window.PerpRotation.init({
  angleDiff(target, current) {
    let delta = target - current;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
  },
});
const unregisteredAnimalRoot = { position: { x: 1, y: 0, z: 0 } }; // Nursery/named-style avatar: rendered root exists, no Combat/perpState registration.
const perps = Array.from(context.window.PerpRotation.cameraPerpsForObject(unregisteredAnimalRoot, []));
assert.equal(perps.length, 2, 'generic animal-root camera resolver returns both edge-on camera centers');
assert(Math.abs(perps[0]) < 1e-9 && Math.abs(Math.abs(perps[1]) - Math.PI) < 1e-9,
  'generic camera centers are derived from the same world-position bearing math as registered creatures');

console.log('Current-architecture global animal head deadzone checks passed.');
