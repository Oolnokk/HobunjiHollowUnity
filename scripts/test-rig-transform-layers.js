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

// Paired absolute sessions detect takeover at the parent, not just an unchanged local neck.
class XYZ {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new XYZ(this.x, this.y, this.z); }
  copy(v) { return this.set(v.x, v.y, v.z); }
}
{
  const root = { name: 'paired-root', position: new XYZ(), quaternion: new Quat(), parent: { name: 'scene' } };
  const neck = { name: 'paired-neck', position: new XYZ(0, 1, 0), quaternion: new Quat(), parent: root };
  const first = layers.createAbsoluteSession('first-paired-animation');
  assert(first.capture(root, ['position', 'quaternion']));
  assert(first.capture(neck, ['position', 'quaternion']));
  assert(layers.getDebug().absoluteOwners.some(entry => entry.owner === 'first-paired-animation' && entry.claims === 4),
    'mobile rig diagnostics must identify the active paired action and its claimed transforms');
  const concurrent = layers.createAbsoluteSession('other-action');
  assert.equal(concurrent.capture(root, ['position']), false, 'a second action cannot seize the same live position');
  root.position.x = .5;
  neck.quaternion.copy(aroundX(.3));
  assert(first.stamp());
  assert(first.owns());
  root.position.x = 1.8; // New animation took over root, without rewriting the nested neck's local values.
  assert.equal(first.owns(), false, 'out-of-band root movement invalidates the old scoped action');
  const rollback = first.release();
  assert.equal(rollback.skipped, 4, 'a displaced root preserves its orientation and both descendant neck properties');
  assert.equal(rollback.restored, 0, 'an externally displaced node must not receive a stale quaternion reset');
  near(root.position.x, 1.8);
  assert.equal(first.wasRestored(root, 'quaternion'), false, 'root quaternion is handed over with its external position');
  near(angleX(neck.quaternion), .3);
  assert.equal(first.wasRestored(neck, 'quaternion'), false, 'parent takeover blocks descendant restoration');
  assert.equal(layers.getDebug().activeAbsoluteClaims, 0);
  assert(concurrent.capture(root, ['position']), 'a new action can capture the fully released node');
  root.position.x = 2.4;
  concurrent.stamp();
  concurrent.release();
  near(root.position.x, 1.8);
}
{
  const root = { ...rig(), userData: {} };
  const sink = sandbox.window.ActorBodySink; // Multiple independent actors may both own body sink on the same rig.
  const legs = { modelHeight: 10, drop: 0, setStanceDrop(v) { this.drop = v; },
    getStanceDrop() { return this.drop; }, setStanceYawDeg() {} };
  const kiss = { ownerId: 'spouse-kiss-npc-sink', legs, lower: [{ obj: root }] };
  const watch = { ownerId: 'watchman-idle-sink', legs, lower: [{ obj: root }] };
  sink.apply(kiss, 10, 0, true);
  sink.apply(watch, 15, 0, true);
  near(root.position.y, -.5); // Sum of independent contributions, no destructive base overwrite.
  sink.release(kiss);
  near(root.position.y, .5); // The kiss releases only its own 1-unit contribution.
  sink.release(watch);
  near(root.position.y, 2);
}

