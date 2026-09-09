#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/combat/combat-camera-alignment-bridge.js', 'utf8');
const loader = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8');
const game = fs.readFileSync('docs/game.js', 'utf8');
const rangedFocus = fs.readFileSync('docs/js/combat/ranged-camera-focus.js', 'utf8');
const rangedWeapons = fs.readFileSync('docs/js/combat/ranged-weapons.js', 'utf8');
const debugHitboxes = fs.readFileSync('docs/js/debug-hitboxes.js', 'utf8'); // Verifies every alignment ray is exposed through the existing interaction-ray overlay.
const pixelProbe = fs.readFileSync('docs/js/pixel-probe.js', 'utf8'); // Verifies the same disagreement is readable on mobile without developer tools.

const focusIndex = loader.indexOf('js/combat/ranged-camera-focus.js?v=20260906f');
const alignmentIndex = loader.indexOf('js/combat/combat-camera-alignment-bridge.js?v=20260908cameraauthority1');
const dualRoleIndex = loader.indexOf('js/combat/ranged-dual-role-anim-style.js?v=20260905a');
assert(focusIndex >= 0 && alignmentIndex > focusIndex && dualRoleIndex > alignmentIndex,
  'camera authority bridge loads after ranged focus and before later ranged adapters');
assert.match(loader, /HobunjiCombatCameraAlignment\?\.version\) >= 3/,
  'loader requires the camera authority bridge v3 API');
