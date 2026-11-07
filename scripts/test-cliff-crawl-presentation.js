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
  lerp(v, t) { return this.set(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t, this.z + (v.z - this.z) * t); }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() { const length = Math.sqrt(this.lengthSq()); return length ? this.multiplyScalar(1 / length) : this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  applyQuaternion(q) { // Exact vector rotation lets this fixture verify the real avatar plane orientation.
    const { x, y, z, w } = q;
    const ix = w * this.x + y * this.z - z * this.y;
    const iy = w * this.y + z * this.x - x * this.z;
    const iz = w * this.z + x * this.y - y * this.x;
    const iw = -x * this.x - y * this.y - z * this.z;
    return this.set(ix * w + iw * -x + iy * -z - iz * -y,
      iy * w + iw * -y + iz * -x - ix * -z,
      iz * w + iw * -z + ix * -y - iy * -x);
  }
}
class Q {
  static tilts = []; // Records world-up-to-face-normal rotations used to catch inverted body lean.
  constructor(x = 0, y = 0, z = 0, w = 1) { Object.assign(this, { x, y, z, w }); }
  clone() { return new Q(this.x, this.y, this.z, this.w); }
  copy(q) { Object.assign(this, { x: q.x, y: q.y, z: q.z, w: q.w }); return this; }
  invert() { this.x *= -1; this.y *= -1; this.z *= -1; return this; }
  multiply(q) { // Hamilton product, matching Three.js's multiplication order.
    const a = this.clone();
    return this.copy(new Q(
      a.x * q.w + a.w * q.x + a.y * q.z - a.z * q.y,
      a.y * q.w + a.w * q.y + a.z * q.x - a.x * q.z,
      a.z * q.w + a.w * q.z + a.x * q.y - a.y * q.x,
      a.w * q.w - a.x * q.x - a.y * q.y - a.z * q.z
    ));
  }
  premultiply(q) { return this.copy(q.clone().multiply(this)); }
  setFromAxisAngle(axis, angle) { const s = Math.sin(angle / 2); return this.copy(new Q(axis.x * s, axis.y * s, axis.z * s, Math.cos(angle / 2))); }
  setFromUnitVectors(from, to) {
    Q.tilts.push([from.clone(), to.clone()]);
    const r = from.dot(to) + 1;
    const cross = new Vec(from.y * to.z - from.z * to.y, from.z * to.x - from.x * to.z, from.x * to.y - from.y * to.x);
    const q = r < 1e-6 ? new Q(0, 1, 0, 0) : new Q(cross.x, cross.y, cross.z, r);
    const length = Math.hypot(q.x, q.y, q.z, q.w);
    return this.copy(new Q(q.x / length, q.y / length, q.z / length, q.w / length));
  }
}

