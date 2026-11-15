#!/usr/bin/env node
'use strict';
// Real Three.js r128 regression for the shared NPC yawning/drunken torso,
// quaternion/Euler synchronization, combat takeover and rig disposal.
// The fast suite can run without npm deps; regression-suite.yml reruns this
// with three@0.128.0 after its dependency-install step.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let THREE;
try { THREE = require('three'); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('SKIP: real Three.js r128 is installed in the browser phase of CI');
  process.exit(0);
}

const approx = (a, b, label, epsilon = 1e-7) =>
  assert.ok(Math.abs(a - b) < epsilon, `${label}: ${a} vs ${b}`);
const sameQuaternion = (a, b, label) =>
  assert.ok(Math.abs(Math.abs(a.dot(b)) - 1) < 1e-8, label);
const partsFor = group => ({
  leftFoot: group.getObjectByName('left_foot'),
  rightFoot: group.getObjectByName('right_foot'),
}); // Used to verify a replaced combat foot and a still-owned foot separately.
const legApi = {
  attach(_THREE, bodyRoot) {
    const group = new THREE.Group();
    for (const side of ['left', 'right']) {
      const thigh = new THREE.Group(); thigh.name = side + '_thigh';
      const foot = new THREE.Group(); foot.name = side + '_foot';
      group.add(thigh, foot);
    }
    bodyRoot.add(group);
    return {
      group,
      update(_dt, _speed, _suppressed, seated) {
        for (const side of ['left', 'right']) {
          const thigh = group.getObjectByName(side + '_thigh');
          thigh.position.set(seated ? .2 : .1, seated ? -.06 : 0, 0);
        }
      },
      dispose() { bodyRoot.remove(group); },
    };
  },
}; // Small procedural solver stub; the real drunken decorator and Three.js transforms run unmodified.

const w = {
  THREE, ProceduralLegAnimation: legApi, SCRATCHBONES_CONFIG: {},
  Combat: { deps: { player: { footing: 100, maxFooting: 100 } } },
};
for (const path of ['docs/js/rig-transform-layers.js','docs/js/drunk-locomotion.js']) {
  vm.runInNewContext(fs.readFileSync(path, 'utf8'), { window: w, console, Math, Date }, { filename: path });
}

const layers = w.RigTransformLayers;
const body = new THREE.Group();
const npc = w.ProceduralLegAnimation.attach(THREE, body, {
  name: 'Pose Guard NPC', drunkBodyRoot: body,
  modelWidth: .9, modelHeight: .9, drunkLossProvider: () => .83,
});
const feet = partsFor(npc.group);
let latestYawn = 0; // The real yawn module uses this named X-axis offset on the shared body.
for (let i = 0; i < 700; i++) {
  latestYawn = .1 * Math.sin(i / 13);
  layers.setAxis(body, 'npc-yawn-body', 'rotation', 'x', latestYawn);
  npc.update(.016, i % 7 === 0 ? 0 : 2, false, i % 7 === 0);
  const combinedPitch = body.rotation.x;
  layers.clear(body, 'npc-yawn-body');
  approx(body.rotation.x, combinedPitch - latestYawn, 'yawn release preserves drunk pitch');
  layers.setAxis(body, 'npc-yawn-body', 'rotation', 'x', latestYawn);
  approx(body.rotation.x, combinedPitch, 'reapplying yawn is idempotent');
  assert.ok(Number.isFinite(body.quaternion.w), 'no invalid quaternion after concurrent poses');
}
const baselineRightFoot = new THREE.Quaternion();
npc.dispose();
approx(body.rotation.x, latestYawn, 'disposing drunk sway leaves the active yawn');
approx(body.rotation.z, 0, 'drunk roll must be gone on disposal');
sameQuaternion(feet.rightFoot.quaternion, baselineRightFoot, 'still-owned right-foot twist released');
layers.clear(body, 'npc-yawn-body');
approx(body.rotation.x, 0, 'the final yawn owner restores the exact neutral pitch');
assert.equal(layers.getDebug().activeLayers, 0, 'all named owners released');

// A real external quaternion write synchronizes its Euler. The ledger must
// discard the previous drunken offsets rather than invert the newer pose.
const bodyAfter = new THREE.Group();
const next = w.ProceduralLegAnimation.attach(THREE, bodyAfter, {
  name: 'Pose Guard NPC Rebuilt', drunkBodyRoot: bodyAfter,
  modelWidth: .9, modelHeight: .9, drunkLossProvider: () => .91,
});
next.update(.15, 3, false, false);
const newBodyPose = new THREE.Quaternion().setFromEuler(new THREE.Euler(.6, .2, -.5, 'YXZ'));
const newFootPose = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), 1.2);
bodyAfter.quaternion.copy(newBodyPose);
next.group.getObjectByName('left_foot').quaternion.copy(newFootPose);
next.dispose();
sameQuaternion(bodyAfter.quaternion, newBodyPose, 'external combat torso owns post-disposal pose');
sameQuaternion(next.group.getObjectByName('left_foot').quaternion, newFootPose,
  'external IK foot owns post-disposal pose');
assert.ok(layers.getDebug().externalTakeovers >= 1,
  'shared Euler ownership ledger records the external torso takeover');
assert.ok(w.HobunjiDrunkWalk.getDebug().poseHandoffs.foot >= 1,
  'mobile diagnostic records superseded foot twist');
assert.equal(layers.getDebug().activeLayers, 0, 'rebuild frees every active owner');
console.log('Real Three.js: drunken gait + named yawn composition, 700-frame drift, combat takeover, disposal PASS');