assert.doesNotMatch(source, /setInterval\s*\(/, 'alignment bridge adds no polling interval');
assert.doesNotMatch(source, /requestAnimationFrame\s*\(/, 'alignment bridge adds no animation-frame loop');
assert.doesNotMatch(source, /\.update\s*=\s*function/, 'alignment bridge does not wrap a per-frame update');

// The backwards 4c2756 camera-to-movement convergence must stay gone. Native
// shoulder movement is already camera-relative, so the rework must not mutate
// the camera to make its reticle obey a pre-existing player-forward line.
assert.doesNotMatch(game, /projectShoulderGroundHitToRootForward/,
  'game no longer projects the reticle onto a player-root-forward line');
assert.doesNotMatch(game, /_shoulderSurfCameraConvergence/,
  'game no longer stores or applies shoulder camera convergence');
assert.match(game,
  /if \(activeCameraMode === SHOULDER_SURF_MODE && \(ix !== 0 \|\| iy !== 0\)\) \{\s*const aim = shoulderCameraRayFacingAngle\(\);/,
  'ordinary shoulder movement follows the true centered camera ray');
assert.match(game,
  /function shoulderCameraRayFacingAngle\(\)[\s\S]{0,500}currentPlayerAimRay\(\)/,
  'shared shoulder bearing is derived from the actual camera ray');
assert.match(game,
  /const targetWorldYaw = activeCameraMode === SHOULDER_SURF_MODE\s*\? -shoulderCameraRayFacingAngle\(\) \+ Math\.PI \/ 2/,
  'player head follows camera authority rather than the height-sensitive ground bearing');
assert.match(game,
  /const camFacing = shoulderCameraRayFacingAngle\(\);\s*facingAngle = camFacing;/,
  'stationary and moving body facing derive directly from camera authority without lag');
assert.doesNotMatch(game, /SHOULDER_SURF_BODY_FREE_LOOK_RAD/,
  'stationary physical facing no longer imposes a free-look dead zone on camera-authored rotation');
assert.match(game,
  /getPlayerMovementAlignmentDebug: currentPlayerMovementAlignmentDebug/,
  'raycast debug receives the complete player movement-alignment snapshot');
for (const label of ['movement/camera ray', 'ground aim', 'melee aim', 'last lunge', 'ranged attack', 'logical body', 'rendered body', 'rendered head', 'velocity']) {
  assert(debugHitboxes.includes(label), `raycast overlay labels ${label}`);
}
assert.match(pixelProbe, /Movement rays: camera=.*groundAim=.*skew=.*logicalBody=.*renderedBody=/,
  'mobile Pixel Probe reports the same movement/body ray separation numerically');
assert.match(pixelProbe, /head↔camera=/,
  'mobile Pixel Probe reports the head-to-camera-ray anchor delta directly');
assert.doesNotMatch(debugHitboxes, /requestAnimationFrame\s*\(|setInterval\s*\(/,
  'expanded ray debug adds no independent frame loop or polling timer');
assert.match(game, /const aimDirection = currentPlayerMeleeAimDirection\(\);/,
  'player lunge setup still has one shared aim-direction boundary for the bridge to correct');

// Ranged focus already owns the right max-range construction: start with the
// real camera ray, project the attack origin onto it, then walk one configured
// weapon range farther along that ray. The bridge must preserve that camera
// origin instead of re-rooting the ray at the muzzle.
assert.match(rangedFocus, /fallbackRayDistance = Math\.max\(0\.5, alongToAttack \+ range\)/,
  'ranged focus uses the weapon maximum range along the camera ray');
assert.match(rangedWeapons, /alongMuzzle \+ def\.rangeTiles/,
  'ranged weapon fallback keeps configured rangeTiles in its aim solution');

function assertVector(actual, expected, message, epsilon = 1e-9) {
  assert(actual, message);
  for (const axis of ['x', 'y', 'z']) {
    assert(Math.abs(Number(actual[axis]) - Number(expected[axis])) <= epsilon,
      `${message}: ${axis} expected ${expected[axis]}, got ${actual[axis]}`);
  }
}

function normalized(v) {
  const length = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

const logs = [];
const player = {
  x: 128, y: 192,
  lunging: false,
  lungeHeightUnits: 1,
  lungeDirX: 0, lungeDirY: 0,
  lungeDistancePx: 0, lungeHopUnits: 0, lungeAimPitch: 0,
};
const nativeInteractionRay = () => ({
  origin: { x: -4, y: 2.4, z: 3 },
  direction: { x: 4, y: 0, z: 0 }, // deliberately non-normalized; bridge must normalize it.
});
const nativeAimRay = () => ({
  origin: { x: -4, y: 2.4, z: 3 },
  direction: { x: 1, y: 0, z: 0 },
});

let focusPrivateInteractionRay = null;
let baseRangedDeps = null;

// Emulates ranged-camera-focus's actual dependency contract. Its compatibility
// dependency is private to the focus resolver; ordinary interaction semantics
// remain untouched. The focus resolver then builds its attack ray from the
// muzzle toward the weapon-range point on this true camera ray.
function focusLikeRangedInit(injectedDeps) {
  const capturedAimRay = injectedDeps.getPlayerAimRay;
  focusPrivateInteractionRay = injectedDeps.getMuzzleParallelInteractionRay || injectedDeps.getPlayerInteractionRay;
  const rangeAimRay = () => {
    const cameraRay = focusPrivateInteractionRay?.() || capturedAimRay?.();
    const dir = normalized(cameraRay.direction);
    const muzzle = {
      x: injectedDeps.player.x / injectedDeps.TILE,
      y: injectedDeps.getActorWorldY(injectedDeps.player) + 0.55,
      z: injectedDeps.player.y / injectedDeps.TILE,
    };
    const cameraToMuzzle = {
      x: muzzle.x - cameraRay.origin.x,
      y: muzzle.y - cameraRay.origin.y,
      z: muzzle.z - cameraRay.origin.z,
    };
    const alongToMuzzle = cameraToMuzzle.x * dir.x + cameraToMuzzle.y * dir.y + cameraToMuzzle.z * dir.z;
    const rangeTiles = 9;
    const rayDistance = Math.max(0.5, alongToMuzzle + rangeTiles);
    const point = {
      x: cameraRay.origin.x + dir.x * rayDistance,
      y: cameraRay.origin.y + dir.y * rayDistance,
      z: cameraRay.origin.z + dir.z * rayDistance,
    };
    return {
      origin: muzzle,
      direction: normalized({ x: point.x - muzzle.x, y: point.y - muzzle.y, z: point.z - muzzle.z }),
      point,
      rayDistance,
    };
  };
  baseRangedDeps = {
    ...injectedDeps,
    getPlayerAimRay: rangeAimRay,
  };
  return true;
}

let combatDeps = null;
function focusLikeCombatInit(injectedDeps) {
  combatDeps = injectedDeps;
  windowStub.Combat.deps = injectedDeps;
  // Emulate ranged-camera-focus's post-init replacements. The alignment bridge
  // restores native head/melee callbacks after this initializer returns.
  injectedDeps.getPlayerMeleeAimDirection = () => ({ x: 0, y: 0, z: 1 });
  injectedDeps.getPlayerMeleeAimPitch = () => 0.9;
  return true;
}

const windowStub = {
  __farmLog: message => logs.push(String(message)),
  RangedWeapons: { init: focusLikeRangedInit },
  Combat: {
    init: focusLikeCombatInit,
    deps: null,
    meleeLungeProfile(distancePx, pitch, hopUnits) {
      return { distancePx, pitch, hopUnits };
    },
  },
};

const context = { window: windowStub, Date, Math, console };
vm.runInNewContext(source, context, { filename: 'combat-camera-alignment-bridge.js' });

assert.equal(windowStub.HobunjiCombatCameraAlignment.version, 3);
assert.equal(windowStub.HobunjiCombatCameraAlignment.debugSnapshot().updateMode,
  'initialization-only-no-frame-hook');

const rangedDeps = {
  TILE: 64,
  player,
  getActorWorldY: () => 0.25,
  worldSurfaceY: () => 0,
  getPlayerInteractionRay: nativeInteractionRay,
  getPlayerAimRay: nativeAimRay,
};
windowStub.RangedWeapons.init(rangedDeps);
assert.equal(typeof focusPrivateInteractionRay, 'function', 'focus wrapper captured its private camera ray');
assert(baseRangedDeps, 'underlying ranged initializer still receives deps');

const privateRay = focusPrivateInteractionRay();
assertVector(privateRay.origin, { x: -4, y: 2.4, z: 3 },
  'focus-private resolver keeps the TRUE camera origin');
assertVector(privateRay.direction, { x: 1, y: 0, z: 0 },
  'focus-private resolver keeps the normalized camera direction');

const ordinaryInteraction = baseRangedDeps.getPlayerInteractionRay();
assertVector(ordinaryInteraction.origin, { x: -4, y: 2.4, z: 3 },
  'ordinary RangedWeapons interaction ray keeps the real camera origin');
assertVector(ordinaryInteraction.direction, { x: 4, y: 0, z: 0 },
  'ordinary world interaction semantics remain untouched');

const focusAimRay = baseRangedDeps.getPlayerAimRay();
assertVector(focusAimRay.origin, { x: 2, y: 0.8, z: 3 },
  'actual ranged attack ray starts at the muzzle');
assert.equal(focusAimRay.rayDistance, 15,
  'camera target lies one 9-tile weapon range beyond the muzzle projection on the camera ray');
assertVector(focusAimRay.point, { x: 11, y: 2.4, z: 3 },
  'ranged target point is the configured maximum-range point along the camera ray');
assert(focusAimRay.direction.x > 0.98 && focusAimRay.direction.y > 0,
  'muzzle converges toward that camera-ray range point instead of forcing the camera toward the weapon');

const nativeMeleeDirection = () => ({ x: 0.8, y: 0.1, z: 0.2 });
const nativeMeleePitch = () => 0.1;
const meleeDeps = {
  TILE: 64,
  player,
  getPlayerInteractionRay: nativeInteractionRay,
  getPlayerAimRay: nativeAimRay,
  getPlayerMeleeAimDirection: nativeMeleeDirection,
  getPlayerMeleeAimPitch: nativeMeleePitch,
  beginCombatLunge(distancePx, durationS, hopUnits) {
    // Simulate the old target-derived result. The wrapper must replace this
    // displacement AFTER the native lunge has initialized its state.
    player.lunging = durationS > 0 && distancePx > 0;
    player.lungeDirX = 0;
    player.lungeDirY = 1;
    player.lungeDistancePx = distancePx;
    player.lungeHopUnits = hopUnits;
    player.lungeAimPitch = 0.9;
  },
};
windowStub.Combat.init(meleeDeps);
assert.equal(combatDeps, meleeDeps, 'underlying Combat.init still receives the original deps object');
assert.strictEqual(windowStub.Combat.deps.getPlayerMeleeAimDirection, nativeMeleeDirection,
  'native camera-derived melee/head direction is restored after focus initialization');
assert.strictEqual(windowStub.Combat.deps.getPlayerMeleeAimPitch, nativeMeleePitch,
  'native camera-derived melee/head pitch is restored after focus initialization');

player.lunging = false;
windowStub.Combat.deps.beginCombatLunge(128, 0.4, 0.3, { rangePx: 96 });
assert.equal(player.lunging, true, 'native lunge still initializes normally');
assert.equal(player.lungeDirX, 1, 'lunge horizontal X follows the centered camera ray');
assert.equal(player.lungeDirY, 0, 'lunge no longer follows a target-derived sideways direction');
assert.equal(player.lungeAimPitch, 0, 'lunge pitch follows the centered camera ray');
assert.equal(player.lungeDistancePx, 128, 'camera authority does not change authored lunge distance');
assert.equal(player.lungeHopUnits, 0.3, 'camera authority preserves authored lunge hop budget');

const debug = windowStub.HobunjiCombatCameraAlignment.debugSnapshot();
assert.equal(debug.rangedInitWrapped, true);
assert.equal(debug.combatInitWrapped, true);
assert.equal(debug.cameraRayDepsProvided, true, 'bridge handed focus the true camera-ray dependency');
assert.equal(debug.nativeMeleeDirectionRestored, true);
assert.equal(debug.nativeMeleePitchRestored, true);
assert.equal(debug.lungeAuthorityInstalled, true);
assert.equal(debug.lungeAuthorityCount, 1);
assert.equal(debug.movementAuthority, 'native-camera-relative-walk-plus-camera-ray-lunge');
assert.equal(debug.rangedAuthority, 'camera-ray-to-weapon-range');
assertVector(debug.lastCameraRay.origin, { x: -4, y: 2.4, z: 3 }, 'debug reports true camera origin');
assertVector(debug.lastLunge.direction, { x: 1, y: 0, z: 0 }, 'debug reports camera-forward lunge');
assert.equal(debug.lastError, null);
assert(logs.some(line => line.includes('camera/reticle ray authority installed')),
  'bridge installation is visible in the mobile in-game debug log');

console.log('Camera-authoritative movement/combat alignment checks passed.');
