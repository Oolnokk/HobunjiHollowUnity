#!/usr/bin/env node
'use strict';
// 200 residents must share one roster index rather than each scanning every walker.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/npc-scheduling.js','utf8');
const wildlife = fs.readFileSync('docs/js/wildlife-spawn.js','utf8');
assert.match(wildlife,/if \(!storm && !tothalWildlifeShelterZones\.has\(zoneId\)\) return false;/,'wildlife inactive scan must be gated');
assert.match(wildlife,/if \(!blizzardShelter\) \{\s*ensureCurrentZoneDenPacks\(\);\s*ensureCurrentZoneRoamingHerds\(\);\s*ensureCurrentZoneNestTrees\(\);/,'new outdoor wildlife must not spawn after a storm shelter pass');
let storm=.7; // Synthetic shift-storm intensity for the full NPC scheduling pass.
let indexedReads=0; // Counts numeric array reads to catch quadratic walker searches.
const walkers=Array.from({length:200},(_,i)=>({rec:{id:'npc_'+i},area:'farm',
  root:{position:{x:1+i*.05,z:2}}})); // Resolved outdoor residents, not duplicated per target.
const roster=new Proxy(walkers,{get(target,key,receiver){
  if(typeof key==='string' && /^\d+$/.test(key)) indexedReads++;
  return Reflect.get(target,key,receiver);
}}); // Counts scans while preserving real array iteration semantics.
const link={toArea:'map_i_farmhouse',exit:{c:4,r:5},spawn:{c:1,r:1}}; // One reusable authored indoor doorway.
const windowObject={
  TothalBlizzard:{currentState:()=>({storm}),wilderness:()=>false},
  WaterSystem:{isTownFloodEmergency:()=>false},
  NpcPathfinding:{areaLinksFrom:area=>area==='farm'?[link]:[],findNpcAreaLink:()=>null},
  NpcActivityPlanner:{resolveNpcTarget:()=>({area:'farm',c:4,r:5,activity:'errand'})},
  SCRATCHBONES_CONFIG:{game:{movement:{npc:{}}}},
};
vm.runInNewContext(source,{window:windowObject,performance:{now:()=>1000},console},{filename:'npc-scheduling.js'});
windowObject.NpcScheduling.init({npcWalkers:roster,calendar:{day:28,time01:.5},
  normalizeNpcArea:a=>a||'farm',isBuildingArea:a=>String(a).startsWith('map_i_'),
  getCurrentArea:()=> 'farm',buildingScenes:new Map()});
for(const w of walkers){
  const target=windowObject.NpcScheduling.resolveNpcScheduleTarget(w.rec);
  assert.equal(target.area,'map_i_farmhouse','storm redirects residents to the existing indoor door');
}
assert(indexedReads<800,'200 residents must not perform 20,000+ nested array reads');
const before=indexedReads; // Confirms repeated 6Hz schedule decisions reuse the same index.
for(const w of walkers) windowObject.NpcScheduling.resolveNpcScheduleTarget(w.rec);
assert(indexedReads-before<200,'repeat decisions must not rescan the walker roster');
const snapshot=windowObject.__farmDebugTools.tothalShelterSnapshot();
assert.equal(snapshot.walkerIndexEntries,200);
assert.equal(snapshot.walkerIndexBuilds,1);
storm=0;
assert.equal(windowObject.NpcScheduling.resolveNpcScheduleTarget(walkers[0].rec).tothalBlizzardShelter,undefined,'ordinary target resumes');
console.log('Tothal 200-NPC schedule/actor scan performance regression passed.');
