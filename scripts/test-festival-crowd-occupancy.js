#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Checks real festival scheduler decisions.
const fs = require('node:fs'); // Reads the shipped implementation instead of a simulation.
const code = fs.readFileSync('docs/js/festival-system.js','utf8'); // Source of the production occupancy algorithm.
const start = code.indexOf('  function npcTarget(rec) {'); // Start of the actual NPC destination provider.
const end = code.indexOf('  function cancelDance()',start); // End of that provider.
assert(start >= 0 && end > start,'festival NPC target provider remains extractable');
const build = new Function('deps','festival','festivalHours','HOME_IDS','pendingDance','window','layout','residents','isRomanceable','eventKey','day','gatheringAssignments','stageDuty',code.slice(start,end)+'\nreturn npcTarget;'); // Isolates production decision logic from WebGL.
const self = {id:'main',homeId:'town'}; // NPC whose festival destination is being chosen.
let walkers=[], stations=[],reads=0; // Dynamic crowd, stations and number of roster fetches in each decision.
const assignments = new Map(); // Current-festival destination reservations.
const deps = {getWalkers(){reads++;return walkers;},isFestivalSuspended(){return false;},canStandAt(){return true;}}; // All candidate tiles are walkable.
const win = {CalendarSystem:{getHour(){return 17;}},FestivalLocaleActivities:{targetFor(){return null;}},
  FurnitureTableSystem:{isSeatTaken(){return false;},setSeatTarget(){}},
  NpcScheduling:{resolveNpcStationTarget(id){const s=stations.find(v=>v.id===id);return s?{area:'town',stationId:id,c:s.col,r:s.row,pose:'stand'}:null;}}}; // Existing scheduler dependencies used by target selection.
const target = build(deps,()=>({id:'tzizkhanash',name:'Tzizkhanash'}),()=>true,new Set(['town']),null,win,()=>({npcStations:stations}),()=>[self],()=>false,()=>'1154:tzizkhanash',()=>27,assignments,()=>false); // Real Tzizkhanash selection function.
const make = (id,x,z,stationId,area='town')=>({rec:{id},area,root:{position:{x,z}},currentScheduleTarget:stationId?{stationId}:null}); // Authentic walker fields.
walkers=[make('main',20.5,20.5),make('other',21.5,20.5,'a')];
stations=[{id:'a',festivalRole:'guest',col:22,row:20},{id:'b',festivalRole:'guest',col:23,row:20}];
reads=0;assert.equal(target(self).stationId,'b','another walker occupies station a');assert.equal(reads,1,'one roster snapshot per station selection');
walkers=[make('main',20.5,20.5)];
assignments.set('another',{scope:'1154:tzizkhanash:1',stationId:'a'});
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
