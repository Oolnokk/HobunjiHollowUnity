#!/usr/bin/env node
'use strict';

// Regression for the Stage 6 RAF-ownership decomposition: hand-tool-grips.js's
// combined frame() loop (idempotent install retries for the combat-capture/
// rig-blend wrappers, editor-only UI refresh, and the per-frame primary-grip
// visual correction) is split into two independent responsibilities registered
// with RuntimeFrameScheduler when it is present (the shipped game):
// installMaintenance has no render-order dependency, while
// applyPrimaryGripVisuals mutates the held tool/weapon's transform from this
// frame's runtime state and runs on the pre-render phase, alongside
// procedural-hand-frame-driver.js's poseAndSyncUpdate.
//
// This module is ALSO loaded by the standalone Attack Animation Editor and
// Animation Author tool pages, which never load RuntimeFrameScheduler; when
// it is absent, the original combined per-frame RAF loop must still run
// unchanged for that isolated editor context.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/hand-tool-grips.js', 'utf8');
assert(source.includes("global.RuntimeFrameScheduler.register('hand-tool-grips-install', installMaintenance"), 'install/UI maintenance must register with the scheduler when present');
assert(source.includes("global.RuntimeFrameScheduler.register('hand-tool-grips-visuals', applyPrimaryGripVisuals"), 'the primary-grip visual correction must register with the scheduler when present');
assert(source.includes("phase: 'pre-render'"), 'the visual correction must be on the pre-render phase');
assert(source.includes('global.requestAnimationFrame(frame)'), 'the isolated-editor-context fallback loop must still exist for when the scheduler is absent');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  copy(o) { this.x = o.x; this.y = o.y; this.z = o.z; return this; }
}
class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  clone() { return new Quaternion(this.x, this.y, this.z, this.w); }
  copy(o) { this.x = o.x; this.y = o.y; this.z = o.z; this.w = o.w; return this; }
  identity() { this.x = 0; this.y = 0; this.z = 0; this.w = 1; return this; }
  multiply(o) {
    const { x: ax, y: ay, z: az, w: aw } = this, { x: bx, y: by, z: bz, w: bw } = o;
    this.x = aw * bx + ax * bw + ay * bz - az * by;
    this.y = aw * by - ax * bz + ay * bw + az * bx;
    this.z = aw * bz + ax * by - ay * bx + az * bw;
    this.w = aw * bw - ax * bx - ay * by - az * bz;
    return this;
  }
}

function buildToolNode() {
  return {
    position: new Vector3(0, 0, 0),
    quaternion: new Quaternion(),
    scale: new Vector3(1, 1, 1),
    matrixUpdateCount: 0,
    updateMatrix() { this.matrixUpdateCount += 1; },
  };
}

function buildFixture({ withScheduler, pathname }) {
  const registered = new Map();
  const rafCalls = [];
  const combatDeps = { __weaponToolStanceVisualHooks: true, triggerWeaponSwingVisual() {}, triggerWeaponHoldVisual() {}, cancelWeaponSwingHold() {} };
  const toolNode = buildToolNode();
  const gameDeps = {
    toolHolder: { traverse() {} },
    toolMeshMap: new Map([['slot1', toolNode]]),
    equipmentSlots: { slot1: 'hatchet' },
    getActiveTool() { return 'slot1'; },
  };
  const windowObject = {
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    Combat: { deps: combatDeps },
    ProceduralHandAttachments: { attach() { return {}; }, gameDeps },
    WeaponToolStances: { getRuntimeState() { return { activeSlot: 'slot1', itemKey: 'hatchet' }; } },
    requestAnimationFrame(callback) { rafCalls.push(callback); },
  };
  if (withScheduler) {
    windowObject.RuntimeFrameScheduler = {
      register(id, fn, options) { registered.set(id, { fn, options }); },
    };
  }
  const sandbox = {
    window: windowObject,
    location: { pathname },
    localStorage: windowObject.localStorage,
    document: { getElementById() { return null; } },
    performance: { now: () => 0 },
  };
  vm.runInNewContext(source, sandbox, { filename: 'hand-tool-grips.js' });
  return { windowObject, registered, rafCalls, toolNode, combatDeps };
}

// --- Shipped game context: RuntimeFrameScheduler present -------------------
{
  const { registered, rafCalls } = buildFixture({ withScheduler: true, pathname: '/index.html' });
  assert.equal(rafCalls.length, 0, 'no raw requestAnimationFrame is used when the scheduler is present');
  const install = registered.get('hand-tool-grips-install');
  const visuals = registered.get('hand-tool-grips-visuals');
  assert(install, 'install/UI maintenance registers under a stable id');
  assert(visuals, 'primary-grip visual correction registers under a stable id');
  assert.equal(visuals.options.phase, 'pre-render');
  assert.notEqual(install.options.phase, 'pre-render', 'install/UI maintenance has no render-order dependency, so it must not share the pre-render phase');
  assert.equal(install.options.owner, 'HobunjiHandToolGrips');
  assert.equal(visuals.options.owner, 'HobunjiHandToolGrips');
}

// --- Behavioral equivalence: driving both scheduler callbacks must install
// the combat-capture wrapper and apply a real transform correction to the
// held tool visual, exactly like the old combined frame() loop did in one tick.
{
  const { registered, toolNode, combatDeps } = buildFixture({ withScheduler: true, pathname: '/index.html' });
  assert.equal(combatDeps.__hobunjiSecondarySpanCapture, undefined, 'combat capture is not installed until installMaintenance runs');
  registered.get('hand-tool-grips-install').fn();
  assert.equal(combatDeps.__hobunjiSecondarySpanCapture, true, 'installMaintenance installs the combat-capture wrapper');
  assert.equal(toolNode.matrixUpdateCount, 0, 'the tool visual is not touched until applyPrimaryGripVisuals runs');
  registered.get('hand-tool-grips-visuals').fn();
  assert.equal(toolNode.matrixUpdateCount, 1, 'applyPrimaryGripVisuals applies the runtime primary-grip correction and updates the matrix');
  // Re-running installMaintenance must stay a safe idempotent no-op.
  assert.doesNotThrow(() => registered.get('hand-tool-grips-install').fn());
}

// --- Isolated editor context: RuntimeFrameScheduler absent ----------------
{
  const { rafCalls, toolNode, combatDeps } = buildFixture({ withScheduler: false, pathname: '/tools/attack-animation-editor/index.html' });
  assert.equal(rafCalls.length, 1, 'the isolated editor context still owns exactly one private RAF chain, unchanged');
  assert.equal(combatDeps.__hobunjiSecondarySpanCapture, undefined, 'the fallback loop has not ticked yet at load time');
  const frameFn = rafCalls.shift();
  assert.doesNotThrow(() => frameFn(), 'the combined fallback loop still runs install maintenance and the visual correction in one tick');
  assert.equal(combatDeps.__hobunjiSecondarySpanCapture, true, 'the fallback loop still installs the combat-capture wrapper');
  // In the attack-animation-editor pathname, applyPrimaryGripVisuals takes the
  // editor branch, which no-ops without a HobunjiAttackEditorToolContext -
  // it must not touch the runtime toolHolder's visual.
  assert.equal(toolNode.matrixUpdateCount, 0, 'the editor branch does not mutate the runtime tool visual');
  assert.equal(rafCalls.length, 1, 'the fallback loop reschedules itself exactly like the original frame()');
}

console.log('hand tool grips install/visual scheduler split passed');
