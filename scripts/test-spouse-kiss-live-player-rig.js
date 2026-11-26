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
let livePlayerLegs = playerLegs; // Allows the posterior-hop regression to use the production IK handle.
const walker = { rec: { id: 'leaf' }, root: walkerRoot, avatarGroup: npcModel,
  legs: npcLegs, area: 'farm', _npcRunLeanPivot: npcModel }; // NPC still uses its real, separately positioned root.
let update = null, lastRenderHook = null, renderCount = 0, hookReleased = 0, buffTriggers = 0;
let poseLockActive = false; // Mirrored from CharacterActionLocks.acquire/release.
const composer = {
  getPlayerMesh() { return player; },
  getPlayerLegHandle() { return livePlayerLegs; },
  clearChannel() {},
  addPostHeadAimHook(cb) {
    lastRenderHook = cb;
    return () => { lastRenderHook = null; hookReleased++; };
  }, // Same final pre-draw hook the game renderer calls after camera and weapon pose writers.
};
const window = {
  THREE, PlayerBodyTransformComposer: composer,
  SharedAttackPose: {
    createHeadFrame(Three) { return { position: new Three.Vector3() }; }, // Reused production mouth-frame contract.
    headFrame(frame, model) {
      const neck = model?.userData?.neckRig?.neckJoint; // Real Three.js head pivot supplies the test lip landmark.
      if (!neck?.parent) return false;
      neck.getWorldPosition(frame.position);
      return true;
    },
  }, // Unlike the old fixture, this exercises the skinned mouth reprojection that caused a late ownership mismatch.
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
vm.runInNewContext(fs.readFileSync('docs/js/rig-transform-layers.js','utf8'), {
  window, console, performance: { now() { return 1000; } },
}, { filename: 'rig-transform-layers.js' }); // Live Three rig uses the real shared absolute-pose ownership store.
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
const npcHeadBeforeLateReprojection = npcNeck.position.clone(); // Detect render-only lip movement after the simulation checkpoint.
npcModel.position.y += .024; // A late visual mouth-anchor adjustment under a non-claimed portrait parent.
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
  assert(Math.abs(playerModel.rotation.y) < 1e-7 && Math.abs(playerModel.rotation.z) < 1e-7,
    'scoped paired torso pose must remove unowned late tool yaw and roll before the frame ends');
  assert(Math.abs(playerLegs.getStanceDrop()-originalKnee) < 1e-7, 'render boundary restores the intended authored knees');
  assert(Math.abs(playerNeck.rotation.y-camera.x) > .001, 'partner-directed head is independent of camera yaw');
}
assert(kiss.diagnostics().session.renderPoseCount === renderCount, 'mobile diagnostics reveal true renderer ownership count');
assert(npcNeck.position.distanceTo(npcHeadBeforeLateReprojection) > 1e-5,
  'the final render really changed a captured lip joint after simulation; this is not a vacuous ownership test');
// Real gameplay interleaves simulation and final rendering. Mouth reprojection after
// .82 seconds changes the captured neck joints AFTER the simulation checkpoint;
// an uncheckpointed render pass must not falsely cancel the following tick.
for (let frame = 0; frame < 24 && kiss.diagnostics().active; frame++) {
  assert.equal(typeof lastRenderHook, 'function', 'render ownership lasts until the clip finishes');
  lastRenderHook([], {}, camera);
  renderCount++;
  const projectedMouth = npcNeck.position.clone(); // Renderer hand sentinel runs after post-head hooks in actual Three.js.
  playerHands.applyOwnedPose();
  assert(npcNeck.position.distanceTo(projectedMouth) < 1e-6,
    'late hand-driver mouth reapplication is idempotent after the final pose checkpoint');
  update({ deltaMs: 70 });
  assert(kiss.diagnostics().active || kiss.diagnostics().lastResult?.reason === 'completed',
    'interleaved late render must not cancel a live kiss: ' + kiss.diagnostics().lastResult?.reason);
}
assert.equal(kiss.diagnostics().lastResult?.reason, 'completed', 'entire 2.4-second kiss completes naturally after repeated render passes');
assert.equal(kiss.diagnostics().lastResult?.touched, true, 'contact occurs before natural recovery');
assert.equal(kiss.diagnostics().lastResult?.renderPoseCount, renderCount, 'final mobile diagnostic retains all render checkpoints');
assert.equal(kiss.stop('test-ended'), false, 'completed clip already released its pose once');
assert(!poseLockActive && lastRenderHook === null && hookReleased === 1, 'completion unregisters the final renderer owner');
assert(Math.abs(playerModel.position.y) < .00001 && Math.abs(playerModel.rotation.x) < .00001,
  'canceled/finished kiss returns the player torso to its original transform');
