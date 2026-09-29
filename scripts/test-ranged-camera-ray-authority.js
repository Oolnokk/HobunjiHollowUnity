#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/combat/ranged-camera-ray-authority.js', 'utf8');
const loader = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8');
const rangedWeaponsSource = fs.readFileSync('docs/js/combat/ranged-weapons.js', 'utf8'); // Verifies release-frame aim and spawn share the same held transform sample.
const indexSource = fs.readFileSync('docs/index.html', 'utf8'); // Verifies warm clients fetch the updated combat loader.
assert.doesNotMatch(source, /setInterval\s*\(/, 'ranged authority adds no polling interval');
assert.doesNotMatch(source, /requestAnimationFrame\s*\(/, 'ranged authority adds no frame loop');

const authorityIndex = loader.indexOf('js/combat/ranged-camera-ray-authority.js?v='); // Version-independent ordering guard; cache-bust revisions should not invalidate behavior tests.
const focusIndex = loader.indexOf('js/combat/ranged-camera-focus.js?v=');
const alignmentIndex = loader.indexOf('js/combat/combat-camera-alignment-bridge.js?v=');
assert(authorityIndex >= 0 && focusIndex > authorityIndex && alignmentIndex > focusIndex,
  'actual-fire authority loads before ranged focus, while the post-focus combat/lunge bridge loads after it');
assert.match(loader, /HobunjiRangedCameraRayAuthority\?\.version\) >= 4/,
  'loader requires the reticle-target ranged camera ray authority API');
assert.match(indexSource, /combat-config-loader\.js\?v=20260928meleereticle1/,
  'index cache-busts the loader that selects the new ranged authority/focus modules');
assert.match(rangedWeaponsSource,
  /const heldTransform = deps\.getHeldRangedWorldTransform\?\.\(action\.itemKey\) \|\| null;[\s\S]{0,220}playerAimSolution\(action\.itemKey, heldTransform\?\.position\)/,
  'player release samples one held transform and feeds its exact position into the aim solution before spawning');
assert.match(rangedWeaponsSource,
  /function playerProjectileOrigin\(itemKey = deps\?\.getEquippedRangedKey\?\.\(\), sourcePosition = null\)[\s\S]{0,900}getHeldRangedWorldTransform\?\.\(itemKey\)/,
  'player projectile origin prefers the exact sampled/live held-world position before center-height fallback');

function assertVector(actual, expected, message) {
  assert(actual, message);
  for (const axis of ['x', 'y', 'z']) {
    assert.equal(Number(actual[axis]), Number(expected[axis]), `${message}: ${axis}`);
  }
}

const logs = [];
const player = { x: 0, y: 0 };
let baseDeps = null;
const windowStub = {
  __farmLog: message => logs.push(String(message)),
  HobunjiRangedCameraFocus: {
    attackCameraTarget: () => ({ source: 'interaction-first-surface', point: { x: 3, y: 1.5, z: 1 } }),
  },
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

assert.equal(windowStub.HobunjiRangedCameraRayAuthority.version, 4);
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
  getHeldRangedWorldTransform: () => ({ position: { x: 0.35, y: 0.9, z: -0.2 } }),
  getPlayerInteractionRay: trueCameraRay,
  getPlayerAimRay: focusSurfaceRay,
  getPlayerPerspectiveTarget: () => ({
    point: { x: 10, y: 0.8, z: 1 },
    cameraRay: trueCameraRay(),
    rayDistance: Math.hypot(12, -1.2, 0),
  }),
});
assert(baseDeps, 'underlying RangedWeapons.init receives authoritative deps');

const attackRay = baseDeps.getPlayerAimRay();
assert(attackRay, 'actual ranged fire receives an attack ray');
assertVector(attackRay.origin, { x: 0.35, y: 0.9, z: -0.2 }, 'attack ray starts at the exact held projectile spawn origin');
assert(attackRay.direction.x > 0.85, 'attack points generally toward the reticle surface');
assert(attackRay.direction.z > 0, 'shoulder parallax converges from the held origin toward the camera-ray surface');
assert(attackRay.direction.y > 0, 'surface-point elevation is preserved instead of being replaced by the horizon pitch');

const snapshot = windowStub.HobunjiRangedCameraRayAuthority.snapshot();
const solution = snapshot.lastSolution;
assert(solution, 'debug snapshot records perspective-point solution');
assert.equal(solution.itemKey, 'crossbow');
assert.equal(solution.rangeTiles, 9);
assert.equal(solution.targetSource, 'interaction-first-surface');
assertVector(solution.targetPoint, { x: 3, y: 1.5, z: 1 },
  'ranged fire uses the exact first surface beneath the reticle instead of the horizon point');

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
  'selected reticle surface target remains exactly on the centered camera ray');
assert(solution.cameraRayDistance > 0, 'selected camera-ray intersection is forward of the camera');
assertVector(solution.muzzle, { x: 0.35, y: 0.9, z: -0.2 }, 'debug solution records the exact held projectile launch origin');
assert.equal(snapshot.authority, 'held-launch-origin-to-reticle-target');
assert.equal(snapshot.updateMode, 'initialization-only-no-frame-hook');
assert.equal(snapshot.lastError, null);
assert(logs.some(line => line.includes('live held projectile origin') && line.includes('first real target point beneath the reticle')),
  'installation is visible in the mobile in-game debug log');

// If the scene/focus resolver is unavailable, the stable horizon point remains a safe fallback.
windowStub.HobunjiRangedCameraFocus.attackCameraTarget = () => null;
const fallbackRay = baseDeps.getPlayerAimRay();
assert(fallbackRay, 'ranged fire retains a bootstrap fallback when reticle surface targeting is unavailable');
const fallbackSnapshot = windowStub.HobunjiRangedCameraRayAuthority.snapshot();
assert.equal(fallbackSnapshot.lastSolution.targetSource, 'shared-perspective-point');
assertVector(fallbackSnapshot.lastSolution.targetPoint, { x: 10, y: 0.8, z: 1 }, 'fallback still uses the shared horizon point');

console.log('Ranged reticle-target authority checks passed.');
