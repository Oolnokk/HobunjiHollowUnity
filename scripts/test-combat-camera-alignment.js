#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/combat/combat-camera-alignment-bridge.js', 'utf8');
const loader = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8');

const focusIndex = loader.indexOf('js/combat/ranged-camera-focus.js?v=20260906f');
const alignmentIndex = loader.indexOf('js/combat/combat-camera-alignment-bridge.js?v=20260906a');
const dualRoleIndex = loader.indexOf('js/combat/ranged-dual-role-anim-style.js?v=20260905a');
assert(focusIndex >= 0 && alignmentIndex > focusIndex && dualRoleIndex > alignmentIndex,
  'camera alignment bridge loads after ranged focus and before later ranged adapters');
assert.match(loader, /HobunjiCombatCameraAlignment\?\.version\) >= 1/,
  'loader requires the camera alignment bridge API');
assert.doesNotMatch(source, /setInterval\s*\(/, 'alignment bridge adds no polling interval');
assert.doesNotMatch(source, /requestAnimationFrame\s*\(/, 'alignment bridge adds no animation-frame loop');
assert.doesNotMatch(source, /\.update\s*=\s*function/, 'alignment bridge does not wrap a per-frame update');

function assertVector(actual, expected, message) {
  assert(actual, message);
  assert.equal(Number(actual.x), Number(expected.x), `${message}: x`);
  assert.equal(Number(actual.y), Number(expected.y), `${message}: y`);
  assert.equal(Number(actual.z), Number(expected.z), `${message}: z`);
}

const logs = [];
const player = { x: 128, y: 192 };
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

// Emulates ranged-camera-focus's actual dependency contract: prefer the
// bridge's explicit muzzle-parallel ray for the private surface resolver,
// then spread the untouched deps (including the real getPlayerInteractionRay)
// for RangedWeapons itself.
function focusLikeRangedInit(injectedDeps) {
  const capturedAimRay = injectedDeps.getPlayerAimRay;
  focusPrivateInteractionRay = injectedDeps.getMuzzleParallelInteractionRay || injectedDeps.getPlayerInteractionRay;
  const wrappedDeps = {
    ...injectedDeps,
    getPlayerAimRay: () => focusPrivateInteractionRay?.() || capturedAimRay?.(),
  };
  baseRangedDeps = wrappedDeps;
  return true;
}

let combatDeps = null;
function focusLikeCombatInit(injectedDeps) {
  combatDeps = injectedDeps;
  windowStub.Combat.deps = injectedDeps;
  // Emulate ranged-camera-focus's post-init replacements which caused the head
  // to stop following the game's already-correct centered camera callbacks.
  injectedDeps.getPlayerMeleeAimDirection = () => ({ x: 0, y: 0, z: 1 });
  injectedDeps.getPlayerMeleeAimPitch = () => 0.9;
  return true;
}

const windowStub = {
  __farmLog: message => logs.push(String(message)),
  RangedWeapons: { init: focusLikeRangedInit },
  Combat: { init: focusLikeCombatInit, deps: null },
};

const context = {
  window: windowStub,
  Date,
  Math,
  console,
};
vm.runInNewContext(source, context, { filename: 'combat-camera-alignment-bridge.js' });

assert.equal(windowStub.HobunjiCombatCameraAlignment.version, 2);
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
assert.equal(typeof focusPrivateInteractionRay, 'function', 'focus wrapper captured its private interaction ray');
assert(baseRangedDeps, 'underlying ranged initializer still receives deps');

const privateRay = focusPrivateInteractionRay();
assertVector(privateRay.origin, { x: 2, y: 0.8, z: 3 },
  'focus-private surface ray is rooted at the projectile/muzzle origin');
assertVector(privateRay.direction, { x: 1, y: 0, z: 0 },
  'focus-private surface ray preserves the normalized native camera direction');

const ordinaryInteraction = baseRangedDeps.getPlayerInteractionRay();
assertVector(ordinaryInteraction.origin, { x: -4, y: 2.4, z: 3 },
  'ordinary RangedWeapons interaction ray keeps the real camera origin');
assertVector(ordinaryInteraction.direction, { x: 4, y: 0, z: 0 },
  'ordinary world interaction semantics remain untouched');

// This is the key 90-degree-shot regression. A pathological nearby surface at
// the player's side would previously create muzzle->surface = +Z. With the
// bridge, ranged-camera-focus can only march along +X from the muzzle, so its
// eventual getPlayerAimRay remains +X and RangedWeapons cannot feed +Z back into
// updateShoulderSurfReticleAim/head facing.
const focusAimRay = baseRangedDeps.getPlayerAimRay();
assertVector(focusAimRay.origin, { x: 2, y: 0.8, z: 3 }, 'focus aim ray uses muzzle origin');
assertVector(focusAimRay.direction, { x: 1, y: 0, z: 0 }, 'focus aim ray stays camera-forward');
const hypotheticalBadSideSurface = { x: 2, y: 0.8, z: 4 };
const oldBadDirection = {
  x: hypotheticalBadSideSurface.x - Number(privateRay.origin.x),
  y: hypotheticalBadSideSurface.y - Number(privateRay.origin.y),
  z: hypotheticalBadSideSurface.z - Number(privateRay.origin.z),
};
assert.deepEqual(oldBadDirection, { x: 0, y: 0, z: 1 }, 'fixture represents the reported right-angle failure');
assert.equal(Number(focusAimRay.direction.x), 1, 'actual bridged shot/facing direction stays camera-forward');
assert.equal(Number(focusAimRay.direction.z), 0, 'actual bridged shot/facing direction cannot turn 90 degrees sideways');

const nativeMeleeDirection = () => ({ x: 0.8, y: 0.1, z: 0.2 });
const nativeMeleePitch = () => 0.1;
const meleeDeps = {
  getPlayerMeleeAimDirection: nativeMeleeDirection,
  getPlayerMeleeAimPitch: nativeMeleePitch,
};
windowStub.Combat.init(meleeDeps);
assert.equal(combatDeps, meleeDeps, 'underlying Combat.init still receives the original deps object');
assert.strictEqual(windowStub.Combat.deps.getPlayerMeleeAimDirection, nativeMeleeDirection,
  'native camera-derived melee/head direction is restored after focus initialization');
assert.strictEqual(windowStub.Combat.deps.getPlayerMeleeAimPitch, nativeMeleePitch,
  'native camera-derived melee/head pitch is restored after focus initialization');
assertVector(windowStub.Combat.deps.getPlayerMeleeAimDirection(), { x: 0.8, y: 0.1, z: 0.2 },
  'restored melee/head direction returns the native camera vector');
assert.equal(windowStub.Combat.deps.getPlayerMeleeAimPitch(), 0.1);

const debug = windowStub.HobunjiCombatCameraAlignment.debugSnapshot();
assert.equal(debug.rangedInitWrapped, true);
assert.equal(debug.combatInitWrapped, true);
assert.equal(debug.muzzleRayDepsProvided, true, 'bridge handed the focus wrapper its explicit muzzle-parallel dependency');
assert.equal(debug.nativeMeleeDirectionRestored, true);
assert.equal(debug.nativeMeleePitchRestored, true);
assertVector(debug.lastMuzzleRay.direction, { x: 1, y: 0, z: 0 }, 'debug reports camera-forward muzzle ray');
assert.equal(debug.lastError, null);
assert(logs.some(line => line.includes('native camera-facing authority bridge installed')),
  'bridge installation is visible in the mobile in-game debug log');

console.log('Camera-authoritative combat alignment checks passed.');