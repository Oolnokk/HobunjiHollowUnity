// Tzatzul carry release must never drag a dropped player/creature back to its
// pickup position or restore old orientation over a new fall/impact pose.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  copy(v) { return this.set(v.x, v.y, v.z); }
}
class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.set(x, y, z, w); this.isQuaternion = true; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  clone() { return new Quaternion(this.x, this.y, this.z, this.w); }
  copy(q) { return this.set(q.x, q.y, q.z, q.w); }
  dot(q) { return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w; }
  multiply(q) {
    const a = this.clone(); // Preserve both operands while composing native-style local rotations.
    return this.set(a.x*q.w+a.w*q.x+a.y*q.z-a.z*q.y,
      a.y*q.w+a.w*q.y+a.z*q.x-a.x*q.z,
      a.z*q.w+a.w*q.z+a.x*q.y-a.y*q.x,
      a.w*q.w-a.x*q.x-a.y*q.y-a.z*q.z);
  }
}
const poseWorld = { window: {}, console, performance: { now: () => 1000 } };
vm.runInNewContext(fs.readFileSync('docs/js/rig-transform-layers.js', 'utf8'), poseWorld);
vm.runInNewContext(fs.readFileSync('docs/js/tzatzul-live-visuals.js', 'utf8'), poseWorld);
const composer = poseWorld.window.ActorRigCompositor;
const visuals = poseWorld.window.TzatzulLiveVisuals;
const player = {}; // The independent creature fixture below must not accidentally resolve the local player's root.
visuals.init({ player, hostileObjects: new Set(), companionObjects: new Set(), getCurrentArea: () => 'wilderness' });
function creature() {
  const group = { name: 'captured-creature-rig', parent: {}, quaternion: new Quaternion(),
    scale: new Vector3(1, 1, 1), position: new Vector3(0, 2, 0) };
  return { health: 25, avatarRef: { group } };
}
{
  const prey = creature(), group = prey.avatarRef.group;
  assert(visuals.rememberCaptive(prey));
  assert.equal(composer.getDebug().activeAbsoluteClaims, 2, 'talons claim only orientation and scale');
  assert.equal(composer.absoluteOwner(group, 'quaternion'), 'tzatzul-captive');
  assert.equal(composer.absoluteOwner(group, 'position'), null, 'world travel must remain owned by the fall/flight solver');
  const competing = composer.createAbsoluteSession('impact-ragdoll');
  assert.equal(competing.capture(group, ['quaternion']), false, 'an active talon owns its rotation until a safe handoff');
  group.quaternion.copy(new Quaternion(.2, 0, 0, Math.sqrt(.96))); // A distinct fall/impact writer displaced the talon.
  group.position.set(4, 9, 3); // Released prey must remain at the actual new drop position.
  const falling = group.quaternion.clone();
  assert(visuals.restoreCaptive(prey), 'the original capture session can release after a fall takeover');
  assert(Math.abs(group.quaternion.dot(falling) - 1) < 1e-10, 'fall orientation survives talon cleanup');
  assert.equal(group.position.x, 4);
  assert.equal(group.position.y, 9);
  assert.equal(group.position.z, 3);
  assert.equal(composer.getDebug().activeAbsoluteClaims, 0);
  assert.equal(visuals.snapshot().captiveHandoffs, 1);
  assert(competing.capture(group, ['quaternion']), 'the falling action acquires the released orientation');
  competing.release();
}
{
  const prey = creature(), oldGroup = prey.avatarRef.group;
  assert(visuals.rememberCaptive(prey));
  assert.equal(composer.getDebug().activeAbsoluteClaims, 2);
  const replacement = { ...oldGroup, quaternion: new Quaternion(), scale: new Vector3(1,1,1),
    position: new Vector3(6, 0, 4) }; // Portrait promotion replaces the actor's rig without changing gameplay coordinates.
  prey.avatarRef.group = replacement;
  assert(visuals.rememberCaptive(prey), 'new captive rig supersedes stale old avatar');
  assert.equal(composer.getDebug().activeAbsoluteClaims, 2, 'old rig claims release before newly promoted rig is captured');
  assert.equal(composer.absoluteOwner(oldGroup, 'quaternion'), null, 'outgoing rig no longer owns talon rotation');
  assert(visuals.restoreCaptive(prey));
  assert.equal(composer.getDebug().activeAbsoluteClaims, 0);
  assert.equal(replacement.position.x, 6, 'releasing a new visual root never teleports its world position');
  assert.equal(visuals.restoreCaptive(prey), false, 'duplicate delayed releases are idempotent');
}
console.log('Tzatzul scoped captive pose release: successor fall, no teleport, rig rebuild, and owner cleanup PASS');
