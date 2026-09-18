#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const avatarSource = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8'); // Shared animal head-rig implementation under test.
const perpSource = fs.readFileSync('docs/js/perp-rotation.js', 'utf8'); // Shared camera/deadzone implementation used by body and head yaw.
const materialSource = fs.readFileSync('docs/js/animal-head-material-response.js', 'utf8'); // Newer Compressibility/Stretchability wrapper compatibility.
const bridgeSource = fs.readFileSync('docs/js/player-body-attachment-bridge.js', 'utf8'); // Shoulder spline/frame bridge must not own head deadzone behavior.
const indexSource = fs.readFileSync('docs/index.html', 'utf8'); // Runtime cache-bust integration.

const helperStart = avatarSource.indexOf('const TWO_PI = Math.PI * 2;');
const applyRigStart = avatarSource.indexOf('function applyAnimalHeadRig(', helperStart);
assert(helperStart >= 0 && applyRigStart > helperStart, 'module-level animal head-yaw deadzone helpers are present');
const helperSource = avatarSource.slice(helperStart, applyRigStart);

const updateYawStart = avatarSource.indexOf('avatarRef.updateHeadYaw =', applyRigStart);
const updateYawEnd = avatarSource.indexOf('avatarRef.setHeadAdditiveRotation =', updateYawStart);
assert(updateYawStart >= 0 && updateYawEnd > updateYawStart, 'shared animal head-rig updateHeadYaw implementation is present');
const updateYawSource = avatarSource.slice(updateYawStart, updateYawEnd);
const solveIndex = updateYawSource.indexOf('solveAnimalHeadYawDeadzone(headYawDeadzone, degrees)');
const stepIndex = updateYawSource.indexOf('const step = rig.turnSpeedDeg * delta');
const stateWriteIndex = updateYawSource.indexOf('state.currentYawDeg =');
const boneWriteIndex = updateYawSource.indexOf('applyYawDegrees(state.currentYawDeg)');
assert(solveIndex >= 0 && stepIndex > solveIndex && stateWriteIndex > stepIndex && boneWriteIndex > stateWriteIndex,
  'camera-safe target/state integration happens before the head bones are written');
assert.match(updateYawSource, /constrainAnimalHeadYawState[\s\S]*snapYawDeg[\s\S]*constrainAnimalHeadYawState/,
  'the integrated head state is constrained on both sides of the forbidden-interval side swap');
assert.doesNotMatch(updateYawSource, /onBeforeRender|requestAnimationFrame/,
  'shared head-yaw math owns no render hook or independent per-frame correction loop');

assert.match(helperSource, /nearestReachableAnimalHeadYaw[\s\S]*no-camera-safe-yaw-within-authored-neck-range/,
  'solver chooses a reachable safe angle inside authored neck anatomy');
assert.match(helperSource, /clamped\?\.snapTo[\s\S]*Hard side-swap avoids rendering through the flat-card edge-on interval/,
  'solver consumes the shared deadzone side-change as a discrete 2D side swap');
assert.match(helperSource, /matrixWorld\?\.determinant[\s\S]*visualParity/,
  'grip-pivot mirrored shoulder cards reverse local-yaw visual parity');
assert.match(helperSource, /elements\?\.\[8\][\s\S]*elements\?\.\[10\][\s\S]*Math\.PI \/ 2/,
  'visible body yaw comes from the rendered front card world basis, including ordinary planeDelta and authoritative shoulder-root transforms');

assert.match(perpSource, /function cameraPerpsForObject\(object, fallbackPerps = null\)/,
  'PerpRotation exposes camera centers for animal roots without a registered perpState');
assert.match(perpSource, /cameraRelativePerpsAtWorldPosition,[\s\S]{0,120}cameraPerpsForObject,[\s\S]{0,120}perspectivePerpsForState/,
  'generic object camera-perp resolution is exported beside the existing subject-aware resolver');
assert.match(materialSource, /wrapAfter\('updateHeadYaw'\)/,
  'Stretchability response remains outside updateHeadYaw and observes final constrained yaw');
assert.match(materialSource, /const result = original\.apply\(this, args\);[\s\S]{0,100}applyCurrentResponse\(\)/,
  'material response still refreshes only after shared yaw math finishes');
assert.doesNotMatch(bridgeSource, /HeadDeadzone|headDeadzone|head-yaw deadzone/i,
  'player body/shoulder attachment bridge owns no animal head-deadzone behavior');
assert.equal(fs.existsSync('docs/js/animal-head-yaw-deadzone.js'), false,
  'no standalone deadzone wrapper module remains');
assert.match(indexSource, /png-plane-avatar\.js\?v=20260918headdeadzone1/,
  'game cache-busts the changed shared animal head-rig runtime');
assert.match(indexSource, /perp-rotation\.js\?v=20260918headdeadzone1/,
  'game cache-busts the changed shared deadzone helper');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}