assert.equal(playerHands.provider, null, 'hand rig is no longer owned by the kiss');
assert.equal(kiss.diagnostics().active, false);

// A different NPC movement/pose owner can arrive between the paired simulation
// stamp and the final player render hook. The hook must never silently adopt
// the moved spouse root into the kiss's authoritative checkpoint.
assert(kiss.start(walker, () => buffTriggers++), 'takeover fixture starts a new paired kiss');
update({ deltaMs: 70 });
const movedSpouse = walkerRoot.position.clone().add(new THREE.Vector3(.39, .14, -.16)); // Deliberate new NPC root writer not reauthored by the kiss render callback.
walkerRoot.position.copy(movedSpouse);
lastRenderHook([], {}, camera);
assert.equal(kiss.diagnostics().active, false, 'late NPC root takeover stops the obsolete kiss during the render callback');
assert.equal(kiss.diagnostics().lastResult?.reason, 'pose-owner-replaced-during-render');
assert(walkerRoot.position.distanceTo(movedSpouse) < 1e-8, 'render takeover cleanup preserves the newer spouse position');
assert(kiss.diagnostics().lastResult?.poseRelease?.skipped > 0, 'late renderer takeover is reported as a skipped restore');
assert.equal(window.ActorRigCompositor.getDebug().activeAbsoluteClaims, 0, 'failed late render releases all captured pose claims');
walkerRoot.position.set(.30, 0, .38); // Return the simulated externally moved spouse to the unchanged starting position for subsequent scenarios.
npcModel.quaternion.identity(); // Clear the test-only tilted body after the deliberate takeover kept its newer root.
npcNeck.quaternion.identity(); // Reset the test-only gaze that was deliberately not restored under the displaced root.
npcNeck.position.set(0, .68, .02); // Neutral physical neck height for the next independent test.

// External authors can take over a root or head before cancellation. The old
// paired session must not overwrite those replacement transforms.
assert(kiss.start(walker, () => buffTriggers++), 'new scoped kiss can start after normal teardown');
update({ deltaMs: 70 }); // Own a non-neutral sample before an outside writer intervenes.
const displaced = player.position.clone().add(new THREE.Vector3(.53, 0, -.28)); // Simulated newer teleport/animation root.
player.position.copy(displaced);
update({ deltaMs: 70 });
assert.equal(kiss.diagnostics().active, false, 'a displaced player stops the obsolete kiss on its next tick');
assert.equal(kiss.diagnostics().lastResult.reason, 'pose-owner-taken-over');
assert(player.position.distanceTo(displaced) < 1e-8, 'obsolete pose teardown preserves a newer root position');
assert(kiss.diagnostics().lastResult.poseRelease.skipped > 0, 'the user-visible diagnostic reports the skipped overwritten transforms');
assert.equal(window.ActorRigCompositor.getDebug().activeAbsoluteClaims, 0, 'takeover fully releases the paired pose registry');
player.position.set(0, 0, 0); // Explicit new world position after releasing the old absolute owner.

