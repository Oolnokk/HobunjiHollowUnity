#!/usr/bin/env node
'use strict';
// Regression for the shipped world-up torch hold: mirrored character rigs,
// locomotion, and genuinely authored tool actions must remain independent.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = path => fs.readFileSync(path, 'utf8'); // Loads the real runtime modules from repository root.

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  copy(v) { return this.set(v.x, v.y, v.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  multiply(v) { this.x *= v.x; this.y *= v.y; this.z *= v.z; return this; }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() { const n = Math.sqrt(this.lengthSq()); return this.set(this.x / n, this.y / n, this.z / n); }
  applyQuaternion(q) {
    const { x, y, z } = this;
    const ix = q.w * x + q.y * z - q.z * y;
    const iy = q.w * y + q.z * x - q.x * z;
    const iz = q.w * z + q.x * y - q.y * x;
    const iw = -q.x * x - q.y * y - q.z * z;
    return this.set(
      ix * q.w - iw * q.x - iy * q.z + iz * q.y,
      iy * q.w - iw * q.y - iz * q.x + ix * q.z,
      iz * q.w - iw * q.z - ix * q.y + iy * q.x,
    );
  }
}
class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { Object.assign(this, { x, y, z, w }); }
  clone() { return new Quaternion(this.x, this.y, this.z, this.w); }
  dot(q) { return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w; }
  copy(q) { Object.assign(this, { x: q.x, y: q.y, z: q.z, w: q.w }); return this; }
  identity() { return this.copy(new Quaternion()); }
  invert() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
  normalize() { const n = Math.hypot(this.x, this.y, this.z, this.w); this.x /= n; this.y /= n; this.z /= n; this.w /= n; return this; }
  multiply(q) {
    const a = this.clone();
    this.x = a.x * q.w + a.w * q.x + a.y * q.z - a.z * q.y;
    this.y = a.y * q.w + a.w * q.y + a.z * q.x - a.x * q.z;
    this.z = a.z * q.w + a.w * q.z + a.x * q.y - a.y * q.x;
    this.w = a.w * q.w - a.x * q.x - a.y * q.y - a.z * q.z;
    return this;
  }
  premultiply(q) { return this.copy(q.clone().multiply(this)); }
  setFromAxisAngle(axis, radians) {
    const s = Math.sin(radians / 2);
    return this.copy(new Quaternion(axis.x * s, axis.y * s, axis.z * s, Math.cos(radians / 2)));
  }
  setFromUnitVectors(a, b) {
    let w = a.x * b.x + a.y * b.y + a.z * b.z + 1;
    if (w < 1e-6) {
      w = 0;
      if (Math.abs(a.x) > Math.abs(a.z)) return this.copy(new Quaternion(-a.y, a.x, 0, w)).normalize();
      return this.copy(new Quaternion(0, -a.z, a.y, w)).normalize();
    }
    return this.copy(new Quaternion(
      a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x, w,
    )).normalize();
  }
}
const THREE = { Vector3, Quaternion }; // Minimal exact quaternion/vector operations used by the two real modules.
const axis = (x, y, z) => new Vector3(x, y, z);
function node(parent = null, scale = [1, 1, 1], rotation = null) {
  return {
    parent, scale: new Vector3(...scale), quaternion: rotation || new Quaternion(),
    position: new Vector3(), userData: {}, matrixWorld: { clone() { return this; } },
    updateMatrix() {}, updateMatrixWorld() {},
  };
}
function upDirection(plane) {
  const up = axis(0, 1, 0);
  for (let cursor = plane; cursor; cursor = cursor.parent) up.multiply(cursor.scale).applyQuaternion(cursor.quaternion);
  return up.normalize();
}
let time = 0; // Deterministic render clock for movement/idle suppression checks.
const root = node(null, [-1, 1.3, 1], new Quaternion().setFromAxisAngle(axis(0, 0, 1), .3));
const body = node(root, [-1, 1, 1]);
const holder = node(body, [1, 1, 1], new Quaternion().setFromAxisAngle(axis(1, 0, 0), .6));
const visual = node(holder, [1, -1, 1], new Quaternion().setFromAxisAngle(axis(0, 0, 1), .8));
const plane = node(visual);
let planeAngle = 0;
plane.rotation = {
  get z() { return planeAngle; },
  set z(value) { planeAngle = value; plane.quaternion.setFromAxisAngle(axis(0, 0, 1), value); },
}; // Three.js' Euler Z and quaternion are synchronized; sweep compensation must be included.

