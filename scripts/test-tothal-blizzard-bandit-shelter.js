#!/usr/bin/env node
'use strict';
// Production bandit-camp lifecycle: new residents, draw-state restoration,
// equal-size replacement throttling, and forced map-regeneration cleanup.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const area='map_southern_cloud_forest'; // Exterior wilderness garrison for the main regression.
const otherArea='map_northern_cliffs'; // The player may finish the storm elsewhere without revisiting the original camp.
let activeArea=area; // Shared game area for the existing camp update clock.
let storm=1; // Tothal shelter flag toggled at the exact weather transition.
let clock=100; // Monotonic time for storm-time roster refresh, in milliseconds.
let scans=0; // Counts expensive hostile roster iterations.
let entityBuilds=0; // Counts the deferred starter guards created by the production bandit factory.
const actors=[]; // Mutated by the ordinary actor spawn/despawn simulation below.
const roster=new Proxy(actors,{get(target,key,receiver){
  if(key===Symbol.iterator){scans++;return target[Symbol.iterator].bind(target);}
  if(key==='add')return c=>{target.push(c);return roster;}; // Production hostileObjects is a Set; the fixture retains its scan-counting list.
  return Reflect.get(target,key,receiver);
}});
const w={TothalBlizzard:{isShelteringFor:()=>storm>0,currentState:()=>({storm})},
  performance:{now:()=>clock},AuthoredFurniture:{load:()=>new Promise(()=>{})},
  BanditCombat:{makeEntity:async(cfg,rank,tier,x,y,opts)=>({id:'starter_'+(++entityBuilds),
    banditCampInstanceId:opts.extra.banditCampInstanceId,areaId:area,x,y,health:10,state:'idle'})}};
vm.runInNewContext(fs.readFileSync('docs/js/bandit-camps.js','utf8'),
  {window:w,fetch:()=>new Promise(()=>{}),console}, {filename:'bandit-camps.js'});
w.BanditCamps.init({getCurrentArea:()=>activeArea,isZoneArea:()=>true,hostileObjects:roster,debugLog:()=>{},
  rnd:()=>.5,TILE:1});
const camp={instance:{id:'camp-1'},homeX:10,homeY:12,activeRanksById:new Map(),
  reserveByRank:{captain:0,grunt:0,lieutenant:0,flasker:0},props:[]};
