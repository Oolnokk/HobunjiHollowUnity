'use strict';

// Executes the shipped RangedWeapons.hasLineOfSight path with controlled scene
// geometry, terrain and door blockers. This verifies runtime behavior rather
// than only checking that source snippets exist.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  subVectors(a, b) { return this.set(a.x - b.x, a.y - b.y, a.z - b.z); }
  length() { return Math.hypot(this.x, this.y, this.z); }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() { const n = this.length() || 1; return this.set(this.x / n, this.y / n, this.z / n); }
  multiplyScalar(value) { this.x *= value; this.y *= value; this.z *= value; return this; }
}
class Quaternion { setFromAxisAngle() { return this; } }
class Matrix4 {}
class Box3 { constructor(min, max) { this.min = min; this.max = max; } }
class Raycaster {
  set(origin, direction) { this.origin = origin.clone(); this.direction = direction.clone(); }
  intersectObjects(objects, recursive, hits) {
    for (const object of objects || []) {
      if (object?.blocksSight && object.visible !== false) hits.push({ object, distance: 1 });
    }
    return hits;
  }
}
const THREE = {
  Vector3, Quaternion, Matrix4, Box3, Raycaster,
  MathUtils: { degToRad: degrees => degrees * Math.PI / 180 },
};
let now = 1000;
let area = 'interior';
let closedDoor = false;
let terrainBlock = false;
let sightObjects = [];
const hostileObjects = [];
const window = {
  NearbyVolumeCollision: { segmentHit: () => null, segmentSightHit: () => null },
  InteriorDoorTiles: {
    blocksBox(_area, x) { return closedDoor && x > 1.02 && x < 1.08; },
  },
};
const context = {
  window, THREE, performance: { now: () => now }, console,
};
vm.runInNewContext(fs.readFileSync('docs/js/combat/ranged-weapons.js', 'utf8'), context);
window.RangedWeapons.init({
  TILE: 64,
  playerRadius: 20,
  player: { x: 64, y: 64 },
  hostileObjects,
  getCurrentArea: () => area,
  getSightOccluders: () => sightObjects,
  worldSurfaceY: () => 0,
  canOccupyAt(x) { return !(terrainBlock && x / 64 > 1.4 && x / 64 < 1.6); },
});

const actor = (x, y) => ({ x, y, health: 100, def: { modelWidth: 0.5, modelHeight: 1 } });
const observer = actor(64, 64);
const target = actor(192, 64);
assert.equal(window.RangedWeapons.hasLineOfSight(observer, target), true, 'clear open ground has sight');

sightObjects = [{ name: 'stone-wall', blocksSight: true, visible: true }];
const wallObserver = actor(64, 128);
const wallTarget = actor(192, 128);
assert.equal(window.RangedWeapons.hasLineOfSight(wallObserver, wallTarget), false, 'an opaque wall mesh blocks NPC sight');
sightObjects[0].visible = false;
const hiddenObserver = actor(64, 192);
const hiddenTarget = actor(192, 192);
assert.equal(window.RangedWeapons.hasLineOfSight(hiddenObserver, hiddenTarget), true, 'invisible scene geometry does not block sight');

sightObjects = [];
closedDoor = true;
const doorObserver = actor(64, 256);
const doorTarget = actor(70, 256); // Less than one quarter tile apart: the midpoint still has to be sampled.
assert.equal(window.RangedWeapons.hasLineOfSight(doorObserver, doorTarget), false, 'a nearby closed interior door blocks sight even at short range');

closedDoor = false;
terrainBlock = true;
const terrainObserver = actor(64, 320);
const terrainTarget = actor(192, 320);
assert.equal(window.RangedWeapons.hasLineOfSight(terrainObserver, terrainTarget), false, 'solid terrain samples block sight');

// A living hostile between two actors also blocks sight; undefined ids must not cause every id-less ally to be skipped.
sightObjects = [];
const allyObserver = actor(64, 448);
const allyTarget = actor(192, 448);
const ally = actor(128, 448);
ally.id = 'ally';
hostileObjects.push(ally);
assert.equal(window.RangedWeapons.hasLineOfSight(allyObserver, allyTarget), false, 'a living hostile body blocks sight to actors behind it');
hostileObjects.length = 0;

terrainBlock = false;
area = 'interior';
sightObjects = [{ name: 'area-wall', blocksSight: true, visible: true }];
const areaObserver = actor(64, 384);
const areaTarget = actor(192, 384);
assert.equal(window.RangedWeapons.hasLineOfSight(areaObserver, areaTarget), false, 'current-area wall blocks sight');
area = 'town';
sightObjects = [];
assert.equal(window.RangedWeapons.hasLineOfSight(areaObserver, areaTarget), true, 'area changes do not reuse a previous area\'s cached visibility result');

// The semantic cover index must remain available to AI while projectile collision is disabled and no combat is active.
const coverScene = { children: [] };
const semanticCover = {
  name: 'procedural_furniture_table',
  userData: { projectileCoverHeightTiles: 1, projectileCoverRadiusTiles: 0.45 },
  position: { x: 1, y: 0, z: 1 },
  scale: { x: 1, y: 1, z: 1 },
  visible: true,
  parent: coverScene,
};
coverScene.children.push(semanticCover);
const coverWindow = {};
vm.runInNewContext(fs.readFileSync('docs/js/nearby-volume-collision.js', 'utf8'), { window: coverWindow, performance: { now: () => now }, console });
coverWindow.NearbyVolumeCollision.init({
  getActiveScene: () => coverScene,
  getCurrentArea: () => 'interior',
  isCombatActive: () => false,
  player: { x: 0, y: 0 },
  worldSurfaceY: () => 0,
  options: { enabled: false, projectiles: false },
});
const coverStart = { x: 0, y: 0.5, z: 1 };
const coverEnd = { x: 2, y: 0.5, z: 1 };
assert.equal(coverWindow.NearbyVolumeCollision.segmentHit(coverStart, coverEnd), null, 'ordinary projectile collision remains disabled outside combat');
assert.ok(coverWindow.NearbyVolumeCollision.segmentSightHit(coverStart, coverEnd), 'AI sight still detects semantic furniture cover outside combat and with projectile collision disabled');

// Vertical movement at unchanged X/Z invalidates the sight cache (e.g. climbing onto a branch).
area = 'town';
sightObjects = [];
const heightObserver = actor(64, 512);
const heightTarget = actor(192, 512);
assert.equal(window.RangedWeapons.hasLineOfSight(heightObserver, heightTarget), true, 'initial elevated-target sight is clear');
sightObjects = [{ name: 'height-wall', blocksSight: true, visible: true }];
heightTarget.def.modelHeight = 2;
now += 20; // Also expires the independent 16 ms actor-hitbox cache.
assert.equal(window.RangedWeapons.hasLineOfSight(heightObserver, heightTarget), false, 'vertical actor movement forces a fresh wall intersection test');

console.log('enemy line of sight: all checks passed');
