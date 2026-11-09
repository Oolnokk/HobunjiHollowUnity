#!/usr/bin/env node
'use strict';
// The procedural walk preview renders a real PNGPlaneAvatar neck skin. Its
// head must counter-rotate authored body lean, turn toward movement, and
// restore the original neck pose at idle/authoring/death boundaries.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const editor = fs.readFileSync(path.join(root, 'docs/tools/procedural-animation-editor/index.html'), 'utf8');
const helperSource = fs.readFileSync(path.join(root, 'docs/js/npc-movement-head-target.js'), 'utf8');
assert(editor.includes("'js/npc-movement-head-target.js'"), 'preview loads the same helper as NPC movement and hostile head counter-pitch');
assert(editor.includes('neckRig: true'), 'preview requests actual skinned NPC neck bones');
assert(editor.includes('bindPreviewNpcMovementHead(model)'), 'preview captures the original neck and reference eye height after rebuilding');
assert(editor.includes('updatePreviewNpcMovementGaze(movingSpeed); // Last body-layer owner'), 'neck aim is solved after every walking, sway, and baked body layer');
assert(editor.includes('clearPreviewNpcMovementGaze(); // Preserve a neutral head'), 'preset switch and reset restore authored neutral head');
assert(editor.includes("head gaze ${previewNpcMovementGaze.status}"), 'on-device readout exposes gaze state and pitch');
const codeStart = editor.indexOf('const previewNpcMovementGaze = {');
const codeEnd = editor.indexOf('function bindProceduralModel(', codeStart);
assert(codeStart >= 0 && codeEnd > codeStart, 'editor has self-contained NPC movement-gaze helper');
const gazeSource = editor.slice(codeStart, codeEnd);
new vm.Script(gazeSource); // The extracted implementation is syntactically valid.

class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { Object.assign(this, { x, y, z, w }); }
  clone() { return new Quaternion(this.x, this.y, this.z, this.w); }
  copy(q) { Object.assign(this, { x: q.x, y: q.y, z: q.z, w: q.w }); return this; }
  invert() {
    const n = this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
    this.x = -this.x / n; this.y = -this.y / n; this.z = -this.z / n; this.w /= n;
    return this;
  }
  multiply(b) {
    const a = this.clone();
    this.x = a.x * b.w + a.w * b.x + a.y * b.z - a.z * b.y;
    this.y = a.y * b.w + a.w * b.y + a.z * b.x - a.x * b.z;
    this.z = a.z * b.w + a.w * b.z + a.x * b.y - a.y * b.x;
    this.w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
    return this;
  }
  setFromEuler(e) {
    const [a, b, c] = [e.x / 2, e.y / 2, e.z / 2];
    const [sx, sy, sz] = [Math.sin(a), Math.sin(b), Math.sin(c)];
    const [cx, cy, cz] = [Math.cos(a), Math.cos(b), Math.cos(c)];
    return this.copy({ x: sx * cy * cz + cx * sy * sz, y: cx * sy * cz - sx * cy * sz,
      z: cx * cy * sz - sx * sy * cz, w: cx * cy * cz + sx * sy * sz });
  }
}
class Euler {
  constructor(x = 0, y = 0, z = 0, order = 'YXZ') { this.set(x, y, z, order); }
  set(x, y, z, order = this.order) { Object.assign(this, { x, y, z, order }); return this; }
  setFromQuaternion(q, order = 'YXZ') {
    assert.equal(order, 'YXZ', 'editor uses heading-first Euler rotation');
    const { x, y, z, w } = q;
    const m23 = 2 * (y * z - x * w), m13 = 2 * (x * z + y * w), m33 = 1 - 2 * (x * x + y * y);
    const m21 = 2 * (x * y + z * w), m22 = 1 - 2 * (x * x + z * z);
    const m31 = 2 * (x * z - y * w), m11 = 1 - 2 * (y * y + z * z);
    this.x = Math.asin(Math.max(-1, Math.min(1, -m23)));
    if (Math.abs(m23) < 0.9999999) {
      this.y = Math.atan2(m13, m33); this.z = Math.atan2(m21, m22);
    } else { this.y = Math.atan2(-m31, m11); this.z = 0; }
    return this;
  }
}
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
}
const helperWindow = {};
vm.runInNewContext(helperSource, { window: helperWindow });
const parentWorld = new Quaternion().setFromEuler(new Euler(0.3, 0.25, 0.18));
const neck = {
  quaternion: new Quaternion(),
  parent: { getWorldQuaternion(out) { return out.copy(parentWorld); } },
  getWorldPosition(out) { return out.set(0, 1.2, 0); },
};
const model = { userData: { neckRig: { neckJoint: neck } } };
const state = { previewMode: 'npc', three: { model, THREE: { Quaternion, Euler, Vector3 } } };
const procedural = { pose: { editing: false }, velocity: { x: 0, z: 2 }, position: { x: 0, z: 0 },
  baseModelY: 0, locomotionRoot: { position: { y: 0 } } };
