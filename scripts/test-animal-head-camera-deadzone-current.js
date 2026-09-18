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

// Execute the REAL shared head-yaw block in isolation so the regression covers
// target selection/integration rather than only matching source text.
const headMathStart = avatarSource.indexOf('const headYawPerpState =');
const headMathEnd = avatarSource.indexOf('avatarRef.setHeadAdditiveRotation =', headMathStart);
const headMathSource = avatarSource.slice(headMathStart, headMathEnd); // Exact production closure body from png-plane-avatar.js.
const RAD = Math.PI / 180;
function runHeadYawCase({ bodyDeg, mirrored = false, requestDeg, yawLimitDeg, currentDeg = 0, turnSpeedDeg = 120, dt = 1 / 60, cameraPerps = [0, Math.PI] }) {
  const bodyYaw = bodyDeg * RAD;
  const planeYaw = bodyYaw + Math.PI / 2;
  const front = {
    mesh: {
      matrixWorld: {
        elements: [0,0,0,0, 0,0,0,0, Math.sin(planeYaw),0,Math.cos(planeYaw),0, 0,0,0,1],
        determinant() { return mirrored ? -1 : 1; },
      },
      updateWorldMatrix() {},
    },
    headBone: { rotation: { y: currentDeg * RAD } },
  };
  const back = { headBone: { rotation: { y: currentDeg * RAD } } };
  const group = { rotation: { y: bodyYaw }, userData: {} };
  const rig = { restDeg: 0, minDeg: -yawLimitDeg, maxDeg: yawLimitDeg, turnSpeedDeg };
  const state = { rig, currentDeg: 0, targetDeg: 0, additiveDeg: 0, appliedDeg: 0, currentYawDeg: currentDeg, targetYawDeg: currentDeg, requestedYawDeg: currentDeg };
  const avatarRef = {};
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const angleDiff = (target, current) => {
    let delta = target - current;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
  };
  const deadRad = 27.5 * RAD;
  const windowStub = {
    PerpRotation: {
      CREATURE_PERP_DEAD_RAD: deadRad,
      cameraPerpsForObject() { return cameraPerps; },
      perpClamp(clampState, rawTarget, centers, radius) {
        let nearestI = 0, nearestAbs = Infinity, nearestDelta = 0;
        for (let i = 0; i < centers.length; i++) {
          const delta = angleDiff(rawTarget, centers[i]);
          if (Math.abs(delta) < nearestAbs) { nearestI = i; nearestAbs = Math.abs(delta); nearestDelta = delta; }
        }
        clampState.perpSides ||= centers.map(() => null);
        clampState.locked ||= centers.map(() => false);
        const previousSide = clampState.perpSides[nearestI];
        const side = nearestDelta >= 0 ? 1 : -1;
        const snapTo = previousSide !== null && previousSide !== side ? centers[nearestI] + side * radius : null;
        clampState.perpSides[nearestI] = side;
        return {
          effectiveTarget: nearestAbs < radius ? centers[nearestI] + side * radius : rawTarget,
          snapTo,
        };
      },
    },
  };
  const applyYawDegrees = degrees => {
    front.headBone.rotation.y = degrees * RAD;
    back.headBone.rotation.y = degrees * RAD;
  };
  new Function('front','back','group','state','rig','yawLimitDeg','RAD','clamp','finite','window','avatarRef','applyYawDegrees','applyDegrees', headMathSource)(
    front, back, group, state, rig, yawLimitDeg, RAD, clamp, finite, windowStub, avatarRef, applyYawDegrees, () => {},
  );
  avatarRef.updateHeadYaw(requestDeg, dt);
  return {
    state,
    worldYawDeg: bodyDeg + state.currentYawDeg * (mirrored ? -1 : 1),
    boneYawDeg: front.headBone.rotation.y / RAD,
  };
}

const anatomyFallback = runHeadYawCase({ bodyDeg: 27.5, requestDeg: -30, yawLimitDeg: 30 });
assert(Math.abs(anatomyFallback.state.targetYawDeg) < 1e-9,
  'when the preferred deadzone edge is outside neck anatomy, the shared solver chooses the reachable safe body-edge angle');
assert.equal(anatomyFallback.state.deadzoneDebug.reachable, true,
  'anatomical fallback reports that a camera-safe yaw was still reachable');

const normalCross = runHeadYawCase({ bodyDeg: 62.5, requestDeg: 60, yawLimitDeg: 60, cameraPerps: [Math.PI / 2, -Math.PI / 2] });
assert(Math.abs(normalCross.state.currentYawDeg - 55) < 1e-9 && Math.abs(normalCross.worldYawDeg - 117.5) < 1e-9,
  'normal card side-crossing snaps to the opposite 27.5-degree camera edge instead of smoothing through edge-on');
const mirroredCross = runHeadYawCase({ bodyDeg: 62.5, mirrored: true, requestDeg: -60, yawLimitDeg: 60, cameraPerps: [Math.PI / 2, -Math.PI / 2] });
assert(Math.abs(mirroredCross.state.currentYawDeg + 55) < 1e-9 && Math.abs(mirroredCross.worldYawDeg - 117.5) < 1e-9,
  'grip-pivot mirrored cards reverse local yaw sign while landing on the same safe world-space camera edge');
assert.equal(mirroredCross.state.deadzoneDebug.visualParity, -1,
  'mirrored head-yaw diagnostics expose the reversed visual parity');

console.log('Current-architecture global animal head deadzone checks passed.');
