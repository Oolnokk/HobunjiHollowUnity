// Runs the production spouse runtime on actual Three.js r128 groups and bones.
// node scripts/test-spouse-kiss-live-player-rig.js (after installing three@0.128.0)
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let THREE; // Required by the focused browser/Three CI; the standalone 1,000+ test runner intentionally installs no npm dependencies.
try { THREE = require('three'); } catch (error) {
  if (error?.code !== 'MODULE_NOT_FOUND' || !/three/.test(String(error.message))) throw error;
  console.log('SKIP live Three.js kiss rig (install three@0.128.0 or use the focused Animation Author CI workflow).');
  process.exit(0); // Never falsely claim live-rig coverage from the dependency-free broad regression job.
}

const scene = new THREE.Scene(); // Ensures world transforms include parent/grandparent effects.
const player = new THREE.Group(); // Same full-body root targeted by PlayerBodyTransformComposer.
const walkerRoot = new THREE.Group(); // NPC root is independently positioned and faced.
walkerRoot.position.set(.30, 0, .38);
scene.add(player, walkerRoot);
const playerModel = new THREE.Group(); // Live player portrait, separate from the outer player root.
const npcRigRoot = new THREE.Group(); // Existing NPC character body-sink pivot.
npcRigRoot.name = 'npc_character_rig_root';
const npcModel = new THREE.Group(); // Existing NPC portrait transform under body sink.
player.add(playerModel);
walkerRoot.add(npcRigRoot);
npcRigRoot.add(npcModel);
const playerNeck = new THREE.Bone(), npcNeck = new THREE.Bone(); // True bone rotations/parent transforms, not fake scalar rigs.
playerNeck.position.set(0, .79, .02);
npcNeck.position.set(0, .68, .02);
playerModel.add(playerNeck);
npcModel.add(npcNeck);
playerModel.userData.neckRig = { available: true, neckJoint: playerNeck };
npcModel.userData.neckRig = { available: true, neckJoint: npcNeck };
playerModel.userData.portraitModelHeight = 1.1;
npcModel.userData.portraitModelHeight = .92;

function createHands(root, model, height) {
  const group = new THREE.Group(); // Real world/local wrist conversions are performed by Three's Object3D.
  root.add(group);
  for (const side of ['left', 'right']) {
    const socket = new THREE.Group(); // Exact names used by the production grip solver.
    socket.name = side + '_hand_socket';
    socket.position.set(side === 'left' ? -.11 : .11, height * .67, 0);
    group.add(socket);
  }
  const rig = {
    parent: root, avatarRoot: model, group, provider: null, height, // Mutable in the reverse-height scenario to simulate another species.
    shoulderPositionLocal(side, out) { return out.set(side === 'left' ? -.11 : .11, this.height * .72, 0); },
    armLengthForSide() { return this.height * .43; },
    setPoseProvider(_owner, fn) { this.provider = fn; },
    useIdlePose() {},
    placeHandWorld(side, target) {
      const socket = group.getObjectByName(side + '_hand_socket');
      socket.position.copy(group.worldToLocal(target.clone())); // Real Three conversion prevents false-positive hand-parent passes.
      return true;
    },
    applyOwnedPose() { this.provider?.(); },
  }; // Existing ProceduralHandRig API, without substituting invented animation methods.
  model.userData.proceduralHandRig = rig;
  return rig;
}
const playerHands = createHands(player, playerModel, 1.1);
const npcHands = createHands(walkerRoot, npcModel, .92);

function createLegs(root, height) {
  const group = new THREE.Group(); // The active leg group remains floor-relative during torso lowering.
  root.add(group);
  let stanceDrop = 0, limit = .55;
  const calls = { knee: 0, stanceYaw: [], pants: 0 }; // Counts observed body and trousers updates at simulation and render time.
  return {
    group, modelHeight: height, standingPosteriorY: height * .32, calls,
    motionAnatomy() { const height = this.modelHeight; return ['left', 'right'].map(side => ({
      side, hip: new THREE.Vector3(side === 'left' ? -.10 : .10, height * .32, 0),
      ankle: new THREE.Vector3(side === 'left' ? -.10 : .10, height * .03, 0),
      length: height * .29,
    })); },
    update() {},
    setStanceDrop(v) { stanceDrop = Number(v) || 0; calls.knee++; },
    getStanceDrop() { return stanceDrop; },
    setStanceYawDeg(yaw) { calls.stanceYaw.push(yaw); },
    setStanceDropLimitFraction(v) { const old = limit; limit = v; return old; },
    setExternalFootTargets() {},
    hasExternalFootTargets() { return false; },
    pants: { update() { calls.pants++; } },
  }; // Public procedural-leg methods called by the real runtime.
}
const playerLegs = createLegs(player, 1.1);
const npcLegs = createLegs(walkerRoot, .92);
const walker = { rec: { id: 'leaf' }, root: walkerRoot, avatarGroup: npcModel,
  legs: npcLegs, area: 'farm', _npcRunLeanPivot: npcModel }; // NPC still uses its real, separately positioned root.
