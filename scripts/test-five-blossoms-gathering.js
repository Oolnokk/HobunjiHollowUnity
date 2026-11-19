#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Check shipped Feast systems without WebGL.
const fs = require('node:fs'); // The map and code are the same files used by the game.
const vm = require('node:vm'); // Isolate mutable festival state from other tests.
const town = JSON.parse(fs.readFileSync('docs/config/maps/hobunji_hollow_town.map.json','utf8')); // Movable festival layout and ordinary roads.
let civilDay=9*28-13, hour=17, realMs=1000; // Thirdfall 15; same clock drives buffet, dance and overnight Favor.
const W = {}; // Browser exports created by the real production scripts.
const ctx = vm.createContext({window:W,performance:{now:()=>realMs},document:{hidden:false},console});
const load = name=>vm.runInContext(fs.readFileSync('docs/js/'+name+'.js','utf8'),ctx,{filename:name+'.js'});
for(const name of ['festival-calendar','map-layout-system','festival-potluck-contest','npc-festival-dance','npc-shared-meals','festival-locale-activities','festival-system']) load(name);
const cal=W.FestivalCalendar, start=cal.ordinal(9,15); // Correct month/day is authoritative, not the fixture's initial guess.
civilDay=start;
W.CalendarSystem={isInitialized:()=>true,monthNumber:()=>Math.floor((civilDay-1)/28)+1,dayOfMonth:()=>((civilDay-1)%28)+1,
  aotYearNumber:()=>1156,getHour:()=>hour,currentWeekdayName:()=> 'Anan'};
const active=()=>W.MapLayoutSystem.getEffectiveMapData(town,{dateOrdinal:civilDay,minutes:hour*60,weekday:'Anan'});
let layout=active(),aimKind='bowls',aimIndex=0,player={c:39.5,r:43.5},seated=true,pairedSeconds=0,pairedActive=false; // Simulate real world aim, seat and two-avatar dance.
assert.equal(layout.activeLayoutId,'festival_five_blossoms');
const roots=layout.decor.filter(p=>p.festivalLocale);
assert.deepEqual(Array.from(roots,p=>p.festivalLocale.kind).sort(),['bandstand','dance','dining']);
assert(!layout.decor.some(p=>p.activity?.type==='welcome'||p.key==='bulletinBoard'),'the activity board was removed');
const dining=roots.find(p=>p.festivalLocale.kind==='dining');
assert.equal(dining.serviceId,'five-blossoms-feast');
const seats=layout.decor.filter(p=>p.festivalLocaleParent===dining.id&&p.key==='chairSimple');
assert.equal(seats.length,16,'all real dining chairs survive the copied, relocatable root');
for(const mealRole of ['bowls','fill','queue'])assert(layout.npcStations.some(s=>s.mealRole===mealRole),'physical service and queue stations exist');
const baseRoads=town.routes, baseExits=town.transitions; // Festival decorations never replace travel/navigation.
assert.equal(layout.routes,baseRoads);assert.equal(layout.transitions,baseExits);
const moved=JSON.parse(JSON.stringify(town));
moved.layouts.find(l=>l.id==='festival_five_blossoms').decor.find(p=>p.id===dining.id).col+=3;
const movedLayout=W.MapLayoutSystem.getEffectiveMapData(moved,{dateOrdinal:civilDay,minutes:hour*60,weekday:'Anan'});
const station=layout.npcStations.find(s=>s.festivalLocaleParent===dining.id);
assert.equal(movedLayout.npcStations.find(s=>s.id===station.id).col,station.col+3,'the bowl/seat stations relocate with the table');

const people=[{id:'foroji_funji',name:'Foroji',homeId:'carpenters'},
  {id:'kaboku_kunji',name:'Kaboku',homeId:'potion_shop'},
  {id:'friend',name:'Friend',homeId:'inn',relationship:{canDate:true}}]; // Stage musician and tablemate are real resident roles.
