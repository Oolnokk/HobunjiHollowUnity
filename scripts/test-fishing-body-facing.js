'use strict';
const assert = require('node:assert/strict'); // Checks fishing yaw and combat isolation.
const fs = require('node:fs'); // Reads the production facing/pose paths.
const vm = require('node:vm'); // Executes those paths without a WebGL renderer.
const game = fs.readFileSync('docs/game.js', 'utf8'); // Current gameplay implementation.
const facing = game.slice(game.indexOf("        if (window.Fishing?.state?.phase === 'caught')"), game.indexOf('        } else if (characterViewMode.enabled)', game.indexOf("        if (window.Fishing?.state?.phase === 'caught')"))) + '\n}'; // Fishing branches before unrelated locomotion owners.
const poseStart = game.indexOf('          const bodyYawRad = activeTool'); // Fishing-aware authored pose section.
const pose = game.slice(poseStart, game.indexOf('          _qFac.setFromAxisAngle(_tUp, vθ);', poseStart)); // Includes the actual final body rotation write.
for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 2, -Math.PI / 4]) {
  const target = { x: 3 + Math.sin(angle) * 5, y: 0.35, z: 7 + Math.cos(angle) * 5 }; // Cast tile in each tested direction.
  const context = {
    window: { Fishing: { state: { active: true, phase: 'waiting', anchorWorld: target } } },
    playerMesh: { position: { x: 3, z: 7 }, rotation: { y: 99 } },
    playerLegs: { group: { rotation: { y: 1 } } }, playerFacing: 2,
    activeTool: 'harpoon', fishingThrowSpinVisual: {},
    THREE: { MathUtils: { degToRad: value => value * Math.PI / 180 } },
    chan: () => -152, combatSwingAlignToReticle: true, combatSwingAimTargetOverride: target,
    playerRangedReticleOrbitFrame: point => ({ yawRad: Math.atan2(point.x - 3, point.z - 7), pitchRad: -0.2 }), θ: 2,
  }; // Deliberately stale facing and authored backward twist reproduce the reported bug.
  vm.createContext(context);
  vm.runInContext(facing, context);
  assert(Math.abs(context.playerFacing - angle) < 1e-10);
  assert.equal(context.playerLegs.group.rotation.y, 0);
  for (const bodyYaw of [-152, 63, 2]) {
    context.chan = () => bodyYaw;
    vm.runInContext(`{${pose}}`, context);
    assert(Math.abs(context.playerMesh.rotation.y - angle) < 1e-10, 'fishing faces the cast during windup, strike and return');
  }
  context.activeTool = 'ranged';
  context.fishingThrowSpinVisual = null;
  context.chan = () => -152;
  vm.runInContext(`{${pose}}`, context);
  assert(Math.abs(context.playerMesh.rotation.y - (angle - 152 * Math.PI / 180)) < 1e-10, 'combat retains authored twist');
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
console.log('Fishing body facing, authored combat yaw and catch presentation passed');
