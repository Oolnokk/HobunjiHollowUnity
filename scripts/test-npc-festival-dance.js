#!/usr/bin/env node
'use strict';
// Executes the shipped gathering routine against the real Gorkunash layout and NPC database:
// spouses dance together, unmarried romanceable guests swap partners, nobody dances without a musician,
// and diners go back for seconds or to the floor after 10-20 game minutes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const game = fs.readFileSync('docs/game.js','utf8');
const defStart = game.indexOf('const DECORATIVE_FURNITURE_DEFS =');
const defs = vm.runInNewContext(`${game.slice(defStart,game.indexOf('\n      };',defStart)+9)}; DECORATIVE_FURNITURE_DEFS`);
const town = JSON.parse(fs.readFileSync('docs/config/maps/hobunji_hollow_town.map.json'));
const records = JSON.parse(fs.readFileSync('docs/config/npcs/hobunji-starter-npc-database.json')).npcs;
const HOMES = new Set(['ginju_farmstead','little_swamp_house','general_store','smithy','inn','temple','potion_shop','carpenters','unumanuk_household']);
const SKIPPED = new Set(['father_hunundi_hodu','kinami_kunji']); // Their own festival overrides keep them out of the shared gathering.
let minutes = 15*60, music = true, seed = 12345;
const rng = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const walkers = [], window = {};
const context = vm.createContext({window,console,performance:{now:()=>minutes*1000}});
const load = file => vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:file});
for (const name of ['festival-calendar','map-layout-system','furniture-table-system','npc-scheduling']) load(`docs/js/${name}.js`);
load('docs/config/npcs/social-relations.js'); load('docs/js/npc-social-inhibition-runtime.js'); load('docs/js/npc-festival-dance.js'); load('docs/js/npc-shared-meals.js');
window.CalendarSystem = {getHour:()=>minutes/60,currentWeekdayName:()=> 'Anan'};
const map = window.MapLayoutSystem.getEffectiveMapData(town,{dateOrdinal:120});
const meals = window.NpcSharedMeals, dance = window.NpcFestivalDance, tables = window.FurnitureTableSystem, scheduling = window.NpcScheduling;
scheduling.init({normalizeNpcArea:area => area === town.id ? 'town' : area,npcWalkers:walkers,calendar:{get time01(){return minutes/(24*60);}},decorativeFurnitureDefs:defs});
scheduling.registerNpcStations(map.npcStations,'town');
tables.init({getWalkers:()=>walkers,getArea:()=> 'town',getPlayerSeat:()=>null});
for (const record of map.decor) {
  const def = defs[record.key]; if (!def) continue;
  tables.registerPlacement('town',record,{parent:{},position:{x:record.col+def.fw/2+(record.postX||0),y:0,z:record.row+def.fd/2+(record.postZ||0)},scale:{x:1,y:1,z:1}},def);
}
const config = window.SCRATCHBONES_CONFIG.game;
const isRomanceable = rec => rec.relationship?.canDate === true || (config.romance?.likes?.[rec.id] || []).length > 0;
dance.init({relationships:()=>config.socialRelationships.relationships,isRomanceable,
  inhibition:rec=>window.NpcSocialInhibition.profileFor(rec).base,danceThreshold:v=>window.NpcSocialInhibition.danceThresholdFor(v),
  likesDancing:id=>(config.romance?.likes?.[id]||[]).includes('dancing')});
const musicians = () => minutes/60 < 20 ? 'foroji_funji' : 'kaboku_kunji';
meals.init({enabled:()=>true,getLayout:()=>map,getWalkers:()=>walkers,minutes:()=>minutes,random:rng,owner:'festivals',musicOn:()=>music,
  canStandAt:(area,c,r)=>!tables.blocksBox(area,c+.5,r+.5),visible:()=>false,
  companions:rec=>{ const bonds = new Map(); for (const link of config.socialRelationships.relationships) if (link.members.includes(rec.id)) for (const id of link.members) if (id !== rec.id) bonds.set(id,Math.max(bonds.get(id)||0,({partner:14,family:11,friend:8})[link.type])); return bonds; },
  isMusician:rec=>rec.id === musicians()});
