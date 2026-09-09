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
const bodyComposer = fs.readFileSync('docs/js/player-body-transform-composer.js', 'utf8'); // Verifies the final render boundary cannot re-clamp an exact shared-point head aim.
const targetingConfig = fs.readFileSync('docs/config/scratchbones-config.js', 'utf8'); // Verifies the common endpoint remains horizon-distant rather than visually close to the player.

const focusIndex = loader.indexOf('js/combat/ranged-camera-focus.js?v=20260909perspectivepoint1');
const alignmentIndex = loader.indexOf('js/combat/combat-camera-alignment-bridge.js?v=20260909perspectivepoint1');
const dualRoleIndex = loader.indexOf('js/combat/ranged-dual-role-anim-style.js?v=20260905a');
assert(focusIndex >= 0 && alignmentIndex > focusIndex && dualRoleIndex > alignmentIndex,
  'camera authority bridge loads after ranged focus and before later ranged adapters');
assert.match(loader, /HobunjiCombatCameraAlignment\?\.version\) >= 4/,
  'loader requires the shared perspective-point bridge v4 API');
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
  /if \(activeCameraMode === SHOULDER_SURF_MODE && \(ix !== 0 \|\| iy !== 0\)\) \{\s*const aim = shoulderPerspectiveFacingAngle\(\);/,
  'ordinary shoulder movement faces the common perspective point');
assert.match(game,
  /function currentPlayerPerspectiveTarget\(\)[\s\S]{0,4200}point:[\s\S]{0,300}cameraRay:/,
  'one finite perspective target is placed directly on the actual center camera ray');
assert.match(targetingConfig, /"perspectivePointDistanceTiles":\s*160/,
  'shared point stays effectively horizon-distant while remaining inside the 200-unit camera far plane');
assert.match(game,
  /const x = Number\(head\?\.x\) \/ TILE;[\s\S]{0,240}const z = Number\(head\?\.z\) \/ TILE;/,
  'raw-pixel head-cache coordinates are converted before perspective-point projection');
assert.match(game,
  /const shoulderHeadDirection = activeCameraMode === SHOULDER_SURF_MODE[\s\S]{0,200}currentPlayerPerspectiveDirection/,
  'player head derives full yaw and pitch from its own origin to the shared point');
assert.match(game, /playerNeckJoint\.rotation\.order = 'YXZ'/,
  'player neck composes yaw before pitch so its visible 3D ray can meet the point exactly');
assert.match(game, /hobunjiPerspectiveAimLocked/,
  'shoulder aim marks its exact endpoint invariant for the final renderer boundary');
assert.match(bodyComposer, /const renderedYaw = perspectiveAimLocked\s*\? requestedYaw\s*:\s*THREE\.MathUtils\.clamp/,
  'render-time neck limiting preserves exact shared-point aim while retaining limits elsewhere');
assert.match(game,
  /const camFacing = shoulderPerspectiveFacingAngle\(\);\s*facingAngle = camFacing;/,
  'stationary and moving body facing derive directly from the shared point without lag');
assert.doesNotMatch(game, /SHOULDER_SURF_BODY_FREE_LOOK_RAD/,
  'stationary physical facing no longer imposes a free-look dead zone on camera-authored rotation');
assert.match(game,
  /getPlayerMovementAlignmentDebug: currentPlayerMovementAlignmentDebug/,
  'raycast debug receives the complete player movement-alignment snapshot');
for (const label of ['camera', 'head → point', 'body/movement → point', 'melee/lunge → point', 'ranged → point', 'shared perspective point']) {
  assert(debugHitboxes.includes(label), `raycast overlay labels ${label}`);
}
assert.match(pixelProbe, /Perspective point:.*cameraRay=.*beyondPlayer=/,
  'mobile Pixel Probe reports the one 3D target and configured horizon distance');
assert.match(pixelProbe, /Point convergence errors: head=.*bodyYaw=.*melee=.*lastLunge=.*lastRanged=/,
  'mobile Pixel Probe reports consumer-to-point errors directly');
