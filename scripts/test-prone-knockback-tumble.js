#!/usr/bin/env node
'use strict';

// Execute the shipped procedural prone-hit presentation for both player and
// creature rigs without WebGL. No new baked animation or additive pose owner.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() { const d = Math.sqrt(this.lengthSq()) || 1; return this.set(this.x / d, this.y / d, this.z / d); }
}
class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.set(x, y, z, w); }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(q) { return this.set(q.x, q.y, q.z, q.w); }
  clone() { return new Quaternion(this.x, this.y, this.z, this.w); }
  identity() { return this.set(0, 0, 0, 1); }
  invert() { return this.set(-this.x, -this.y, -this.z, this.w); }
  setFromAxisAngle(axis, a) {
    const s = Math.sin(a / 2);
    return this.set(axis.x * s, axis.y * s, axis.z * s, Math.cos(a / 2));
  }
  multiply(q) {
    const { x, y, z, w } = this;
    return this.set(w*q.x + x*q.w + y*q.z - z*q.y,
      w*q.y - x*q.z + y*q.w + z*q.x,
      w*q.z + x*q.y - y*q.x + z*q.w,
      w*q.w - x*q.x - y*q.y - z*q.z);
  }
  slerp(q, t) {
    return this.set(this.x + (q.x - this.x)*t, this.y + (q.y - this.y)*t,
      this.z + (q.z - this.z)*t, this.w + (q.w - this.w)*t);
  }
}
class Group {
  constructor() {
    this.parent = null; this.children = []; this.isObject3D = true;
    this.position = { x: 0, y: 0, z: 0 }; this.quaternion = new Quaternion();
  }
  add(node) {
    node.parent?.remove(node);
    node.parent = this;
    this.children.push(node);
  }
  remove(node) { this.children = this.children.filter(c => c !== node); node.parent = null; }
}
const q = () => ({ x: 0, y: 0, z: 0, w: 1 });
const leg = () => ({ thighQuaternion: q(), calfLocalQuaternion: q(), upperLength: 1, lowerLength: 1 });
const frame = (t, y) => ({
  t, ragdoll: { body: { localQuaternion: q(), localPosition: { y } }, ik: { left: leg(), right: leg() } },
});
const clip = { durationSeconds: 0.34, frames: [frame(0, 0), frame(.34, -.12)] };
const player = { prone: true, health: 100 };
const poses = [];
const window = {
  Combat: { deps: { player } },
  ImpactBlendLibrary: { getClip: (bank) => bank === 'breakThrow' ? clip : null },
  PlayerBodyTransformComposer: { setChannel: (_name, pose) => poses.push({
    ...pose, quaternion: pose.quaternion.clone(),
  }), clearChannel: () => {} },
  ActorRigCompositor: { createAbsoluteSession: () => ({
    capture: () => true, owns: () => true, stamp: () => {}, release: () => {},
  }) },
};
vm.runInNewContext(fs.readFileSync('docs/js/combat/impact-ragdoll-playback.js', 'utf8'),
  { window, THREE: { Vector3, Quaternion, Group }, Math });
const anim = window.ImpactRagdollPlayback;
anim.attach(null, { applyRecordedLegPose() {}, pants: { update() {} } });
assert.equal(anim.triggerTumble(player, 'right', .34), true, 'a prone player can begin a procedural roll');
assert.equal(anim.getDebug().bank, 'tumble');
anim.update(.17);
const half = poses.at(-1);
assert.equal(half.absoluteLegs, false, 'recorded legs tumble with the body, not independently in place');
assert(half.translation.y > .1, 'procedural arc lifts the prone body visually');
assert(Math.abs(half.quaternion.z) > .9, 'right-side hit rotates around Z, not the head yaw');
anim.update(.17);
assert.equal(anim.isHolding(), true, 'player returns to an authored held prone pose');
assert.equal(poses.at(-1).absoluteLegs, true);
assert.equal(player.prone, true, 'the visual animation never stands the actor up');
assert.equal(anim.triggerTumble(player, 'left', .34), true, 'a second hit can restart a fresh throw');

const root = new Group(), planes = new Group();
root.add(planes);
const front = new Group(), back = new Group();
planes.add(front); planes.add(back);
const creature = { prone: true, health: 100, halfHeight: .5, avatarRef: { group: root, frontPlane: front, backPlane: back } };
assert.equal(anim.triggerTumble(creature, 'front', .34), true, 'creature can use the same procedural tumble API');
const state = creature._impactRagdollPlayback;
assert(state?.pivot && state?.poseSession, 'creature shares the owned impact pivot, rather than creating a second rig');
anim.updateCreature(creature, .17);
assert.equal(state.bank, 'tumble');
assert(state.pivot.position.y > 0, 'creature fake-airborne arc advances through owned pivot');
anim.updateCreature(creature, .17);
assert.equal(state.holding, true, 'creature returns to the held prone pose');
assert.equal(creature.prone, true);
anim.stopCreature(creature);
assert.equal(creature._impactRagdollPlayback, null, 'pivot ownership is released on stop');
console.log('Procedural prone knockback tumble player/creature and pose restoration: OK');
