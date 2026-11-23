#!/usr/bin/env node
'use strict';
// The production flock owner must honor storms in BOTH ensureZone and its
// two-second proximity synchronizer, retaining nest furniture without spawning.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const area='map_southern_cloud_forest'; // Generated wild Pingdort habitat.
let storm=false; // Shared deterministic storm state, no new timer.
let playerX=90; // Distant player: initial scene builds an empty nest.
let spawnCount=0; // Tracks wild actor factory calls during storms.
const birds=new Set(); // Real shared hostile actor roster.
const shelf={id:'shelf1',x:5,z:5,y:3,base:{footprint:[{c:4,r:5}]},
  footprint:[{c:5,r:5}],reward:null}; // Exposed cap is next to its parent rock footprint, not embedded inside it.
const network={area,balconies:[shelf]}; // Same network identity throughout the weather transition.
const scene={}; // Stable active zone scene for cache reuse.
const windowObject={
  THREE:{},PingdortRegistration:{ZONES:[area]},
  TothalBlizzard:{isShelteringFor:()=>storm},
  CliffRouteNetwork:{forArea:()=>network,shelfContains:()=>true},
  DenNestSystem:{createExteriorNestFurniture:()=>({userData:{},parent:{remove(){}}})},
  PerchSupport:{point:()=>({}),attach:()=>true},
};
vm.runInNewContext(fs.readFileSync('docs/js/pingdort-flocks.js','utf8'),
  {window:windowObject,console},{filename:'pingdort-flocks.js'});
windowObject.PingdortFlocks.init({
  TILE:1,getCurrentArea:()=>area,zoneScenes:new Map([[area,{scene}]]),
  calendar:{year:1,month:'Longpour',day:3},
  player:{get x(){return playerX},y:5},
  hostileObjects:birds,
  makeCreatureEntity:(kind,x,y)=>{spawnCount++;return {
    id:'bird_'+spawnCount,creatureKey:kind,x,y,health:10,def:{modelWidth:.5},
    avatarRef:{group:{visible:spawnCount===1?false:true}},groundShadow:{visible:spawnCount!==1},
  };},
});
assert.equal(windowObject.PingdortFlocks.ensureZone(area),1,'nest furniture appears even with no wild birds nearby');
assert.equal(spawnCount,0);
playerX=5;storm=true;
assert.equal(windowObject.PingdortFlocks.ensureZone(area),1,'refresh existing nests while storm starts');
windowObject.PingdortFlocks.update(3);
assert.equal(spawnCount,0,'neither ensureZone nor proximity update may spawn outdoor wildlife in storm');
storm=false;
for(let frame=0;frame<25;frame++)windowObject.PingdortFlocks.update(.1); // The real update caps dt at 0.1 seconds; advance beyond the 2-second flock sync lease.
assert.equal(spawnCount,3,'three wild birds spawn normally on the first clear-weather population tick');
storm=true;windowObject.PingdortFlocks.update(3);
for(const bird of birds)assert.equal(bird.avatarRef.group.visible,false,'existing birds shelter without draw calls');
storm=false;windowObject.PingdortFlocks.update(3);
const groups=[...birds].map(b=>b.avatarRef.group.visible);
const shadows=[...birds].map(b=>b.groundShadow.visible);
assert.deepEqual(groups,[false,true,true],'pre-storm LOD visibility remains intact');
assert.deepEqual(shadows,[false,true,true],'pre-storm shadow visibility remains intact');
storm=true;playerX=90; // Walk out of streaming range while the storm is active.
for(let frame=0;frame<25;frame++)windowObject.PingdortFlocks.update(.1);
assert.equal(birds.size,0,'storm must continue unloading flocks beyond the normal distance budget');
assert.equal(spawnCount,3,'unloading birds must not replace them during the storm');
storm=false;playerX=5;
for(let frame=0;frame<25;frame++)windowObject.PingdortFlocks.update(.1);
assert.equal(spawnCount,6,'clear weather can repopulate the now-empty nearby nest normally');
console.log('Tothal Pingdort nest rendering, flock-spawn gating and LOD restore passed.');
