// Regression for the spouse kiss disappearing on the next simulation frame:
// the ordinary player and NPC world-height/facing writers must respect the
// same absolute pose lock that the pair's scoped compositor session owns.
// Run: node scripts/test-spouse-kiss-frame-pose-ownership.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const game = fs.readFileSync('docs/game.js', 'utf8'); // Production main-loop source under test, not copied player frame logic.
const rigSrc = fs.readFileSync('docs/js/rig-transform-layers.js', 'utf8'); // Shared production ownership store.
const npcSrc = fs.readFileSync('docs/js/npc-character-state.js', 'utf8'); // Real locked-walker surface follower.
const section = (start, end) => {
  const a = game.indexOf(start);
  assert(a >= 0, 'Missing player frame anchor: ' + start);
  assert.equal(game.indexOf(start, a + 1), -1, 'Ambiguous player frame anchor: ' + start);
  const b = game.indexOf(end, a + start.length);
  assert(b > a, 'Missing ending anchor: ' + end);
  return game.slice(a, b);
}; // Extract only the actual production frame statements, avoiding a duplicate movement implementation.

const lockSource = section(
  "        const pairedPoseLocked = window.CharacterActionLocks?.isLocked?.('player', 'pose') === true;",
  '        mineTorchLight.visible = '
);
const moveSource = section(
  '        if (!pairedPoseLocked) {\n          const _playerMeshSmoothXZ',
  '        // updateMountRide has already written the carrier'
);
const mountSource = section(
  '        if (!pairedPoseLocked) window.Mounts?.pinMountedRiderMesh(playerMesh, mountSeatLift);',
  '        const shadowSurfaceY ='
);
const facingSource = section(
  '        if (pairedPoseLocked) {\n          // Paired action owns root yaw',
  '        // Bob animation when moving'
);
const bobSource = section(
  '        if (speed > 5 && !pairedPoseLocked) {',
  '        // Suppressed (legs stay visible'
);
const gaitSource = section(
  '        if (pairedPoseLocked) { /* Kiss/dance solves its own actual legs at the pre-render checkpoint. */ }',
  '      }\n\n      // ── Update reticle'
);

class Vec {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  clone() { return new Vec(this.x, this.y, this.z); }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
} // Three-like mutable vector implementing the real absolute-session capture contract.
class Quat {
  constructor(x = 0, y = 0, z = 0, w = 1) { Object.assign(this, { x, y, z, w }); }
  clone() { return new Quat(this.x, this.y, this.z, this.w); }
  copy(v) { Object.assign(this, { x: v.x, y: v.y, z: v.z, w: v.w }); return this; }
  identity() { return this.copy(new Quat()); }
  yaw(angle) { this.x = 0; this.z = 0; this.y = Math.sin(angle / 2); this.w = Math.cos(angle / 2); return this; }
} // Unit quaternion values exercise the production session's rotationMatches equivalence.

const player = { position: new Vec(2, .3, 3), quaternion: new Quat(), parent: {} }; // Physical root claimed by kiss; normal movement target is intentionally distant.
let playerYaw = 0; // Gameplay's ordinary Euler facing value, independent of the absolute kiss pose.
Object.defineProperty(player, 'rotation', { value: {
  get y() { return playerYaw; },
  set y(value) { playerYaw = value; player.quaternion.yaw(value); },
} }); // Real Three Euler updates Object3D.quaternion automatically on direct yaw writes.

const npc = { position: new Vec(2.4, .1, 3.3), quaternion: new Quat(), parent: {} }; // NPC must retain its kiss leap/bow root height.
const npcLean = { position: new Vec(), quaternion: new Quat().yaw(.14), parent: npc }; // A pre-kiss running lean must be preserved for scoped restoration, then cleaned once the lock releases.
const lockWindow = { }; // Shared global namespace required by production modules.
const performance = { now: () => 1000 }; // Deterministic time avoids accidental test lease expiry.
vm.runInNewContext(rigSrc, { window: lockWindow, performance, console }, { filename: 'rig-transform-layers.js' });
const compositor = lockWindow.ActorRigCompositor;
assert(compositor && typeof compositor.createAbsoluteSession === 'function');
let locked = true; // Simulated CharacterActionLocks acquisition for the real paired kiss.
let movementOnlyLock = false; // An unrelated post-kiss movement hold exercises deferred sprint-lean cleanup.
lockWindow.CharacterActionLocks = {
  isLocked(id, channel) { return locked && channel === 'pose' && (id === 'player' || id === 'npc:leaf')
    || (locked || movementOnlyLock) && channel === 'movement' && id === 'npc:leaf'; },
};
lockWindow.SpouseKissMotion = { isPartner: walker => walker.root === npc }; // Actual NPC movement lock needs moving knees, not gait suppression.
vm.runInNewContext(npcSrc, { window: lockWindow, console }, { filename: 'npc-character-state.js' });

