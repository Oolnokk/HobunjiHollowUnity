'use strict';
// Execute the production held-item reach functions with minimal THREE-like transforms.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/procedural-hand-frame-driver.js', 'utf8');
const start = source.indexOf('  function restoreHeldItemReach(record) {');
const end = source.indexOf('  function syncRigToHeldItem(record, target) {', start);
assert(start > 0 && end > start, 'the production held-item reach owner must be present');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  clone() { return new Vector3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  distanceToSquared(v) { return (this.x-v.x)**2+(this.y-v.y)**2+(this.z-v.z)**2; }
  applyQuaternion() { return this; } // Identity rotations in these reach fixtures.
  length() { return Math.hypot(this.x, this.y, this.z); }
}
class Quaternion {
  copy() { return this; }
  multiply() { return this; }
  setFromEuler() { return this; }
}
class Euler { set() { return this; } }

let editing = false;
const { liftHeldItemIntoReach, restoreHeldItemReach } = vm.runInNewContext(
  `(function(){ ${source.slice(start, end)}; return { liftHeldItemIntoReach, restoreHeldItemReach }; })()`,
  {
    HELD_LARGE_EDGE_MARGIN: 0.02,
    gripModeTransformForRecord: () => ({ position: { x: 0, y: 0, z: 0 } }),
    hierarchyWorldQuaternion: (_record, _holder, output) => output,
    inAttackEditor: () => editing,
  },
);

function fixture({ y = -0.2, shoulderY = 0.6, reach = 0.45, mode = 'bottle', width = 0.36 } = {}) {
  const parent = { worldToLocal: v => v, localToWorld: v => v, updateWorldMatrix() {} };
  const holder = {
    parent, position: new Vector3(0, y, 0),
    localToWorld(v) { return v.add(this.position); },
    updateWorldMatrix() {},
  };
  const rig = {
    parent,
    armLengthForSide: () => reach,
    shoulderPositionLocal(side, out) { return out.set(side === 'right' ? 0.2 : -0.2, shoulderY, 0); },
  };
  const scratch = { holderQuat: new Quaternion(),
    rotations: { right: new Quaternion(), left: new Quaternion(), bottle: new Quaternion() } };
  const record = { THREE: { Vector3, Quaternion, Euler }, rig, heldItemScratch: scratch };
  const target = { holder, mode, width, height: 1, neckFraction: 0.2 };
  return { holder, record, target, scratch };
}

const close = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-8,
  `${label}: expected ${expected}, received ${actual}`);

{
  const f = fixture({ mode: 'large' });
  // Both hand grips are horizontally aligned with their individual shoulders.
  liftHeldItemIntoReach(f.record, f.target, f.scratch);
  close(f.holder.position.y, 0.15, 'two-hand holder lifted to anatomical wrist limit');
  liftHeldItemIntoReach(f.record, f.target, f.scratch);
  close(f.holder.position.y, 0.15, 'second sync does not accumulate the lift');
  restoreHeldItemReach(f.record);
  close(f.holder.position.y, -0.2, 'release restores unchanged source pose');
}
{
  const f = fixture({ y: 0.3, mode: 'large' });
  liftHeldItemIntoReach(f.record, f.target, f.scratch);
  close(f.holder.position.y, 0.3, 'ordinary valid grips remain unchanged');
}
{
  const f = fixture({ mode: 'authored-world' });
  f.target.handTargets = {
    right: { x: 0.2, y: -0.1, z: 0, rotation: {} },
    left: { x: -0.2, y: 0, z: 0, rotation: {} },
  };
  liftHeldItemIntoReach(f.record, f.target, f.scratch);
  close(f.holder.position.y, 0.25, 'lower of two authored grips controls minimum object lift');
}
{
  const f = fixture({ mode: 'large' });
  editing = true;
  liftHeldItemIntoReach(f.record, f.target, f.scratch);
  close(f.holder.position.y, -0.2, 'Attack Editor preserves its authored holder pose');
  editing = false;
}
{
  const f = fixture({ mode: 'large' });
  liftHeldItemIntoReach(f.record, f.target, f.scratch);
  f.holder.position.y = 0.25; // New gameplay placement supersedes the prior presentation offset.
  restoreHeldItemReach(f.record);
  close(f.holder.position.y, 0.25, 'external holder pose is never restored to a stale baseline');
}

// Exercise the real frame-scheduler owner, not only the isolated reach helper.
// The previous implementation forgot to undo the visual lift when a held item
// disappeared before the next hand sync or when the rig became offscreen.
{
  const updateStart = source.indexOf('  function updateManagedRigs() {');
  const updateEnd = source.indexOf('  // Discovery/attachment', updateStart);
  assert(updateStart > end && updateEnd > updateStart, 'production hand-sync owner must remain accessible');
  const f = fixture({ mode: 'large' });
  f.record.avatarRoot = { userData: { proceduralHandRig: f.record.rig } };
  let carried = f.target; // Current carried-item source used by the production hand-sync owner.
  let offscreen = false; // Simulates a hidden/disposed player rig after a carry.
  let actionOwnsHands = false; // Simulates a yawn or other named pose taking over the hand rig.
  let handOwner = null; // Captures which hand-placement path the production owner actually selected.
  f.record.rig.applyOwnedPose = () => {
    if (actionOwnsHands) close(f.holder.position.y, -0.2, 'named pose must receive the unshifted item position');
    return actionOwnsHands;
  };
  const runtime = vm.runInNewContext(
    `(function() { ${source.slice(start, end)}
      ${source.slice(updateStart, updateEnd)}
      return { updateManagedRigs }; })()`,
    {
      managed: new Set([f.record]),
      ensureSyncSentinel() {},
      disposeSyncSentinel() {},
      rigRecentlyRendered: () => !offscreen,
      updateFallbackMotion() {},
      inHandCalibrationMode: () => false,
      heldItemTarget: () => carried,
      currentToolHolder: () => ({ visible: true }),
      syncRigToHeldItem(record, target) {
        handOwner = 'held';
        liftHeldItemIntoReach(record, target, record.heldItemScratch);
      },
      syncRigToTool() { handOwner = 'tool'; },
      syncCalibrationWorkspace() {},
      applyFallbackBoth() { handOwner = 'free'; },
      publishHandSolvedBases() {},
      HELD_LARGE_EDGE_MARGIN: 0.02,
      gripModeTransformForRecord: () => ({ position: { x: 0, y: 0, z: 0 } }),
      hierarchyWorldQuaternion: (_record, _holder, output) => output,
      inAttackEditor: () => false,
    },
  );
  runtime.updateManagedRigs();
  close(f.holder.position.y, 0.15, 'frame owner applies held-item lift');
  assert.equal(handOwner, 'held');
  carried = null;
  runtime.updateManagedRigs();
  close(f.holder.position.y, -0.2, 'frame owner releases lift before gripping a tool');
  assert.equal(handOwner, 'tool');

  carried = f.target;
  runtime.updateManagedRigs();
  actionOwnsHands = true;
  runtime.updateManagedRigs();
  close(f.holder.position.y, -0.2, 'named action releases held-object lift');
  actionOwnsHands = false;

  runtime.updateManagedRigs();
  offscreen = true;
  runtime.updateManagedRigs();
  close(f.holder.position.y, -0.2, 'offscreen rigs restore their held object');
}

console.log('Held-item anatomical reach lift and restoration tests passed.');
