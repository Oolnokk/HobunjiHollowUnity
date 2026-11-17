// Executable ownership tests: multiple simultaneous layers, handoffs,
// interruption/cleanup and the seated-leg/walking-bob drift regressions.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/rig-transform-layers.js', 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox, { filename: 'rig-transform-layers.js' });
const layers = sandbox.window.RigTransformLayers;
function rig() { return { position: { x: 0, y: 2, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }; }
function near(a, b) { assert.ok(Math.abs(a - b) < 1e-8, `${a} should equal ${b}`); }

{
  const node = rig();
  for (let frame = 0; frame < 600; frame++) {
    layers.setAxis(node, 'npc-move-bob', 'position', 'y', 0.3);
    near(node.position.y, 2.3); // Reapplying the same offset is idempotent.
  }
  layers.clear(node, 'npc-move-bob');
  near(node.position.y, 2);
  layers.setAxis(node, 'drunk-body', 'rotation', 'x', 0.25);
  layers.setAxis(node, 'yawn-body', 'rotation', 'x', -0.1);
  near(node.rotation.x, 0.15); // Independent temporary pose owners compose.
  layers.clear(node, 'drunk-body');
  near(node.rotation.x, -0.1);
  layers.clear(node, 'yawn-body');
  near(node.rotation.x, 0);
}
{
  const node = rig();
  for (let frame = 0; frame < 300; frame++) {
    layers.clear(node, 'npc-move-bob'); // At start of walker.update, before ground following.
    node.position.y += (2 - node.position.y) * 0.3;
    layers.setAxis(node, 'npc-move-bob', 'position', 'y', 0.24 * Math.sin(frame / 11));
  }
  layers.clear(node, 'npc-move-bob');
  near(node.position.y, 2); // Ground correction cannot permanently absorb bob.
}
{
  const node = rig();
  let firstFrameSlots = null; // Ensures the ledger allocates only during initial registration, not on every walking/seat frame.
  for (let frame = 0; frame < 240; frame++) {
    layers.clear(node, 'drunk-thigh-left'); // Before the procedural solver replaces the thigh.
    node.position.x += (0.4 - node.position.x) * 0.2; // Seated pose damping.
    layers.setPosition(node, 'drunk-thigh-left', { x: 0.2, y: -0.1, z: 0.05 });
    if (firstFrameSlots === null) firstFrameSlots = layers.getDebug().slotsCreated;
    else assert.equal(layers.getDebug().slotsCreated, firstFrameSlots, 'thigh layer reuses cached axis records');
  }
  layers.clear(node, 'drunk-thigh-left');
  near(node.position.x, 0.4);
  near(node.position.y, 2);
  near(node.position.z, 0);
}
{
  const node = rig();
  layers.setAxis(node, 'old-carry', 'rotation', 'x', 1.2);
  node.rotation.x = 0.4; // An unregistered pose writer may have left a contaminated baseline.
  layers.clear(node, 'old-carry');
  near(node.rotation.x, 0); // Unknown writes are rejected, never installed as the new neutral pose.
  assert.ok(layers.getDebug().outOfBandWrites >= 1);
  layers.setAbsoluteBase(node, 'rotation', 'x', 0.4); // Legitimate absolute handoff is explicit.
  layers.setAxis(node, 'new-action', 'rotation', 'x', 0.1);
  near(node.rotation.x, 0.5);
  layers.clear(node, 'new-action');
  near(node.rotation.x, 0.4);
  assert.ok(layers.getDebug().externalTakeovers >= 1);
}
{
  const node = rig();
  assert.equal(layers.setAxis(node, 'broken', 'position', 'y', Number.NaN), false);
  near(node.position.y, 2);
  layers.setPosition(node, 'paired', { x: 0.2, y: -0.4, z: 0.1 });
  layers.clearAll(node);
  near(node.position.x, 0);
  near(node.position.y, 2);
  near(node.position.z, 0);
  assert.equal(layers.getDebug().activeLayers, 0);
}
{
  const node = rig();
  node.position.y = Number.NaN; // A bad Y coordinate must never cause a partial X/Z mutation.
  assert.equal(layers.setPosition(node, 'partial', { x: 1, y: 2, z: 3 }), false);
  near(node.position.x, 0);
  near(node.position.z, 0);
  assert.equal(layers.getDebug().activeLayers, 0);
}
{
  const node = rig();
  layers.setAxis(node, 'tiny-handoff', 'position', 'y', 0.2);
  layers.clear(node, 'tiny-handoff');
  node.position.y += 5e-8; // Small external IK changes must refresh an already released baseline.
  layers.setAxis(node, 'tiny-handoff', 'position', 'y', 0.2);
  near(node.position.y, 2.20000005);
  layers.clear(node, 'tiny-handoff');
  near(node.position.y, 2.00000005);
}
// A Three.js-compatible quaternion stand-in tests mixed rotation ownership.
class Quat {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.set(x, y, z, w); this.isQuaternion = true; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  clone() { return new Quat(this.x, this.y, this.z, this.w); }
  copy(q) { return this.set(q.x, q.y, q.z, q.w); }
  multiply(q) {
    const a = this.clone();
    return this.set(a.x * q.w + a.w * q.x + a.y * q.z - a.z * q.y,
      a.y * q.w + a.w * q.y + a.z * q.x - a.x * q.z,
      a.z * q.w + a.w * q.z + a.x * q.y - a.y * q.x,
      a.w * q.w - a.x * q.x - a.y * q.y - a.z * q.z);
  }
}
function aroundX(radians) { return new Quat(Math.sin(radians / 2), 0, 0, Math.cos(radians / 2)); }
function angleX(q) { return 2 * Math.atan2(q.x, q.w); }

class EulerX {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; this.order = 'XYZ'; }
  clone() { return new EulerX(this.x, this.y, this.z); }
  setFromQuaternion(q) { this.x = angleX(q); this.y = 0; this.z = 0; return this; }
}
Quat.prototype.setFromEuler = function setFromEuler(e) {
  return this.set(Math.sin(e.x / 2), 0, 0, Math.cos(e.x / 2));
};
{
  const node = { ...rig(), quaternion: new Quat(), rotation: new EulerX() };
  layers.setAxis(node, 'npc-yawn-neck', 'rotation', 'x', -0.3);
  layers.setQuaternion(node, 'drunk-npc-body', aroundX(0.1));
  near(angleX(node.quaternion), -0.2);
  assert.equal(layers.setAbsoluteBase(node, 'rotation', 'x', 0.4), true,
    'authorized absolute Euler handoff updates the quaternion owner store');
  near(angleX(node.quaternion), 0.4);
  layers.clear(node, 'npc-yawn-neck');
  layers.clear(node, 'drunk-npc-body');
  near(angleX(node.quaternion), 0.4); // The now-released older poses cannot reappear.
}

