#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const game = fs.readFileSync('docs/game.js','utf8');
const defStart = game.indexOf('const DECORATIVE_FURNITURE_DEFS =');
const defs = vm.runInNewContext(`${game.slice(defStart,game.indexOf('\n      };',defStart)+9)}; DECORATIVE_FURNITURE_DEFS`);
const town = JSON.parse(fs.readFileSync('docs/config/maps/hobunji_hollow_town.map.json'));
const records = JSON.parse(fs.readFileSync('docs/config/npcs/hobunji-starter-npc-database.json')).npcs;
let minutes = 17*60, roll = 0, visible = true, animations = 0;
const walkers = [], window = {};
const context = vm.createContext({window,console,performance:{now:()=>minutes*1000}});
const load = name => vm.runInContext(fs.readFileSync(`docs/js/${name}.js`,'utf8'),context,{filename:name});
load('festival-calendar'); load('map-layout-system'); load('furniture-table-system'); load('npc-scheduling'); load('npc-shared-meals');
window.CalendarSystem = {getHour:()=>minutes/60,currentWeekdayName:()=> 'Anan'};
const map = window.MapLayoutSystem.getEffectiveMapData(town,{dateOrdinal:120});
const meals = window.NpcSharedMeals, tables = window.FurnitureTableSystem, scheduling = window.NpcScheduling;
const normalize = area => area === town.id ? 'town' : area;
scheduling.init({normalizeNpcArea:normalize,npcWalkers:walkers,calendar:{get time01(){return minutes/(24*60);}},decorativeFurnitureDefs:defs});
scheduling.registerNpcStations(map.npcStations,'town');
tables.init({getWalkers:()=>walkers,getArea:()=> 'town',getPlayerSeat:()=>null});
for (const record of map.decor) {
  const def = defs[record.key]; if (!def) continue;
  const root = {parent:{},position:{x:record.col+def.fw/2+(record.postX||0),y:0,z:record.row+def.fd/2+(record.postZ||0)},
    scale:{x:record.postSX||1,y:record.postSY||1,z:record.postSZ||1}};
  tables.registerPlacement('town',record,root,def);
}
const feast = map.decor.find(p=>p.id==='gorkunash_feast');
assert(tables.blocksBox('town',feast.col+.05,feast.row+.5),'buffet left end collides');
assert(tables.blocksBox('town',feast.col+3.95,feast.row+.5),'buffet right end collides');
assert(!tables.objectAt('town',feast.col,feast.row),'buffet is never a seat');
for(const root of map.decor.filter(p=>['bandstand','dance'].includes(p.festivalLocale?.kind))) {
  const keys = tables.grassFootprintKeys('town');
  const cx=root.col+1,cz=root.row+1,w=root.festivalLocale.width/2,d=root.festivalLocale.depth/2;
  for(let r=Math.floor(cz-d);r<Math.ceil(cz+d);r++)for(let c=Math.floor(cx-w);c<Math.ceil(cx+w);c++) assert(keys.has(`${c},${r}`),`${root.id} clears ${c},${r}`);
}
meals.init({enabled:()=>minutes<25*60,getLayout:()=>map,getWalkers:()=>walkers,minutes:()=>minutes,random:()=>roll,owner:'festivals',
  canStandAt:(area,c,r)=>!tables.blocksBox(area,c+.5,r+.5),
  companions:rec=>new Map(records.filter(other=>other.id!==rec.id&&other.homeId===rec.homeId).map(other=>[other.id,4])),
  visible:()=>visible,playEat:()=>animations++,isMusician:rec=>rec.id==='foroji_funji'});
