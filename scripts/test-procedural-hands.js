const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  lengthSq() { return this.dot(this); }
  length() { return Math.sqrt(this.lengthSq()); }
  normalize() { const length = this.length(); return length > 0 ? this.multiplyScalar(1 / length) : this; }
}

class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  clone() { return new Quaternion(this.x, this.y, this.z, this.w); }
  normalize() {
    const length = Math.hypot(this.x, this.y, this.z, this.w) || 1;
    this.x /= length; this.y /= length; this.z /= length; this.w /= length;
    return this;
  }
  setFromUnitVectors(from, to) {
    let real = from.dot(to) + 1;
    if (real < 1e-6) {
      real = 0;
      if (Math.abs(from.x) > Math.abs(from.z)) { this.x = -from.y; this.y = from.x; this.z = 0; }
      else { this.x = 0; this.y = -from.z; this.z = from.y; }
    } else {
      this.x = from.y * to.z - from.z * to.y;
      this.y = from.z * to.x - from.x * to.z;
      this.z = from.x * to.y - from.y * to.x;
    }
    this.w = real;
    return this.normalize();
  }
  invert() { this.x *= -1; this.y *= -1; this.z *= -1; return this; }
  multiply(q) {
    const ax = this.x, ay = this.y, az = this.z, aw = this.w;
    this.x = ax * q.w + aw * q.x + ay * q.z - az * q.y;
    this.y = ay * q.w + aw * q.y + az * q.x - ax * q.z;
    this.z = az * q.w + aw * q.z + ax * q.y - ay * q.x;
    this.w = aw * q.w - ax * q.x - ay * q.y - az * q.z;
    return this;
  }
}

const context = { window: {}, console };
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/arm-bones.js', 'utf8'), context);
const THREE = { Vector3, Quaternion };
const ArmBones = context.window.ArmBones;

const overreach = ArmBones.constrainTarget(THREE, { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }, 1);
assert.equal(overreach.clamped, true);
assert(Math.abs(overreach.target.y) < 1e-9, 'overextended grip projects onto the one-unit reach sphere');
assert.equal(overreach.requestedDistance, 2);
assert.equal(overreach.constrainedDistance, 1);

const withinReach = ArmBones.solveTwoBoneArm(THREE, {
  shoulder: { x: 0, y: 1, z: 0 },
  target: { x: 0.2, y: 0.6, z: 0.1 },
  armLength: 1,
  pole: { x: 0.4, y: 0, z: 1 },
});
assert.equal(withinReach.clamped, false);
assert.equal(withinReach.upperLength, 0.5);
assert.equal(withinReach.forearmLength, 0.5);
for (const value of Object.values(withinReach.upperQuaternion)) assert(Number.isFinite(value));
for (const value of Object.values(withinReach.forearmLocalQuaternion)) assert(Number.isFinite(value));

const portrait = fs.readFileSync('docs/js/portrait-utils.js', 'utf8');
const avatar = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8');
const runtime = fs.readFileSync('docs/game.js', 'utf8');
const bandits = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8');
const editor = fs.readFileSync('docs/tools/attack-animation-editor/index.html', 'utf8');
const config = fs.readFileSync('docs/config/scratchbones-config.js', 'utf8');

assert(portrait.includes('yRatio: scan.firstOpaque.yRatio + 0.10'), 'shoulder scan moves 10% portrait height below the first opaque arm pixel');
assert(avatar.includes('rightShoulder.y - root.userData.handAttachY'), 'arm length is shoulder Y minus tool attach Y');
assert(runtime.indexOf('updatePlayerHandsFromTool();') > runtime.indexOf('updateToolMesh(dt);'), 'player hand reach runs after the final tool pose');
assert(bandits.includes('hands.followWorldTarget(worldGrip, worldGripQuaternion)'), 'bandit attacks share the tool-following hand rig');
assert(editor.includes('constrainAllAuthoredPoses();'), 'editor exports clamp authored pose coordinates to current-species reach');
for (const model of ['hand_feline.glb', 'hand_pachyderm.glb', 'hand_parrot.glb', 'hand_sloth.glb']) {
  assert(config.includes(`assets/models/hands/${model}`), `${model} is configured`);
  assert(fs.existsSync(`docs/assets/models/hands/${model}`), `${model} exists`);
}

console.log('procedural hands: all checks passed');
