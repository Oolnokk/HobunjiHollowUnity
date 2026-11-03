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
  multiplyScalar(k) { this.x *= k; this.y *= k; this.z *= k; return this; }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  length() { return Math.sqrt(this.lengthSq()); }
  normalize() { return this.multiplyScalar(1 / (this.length() || 1)); }
  crossVectors(a, b) { return this.set(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
}
class Node {
  constructor() { this.children = []; this.position = new Vector3(); this.scale = new Vector3(1, 1, 1); this.rotation = new Vector3(); this.userData = {}; this.parent = null; this.isObject3D = true; }
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
const THREE = { Group: Node, Mesh, SkinnedMesh: Mesh, InstancedMesh: Mesh, Object3D: Node, Vector3, Raycaster, RingGeometry: Geometry,
  TetrahedronGeometry: Geometry, SphereGeometry: Geometry, CylinderGeometry: Geometry, DodecahedronGeometry: Geometry,
  MeshBasicMaterial: Material, MeshLambertMaterial: Material, DoubleSide: 2, AdditiveBlending: 3, TextureLoader: class { load() { return { dispose() {} }; } } };

const area = 'map_i_targetables_test';
const scene = new Node();
const tiles = Array.from({ length: 12 }, () => Array.from({ length: 12 }, () => ({ type: 'grass' })));
const player = { x: 3.5 * 64, y: 3.5 * 64, angle: 0, health: 100 };
const deps = { TILE: 64, player, inventory: {}, TileType: { GRASS: 'grass' }, getCurrentArea: () => area, getActiveScene: () => scene, worldSurfaceY: () => 0,
  hostileObjects: new Set(), getPlayerMeleeAimPitch: () => 0, clearVegetationInAttackCone: () => 0, damagePlayer() {}, showToast() {} };
const game = {
  console, THREE, performance, localStorage: { getItem: () => null, setItem() {} }, __hobunjiPlayerProfile: { worldId: 'regression' },
  Combat: { deps, init() {}, update() {}, beginStagedAction: o => o, spawnMeleeTrail() {}, meleeColliderVolume: () => null },
  GridTileAccessors: { getActiveScene: () => scene, getActiveGrid: () => tiles, getCurrentArea: () => area },
  AuthoredFurniture: { load: async () => null, buildGroup: () => null }, DevSpawner: { init() {} }, ResourceSystem: { spendFooting() {} },
  AudioSystem: { playWeaponHitSfx() {}, playObjectSfxKey() {} }, __farmLog() {},
};
game.window = game;
vm.createContext(game);
for (const f of ['js/world-action-input-claims.js', 'js/world-events.js', 'js/targetables.js', 'js/shattercasks.js']) vm.runInContext(read(f), game, { filename: f });

const { Targetables, WorldEvents, Shattercasks } = game;
assert(Targetables.debugSnapshot().sources.includes('shattercasks'), 'shattercasks registers itself as a targetable source');

function burden(id, kind, extra = {}) {
  const group = new Node(); group.position.set(5.5, 1, 4.5);
  return Shattercasks.registerHangingBurden({ id, mapId: area, scene, group, kind, hanging: extra.hanging !== false, data: {} });
}
const bomb = burden('bomb1', 'hronalWitchBomb'), cask = burden('cask1', 'shattercask', { hanging: false }), fruit = burden('fruit1', 'soursap', { hanging: false });
const ids = cap => Array.from(Targetables.query(area, cap), e => e.id).sort(); // Array.from: results from the vm realm have a different Array prototype, which deepEqual would reject.

assert.deepEqual(ids('burden'), ['bomb1', 'cask1', 'fruit1'], 'every live burden is a targetable');
assert.deepEqual(ids('explosive'), ['bomb1', 'cask1'], 'explosive is derived from the burden kind; soursap bursts but is not explosive');
assert.deepEqual(ids('hangable'), ['bomb1'], 'hangable follows the live hanging state');
assert.deepEqual(ids('lungeStop'), [], 'nothing stops a lunge by default: existing gameplay is unchanged');
assert.equal(Targetables.query('some_other_map', 'burden').length, 0, 'targetables are scoped to their map');

const entry = Targetables.query(area, 'burden').find(e => e.id === 'bomb1');
assert.equal(Targetables.query(area, 'burden').find(e => e.id === 'bomb1'), entry, 'entries are cached per burden, not rebuilt every query');
assert.equal(entry.owner, bomb); assert.equal(entry.hitbox(), null, 'no authored hitbox or mesh bounds in this sandbox: no hitbox, no hit');
assert.equal(entry.toActor().__targetable, entry);

bomb.hanging = false; assert.deepEqual(ids('hangable'), [], 'a released burden stops being hangable');
bomb.lungeStop = true; assert.deepEqual(ids('lungeStop'), ['bomb1'], 'a system opts a burden in by setting lungeStop');
bomb.carried = true; assert.deepEqual(ids('lungeStop'), [], 'a carried burden is not a target');
bomb.carried = false;
bomb.exploded = true; assert.deepEqual(ids('burden'), ['cask1', 'fruit1'], 'exploded burdens disappear from the registry');

// blasts: one choke point, one event
const events = [];
WorldEvents.on('blast', p => events.push(p));
Shattercasks.applyBlast(area, 5.5, 4.5, { radius: 2.5, y: 1.2, sourceId: 'bomb1', tag: 'fire' });
Shattercasks.applyBlast(area, 1, 2, {});
assert.equal(events.length, 2);
assert.deepEqual({ ...events[0] }, { scope: area, x: 5.5, z: 4.5, y: 1.2, radius: 2.5, tag: 'fire', sourceId: 'bomb1' });
assert.equal(events[1].tag, 'blunt', 'defaults fill in'); assert.equal(events[1].y, undefined); assert.equal(events[1].sourceId, null);
assert(events[1].radius > 0);
const scoped = []; WorldEvents.on('blast', p => scoped.push(p), { scope: 'elsewhere' });
Shattercasks.applyBlast(area, 1, 1, {}); assert.equal(scoped.length, 0, 'scoped listeners only hear their own map');
console.log('targetables-integration: ok');