const sandbox = { state, procedural, window: helperWindow,
  clampNumber: (value, lo, hi) => Math.min(hi, Math.max(lo, value)) };
vm.createContext(sandbox);
vm.runInContext(gazeSource + '\nthis.gazeApi = { bindPreviewNpcMovementHead, updatePreviewNpcMovementGaze, clearPreviewNpcMovementGaze, previewNpcMovementGaze };', sandbox);
const api = sandbox.gazeApi;
const close = (a, b, tolerance = 1e-8) => assert(Math.abs(a - b) < tolerance, `expected ${a} to equal ${b} ± ${tolerance}`);
const quatClose = (a, b) => {
  const dot = Math.abs(a.x*b.x + a.y*b.y + a.z*b.z + a.w*b.w);
  close(dot, 1, 1e-7); // Quaternions ±Q represent the same physical orientation.
};
api.bindPreviewNpcMovementHead(model);
assert.equal(api.previewNpcMovementGaze.eyeHeight, 1.2, 'target eye height uses real scaled neck pivot, not a generic species constant');
assert.equal(api.updatePreviewNpcMovementGaze(2), true, 'walk triggers the game NPC look-ahead helper');
assert.equal(api.previewNpcMovementGaze.status, 'tracking-travel');
assert.equal(api.previewNpcMovementGaze.lookTarget.z, 3, 'look-ahead is 3 world tiles in travel direction');
quatClose(parentWorld.clone().multiply(neck.quaternion), new Quaternion(), 'the neck cancels world torso pitch, yaw and sway to keep level gaze');
assert(Math.abs(api.previewNpcMovementGaze.pitchDeg) > 5, 'head counter-pitch is actually applied to neck skin');

parentWorld.copy(new Quaternion().setFromEuler(new Euler(0.24, Math.PI / 2, -0.08)));
procedural.velocity.x = 2; procedural.velocity.z = 0;
assert.equal(api.updatePreviewNpcMovementGaze(2), true, 'turning updates movement gaze');
quatClose(parentWorld.clone().multiply(neck.quaternion),
  new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0)), 'eyes turn with world movement while staying upright');
assert.equal(api.previewNpcMovementGaze.lookTarget.x, 3);

procedural.velocity.x = 0;
assert.equal(api.updatePreviewNpcMovementGaze(0), false, 'idle cancels movement-only target');
quatClose(neck.quaternion, new Quaternion(), 'idle restores original neck quaternion');
assert.equal(api.previewNpcMovementGaze.lookTarget, null, 'idle removes stale carrot');

procedural.velocity.z = 2;
api.updatePreviewNpcMovementGaze(2);
procedural.pose.editing = true;
assert.equal(api.updatePreviewNpcMovementGaze(2), false, 'authored directional pose owns neck above movement gaze');
quatClose(neck.quaternion, new Quaternion(), 'pose editing restores authored head rotation');
assert.equal(api.previewNpcMovementGaze.status, 'authored-pose');
procedural.pose.editing = false;

api.bindPreviewNpcMovementHead(null);
assert.equal(api.updatePreviewNpcMovementGaze(2), false, 'missing rig never throws or animates a fake head');
assert.equal(api.previewNpcMovementGaze.status, 'no-neck-rig');
console.log('Procedural walk editor NPC head gaze: shared look-ahead, world-facing neck counter-rotation, yaw/pitch limits, idle reset and ownership: passed');