{
  const node = { ...rig(), quaternion: new Quat(), name: 'npc_composed_chest' };
  layers.setAxis(node, 'npc-yawn-body', 'rotation', 'x', -0.2);
  layers.setQuaternion(node, 'drunk-npc-body', aroundX(0.5), { leaseMs: 500 });
  near(angleX(node.quaternion), 0.3);
  layers.clear(node, 'npc-yawn-body');
  near(angleX(node.quaternion), 0.5);
  layers.clear(node, 'drunk-npc-body');
  near(angleX(node.quaternion), 0);
  assert.equal(layers.getDebug().leasedSlots, 0);
}
{
  const node = { ...rig(), quaternion: new Quat(), name: 'npc_interrupted_tilt' };
  layers.setQuaternion(node, 'drunk-body', aroundX(0.3), { leaseMs: 20 });
  node.quaternion.copy(aroundX(0.9)); // Unknown writer replaced the owned rotation.
  layers.clear(node, 'drunk-body');
  near(angleX(node.quaternion), 0);
  assert.equal(layers.getDebug().lastOutOfBand.node, 'npc_interrupted_tilt');
  layers.setQuaternion(node, 'stale-foot', aroundX(-0.25), { leaseMs: 20 });
  layers.expireStale(Date.now() + 1000);
  near(angleX(node.quaternion), 0);
  assert.equal(layers.getDebug().leasedSlots, 0);
}
{
  vm.runInNewContext(fs.readFileSync('docs/js/actor-body-sink.js', 'utf8'), sandbox, { filename: 'actor-body-sink.js' });
  const sink = sandbox.window.ActorBodySink;
  const root = { ...rig(), userData: {} };
  const legs = { modelHeight: 10, drop: 0,
    setStanceDrop(value) { this.drop = value; }, getStanceDrop() { return this.drop; },
    setStanceYawDeg() {} };
  const actor = { legs, lower: [{ obj: root }] };
  sink.apply(actor, 10, 0, true);
  near(root.position.y, 1);
  sink.apply(actor, 15, 0, true);
  near(root.position.y, 0.5);
  sink.release(actor);
  near(root.position.y, 2);
}

// Workshop loads runtime scripts independently from the gameplay loader.
const editorScripts = fs.readFileSync('docs/tools/enemy-loadout-editor/preview.js', 'utf8');
const ledgerAt = editorScripts.indexOf("'js/rig-transform-layers.js?v=");
const composerAt = editorScripts.indexOf("'js/player-body-transform-composer.js?v=");
const drunkAt = editorScripts.indexOf("'js/drunk-locomotion.js?v=");
assert.ok(ledgerAt >= 0 && composerAt > ledgerAt && drunkAt > composerAt,
  'Workshop must share rig ownership before both the player compositor and drunken gait');
console.log('Rig transform layers: ownership, interrupts, drift, editor bootstrap and release PASS');
