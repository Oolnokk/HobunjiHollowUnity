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
  addScaledVector(other, scalar) { this.x += other.x * scalar; this.y += other.y * scalar; this.z += other.z * scalar; return this; }
  lerp(other, t) { return this.set(this.x + (other.x - this.x)*t,this.y + (other.y - this.y)*t,this.z + (other.z - this.z)*t); }
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
  MathUtils: { degToRad: degrees => degrees * Math.PI / 180, lerp: (a,b,t) => a + (b-a)*t, clamp: (v,lo,hi) => Math.max(lo,Math.min(hi,v)) },
};
let now = 1000;
let area = 'interior';
let closedDoor = false;
let shotDoorClosed = false; // Authoritative door state for projectile and hit-preview regression cases.
let playerPitch = 0; // Controls vertical player aim during the hit-preview regression.
let terrainBlock = false;
let raisedTerrainY = null; // Enables raised-ground LOS regression without a visible stone wall.
let sightObjects = [];
const hostileObjects = [];
const window = {
  NearbyVolumeCollision: { segmentHit: () => null, segmentSightHit: () => null },
  InteriorDoorTiles: {
    blocksBox(_area, x, _z, _radius, worldY) {
      return (closedDoor && x > 1.02 && x < 1.08)
        || (shotDoorClosed && x > 1.3 && x < 1.7 && (worldY == null || (worldY >= 0 && worldY <= 2))); // Actual finite-height door.
    },
  },
};
const context = {
  window, THREE, performance: { now: () => now }, console,
};
const rangedSource = fs.readFileSync('docs/js/combat/ranged-weapons.js', 'utf8')
  .replace('  window.RangedWeapons = {', '  window.__testTerrainImpact = terrainImpactForStep;\n  window.RangedWeapons = {'); // Actual private projectile sweep made available to this isolated regression.
vm.runInNewContext(rangedSource, context);
window.RangedWeapons.init({
  TILE: 64,
  playerRadius: 20,
  player: { x: 64, y: 64 },
  hostileObjects,
  getCurrentArea: () => area,
  getSightOccluders: () => sightObjects,
  worldSurfaceY: x => raisedTerrainY != null && x / 64 > 1.4 && x / 64 < 1.6 ? raisedTerrainY : 0,
  canOccupyAt(x) { return !(terrainBlock && x / 64 > 1.4 && x / 64 < 1.6); },
  getEquippedRangedKey: () => 'crossbow',
  getPlayerAimAngle: () => 0,
  getPlayerAimPitch: () => playerPitch,
});

const actor = (x, y) => ({ x, y, health: 100, def: { modelWidth: 0.5, modelHeight: 1 } });
const observer = actor(64, 64);
const target = actor(192, 64);
assert.equal(window.RangedWeapons.hasLineOfSight(observer, target), true, 'clear open ground has sight');

// Ranged NPC engagement follows the projectile's full travel envelope, while
// per-enemy tuning may make that stand-ground radius shorter.
assert.equal(window.RangedWeapons.engagementRangePx('crossbow'), 9 * 64 * 1.6, 'crossbow engagement radius includes its projectile falloff tail');
const rangedActor = { def: { rangedWeaponKey: 'crossbow' } };
assert.equal(window.RangedWeapons.rangedAttackRadiusPx(rangedActor), 9 * 64 * 1.6, 'ranged NPC defaults to the weapon travel envelope');
rangedActor.def.rangedAttackRadiusPx = 400;
assert.equal(window.RangedWeapons.rangedAttackRadiusPx(rangedActor), 400, 'an NPC may author a shorter stand-ground firing radius');
rangedActor.def.rangedAttackRadiusPx = 2000;
assert.equal(window.RangedWeapons.rangedAttackRadiusPx(rangedActor), 9 * 64 * 1.6, 'an authored radius cannot exceed the weapon projectile travel distance');


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


const elevatedActor = (x, z, centerY) => { // A real avatar group reports its 3D center even when its feet are on another story.
  const a = actor(x, z);
  a.avatarRef = { group: {
    isObject3D: true,
    userData: { portraitModelWidth: 0.5, portraitModelHeight: 1, portraitVerticalPlacementRatio: 0.5 },
    updateWorldMatrix() {},
    getWorldPosition(out) { return out.set(x / 64, centerY, z / 64); },
    getWorldScale(out) { return out.set(1, 1, 1); },
  } };
  return a;
};
now += 100; sightObjects = []; terrainBlock = false; area = 'town';
const lowArcher = elevatedActor(64, 640, 0.5), highTarget = elevatedActor(192, 640, 4.5);
const highArcher = elevatedActor(64, 704, 4.5), lowTarget = elevatedActor(192, 704, 0.5);
assert.equal(window.RangedWeapons.hasLineOfSight(lowArcher, highTarget), true, 'unobstructed uphill sight');
assert.equal(window.RangedWeapons.hasLineOfSight(highArcher, lowTarget), true, 'unobstructed downhill sight');
lowArcher.def.rangedWeaponKey = 'crossbow'; highArcher.def.rangedWeaponKey = 'crossbow';
window.RangedWeapons.beginBanditAction(lowArcher, 'fire', highTarget);
window.RangedWeapons.beginBanditAction(highArcher, 'fire', lowTarget);
assert.ok(Math.abs(lowArcher._rangedAimPitch - Math.atan2(4, 2)) < 1e-5, 'ranger aims directly uphill at the 3D hitbox');
assert.ok(Math.abs(highArcher._rangedAimPitch - Math.atan2(-4, 2)) < 1e-5, 'ranger aims directly downhill at the 3D hitbox');