const absolute = compositor.createAbsoluteSession('spouse-kiss');
assert(absolute.capture(player, ['position', 'quaternion']));
assert(absolute.capture(npc, ['position', 'quaternion']));
assert(absolute.capture(npcLean, ['quaternion']));
player.position.set(2.1, .66, 3.2); // Kiss authored a jump/retreat independently of the player tile.
player.quaternion.yaw(.74); // Paired facing toward partner, not the ordinary reticle.
npc.position.set(2.5, .95, 3.4); // NPC's authored leap elevation must survive ordinary ground follow.
npcLean.quaternion.yaw(.27); // Paired lean used to keep head and lips close.
assert(absolute.stamp());
const initial = {
  playerPosition: player.position.clone(), playerQuaternion: player.quaternion.clone(),
  npcPosition: npc.position.clone(), npcLean: npcLean.quaternion.clone(),
}; // Stable authored checkpoint to verify repeated normal frames cannot invalidate the claim.

let mountPins = 0, legUpdates = 0; // Any paired-frame mount or normal gait writer would be an ownership regression.
const windowFrame = {
  CharacterActionLocks: lockWindow.CharacterActionLocks,
  Mounts: { pinMountedRiderMesh() { mountPins++; } },
}; // Production updatePlayerMesh's existing lock and mount service contracts.
const normalFacing = Math.PI * .83; // Intentionally disagrees with the kiss's .74-radian direction.
const ordinaryFrame = new Function(
  'window', 'playerMesh', 'playerLegs', 'dt', 'wx', 'wz', 'targetY', 'player',
  'playerFacing', 'speed', 'mountSeatLift', 'MOVE_SPEED', 'devGlobalSpeedMul', 'performance',
  lockSource + moveSource + mountSource + facingSource + bobSource + gaitSource
    + '\nreturn pairedPoseLocked;'
);
const heldWalker = {
  rec: { id: 'leaf' }, root: npc, legs: { update() { legUpdates++; } },
  _npcRunLeanActive: true, _npcRunLeanPivot: npcLean, area: 'farm',
}; // Persist real walker lean flags across every locked tick, not a new walker per frame.
const surfaceOptions = { surfaceY() { return 0; }, shadowSurfaceOffset() { return 0; } }; // Far-below-ground fixture exposes any accidental hop snap.
for (let frame = 0; frame < 6; frame++) {
  assert.equal(ordinaryFrame(
    windowFrame, player, { group: { rotation: { y: 0 } }, update() { legUpdates++; } },
    .016, 9, 11, 0, { lunging: false },
    normalFacing, 20, .5, 10, 1, performance
  ), true, 'ordinary simulation respects the currently held pose channel');
  assert(lockWindow.NpcCharacterState.update(heldWalker, .016, surfaceOptions),
    'locked NPC movement path executed');
  assert.equal(heldWalker._npcRunLeanActive, true,
    'paired lock defers old running-lean cleanup until the actor can safely restore its rig');
  assert(absolute.owns(), 'kiss pose still owned after regular player and NPC update, frame ' + frame);
  assert.deepEqual(player.position, initial.playerPosition, 'player root remains at authored kiss position');
  assert.deepEqual(player.quaternion, initial.playerQuaternion, 'player root retains authored kiss yaw');
  assert.deepEqual(npc.position, initial.npcPosition, 'NPC root retains jump/bow height');
  assert.deepEqual(npcLean.quaternion, initial.npcLean, 'NPC run-lean cleanup cannot erase authored torso tilt');
}
assert.equal(mountPins, 0, 'saddle visual writer never overrides the owned kiss player root');
assert.equal(legUpdates, 6, 'only the NPC locked-walker knee path runs, never normal player gait');

const released = absolute.release(); // Restore the saved transform once the paired action ends.
assert.equal(released.skipped, 0, 'untouched captured transforms return cleanly on kiss completion');
locked = false;
assert(Math.abs(npcLean.quaternion.y - new Quat().yaw(.14).y) < 1e-9,
  'scoped release restores the pre-kiss running lean rather than stranding the authored bow');
movementOnlyLock = true;
assert(lockWindow.NpcCharacterState.update(heldWalker, .016, surfaceOptions),
  'a subsequent movement-only lock performs deferred NPC lean cleanup');
assert.equal(heldWalker._npcRunLeanActive, false,
  'lean cleanup clears its running flag only after applying the pending reset');
assert.deepEqual(npcLean.quaternion, new Quat(),
  'no stale running lean remains after the paired pose hands the rig back');
movementOnlyLock = false;
// Evaluate the same production position, mount and facing statements on
// release. Other normal gameplay calls (combat, gait and camera) need their
// full live game context and are intentionally not mocked here.
windowFrame.Fishing = { state: { phase: 'caught' } }; // Selects the normal authored fishing-facing branch without requiring unrelated map state.
const releasedFrame = new Function(
  'window', 'playerMesh', 'playerLegs', 'dt', 'wx', 'wz', 'targetY', 'player',
  'playerFacing', 'mountSeatLift', 'performance',
  lockSource + moveSource + mountSource + facingSource + '\nreturn pairedPoseLocked;'
);
assert.equal(releasedFrame(
  windowFrame, player, { group: { rotation: { y: 0 } } },
  .016, 9, 11, 0, { lunging: false },
  normalFacing, .5, performance
), false, 'ordinary movement/facing resumes as soon as the action releases');
assert(player.position.x > 2 && player.position.z > 3, 'player movement smoothing resumes outside kiss');
assert.equal(player.rotation.y, normalFacing, 'ordinary gameplay restores camera-relative facing ownership');
assert.equal(mountPins, 1, 'mounted pin returns to its normal ownership after kiss');

console.log('Spouse kiss remains owned through normal player and NPC simulation; release restores both writers.');