function actor(id) {
  const rec=records.find(r=>r.id===id); assert(rec,id);
  const walker={rec,area:'town',root:{position:{x:29.5,z:30.5}}}; walkers.push(walker);
  walker.currentScheduleTarget=meals.targetFor(rec); return walker;
}
function phase(walker) { return meals.diagnostics().actors.find(s=>s.id===walker.rec.id)?.phase; }
function tick(step=0) {
  minutes+=step; meals.update();
  for(const w of walkers)if(!w.rec.id.startsWith('occupied:'))w.currentScheduleTarget=meals.targetFor(w.rec);
}
function arrive(w) {
  const target=meals.targetFor(w.rec); assert(target);
  w.root.position.x=target.c+.5;w.root.position.z=target.r+.5;tick();
}
function serve(w) {
  assert.equal(phase(w),'walk-bowl'); arrive(w); assert.equal(phase(w),'take-bowl');
  assert.notEqual(w.currentScheduleTarget.pose,'sit');
  tick(1.1); assert.equal(phase(w),'walk-pot'); arrive(w); assert.equal(phase(w),'fill-bowl');
  tick(2.1); assert.equal(phase(w),'walk-seat');
  assert.notEqual(w.currentScheduleTarget.tableId,feast.id,'dining uses a separate explicit table');
  assert(tables.tableForSeat('town',w.currentScheduleTarget));
  arrive(w); assert.equal(phase(w),'eating');
}
scheduling.stationsById.clear();
assert.equal(meals.targetFor(records.find(r=>r.id==='dzibim_khibu')),null,'unfinished map does not invent a target');
assert(meals.diagnostics().pendingStations);
scheduling.registerNpcStations(map.npcStations,'town');meals.update();
assert.equal(meals.diagnostics().pendingStations,false,'late station registration is retried for the same map');
const dzibim=actor('dzibim_khibu'), dzahiri=actor('dzahiri_khibu');
assert.equal(phase(dzahiri),'queue','second NPC cannot use the same bowl spot');
const firstTarget=meals.targetFor(dzibim.rec);
for(let n=0;n<100;n++)assert.equal(meals.targetFor(dzibim.rec),firstTarget,'schedule probes retain their cached target');
serve(dzibim); const firstTable=dzibim.currentScheduleTarget.tableId;
assert(tables.isSeatTaken('town',dzibim.currentScheduleTarget,'player'),'player cannot take a reserved/occupied chair');
tick(); serve(dzahiri);
assert.equal(dzahiri.currentScheduleTarget.tableId,firstTable,'family prefers the same dining table');
assert.notEqual(dzahiri.currentScheduleTarget.furnitureId,dzibim.currentScheduleTarget.furnitureId);
const before=animations;tick(4);assert(animations>before,'visible seated diners animate');
visible=false;const offscreen=animations;tick(5);assert.equal(animations,offscreen,'offscreen meals advance without animation');
assert(meals.diagnostics().actors.find(s=>s.id===dzibim.rec.id).bites>0);
roll=.9;tick(30);assert.equal(phase(dzibim),'other','a completed meal can change locales');
assert.notEqual(dzibim.currentScheduleTarget.pose,'sit');
roll=0;tick(50);assert.equal(phase(dzibim),'walk-bowl','a locale visit can return to the buffet');
serve(dzibim);tick(25);assert(['walk-bowl','queue'].includes(phase(dzibim)),'a completed meal repeats through the buffet queue');
const musician=actor('foroji_funji');tick();assert.equal(phase(musician),'musician');assert.equal(musician.currentScheduleTarget.toolKey,'kurraya');
dzibim.currentScheduleTarget={overrideOwner:'friendly-follow',pose:'stand'};meals.update();
assert(!meals.diagnostics().actors.some(s=>s.id===dzibim.rec.id),'follow interrupts and releases meal state');
minutes=25*60;meals.update();assert.equal(meals.diagnostics().actors.length,0,'closing gathering clears every reservation/state');
// A full dining area waits without claiming an occupied seat, then resumes as one is released.
minutes=17*60;roll=0;walkers.length=0;
for (const station of map.npcStations.filter(s=>s.pose==='sit'&&s.tableId)) {
  const target=scheduling.resolveNpcStationTarget(station.id);
  walkers.push({rec:{id:`occupied:${station.id}`},area:'town',root:{position:{x:target.c+.5,z:target.r+.5}},currentScheduleTarget:target});
}
const waiting=actor('dzibim_khibu');arrive(waiting);tick(1.1);arrive(waiting);tick(2.1);
assert.equal(phase(waiting),'seek-seat');assert.notEqual(waiting.currentScheduleTarget.pose,'sit');
walkers.shift();tick();assert.equal(phase(waiting),'walk-seat');
// Execute the festival owner's actual stage override and readiness-based handoff.
load('festival-system');
Object.assign(window.CalendarSystem,{isInitialized:()=>true,monthNumber:()=>5,dayOfMonth:()=>8,aotYearNumber:()=>1155});
window.FestivalSystem.init({getTownMap:()=>town,getNpcs:()=>records,getWalkers:()=>walkers});
const foroji=records.find(r=>r.id==='foroji_funji'),kaboku=records.find(r=>r.id==='kaboku_kunji');
minutes=14*60;assert.equal(scheduling.resolveNpcScheduleTarget(foroji).toolKey,'kurraya','opening musician walks to the stage before 15:00');
minutes=19.5*60;assert.equal(scheduling.resolveNpcScheduleTarget(foroji).toolKey,'kurraya');
const incomingTarget=scheduling.resolveNpcScheduleTarget(kaboku);assert.equal(incomingTarget.toolKey,'kurraya','relief starts walking early');
minutes=20*60;assert.equal(scheduling.resolveNpcScheduleTarget(foroji).toolKey,'kurraya','outgoing host stays while relief is absent');
walkers.push({rec:kaboku,area:'town',root:{position:{x:incomingTarget.c+.5,z:incomingTarget.r+.5}}});
assert.notEqual(scheduling.resolveNpcScheduleTarget(foroji).toolKey,'kurraya','outgoing host is released after relief arrives');
assert.equal(scheduling.resolveNpcScheduleTarget(kaboku).toolKey,'kurraya');
console.log('Shared meals: real buffet collision/grass, queues, physical arrivals, family tables, distinct reservations, visibility, repeats, locale changes, music and interruption cleanup passed.');
