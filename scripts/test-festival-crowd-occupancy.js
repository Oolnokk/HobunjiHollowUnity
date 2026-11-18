#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Checks real festival scheduler decisions.
const fs = require('node:fs'); // Reads the shipped implementation instead of a simulation.
const code = fs.readFileSync('docs/js/festival-system.js','utf8'); // Source of the production occupancy algorithm.
const start = code.indexOf('  function npcTarget(rec) {'); // Start of the actual NPC destination provider.
const end = code.indexOf('  function cancelDance()',start); // End of that provider.
assert(start >= 0 && end > start,'festival NPC target provider remains extractable');
const build = new Function('deps','festival','festivalHours','HOME_IDS','pendingDance','window','layout','residents','isRomanceable','eventKey','day','gatheringAssignments','stageDuty','sharedFeast',code.slice(start,end)+'\nreturn npcTarget;'); // Isolates production decision logic from WebGL.
const self = {id:'main',homeId:'town'}; // NPC whose festival destination is being chosen.
let walkers=[], stations=[],reads=0; // Dynamic crowd, stations and number of roster fetches in each decision.
const assignments = new Map(); // Current-festival destination reservations.
const deps = {getWalkers(){reads++;return walkers;},isFestivalSuspended(){return false;},canStandAt(){return true;}}; // All candidate tiles are walkable.
const win = {CalendarSystem:{getHour(){return 17;}},FestivalLocaleActivities:{targetFor(){return null;}},
  FurnitureTableSystem:{isSeatTaken(){return false;},setSeatTarget(){}},
  NpcScheduling:{resolveNpcStationTarget(id){const s=stations.find(v=>v.id===id);return s?{area:'town',stationId:id,c:s.col,r:s.row,pose:'stand'}:null;}}}; // Existing scheduler dependencies used by target selection.
const target = build(deps,()=>({id:'tzizkhanash',name:'Tzizkhanash'}),()=>true,new Set(['town']),null,win,()=>({npcStations:stations}),()=>[self],()=>false,()=>'1154:tzizkhanash',()=>27,assignments,()=>false,()=>false); // Real Tzizkhanash selection function.
const make = (id,x,z,stationId,area='town')=>({rec:{id},area,root:{position:{x,z}},currentScheduleTarget:stationId?{stationId}:null}); // Authentic walker fields.
walkers=[make('main',20.5,20.5),make('other',21.5,20.5,'a')];
stations=[{id:'a',festivalRole:'guest',col:22,row:20},{id:'b',festivalRole:'guest',col:23,row:20}];
reads=0;assert.equal(target(self).stationId,'b','another walker occupies station a');assert.equal(reads,1,'one roster snapshot per station selection');
walkers=[make('main',20.5,20.5)];
assignments.set('another',{scope:'1154:tzizkhanash:27:1',stationId:'a'});
reads=0;assert.equal(target(self).stationId,'b','festival reservation blocks station a');assert.equal(reads,1);
assignments.clear();stations=[];
function brute(){for(let radius=0;radius<=4;radius++)for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++){
  if(Math.max(Math.abs(dx),Math.abs(dz))!==radius)continue;
  const c=20+dx,r=20+dz;
  if(walkers.some(w=>w.rec.id!=='main'&&w.area==='town'&&Math.hypot(w.root.position.x-c-.5,w.root.position.z-r-.5)<.6))continue;
  return {c,r};
}return null;} // Previous per-tile exhaustive occupancy predicate and spiral search.
let seed=1947; // Repeatable crowd placement across runs.
function random(){seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;}
for(let t=0;t<300;t++){
  walkers=[make('main',20.5,20.5)];
  for(let i=0;i<60;i++)walkers.push(make('other'+i,19.5+(random()-.5)*5.5,19.5+(random()-.5)*5.5,null,i%7?'town':'indoors'));
  reads=0;
  const actual=target(self),expected=brute(); // Indexed grid and exhaustive scan must select the same tile.
  assert.deepEqual([actual?.c,actual?.r],[expected?.c,expected?.r],'standing placement trial '+t);
  assert.equal(reads,1,'one roster scan for trial '+t);
}
console.log('Festival crowd occupancy: station and reservation parity plus 300 dense-crowd placements passed.');


// Run the same production provider against the newer Gorkunash/Five Blossoms paths.
const feastTarget=id=>build(deps,()=>({id,name:id}),()=>true,new Set(['town']),null,win,
  ()=>({npcStations:stations}),()=>[self],()=>false,()=>('1154:'+id),
  ()=>27,assignments,()=>false,()=>true); // Modern shared-feast configuration.
