#!/usr/bin/env node
// Execute real Tzatzul spire/flight/nest logic without a browser or a DOM mock.
'use strict';
const assert = require('node:assert/strict');
const Spires = require('../docs/js/tzatzul-spires.js');
const Flight = require('../docs/js/tzatzul-flight.js');
const Nests = require('../docs/js/tzatzul-nest-interior.js');

const area = 'map_northern_cliffs';
const grid = Array.from({length:80},()=>Array.from({length:88},()=>({type:'grass',elevTier:0})));
const options = {area,blocked:()=>false,tileY:()=>0};
const first = Spires.plan(area,grid,options);
const second = Spires.plan(area,grid,options);
assert.deepEqual(first,second,'spire generation is stable for the map seed');
assert.ok(first.length>=3 && first.length<=4,'a normal wilderness map gets several spires');
for(const s of first){
  assert.equal(s.levels.length,3,'three stepped cliff layers');
  assert.ok(s.levels[0].width>s.levels[1].width && s.levels[1].width>s.levels[2].width,'upper plateau footprints taper');
  assert.ok(s.nest.y>s.levels[1].y && s.nest.y<s.levels[2].y,'cave sits halfway up the tallest incline');
  assert.ok(s.nest.caveMapId.startsWith('map_i_den_'+area+'_tzatzul-'),'compatible with native den-cave lookup');
}
const network = {area,balconies:[],routes:[]};
Spires.install(network,grid,options);
assert.equal(network.balconies.length,first.length*4,'all 3 tops and the cave lip register supported float-Y geometry');
assert.ok(network.balconies.every(s=>s.aerialOnly && s.footprint.length && !s.reward),'nest plateaus have no ordinary climbing reward');
assert.equal(Spires.install(network,grid,options).length,first.length,'repeated scene builders reuse the same spires');
assert.equal(network.balconies.length,first.length*4,'second scene build cannot duplicate elevated support slabs');
const all = [...first];
for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++)
  assert.ok(Math.hypot(all[i].x-all[j].x,all[i].z-all[j].z)>=15,'spires preserve travel clearance');

const wolf={label:'Gar-wolf',defaultSizeClass:'medium'};
const db={'gar-wolf':wolf,'gar-wolf-den-mother':{defaultSizeClass:'large'}};
assert.ok(Flight.registerSpecies({CREATURE_DB:db}));
assert.equal(db.tzatzul.flying,true);
assert.equal(db['tzatzul-hatchling'].defaultSizeClass,'small');
assert.deepEqual(wolf,{label:'Gar-wolf',defaultSizeClass:'medium'},'the original species definition is not mutated');
const predator={areaId:area,health:100,creatureKey:'tzatzul',_tzatzulFlight:true};
const animal={areaId:area,health:15,creatureKey:'gar-wolf',genotype:{sizeClass:'small'}};
const large={areaId:area,health:15,creatureKey:'gar-wolf-den-mother',genotype:{sizeClass:'large'}};
const bandit={areaId:area,health:15,isBandit:true};
const barbarian={areaId:area,health:15,isBarbarian:true};
Flight.initWildlife({CREATURE_DB:db,hostileObjects:new Set([animal,large,bandit,barbarian]),TILE:32,
  getCurrentArea:()=>area,_isZoneArea:()=>true,player:{x:100,y:100}});
assert.equal(Flight.eligiblePrey(animal,predator),true,'small wildlife is prey');
assert.equal(Flight.eligiblePrey(large,predator),false,'large wildlife is never picked up');
assert.equal(Flight.eligiblePrey(bandit,predator),true,'bandit humanoids are prey');
assert.equal(Flight.eligiblePrey(barbarian,predator),true,'barbarian humanoids are prey');
assert.equal(Flight.eligiblePrey({...animal,areaId:'map_other'},predator),false,'does not hunt outside its area');
assert.equal(Flight.eligiblePrey({...animal,_flyingCarriedBy:predator},predator),false,'cannot double-carry prey');
let sim={x:0,y:0,heading:0,altitude:5.6,cycleT:0,phase:'climb'};
const phases=new Set();
for(let i=0;i<800;i++){Flight.phaseStep(sim,.03,{x:200,y:190,altitude:10},32);phases.add(sim.phase)}
assert.ok(phases.has('climb')&&phases.has('dive')&&phases.has('glide'),'autonomous flight traverses flap, dive, glide');
assert.ok(Number.isFinite(sim.altitude)&&sim.altitude>0&&Number.isFinite(sim.x),'flight remains finite under long timesteps');
const stalled={x:1,y:2,heading:0,altitude:4,phase:'climb',cycleT:0};
Flight.phaseStep(stalled,Number.NaN,{x:3,y:4,altitude:9},32);
assert.deepEqual([stalled.x,stalled.y],[1,2],'invalid dt cannot displace the bird');

const nest=first[0].nest;
Nests.registerSpire(area,first[0]);
const floor=Array.from({length:20*20},(_,i)=>[i%20+3,Math.floor(i/20)+3]);
const data={id:nest.caveMapId,floor,exitCol:5,exitRow:5,exits:[{}],creatureSpawns:[{kind:'gar-wolf'}],denMotherKind:'gar-wolf'};
Nests.decorateMapData(nest.caveMapId,data);
assert.equal(data.denMotherKind,null,'native den mother is replaced by hatchlings');
assert.deepEqual(data.creatureSpawns,[],'native den wildlife cannot duplicate authored hatchlings');
assert.equal(data.exits[0].targetMap,area,'the cave exit returns to the original zone');
assert.ok(data.tzatzulNest.eggs.length>=2 && data.tzatzulNest.hatchlings.length>=2);
assert.ok(data.tzatzulNest.victimPile.length>=3,'roost contains actual piles of headless victims');
assert.deepEqual(data.tzatzulNest.lootPools,['crateJunk','treasureChest','puzzleCave'],'reserved third loot pool has no invented entries');
assert.ok(data.tzatzulNest.victimPile.some(body=>body.stack>0),'bodies are deliberately stacked');

let saved=0;
const granted=[];
globalThis.ShippingPanel={registerItemDefinitions:()=>true};
globalThis.CaveSiteSystem={persistAuxiliaryState:()=>saved++};
globalThis.LootRolling={
  rollLootPool:pool=>pool==='crateJunk'?{wood:2}:pool==='treasureChest'?{gold:250}:undefined,
  getLootPools:()=>({crateJunk:{},treasureChest:{}}),
};
Nests.initRewards({grantLoot:items=>{granted.push({...items});return Object.keys(items)}});
const eggId=data.tzatzulNest.eggs[0].id;
assert.equal(Nests.rewardEgg(nest.caveMapId,eggId),true);
assert.equal(Nests.rewardEgg(nest.caveMapId,eggId),false,'eggs are one-time collectible even after a repeated interaction');
assert.deepEqual(granted[0],{tzatzulEggs:1});
const victimId=data.tzatzulNest.victimPile[0].id;
assert.equal(Nests.lootVictim(nest.caveMapId,victimId),true);
assert.deepEqual(granted[1],{wood:2,gold:250});
assert.equal(Nests.lootVictim(nest.caveMapId,victimId),false,'a body cannot reroll its loot');
assert.equal(saved,2,'both claims notify the canonical world-save owner');
const persisted=Nests.serialize();
Nests.restore(persisted);
assert.deepEqual(Nests.serialize(),persisted,'nest loot state round trips with the cave save');
console.log('Tzatzul generation, flight, prey eligibility, cave contents, mixed loot and save smoke: PASS');
