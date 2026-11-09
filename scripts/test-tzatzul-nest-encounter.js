'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
// Uses the actual nest module and actual shared knockback collision module.
const plan = require('../docs/config/locales/locale_tzatzul_nest_map_northern_cliffs_0.json').cavern.features.tzatzulNest;
const id = 'map_i_den_tzatzul_map_northern_cliffs_0'; // Matches the authoritative indexed locale map.
const actors = new Set(); // Shared wildlife hostile actor collection.
const calls = { dives:0, returns:0 }; // Measures actual encounter delegation to the flight owner.
const player = { health:1000, x:13.5*64, y:13.5*64 };
const W = {
  PerchSupport:{
    point:(id,x,y,worldY)=>({id,x,y,worldY,dimension:0}),
    attach(actor,p){ if(!(actor.health>0))return false;actor.onPerch=p;actor.branchSurfaceY=p.worldY;return true; },
    register(){return true;}
  },
  TzatzulNestInterior:{
    isNestMap: map=>map===id,
    getArena: ()=>plan, getFloorY: ()=>0, releaseInactive(){},
    ensurePerches: ()=>plan.wallPerches.map(p=>({
      id:id+':'+p.id,x:(p.col+.5)*64,y:(p.row+.5)*64,worldY:p.height,dimension:0
    }))
  },
  TzatzulRegistration:{
    identityFor:(area,slot,parent)=>parent||{id:area+':'+slot,tintHex:'#bb7788'}
  },
  TzatzulFlightRuntime:{
    beginNestDive(actor,target){
      calls.dives++;actor._tzFlight.phase='swoop';actor._tzFlight.target=target;return true;
    },
    advanceNestFlight(actor){
      calls.returns++;actor._tzFlight.phase='perched';
    }
  },
  Combat:{ deps:{ damageCreature(a,n){a.health-=n;} } },
  ResourceSystem:{
    spendFooting(actor,n){actor.footing=(actor.footing||100)-n;return n;},
    addAffliction(actor,id,n){(actor.afflictions||={})[id]=n;return n;},
    enforceCaps(){}
  },
  __farmLog(){}
};
const ctx={window:W,Math,Date,Set,Map,console};
vm.runInNewContext(fs.readFileSync('docs/js/combat/knockback-collision-impact.js','utf8'),ctx);
vm.runInNewContext(fs.readFileSync('docs/js/tzatzul-nest-encounter.js','utf8'),ctx);
const caveScene = { add(){}, remove(){} }; // Authoritative interior scene for all nest actors.
const deps = {
  TILE:64,player,hostileObjects:actors,getCurrentArea:()=>id,
  buildingScenes:new Map([[id,{scene:caveScene,grid:[],cols:27,rows:27}]]),
  makeCreatureEntity:(kind,x,y,opts)=>({
    creatureKey:kind,x,y,areaId:id,health:120,maxHealth:120,
    def:{attackDamage:24},...opts
  })
};
W.TzatzulNestEncounter.init(deps);
const room = W.TzatzulNestEncounter.ensure(id);
assert(room,'actual authored cave must spawn a nest encounter');
assert.equal(actors.size,3,'one mother plus two living hatchling adds');
assert([...actors].every(a=>a.scene===caveScene&&a.areaId===id),'mother and clutch spawn in the loaded cave scene');
assert.equal(room.mother.maxHealth,420,'mother has miniboss Health');
assert(W.TzatzulNestEncounter.owns(room.mother),'mother owns flight rather than ground movement');
assert(room.hatchlings.every(child=>child.tzatzulIdentity.tintHex===room.mother.tzatzulIdentity.tintHex),
  'hatchlings inherit mother color');
assert.strictEqual(W.TzatzulNestEncounter.ensure(id),room,'cave re-entry cannot duplicate a mother');
for(let i=0;i<20&&calls.dives===0;i++)W.TzatzulNestEncounter.update(.1);
assert.equal(calls.dives,1,'mother starts one directed headfirst dive');
assert.equal(room.mother._tzFlight.roost.id,room.supports[4].id,'the far wall is the next perch');
W.TzatzulNestEncounter.update(.1);
assert(calls.returns>0,'flight advance belongs to the shared body dive runtime');
const mother=room.mother;
mother._tzFlight.phase='swoop';
mother.branchT=.7;
mother.x=13.5*64;mother.y=6.5*64;mother.branchSurfaceY=.8;
const from={x:5.5*64,y:8.5*64,worldY:3};
const to={x:13.5*64,y:13.5*64,worldY:.5};
const before=mother.health;
const impact=W.TzatzulNestEncounter.resolveTerrainImpact(mother,
  {x:13.2,y:1,z:6.4},{x:13.5,y:.9,z:6.5},
  {from,to,half:{y:.5}});
assert(impact,'body should hit a real authored stone cluster');
assert(mother.health<before,'unused committed dive travels convert to collision Health loss');
assert(mother.afflictions?.bleedingHealth>0,'stone spikes apply sharp resource afflictions');
assert.equal(W.TzatzulNestEncounter.debugSnapshot().spikeHits,1);
mother.health=0;
W.TzatzulNestEncounter.update(.1);
assert.equal(W.TzatzulNestEncounter.debugSnapshot().completed,1,'dead mother stays cleared for this session');
assert.strictEqual(W.TzatzulNestEncounter.ensure(id),room,'death does not immediately respawn');
console.log('Tzatzul cave mother, real hatchlings, opposite perches, sharp-body impact and boss persistence PASS');