assert.doesNotMatch(debugHitboxes, /requestAnimationFrame\s*\(|setInterval\s*\(/,
  'expanded ray debug adds no independent frame loop or polling timer');
assert.match(game, /const aimDirection = currentPlayerMeleeAimDirection\(\);/,
  'player lunge setup still has one shared aim-direction boundary for the bridge to correct');

// All combat adapters must accept the same finite point; authored attack range
// limits reach/travel but must not create a second target endpoint.
assert.match(rangedFocus, /function sharedPerspectiveAimTarget\(attackOrigin, metadata = \{\}\)/,
  'ranged focus re-roots the shared point at pose/melee origins without reraycasting');
assert.match(rangedWeapons, /alongMuzzle \+ def\.rangeTiles/,
  'ranged weapon fallback remains available outside shared shoulder aim');
assert.equal((game.match(/getPlayerPerspectiveTarget: currentPlayerPerspectiveTarget/g) || []).length, 2,
  'game injects the same point callback into combat and ranged initialization');

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
const nativePerspectiveTarget = () => ({
  point: { x: 11, y: 2.4, z: 3 },
  cameraRay: nativeInteractionRay(),
  rayDistance: 15,
}); // Shared finite endpoint used by ranged and lunge assertions below.

let focusPrivateInteractionRay = null;
let baseRangedDeps = null;

// Emulates ranged-camera-focus's actual dependency contract. Its compatibility
// dependency is private to the focus resolver; ordinary interaction semantics
// remain untouched. This lightweight stand-in keeps the legacy range fallback,
// while the bridge above it preserves the injected shared-point dependency.
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

assert.equal(windowStub.HobunjiCombatCameraAlignment.version, 4);
assert.equal(windowStub.HobunjiCombatCameraAlignment.debugSnapshot().updateMode,
  'initialization-only-no-frame-hook');

const rangedDeps = {
  TILE: 64,
  player,
  getActorWorldY: () => 0.25,
  worldSurfaceY: () => 0,
  getPlayerInteractionRay: nativeInteractionRay,
  getPlayerAimRay: nativeAimRay,
  getPlayerPerspectiveTarget: nativePerspectiveTarget,
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
  'focus stand-in still reports its legacy camera-ray distance');
assertVector(focusAimRay.point, { x: 11, y: 2.4, z: 3 },
  'ranged target point coincides with the injected shared perspective point');
assert(focusAimRay.direction.x > 0.98 && focusAimRay.direction.y > 0,
  'muzzle converges toward that point instead of forcing the camera toward the weapon');

const nativeMeleeDirection = () => ({ x: 0.8, y: 0.1, z: 0.2 });
const nativeMeleePitch = () => 0.1;
const meleeDeps = {
  TILE: 64,
  player,
  getActorWorldY: () => 0.25,
  getPlayerInteractionRay: nativeInteractionRay,
  getPlayerAimRay: nativeAimRay,
  getPlayerPerspectiveTarget: nativePerspectiveTarget,
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
assert(Math.abs(player.lungeAimPitch - Math.atan2(1.6, 9)) < 1e-9,
  'lunge pitch uses verticality from its real origin to the shared point');
assert.equal(player.lungeDistancePx, 128, 'camera authority does not change authored lunge distance');
assert.equal(player.lungeHopUnits, 0.3, 'camera authority preserves authored lunge hop budget');

const debug = windowStub.HobunjiCombatCameraAlignment.debugSnapshot();
assert.equal(debug.rangedInitWrapped, true);
assert.equal(debug.combatInitWrapped, true);
assert.equal(debug.cameraRayDepsProvided, true, 'bridge handed focus the true camera-ray dependency');
assert.equal(debug.perspectiveTargetDepsProvided, true, 'bridge preserved the shared point dependency');
assert.equal(debug.nativeMeleeDirectionRestored, true);
assert.equal(debug.nativeMeleePitchRestored, true);
assert.equal(debug.lungeAuthorityInstalled, true);
assert.equal(debug.lungeAuthorityCount, 1);
assert.equal(debug.movementAuthority, 'native-player-to-perspective-point-walk-and-lunge');
assert.equal(debug.rangedAuthority, 'muzzle-to-shared-perspective-point');
assertVector(debug.lastCameraRay.origin, { x: -4, y: 2.4, z: 3 }, 'debug reports true camera origin');
assertVector(debug.lastLunge.targetPoint, { x: 11, y: 2.4, z: 3 }, 'debug reports the exact shared lunge endpoint');
assert.equal(debug.lastLunge.targetSource, 'shared-perspective-point');
assert.equal(debug.lastError, null);
assert(logs.some(line => line.includes('shared perspective-point authority installed')),
  'bridge installation is visible in the mobile in-game debug log');

console.log('Shared perspective-point movement/combat alignment checks passed.');