const context = {
  console, Math, Number, Array, Object, WeakMap, Date,
  performance: { now: () => 100 },
  THREE: { MathUtils: { degToRad: degrees => degrees * Math.PI / 180 }, Vector3 },
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
const unregisteredAnimalRoot = { position: { x: 1, y: 0, z: 0 } }; // Nursery/named-style root: no Combat/perpState registration.
const perps = Array.from(context.window.PerpRotation.cameraPerpsForObject(unregisteredAnimalRoot, []));
assert.equal(perps.length, 2, 'generic animal-root camera resolver returns both edge-on camera centers');
assert(Math.abs(perps[0]) < 1e-9 && Math.abs(Math.abs(perps[1]) - Math.PI) < 1e-9,
  'generic camera centers use the same world-position bearing math as registered creatures');

// Execute the exact production helper functions and exact production updateHeadYaw
// assignment in a tiny rig harness. This catches target/integration regressions
// without needing to duplicate the full Three.js skinning builder.
const RAD = Math.PI / 180;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const angleDiff = (target, current) => {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
};
let activeCameraPerps = [0, Math.PI]; // Reassigned per harness case to exercise different body/camera geometry.
const deadzoneWindow = {
  PerpRotation: {
    CREATURE_PERP_DEAD_RAD: 27.5 * RAD,
    cameraPerpsForObject() { return activeCameraPerps; },
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
      return { effectiveTarget: nearestAbs < radius ? centers[nearestI] + side * radius : rawTarget, snapTo };
    },
  },
};
const productionHelpers = new Function('RAD','clamp','finite','window',
  helperSource + '; return { solveAnimalHeadYawDeadzone, constrainAnimalHeadYawState };'
)(RAD, clamp, finite, deadzoneWindow);

function runHeadYawCase({ bodyDeg, mirrored = false, requestDeg, yawLimitDeg, currentDeg = 0, turnSpeedDeg = 120, dt = 1 / 60, cameraPerps = [0, Math.PI] }) {
  activeCameraPerps = cameraPerps;
  const bodyYaw = bodyDeg * RAD;
  const planeYaw = bodyYaw + Math.PI / 2;
  const frontMesh = {
    matrixWorld: {
      elements: [0,0,0,0, 0,0,0,0, Math.sin(planeYaw),0,Math.cos(planeYaw),0, 0,0,0,1],
      determinant() { return mirrored ? -1 : 1; },
    },
    updateWorldMatrix() {},
  };
  const group = { rotation: { y: bodyYaw }, userData: {} };
  const rig = { restDeg: 0, minDeg: -yawLimitDeg, maxDeg: yawLimitDeg, turnSpeedDeg };
  const state = { rig, currentYawDeg: currentDeg, targetYawDeg: currentDeg, requestedYawDeg: currentDeg };
  const headYawDeadzone = { frontMesh, group, state, yawLimitDeg, perpState: {} };
  const avatarRef = {};
  let boneYawDeg = currentDeg;
  const applyYawDegrees = degrees => { boneYawDeg = degrees; };
  new Function(
    'avatarRef','state','rig','headYawDeadzone','solveAnimalHeadYawDeadzone','constrainAnimalHeadYawState',
    'finite','clamp','yawLimitDeg','group','applyYawDegrees',
    updateYawSource,
  )(
    avatarRef, state, rig, headYawDeadzone,
    productionHelpers.solveAnimalHeadYawDeadzone, productionHelpers.constrainAnimalHeadYawState,
    finite, clamp, yawLimitDeg, group, applyYawDegrees,
  );
  avatarRef.updateHeadYaw(requestDeg, dt);
  return { state, boneYawDeg, worldYawDeg: bodyDeg + state.currentYawDeg * (mirrored ? -1 : 1) };
}

const anatomyFallback = runHeadYawCase({ bodyDeg: 27.5, requestDeg: -30, yawLimitDeg: 30 });
assert(Math.abs(anatomyFallback.state.targetYawDeg) < 1e-9,
  'unreachable preferred edge falls back to the other camera-safe angle inside neck anatomy');
assert.equal(anatomyFallback.state.deadzoneDebug.reachable, true,
  'anatomical fallback reports that a safe yaw was reachable');
assert(Math.abs(anatomyFallback.boneYawDeg) < 1e-9,
  'bone receives the constrained integrated yaw directly');

const normalCross = runHeadYawCase({ bodyDeg: 62.5, requestDeg: 60, yawLimitDeg: 60, cameraPerps: [Math.PI / 2, -Math.PI / 2] });
assert(Math.abs(normalCross.state.currentYawDeg - 55) < 1e-9 && Math.abs(normalCross.worldYawDeg - 117.5) < 1e-9,
  'normal card side-crossing snaps to the opposite 27.5-degree camera edge instead of smoothing through edge-on');
const mirroredCross = runHeadYawCase({ bodyDeg: 62.5, mirrored: true, requestDeg: -60, yawLimitDeg: 60, cameraPerps: [Math.PI / 2, -Math.PI / 2] });
assert(Math.abs(mirroredCross.state.currentYawDeg + 55) < 1e-9 && Math.abs(mirroredCross.worldYawDeg - 117.5) < 1e-9,
  'grip-pivot mirrored card reverses local yaw sign while reaching the same safe world-space edge');
assert.equal(mirroredCross.state.deadzoneDebug.visualParity, -1,
  'mirrored head-yaw diagnostics expose reversed visual parity');

console.log('Current-architecture global animal head deadzone checks passed.');