const clear=()=>{assignments.clear();stations=[];walkers=[make('main',20.5,20.5)];reads=0;
  delete win.NpcSharedMeals;}; // Test fixture reset between schedule decisions.
const diningStation=(id,col,pose='stand')=>({id,festivalRole:'guest',festivalLocaleKind:'dining',col,row:20,pose}); // Authored dining station.
const originalResolve=win.NpcScheduling.resolveNpcStationTarget;
win.NpcScheduling.resolveNpcStationTarget=id=>{const station=stations.find(s=>s.id===id);
  return station?{area:'town',stationId:id,c:station.col,r:station.row,pose:station.pose||'stand'}:null;}; // Honor sitting pose in live-occupancy tests.
clear();
const ritualTarget={area:'town',c:3,r:3,pose:'stand'};
win.FestivalLocaleActivities.targetFor=()=>ritualTarget;
assert.equal(target(self),ritualTarget,'cached Tzizkhanash ritual remains authoritative');
assert.equal(reads,0,'cached ritual needs no roster scan');
win.FestivalLocaleActivities.targetFor=()=>null;
for(const id of ['gorkunash','five_blossoms']){
  clear();const meal={area:'town',c:4,r:4,pose:'sit'};
  win.NpcSharedMeals={targetFor(){return meal;}};
  assert.equal(feastTarget(id)(self),meal,id+' keeps the shared meal target');
  assert.equal(reads,0,id+' cached meals do not scan crowd');
}
for(const id of ['tzizkhanash','gorkunash','five_blossoms']){
  const decide=id==='tzizkhanash'?target:feastTarget(id);
  const first=id==='tzizkhanash'?'a':'b',second=first==='a'?'b':'a'; // Preserve each festival's authored choice order.
  clear();stations=[diningStation('a',22),diningStation('b',23)];
  walkers=[make('main',20.5,20.5,first),make('other',21.5,20.5,first)];
  assert.equal(decide(self).stationId,second,id+' ignores occupied station');
  assert.equal(reads,1,id+' station candidates read roster once');
  clear();stations=[diningStation(first,22)];walkers=[make('main',20.5,20.5,first)];
  assert.equal(decide(self).stationId,first,id+' ignores its own assigned station');
  assert.equal(reads,1,id+' self-occupancy reads roster once');
  clear();stations=[diningStation('a',22),diningStation('b',23)];
  assignments.set('other',{scope:'1154:'+id+':27:1',stationId:first});
  assert.equal(decide(self).stationId,second,id+' honors current shift reservation');
  assert.equal(reads,1,id+' reserved station reads roster once');
  clear();stations=[diningStation('a',22),diningStation('b',23)];
  stations.find(s=>s.id===first).pose='sit';
  const previousSeat=win.FurnitureTableSystem.isSeatTaken;
  win.FurnitureTableSystem.isSeatTaken=(area,s)=>s.stationId===first;
  assert.equal(decide(self).stationId,second,id+' checks live chair occupancy');
  assert.equal(reads,1,id+' chair occupancy reads roster once');
  win.FurnitureTableSystem.isSeatTaken=previousSeat;
}
clear();stations=[diningStation('a',22)];
let positionReads=0; // Test that station selection does not build the expensive fallback grid.
const observer=make('other',55.5,55.5);
Object.defineProperty(observer.root.position,'x',{get(){positionReads++;return 55.5;}});
walkers=[make('main',20.5,20.5),observer];
assert.equal(target(self).stationId,'a','available station needs no standing fallback');
assert.equal(positionReads,0,'normal station decision never reads spatial fallback coordinates');
assert.equal(reads,1,'normal station uses a single roster snapshot');
let nextSeed=8917; // Repeatable mixed indoor/outdoor festival crowds.
function nextRandom(){nextSeed=(nextSeed*1664525+1013904223)>>>0;return nextSeed/4294967296;}
for(const id of ['gorkunash','five_blossoms']){
  const decide=feastTarget(id);
  for(let trial=0;trial<150;trial++){
    clear();walkers=[make('main',20.5,20.5)];
    for(let i=0;i<60;i++)walkers.push(make('other'+i,19.5+(nextRandom()-.5)*5.5,19.5+(nextRandom()-.5)*5.5,null,i%7?'town':'indoors'));
    const expected=brute(),actual=decide(self); // Original exhaustive reference, not copied index.
    assert.deepEqual([actual.c,actual.r],[expected.c,expected.r],id+' fallback parity trial '+trial);
    assert.equal(reads,1,id+' uses one roster snapshot on fallback '+trial);
  }
}
win.NpcScheduling.resolveNpcStationTarget=originalResolve;
console.log('Modern shared-feast paths: cached meals, chair/reservation parity, lazy standing grid and 300 extra crowded placements passed.');
