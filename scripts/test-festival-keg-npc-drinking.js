#!/usr/bin/env node
'use strict';
// NPC drinking at the Gorkunash keg: pacing math (most guests nurse a cup, the least inhibited drink to a blackout in
// the late evening) and the real gathering routine fetching cups, sipping and passing out.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const game = fs.readFileSync('docs/game.js','utf8');
const defStart = game.indexOf('const DECORATIVE_FURNITURE_DEFS =');
const defs = vm.runInNewContext(`${game.slice(defStart,game.indexOf('\n      };',defStart)+9)}; DECORATIVE_FURNITURE_DEFS`);
const town = JSON.parse(fs.readFileSync('docs/config/maps/hobunji_hollow_town.map.json'));
const records = JSON.parse(fs.readFileSync('docs/config/npcs/hobunji-starter-npc-database.json')).npcs;
const HOMES = new Set(['ginju_farmstead','little_swamp_house','general_store','smithy','inn','temple','potion_shop','carpenters','unumanuk_household']);
const SKIPPED = new Set(['father_hunundi_hodu','kinami_kunji']);
let minutes = 15*60, seed = 987;
const rng = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const walkers = [], window = {};
const context = vm.createContext({window,console,performance:{now:()=>minutes*1000}});
const load = file => vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:file});
for (const name of ['festival-calendar','map-layout-system','furniture-table-system','npc-scheduling']) load(`docs/js/${name}.js`);
load('docs/config/npcs/social-relations.js'); load('docs/js/npc-social-inhibition-runtime.js'); load('docs/js/npc-festival-dance.js'); load('docs/js/npc-shared-meals.js');
window.CalendarSystem = {getHour:()=>minutes/60,currentWeekdayName:()=> 'Anan'};
const config = window.SCRATCHBONES_CONFIG.game;
const isRomanceable = rec => rec.relationship?.canDate === true || (config.romance?.likes?.[rec.id] || []).length > 0;
const NFD = window.NpcFestivalDance;
NFD.init({relationships:()=>config.socialRelationships.relationships,isRomanceable,
  inhibition:rec=>window.NpcSocialInhibition.profileFor(rec).base,danceThreshold:v=>window.NpcSocialInhibition.danceThresholdFor(v),
  likesDancing:id=>(config.romance?.likes?.[id]||[]).includes('dancing'),drunkFraction:id=>drunkFraction(id)});

