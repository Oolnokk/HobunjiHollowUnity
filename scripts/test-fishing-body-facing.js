'use strict';
const assert = require('node:assert/strict'); // Checks fishing yaw and combat isolation.
const fs = require('node:fs'); // Reads the production facing/pose paths.
const vm = require('node:vm'); // Executes those paths without a WebGL renderer.
const game = fs.readFileSync('docs/game.js', 'utf8'); // Current gameplay implementation.
const facingStart = game.indexOf("        if (pairedPoseLocked) {"); // The preceding exclusive pose guard is part of production fishing-facing ownership.
const facingEnd = game.indexOf('        } else if (characterViewMode.enabled)', facingStart);
assert(facingStart >= 0 && facingEnd > facingStart, 'paired pose/fishing-facing branch must exist and remain ordered');
const facing = game.slice(facingStart, facingEnd) + '\n}'; // Real locked-pose, fish-catch and anchored-cast branches, closed before unrelated locomotion owners.
const poseStart = game.indexOf('          const fishingThrowHold = activeTool'); // Fishing-aware authored pose section.
const pose = game.slice(poseStart, game.indexOf('          _qFac.setFromAxisAngle(_tUp, vθ);', poseStart)); // Includes the actual final body and leg rotation writes.
for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 2, -Math.PI / 4]) {
  const target = { x: 3 + Math.sin(angle) * 5, y: 0.35, z: 7 + Math.cos(angle) * 5 }; // Cast tile in each tested direction.
  const context = {
    window: { Fishing: { state: { active: true, phase: 'waiting', anchorWorld: target } } },
    playerMesh: { position: { x: 3, z: 7 }, rotation: { y: 99 } },
    playerLegs: { group: { rotation: { y: 1 } } }, playerFacing: 2,
    pairedPoseLocked: false, // All ordinary fishing samples execute the same branch as the actual unlocked game loop.
    activeTool: 'harpoon', fishingThrowSpinVisual: {},
    THREE: { MathUtils: { degToRad: value => value * Math.PI / 180 } },
    sampled: { bodyYawRad: -152 * Math.PI / 180 }, combatSwingAlignToReticle: true, combatSwingAimTargetOverride: target,
    playerRangedReticleOrbitFrame: point => ({ yawRad: Math.atan2(point.x - 3, point.z - 7), pitchRad: -0.2 }), θ: 2,
  }; // Deliberately stale facing and authored backward twist reproduce the reported bug.
  vm.createContext(context);
  vm.runInContext(facing, context);
  assert(Math.abs(context.playerFacing - angle) < 1e-10);
  assert.equal(context.playerLegs.group.rotation.y, 0);
  context.pairedPoseLocked = true;
  context.playerMesh.rotation.y = 1.35; // Scripted kiss/dance heading must never be overwritten by a fishing target or camera.
  context.playerLegs.group.rotation.y = -.25; // The pair also owns the physical knee/foot orientation.
  vm.runInContext(facing, context);
  assert.equal(context.playerMesh.rotation.y, 1.35, 'exclusive paired facing overrides ordinary fishing aim');
  assert.equal(context.playerLegs.group.rotation.y, -.25, 'exclusive paired feet remain authored');
  context.pairedPoseLocked = false;
  vm.runInContext(facing, context); // Resuming ordinary fishing recovers its cast direction and flat-foot orientation.
  assert(Math.abs(context.playerFacing - angle) < 1e-10, 'fishing resumes after paired action release');
  for (const bodyYaw of [-152, 63, 2]) {
    context.sampled = { bodyYawRad: bodyYaw * Math.PI / 180 };
    vm.runInContext(`{${pose}}`, context);
    assert(Math.abs(context.playerMesh.rotation.y - (angle + bodyYaw * Math.PI / 180)) < 1e-10, 'fishing keeps the authored torso twist the spear frame is built on');
    assert(Math.abs(context.playerMesh.rotation.y + context.playerLegs.group.rotation.y - angle) < 1e-10, 'fishing feet face the cast during windup, strike and return');
  }
  context.playerLegs.group.rotation.y = 0;
  context.activeTool = 'ranged';
  context.fishingThrowSpinVisual = null;
  context.sampled = { bodyYawRad: -152 * Math.PI / 180 };
  vm.runInContext(`{${pose}}`, context);
  assert(Math.abs(context.playerMesh.rotation.y - (angle - 152 * Math.PI / 180)) < 1e-10, 'combat retains authored twist');
  assert.equal(context.playerLegs.group.rotation.y, 0, 'combat throws leave the legs with the body');
  context.window.Fishing.state.phase = 'caught';
  context.playerFacing = 0.42;
  vm.runInContext(facing, context);
  assert.equal(context.playerMesh.rotation.y, 0.42, 'catch presentation retains its camera-facing pose');
  context.window.Fishing.state.phase = 'waiting';
  for (const invalid of [{ x: 3, z: 7 }, { x: NaN, z: 7 }]) {
    context.window.Fishing.state.anchorWorld = invalid;
    vm.runInContext(facing, context);
    assert.equal(context.playerMesh.rotation.y, 0.42, 'degenerate casts preserve valid facing');
  }
}
console.log('Fishing feet facing, authored spear/torso yaw and catch presentation passed');