assert(kiss.start(walker, () => buffTriggers++), 'new scoped kiss may start after owner takeover');
update({ deltaMs: 70 });
npcNeck.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), .41); // A later authored gaze now owns this neck.
const otherGaze = npcNeck.quaternion.clone(); // Teardown must retain the newer gaze instead of its original snapshot.
kiss.stop('newer-gaze');
assert(npcNeck.quaternion.angleTo(otherGaze) < 1e-7, 'spouse cleanup never overwrites a newer head rotation');
assert.equal(window.ActorRigCompositor.getDebug().activeAbsoluteClaims, 0, 'explicit cancel leaves no scoped claims');
npcNeck.quaternion.identity(); // Restore the fixture's authored standing neck before the reverse-height scenario.
npcModel.position.y = 0; // Undo the test-only late mouth-anchor offset before swapping species heights.

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
const previousHookReleases = hookReleased; // Count only the reverse-height session's final release.
for (let frame = 0; frame < 24 && kiss.diagnostics().active; frame++) {
  assert.equal(typeof lastRenderHook, 'function', 'short-player kiss still owns the final render hook');
  lastRenderHook([], {}, camera);
  const shortProjectedMouth = npcNeck.position.clone(); // Simulate the native renderer's last hand-sync sentinel in both height directions.
  playerHands.applyOwnedPose();
  assert(npcNeck.position.distanceTo(shortProjectedMouth) < 1e-6,
    'short-player kiss head remains steady across the late procedural hand sync');
  update({ deltaMs: 70 });
  assert(kiss.diagnostics().active || kiss.diagnostics().lastResult?.reason === 'completed',
    'short-player lip and gaze recomposition must not cancel the action: ' + kiss.diagnostics().lastResult?.reason);
}
assert.equal(kiss.diagnostics().lastResult?.reason, 'completed', 'reverse-height clip also finishes after repeated render passes');
assert.equal(kiss.diagnostics().lastResult?.touched, true, 'reverse-height contact happens before release');
assert.equal(kiss.stop('reverse-ended'), false, 'natural completion already performed reverse-height cleanup');
assert(!poseLockActive && lastRenderHook === null && hookReleased === previousHookReleases + 1,
  'reverse-height completion releases exactly one renderer owner regardless of preceding interrupted sessions');
assert.equal(playerHands.provider, null, 'short-player hands regain tool/idle ownership');

// Run the actual procedural bones for a couple whose height gap triggers the hop.
const legsContext = { // Leave textures pending in this geometry-only fixture.
  window, THREE, console, URL, location: { href: 'http://localhost/index.html' },
  document: { currentScript: null }, Image: class {},
};
for (const file of ['leg-bones', 'procedural-leg-animation']) {
  vm.runInNewContext(fs.readFileSync(`docs/js/${file}.js`, 'utf8'), legsContext, { filename: `${file}.js` });
}
player.remove(playerLegs.group);
playerModel.userData.portraitModelHeight = .55;
playerNeck.position.y = .32;
const hopLegs = window.ProceduralLegAnimation.attach(THREE, player, {
  speciesId: 'human', modelHeight: .55, modelWidth: .33, handAttachY: .176,
}); // Live bones can expose a stale contact even when the ordinary root has recovered.
livePlayerLegs = hopLegs;
npcLegs.getRestStance = function () {
  const [left, right] = this.motionAnatomy(); // Expose the tall fixture's authored posterior anchors.
  return { left, right };
};
const leftFoot = hopLegs.group.getObjectByName('left_foot'); // Actual foot node whose paired contact cancels world rotation.
const groundedRotation = leftFoot.quaternion.clone(); // Baseline local foot facing before any kiss writes.
function startHop() {
  assert(kiss.start(walker), 'posterior-hop fixture starts');
  for (let frame = 0; frame < 16; frame++) update({ deltaMs: 70 });
  assert(kiss.diagnostics().session?.height.shorterPosteriorGrip, 'short player really hops onto the spouse');
  assert(hopLegs.hasExternalFootTargets(), 'both feet have live world anchors mid-kiss');
  assert(leftFoot.quaternion.angleTo(groundedRotation) > .1, 'hop actually changes the foot orientation');
}

