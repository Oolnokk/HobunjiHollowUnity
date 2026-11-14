#!/usr/bin/env node
'use strict';
// Execute the shipped player-projectile hit branch: it has early returns before
// the enemy branch, which once left torch ignition calls permanently unreachable.
const assert = require('node:assert/strict');
const fs = require('node:fs'); // Reads the actual ranged runtime, not a rewritten fire handler.
const source = fs.readFileSync('docs/js/combat/ranged-weapons.js', 'utf8');
const from = source.indexOf('  function projectileHit(p, maxSegmentT = 1) {');
const to = source.indexOf('\n  // Projectile orientation begins', from);
assert(from >= 0 && to > from, 'shipped projectileHit function not found');
const shipped = source.slice(from, to);
let cover = null, contacts = [], impactCount = 0; // Records the actual player branch's forwarded fire limits.
const world = {
  DungeonFire: {contactProjectile(p,_a,_b,limit){if(p.dungeonFire&&p.team==='player')contacts.push(['dungeon',limit]);}},
  BanditCamps: {igniteTorchSegment(_area,_a,_b,limit){contacts.push(['tent',limit]);}},
  DevRandomRuinHitPuzzles: {contactAdventuringTorchSegment(_a,_b,limit){contacts.push(['v50',limit]);}},
  NearbyVolumeCollision: {segmentHit(){return cover;}},
};
const point = {set(x,y,z){return {x,y,z};}};
const ctx = {
  window:world, deps:{TILE:32,player:{}}, _projectileHitStart:point,_projectileHitEnd:point,
  AIM_EPSILON:1e-6, projectileCollisionRadiusWorld:()=>.12,
  projectileFalloffMultiplier:()=>1, nearestHostileHit:()=>null,
  nearestPlayerCompanionHit:()=>null, actorHitbox:()=>({}),
  segmentHitboxInterval:()=>null, playProjectileImpactSfx:()=>impactCount++,
};
const hit = new Function(...Object.keys(ctx),shipped+';return projectileHit;')(...Object.values(ctx));
const sample = {
  team:'player',itemKey:'torch',dungeonFire:true,areaId:'map_i_dev_random_ruin',
  prevX:0,x:32,prevY:0,y:0,prevWorldY:1,worldY:1,
  def:{damage:0,knockbackPxS:0,rangedType:'thrown'},knockbackMul:1,
};
assert.equal(hit(sample),null,'clear flight continues normally');
assert.deepEqual(contacts,[['dungeon',1],['tent',1],['v50',1]],'real player branch lights both world targets before returning');
contacts=[];
cover={t:.3};
assert.equal(hit(sample)?.kind,'cover','solid geometry remains authoritative');
assert.deepEqual(contacts,[['dungeon',.3],['tent',.3],['v50',.3]],'torch cannot light anything behind first cover hit');
assert.equal(impactCount,1,'cover impact audio still fires once');
contacts=[];cover=null;
hit({...sample,itemKey:'bow',dungeonFire:false});
assert.deepEqual(contacts,[],'non-torch projectiles cannot light torch-only hazards');
hit({...sample,dungeonFire:false});
assert.deepEqual(contacts,[],'an unlit torch cannot ignite anything');
hit({...sample,team:'enemy'});
assert.deepEqual(contacts,[],'enemy branch cannot light player-only torch targets');
console.log('ok thrown torch: player hit branch, cover cutoff, no false ignition from enemy/unlit projectiles');