let update = null, lastRenderHook = null, renderCount = 0, hookReleased = 0, buffTriggers = 0;
let poseLockActive = false; // Mirrored from CharacterActionLocks.acquire/release.
const composer = {
  getPlayerMesh() { return player; },
  getPlayerLegHandle() { return playerLegs; },
  clearChannel() {},
  addPostHeadAimHook(cb) {
    lastRenderHook = cb;
    return () => { lastRenderHook = null; hookReleased++; };
  }, // Same final pre-draw hook the game renderer calls after camera and weapon pose writers.
};
const window = {
  THREE, PlayerBodyTransformComposer: composer,
  WorldPortraitLife: { getPlayerAvatar() { return { group: playerModel }; } },
  RuntimeFrameScheduler: { register(name, cb, options) {
    assert.equal(name, 'spouse-kiss'); assert.equal(options.phase, 'pre-render'); update = cb;
  } },
  CharacterActionLocks: {
    acquire({ participants }) {
      assert(participants.find(p => p.id === 'player')?.channels.includes('head'));
      poseLockActive = true;
      return { release() { poseLockActive = false; } };
    },
    isLocked(_id, channel) { return poseLockActive && channel === 'pose'; },
  },
  ActorBodySink: { apply(sink, pct) {
    const units = pct / 100 * sink.legs.modelHeight;
    sink.legs.setStanceDrop(units, true);
    npcRigRoot.position.y = -units;
    return units;
  } },
  WorldActionInputClaims: { setClaims() {}, clearClaims() {} },
  RomanceSystem: { getSpouse() { return { npcId: 'leaf' }; } },
  Combat: { deps: { player: { health: 100 } } },
  __hobunjiPlayerProfile: { characterId: 'tester' },
  CinematicCameraRuntime: { isActive() { return false; } },
  FestivalWheelDanceRuntime: { isActive() { return false; } },
}; // Minimal registered owners; no preview clones or shadow animation code.
vm.runInNewContext(fs.readFileSync('docs/js/spouse-kiss-motion.js','utf8'), {
  window, console, performance: { now() { return 1000; } },
}, { filename: 'spouse-kiss-motion.js' });
const kiss = window.SpouseKissMotion;
assert(kiss.init(), 'game registers the real pre-render simulation');
assert(kiss.start(walker, () => buffTriggers++), 'the real player/NPC rig pair starts');
assert(poseLockActive && typeof lastRenderHook === 'function', 'full-body action and final renderer hook are both held');
for (let i = 0; i < 16; i++) update({ deltaMs: 70 }); // 1.12 seconds of actual real Three pose updates.
const before = kiss.diagnostics().session;
assert(before && before.playerKneeDrop > .001, 'live taller player bends knees rather than just changing head position');
assert(Math.abs(playerModel.position.y) > .001, 'live portrait follows the knee bend');
assert(playerLegs.calls.pants > 0, 'live clothing updates during the action');
assert(playerLegs.calls.stanceYaw.some(y => y === 0), 'kiss owns paired knee pole, not equipped tool body yaw');
assert.equal(buffTriggers, 1, 'contact fires once after the shared pose reaches the partner');

