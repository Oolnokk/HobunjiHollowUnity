#!/usr/bin/env node
'use strict';
// Integration regression: an absolute spouse-kiss pose must survive the next
// ordinary player and NPC simulation tick, including a spouse mid-hop.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const game = fs.readFileSync('docs/game.js', 'utf8'); // Real game-loop writer, not a parallel test implementation.
const npcCode = fs.readFileSync('docs/js/npc-character-state.js', 'utf8'); // Actual movement-locked NPC ground follower.
const rigCode = fs.readFileSync('docs/js/rig-transform-layers.js', 'utf8'); // The shipped absolute-pose ownership implementation.
function between(source, start, end) {
  const i = source.indexOf(start), j = source.indexOf(end, i + start.length);
  assert(i >= 0 && j > i, 'live writer boundary exists: ' + start);
  return source.slice(i, j);
}
assert.match(game, /const pairedPoseLocked = window\.CharacterActionLocks\?\.isLocked\?\.\('player', 'pose'\) === true/,
  'player mesh update must consult the existing exclusive pose action lock');
const moveSource = between(game, '        if (!pairedPoseLocked) {\n          const _playerMeshSmoothXZ',
  '        const shadowSurfaceY ='); // Covers X/Y/Z smoothing and the mounted rider's late position pin.
const facingSource = between(game, '        if (pairedPoseLocked) {\n          // Paired action owns root yaw',
  '        // Bob animation when moving'); // Covers ALL of game.js's facing branches and their foot-root overwrites.
const gaitSource = between(game, '        if (pairedPoseLocked) { /* Kiss/dance solves its own actual legs',
  '        window.TzatzulLiveVisuals?.alignCaptive?.(player, playerMesh);');
assert.match(game, /if \(speed > 5 && !pairedPoseLocked\)/,
  'walk bob must not add position.y after the paired pose captured its position');