assert(climb.startClimb({ type: 'cliffRoute', route, entry: 0 }));
const tool = { isObject3D: true, visible: true }; // External weapon/tool scene root.
const item = { isObject3D: true, type: 'Group', userData: { isPngPlane: true }, visible: true, name: '' }; // In-rig held item.
const burden = { isObject3D: true, visible: true }; // Carried (not back-stowed) burden.
const stowed = { isObject3D: true, visible: true, name: 'stowed-back-burden' }; // Must remain visible when held categories hide.
const worldHands = []; // World-space contact positions placed by the real hand rig API.
const sockets = Object.fromEntries(['left', 'right'].map(side => [side, {
  position: new Vec(), quaternion: new Q(), scale: new Vec(1, 1, 1), visible: true,
}])); // Synthetic live hand sockets test temporary render-only placement and restoration.
let returnedToIdle = 0; // Verifies paired-action ownership is not stolen on crawl exit.
const rig = {
  group: {
    parent: {}, getObjectByName(name) { return sockets[name.split('_')[0]] || null; },
    updateWorldMatrix() {},
  },
  owner: null, provider: null,
  getDebug() { return { poseOwner: this.owner }; },
  setPoseProvider(owner, provider) {
    if (provider || this.owner === owner) { this.owner = provider ? owner : null; this.provider = provider || null; }
  },
  applyOwnedPose() { if (this.provider) { this.provider(this); return true; } return false; },
  placeHandWorld(side, target, rotation) {
    worldHands.push({ side, target: target.clone(), rotation });
    sockets[side].position.copy(target);
  },
  useIdlePose() { returnedToIdle++; },
};
const mesh = {
  isObject3D: true, visible: true, position: new Vec(), quaternion: new Q(),
  parent: { worldToLocal: value => value }, children: [item, stowed],
  traverse(visit) { visit({ userData: { proceduralHandRig: rig } }); },
  getWorldPosition(value) { return value.copy(this.position); },
  getWorldQuaternion(q) { return q.copy(this.quaternion); },
  updateWorldMatrix() {},
};
let footPoseCount = 0; // Counts direct IK foot solver calls.
let footTargets = null; // Confirms the actual world-space contacts passed to the existing 2-bone solver.
let footOrientation = null; // The sole's local up axis must rotate to the actual cliff normal.
let externalFeetOwned = false; // Simulates a grapple/paired-action claiming both leg targets.
let failFootPose = false; // Simulates an interrupted render so the scoped transform restores before returning.
const gait = { left: new Vec(1, 2, 3), right: new Vec(4, 5, 6), mode: 'idle', lean: 0.15 }; // Real leg IK mutates these internal values as well as the rendered chain.
const feet = {
  modelHeight: 1,
  group: { getObjectByName: () => null, updateWorldMatrix() {} },
  hasExternalFootTargets: () => externalFeetOwned,
  captureMotionState: () => ({
    leftTarget: gait.left.clone(), rightTarget: gait.right.clone(), motionMode: gait.mode, runLean: gait.lean,
  }),
  restoreMotionState(snapshot) {
    gait.left.copy(snapshot.leftTarget); gait.right.copy(snapshot.rightTarget);
    gait.mode = snapshot.motionMode; gait.lean = snapshot.runLean;
  },
  applyWorldFootTargets(targets, orientation) {
    footOrientation = orientation;
    gait.left.set(10, 11, 12); gait.right.set(13, 14, 15);
    gait.mode = 'paired-dance'; gait.lean = 0;
    if (failFootPose) throw new Error('synthetic IK failure');
    footPoseCount++; footTargets = targets; return true;
  },
};
let hook = null; // Captured composer render hook; called with an undo stack below.
const composer = {
  addPostHeadAimHook(callback) { hook = callback; },
  getPlayerMesh: () => mesh,
  getPlayerLegHandle: () => feet,
};
const renderWin = {
  ClimbSystem: climb, THREE: { Vector3: Vec, Quaternion: Q },
  PlayerBodyTransformComposer: composer,
  ProceduralHandAttachments: { gameDeps: { toolHolder: tool } },
  Shattercasks: { heldHandTarget: () => ({ holder: burden }) },
};
vm.runInNewContext(presentationSource, { window: renderWin });
assert.equal(typeof hook, 'function', 'render hook installs through the existing composer');
const contacts = renderWin.CliffCrawlPresentation;
assert.equal(contacts.sampleContact(0.1, false, 0.5).lift, 0, 'idle climber keeps contact planted');
assert(contacts.sampleContact(0.5, true, 0.07).progress > contacts.sampleContact(0.5, true, 0.38).progress,
  'left and right hands transfer to new holds at different phases');

function draw() {
  const undo = [], debug = {};
  hook(undo, debug);
  return { undo, debug };
}
function restore(undo) { for (let i = undo.length - 1; i >= 0; i--) undo[i](); }

let frame = draw();
const portraitFace = new Vec(0, 0, 1).applyQuaternion(mesh.quaternion); // Must face the cliff or its back without turning edge-on.
const portraitUp = new Vec(0, 1, 0).applyQuaternion(mesh.quaternion);
assert(Math.abs(portraitFace.x) > 0.97 && Math.abs(portraitFace.z) < 0.05,
  'portrait plane stays tangent to the cliff and is not edge-on');
assert(portraitUp.y > 0.98, 'climber retains an upright torso rather than a near-horizontal body fold');
assert(frame.debug.cliffCrawl.bodyLeanDeg < 12, 'mobile diagnostics report a small, intentional wall lean');
assert(!tool.visible && !item.visible && !burden.visible, 'all held visual categories hide during crawl');
assert(stowed.visible, 'stowed equipment remains visible');
assert.equal(rig.owner, 'cliff-crawl', 'crawl owns the existing procedural hand rig');
assert.equal(worldHands.length, 2, 'both hands use world-space contact placement, not idle offsets');
assert(worldHands.every(entry => entry.target.x < 0 && entry.target.y > 0),
  'hands plant outside the face above the character and in its normal space');
assert.equal(footPoseCount, 1, 'real procedural foot solver receives one paired contact update');
assert(footTargets.left.x < -0.09 && footTargets.right.x < -0.09, 'planted feet clear the cliff surface so their shells are not depth-clipped');
assert(footTargets.left.y >= 0 && footTargets.right.y >= 0 && footTargets.left.y < 0.2,
  'feet are placed against the rock near the route point rather than buried below ground');