const authorYaw = player.rotation.y, authorDrop = playerModel.position.y; // Expected author-directed facing and torso sink at current clip time.
const originalKnee = playerLegs.getStanceDrop(); // Used to verify the late renderer overwrites an interfering weapon stance.
const camera = { x: -3, y: 10, z: 13 }; // An intentionally irrelevant orbit camera.
for (const cameraX of [-3, 3]) {
  camera.x = cameraX;
  player.rotation.set(.4, .6, -.5); // Simulates a tool/aim stack rewriting the root in a late game pass.
  playerModel.rotation.set(-.7, 1.1, .2); // Simulates a separate action adding unowned body pitch/roll.
  playerModel.position.y = 0; // Simulates the body-sink writer clearing its own stance.
  playerNeck.rotation.set(.8, camera.x, .1); // Simulates camera look reasserting an invalid gaze.
  playerLegs.setStanceDrop(.02, true); // Simulates a non-paired weapon knee drop.
  lastRenderHook([], {}, camera);
  renderCount++;
  assert(Math.abs(player.rotation.y-authorYaw) < 1e-7, 'player facing is invariant to tool body yaw and camera orbit');
  assert(Math.abs(player.rotation.x) < 1e-7 && Math.abs(player.rotation.z) < 1e-7,
    'camera/weapon pitch and roll cannot contaminate the paired root');
  assert(Math.abs(playerModel.position.y-authorDrop) < 1e-7, 'render boundary restores the real bent player torso');
  assert(Math.abs(playerLegs.getStanceDrop()-originalKnee) < 1e-7, 'render boundary restores the intended authored knees');
  assert(Math.abs(playerNeck.rotation.y-camera.x) > .001, 'partner-directed head is independent of camera yaw');
}
assert(kiss.diagnostics().session.renderPoseCount === renderCount, 'mobile diagnostics reveal true renderer ownership count');
kiss.stop('test-ended');
assert(!poseLockActive && lastRenderHook === null && hookReleased === 1, 'stop unregisters the final renderer owner');
assert(Math.abs(playerModel.position.y) < .00001 && Math.abs(playerModel.rotation.x) < .00001,
  'canceled/finished kiss returns the player torso to its original transform');
assert.equal(playerHands.provider, null, 'hand rig is no longer owned by the kiss');
assert.equal(kiss.diagnostics().active, false);

// Reverse the stature assignment on the very same live objects: now the player reaches
// for a taller spouse first, before the recipient kneels. This is the historically broken
// Pahu-as-player / Leaf-as-partner path, not the tall-player branch checked above.
playerModel.userData.portraitModelHeight = .75; // Used by the next real solver/camera-independent head-frame pass.
npcModel.userData.portraitModelHeight = 1.05; // Opposite height ordering with a genuine taller NPC.
playerHands.height = .75;
npcHands.height = 1.05;
playerLegs.modelHeight = .75;
npcLegs.modelHeight = 1.05;
playerLegs.standingPosteriorY = .75 * .32;
npcLegs.standingPosteriorY = 1.05 * .32;
playerNeck.position.y = .57;
npcNeck.position.y = .80;
player.position.y = 0;
walkerRoot.position.y = 0;
assert(kiss.start(walker, () => buffTriggers++), 'short-player and tall-NPC version starts on the same live rigs');
for (let i = 0; i < 16; i++) update({ deltaMs: 70 });
const reverse = kiss.diagnostics().session;
assert(reverse && reverse.height.taller === 'second', 'real height solver must now lower the NPC rather than the player');
assert(reverse.hands?.applied && reverse.hands.hands === 2, 'shorter player moves BOTH actual hand sockets toward taller spouse shoulders');
assert(npcLegs.getStanceDrop() > 0, 'taller NPC visibly kneels after the shorter player reaches');
assert.equal(buffTriggers, 2, 'each direction triggers one and only one interaction');
const shortPlayerYaw = player.rotation.y; // Real facing that should be invariant under any last-moment tool pose.
player.rotation.set(.3, -2.1, -.4);
playerNeck.rotation.set(.9, 1.2, .4);
lastRenderHook([], {}, {position:{x:100,y:100,z:100}});
assert(Math.abs(player.rotation.y - shortPlayerYaw) < 1e-7, 'short-player yaw ignores camera/weapon transforms');
assert(reverse.hands?.applied, 'short-player hand pose survives the final rendering pass');
kiss.stop('reverse-ended');
assert(!poseLockActive && lastRenderHook === null && hookReleased === 2, 'reverse-height exit releases the entire scoped pose owner');
assert.equal(playerHands.provider, null, 'short-player hands regain tool/idle ownership');
console.log('Spouse kiss LIVE Three.js r128 player rig PASS: BOTH height orders, knees, hands, pants, camera-independent facing/head, late render and restoration.');
