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
const window = {
  NearbyVolumeCollision: { segmentHit: () => null },
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
  hostileObjects: [],
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

area = 'town';
terrainBlock = false;
const areaObserver = actor(64, 384);
const areaTarget = actor(192, 384);
assert.equal(window.RangedWeapons.hasLineOfSight(areaObserver, areaTarget), true, 'area changes do not reuse a previous area's cached visibility result');

console.log('enemy line of sight: all checks passed');
