#!/usr/bin/env node
'use strict';

// Regression for the Stage 6 RAF-ownership decomposition: procedural-hand-frame-driver.js's
// combined frame() loop (pending-avatar attachment + fallback gait/tool-sync
// update) is split into two independent responsibilities registered with
// RuntimeFrameScheduler when it is present (the shipped game): attachment
// has no ordering dependency, while the gait/sync update needs fresh
// simulation state and runs on the pre-render phase. The final exact
// tool/hand matrix stays entirely in the existing onBeforeRender sentinel,
// untouched by this migration (see
// docs/architecture/runtime-frame-scheduler.md's Stage 7 notes).
//
// This module is ALSO loaded by the standalone Attack Animation Editor and
// Animation Author tool pages, which never load RuntimeFrameScheduler; when
// it is absent, the original combined per-frame RAF loop must still run
// unchanged for that isolated editor context.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/procedural-hand-frame-driver.js', 'utf8');
assert(source.includes("global.RuntimeFrameScheduler.register('procedural-hand-attachment', attachmentSweep"), 'attachment/discovery must register with the scheduler when present');
assert(source.includes("global.RuntimeFrameScheduler.register('procedural-hand-pose-sync', poseAndSyncUpdate"), 'the fallback gait/tool-sync update must register with the scheduler when present');
assert(source.includes("phase: 'pre-render'"), 'the gait/tool-sync update must be on the pre-render phase');
assert(source.includes('global.requestAnimationFrame(frame)'), 'the isolated-editor-context fallback loop must still exist for when the scheduler is absent');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(other) { return this.set(other.x, other.y, other.z); }
}
class BufferGeometry { setAttribute() {} dispose() {} }
class Float32BufferAttribute {}
class MeshBasicMaterial { constructor() { this.colorWrite = true; } dispose() {} }
class Mesh { constructor(geometry, material) { this.geometry = geometry; this.material = material; this.parent = null; } }

function buildFixture({ withScheduler }) {
  const registered = new Map();
  const rafCalls = [];
  const parent = {
    position: new Vector3(),
    getWorldPosition(target) { return target.copy(this.position); },
    add(child) { child.parent = this; },
    remove(child) { if (child.parent === this) child.parent = null; },
  };
  const rig = {
    parent,
    group: { getObjectByName() { return null; } },
    setSideIdle() {},
    useIdlePose() {},
    getDebug() { return {}; },
    dispose() {},
  };
  const hands = { attach() { return rig; }, installGameRuntime() {}, gameDeps: null };
  const avatarApi = {
    buildSinglePlaneAvatarModel() {
      return { parent, name: 'fixture_avatar', userData: { portraitModelHeight: 1, handAttachX: -0.2, handAttachY: 0.5 } };
    },
    disposeAvatarModel() {},
  };
  const windowObject = {
    THREE: { Vector3, BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, Mesh },
    ProceduralHandAttachments: hands,
    HobunjiHandModelProfiles: { modelKeyForSpecies() { return 'feline'; }, effectiveScaleFor() { return 1; }, data: { handHeightFraction: 0.12 } },
    HobunjiHandToolGrips: { toolKeyFor: v => v, primaryGripForTool() { return null; }, secondaryGripForTool() { return null; }, subscribe() {} },
    PNGPlaneAvatar: avatarApi,
    requestAnimationFrame(callback) { rafCalls.push(callback); },
  };
  if (withScheduler) {
    windowObject.RuntimeFrameScheduler = {
      register(id, fn, options) { registered.set(id, { fn, options }); },
    };
  }
  const sandbox = { window: windowObject, location: { pathname: withScheduler ? '/index.html' : '/tools/attack-animation-editor/index.html' }, performance: { now: () => 0 }, document: { getElementById() { return null; } } };
  vm.runInNewContext(source, sandbox, { filename: 'procedural-hand-frame-driver.js' });
  return { windowObject, avatarApi, registered, rafCalls, parent };
}

// --- Shipped game context: RuntimeFrameScheduler present -------------------
{
  const { registered, rafCalls } = buildFixture({ withScheduler: true });
  assert.equal(rafCalls.length, 0, 'no raw requestAnimationFrame is used when the scheduler is present');
  const attachment = registered.get('procedural-hand-attachment');
  const poseSync = registered.get('procedural-hand-pose-sync');
  assert(attachment, 'attachment/discovery registers under a stable id');
  assert(poseSync, 'pose/tool-sync update registers under a stable id');
  assert.equal(poseSync.options.phase, 'pre-render');
  assert.notEqual(attachment.options.phase, 'pre-render', 'attachment/discovery has no ordering dependency, so it must not share the pre-render phase');
  assert.equal(attachment.options.owner, 'ProceduralHandFrameDriver');
  assert.equal(poseSync.options.owner, 'ProceduralHandFrameDriver');
}

// --- Behavioral equivalence: driving both scheduler callbacks in sequence
// must attach a pending avatar and update its fallback pose, exactly like
// the old combined frame() loop did in one tick.
{
  const { windowObject, avatarApi, registered } = buildFixture({ withScheduler: true });
  avatarApi.buildSinglePlaneAvatarModel(windowObject.THREE, {}, { speciesId: 'mao-ao', gender: 'male', profile: {} });
  assert.equal(windowObject.ProceduralHandFrameDriver.getDebug().length, 0, 'the rig is still pending before attachmentSweep runs');
  registered.get('procedural-hand-attachment').fn();
  assert.equal(windowObject.ProceduralHandFrameDriver.getDebug().length, 1, 'attachmentSweep attaches the pending rig');
  assert.equal(windowObject.ProceduralHandFrameDriver.getDebug()[0].fallback, null, 'fallback state is not computed until poseAndSyncUpdate runs');
  registered.get('procedural-hand-pose-sync').fn();
  assert.equal(windowObject.ProceduralHandFrameDriver.getDebug()[0].fallback.mode, 'idle', 'poseAndSyncUpdate computes the fallback gait state');
}

// --- Isolated editor context: RuntimeFrameScheduler absent ----------------
{
  const { avatarApi, windowObject, rafCalls } = buildFixture({ withScheduler: false });
  avatarApi.buildSinglePlaneAvatarModel(windowObject.THREE, {}, { speciesId: 'mao-ao', gender: 'male', profile: {} });
  assert.equal(rafCalls.length, 1, 'the isolated editor context still owns exactly one private RAF chain, unchanged');
  const frameFn = rafCalls.shift();
  assert.doesNotThrow(() => frameFn(), 'the combined fallback loop still runs both attachment and pose/sync work in one tick');
  assert.equal(windowObject.ProceduralHandFrameDriver.getDebug().length, 1, 'the fallback loop still attaches the pending rig');
  assert.equal(windowObject.ProceduralHandFrameDriver.getDebug()[0].fallback.mode, 'idle', 'the fallback loop still computes gait state in the same tick');
  assert.equal(rafCalls.length, 1, 'the fallback loop reschedules itself exactly like the original frame()');
}

console.log('procedural hand frame driver attachment/pose-sync split passed');
