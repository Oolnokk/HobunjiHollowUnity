'use strict';
const assert = require('assert'); // Checks final tilt under independent movement, stance, and billboard headings.
const fs = require('fs'); // Loads the shipped composer functions for execution.
const vm = require('vm'); // Supplies a small renderer-independent math fixture.
const source = fs.readFileSync('docs/js/player-body-transform-composer.js', 'utf8'); // Production composer including world-channel routing.
class Q {
  constructor(x = 0, y = 0, z = 0, w = 1) { Object.assign(this, { x, y, z, w, isQuaternion: true }); }
  clone() { return new Q(this.x, this.y, this.z, this.w); }
  copy(q) { Object.assign(this, q); return this; }
  multiply(q) {
    const { x, y, z, w } = this; // Hamilton product for the rendered orientation.
    return this.copy(new Q(w*q.x+x*q.w+y*q.z-z*q.y, w*q.y-x*q.z+y*q.w+z*q.x,
      w*q.z+x*q.y-y*q.x+z*q.w, w*q.w-x*q.x-y*q.y-z*q.z));
  }
}
class V {
  constructor(x = 0, y = 0, z = 0) { this.set(x,y,z); }
  set(x,y,z) { Object.assign(this,{x,y,z}); return this; }
  lengthSq() { return this.x*this.x+this.y*this.y+this.z*this.z; }
}
const body = { quaternion: new Q(), localToWorld: v => v }; // Represents the character after weapon yaw and camera-facing correction.
const held = { quaternion: new Q() }; // External attachments receive the same movement lean.
const roots = [{ root: body, kind: 'player' }, { root: held, kind: 'external' }]; // Matches the composer's existing ownership list.
const context = {
  THREE: { Quaternion: Q, Vector3: V }, channels: new Map(), playerMesh: body, playerPosteriorY: 0.5,
  finite: (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback,
  currentOwnedRootEntries: () => roots, hierarchyWorldQuaternion: root => root.quaternion,
  quaternionEulerDegrees: () => ({}),
  applyWorldDelta(root, pivot, rotation, translation, undo) {
    const previous = root.quaternion.clone(); // Captures restoration at the same seam as the real renderer.
    root.quaternion.copy(rotation.clone().multiply(root.quaternion));
    undo.push(() => root.quaternion.copy(previous));
  },
}; // Only rendering IO is mocked; channel storage, filtering, and final routing execute production code.
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('  function channelQuaternion('), source.indexOf('  function applyWorldDelta(')), context);
vm.runInContext(source.slice(source.indexOf('  function setChannel('), source.indexOf('  function clearChannel(')), context);
vm.runInContext(source.slice(source.indexOf('  const worldChannelPivot'), source.indexOf('  function registerPlayerRig(')), context);
for (let movement = 0; movement < 8; movement++) {
  for (const stance of [-2.4, -0.9, 0, 0.7, 2.1]) {
    const yaw = movement*Math.PI/4; // Covers forward, backward, lateral, and diagonal travel independent of stance.
    const lean = new Q(Math.cos(yaw)*Math.sin(Math.PI/12),0,-Math.sin(yaw)*Math.sin(Math.PI/12),Math.cos(Math.PI/12)); // Thirty-degree lean toward movement.
    body.quaternion = new Q(0,Math.sin(stance/2),0,Math.cos(stance/2));
    held.quaternion.copy(body.quaternion);
    context.setChannel('stance', { quaternion: new Q(0,Math.sin(stance/2),0,Math.cos(stance/2)) });
    context.setChannel('run-lean', { space: 'world', quaternion: lean });
    assert.deepStrictEqual(Array.from(context.resolveDelta('player').applied), ['stance'], 'world lean never participates in portrait-local composition');
    const undo = []; // Runs the same final-phase restoration used by the renderer.
    const debug = { appliedOrder: ['stance'] }; // Existing yaw contributions remain visible in diagnostics.
    context.applyWorldChannels(undo, debug);
    for (const root of [body,held]) {
      const q = root.quaternion; // Rotated up must point toward velocity for every stance.
      assert(Math.abs(2*(q.x*q.y-q.w*q.z)-Math.sin(yaw)*0.5)<1e-12);
      assert(Math.abs(2*(q.y*q.z+q.w*q.x)-Math.cos(yaw)*0.5)<1e-12);
      assert(Math.abs(1-2*(q.x*q.x+q.z*q.z)-Math.cos(Math.PI/6))<1e-12);
    }
    assert(debug.appliedOrder.includes('run-lean'));
    for (const restore of undo.reverse()) restore();
    assert.strictEqual(body.quaternion.x,0, 'render lean never accumulates into gameplay facing');
    assert.strictEqual(body.quaternion.z,0);
  }
}
console.log('World movement lean follows travel across 40 stance/heading combinations and restores after render.');