assert(footOrientation instanceof Q, 'foot IK receives a cliff-relative sole orientation');
assert(Q.tilts.some(([from, to]) => from.y === 1 && to.x < -0.9), 'foot soles rotate from world-up into the rock normal');
assert(Q.tilts.some(([from, to]) => from.y === 1 && to.x < -0.1),
  'body leans toward the OUTWARD cliff normal rather than into the rock');
assert(frame.debug.cliffCrawl.feetPosed && frame.debug.cliffCrawl.handRigOwned);
restore(frame.undo);
assert(tool.visible && item.visible && burden.visible, 'render undo restores all held categories');
assert.equal(mesh.position.x, 0, 'render undo restores body world position');
assert.equal(sockets.left.position.y, 0, 'render undo restores the left hand socket');
assert.equal(sockets.right.position.y, 0, 'render undo restores the right hand socket');
assert.equal(gait.left.y, 2, 'render undo restores gait target instead of retaining climb IK');
assert.equal(gait.mode, 'idle', 'render undo restores the original foot motion mode');

input = { x: 1, y: 0 };
climb.updateClimb(0.3);
assert(player.climbing && climb.getCrawlState()?.moving, 'movement is a live linked handhold traverse');
frame = draw();
assert(worldHands.length >= 4, 'hands keep solving during active movement');
assert(worldHands.at(-2).target.y > worldHands[0].target.y, 'moving hand reaches higher on the selected edge');
restore(frame.undo);

externalFeetOwned = true;
frame = draw();
assert.equal(footPoseCount, 2, 'climb does not overwrite grapple-owned leg targets');
assert.equal(frame.debug.cliffCrawl.feetPosed, false, 'mobile diagnostics report leg override');
restore(frame.undo);
externalFeetOwned = false;

rig.owner = 'grapple';
rig.provider = () => {};
frame = draw();
assert.equal(rig.owner, 'grapple', 'crawl never steals a newer paired-action owner');
assert.equal(frame.debug.cliffCrawl.handRigOwned, false);
restore(frame.undo);

area = 'town';
climb.updateClimb(0.016); // The real movement tick retires a stale route on map transition.
frame = draw();
assert.equal(frame.debug.cliffCrawl, undefined, 'other areas have no active crawl pose');
assert.equal(rig.owner, 'grapple', 'climb exit preserves other hand owner');
restore(frame.undo);
area = 'western-slope';
rig.owner = null; rig.provider = null;
input = { x: 0, y: 0 };
assert(climb.startClimb({ type: 'cliffRoute', route, entry: 0 }));
failFootPose = true;
frame = draw();
assert(frame.debug.cliffCrawl.error.includes('synthetic IK failure'), 'render error appears in mobile diagnostics');
assert.equal(mesh.position.x, 0, 'even interrupted renders immediately roll back the body transform');
assert.equal(sockets.left.position.y, 0, 'even interrupted renders restore the hand socket');
assert.equal(gait.left.y, 2, 'even interrupted renders restore gait targets');
assert(tool.visible && item.visible && burden.visible, 'interrupted render leaves equipment visible');
assert.equal(rig.owner, null, 'interrupted render releases procedural hand ownership');
assert(returnedToIdle > 0, 'cliff pose returns to the default idle pose');
failFootPose = false;
frame = draw();
assert(frame.debug.cliffCrawl.active, 'cliff crawl reclaims a healthy rig after a failed frame');
restore(frame.undo);
assert(contacts.getDebug().hookInstalled, 'mobile diagnostics expose hook installation');

// Lateral and downhill edges sample the same generated face coordinates; there is no world-up bounce.
const lateral = {
  player: { x: 32, y: 32, climbSurfaceY: 2, climbStartX: 0, climbEndX: 0,
    climbStartY: 0, climbEndY: 64, climbSurfaceStartY: 2, climbSurfaceEndY: 2 },
  moving: true, progress: 0.65, tileSize: 64,
};
const normal = new Vec(-1, 0, 0); // Horizontal wall pointing outward along negative world X.
const lateralLeft = contacts.surfaceContact(lateral, normal, 'left', 'hand', 1);
const lateralRight = contacts.surfaceContact(lateral, normal, 'right', 'hand', 1);
assert(lateralLeft.z + 0.13 > lateralRight.z - 0.13, 'after subtracting the mirrored grip spread, left hand advances earlier across sideways edges');
assert(Math.abs(lateralLeft.y - lateralRight.y) < 1e-8, 'sideways reach does not add an artificial vertical hop');
const downhill = { ...lateral, player: { ...lateral.player,
  climbSurfaceStartY: 2, climbSurfaceEndY: 0.8 } };
const downhillContact = contacts.surfaceContact(downhill, normal, 'left', 'foot', 1);
assert(downhillContact.y < 2, 'downward climbing contacts move down the face using the same solver');

console.log('cliff crawl presentation: all targeted checks passed');
