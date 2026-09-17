#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/animal-head-yaw-deadzone.js', 'utf8');
const bridgeSource = fs.readFileSync('docs/js/player-body-attachment-bridge.js', 'utf8');
const loaderSource = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8');

assert.match(source,
  /const requestedTarget =[\s\S]{0,4000}perpClamp\([\s\S]{0,4000}const step =[\s\S]{0,800}state\.currentYawDeg =/,
  'camera deadzone selection happens inside the shared head-yaw target math before authored smoothing');
assert.match(source, /frontHeadBone\.rotation\.y = state\.currentYawDeg \* RAD[\s\S]{0,120}backHeadBone\.rotation\.y = state\.currentYawDeg \* RAD/,
  'the shared yaw authority writes the animal head bones directly');
assert.doesNotMatch(source, /requestAnimationFrame|onBeforeRender/,
  'head deadzone has no render-time/per-frame correction pass');
assert.doesNotMatch(source, /originalUpdateHeadYaw/,
  'the global deadzone path does not wrap and post-correct the old head-yaw function');
assert.doesNotMatch(bridgeSource, /HeadDeadzone|headDeadzone|updateHeadYaw/,
  'shoulder-pet attachment code no longer owns any head-yaw deadzone behavior');
assert.match(loaderSource, /animal-head-yaw-deadzone\.js\?v=20260916global2/,
  'the global head-yaw authority is loaded with its own cache-busted runtime URL');

const RAD = Math.PI / 180;
let originalHeadYawCalls = 0; // Must stay zero: the installed method is the yaw math, not a correction wrapper around legacy math.
let perspectiveResolveCount = 0; // Proves registered creatures use the live subject-aware camera path.

function makeAvatar(options = {}) {
  const state = {
    rig: { minDeg: -60, maxDeg: 60, turnSpeedDeg: Number(options.turnSpeedDeg) || 360 },
    currentYawDeg: 0,
    targetYawDeg: 0,
    frontHeadBone: { rotation: { y: 0 } },
    backHeadBone: { rotation: { y: 0 } },
  };
  return {
    group: {
      children: [],
      userData: options.userData || {},
      rotation: { y: Number(options.bodyYaw) || 0 },
      position: { x: Number(options.x) || 2, y: 0, z: Number(options.z) || 3 },
    },
    headRig: state,
    updateHeadYaw() {
      originalHeadYawCalls++;
      throw new Error('legacy head-yaw method must not run after global math installation');
    },
  };
}

function angleDiff(target, current) {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function clampToDeadzone(rawTarget, perps, deadzoneRad) {
  let nearest = null;
  for (const center of perps) {
    const delta = angleDiff(rawTarget, center);
    if (!nearest || Math.abs(delta) < Math.abs(nearest.delta)) nearest = { center, delta };
  }
  if (!nearest || Math.abs(nearest.delta) >= deadzoneRad) return rawTarget;
  const side = nearest.delta >= 0 ? 1 : -1;
  return nearest.center + side * deadzoneRad;
}

const combatDeps = {
  hostileObjects: [],
  companionObjects: [],
  animalObjects: [],
  worldObjects: [],
};
const context = {
  console,
  Math,
  Number,
  Array,
  Object,
  Set,
  window: {
    PNGPlaneAvatar: {
      buildAnimalPlaneAvatarModel(_THREE, _url, options = {}) { return makeAvatar(options); },
    },
    AnimalHeadRigRuntime: {
      applyRigToAvatar(_THREE, avatarRef) { return avatarRef; },
    },
    Combat: { deps: combatDeps },
    PerpRotation: {
      CREATURE_PERP_DEAD_RAD: Math.PI / 6,
      perspectivePerpsForState(state, fallback) {
        perspectiveResolveCount++;
        const registered = [
          ...combatDeps.hostileObjects,
          ...combatDeps.companionObjects,
          ...combatDeps.animalObjects,
          ...combatDeps.worldObjects,
        ].find(candidate => candidate?.perpState === state); // Verifies the resolver receives the same registered animal state the yaw solver found.
        assert.ok(registered, 'registered animal resolution receives that animal\'s body perp state');
        return fallback?.length ? fallback : [0, Math.PI];
      },
      cameraRelativePerpsAtWorldPosition(worldPosition, cameraPosition) {
        assert.ok(Number.isFinite(Number(worldPosition?.x)) && Number.isFinite(Number(cameraPosition?.x)),
          'unregistered animal fallback receives real world/camera positions');
        return [0, Math.PI];
      },
      perpClamp(_state, rawTarget, perps, deadzoneRad) {
        return { effectiveTarget: clampToDeadzone(rawTarget, Array.from(perps), deadzoneRad), snapTo: null };
      },
    },
    __hobunjiFurnitureDebug: { camState: { position: { x: 8, y: 4, z: 8 } } },
  },
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(source, context);

assert.equal(context.window.AnimalHeadYawDeadzone.version, 2,
  'global animal head-yaw authority installs');

const farmStyle = context.window.PNGPlaneAvatar.buildAnimalPlaneAvatarModel(null, 'farm.png', { bodyYaw: 0, turnSpeedDeg: 100 });
assert.equal(farmStyle.__hobunjiGlobalHeadDeadzoneMath, true,
  'an animal outside Combat registries still receives the shared yaw math at construction');
farmStyle.updateHeadYaw(0, 0.05);
assert.ok(Math.abs(farmStyle.headRig.targetYawDeg - 30) < 1e-9,
  'camera-safe target is solved to the creature deadzone edge before smoothing');
assert.ok(Math.abs(farmStyle.headRig.currentYawDeg - 5) < 1e-9,
  'authored turn speed smooths toward the already-safe target instead of correcting the rendered result afterward');
assert.ok(Math.abs(farmStyle.headRig.frontHeadBone.rotation.y - 5 * RAD) < 1e-9,
  'front head bone receives the smoothed safe yaw directly');
assert.ok(Math.abs(farmStyle.headRig.backHeadBone.rotation.y - 5 * RAD) < 1e-9,
  'back head bone receives the same smoothed safe yaw directly');

const wild = context.window.PNGPlaneAvatar.buildAnimalPlaneAvatarModel(null, 'wild.png', { bodyYaw: 1.1 });
wild.group.rotation.y = 1.1;
const wildOwner = {
  avatarRef: wild,
  pngRot: 0,
  perpState: { pixelProbeDebug: { cameraPerpsRad: [0, Math.PI] } },
};
combatDeps.hostileObjects.push(wildOwner);
wild.updateHeadYaw(0, 1);
assert.ok(Math.abs(wild.headRig.targetYawDeg - 30) < 1e-9,
  'registered wild animal uses its visible pngRot body basis and the same head deadzone');
assert.equal(perspectiveResolveCount, 1,
  'registered wild animal asks the live perspective resolver exactly once per yaw update');
assert.equal(wildOwner._headDeadzoneDebug, wild.headRig.deadzoneDebug,
  'registered animal exposes the same direct-yaw diagnostic on its entity and head rig');

const shoulder = context.window.PNGPlaneAvatar.buildAnimalPlaneAvatarModel(null, 'shoulder.png', { bodyYaw: 2.2 });
const shoulderOwner = {
  avatarRef: shoulder,
  stableRole: 'shoulderPet',
  pngRot: 0,
  perpState: { pixelProbeDebug: { cameraPerpsRad: [0, Math.PI] } },
};
combatDeps.companionObjects.push(shoulderOwner);
shoulder.updateHeadYaw(0, 1);
assert.ok(Math.abs(shoulder.headRig.targetYawDeg - 30) < 1e-9,
  'shoulder pets use the exact same shared yaw authority rather than a role-specific correction');
assert.equal(shoulder.__hobunjiGlobalHeadDeadzoneMath, true,
  'shoulder pet is marked by the same global installer as every other rigged animal');
assert.equal(perspectiveResolveCount, 2,
  'wild and shoulder-pet yaw updates each resolve their own live registered-animal camera state');

assert.equal(originalHeadYawCalls, 0,
  'no animal delegates to a legacy head-yaw call and then corrects it afterward');

console.log('Global animal head-yaw deadzone checks passed.');