const walkers=people.map(rec=>({rec,area:'town',root:{position:{x:40,z:44},parent:{}},currentScheduleTarget:null}));
const defs={heftroot:{cookingPrimaryEffect:'farming',cookingBaseBoost:1},ongyums:{cookingPrimaryEffect:'vigor',cookingBaseBoost:2},
  garlink:{cookingPrimaryEffect:'clarity',cookingBaseBoost:1},greenMustard:{cookingPrimaryEffect:'speed',cookingBaseBoost:1}}; // Known ingredient effects reach player food stacks.
const services=new Map(),adjusted=[],saved=[]; // Verify actions, earned Favor and persistence.
const seat=seats[0], tableId=layout.npcStations.find(s=>s.pose==='sit')?.tableId;
W.FurnitureTableSystem={
  registerService:(id,service)=>services.set(id,service),
  aimedService:()=>({entry:{record:{serviceId:'five-blossoms-feast'}},placement:{service:{kind:aimKind,index:aimIndex}}}),
  tableForSeat:(_area,target)=>target?{id:tableId}:null,
  members:()=>[{id:'friend'},{id:'friend'}], // Duplicate walker snapshots must count only once per bite.
  setSeatTarget(){},isSeatTaken:()=>false,
};
W.NpcScheduling={
  registerTargetOverride(_owner,fn){this.override=fn},
  resolveNpcStationTarget(id){const s=layout.npcStations.find(x=>x.id===id);return s?{...s,area:'town',c:s.col,r:s.row,stationId:s.id}:null;},
  listInstrumentPerformers:()=>[{area:'town'}],
};
W.DialogueContent={getNpcDlgState:id=>({favor:id==='friend'?160:80}),adjustNpcFavor:(id,amount,reason)=>adjusted.push({id,amount,reason})};
W.NpcWardrobe={registerAppearanceDecorator(){}};W.EffectBuffBar={registerProvider(){},refresh(){}};
W.CookingSystem={registerExternalFoodProvider(_name,fn){this.stacks=fn;},effectLabel:id=>id};
W.NpcRapport={get:()=>250};W.AmbientDialogue={showSocialResponse(){}};
W.SCRATCHBONES_CONFIG={game:{romance:{likes:{friend:['dancing']}}}};
W.SocialActionWheel={isDancing:()=>false,stopDance(){},getDebug:()=>({dancing:false})};
W.MusicMinigame={state:{active:false}};
W.FestivalWheelDanceRuntime={
  start:()=>{pairedActive=true;return true;},
  activeFor:id=>pairedActive&&id==='friend',elapsedSeconds:()=>pairedSeconds,
  stop:()=>{pairedActive=false;return true;},diagnostics:()=>({active:pairedActive}),
};
const api=W.FestivalSystem;
api.init({getTownMap:()=>town,getNpcs:()=>people,getWalkers:()=>walkers,getArea:()=> 'town',
 getItemDefs:()=>defs,getPlayerTile:()=>player,getPlayerMesh:()=>({}),getPlayerSeatedSeat:()=>seat,
 getAimPosition:()=>player,getActiveItemKey:()=>'',getHeldMode:()=> 'item',isPlayerSeated:()=>seated,
 isBlocked:()=>false,isFestivalSuspended:()=>false,canStandAt:()=>true,canSeeNpc:()=>false,
 save:()=>saved.push('save'),refresh(){},toast(){},equipFestivalBowl(){}});