// ---- Pacing math on synthetic guests -----------------------------------------------------------------------------
// Sobriety model identical to the alcohol bridge: 100 points, 16 per keg swig, 0.02 recovery per real second (~0.0093 per game minute).
const RECOVERY_PER_GAME_MIN = .02 * 672 / 1440;
function simulateEvening(inhibition, trialSeed) {
  let s = trialSeed; const r = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rec = {id:`synthetic:${inhibition}:${trialSeed}`,ageBand:'adult',personality:{inhibition}};
  NFD.init({relationships:()=>[],isRomanceable:()=>false,inhibition:x=>x.personality.inhibition,drunkFraction:()=>0});
  let sobriety = 100, now = 15*60 + 5 + r()*55, swigs = 0, nextSip = now + NFD.nextSipDelay(rec,r), blackoutAt = null, last = now;
  while (now < 25*60 && blackoutAt === null) {
    now += 1; sobriety = Math.min(100,sobriety + RECOVERY_PER_GAME_MIN);
    if (now < nextSip) continue;
    const drunk = 1 - sobriety/100;
    if (!NFD.willSip(rec,drunk,r)) { nextSip = now + NFD.drinkProfile(rec).intervalMin*.35; continue; }
    swigs++; sobriety -= NFD.KEG_FOOTING; nextSip = now + NFD.nextSipDelay(rec,r);
    if (sobriety <= 0) blackoutAt = now;
  }
  return { blackoutAt, swigs, drunk: 1 - Math.max(0,sobriety)/100 };
}
const hours = m => m/60;
const lowest = Array.from({length:300},(_,i) => simulateEvening(12,1000+i));
const lowBlackouts = lowest.filter(t => t.blackoutAt !== null).map(t => t.blackoutAt).sort((a,b) => a-b);
assert(lowBlackouts.length >= 285,`the least inhibited guests nearly all black out before 01:00 (${lowBlackouts.length}/300)`);
const median = hours(lowBlackouts[Math.floor(lowBlackouts.length/2)]);
assert(median >= 23 && median <= 24.5,`their median blackout lands around 23:00-00:30 (${median.toFixed(2)}h)`);
assert(hours(lowBlackouts[Math.floor(lowBlackouts.length*.1)]) >= 21.5 && hours(lowBlackouts[Math.floor(lowBlackouts.length*.9)]) <= 25,'and the spread stays within a couple of hours of that');
const lowMid = Array.from({length:300},(_,i) => simulateEvening(20,2000+i));
assert(lowMid.filter(t => t.blackoutAt !== null).length > 60,'quite uninhibited guests still black out fairly often');
for (const inhibition of [40,54,66,84]) {
  const trials = Array.from({length:300},(_,i) => simulateEvening(inhibition,3000+i+inhibition));
  assert.equal(trials.filter(t => t.blackoutAt !== null).length,0,`inhibition ${inhibition} paces itself and never blacks out`);
  const limit = NFD.drinkProfile({id:'x',ageBand:'adult',personality:{inhibition}}).fStop;
  assert(Math.max(...trials.map(t => t.drunk)) <= limit + .17,`inhibition ${inhibition} stops near its limit ${limit.toFixed(2)}`);
}
NFD.init({relationships:()=>config.socialRelationships.relationships,isRomanceable,inhibition:rec=>window.NpcSocialInhibition.profileFor(rec).base,
  danceThreshold:v=>window.NpcSocialInhibition.danceThresholdFor(v),likesDancing:id=>(config.romance?.likes?.[id]||[]).includes('dancing'),drunkFraction:id=>drunkFraction(id)});
assert.equal(NFD.drinkProfile({id:'kid',ageBand:'little boy',personality:{inhibition:5}}).eligible,false,'children never drink');
assert(NFD.drinkProfile(records.find(r=>r.id==='pahu')).fStop > 1.05 && NFD.drinkProfile(records.find(r=>r.id==='spearhead_unumanuk')).fStop < .2,'the festival lover has no limit; the watch captain has one polite cup');

// ---- The real gathering routine -----------------------------------------------------------------------------------
const map = window.MapLayoutSystem.getEffectiveMapData(town,{dateOrdinal:120});
const meals = window.NpcSharedMeals, tables = window.FurnitureTableSystem, scheduling = window.NpcScheduling;
scheduling.init({normalizeNpcArea:area => area === town.id ? 'town' : area,npcWalkers:walkers,calendar:{get time01(){return minutes/(24*60);}},decorativeFurnitureDefs:defs});
scheduling.registerNpcStations(map.npcStations,'town');
tables.init({getWalkers:()=>walkers,getArea:()=> 'town',getPlayerSeat:()=>null});
for (const record of map.decor) { const def = defs[record.key]; if (!def) continue;
  tables.registerPlacement('town',record,{parent:{},position:{x:record.col+def.fw/2+(record.postX||0),y:0,z:record.row+def.fd/2+(record.postZ||0)},scale:{x:1,y:1,z:1}},def); }
