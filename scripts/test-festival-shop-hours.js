#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Verifies the real festival and scheduler together.
const fs = require('node:fs'); // Loads authored NPC work shifts and station definitions.
const vm = require('node:vm'); // Runs browser modules without starting the renderer.
const town = JSON.parse(fs.readFileSync('docs/config/maps/hobunji_hollow_town.map.json')); // Festival attendance destinations.
const records = JSON.parse(fs.readFileSync('docs/config/npcs/hobunji-starter-npc-database.json')).npcs; // Unmodified shopkeeper schedules.
let civilDay = 120, hour = 14, weekday = 'Anan', suspended = false; // Independently controlled festival date, clock, weekday and flood suspension.
const window = {}; // Production browser-style module registry.
const context = vm.createContext({window,console,performance:{now:()=>0}}); // Shared isolated runtime for every module under test.
const load = name => vm.runInContext(fs.readFileSync(`docs/js/${name}.js`,'utf8'),context); // Executes shipped implementations.
load('festival-calendar'); load('map-layout-system');
window.CalendarSystem = {isInitialized:()=>true,monthNumber:()=>Math.floor((civilDay-1)/28)+1,
  dayOfMonth:()=>(civilDay-1)%28+1,aotYearNumber:()=>1156,getHour:()=>hour,currentWeekdayName:()=>weekday};
load('npc-scheduling'); load('festival-system'); load('npc-shop-buttons');
const scheduling = window.NpcScheduling, festival = window.FestivalSystem; // Public authorities under test.
scheduling.init({normalizeNpcArea:area=>area===town.id?'town':area,npcWalkers:[],calendar:{get time01(){return hour/24;}},
  getSharedSchedules:()=>[],getWorldNpcPaths:()=>[],getCurrentArea:()=> 'town',isBuildingArea:()=>false});
for (const name of ['map_i_general_store','map_i_general_store_F2_R2','map_i_smithy','map_i_carpenters','map_i_inn']) {
  const map = JSON.parse(fs.readFileSync(`docs/config/maps/${name}.json`)); // Normal counter, forge, home and bed stations.
  scheduling.registerNpcStations(map.npcStations,map.id);
}
function registerFestivalStations() {
  const map = window.MapLayoutSystem.getEffectiveMapData(town,{dateOrdinal:civilDay,minutes:hour*60,weekday}); // Actual date-selected festival layout.
  scheduling.replaceMapNpcStations(map.npcStations,'town');
}
festival.init({getTownMap:()=>town,getNpcs:()=>records,getWalkers:()=>[],isFestivalSuspended:()=>suspended});
const smith = records.find(rec=>rec.id==='kzubug'); // Resident seller used for window and suspension checks.
const currentFestival = window.FestivalCalendar.current(); // Temporarily authored shorter gathering, restored after each scenario.
currentFestival.gatheringHours={start:13,end:16};
assert.equal(festival.gatheringHoursLabel(),'13:00–16:00','displayed schedule follows the configured shop closure');
registerFestivalStations();
for (const [id,stationId,closing] of [['furunji_funji','station_p2x4t',18],['foroji_funji','station_k7m3q',19],
  ['kzubug','station_smi_forge',18],['sloomi','station_smi_apprentice',17.5],['dzibim_khibu','station_car_counter',17]]) {
  const rec = records.find(item=>item.id===id); // Each actual shopkeeper is resolved through their authored work shift.
  hour=15.999;
  assert.equal(festival.shopsClosedFor(rec),true,id);
  assert.equal(scheduling.resolveNpcScheduleTarget(rec).overrideOwner,'festivals',`${id} attends before festival end`);
  hour=16;
  assert.equal(festival.shopsClosedFor(rec),false,`${id} releases festival closure`);
  assert.equal(scheduling.resolveNpcScheduleTarget(rec).stationId,stationId,`${id} resumes real work before normal closing`);
  hour=closing;
  assert.notEqual(scheduling.resolveNpcScheduleTarget(rec).stationId,stationId,`${id} still leaves work at normal closing`);
}
weekday='Uung'; hour=16;
assert.notEqual(scheduling.resolveNpcScheduleTarget(records.find(rec=>rec.id==='dzibim_khibu')).stationId,'station_car_counter','festival end preserves the carpenter day off');
weekday='Anan'; hour=14; suspended=true;
assert.equal(festival.shopsClosedFor(smith),false,'suspended gathering does not close shops');
assert.equal(scheduling.resolveNpcScheduleTarget(smith).stationId,'station_smi_forge','suspended festival preserves the normal work target');
suspended=false;
for (const hours of [{start:16,end:16},{start:-1,end:16},{start:15,end:25},{start:NaN,end:16},{start:15,end:Infinity}]) {
  currentFestival.gatheringHours=hours; hour=17;
  assert.equal(festival.shopsClosedFor(smith),false,'invalid or empty gathering must not impose an all-day closure');
  assert.equal(festival.gatheringHoursLabel(),'No gathering scheduled','invalid hours are not advertised as a real gathering');
}
currentFestival.gatheringHours={start:'9',end:'16'};
hour=10; assert.equal(festival.shopsClosedFor(smith),true,'numeric strings are compared as civil hours');
hour=17; assert.equal(festival.shopsClosedFor(smith),false,'numeric strings cannot extend a closure past its end');
for (const invalidHour of [NaN,Infinity,-1,24]) {
  hour=invalidHour; assert.equal(festival.festivalHours(),false,'invalid civil clock does not close shops');
}
delete currentFestival.gatheringHours;
assert.equal(festival.gatheringHoursLabel(),'15:00–01:00','default overnight hours keep their existing display');
for (const definition of window.FestivalCalendar.festivals) {
  civilDay=window.FestivalCalendar.ordinal(definition.month,definition.day);
  for (const [time,closed] of [[14.999,false],[15,true],[23.999,true],[0,true],[.999,true],[1,false]]) {
    hour=time; assert.equal(festival.shopsClosedFor(smith),closed,`${definition.id} at ${time}`);
  }
  civilDay+=7; hour=16;
  assert.equal(festival.shopsClosedFor(smith),false,`${definition.id} no longer closes shops after its week`);
}
let closureChecks = 0; // Ensures the action-bar hot path ignores unrelated NPCs before checking festival dates.
const originalClosureCheck = festival.shopsClosedFor; // Restored after instrumenting the existing shared method.
festival.shopsClosedFor=rec=>{closureChecks++;return originalClosureCheck(rec);};
window.NpcShopButtons.init({getCurrentArea:()=> 'map_i_smithy'});
const unrelated = {rec:{id:'unrelated',homeId:'inn'}}; // No station/position is needed for an NPC who cannot staff these shops.
assert.equal(window.NpcShopButtons.isGeneralStoreNpcOnDuty(unrelated),false);
assert.equal(window.NpcShopButtons.isCarpenterNpcOnDuty(unrelated),false);
assert.equal(window.NpcShopButtons.isSmithyNpcInBronzeworks(unrelated),false);
assert.equal(closureChecks,0,'ordinary NPC prompts do not repeatedly inspect the festival calendar');
festival.shopsClosedFor=originalClosureCheck;
console.log('Festival shop hours: real schedules, reopening, closing, day off, suspension, all festivals, malformed hours and cheap NPC rejection passed.');
