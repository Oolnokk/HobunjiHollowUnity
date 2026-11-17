#!/usr/bin/env node
'use strict';
// Regression: locomotion cannot replace an authored tool idle stance, but real tool work owns its holder.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = path => fs.readFileSync(path, 'utf8'); // Execute shipped runtime modules rather than duplicating their pose logic.

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  copy(v) { return this.set(v.x, v.y, v.z); }
  add(v) { return this.set(this.x + v.x, this.y + v.y, this.z + v.z); }
  applyQuaternion(q) {
    const { x, y, z } = this;
    const ix = q.w * x + q.y * z - q.z * y;
    const iy = q.w * y + q.z * x - q.x * z;
    const iz = q.w * z + q.x * y - q.y * x;
    const iw = -q.x * x - q.y * y - q.z * z;
    return this.set(ix * q.w - iw * q.x - iy * q.z + iz * q.y,
      iy * q.w - iw * q.y + iz * q.x - ix * q.z,
      iz * q.w - iw * q.z + ix * q.y - iy * q.x);
  }
}
class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  clone() { return new Quaternion(this.x, this.y, this.z, this.w); }
  copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
  invert() { this.x *= -1; this.y *= -1; this.z *= -1; return this; }
  multiply(q) {
    const a = this.clone();
    return this.copy(new Quaternion(
      a.x * q.w + a.w * q.x + a.y * q.z - a.z * q.y,
      a.y * q.w + a.w * q.y + a.z * q.x - a.x * q.z,
      a.z * q.w + a.w * q.z + a.x * q.y - a.y * q.x,
      a.w * q.w - a.x * q.x - a.y * q.y - a.z * q.z));
  }
  setFromAxisAngle(axis, radians) {
    const sine = Math.sin(radians / 2);
    return this.copy(new Quaternion(axis.x * sine, axis.y * sine, axis.z * sine, Math.cos(radians / 2)));
  }
}
const THREE = { Vector3, Quaternion }; // Minimal real method contract for temporary holder pose baking.
const yAxis = new Vector3(0, 1, 0); // Drives changing body/holder orientation as if the character were walking or turning.
const body = { quaternion: new Quaternion(), parent: null };
const rendered = []; // Captures each original matrix writer call before the stance hook restores the unposed transforms.
const holder = {
  position: new Vector3(0.2, 0.6, -0.1), quaternion: new Quaternion(), scale: new Vector3(1, 1, 1),
  parent: body, userData: {}, visible: true, matrixWorld: { clone: () => ({}) },
  updateMatrix() {},
  updateMatrixWorld() { rendered.push({ position: this.position.clone(), quaternion: this.quaternion.clone() }); },
};
const slots = ['axe', 'hoe', 'pick', 'shovel', 'harpoon']; // Every carried tool class with an authored rest stance.
const equipmentSlots = {
  axe: 'hatchet', hoe: 'bronzehoe', pick: 'pickshovel', shovel: 'pickshovel', harpoon: 'fishingspear',
  weapon: 'hatchet', ranged: 'fishingspear',
};
const defs = {
  hatchet: { shapeKey: 'hatchet', animStyle: 'sweep' },
  bronzehoe: { shapeKey: 'hoe', animStyle: 'chop' },
  pickshovel: { shapeKey: 'pickshovel', animStyle: 'thrust' },
  fishingspear: { shapeKey: 'fishingspear', animStyle: 'thrust' },
};
let slot = 'axe'; // Selection read by WeaponToolStances through the real injected EquipmentPanel dependency.
let now = 1000; // Advances per rendered frame to catch the old 650ms angular-motion cooldown.
const mesh = { userData: {} };
const window = { __farmLog() {}, Combat: { deps: {} }, PlayerBodyTransformComposer: { getPlayerMesh: () => body } };
const context = vm.createContext({
  window, THREE, performance: { now: () => now }, localStorage: { getItem: () => null },
  fetch: async () => { throw new Error('offline test'); },
  setTimeout: () => 1, clearTimeout() {},
});
for (const path of ['docs/js/combat/shared-attack-pose.js', 'docs/js/weapon-tool-stances.js']) {
  vm.runInContext(read(path), context, { filename: path });
}
const deps = {
  toolHolder: holder, TOOL_ITEM_DEFS: defs, equipmentSlots,
  toolMeshMap: Object.fromEntries([...slots, 'weapon', 'ranged'].map(name => [name, mesh])),
  getActiveTool: () => slot, getHeldMode: () => 'tool',
  triggerWeaponSwingVisual() {}, triggerWeaponHoldVisual() {}, releaseWeaponSwingHold() {}, cancelWeaponSwingHold() {},
};
window.Combat.deps = deps;
window.WeaponToolStances.init(deps);
function frame(turn = 0) {
  now += 16;
  body.quaternion.setFromAxisAngle(yAxis, turn * .8);
  holder.quaternion.setFromAxisAngle(yAxis, turn * 1.3);
  holder.updateMatrixWorld();
  return { state: window.WeaponToolStances.debugSnapshot(), pose: rendered.at(-1) };
}
for (const toolSlot of slots) {
  slot = toolSlot;
  holder.userData.authoredToolActionActive = false;
  const standing = frame();
  assert.equal(standing.state.stanceApplied, true, toolSlot + ': idle stance applies at rest');
  assert.notDeepEqual(standing.pose.position, holder.position, toolSlot + ': authored rest position reaches the rendered matrix');
  for (let step = 1; step <= 6; step++) {
    const walking = frame(step);
    assert.equal(walking.state.stanceApplied, true, toolSlot + ': walking and turning cannot suppress the idle stance');
    assert.equal(walking.state.holderPoseOwner, 'idle-holder', toolSlot + ': debug owner remains idle');
    const lastBaked = walking.pose; // Captures the exact pose rendered before the hook restores the raw holder.
    const rawPosition = holder.position.clone(); // The next same-frame draw must not accumulate temporary offsets.
    const rawQuaternion = holder.quaternion.clone(); // Rotation remains game-owned rather than inheriting the idle bake.
    holder.updateMatrixWorld();
    assert.deepEqual(rendered.at(-1), lastBaked, toolSlot + ': repeated render pass draws identical authored idle pose');
    assert.deepEqual(holder.position, rawPosition, toolSlot + ': render-time stance never moves the gameplay holder');
    assert.deepEqual(holder.quaternion, rawQuaternion, toolSlot + ': render-time stance never rotates the gameplay holder');
  }
  holder.userData.authoredToolActionActive = true;
  const working = frame(7);
  assert.equal(working.state.stanceApplied, false, toolSlot + ': a real tool action owns the holder');
  assert.equal(working.state.holderPoseOwner, 'authored-tool-action');
  assert.deepEqual(working.pose.position, holder.position, toolSlot + ': authored action does not receive rest offsets');
  holder.userData.authoredToolActionActive = false;
  assert.equal(frame(8).state.stanceApplied, true, toolSlot + ': idle stance restores immediately after work');
}
slot = 'ranged';
for (const rangedItem of ['fishingspear', 'hatchet']) {
  equipmentSlots.ranged = rangedItem; // Dual-purpose melee shapes must keep the ranged fire/load Neutral rather than tool carry.
  holder.userData.authoredToolActionActive = false;
  const rangedReady = frame(9);
  assert.equal(rangedReady.state.stanceApplied, false, rangedItem + ': ranged slot is controlled by its own aiming/rest pose');
  assert.equal(rangedReady.state.holderPoseOwner, 'default', rangedItem + ': ranged Neutral is not replaced by a tool preset');
  assert.deepEqual(rangedReady.pose.position, holder.position, rangedItem + ': ranged holder stays at the authored aim point');
}
slot = 'weapon';
assert.equal(frame(10).state.stanceApplied, true, 'weapon idle stance still behaves as before');
assert(read('docs/js/hand-pixel-probe-diagnostics.js').includes('owner=${stance.holderPoseOwner ||'), 'mobile Pixel Probe must expose the actual equipped stance owner');
const game = read('docs/game.js'); // Native old-style strokes must publish ownership, not just modular combat poses.
assert(game.includes("authoredToolActionActive = activeTool !== 'weapon' && toolSwingT > 0;"),
  'legacy, modular, fishing and torch action frames all publish explicit tool ownership');
assert.equal(window.WeaponToolStances.debugSnapshot().holderMotionBusyMs, 0, 'stale movement cooldown stays disabled');
console.log('tool walking idle stance and authored tool pose ownership PASS');
