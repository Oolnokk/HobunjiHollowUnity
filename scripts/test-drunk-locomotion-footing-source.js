'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const modulePath = path.join(__dirname, '..', 'docs', 'js', 'drunk-locomotion.js');
const source = fs.readFileSync(modulePath, 'utf8');

class Quaternion {
  constructor() { this.identity(); this.isQuaternion = true; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  identity() { return this.set(0, 0, 0, 1); }
  clone() { return new Quaternion().copy(this); }
  copy(q) { return this.set(q.x, q.y, q.z, q.w); }
  invert() { return this.set(-this.x, -this.y, -this.z, this.w); }
  multiply(q) {
    const a = this.clone(); // Snapshot left operand for the same quaternion multiplication as Three.js.
    return this.set(a.x * q.w + a.w * q.x + a.y * q.z - a.z * q.y,
      a.y * q.w + a.w * q.y + a.z * q.x - a.x * q.z,
      a.z * q.w + a.w * q.z + a.x * q.y - a.y * q.x,
      a.w * q.w - a.x * q.x - a.y * q.y - a.z * q.z);
  }
  setFromEuler(e) {
    const cx = Math.cos(e.x / 2), sx = Math.sin(e.x / 2); // X local half-rotation.
    const cy = Math.cos(e.y / 2), sy = Math.sin(e.y / 2); // Y local half-rotation.
    const cz = Math.cos(e.z / 2), sz = Math.sin(e.z / 2); // Z local half-rotation.
    return this.set(sx * cy * cz + cx * sy * sz,
      cx * sy * cz - sx * cy * sz,
      cx * cy * sz - sx * sy * cz,
      cx * cy * cz + sx * sy * sz);
  }
}

class Euler {
  constructor(x, y, z, order) {
    this.x = x; this.y = y; this.z = z; this.order = order;
  }
}

const player = {
  footing: 35,
  maxFooting: 100,
  afflictions: { drunkenFooting: 0 },
};

let npcProviderCalls = 0;
let poseClockMs = 1000; // Monotonic test clock for the player's last genuine leg solver update.
const ProceduralLegAnimation = {
  attach() {
    return {
      group: { getObjectByName() { return null; } },
      update() {},
      dispose() {},
    };
  },
};

const context = {
  console,
  performance: { now: () => poseClockMs }, // Supplies the same timestamp source read by the runtime compositor.
  window: {
    ProceduralLegAnimation,
    Combat: { deps: { player } },
    PlayerBodyTransformComposer: { setChannel() {}, clearChannel() {} },
    SCRATCHBONES_CONFIG: {},
  },
};
context.globalThis = context.window;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'rig-transform-layers.js'), 'utf8'),
  context, { filename: 'rig-transform-layers.js' }); // Real compositor runs before the drunken gait wrapper.
vm.runInContext(source, context, { filename: modulePath });

// The player's unsteady gait follows CURRENT missing Footing, even when sober.
assert.ok(Math.abs(context.window.HobunjiDrunkWalk.getDebug().loss - 0.65) < 1e-12);
player.footing = 100;
player.afflictions.drunkenFooting = 90;
assert.strictEqual(context.window.HobunjiDrunkWalk.getDebug().loss, 0);
player.footing = 60;
assert.ok(Math.abs(context.window.HobunjiDrunkWalk.getDebug().loss - 0.4) < 1e-12);

// Non-combat NPCs retain their independent sobriety/alcohol provider. Their
// gait input is not derived from the player's or a combat Footing resource.
const THREE = { Quaternion, Euler };
const playerLegs = ProceduralLegAnimation.attach(THREE, {}, { name: 'player' });
const livePlayerPose = context.window.HobunjiDrunkWalk.currentPlayerPoseSample(); // Stable, allocation-free reference reused across render passes.
assert.ok(livePlayerPose && livePlayerPose.lastUpdatedAtMs === null, 'live pose starts without a solver timestamp');
assert.strictEqual(context.window.HobunjiDrunkWalk.getDebug().lastUpdatedAtMs, null, 'attaching a rig is not a movement sample');
playerLegs.update(0.016, 2.5, false, false);
assert.strictEqual(context.window.HobunjiDrunkWalk.getDebug().lastUpdatedAtMs, 1000, 'actual gait update stamps the pose');
poseClockMs = 1500;
assert.strictEqual(context.window.HobunjiDrunkWalk.getDebug().lastUpdatedAtMs, 1000, 'render-only inspection cannot refresh the pose');
playerLegs.update(0.016, 2.5, false, false);
assert.strictEqual(context.window.HobunjiDrunkWalk.getDebug().lastUpdatedAtMs, 1500, 'a new gait step renews the sample');
assert.strictEqual(context.window.HobunjiDrunkWalk.currentPlayerPoseSample(), livePlayerPose, 'render consumers reuse the exact live state without allocating');
playerLegs.dispose();
assert.strictEqual(context.window.HobunjiDrunkWalk.getDebug().lastUpdatedAtMs, null, 'disposed rigs cannot supply stale pose samples');

const npcBodyRoot = { quaternion: new Quaternion() };
const npcLegs = ProceduralLegAnimation.attach(THREE, {}, {
  name: 'Furunji Funji',
  modelWidth: 0.9,
  modelHeight: 0.9,
  drunkBodyRoot: npcBodyRoot,
  drunkLossProvider() {
    npcProviderCalls++;
    return 0.7;
  },
});
npcLegs.update(0.016, 1.2, false, false);
assert.strictEqual(npcProviderCalls, 1);
const ownership = context.window.ActorRigCompositor; // Real named quaternion owner used by the production NPC gait.
assert.ok(ownership.getDebug().quaternionWrites > 0, 'NPC drunk body tilt enters the shared compositor');
assert.ok(ownership.getDebug().activeLayers > 0, 'NPC sway remains owned while the gait is active');
npcLegs.dispose();
assert.strictEqual(ownership.getDebug().activeLayers, 0, 'Interrupted NPC gait releases its body quaternion layer');
assert.ok(Math.abs(npcBodyRoot.quaternion.x) < 1e-8 && Math.abs(npcBodyRoot.quaternion.w - 1) < 1e-8,
  'NPC body returns to the original clean quaternion after disposal');

console.log('drunk-locomotion footing sources: all checks passed');
