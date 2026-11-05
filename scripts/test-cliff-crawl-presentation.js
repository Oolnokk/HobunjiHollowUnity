#!/usr/bin/env node
'use strict';

// Focused, browser-free regression for manual handhold travel and held-visual
// suppression. Run: node scripts/test-cliff-crawl-presentation.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const climbSource = read('docs/js/climb-system.js'); // Exercises live route movement, not a duplicate interpolation implementation.
const presentationSource = read('docs/js/cliff-crawl-presentation.js'); // Exercises the shipped render hook with a minimal Three.js stub.
const html = read('docs/index.html'); // Confirms the live game loads both modules before game.js.
assert(html.includes('js/cliff-crawl-presentation.js'));
assert(html.indexOf('js/climb-system.js') < html.indexOf('js/cliff-crawl-presentation.js'));

let input = { x: 0, y: 0 }; // Changed below to check idle, ascending, and descending route input.
let area = 'western-slope'; // Stable wilderness map key used by the active climb session.
const win = {
  CliffRouteNetwork: {
    nextHop(route, index, direction) {
      if (Math.hypot(direction.x, direction.z) < 0.2) return null;
      const from = route.nodes[index];
      return from.links.map(i => route.nodes[i])
        .find(node => Math.sign(node.y - from.y) === Math.sign(direction.x)) || null;
    },
  },
};
vm.runInNewContext(climbSource, { window: win });
const player = { x: 0, y: 0, angle: 0, climbing: false, vx: 0, vy: 0 }; // Game movement state read by ClimbSystem.
const route = {
  id: 1, normal: { x: -1, z: 0 }, upperNode: 2,
  nodes: [
    { id: 0, x: 0, z: 0, y: 0, links: [1] },
    { id: 1, x: 0.2, z: 0, y: 0.7, links: [0, 2] },
    { id: 2, x: 0.3, z: 0, y: 1.4, links: [1] },
  ],
}; // Two safe sample edges, sharing one intermediate hold.
const deps = {
  player, TILE: 64, getCurrentArea: () => area, getMovementInput: () => input,
  getMountRideState: () => 'none', setFacingAngle() {}, setTargetAimAngle() {},
  setLastMoveAngle() {}, clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
};
const climb = win.ClimbSystem;
climb.init(deps);
assert(climb.startClimb({ type: 'cliffRoute', route, entry: 0 }));
climb.updateClimb(0.1);
assert.equal(player.climbSurfaceY, 0, 'idle at a hold remains stationary');
assert.equal(player.climbHopBounce, 0, 'idle has no hop bounce');
assert.equal(climb.getCrawlState().tileSize, 64, 'renderer receives the actual tile scale');
input = { x: 1, y: 0 };
climb.updateClimb(0.1);
assert(player.climbSurfaceY > 0 && player.climbSurfaceY < 0.7, 'movement interpolates between adjacent holds');
assert.equal(player.climbHopBounce, 0, 'ascent has no hop bounce');
for (let i = 0; i < 30 && player.climbing; i++) climb.updateClimb(0.1);
assert.equal(player.climbing, false, 'reaching the upper endpoint exits the route');
assert(Math.abs(player.climbSurfaceY - 1.4) < 0.001, 'exit height matches the destination');

class Vec {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  clone() { return new Vec(this.x, this.y, this.z); }
  copy(v) { return this.set(v.x, v.y, v.z); }
  add(v) { return this.set(this.x + v.x, this.y + v.y, this.z + v.z); }
  addScaledVector(v, f) { return this.set(this.x + v.x * f, this.y + v.y * f, this.z + v.z * f); }
  multiplyScalar(s) { return this.set(this.x * s, this.y * s, this.z * s); }
  negate() { return this.multiplyScalar(-1); }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() { const length = Math.sqrt(this.lengthSq()); return length ? this.multiplyScalar(1 / length) : this; }
}
class Q {
  clone() { return new Q(); }
  invert() { return this; }
  multiply() { return this; }
  premultiply() { return this; }
  copy() { return this; }
  setFromUnitVectors() { return this; }
}

assert(climb.startClimb({ type: 'cliffRoute', route, entry: 0 }));
const tool = { isObject3D: true, visible: true }; // External weapon/tool scene root.
const item = { isObject3D: true, type: 'Group', userData: { isPngPlane: true }, visible: true, name: '' }; // In-rig held item.
const burden = { isObject3D: true, visible: true }; // Carried (not back-stowed) burden.
let handPoseCount = 0; // Counts left/right procedural grips applied during the synthetic render.
const rig = {
  getDebug: () => ({ poseOwner: null }),
  setPoseProvider(_owner, provider) { this.provider = provider; },
  applyOwnedPose() { if (this.provider) { this.provider(this); return true; } return false; },
  armLengthForSide: () => 0.3,
  setSideIdle() { handPoseCount++; },
  useIdlePose() {},
};
const mesh = {
  isObject3D: true, visible: true, position: new Vec(), quaternion: new Q(),
  parent: { worldToLocal: value => value }, children: [item],
  traverse(visit) { visit({ userData: { proceduralHandRig: rig } }); },
  getWorldPosition(value) { return value.set(0, 0, 0); },
  updateWorldMatrix() {},
};
let hook = null; // Captured composer render hook; called with an undo stack below.
const composer = {
  addPostHeadAimHook(callback) { hook = callback; },
  getPlayerMesh: () => mesh,
  getPlayerLegHandle: () => null,
};
const renderWin = {
  ClimbSystem: climb, THREE: { Vector3: Vec, Quaternion: Q },
  PlayerBodyTransformComposer: composer,
  ProceduralHandAttachments: { gameDeps: { toolHolder: tool } },
  Shattercasks: { heldHandTarget: () => ({ holder: burden }) },
};
vm.runInNewContext(presentationSource, { window: renderWin });
assert.equal(typeof hook, 'function', 'render hook installs through the existing composer');
const stride = renderWin.CliffCrawlPresentation.sampleStride;
assert(stride(Math.PI / 2, true, 'left').lift > 0.99);
assert(stride(Math.PI / 2, true, 'right').lift < 0.01, 'left/right hands alternate');
const undo = [], renderDebug = {};
hook(undo, renderDebug);
assert(!tool.visible && !item.visible && !burden.visible, 'all held visual categories hide while drawing');
assert(handPoseCount >= 2 && renderDebug.cliffCrawl.active, 'the procedural grips visibly move in crawl pose');
for (let i = undo.length - 1; i >= 0; i--) undo[i]();
assert(tool.visible && item.visible && burden.visible, 'every held visual is restored after rendering');
assert.equal(renderWin.CliffCrawlPresentation.getDebug().hiddenHeldVisuals, 3);

console.log('cliff crawl presentation: all targeted checks passed');
