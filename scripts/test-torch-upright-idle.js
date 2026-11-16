#!/usr/bin/env node
'use strict';
// Regression for the shipped world-up torch hold: mirrored character rigs,
// locomotion, and genuinely authored tool actions must remain independent.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = path => fs.readFileSync(path, 'utf8'); // Loads the real runtime modules from repository root.
const committedTorch = JSON.parse(read('docs/config/combat/weapon-idle-stances.json')).stances.torchHold; // Shared runtime/editor idle Y.
assert.equal(committedTorch.y, 0.1472916715500817, 'torch idle uses the newly authored neutral height');
assert.equal(committedTorch.x, -0.15);
assert.equal(committedTorch.z, 0.198510001727785);
assert.equal(committedTorch.pitch, -90);
assert.equal(committedTorch.scale, 0.68);
assert.equal(committedTorch.elbows.right.y, -0.06015679313571905);
const gripSource = read('docs/js/hand-tool-grips.js'); // Torch and Harlyao longsword share one deliberately authored grip entry.
assert(gripSource.includes("if (key === 'torch' || key === 'harlyaolongsword'"), 'torch resolves to Harlyao grip');
const gripStart = gripSource.indexOf('harlyaolongsword: {');
const gripEnd = gripSource.indexOf('\n    },\n  };', gripStart);
assert(gripStart >= 0 && gripEnd > gripStart, 'Harlyao grip has a committed default object');
const gripLiteral = gripSource.slice(gripStart + 'harlyaolongsword: '.length, gripEnd).trim().replace(/,$/, '');
const sharedGrip = vm.runInNewContext('(' + gripLiteral + ')');
assert.deepEqual(JSON.parse(JSON.stringify(sharedGrip.primaryGrip.position)), { x: -0.08, y: 0, z: -0.05 });
assert.deepEqual(JSON.parse(JSON.stringify(sharedGrip.primaryGrip.rotationDeg)), { pitch: 0, yaw: -90, roll: 0 });
assert.equal(sharedGrip.toolScale, 1);
assert.equal(sharedGrip.heightMultiplier, 0.5);
const sharedSource = read('docs/js/held-action-animations.js'); // Exported still-action lives in the shared held-action registry.
const start = sharedSource.indexOf('const torchIdle = ');
const end = sharedSource.indexOf(';\n\n  const drink', start);
assert(start >= 0 && end > start, 'shared authored torch action is present');
const sharedTorch = vm.runInNewContext('(' + sharedSource.slice(start + 'const torchIdle = '.length, end) + ')');
assert.equal(sharedTorch.actionId, 'torch_idle');
assert.equal(sharedTorch.poses.neutral.y, 0.1472916715500817);
assert.equal(sharedTorch.poses.neutral.scale, 0.68);
assert.equal(sharedTorch.poses.neutral.elbows.right.x, 0.002670316618150828);
assert.equal(sharedTorch.poses.windup.x, 0.13);
assert.equal(sharedTorch.poses.windup.y, 0);
assert.equal(sharedTorch.poses.strike.pitch, 10.31);
assert.equal(sharedTorch.gripMode, 'palm-parallel');
assert.equal(sharedTorch.worldUpright, true);
assert.deepEqual(JSON.parse(JSON.stringify(committedTorch)), JSON.parse(JSON.stringify({...sharedTorch.poses.neutral, worldUpright: true})), 'runtime neutral is identical to the uploaded action');
assert.equal(sharedTorch.poses.neutral.elbows.left.y, -0.10531282069027048);
for (const phase of ['neutral', 'windup', 'strike']) assert.equal(sharedTorch.poses[phase].offhandIdle?.enabled, false, phase + ': invisible authored offhand is disabled');
assert.match(read('docs/js/attack-idle-stance-editor.js'), /id="torchIdleYDirect"/, 'attack editor exposes direct torch height slider');
assert.match(read('docs/js/attack-idle-stance-editor.js'), /workingConfig.stances.torchHold.y = value/, 'slider writes the existing exported stance');
assert.match(read('docs/js/weapon-tool-stances.js'), /PREVIOUS_TORCH_HOLD_STANCES/, 'untouched legacy browser overrides migrate to the authored neutral');
const torchEditor = read('docs/tools/attack-animation-editor/index.html'); // Authoring action list must expose the torch itself, not just preview its PNG.
assert.match(torchEditor, /id: 'torch_idle', group: 'Non-attack held actions'[^\n]*heldAnimationKey: 'torchIdle'/, 'torch idle is a selectable shared held action');
assert.match(torchEditor, /id: 'torch_swing', group: 'Melee attacks'[^\n]*templateId: 'torch_swing'/, 'torch swing is a selectable action');
assert.doesNotMatch(torchEditor, /\['torch_idle', 'torchHold'\]/, 'loading flat still stances cannot overwrite authored torch windup/strike');
assert.match(torchEditor, /anim\.poses\.neutral = \{ \.\.\.anim\.poses\.neutral, \.\.\.pose \}/, 'quick height updates only torch neutral');
assert.match(torchEditor, /previewTorchIdlePose\(pose\)/, 'editor provides one dedicated still-pose preview bridge');
assert.match(read('docs/js/attack-idle-stance-editor.js'), /actionSelect\.value = 'torch_idle'/, 'direct idle editor shortcut selects the actual Torch Idle action');