const guests = records.filter(rec => HOMES.has(rec.homeId) && !SKIPPED.has(rec.id));
for (const rec of guests) walkers.push({rec,area:'town',root:{position:{x:29.5,z:30.5}}});
const byId = new Map(walkers.map(w => [w.rec.id,w]));
function step(delta) { // The game's 200 ms gathering tick plus instant arrival at each target.
  minutes += delta; meals.update();
  for (const w of walkers) {
    const target = meals.targetFor(w.rec); w.currentScheduleTarget = target ? {...target,overrideOwner:'festivals'} : target;
    if (!target) continue;
    const seat = target.pose === 'sit' ? tables.seatTransform('town',target) : null;
    w.root.position.x = seat?.x ?? target.c+.5; w.root.position.z = seat?.z ?? target.r+.5;
  }
}
const married = new Map(), partnersOf = new Map(), phasesSeen = new Set(), danced = new Set();
let silentDancers = 0, maxHelpings = 0, bothMusiciansOnStage = 0;
function inspect(silent) {
  const actors = meals.diagnostics().actors, state = new Map(actors.map(a => [a.id,a]));
  const stationHolders = new Map();
  for (const a of actors) {
    phasesSeen.add(a.phase); maxHelpings = Math.max(maxHelpings,a.helpings);
    if (a.station && !a.station.startsWith('mingle:')) {
      assert(!stationHolders.has(a.station),`${a.id} and ${stationHolders.get(a.station)} share ${a.station}`);
      stationHolders.set(a.station,a.id);
    }
    if (['dance-wait','dance-walk','dancing'].includes(a.phase) && silent) silentDancers++;
    if (a.partner) {
      const other = state.get(a.partner); assert(other,`${a.id} dances with a missing partner`);
      assert.equal(other.partner,a.id,`pairing of ${a.id}/${a.partner} is symmetric`);
      assert(a.phase === other.phase || ['dance-walk','dancing'].includes(a.phase) && ['dance-walk','dancing'].includes(other.phase),'partners progress together');
      const rec = byId.get(a.id).rec, otherRec = byId.get(a.partner).rec;
      assert(dance.pairWeight(rec,otherRec) > 0,`${rec.id} may dance with ${otherRec.id}`);
      if (dance.kind(rec) === 'married') assert(dance.spouseIds(rec).has(otherRec.id),`${rec.id} dances only with a spouse`);
      if (a.phase === 'dancing') {
        const key = [a.id,a.partner].sort().join('+'); (partnersOf.get(a.id) || partnersOf.set(a.id,new Set()).get(a.id)).add(a.partner);
        danced.add(a.id); if (dance.kind(rec) === 'married') married.set(key,(married.get(key)||0)+1);
        const target = byId.get(a.id).currentScheduleTarget, mate = byId.get(a.partner).currentScheduleTarget;
        assert(target.socialDance && target.socialLookAt,'dancers carry the dance presentation and face their partner');
        assert(Math.abs(target.socialLookAt.x-(mate.c+.5))<1e-6 && Math.abs(target.socialLookAt.z-(mate.r+.5))<1e-6,'dancers face each other');
        assert(Math.hypot(target.c-mate.c,target.r-mate.r) <= 1.35,'partners stand a hand apart');
      }
    } else if (!['dancing'].includes(a.phase)) assert(!byId.get(a.id).currentScheduleTarget.socialDance,`${a.id} only carries a dance pose while dancing`);
  }
}