assert(map.npcStations.filter(s => s.mealRole === 'drinks').length >= 3,'the keg ships with authored tap spots');
const sobriety = new Map(), blackoutUntil = new Map(), sips = new Map(), cups = new Set();
function drunkFraction(id) { return 1 - (sobriety.get(id) ?? 100)/100; }
const musicians = () => minutes/60 < 20 ? 'foroji_funji' : 'kaboku_kunji';
meals.init({enabled:()=>true,getLayout:()=>map,getWalkers:()=>walkers,minutes:()=>minutes,random:rng,owner:'festivals',musicOn:()=>true,
  canStandAt:(area,c,r)=>!tables.blocksBox(area,c+.5,r+.5),visible:()=>false,
  companions:rec=>new Map(),isMusician:rec=>rec.id === musicians(),
  drunkFraction,isBlackedOut:id => (blackoutUntil.get(id) || 0) > minutes,
  drinkNpc:(rec,count,footing) => {
    const before = sobriety.get(rec.id) ?? 100, after = Math.max(0,before - footing);
    sobriety.set(rec.id,after); sips.set(rec.id,(sips.get(rec.id)||0) + 1);
    if (before - footing <= 0) blackoutUntil.set(rec.id,minutes + Math.max(30,(footing - before)*10));
  },
  carryCup:(walker,id)=>cups.add(id),clearCup:id=>cups.delete(id)});
const pahu = records.find(r => r.id === 'pahu');
const guests = records.filter(rec => HOMES.has(rec.homeId) && !SKIPPED.has(rec.id));
for (const rec of guests) walkers.push({rec,area:'town',root:{position:{x:29.5,z:30.5}}});
const byId = new Map(walkers.map(w => [w.rec.id,w]));
function step(delta) {
  minutes += delta;
  for (const [id,value] of sobriety) sobriety.set(id,Math.min(100,value + RECOVERY_PER_GAME_MIN*delta));
  meals.update();
  for (const w of walkers) {
    const target = meals.targetFor(w.rec); w.currentScheduleTarget = target ? {...target,overrideOwner:'festivals'} : target;
    if (!target) continue;
    const seat = target.pose === 'sit' ? tables.seatTransform('town',target) : null;
    if (!(blackoutUntil.get(w.rec.id) > minutes)) { w.root.position.x = seat?.x ?? target.c+.5; w.root.position.z = seat?.z ?? target.r+.5; } // The unconscious do not walk.
  }
}
for (const w of walkers) meals.targetFor(w.rec);
const phases = new Map(), firstBlackout = new Map(); let blackoutSeatLeak = 0;
for (let i = 0; i < 1200; i++) { // 15:00 to 01:00 in half-minute steps
  step(.5);
  const stations = new Set();
  for (const a of meals.diagnostics().actors) {
    (phases.get(a.id) || phases.set(a.id,new Set()).get(a.id)).add(a.phase);
    if (a.phase === 'blackout') { if (!firstBlackout.has(a.id)) firstBlackout.set(a.id,minutes); if (a.station || a.tableId) blackoutSeatLeak++; }
    if (a.cupSwigs > 0) assert(!['child'].includes(NFD.ageGroup(byId.get(a.id).rec)),'no child holds a cup');
  }
}
assert.equal(blackoutSeatLeak,0,'a passed-out guest holds no chair or station');
assert([...phases.get('pahu')].some(p => p === 'walk-keg') && [...phases.get('pahu')].includes('draw-cup'),'Pahu walks to the keg and draws a cup');
assert((sips.get('pahu')||0) >= 4,`Pahu keeps sipping (${sips.get('pahu')})`);
assert(sips.size >= 4,`several guests take a cup (${[...sips.keys()]})`);
assert(!sips.has('gantami_ginju'),'children never drink');
const whoBlackedOut = [...firstBlackout.keys()];
assert.deepEqual(whoBlackedOut.filter(id => id !== 'pahu'),[],`only the least inhibited guest passes out (${whoBlackedOut})`);
const pahuOut = firstBlackout.get('pahu') / 60;
assert(pahuOut >= 21 && pahuOut <= 25,`Pahu passes out in the late evening (${pahuOut?.toFixed(2)}h)`);
for (const [id,count] of sips) { const limit = NFD.drinkProfile(byId.get(id).rec).fStop; if (id !== 'pahu') assert(1 - (sobriety.get(id) ?? 100)/100 <= limit + .17 + 1e-9,`${id} stays near their own limit`); }
console.log(`Keg drinking: 300-trial pacing sim (median blackout ${median.toFixed(1)}h for the least inhibited), guests who sipped: ${[...sips.keys()].join(', ')}; Pahu out at ${pahuOut.toFixed(1)}h.`);
