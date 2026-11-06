#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../docs/js/persistent-ground-fire.js'),'utf8'); // Exercises the production fire lifetime and area-scoped damage logic.
let area='map_i_puzzle_cave_1'; // Mutable area verifies transition cleanup and prevents damage on cached maps.
let burnCount=0; // Counts ResourceSystem's actual status application calls for a creature inside the flame patch.
const target={x:5*64,y:7*64,health:90};
const window={THREE:null,ResourceSystem:{addAffliction(actor,id,amount){
  assert.equal(actor,target);
  assert.equal(id,'burningHealth');
  assert.equal(amount,5);
  burnCount++;
}}};
vm.runInNewContext(source,{window,Math,Number,Set,Map,console},{filename:'persistent-ground-fire.js'});
const fire=window.PersistentGroundFire; // Shared API used by Flame Shattercasks, Fire Flasks, and both stone sconces.
fire.init({TILE:64,getCurrentArea:()=>area,getActiveScene:()=>null,
  getSplashEntities:(mapId,x,y,radius)=>mapId===area&&Math.hypot(x-target.x,y-target.y)<=radius?[target]:[]});
assert.equal(fire.ignite({area,x:5,z:7,y:0,seconds:2,radius:1.1,source:'fireFlask'}),true);
assert.equal(fire.intersects(area,5,7),true);
assert.equal(fire.intersects('another_cave',5,7),false,'area isolation prevents cross-map sconce ignition');
assert.equal(fire.intersects(area,8,7),false,'sconces outside the patch radius do not ignite');
fire.update(.36);
assert.equal(burnCount,1,'ordinary world Burning Health is applied in periodic intervals');
fire.update(.36);
assert.equal(burnCount,2,'the fire continues to burn after the projectile has disappeared');
fire.update(3);
assert.equal(fire.debugSnapshot().count,0,'a delayed mobile frame expires the patch in real elapsed seconds');
assert.equal(burnCount,2,'an expired fire patch never applies fresh damage');

assert.equal(fire.ignite({area:'unloaded_map',x:5,z:7}),false,'an old-area projectile cannot ignite the current map');
assert.equal(fire.ignite({area,x:5,z:7,seconds:12,source:'flameShattercask'}),true);
const saved=fire.debugSnapshot().count;
assert.equal(saved,1);
area='map_i_other_cave';
fire.update(.05);
assert.equal(fire.debugSnapshot().count,0,'world transitions clear their previous area fire patches');
assert.equal(fire.intersects('map_i_puzzle_cave_1',5,7),false);

area='map_i_puzzle_cave_1';
for(let i=0;i<32;i++)assert.equal(fire.ignite({area,x:i*5,z:7,seconds:12}),true);
assert(fire.debugSnapshot().count<=14,'mobile fire zones obey a strict object cap');
fire.clear();
assert.equal(fire.debugSnapshot().count,0,'the explicit cleanup path removes all cached patches');
console.log('PASS Puzzle Cave persistent ground fire: damage, sconce proximity, area ownership, real-time expiry, and mobile cap');
