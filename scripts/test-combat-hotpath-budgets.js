'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = file => fs.readFileSync(file, 'utf8');

// Run the shipped perception owner for a moving crowd at 60 Hz. Cheap
// eligibility checks remain live; expensive geometry decisions have leases.
let now = 1000; // Controlled wall time for the perception cadence fixture.
let queries = 0; // Counts actual geometry checks across 30 moving actors.
let visible = true; // Simulates a wall/door occluding all observers.
let cone = true; // Tests immediate facing eligibility independently of LOS leases.
const window = {
  Combat: { targetInsideAttackCone: () => cone },
  RangedWeapons: { hasLineOfSight: () => { queries++; return visible; } },
};
vm.runInNewContext(read('docs/js/combat/enemy-search-ai.js'), {
  window, performance: { now: () => now }, THREE: { MathUtils: { degToRad: x => x * Math.PI / 180 } },
});
const target = { x: 50, y: 0, health: 100, areaId: 'arena' }; // Shared crowd target.
const crowd = Array.from({ length: 30 }, () => ({ x: 0, y: 0, areaId: 'arena', facing: 0 })); // Independent leases, not a global throttle.
for (let frame = 0; frame < 60; frame++) {
  now = 1000 + frame * 1000 / 60;
  for (const c of crowd) {
    c.x += 0.1;
    assert.equal(window.EnemySearchAI.enemyCanSeeTarget(c, target, 100), true);
  }
}
assert(queries <= 330, `moving crowd performs at most 330 LOS queries instead of 1800: ${queries}`);
assert(window.EnemySearchAI.debugSnapshot().geometryReuses >= 1470);
const c = crowd[0]; // Used for immediate invalidation and stale-last-seen checks.
cone = false;
assert.equal(window.EnemySearchAI.enemyCanSeeTarget(c, target, 100), false, 'turning out of cone is immediate');
cone = true;
assert.equal(window.EnemySearchAI.enemyCanSeeTarget(c, { ...target, x: 500 }, 100), false, 'range exit is immediate');
visible = false;
assert.equal(window.EnemySearchAI.enemyCanSeeTarget(c, { ...target }, 100), false, 'new target bypasses lease');
now += 101;
assert.equal(window.EnemySearchAI.enemyCanSeeTarget(c, target, 100), false, 'door/wall occlusion is noticed within 100 ms');
visible = true;
c.areaId = 'other';
assert.equal(window.EnemySearchAI.enemyCanSeeTarget(c, target, 100), true, 'area change bypasses lease');
const seenX = c._enemyLastSeenX; // Cached visibility must never fabricate a new confirmed sighting.
target.x += 1;
assert.equal(window.EnemySearchAI.enemyCanSeeTarget(c, target, 100), true);
assert.equal(c._enemyLastSeenX, seenX, 'last-seen coordinates only advance on a geometry sample');
console.log(`crowd sight queries: ${queries} vs 1800 unleased`);

// Execute actorHitbox itself. Wall-clock expiry in a slow frame must not
// rebuild every enemy volume for each reticle/AI consumer.
const ranged = read('docs/js/combat/ranged-weapons.js'); // Shipped combat geometry authority.
const hitboxCode = ranged.slice(ranged.indexOf('  function positiveNumber('), ranged.indexOf('  function segmentHitboxInterval(')); // Includes the exact hitbox implementation.
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
}
let frame = 1; // Shared game-frame identity rather than a synthetic 16 ms window.
const geometryScope = {
  deps: { TILE: 64, getFrameSerial: () => frame, worldSurfaceY: () => 0 },
  performance: { now: () => now }, avatarNodeForActor: () => null,
  THREE: { Vector3, Box3: class { constructor(min, max) { Object.assign(this, { min, max }); } } },
  actorHitboxCache: new WeakMap(), ACTOR_HITBOX_CACHE_MS: 16, AIM_EPSILON: 1e-6, HITBOX_MIN_DEPTH_TILES: .18,
  actorHitboxBuilds: 0, actorHitboxReuses: 0,
};
vm.createContext(geometryScope);
vm.runInContext(hitboxCode, geometryScope);
const actor = { x: 64, y: 64, def: { modelWidth: 1, modelHeight: 2 } }; // Same portrait shape used for every consumer.
const first = geometryScope.actorHitbox(actor); // One build for this frame.
now += 50;
assert.equal(geometryScope.actorHitbox(actor), first, 'slow frame retains the same measured volume');
frame++;
assert.notEqual(geometryScope.actorHitbox(actor), first, 'new frame samples the live pose');
const beforeMove = geometryScope.actorHitbox(actor); // Movement inside a frame must invalidate the cache.
actor.x += 64;
assert.notEqual(geometryScope.actorHitbox(actor), beforeMove);
assert.equal(geometryScope.actorHitbox(actor).center.x, 2);
assert.equal(geometryScope.actorHitboxBuilds, 3);
geometryScope.deps.getFrameSerial = undefined;
now += 50;
const fallback = geometryScope.actorHitbox(actor); // Editors without a frame clock retain the old short time lease.
now += 17;
assert.notEqual(geometryScope.actorHitbox(actor), fallback);
geometryScope.deps.getFrameSerial = () => frame;
const poseNode = { position: { x: 2, y: 1, z: 1 }, scale: { x: 1, y: 1, z: 1 }, userData: {},
  getWorldPosition(out) { return out.set(this.position.x, this.position.y, this.position.z); },
  getWorldScale(out) { return out.set(this.scale.x, this.scale.y, this.scale.z); } }; // Live height and scale may change after the AI queried the hitbox.
geometryScope.avatarNodeForActor = () => poseNode;
const grounded = geometryScope.actorHitbox(actor); // Used to prove pose invalidation without advancing the frame or X/Z.
poseNode.position.y = 3;
assert.notEqual(geometryScope.actorHitbox(actor), grounded);
assert.equal(geometryScope.actorHitbox(actor).center.y, 3, 'jump/climb pose is live inside the same game frame');
poseNode.scale.y = 2;
assert.equal(geometryScope.actorHitbox(actor).height, 4, 'same-frame rig scaling invalidates the volume');
console.log('combat hotpath budgets passed');