class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  copy(v) { return this.set(v.x, v.y, v.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  multiply(v) { this.x *= v.x; this.y *= v.y; this.z *= v.z; return this; }
  multiplyScalar(k) { this.x *= k; this.y *= k; this.z *= k; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
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
  HobunjiHandToolGrips: { primaryGripHolderPointForTool: () => ({ x: 0.025, y: 0, z: 0.03 }) }, // Tests the real scale-around-grip path.
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
let orbitMultiplier = 1.5; // Simulates a species-dependent shoulder sphere radius passed through the shared game orbit helper.
let orbitCalls = 0; // Counts actual orbit transforms during idle and active torch animation.
let orbitInput = null; // The completed authored idle point before applying the spherical orbit.
let orbitOutput = null; // The completed orbit point expected at the holder's render-matrix bake.
const deps = {
  toolHolder: holder, TOOL_ITEM_DEFS: definitions,
  equipmentSlots: { adventuring: 'torch', axe: 'hatchet' },
  toolMeshMap: { adventuring: mesh, axe: mesh },
  getActiveTool: () => active.slot, getHeldMode: () => 'tool',
  scaleToolWorldPointAroundPlayerCentroid(point, yawRad) {
    orbitCalls++;
    assert(Number.isFinite(yawRad), 'idle orbit receives its finite authored pose yaw');
    orbitInput = point.clone();
    point.x = 2 + (point.x - 2) * orbitMultiplier;
    point.y = 3 + (point.y - 3) * orbitMultiplier;
    point.z = 4 + (point.z - 4) * orbitMultiplier;
    orbitOutput = point.clone();
  }, // The same game.js dependency used for weapon idle and all pose-driven attacks.
};
let renderedUp = null; // Captures the pose *inside* the temporary matrix hook, before it restores idle-basis transforms.
let renderedScale = null; // The committed torch rest-size should be temporary and must not accumulate.
let renderedPosition = null; // Captures the actual temporarily transformed holder origin during its render bake.
holder.updateMatrixWorld = function () { renderedUp = upDirection(plane); renderedScale = holder.scale.x; renderedPosition = holder.position.clone(); };
window.WeaponToolStances.init(deps);
holder.updateMatrixWorld();
let snapshot = window.WeaponToolStances.debugSnapshot();
assert.equal(snapshot.stanceApplied, true, 'torch starts in its dedicated idle stance');
assert.equal(snapshot.worldUprightApplied, true, 'torched PNG receives the world-up correction');
assert.equal(renderedScale, 0.68, 'torch renders at the exported neutral size');
assert.equal(holder.scale.x, 1, 'holder scale is restored after the pose bake');
assert.equal(orbitCalls, 1, 'idle torch receives the shared shoulder-derived orbit once per render bake');
assert.deepEqual([renderedPosition.x, renderedPosition.y, renderedPosition.z], [orbitOutput.x, orbitOutput.y, orbitOutput.z], 'the shared orbit result is the position actually rendered');
assert.deepEqual([holder.position.x, holder.position.y, holder.position.z], [0, 0, 0], 'temporary orbit and authored offset do not accumulate on the idle holder');
const unscaledIdlePoint = [orbitInput.x, orbitInput.y, orbitInput.z]; // Used to prove a later shoulder-radius change affects render distance, not authored stance coordinates.
orbitMultiplier = 0.5;
holder.updateMatrixWorld();
assert.deepEqual([orbitInput.x, orbitInput.y, orbitInput.z], unscaledIdlePoint, 'idle is recomputed from an unscaled source each frame');
assert.deepEqual([renderedPosition.x, renderedPosition.y, renderedPosition.z], [orbitOutput.x, orbitOutput.y, orbitOutput.z], 'a different orbit multiplier changes the rendered idle position');
assert.equal(orbitCalls, 2, 'second idle render gets exactly one new orbit transform');
assert.deepEqual([holder.position.x, holder.position.y, holder.position.z], [0, 0, 0], 'second render restores the same raw holder origin');
assert.equal(snapshot.poses.torchHold.y, 0.1472916715500817, 'diagnostics expose authored neutral height');
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
const orbitCountBeforeAction = orbitCalls; // Confirms the idle-only orbit does not double-scale swing and throw frames.
holder.updateMatrixWorld();
assert.equal(orbitCalls, orbitCountBeforeAction, 'active torch actions already own their orbit and must not get an idle transform');
assert.equal(window.WeaponToolStances.debugSnapshot().stanceApplied, false, 'real authored torch actions own their pose');
holder.userData.authoredToolActionActive = false;
holder.updateMatrixWorld();
assert.equal(window.WeaponToolStances.debugSnapshot().stanceApplied, true, 'torch returns to upright idle after its action');
load('docs/js/hand-shoulder-pose-runtime.js');
const avatarRoot = { parent: body }; // Live player rig; NPC rigs must not inherit this elbow.
const hands = window.HobunjiHandShoulderPoseRuntime;
assert.equal(hands.currentWeights('right', avatarRoot).grip, 1);
assert.equal(hands.currentWeights('right', avatarRoot).palmNormal, 1);
assert.equal(hands.currentElbow('right', avatarRoot).y, -0.06015679313571905, 'idle carries the exported right-elbow position');
assert.equal(hands.currentElbow('left', avatarRoot)?.y, -0.10531282069027048, 'idle carries the exported left-elbow position');
assert.equal(hands.currentElbow('right', { parent: root }), null, 'unrelated NPC rigs do not inherit player torch elbows');

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