assert.match(gaitSource, /else playerLegs\?\.update\(dt, gaitSpeed/,
  'unlocked procedural gait must still work as before');

class Vec {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  clone() { return new Vec(this.x, this.y, this.z); }
  copy(other) { Object.assign(this, { x: other.x, y: other.y, z: other.z }); return this; }
}
class Quat {
  constructor(x = 0, y = 0, z = 0, w = 1) { Object.assign(this, { x, y, z, w }); }
  clone() { return new Quat(this.x, this.y, this.z, this.w); }
  copy(other) { Object.assign(this, { x: other.x, y: other.y, z: other.z, w: other.w }); return this; }
  identity() { return this.copy(new Quat()); }
  setYaw(angle) { this.y = Math.sin(angle / 2); this.x = this.z = 0; this.w = Math.cos(angle / 2); return this; }
}
function actor(y, yaw) {
  const root = { position: new Vec(.23, y, .37), quaternion: new Quat().setYaw(yaw), parent: {} };
  let angle = yaw; // Test-only Euler facade keeps the real quaternion synchronized, as Three.js does.
  root.rotation = {};
  Object.defineProperty(root.rotation, 'y', {
    get: () => angle,
    set: next => { angle = next; root.quaternion.setYaw(next); },
  });
  return root;
}
const playerMesh = actor(.36, 0);
const npcRoot = actor(.22, 0);
let poseLocked = true; // Simulates the same CharacterActionLocks token claimed by SpouseKissMotion.start.
const locks = {
  isLocked(id, channel) {
    return poseLocked && (id === 'player' || id === 'npc:spouse')
      && ['movement', 'tools', 'pose', 'facing', 'head'].includes(channel);
  },
};
const window = {
  CharacterActionLocks: locks,
  Fishing: { state: { phase: 'caught' } }, // Forces a real ordinary facing branch when the lock releases.
  FormatUtils: { clamp: (n, lo, hi) => Math.max(lo, Math.min(hi, n)) },
  Mounts: { pinMountedRiderMesh: () => { mountedCalls++; } },
  SpouseKissMotion: { isPartner: () => true },
};
let mountedCalls = 0; // The ordinary saddle pin is in the extracted player movement writer.
const rigContext = { window, console, performance: { now: () => 1000 } };
vm.runInNewContext(rigCode, rigContext, { filename: 'rig-transform-layers.js' });
vm.runInNewContext(npcCode, { window, console }, { filename: 'npc-character-state.js' });
const pose = window.ActorRigCompositor.createAbsoluteSession('spouse-kiss');
assert(pose.capture(playerMesh, ['position', 'quaternion']));
assert(pose.capture(npcRoot, ['position', 'quaternion']));
playerMesh.position.copy(new Vec(1.4, .65, 1.3)); // Author's actual full-body placement, not the player tile position.
playerMesh.rotation.y = 1.0; // Authored kiss inward-facing direction differs from ordinary `playerFacing`.
npcRoot.position.copy(new Vec(1.6, .95, 1.7)); // Short spouse is currently airborne above ordinary terrain.
npcRoot.rotation.y = -2.0;
assert(pose.stamp() && pose.owns(), 'kiss successfully claims its initial authored pose');

const gameMove = new Function('playerMesh', 'pairedPoseLocked', 'dt', 'wx', 'wz', 'targetY',
  'player', 'window', 'mountSeatLift', moveSource); // Executes the real game.js smoothing and mount pin branches.
const gameFacing = new Function('playerMesh', 'playerLegs', 'pairedPoseLocked', 'playerFacing',
  'window', facingSource); // Executes the real game.js facing body with the caught-fish branch.
const gameGait = new Function('playerLegs', 'pairedPoseLocked', 'window', 'dt', 'gaitSpeed',
  'legsSuppressed', 'seatedPose', 'player', 'groundedTargetY', 'ordinaryLungeHopY',
  'playerMesh', 'isPlayerInCombat', gaitSource); // Verifies the ordinary gait cannot overwrite an authored knee frame.
let normalLegTicks = 0; // Exposes unexpected IK updates while the pose lock is active.
const playerLegs = { group: { rotation: { y: .25 } }, update() { normalLegTicks++; } };
const player = { lunging: false };
function tick() {
  gameMove(playerMesh, poseLocked, .016, .5, .5, .2, player, window, 0);
  gameFacing(playerMesh, playerLegs, poseLocked, -.4, window);
  gameGait(playerLegs, poseLocked, window, .016, 0, false, null, player, 0, 0, playerMesh, () => false);
  return window.NpcCharacterState.update({
    rec: { id: 'spouse' }, root: npcRoot,
    legs: { update() {} }, area: 'farm',
    _npcRunLeanActive: false,
  }, .016, { surfaceY: () => .2, shadowSurfaceOffset: () => 0 });
}
for (let frame = 0; frame < 8; frame++) {
  assert.equal(tick(), true, 'NPC movement remains locked during the paired clip');
  assert(pose.owns(), 'kiss ownership survives normal game/NPC tick #' + frame);
}
assert.equal(normalLegTicks, 0, 'normal walking gait never writes during the pose');
assert.equal(mountedCalls, 0, 'saddle pin cannot write over the paired player placement');
assert.equal(playerMesh.rotation.y, 1.0, 'player retains authored inward-facing yaw');
assert.equal(npcRoot.position.y, .95, 'jumping spouse does not get dragged to the ordinary NPC ground');
assert.equal(playerLegs.group.rotation.y, .25, 'normal facing cannot overwrite paired local feet');

// After the kiss releases its lock, ordinary game and NPC movement must take
// over on the very next tick, rather than leaving the player frozen.
poseLocked = false;
tick();
assert(!pose.owns(), 'the unprotected ordinary simulation would have invalidated that kiss pose');
assert(normalLegTicks > 0 && mountedCalls > 0, 'ordinary gait and positioning resume after kiss handback');
assert.equal(playerMesh.rotation.y, -.4, 'ordinary facing resumes after pose lock release');
assert(npcRoot.position.y < .95, 'NPC ground following resumes after pose lock release');
pose.release();
console.log('PASS: exclusive player and NPC kiss root ownership survives repeated ordinary frames and hands back cleanly');
