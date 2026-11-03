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
class Quaternion { setFromUnitVectors() { return this; } copy() { return this; } identity() { return this; } clone() { return new Quaternion(); } }
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



const RL = require('../docs/js/rope-launch.js');
const area = 'map_i_rope_launch_test';
const scene = new Node();
const tiles = Array.from({ length: 40 }, () => Array.from({ length: 40 }, () => ({ type: 'grass' })));
const player = { x: 3.5 * 64, y: 4.5 * 64, angle: 0, health: 100, id: 'player' };
let groundFn = () => 0;
const deps = { TILE: 64, player, inventory: {}, TileType: { GRASS: 'grass' }, getCurrentArea: () => area, getActiveScene: () => scene, worldSurfaceY: () => 0,
  getGroundYAtWorld: (x, z) => groundFn(x, z), hostileObjects: new Set(), getPlayerMeleeAimPitch: () => 0, clearVegetationInAttackCone: () => 0, damagePlayer() {}, showToast() {} };
const game = {
  console, THREE, performance, localStorage: { getItem: () => null, setItem() {} }, __hobunjiPlayerProfile: { worldId: 'regression' },
  Combat: { deps, init() {}, update() {}, beginStagedAction: o => o, spawnMeleeTrail() {}, meleeColliderVolume: () => null },
  GridTileAccessors: { getActiveScene: () => scene, getActiveGrid: () => tiles, getCurrentArea: () => area },
  AuthoredFurniture: { load: async () => null, buildGroup: () => null }, DevSpawner: { init() {} }, ResourceSystem: { spendFooting() {} },
  AudioSystem: { playWeaponHitSfx() {}, playObjectSfxKey() {} }, __farmLog() {},
};
game.window = game;
vm.createContext(game);
for (const f of ['js/world-action-input-claims.js', 'js/world-events.js', 'js/targetables.js', 'js/rope-core.js', 'js/shattercasks.js', 'js/hanging-ropes.js']) vm.runInContext(read(f), game, { filename: f });
const { Shattercasks: Sh, HangingRopes: HR, WorldEvents } = game;
assert(HR?.installed, 'HangingRopes loaded');

// Run the real thing: a burden on a real rope, struck at `speed` along (dirX, dirZ); returns where it really lands.
function actual({ anchor, length, dirX, dirZ, speed, id }) {
  const rope = HR.registerRope({ id: 'r_' + id, mapId: area, scene, x: anchor.x, y: anchor.y, z: anchor.z, length });
  const group = new Node(); const burden = Sh.registerHangingBurden({ id: 'b_' + id, mapId: area, scene, group, kind: 'launchTest', hanging: false, data: {} });
  assert(HR.attach(rope, burden), 'attached');
  let mode = null; const off = WorldEvents.on('rope:release', p => { mode = p.mode; });
  HR.applyStrike(rope, dirX, dirZ, speed);
  let ticks = 0; while (ticks++ < 1200 && (burden.rope || burden.flying || !mode)) Sh.tick(0.05);
  off(); HR.removeRope(rope); Sh.discardBurden(burden);
  return { mode, x: group.position.x, y: group.position.y, z: group.position.z };
}

// ---- parity: the predictor matches the real modules across ropes, directions, speeds and ground heights
let compared = 0, launches = 0, drops = 0, maxErr = 0;
for (const ground of [() => 0, (x, z) => (x > 14 ? 0.6 : 0), (x, z) => 0.2 * Math.sin(x * 0.7)]) {
  groundFn = ground;
  for (const length of [1.8, 2.4, 3.2]) for (const a of [0, 0.7, 2.3, -1.2]) for (const speed of [0.9, 2.5, 4, 5.5, 7.5, 9.5]) {
    const anchor = { x: 10, y: 4.2, z: 10 }, dirX = Math.cos(a), dirZ = Math.sin(a);
    const real = actual({ anchor, length, dirX, dirZ, speed, id: compared });
    const pred = RL.predict({ anchor, length, dirX, dirZ, speed, groundAt: ground });
    assert.equal(pred.mode, real.mode, `mode for L${length} a${a} v${speed}: predicted ${pred.mode}, real ${real.mode}`);
    const err = Math.hypot(pred.landing.x - real.x, pred.landing.z - real.z);
    maxErr = Math.max(maxErr, err);
    assert(err < 0.06, `landing for L${length} a${a} v${speed}: predicted (${pred.landing.x.toFixed(2)}, ${pred.landing.z.toFixed(2)}), real (${real.x.toFixed(2)}, ${real.z.toFixed(2)})`);
    assert(Math.abs(pred.landing.y - real.y) < 0.05, 'resting height matches');
    compared++; if (pred.mode === 'launch') launches++; else drops++;
  }
}
assert(compared >= 200 && launches > 40 && drops > 40, `exercised both regimes: ${compared} cases, ${launches} launches, ${drops} drops`);

// ---- behaviours a layout solver relies on
groundFn = () => 0;
const base = { anchor: { x: 0, y: 4, z: 0 }, length: 2.4, dirX: 1, dirZ: 0, groundAt: 0 };
const sw = RL.sweep(base, { steps: 12 });
assert(sw.every(p => p.landing), 'every strike lands');
for (let i = 1; i < sw.length; i++) assert(sw[i].landing.x >= sw[i - 1].landing.x - 1e-9, 'a harder strike never lands nearer');
assert(sw[0].mode === 'drop' && sw[sw.length - 1].mode === 'launch', 'the range runs from a drop to a launch');
assert(sw[0].landing.x < 1.2 && sw[sw.length - 1].landing.x > 6, 'a close hit stays within a few feet; a full lunge crosses the room');
assert(Math.abs(RL.fractionForSpeed(RL.strikeSpeedForFraction(0.37)) - 0.37) < 1e-12, 'fraction <-> speed round trips');
// skill window: aiming at a point in the middle of the range is forgiving; one beyond it is impossible
const mid = sw[6].landing;
const wide = RL.window(base, { x: mid.x, z: 0 }, 1.5), narrow = RL.window(base, { x: mid.x, z: 0 }, 0.1), impossible = RL.window(base, { x: 40, z: 0 }, 1.5);
assert(wide.width > narrow.width && narrow.width > 0, `a wider tolerance is a wider window: ${wide.width} vs ${narrow.width}`);
assert.equal(impossible.width, 0); assert.equal(impossible.range, null); assert(impossible.bestMiss > 20);
assert.equal(RL.predict({ ...base, speed: 5, maxSwingSeconds: 0.01 }).mode, null, 'no release within the time limit: no prediction, not a wrong one');
console.log('rope-launch: ok (' + compared + ' real-vs-predicted cases, max landing error ' + maxErr.toFixed(4) + ' tiles)');