const window = {
  __farmLog() {}, Combat: { deps: {} },
  PlayerBodyTransformComposer: { getPlayerMesh: () => body },
};
const context = vm.createContext({
  window, THREE, localStorage: { getItem: () => null },
  fetch: async () => { throw new Error('offline fixture'); },
  setTimeout: () => 1, clearTimeout() {}, performance: { now: () => time },
});
const load = path => vm.runInContext(read(path), context, { filename: path }); // Each call evaluates the actual shipped module.
load('docs/js/tool-world-upright.js');
const upright = window.ToolWorldUpright;
assert.equal(upright.apply(holder, plane, THREE, -1), true);
assert(upDirection(plane).y < -.99999, 'signed-scale hierarchy keeps the downward-authored torch flame pointing up');
assert.equal(upright.apply(holder, plane, THREE), true);
assert(upDirection(plane).y > .99999, 'other world-upright artwork retains its default +Y tip');
assert.equal(upright.apply(holder, plane, THREE, -1), true); // Return to the torch's authored -Y business end before testing locomotion.
assert.equal(upright.apply(holder, node(root), THREE), false, 'unrelated visual cannot rotate the held tool');
const zeroScale = node(holder, [1, 0, 1]);
assert.equal(upright.apply(holder, zeroScale, THREE), false, 'singular transform is safely rejected');

load('docs/js/combat/shared-attack-pose.js');
load('docs/js/weapon-tool-stances.js');
const active = { slot: 'adventuring' }; // Simulated current equipped slot, switched below to an ordinary tool.
const definitions = {
  torch: { animStyle: 'sweep' },
  hatchet: { animStyle: 'sweep', shapeKey: 'hatchet' },
};
const mesh = { userData: { toolPlane: plane } }; // The shared cached tool mesh used by the holder hook.
const deps = {
  toolHolder: holder, TOOL_ITEM_DEFS: definitions,
  equipmentSlots: { adventuring: 'torch', axe: 'hatchet' },
  toolMeshMap: { adventuring: mesh, axe: mesh },
  getActiveTool: () => active.slot, getHeldMode: () => 'tool',
};
let renderedUp = null; // Captures the pose *inside* the temporary matrix hook, before it restores idle-basis transforms.
holder.updateMatrixWorld = function () { renderedUp = upDirection(plane); };
window.WeaponToolStances.init(deps);
holder.updateMatrixWorld();
let snapshot = window.WeaponToolStances.debugSnapshot();
assert.equal(snapshot.stanceApplied, true, 'torch starts in its dedicated idle stance');
assert.equal(snapshot.worldUprightApplied, true, 'torched PNG receives the world-up correction');
assert(renderedUp.y < -.99999, 'rendered torch flame points up, even through mirrored scales');
for (let i = 0; i < 4; i++) {
  time += 16;
  holder.quaternion.setFromAxisAngle(axis(0, 0, 1), .3 + i * .22); // Walking/turning changes the ordinary holder orientation.
  holder.updateMatrixWorld();
  snapshot = window.WeaponToolStances.debugSnapshot();
  assert.equal(snapshot.stanceApplied, true, 'walking must not activate the ordinary tool fallback');
  assert(renderedUp.y < -.99999, 'torch flame remains upright throughout locomotion');
}
holder.userData.authoredToolActionActive = true;
holder.updateMatrixWorld();
assert.equal(window.WeaponToolStances.debugSnapshot().stanceApplied, false, 'real authored torch actions own their pose');
holder.userData.authoredToolActionActive = false;
holder.updateMatrixWorld();
assert.equal(window.WeaponToolStances.debugSnapshot().stanceApplied, true, 'torch returns to upright idle after its action');

active.slot = 'axe';
holder.updateMatrixWorld(); // First tool-frame records a new relative quaternion.
time += 16;
holder.quaternion.setFromAxisAngle(axis(0, 0, 1), 1.8);
holder.updateMatrixWorld();
assert.equal(window.WeaponToolStances.debugSnapshot().stanceApplied, false, 'other tools retain active-motion suppression');
active.slot = 'adventuring';
holder.updateMatrixWorld();
assert.equal(window.WeaponToolStances.debugSnapshot().stanceApplied, true, 'torch never inherits a previous tool motion cooldown');

assert.match(read('docs/js/weapon-tool-stances.js'), /torchIdle \? -1 : 1/, 'runtime selects the torch-specific authored tip');
assert.match(read('docs/tools/attack-animation-editor/index.html'), /currentToolKey === 'torch' \? -1 : 1/, 'editor preview selects the same authored tip');
console.log('ok torch -Y flame upright idle: signed scales, generic sprites, real actions, walking, tool switching');
