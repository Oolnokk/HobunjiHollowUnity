#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Exercise the real locale expansion and autonomous schedule adapter.
const fs = require('node:fs'); // Read shipped authored map and gameplay module.
const vm = require('node:vm'); // Run browser-neutral festival logic without starting WebGL.
const town = JSON.parse(fs.readFileSync('docs/config/maps/hobunji_hollow_town.map.json','utf8')); // Exact editor-saved layout.
const browser = {window:{},console}; // Simulated global owners shared by loaded modules.
const ctx = vm.createContext(browser); // Production scripts register on window.
for (const name of ['festival-calendar','map-layout-system','festival-locale-activities'])
  vm.runInContext(fs.readFileSync('docs/js/'+name+'.js','utf8'),ctx,{filename:name+'.js'});
const calendar=browser.window.FestivalCalendar, maps=browser.window.MapLayoutSystem, api=browser.window.FestivalLocaleActivities;
const activityKinds={hachutukara:['mask-dance','sparring','story-circle'],
  tzizkhanash:['ancestor-offerings','remembrance'],
  five_blossoms:['blossom-dance','blossom-music'],
  mountaindawn:['gift-exchange']}; // Required autonomous gathering kinds; Gorkunash retains its existing owner.
for (const [event,kinds] of Object.entries(activityKinds)) {
  const def=calendar.get(event), ordinal=calendar.ordinal(def.month,def.day);
  const current=maps.getEffectiveMapData(town,{dateOrdinal:ordinal,minutes:17*60,weekday:'Anan'});
  const roots=current.decor.filter(prop=>prop.festivalLocale && kinds.includes(prop.festivalLocale.kind));
  assert.equal(roots.length,kinds.length,event+' has every movable activity locale');
  for (const root of roots) {
    const stations=current.npcStations.filter(st=>st.festivalLocaleParent===root.id);
    assert(stations.length>=2,root.id+' has participants and an audience');
    assert(stations.every(st=>st.festivalLocaleKind===root.festivalLocale.kind),root.id+' exports its role');
    assert(stations.every(st=>['host','participant','audience'].includes(st.festivalRole)),root.id+' provides usable social roles');
  }
  const host = event==='hachutukara'?'father_hunundi_hodu':event==='five_blossoms'?'foroji_funji':null;
  if (host) assert(current.npcStations.some(st=>st.festivalLocaleParent&&st.festivalNpcId===host),event+' uses an authored, movable host');

  // Root relocation must carry ALL participants, not leave a second list of static positions behind.
  const moved=structuredClone(town), movedRoot=moved.layouts.find(l=>l.id==='festival_'+event).decor.find(p=>p.id===roots[0].id);
  movedRoot.col+=2;
  const shifted=maps.getEffectiveMapData(moved,{dateOrdinal:ordinal,minutes:17*60,weekday:'Anan'});
  const initialStation=current.npcStations.find(st=>st.festivalLocaleParent===roots[0].id);
  const updatedStation=shifted.npcStations.find(st=>st.id===initialStation.id);
  assert.equal(updatedStation.col,initialStation.col+2,'moving locale translates its guest stations');
  assert.equal(updatedStation.row,initialStation.row,'moving locale preserves guest-relative depth');
}
assert(!town.layouts.find(l=>l.id==='festival_gorkunash').decor.some(p=>p.activity?.type==='welcome'),'Gorkunash remains unchanged');

let festival=calendar.get('hachutukara'), active=true, hour=17, layout=null; // Mutable simulation clock and selected gathering.
const records=Array.from({length:25},(_,i)=>({id:'resident_'+i,homeId:'inn'}))
  .concat([{id:'father_hunundi_hodu',homeId:'temple'},{id:'spearhead_unumanuk',homeId:'unumanuk_household'},{id:'foroji_funji',homeId:'inn'}]); // Deterministic attendance pool.
const walkers=records.map(rec=>({rec,area:'town',root:{position:{x:-50,z:-50}}})); // Moved to slots when the scheduler reaches them.
function select(id) {festival=calendar.get(id); const d=calendar.ordinal(festival.month,festival.day);
  layout=maps.getEffectiveMapData(town,{dateOrdinal:d,minutes:hour*60,weekday:'Anan'});}
api.init({festival:()=>festival,active:()=>active,getLayout:()=>layout,getWalkers:()=>walkers,
  residents:()=>records,minutes:()=>calendar.ordinal(festival.month,festival.day)*1440+hour*60,
  paused:()=>false,resolve:id=>{const s=layout.npcStations.find(st=>st.id===id);return s?{...s,stationId:s.id,c:s.col,r:s.row,area:'town'}:null;}});
for (const [event,kinds] of Object.entries(activityKinds)) {
  select(event);api.update();
  const selected=records.map(rec=>({id:rec.id,target:api.targetFor(rec)})).filter(x=>x.target);
  assert(selected.length>0,event+' assigns residents to its activity locales');
  assert.equal(new Set(selected.map(x=>x.target.stationId)).size,selected.length,event+' cannot double-book a station');
  for (const {id,target} of selected) {
    const walker=walkers.find(w=>w.rec.id===id);
    walker.root.position.x=target.c+.5;walker.root.position.z=target.r+.5;
  }
  api.update();
  let performed=false;
  for(const rec of records) {
    const t=api.targetFor(rec);
    if(!t)continue;
    if(t.festivalLocaleKind==='mask-dance'||t.festivalLocaleKind==='blossom-dance')performed ||= !!t.socialDance;
  }
  if(kinds.some(x=>x.endsWith('dance'))) assert(performed,event+' has NPCs performing visible dances');
  if(event==='five_blossoms')assert.equal(api.targetFor(records.find(r=>r.id==='foroji_funji')).toolKey,'kurraya','festival musician performs at the real instrument station');
}
active=false;api.update();
assert(records.every(rec=>api.targetFor(rec)===null),'ending the gathering restores normal NPC scheduling');
console.log('Festival locale relocation, active roles, autonomous dancing, host music and cleanup passed.');