assert.equal(api.actionButton(),null,'festival NPCs and furniture have no activity-board input');
assert.equal(services.get('gorkunash-feast').enabled(),false);
assert.equal(services.get('five-blossoms-feast').enabled(),true);
const buffet=services.get('five-blossoms-feast');
assert(!buffet.buttons({placement:{service:{kind:'meal',index:0}}}).some(b=>b.action==='obj_contribute_meal'),'no contest/donation action');
assert.equal(buffet.onAction('obj_contribute_meal',{placement:{service:{kind:'meal',index:0}}}).ok,false,'stale contest input cannot contribute');
const menu=api.feastMenu();
assert.equal(menu.length,7,'all seven pots are filled');
assert(menu.every(d=>d.id.startsWith('blossoms:')&&d.id!=='reserved'));
assert(menu.some(d=>Object.keys(d.foodEffects).length),'real ingredient food buffs are present');
const same=JSON.stringify(menu);
civilDay+=5;assert.equal(JSON.stringify(api.feastMenu()),same,'dishes do not rotate or reroll on another day');
civilDay=start;
assert.equal(api.takeFestivalBowl().ok,true);
aimKind='meal';
assert.equal(api.fillFestivalBowl(0).ok,true);
const first=api.feastDishDetails(0),expected=first.foodEffects;
assert.equal(api.eatFestivalBowl().ok,true,'seated player eats a real buffet portion');
assert.equal(api.currentFullness(),1);
for(const [effect,power] of Object.entries(expected))assert.equal(api.festivalFoodStacks(effect),power,'buff uses the canonical meal effect');
const event='1156:five_blossoms',foodKey=event+':'+(1156*336+start-1)+':friend'; // Exactly the same Gorkunash per-day, per-diner ledger.
const snapshot=api.serialize();
assert.equal(snapshot.festivalMealPortions[foodKey],1);
assert(Math.abs(snapshot.festivalFun.friend-96/70)<1e-8,'same tablemate earns exactly 96/70 Festival Fun per serving');
assert.equal(snapshot.potluckContests[event],undefined,'no Feast contest was created');
api.restore(snapshot);
assert.equal(api.currentFullness(),1,'meal fullness survives save/load');
assert.equal(api.festivalFoodStacks('vigor'),expected.vigor||0,'meal buffs survive save/load');
assert.equal(api.serialize().festivalMealPortions[foodKey],1,'tablemate ledger survives save/load');
assert(api.socialOptionsFor(walkers[2]).some(a=>a.id==='dance-together'),'the Gorkunash paired dance social option works at Five Blossoms');
assert.equal(api.askFestivalDance(walkers[2]).ok,true,'three-heart friend accepts the ordinary two-avatar dance');
pairedSeconds=1.15;realMs+=400;api.update();
assert(Math.abs(api.serialize().festivalFun.friend-(96/70+.12))<1e-8,'paired dance contributes the same 0.12 Fun per played second');
api.cancelDance();assert.equal(pairedActive,false,'dance releases both actors on cancellation');
const stageTarget=W.NpcScheduling.override(people[0]);
assert.equal(stageTarget?.festivalLocaleKind,'bandstand','Foroji walks to the Feast bandstand');
const danceRoot=roots.find(p=>p.festivalLocale.kind==='dance'); // Editor-relocatable floor is authoritative for the musician's facing.
assert.equal(stageTarget?.lookAt?.col,danceRoot.col,'the on-duty musician looks at the dance floor');
assert.equal(stageTarget?.lookAt?.row,danceRoot.row,'the on-duty musician looks at the dance floor');
const expectedFacing=Math.atan2(danceRoot.col-stageTarget.c,danceRoot.row-stageTarget.r)*180/Math.PI; // +X east is 90 degrees.
assert(Math.abs(stageTarget.rotY-expectedFacing)<1e-8,'musician body yaw follows the live dancefloor');
const guestTarget=W.NpcScheduling.override(people[2]);
assert(guestTarget && guestTarget.stationId,'ordinary NPC scheduler chooses a real meal/dance locale station');
assert(W.NpcSharedMeals.diagnostics().bowlSpots>0,'shared NPC meal routine sees the Feast serving stations');
assert(W.NpcSharedMeals.diagnostics().danceSpots>0,'shared NPC dance state machine sees paired floor stations');
assert(saved.length>0,'normal save pipeline records the portions and social rewards');
console.log('Five Blossoms fixed buffet, NPC seats/queues, buffs, tablemate Fun, paired dance, persistence and board removal passed.');