w.BanditCamps.campInstances.set(area,[camp]);
function actor(id){
  return {id,banditCampInstanceId:'camp-1',areaId:area,health:10,x:3,y:4,state:'hunt',
    avatarRef:{group:{visible:true}},groundShadow:{visible:false},
    _banditToolHolder:{visible:false},_banditRangedToolHolder:{visible:true}};
}
const first=actor('one');actors.push(first);
async function update(){await w.BanditCamps._simpleHydra.update(.016)}
(async()=>{
  w.BanditCamps.updateRandomEncounters(60); // Must not access player movement or attempt a new road ambush during the storm.
  await update();
  assert.equal(first.areaId,'map_i_tothal_storm_tent_'+area);
  assert.equal(first.avatarRef.group.visible,false);
  const initialScans=scans;
  for(let i=0;i<100;i++){clock+=1;await update()}
  assert.equal(scans,initialScans,'stable storm roster does not trigger a per-frame scan');
  const late=actor('late');actors.push(late);clock+=10;await update();
  assert.equal(late.areaId,'map_i_tothal_storm_tent_'+area,'late bandits must also shelter');
  const replaced=actor('replacement');actors.splice(1,1,replaced);clock+=1;await update();
  assert.equal(replaced.areaId,area,'same-count replacement refresh remains throttled');
  clock+=2100;await update();
  assert.equal(replaced.areaId,'map_i_tothal_storm_tent_'+area,'equal-size replacements are picked up at the next bounded refresh');
  const elsewhere=actor('elsewhere');elsewhere.areaId=otherArea;actors.push(elsewhere);clock+=10;await update();
  assert.equal(elsewhere.areaId,otherArea,'camp identity alone must not pull an actor out of another zone');
  const moved=actor('moved');actors.push(moved);clock+=10;await update();
  assert(moved._tothalTentShelter);moved.areaId='map_i_real_cave';moved.x=42;moved.y=43;
  storm=0;clock+=20;await update();
  assert.equal(moved.areaId,'map_i_real_cave','cleanup never overwrites a legitimate relocation');
  assert.equal(moved.x,42);assert.equal(moved.y,43);assert.equal(moved._tothalTentShelter,undefined);
  assert.equal(first.areaId,area);assert.equal(first.avatarRef.group.visible,true);
  assert.equal(first.groundShadow.visible,false,'shadow keeps its own original visibility');
  assert.equal(first._banditToolHolder.visible,false,'unequipped melee tool stays hidden');
  assert.equal(first._banditRangedToolHolder.visible,true,'ranged weapon keeps its own original visibility');
  assert.equal(replaced.areaId,area);
  storm=1;clock+=40;await update();
  assert(first._tothalTentShelter,'sheltered a second storm');
  w.BanditCamps.forgetZoneState(area);
  assert.equal(first.areaId,area,'forced generation cannot strand a hidden fighter in a fake interior');
  assert.equal(first._tothalTentShelter,undefined);
  const newCamp={...camp,zoneId:area,instance:{id:'camp-after-storm'},gangIds:new Set(),
    activeRanksById:new Map(),reserveByRank:{captain:0,grunt:2,lieutenant:0,flasker:0},
    initialGuardsPending:2,initialGuardSpawnInFlight:false,initialGuardNextAtMs:0,
    reinforcementPending:false,reinforcementTimer:0}; // Same default fields as a newly staged production bandit camp. // Camp was generated during the previous storm and has two dormant initial guards.
  w.BanditCamps.campInstances.set(area,[newCamp]);
  await update();assert.equal(entityBuilds,0,'storm must block initial-guard spawns');
  storm=0;clock+=20;await update();
  assert.equal(entityBuilds,1,'first delayed exterior guard uses the original spawn factory');
  assert.equal(newCamp.initialGuardsPending,1);
  assert.equal(newCamp.activeRanksById.size,1,'new guards must survive the same tick\'s death reconciliation');
  assert.equal(newCamp.reinforcementPending,false,'initial guard recovery cannot queue a duplicate reinforcement');
  await update();assert.equal(entityBuilds,1,'second guard must not spawn in the same render frame');
  clock+=900;await update();
  assert.equal(entityBuilds,2,'second guard emerges on the staggered next tick');
  assert.equal(newCamp.initialGuardsPending,0);
  assert.equal(newCamp.activeRanksById.size,2,'both starters remain live and registered');
  assert.equal(newCamp.reinforcementPending,false);
  clock+=900;await update();assert.equal(entityBuilds,2,'resuming a camp never duplicates the original guards');
  const remote=actor('remote-storm-guard'); // Survives in the original wilderness while the player changes maps.
  remote.banditCampInstanceId=newCamp.instance.id;
  actors.push(remote);storm=1;clock+=20;
  await update();
  assert(remote._tothalTentShelter,'the live guard enters the camp tent before the player leaves');
  assert.equal(remote.areaId,'map_i_tothal_storm_tent_'+area);
  activeArea=otherArea;storm=0;clock+=20;
  await update();
  assert.equal(remote.areaId,area,'a distant sheltered guard returns to their real area without a visit');
  assert.equal(remote._tothalTentShelter,undefined,'the distant garrison releases its temporary interior marker');
  const afterRemoteClear=scans; // Subsequent ordinary updates must leave the hostile roster untouched.
  for(let i=0;i<60;i++)await update();
  assert.equal(scans,afterRemoteClear,'off-storm garrison cleanup must not create a recurring roster scan');
  console.log('Bandit storm shelter, late arrivals, visibility, regeneration and deferred startup guards passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