// The production NPC wrist overlay is idempotent across repeated render passes,
// yet accepts a new ordinary hand-driver pose as its clean baseline.
class Position3 {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  clone() { return new Position3(this.x, this.y, this.z); }
  copy(v) { Object.assign(this, { x: v.x, y: v.y, z: v.z }); return this; }
}
{
  const socket = { name: 'npc_left_hand_socket', parent: { name: 'live-hand-rig' },
    position: new Position3(0, 1, 0), quaternion: new Quat() };
  const apply = (node, basePos, baseQuat) => {
    node.position.y = basePos.y + 0.7;
    node.quaternion.copy(baseQuat).multiply(aroundX(.2));
  }; // Identical dance pose reused by the ordinary, outline, and depth renders.
  for (let render = 0; render < 12; render++) {
    assert.equal(layers.applyPoseOverlay(socket, 'npc-dance-hand:test:left', apply), true);
    near(socket.position.y, 1.7);
    near(angleX(socket.quaternion), .2);
  }
  assert.equal(layers.absoluteOwner(socket, 'quaternion'), 'npc-dance-hand:test:left');
  assert(layers.getDebug().absoluteOwners.some(o => o.owner === 'npc-dance-hand:test:left' && o.claims === 2));
  socket.position.y = 3.1; // Ordinary procedural hand driver authored a new grip between render passes.
  socket.quaternion.copy(aroundX(.15));
  layers.applyPoseOverlay(socket, 'npc-dance-hand:test:left', apply);
  near(socket.position.y, 3.8);
  near(angleX(socket.quaternion), .35);
  assert.equal(layers.releasePoseOverlay(socket, 'npc-dance-hand:test:left'), true);
  near(socket.position.y, 3.1);
  near(angleX(socket.quaternion), .15);
  assert.equal(layers.getDebug().activeAbsoluteClaims, 0);
  layers.applyPoseOverlay(socket, 'npc-dance-hand:test:left', apply);
  socket.quaternion.copy(aroundX(.51)); // New forearm/paired pose took ownership of rotation only.
  layers.releasePoseOverlay(socket, 'npc-dance-hand:test:left');
  near(socket.position.y, 3.1);
  near(angleX(socket.quaternion), .51);
  const owner = layers.createAbsoluteSession('spouse-kiss');
  assert(owner.capture(socket, ['position', 'quaternion']));
  assert.equal(layers.applyPoseOverlay(socket, 'npc-dance-hand:test:left', apply), false,
    'late dance hand render must not steal a scripted spouse/paired grip');
  owner.release();
  assert.equal(layers.getDebug().activeAbsoluteClaims, 0);
}
{
  const leg = { name: 'shared-ik-thigh', position: new Position3(0, 1, 0),
    quaternion: new Quat(), parent: {} };
  layers.setAxis(leg, 'drunk-leg-sway', 'position', 'y', .2);
  layers.setQuaternion(leg, 'npc-yawn-leg', aroundX(.1));
  leg.position.y = 2; // Absolute IK solver authored its fresh neutral position.
  leg.quaternion.copy(aroundX(.3)); // A new thigh quaternion from walking, sitting, or recorded ragdoll.
  assert(layers.setSolvedBase(leg, 'position', leg.position));
  assert(layers.setSolvedBase(leg, 'quaternion', leg.quaternion));
  near(leg.position.y, 2.2);
  near(angleX(leg.quaternion), .4);
  assert(layers.restoreSolvedBase(leg, 'quaternion'));
  near(angleX(leg.quaternion), .3); // Hover interpolation begins from the clean base, not the prior additive twist.
  assert(layers.restoreSolvedBase(leg, 'quaternion'), 'preparing the same IK joint twice is harmless');
  assert(layers.restoreSolvedBase(leg, 'position'), 'a second leg preparation still sees its registered Y layer');
  assert(layers.restoreSolvedBase(leg, 'position'), 'position is also idempotent before a solver interpolates');
  assert.equal(layers.getDebug().activeLayers >= 2, true, 'repeat preparation must not discard a valid additive owner');
  leg.quaternion.copy(aroundX(.2));
  layers.setSolvedBase(leg, 'quaternion', leg.quaternion);
  near(angleX(leg.quaternion), .3);
  layers.clear(leg, 'drunk-leg-sway');
  layers.clear(leg, 'npc-yawn-leg');
  near(leg.position.y, 2);
  near(angleX(leg.quaternion), .2);
  const scripted = layers.createAbsoluteSession('recorded-absolute-impact');
  assert(scripted.capture(leg, ['quaternion']));
  leg.quaternion.copy(aroundX(.8)); // A stray regular gait update ran while a recorded pose held the leg.
  assert.equal(layers.setSolvedBase(leg, 'quaternion', leg.quaternion), false);
  near(angleX(leg.quaternion), .2);
  scripted.release();
  assert.equal(layers.getDebug().activeAbsoluteClaims, 0);
}