// Classification follows the authored relationship graph.
const rec = id => records.find(r => r.id === id);
assert.equal(dance.kind(rec('gorobi_ginju')),'married'); assert.equal(dance.kind(rec('dzahiri_khibu')),'married');
assert.equal(dance.kind(rec('foroji_funji')),'single'); assert.equal(dance.kind(rec('leaf')),'casual');
assert(dance.pairWeight(rec('gorobi_ginju'),rec('gikali_ginju')) > 0,'spouses may dance');
assert.equal(dance.pairWeight(rec('gorobi_ginju'),rec('aliri_ginju')),0,'a married parent does not partner their daughter');
assert.equal(dance.pairWeight(rec('gorobi_ginju'),rec('foroji_funji')),0,'married guests never dance with singles');
assert.equal(dance.pairWeight(rec('foroji_funji'),rec('sloomi')) > 0,true,'unmarried romanceable guests pair freely');
assert.equal(dance.pairWeight(rec('namui_u_hakaru'),rec('takua_ao_hakaru')),0,'siblings do not pair romantically');
assert(dance.pairWeight(rec('foroji_funji'),rec('sloomi'),{lastPartnerId:'sloomi'}) < dance.pairWeight(rec('foroji_funji'),rec('sloomi')),'a repeat partner is less likely');
assert(dance.danceDrive(rec('pahu')) > dance.danceDrive(rec('spearhead_unumanuk')),'a festival lover is likelier to dance than a stern watch captain');
const floor = dance.pairSlots(map.npcStations.filter(s => s.festivalLocaleKind === 'dance').map((s,i) => ({stationId:s.id,area:'town',c:s.col,r:s.row})));
assert(floor.slots.length >= 5,'the authored dance floor yields facing pairs'); assert(floor.slots.every(s => Math.hypot(s.a.c-s.b.c,s.a.r-s.b.r) <= 1.35));

for (const w of walkers) meals.targetFor(w.rec);
// Evening one: music plays. Five and a half game hours in half-minute steps.
for (let i = 0; i < 660; i++) { step(.5); inspect(false); }
assert(phasesSeen.has('dancing') && phasesSeen.has('eating') && phasesSeen.has('dance-wait'),'guests eat, wait on the floor and dance');
assert(maxHelpings >= 2,'someone returns to the buffet for seconds');
assert(married.size >= 1,'a married couple danced together');
for (const [key] of married) { const [a,b] = key.split('+'); assert(dance.spouseIds(rec(a)).has(b),`${key} are spouses`); }
const singles = [...danced].filter(id => dance.kind(rec(id)) === 'single');
assert(singles.length >= 3,`several unmarried romanceable guests danced (${singles})`);
assert(singles.some(id => (partnersOf.get(id)?.size||0) >= 2),'unmarried guests swap partners between songs');
assert(!danced.has('foroji_funji') || minutes/60 >= 20,'the day musician is on stage, not on the floor');

// The band stops: everyone leaves the floor, and nobody starts again until music returns.
music = false;
for (let i = 0; i < 6; i++) { step(.5); }
inspect(true); assert.equal(silentDancers,0,'nobody dances without music');
for (let i = 0; i < 60; i++) { step(.5); inspect(true); }
assert.equal(silentDancers,0,'nobody starts a dance while the band is silent');
music = true;
for (let i = 0; i < 400; i++) { step(.5); inspect(false); }
assert(meals.diagnostics().actors.some(a => a.phase === 'dancing'),'dancing resumes once the music does');

// A plate lasts 10-20 game minutes, then a diner chooses what to do next.
const eaters = new Map(); let lengths = [];
for (let i = 0; i < 800; i++) {
  step(.5);
  for (const a of meals.diagnostics().actors) {
    if (a.phase === 'eating' && !eaters.has(a.id)) eaters.set(a.id,minutes);
    else if (a.phase !== 'eating' && eaters.has(a.id)) { lengths.push(minutes-eaters.get(a.id)); eaters.delete(a.id); }
  }
}
assert(lengths.length > 10,'many meals finished');
assert(lengths.every(m => m >= 5 && m <= 21),`no plate outlasts 20 game minutes (${Math.min(...lengths)}-${Math.max(...lengths)})`); // A waiting spouse can call a diner away after half a plate.
assert(lengths.filter(m => m >= 9.5).length >= lengths.length*.7,'most plates last the full 10-20 game minutes');

// An interrupted dancer (a Follow invitation) releases the partner, who rejoins the pool without a stuck reservation.
const dancer = meals.diagnostics().actors.find(a => a.phase === 'dancing' && a.partner);
if (dancer) {
  const mate = dancer.partner; meals.interrupt(dancer.id); byId.get(dancer.id).currentScheduleTarget = null; step(.5); step(.5);
  const after = meals.diagnostics().actors.find(a => a.id === mate); assert(after && after.partner !== dancer.id,'partner is freed when a dancer is interrupted');
}
console.log(`Festival dance: spouses (${[...married.keys()]}), ${singles.length} unmarried guests danced and swapped partners, silent floor, 10-20 minute plates and seconds passed.`);
