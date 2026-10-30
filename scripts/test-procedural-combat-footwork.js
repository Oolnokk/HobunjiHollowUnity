'use strict';
const assert = require('assert'); // Verifies runtime foot targets and movement ownership.
const fs = require('fs'); // Loads the shipped solver into an isolated test context.
const vm = require('vm'); // Replaces asset IO while executing the real attachment/update code.

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  lengthSq() { return this.dot(this); }
  normalize() { const n = Math.sqrt(this.lengthSq()) || 1; return this.set(this.x / n, this.y / n, this.z / n); }
  lerp(v, t) { return this.set(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t, this.z + (v.z - this.z) * t); }
}
class Quaternion {
  copy() { return this; }
  slerp() { return this; }
}
class Group {
  constructor() {
    this.position = new Vector3(); this.rotation = { x: 0, y: 0, z: 0 };
    this.quaternion = new Quaternion(); this.scale = new Vector3(1, 1, 1);
    this.children = []; this.userData = {};
  }
  add(child) { child.parent = this; this.children.push(child); }
  remove(child) { this.children = this.children.filter(c => c !== child); }
  updateWorldMatrix() {}
  updateMatrixWorld() {}
  localToWorld(v) {
    const c = Math.cos(this.rotation.y), s = Math.sin(this.rotation.y), x = v.x, z = v.z; // Applies the test avatar's yaw.
    v.set(c * x + s * z + this.position.x, v.y + this.position.y, -s * x + c * z + this.position.z);
    return this.parent ? this.parent.localToWorld(v) : v;
  }
  worldToLocal(v) {
    if (this.parent) this.parent.worldToLocal(v);
    const c = Math.cos(this.rotation.y), s = Math.sin(this.rotation.y), x = v.x - this.position.x, z = v.z - this.position.z; // Inverts the same yaw and translation.
    return v.set(c * x - s * z, v.y - this.position.y, s * x + c * z);
  }
  traverse(fn) { fn(this); this.children.forEach(child => child.traverse(fn)); }
}
const THREE = { Group, Vector3, Quaternion,
  Matrix4: class { copy() { return this; } invert() { return this; } },
  Box3: class { makeEmpty() { return this; } isEmpty() { return true; } },
}; // Geometry-free transforms keep this regression test independent of WebGL and network dependencies.
const context = { URL, console, location: { href: 'https://example.test/docs/' }, document: {}, window: {}, THREE }; // Hosts the actual procedural leg module.
context.window.LegBones = { solveTwoBoneLeg(_three, options) {
  const length = options.foldMaxLength || Math.hypot(options.hip.x - options.foot.x, options.hip.y - options.foot.y, options.hip.z - options.foot.z); // Retains the real solver's output shape.
  return { thighQuaternion: new Quaternion(), calfLocalQuaternion: new Quaternion(), thighLength: length / 2, calfLength: length / 2 };
} };
let source = fs.readFileSync('docs/js/procedural-leg-animation.js', 'utf8'); // Only rendering/asset factories are replaced; gait, lunge, airborne, and diagnostics execute unchanged.
source = source.replace('  window.ProceduralLegAnimation = {', `
  buildFallbackFoot = function () { const foot = new THREE.Group(); foot.userData.contactRadiusY = 0.04; return foot; };
  makeSurfaceRoleResolver = function () { return () => new Promise(() => {}); };
  makeBoneGuide = makeJointGuide = function () { return new THREE.Group(); };
  window.ProceduralLegAnimation = {`);