// Regression: a leased additive layer must never erase an absolute kiss,
// capture, or cinematic pose when it expires under the action's ownership.
{
  const node = { name: 'overlap-hip', parent: {}, position: new Position3(0, 1, 0),
    quaternion: new Quat() }; // One shared joint is deliberately affected by both pose systems.
  layers.setAxis(node, 'drunk-hip', 'position', 'y', .4, { leaseMs: 100 });
  near(node.position.y, 1.4);
  const absolute = layers.createAbsoluteSession('scripted-cinematic-pose'); // The scripted pose suspends the named offset.
  assert(absolute.capture(node, ['position']));
  node.position.y = 3;
  assert(absolute.stamp());
  const expired = layers.expireStale(Date.now() + 10000);
  assert(expired >= 1, 'suspended additive lease expires during the scripted pose');
  near(node.position.y, 3);
  assert(absolute.owns(), 'lease expiry cannot invalidate an unrelated absolute owner');
  assert.equal(layers.setAbsoluteBase(node, 'position', 'y', 99), false,
    'a competing explicit absolute baseline writer may not seize a scripted pose');
  near(node.position.y, 3);
  absolute.release();
  near(node.position.y, 1); // Expired offset stays expired: the clean pre-action baseline returns.
  assert.equal(layers.getDebug().activeAbsoluteClaims, 0);
}
{
  const node = { name: 'overlap-shoulder', parent: {}, position: new Position3(0, 1, 0),
    quaternion: new Quat() }; // The same joint receives a fresh additive value during its held action.
  layers.setQuaternion(node, 'drunk-shoulder', aroundX(.15), { leaseMs: 500 });
  near(angleX(node.quaternion), .15);
  const absolute = layers.createAbsoluteSession('paired-dance-shoulder');
  assert(absolute.capture(node, ['quaternion']));
  node.quaternion.copy(aroundX(.9));
  assert(absolute.stamp());
  assert(layers.setQuaternion(node, 'drunk-shoulder', aroundX(.3), { leaseMs: 500 }));
  near(angleX(node.quaternion), .9); // Refresh is registered but never overwrites the authored action.
  assert(absolute.owns());
  absolute.release();
  near(angleX(node.quaternion), .3); // Current additive value reappears exactly once above clean IK.
  layers.clear(node, 'drunk-shoulder');
  near(angleX(node.quaternion), 0);
  assert.equal(layers.getDebug().activeAbsoluteClaims, 0);
}
{
  const node = { name: 'overlap-new-owner', parent: {}, position: new Position3(0, 1, 0),
    quaternion: new Quat() }; // A later physics/impact author must take precedence over stale deferred offsets.
  layers.setAxis(node, 'old-sway', 'position', 'y', .4);
  const absolute = layers.createAbsoluteSession('interrupted-action');
  assert(absolute.capture(node, ['position']));
  node.position.y = 3;
  assert(absolute.stamp());
  layers.setAxis(node, 'old-sway', 'position', 'y', .8);
  node.position.y = 9; // An external, newer solver displaced the old action.
  absolute.release();
  near(node.position.y, 9);
  layers.clear(node, 'old-sway');
  near(node.position.y, 9); // Clearing an obsolete named effect must never resurrect the old IK baseline.
  assert.equal(layers.getDebug().activeAbsoluteClaims, 0);
}

// A late NPC dance overlay must neither discard a NEW additive effect nor
// preserve one that was removed while the hand was claimed.
{
  const node = { name: 'npc-overlay-handoff', parent: {}, position: new Position3(0, 1, 0),
    quaternion: new Quat() }; // Reuses the same actual hand-socket types as the renderer registration tests.
  const apply = (socket, pos, quat) => {
    socket.position.y = pos.y + .7;
    socket.quaternion.copy(quat).multiply(aroundX(.2));
  }; // Visible dance pose, not a second absolute idle baseline.
  assert(layers.applyPoseOverlay(node, 'npc-dance-hand:overlap:left', apply));
  near(node.position.y, 1.7);
  assert(layers.setAxis(node, 'late-yawn-wrist', 'position', 'y', .25));
  assert(layers.setQuaternion(node, 'late-drunk-wrist', aroundX(.1)));
  near(node.position.y, 1.7); // New optional effects are deferred beneath the held dance.
  near(angleX(node.quaternion), .2);
  assert(layers.releasePoseOverlay(node, 'npc-dance-hand:overlap:left'));
  near(node.position.y, 1.25); // Restore the clean wrist and only the newly live additive effect.
  near(angleX(node.quaternion), .1);
  layers.clear(node, 'late-yawn-wrist');
  layers.clear(node, 'late-drunk-wrist');
  near(node.position.y, 1);
  near(angleX(node.quaternion), 0);

  layers.setAxis(node, 'existing-wrist-sway', 'position', 'y', .3);
  layers.setQuaternion(node, 'existing-wrist-roll', aroundX(.15));
  assert(layers.applyPoseOverlay(node, 'npc-dance-hand:overlap:left', apply));
  near(node.position.y, 2); // The already composed sway remains the baseline of the visible dance.
  near(angleX(node.quaternion), .35);
  assert(layers.releasePoseOverlay(node, 'npc-dance-hand:overlap:left'));
  near(node.position.y, 1.3); // Existing sway returns once, not twice or zero times.
  near(angleX(node.quaternion), .15);
  layers.clear(node, 'existing-wrist-sway');
  layers.clear(node, 'existing-wrist-roll');
  near(node.position.y, 1);
  near(angleX(node.quaternion), 0);
}

// Workshop loads runtime scripts independently from the gameplay loader.
const editorScripts = fs.readFileSync('docs/tools/enemy-loadout-editor/preview.js', 'utf8');
const ledgerAt = editorScripts.indexOf("'js/rig-transform-layers.js?v=");
const composerAt = editorScripts.indexOf("'js/player-body-transform-composer.js?v=");
const drunkAt = editorScripts.indexOf("'js/drunk-locomotion.js?v=");
assert.ok(ledgerAt >= 0 && composerAt > ledgerAt && drunkAt > composerAt,
  'Workshop must share rig ownership before both the player compositor and drunken gait');
console.log('Rig transform layers: ownership, interrupts, drift, editor bootstrap and release PASS');
