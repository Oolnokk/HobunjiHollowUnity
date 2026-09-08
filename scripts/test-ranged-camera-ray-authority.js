#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/combat/ranged-camera-ray-authority.js', 'utf8');
assert.doesNotMatch(source, /setInterval\s*\(/, 'ranged authority adds no polling interval');
assert.doesNotMatch(source, /requestAnimationFrame\s*\(/, 'ranged authority adds no frame loop');

const logs = [];
const player = { x: 0, y: 0 };
let baseDeps = null;
const windowStub = {
  __farmLog: message => logs.push(String(message)),
  RangedWeapons: {
    config: { crossbow: { rangeTiles: 9 } },
    equippedRangedKey: () => 'crossbow',
    init(injectedDeps) {
      baseDeps = injectedDeps;
      return true;
    },
  },
};

vm.runInNewContext(source, { window: windowStub, Date, Math, console }, {
  filename: 'ranged-camera-ray-authority.js',
});

assert.equal(windowStub.HobunjiRangedCameraRayAuthority.version, 1);
const authorityInit = windowStub.RangedWeapons.init;

// This is the dependency shape ranged-camera-focus passes to its captured base
// initializer: getPlayerAimRay may already contain focus/surface convergence,
// while getPlayerInteractionRay is still the true centered camera ray. The
// inner authority wrapper must deliberately choose the latter for actual fire.
const trueCameraRay = () => ({
  origin: { x: -2, y: 2, z: 1 },
  direction: { x: 4, y: -0.4, z: 0 },
});
const focusSurfaceRay = () => ({
  origin: { x: 0, y: 0.55, z: 0 },
  direction: { x: 0, y: 0, z: 1 },
});

authorityInit({
  TILE: 64,
  player,
  getActorWorldY: () => 0,
  worldSurfaceY: () => 0,
  getEquippedRangedKey: () => 'crossbow',
  getPlayerInteractionRay: trueCameraRay,
  getPlayerAimRay: focusSurfaceRay,
});
assert(baseDeps, 'underlying RangedWeapons.init receives authoritative deps');

const attackRay = baseDeps.getPlayerAimRay();
assert(attackRay, 'actual ranged fire receives an attack ray');
assert.deepEqual(attackRay.origin, { x: 0, y: 0.55, z: 0 }, 'attack ray starts at the muzzle');
assert(attackRay.direction.x > 0.98, 'attack points generally camera-forward');
assert(attackRay.direction.z > 0, 'shoulder parallax converges toward the camera ray instead of firing parallel');
assert.notDeepEqual(attackRay.direction, { x: 0, y: 0, z: 1 }, 'near-surface focus ray cannot override actual launch direction');

const snapshot = windowStub.HobunjiRangedCameraRayAuthority.snapshot();
const solution = snapshot.lastSolution;
assert(solution, 'debug snapshot records max-range solution');
assert.equal(solution.itemKey, 'crossbow');
assert.equal(solution.rangeTiles, 9);
assert(Math.abs(solution.horizontalTargetDistance - 9) < 1e-9,
  'target point lies exactly one authored weapon range from the muzzle in the ground plane');

const raw = trueCameraRay();
const rawLength = Math.hypot(raw.direction.x, raw.direction.y, raw.direction.z);
const d = {
  x: raw.direction.x / rawLength,
  y: raw.direction.y / rawLength,
  z: raw.direction.z / rawLength,
};
const targetDelta = {
  x: solution.targetPoint.x - raw.origin.x,
  y: solution.targetPoint.y - raw.origin.y,
  z: solution.targetPoint.z - raw.origin.z,
};
const crossXY = targetDelta.x * d.y - targetDelta.y * d.x;
const crossXZ = targetDelta.x * d.z - targetDelta.z * d.x;
const crossYZ = targetDelta.y * d.z - targetDelta.z * d.y;
assert(Math.hypot(crossXY, crossXZ, crossYZ) < 1e-8,
  'maximum-range target remains exactly on the centered camera ray');
assert(solution.cameraRayDistance > 0, 'selected camera-ray intersection is forward of the camera');
assert.equal(snapshot.authority, 'muzzle-to-max-range-point-on-camera-ray');
assert.equal(snapshot.updateMode, 'initialization-only-no-frame-hook');
assert.equal(snapshot.lastError, null);
assert(logs.some(line => line.includes('weapon max-range point along the camera ray')),
  'installation is visible in the mobile in-game debug log');

console.log('Ranged camera max-range ray authority checks passed.');