startHop();
for (let frame = 0; frame < 17; frame++) update({ deltaMs: 70 });
assert(kiss.diagnostics().active, 'the hop lands just before the end of the clip');
assert(!hopLegs.hasExternalFootTargets(), 'normal landing releases the kiss targets');
assert(leftFoot.quaternion.angleTo(groundedRotation) < 1e-7, 'normal landing restores foot facing immediately');
update({ deltaMs: 70 });
update({ deltaMs: 70 });
assert.equal(kiss.diagnostics().lastResult?.reason, 'completed');

startHop();
kiss.stop('canceled');
assert(!hopLegs.hasExternalFootTargets(), 'mid-hop cancellation releases both feet');
assert(leftFoot.quaternion.angleTo(groundedRotation) < 1e-7, 'cancel restores grounded foot facing immediately');

startHop();
const teleported = player.position.clone().add(new THREE.Vector3(.2, 0, -.1)); // A later root writer displaces the actor while the old targets are live.
player.position.copy(teleported);
update({ deltaMs: 70 });
assert.equal(kiss.diagnostics().lastResult?.reason, 'pose-owner-taken-over');
assert.equal(kiss.diagnostics().lastResult?.releasedFootTargets, true);
assert(player.position.distanceTo(teleported) < 1e-8, 'cleanup preserves the new root position');
assert(!hopLegs.hasExternalFootTargets(), 'root takeover cannot strand world-space foot targets');
hopLegs.update(1 / 60, 1, false, null);
assert.equal(hopLegs.getStandingPoseDebug().motionMode, 'walk', 'ordinary gait takes ownership on the next tick');
player.position.set(0, 0, 0);

startHop();
const replacementTargets = { left: new THREE.Vector3(-.1, 0, 0), right: new THREE.Vector3(.1, 0, 0) }; // A different action now owns these world contacts.
hopLegs.setExternalFootTargets(replacementTargets);
kiss.stop('new-foot-owner');
assert(hopLegs.hasExternalFootTargets(), 'kiss cleanup preserves a successor’s foot targets');
assert(hopLegs.releaseExternalFootTargets(replacementTargets), 'the newer action still owns both contacts');
console.log('Spouse kiss LIVE Three.js r128 player rig PASS: both height orders, late render ownership, and foot recovery after landing, cancellation, and takeover.');

// A lip in the restored blend moves only a fraction of its neck joint's
// world displacement. The paired solver must correct the measured residual.
{
  const a = new THREE.Group(), b = new THREE.Group();
  const ja = new THREE.Bone(), jb = new THREE.Bone();
  scene.add(a,b); a.add(ja); b.add(jb); b.position.x=.19;
  for (const [model,joint] of [[a,ja],[b,jb]]) {
    model.userData.neckRig={available:true,neckJoint:joint};
    model.userData.portraitModelHeight=1;
  }
  const originalHeadFrame=window.SharedAttackPose.headFrame;
  window.SharedAttackPose.headFrame=(frame,model)=>{
    model.getWorldPosition(frame.position);
    const joint=model.userData.neckRig.neckJoint;
    const tip=joint.getWorldPosition(new THREE.Vector3());
    frame.position.lerp(tip,.85);
    return true;
  };
  const scratch={THREE};
  const result=kiss.syncMouthContact(a,b,1.2,scratch);
  assert(result.contact, 'partially weighted lip reaches the original contact tolerance');
  assert(Math.abs(result.distance-result.targetGap)<=result.gapTolerance, 'corrected gap remains visible');
  const repeat=kiss.syncMouthContact(a,b,1.2,scratch);
  assert(Math.abs(repeat.distance-result.distance)<1e-8, 'correction is idempotent on scrub/re-render');
  kiss.syncMouthContact(null,null,0,scratch);
  assert(ja.position.length()<1e-8 && jb.position.length()<1e-8, 'correction restores neutral joints');
  window.SharedAttackPose.headFrame=originalHeadFrame;
  scene.remove(a,b);
}