vm.runInNewContext(source, context);
function rig(height = 1, gaitProfile = null) {
  const parent = new Group(); // Moves independently from the captured world-space foot contacts.
  const legs = context.window.ProceduralLegAnimation.attach(THREE, parent, { speciesId: 'test', modelHeight: height, gaitProfile }); // Exercises the shipped attach entry point.
  return { parent, legs };
}
function tick(legs, speed, motion, count = 180) {
  for (let i = 0; i < count; i++) legs.update(1 / 60, speed, false, undefined, motion);
  return legs.getStandingPoseDebug();
}
const walk = rig(), run = rig(), tall = rig(2); // Compares mode changes at identical speed and different anatomical lengths.
const walkDebug = tick(walk.legs, 2, {}), runDebug = tick(run.legs, 2, { combat: true }); // Settled walk/run cycles.
assert(runDebug.gait.strideLength > walkDebug.gait.strideLength * 1.4);
assert(runDebug.gait.runBlend > 0.99);
assert.strictEqual(runDebug.motionMode, 'run');
assert(run.legs.getRunLean() > 0, 'running leans toward local forward');
assert(Math.abs(run.legs.getRunLean()) <= 30 * Math.PI / 180);
assert.strictEqual(walk.legs.getRunLean(), 0, 'walking remains upright');
tick(run.legs, 4.3, { combat: true });
assert(Math.abs(run.legs.getRunLean() - Math.PI / 6) < 1e-9, 'full-speed running reaches thirty degrees');
const tallDebug = tick(tall.legs, 2, { combat: true }); // Stride changes exactly with measured leg length.
assert(Math.abs(tallDebug.gait.fullStride / runDebug.gait.fullStride - tallDebug.gait.legLength / runDebug.gait.legLength) < 1e-9);
const falling = tick(run.legs, 9, { combat: true, airborne: true }); // High horizontal speed must not resume running in the air.
assert.strictEqual(falling.motionMode, 'airborne');
assert.strictEqual(run.legs.getRunLean(), 0, 'airborne pose replaces the running lean');
assert.strictEqual(falling.gait.strideLength, 0);
assert(falling.left.targetY > falling.left.contactY);
assert(falling.right.targetY > falling.right.contactY);
run.legs.update(1 / 60, 9, true, undefined, { airborne: true });
assert.strictEqual(run.legs.getStandingPoseDebug().motionMode, 'suppressed');
const lunge = rig(); // Captures a non-neutral starting pose, then rotates/moves the root during the lunge.
tick(lunge.legs, 2, {});
lunge.legs.beginLunge(1, 0);
const lead = lunge.legs.getStandingPoseDebug().lungeLead; // The other foot must retain its world-space support contact.
const rear = lead === 'left' ? 'right' : 'left'; // Picks the foot that should remain planted.
const beforePose = lunge.legs.getStandingPoseDebug()[rear]; // Captures the complete support contact for a world-space lock assertion.
const beforeWorld = lunge.legs.group.localToWorld(new Vector3(beforePose.targetX, beforePose.targetY, beforePose.targetZ));
const before = beforePose.targetY; // Retains the current vertical phase rather than resetting to idle.
lunge.parent.position.x += 0.03;
lunge.parent.rotation.y = 0.5;
lunge.legs.update(0, 2, false, undefined, { lunging: true, directionX: 1, directionZ: 0 });
assert.strictEqual(lunge.legs.getStandingPoseDebug().motionMode, 'lunge');
assert.strictEqual(lunge.legs.getRunLean(), 0, 'lunge body pose is independent of running');
assert(Math.abs(lunge.legs.getStandingPoseDebug()[rear].targetY - before) < 1e-9);
const afterPose = lunge.legs.getStandingPoseDebug()[rear]; // The support foot remains fixed even as the root translates and rotates.
const afterWorld = lunge.legs.group.localToWorld(new Vector3(afterPose.targetX, afterPose.targetY, afterPose.targetZ));
assert(Math.hypot(afterWorld.x - beforeWorld.x, afterWorld.z - beforeWorld.z) < 1e-9);
for (let i = 0; i < 90; i++) {
  lunge.parent.position.x += 0.01;
  lunge.legs.update(1 / 60, 2, false, undefined, { lunging: true, directionX: 1, directionZ: 0 });
  assert(Number.isFinite(lunge.legs.getStandingPoseDebug().left.targetY));
}
for (const height of [0.5, 1, 2]) {
  for (const direction of [{ x: 1, z: 0 }, { x: 0, z: -1 }, { x: -0.6, z: 0.8 }]) {
    const bounded = rig(height); // Exercises short/long anatomy and attacks along multiple world headings.
    const stance = bounded.legs.getRestStance(); // Supplies each foot's own hip and contact coordinates.
    bounded.legs.beginLunge(direction.x, direction.z);
    const support = bounded.legs.getStandingPoseDebug().lungeLead === 'left' ? 'right' : 'left'; // Identifies the grounded rear foot while the lead is swinging.
    for (const dt of [0, 1 / 60, 0.1]) {
      for (let frame = 0; frame < 24; frame++) {
        bounded.parent.position.x += direction.x * height * 0.3;
        bounded.parent.position.z += direction.z * height * 0.3;
        bounded.parent.rotation.y += 0.07;
        bounded.legs.update(dt, 12, false, undefined, { lunging: true });
        const pose = bounded.legs.getStandingPoseDebug(); // Checks the final targets used by both the leg bones and bound pant legs.
        for (const side of ['left', 'right']) {
          const reach = Math.hypot(pose[side].targetX - stance[side].hip.x, pose[side].targetZ); // Root-local horizontal reach must be bounded even while the other foot swings.
          const limit = (stance[side].hip.y - stance[side].ankle.y) * 0.65; // Matches the anatomy-derived recovery threshold.
          assert(reach <= limit + 1e-9, `${side} exceeded lunge reach at height ${height}, dt ${dt}`);
        }
        if (dt === 0) assert(Math.abs(pose[support].targetY - pose[support].contactY) < 1e-9, 'sliding rear foot stays grounded');
      }
    }
    bounded.legs.update(1 / 60, 12, false, undefined, { lunging: true, airborne: true });
    assert.strictEqual(bounded.legs.getStandingPoseDebug().motionMode, 'airborne', 'airborne lunges still use dangling legs');
  }
}
const lurch = rig(1, { style: 'maskbound-lurch', dragSide: 'left', cadence: 0.78, stance: 0.69, dragLift: 0.1, lurchDegrees: 16 }); // Isolated puppet gait over the same shared foot and bone solver.
const maxLift = { left: 0, right: 0 }; // Accumulates lifted-foot height to prove a true dragging foot rather than ordinary run pacing.
for (let i = 0; i < 240; i++) {
  lurch.legs.update(1 / 60, 2, false, undefined, { combat: true });
  const pose = lurch.legs.getStandingPoseDebug();
  maxLift.left = Math.max(maxLift.left, pose.left.targetY - pose.left.contactY);
  maxLift.right = Math.max(maxLift.right, pose.right.targetY - pose.right.contactY);
}
const lurchDebug = lurch.legs.getStandingPoseDebug(); // Existing mobile debug snapshot must identify the creature-only style and phase.
assert.equal(lurchDebug.motionMode, 'maskbound-lurch');
assert.equal(lurchDebug.gait.style, 'maskbound-lurch');
assert.equal(lurchDebug.gait.dragSide, 'left');
assert(maxLift.right > maxLift.left * 1.4, 'supporting foot lifts much higher than the scraping foot');
assert(lurch.legs.getRunLean() > 0.05, 'wooden puppet visually lurches forward even at ordinary walking speed');
assert(lurchDebug.gait.runBlend < 0.25, 'combat movement does not switch into normal humanoid sprinting');
lurch.legs.update(1 / 60, 0, false);
assert.equal(lurch.legs.getStandingPoseDebug().motionMode, 'idle', 'lurch stops without vibrating in place');
assert.equal(lurch.legs.getRunLean(), 0, 'torso snaps back to neutral on stopping');
lurch.legs.beginLunge(1, 0);
lurch.legs.update(1 / 60, 2, false, undefined, { lunging: true });
assert.equal(lurch.legs.getStandingPoseDebug().motionMode, 'lunge', 'attack lunges override the puppet walk');
lurch.legs.update(1 / 60, 2, true);
assert.equal(lurch.legs.getStandingPoseDebug().motionMode, 'suppressed', 'death/knockdown suppresses puppet walk');

lunge.legs.update(NaN, Infinity, false);
assert.strictEqual(lunge.legs.getStandingPoseDebug().motionMode, 'idle');
assert.strictEqual(lunge.legs.getStandingPoseDebug().gait.strideLength, 0);
console.log('procedural combat footwork: passed');