raisedTerrainY = 3.8; now += 100; // High enough to intersect the descending trajectory as well as the rising one.
assert.equal(window.RangedWeapons.hasLineOfSight(lowArcher, highTarget), false, 'raised ground blocks an upward sightline');
assert.equal(window.RangedWeapons.hasLineOfSight(highArcher, lowTarget), false, 'raised ground blocks a downward sightline');
raisedTerrainY = null; now += 100;
assert.equal(window.RangedWeapons.hasLineOfSight(lowArcher, highTarget), true, 'sight returns when intervening terrain is removed');

window.DynamicSurfaces = { sampleSupport: (_x,_z,range) => range.minY <= 2 && range.maxY >= 2 ? { y:2 } : null };
now += 100;
assert.equal(window.RangedWeapons.hasLineOfSight(lowArcher, highTarget), false, 'an intervening story floor blocks sight from below');
assert.equal(window.RangedWeapons.hasLineOfSight(highArcher, lowTarget), false, 'an intervening story floor blocks sight from above');
const risingShot = {prevX:64,prevY:768,prevWorldY:0.5,x:192,y:768,worldY:4.5,def:{projectileRadiusPx:3}};
const floorImpact = window.__testTerrainImpact(risingShot);
assert.equal(floorImpact?.kind, 'floor', 'live projectile sweep collides with the intermediate story floor');
assert.ok(floorImpact.t > .3 && floorImpact.t < .5, 'floor impact is detected at the correct sloped trajectory fraction');
delete window.DynamicSurfaces;

terrainBlock = true;
const fastShot = {prevX:64,prevY:832,prevWorldY:.6,x:192,y:832,worldY:.6,def:{projectileRadiusPx:3}};
const solidImpact = window.__testTerrainImpact(fastShot);
assert.equal(solidImpact?.kind, 'solid-tile', 'fast ranged shots still hit a narrow intervening obstacle');
assert.ok(solidImpact.t > .15 && solidImpact.t < .35, 'swept collision finds the obstruction before its far edge');
terrainBlock = false;
assert.equal(window.__testTerrainImpact(fastShot), null, 'the clear shot does not gain an invented collider');


/* Regression: actual player/enemy projectiles must collide with a closed
 * doorway, and the player's hit indicator must predict the same obstruction. */
shotDoorClosed = true;
const doorShot = {prevX:64,prevY:896,prevWorldY:.6,x:192,y:896,worldY:.6,def:{projectileRadiusPx:3}};
const closedDoorHit = window.__testTerrainImpact(doorShot);
assert.equal(closedDoorHit?.kind, 'door', 'actual projectiles stop at an opaque closed door');
assert.ok(closedDoorHit.t > .1 && closedDoorHit.t < .5, 'closed door impact is swept before the distant target');
doorShot.prevWorldY = 3; doorShot.worldY = 3;
assert.equal(window.__testTerrainImpact(doorShot), null, 'high projectiles clear the finite door');
shotDoorClosed = false; doorShot.prevWorldY = .6; doorShot.worldY = .6;
assert.equal(window.__testTerrainImpact(doorShot), null, 'opening a door allows real projectiles to travel through');

const previewTarget = elevatedActor(192,64,.5);
previewTarget.areaId = 'town'; hostileObjects.push(previewTarget);
now += 100;
assert.equal(window.RangedWeapons.wouldHitHostile(), true, 'clear horizontal player shot shows a valid hit');
shotDoorClosed = true; now += 100;
assert.equal(window.RangedWeapons.wouldHitHostile(), false, 'player hit preview rejects shots that strike a closed door');
shotDoorClosed = false;
window.DynamicSurfaces = { sampleSupport: (x, _z, range) =>
  x > 1.4 && x < 2.8 && range.minY <= .3 && range.maxY >= .3 ? {y:.3} : null }; // A solid narrow floor placed between player and hostile.
now += 100;
assert.equal(window.RangedWeapons.wouldHitHostile(), false, 'player hit preview rejects a crossing story-floor slab');
delete window.DynamicSurfaces;
now += 100;
assert.equal(window.RangedWeapons.wouldHitHostile(), true, 'a removed support floor restores the indicator');
hostileObjects.pop();

playerPitch = Math.PI * (75 / 180); // An extremely steep shot expends 3D range more quickly than horizontal range.
const steepTarget = elevatedActor(64 + 6 * 64,64,.3125 + 6 * Math.tan(playerPitch));
steepTarget.areaId = 'town'; hostileObjects.push(steepTarget);
now += 100;
assert.equal(window.RangedWeapons.wouldHitHostile(), false, 'a visibly aligned target beyond 3D projectile travel shows no false hit');
hostileObjects.pop();
playerPitch = 0;

console.log('enemy line of sight: all checks passed');
