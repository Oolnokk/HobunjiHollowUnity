#!/usr/bin/env node
'use strict';
// Runs the real shattercasks.js against the real Targetables / WorldEvents modules in a lean sandbox:
// burdens appear as targetables with live capabilities, and every blast emits a 'blast' event.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, 'docs', f), 'utf8');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  clone() { return new Vector3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  addScaledVector(v, k) { this.x += v.x * k; this.y += v.y * k; this.z += v.z * k; return this; }
  setScalar(k) { return this.set(k, k, k); }
  multiplyScalar(k) { this.x *= k; this.y *= k; this.z *= k; return this; }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  length() { return Math.sqrt(this.lengthSq()); }
  normalize() { return this.multiplyScalar(1 / (this.length() || 1)); }
  crossVectors(a, b) { return this.set(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
}
class Quaternion { copy() { return this; } identity() { return this; } clone() { return new Quaternion(); } }
class Node {
  constructor() { this.quaternion = new Quaternion(); this.children = []; this.position = new Vector3(); this.scale = new Vector3(1, 1, 1); this.rotation = new Vector3(); this.userData = {}; this.parent = null; this.isObject3D = true; }
  add(o) { this.children.push(o); o.parent = this; }
  remove(o) { this.children = this.children.filter(c => c !== o); o.parent = null; }
  traverse(cb) { cb(this); for (const c of this.children) c.traverse(cb); }
  updateWorldMatrix() {}
  getWorldPosition(target) { return target.copy(this.position); }
  getWorldQuaternion(target) { return target; }
  getWorldScale(target) { return target.set(1, 1, 1); }
}
class Mesh extends Node { constructor(g, m) { super(); this.geometry = g; this.material = m; this.isMesh = true; } }
class Geometry { dispose() {} }
class Material { constructor(o) { Object.assign(this, o); } clone() { return new Material({ ...this }); } dispose() {} }
class Raycaster { constructor() { this.near = 0; this.far = Infinity; this.ray = { origin: new Vector3(), direction: new Vector3() }; } intersectObjects() { return []; } }
const THREE = { Quaternion, Group: Node, Mesh, SkinnedMesh: Mesh, InstancedMesh: Mesh, Object3D: Node, Vector3, Raycaster, RingGeometry: Geometry,
  TetrahedronGeometry: Geometry, SphereGeometry: Geometry, CylinderGeometry: Geometry, DodecahedronGeometry: Geometry,
  MeshBasicMaterial: Material, MeshLambertMaterial: Material, DoubleSide: 2, AdditiveBlending: 3, TextureLoader: class { load() { return { dispose() {} }; } } };


const area = 'map_i_ballistic_test';
const scene = new Node();
const tiles = Array.from({ length: 24 }, () => Array.from({ length: 24 }, () => ({ type: 'grass' })));
const player = { x: 3.5 * 64, y: 4.5 * 64, angle: 0, health: 100, id: 'player' };
const toasts = [];
// Ground is flat at 0, except a raised step (top at 1.0) for x >= 14: a launched burden must land on it.
const deps = { TILE: 64, player, inventory: {}, TileType: { GRASS: 'grass' }, getCurrentArea: () => area, getActiveScene: () => scene, worldSurfaceY: () => 0,
  getGroundYAtWorld: (x, z) => (x >= 14 ? 1.0 : 0), hostileObjects: new Set(), getPlayerMeleeAimPitch: () => 0, clearVegetationInAttackCone: () => 0, damagePlayer() {}, showToast: m => toasts.push(m) };
let collider = null;
const game = {
  console, THREE, performance, localStorage: { getItem: () => null, setItem() {} }, __hobunjiPlayerProfile: { worldId: 'regression' },
  Combat: { deps, init() {}, update() {}, beginStagedAction: o => o, spawnMeleeTrail() {}, meleeColliderVolume: () => collider },
  GridTileAccessors: { getActiveScene: () => scene, getActiveGrid: () => tiles, getCurrentArea: () => area },
  AuthoredFurniture: { load: async () => null, buildGroup: () => null }, DevSpawner: { init() {} }, ResourceSystem: { spendFooting() {} },
  AudioSystem: { playWeaponHitSfx() {}, playObjectSfxKey() {} }, __farmLog() {},
};
game.window = game;
vm.createContext(game);
for (const f of ['js/world-action-input-claims.js', 'js/world-events.js', 'js/targetables.js', 'js/shattercasks.js']) vm.runInContext(read(f), game, { filename: f });
const { Shattercasks: Sh, WorldEvents } = game;

function burden(id, at, extra = {}) {
  const group = new Node(); group.position.set(at.x, at.y, at.z);
  return Sh.registerHangingBurden({ id, mapId: area, scene, group, kind: 'ballisticTest', hanging: false, data: {}, ...extra });
}
const tick = (seconds, dt = 0.05) => { for (let i = 0; i < Math.round(seconds / dt); i++) Sh.tick(dt); };

// ---- regression: the original straight-down release is unchanged
const dropper = burden('drop1', { x: 6.5, y: 3, z: 6.5 });
assert.equal(Sh.releaseBurdenDownward(dropper, 'test'), true);
assert.equal(dropper.flying, true);
tick(2);
assert.equal(dropper.group.position.x, 6.5, 'a downward release does not drift sideways'); assert.equal(dropper.group.position.z, 6.5);
assert(Math.abs(dropper.group.position.y - .30) < 1e-6, 'and lands at ground + the shattercask landing height');
assert.equal(dropper.flying, false, 'flight ends on landing');

// ---- launched with horizontal velocity: travels along an arc and lands
const shot = burden('shot1', { x: 8, y: 2, z: 8 });
assert.equal(Sh.releaseBurdenWithVelocity(shot, { x: 4, y: 3, z: -1 }, 'rope-launch'), true);
tick(0.3); assert(shot.group.position.x > 9 && shot.group.position.z < 8, 'moves in the launch direction');
assert(shot.group.position.y > 2, 'and rises first (positive vertical velocity)');
tick(3);
assert.equal(shot.flying, false, 'it lands');
const flatLanding = shot.group.position;
// analytic landing for gravity 13: y(t) = 2 + 3t - 6.5 t^2 reaches the landing height .30 at t = (3 + sqrt(9 + 4*6.5*1.7)) / 13
const tLand = (3 + Math.sqrt(9 + 4 * 6.5 * 1.7)) / 13;
assert(Math.abs(flatLanding.x - (8 + 4 * tLand)) < 0.1, 'it lands where the arc says: x=' + flatLanding.x + ' expected ' + (8 + 4 * tLand));
assert(Math.abs(flatLanding.z - (8 - 1 * tLand)) < 0.1, 'sideways velocity is honoured too: z=' + flatLanding.z);
assert(Math.abs(flatLanding.y - .30) < 1e-6, 'and rests on flat ground');

// ---- the ground is re-resolved under the moving burden: a step ahead catches it
const hop = burden('hop1', { x: 11, y: 3, z: 8 }); // high enough to clear the step's edge
Sh.releaseBurdenWithVelocity(hop, { x: 5, y: 3, z: 0 }, 'rope-launch');
tick(4);
assert(hop.group.position.x >= 14, 'it flew onto the raised step');
assert(Math.abs(hop.group.position.y - 1.30) < 1e-6, 'and landed on the step top, not at the flat floor height: y=' + hop.group.position.y);

// ---- bad velocities are rejected into a plain downward release, never NaN positions
const odd = burden('odd1', { x: 7, y: 2, z: 12 });
Sh.releaseBurdenWithVelocity(odd, { x: NaN, y: 1, z: 0 }, 'x'); tick(2);
assert([odd.group.position.x, odd.group.position.y, odd.group.position.z].every(Number.isFinite)); assert.equal(odd.group.position.x, 7, 'a non-finite velocity falls straight down instead');

// ---- the burden keeps a fuse and its own impact handler through a launch
let impacts = 0;
const rigged = burden('rig1', { x: 8, y: 2, z: 14 }, { onImpact: (b, cause) => { impacts++; return false; } });
Sh.releaseBurdenWithVelocity(rigged, { x: 3, y: 1, z: 0 }, 'rope-launch'); tick(3);
assert.equal(impacts >= 1, true, 'the landing runs the burden\'s own impact handler (a bomb stays intact and keeps its fuse)');
assert.equal(rigged.exploded, false);

// ---- sweepMelee: a burden with a strikeHandler handles the hit itself
collider = { origin: new Vector3(3.5, .35, 20.5), yaw: 0, horizontalRangeWorld: 3, verticalRiseWorld: 0, halfConeRad: 0.6, halfHeightWorld: 0.6, direction: new Vector3(1, 0, 0) };
const struck = []; WorldEvents.on('struck', p => struck.push(p));
const target = burden('swing1', { x: 5.5, y: .35, z: 20.5 });
const calls = [];
target.strikeHandler = (b, info) => { calls.push([b.id, info.attacker === player, info.source]); return true; };
Sh.sweepMelee({ actor: player, rangePx: 3 * 64, halfConeRad: 0.6, yaw: 0, pitch: 0 });
assert.deepEqual(calls.map(c => c.join(':')), ['swing1:true:melee'], 'the handler receives the burden, attacker and source');
assert.equal(target.exploded, false, 'a handled strike does not detonate the burden');
assert.equal(struck.length, 1, "the 'struck' event still fires"); assert.equal(struck[0].targetId, 'swing1');
target.strikeHandler = () => { throw new Error('boom'); };
const warn = console.warn; console.warn = () => {};
assert.doesNotThrow(() => Sh.sweepMelee({ actor: player, rangePx: 3 * 64, halfConeRad: 0.6, yaw: 0, pitch: 0 })); console.warn = warn;

// ---- interact hangs a carried burden on a rope when one is in reach, otherwise drops it
let hangCalls = 0, hangResult = true;
game.HangingRopes = { tryHang: held => { hangCalls++; return hangResult && !!held; }, tick() { game.__ropeTicks = (game.__ropeTicks || 0) + 1; } };
const carried = burden('carry1', { x: 3.5, y: .5, z: 4.5 });
assert.equal(Sh.pickUp(carried), true, 'can pick it up'); assert.equal(Sh.heldBurdenInfo()?.id, 'carry1');
assert.equal(Sh.interact(), true); assert.equal(hangCalls, 1, 'the carry-release action asks the rope first');
assert.equal(Sh.heldBurdenInfo()?.id, 'carry1', 'and when the rope took it (the stub does not release it), drop() did not run');
hangResult = false;
assert.equal(Sh.interact(), true); assert.equal(Sh.heldBurdenInfo(), null, 'with no rope in reach it is dropped as before');

// ---- detachHeldBurden hands the burden over without placing it
const hand = burden('hand1', { x: 3.5, y: .5, z: 4.5 });
assert.equal(Sh.pickUp(hand), true);
const taken = Sh.detachHeldBurden();
assert.equal(taken, hand); assert.equal(hand.carried, false); assert.equal(Sh.heldBurdenInfo(), null, 'no longer held');
assert.equal(Sh.detachHeldBurden(), null, 'nothing left to take');

// ---- the per-frame tick drives ropes
game.__ropeTicks = 0; Sh.tick(0.05); Sh.tick(0.05);
assert.equal(game.__ropeTicks, 2, 'Shattercasks.tick calls HangingRopes.tick every frame');
assert.equal(typeof Sh.refreshBurdenBounds, 'function');
console.log('burden-ballistic: ok');
