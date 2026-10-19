#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Production regression checks for relocatable festival locales.
const fs = require('node:fs'); // Reads the shipped festival and town files instead of duplicate fixture implementations.
const vm = require('node:vm'); // Exercises the browser modules without WebGL or a network.
const town = JSON.parse(fs.readFileSync('docs/config/maps/hobunji_hollow_town.map.json','utf8')); // Authored map under test.
const W = {}; // Shared browser-style global used by the actual production scripts.
const context = vm.createContext({window:W,performance:{now:()=>realMs},document:{hidden:false},console}); // Isolated runtime for all modules.
const load = id => vm.runInContext(fs.readFileSync('docs/js/'+id+'.js','utf8'),context,{filename:id}); // Execute actual shipped code.
let civilDay = 120, hour=16, realMs=1000, persisted=0; // Independent civil time and real duration clocks.
const favors = new Map([['foroji_funji',120],['kaboku_kunji',80],['sloomi',120],['friend',80]]); // Heart-sized Favor test values.
const awarded = []; // Tracks real potluck gifts and Festival Fun rollover.
const residents = [
 {id:'foroji_funji',name:'Foroji',homeId:'carpenters'},
 {id:'kaboku_kunji',name:'Kaboku',homeId:'potion_shop'},
 {id:'sloomi',name:'Sloomi',homeId:'inn',relationship:{canDate:true}},
 {id:'friend',name:'Friend',homeId:'inn'},
]; // Both musician hosts, a romanceable dancer, and a dining guest.
const walkers = residents.map(rec=>({rec,area:'town',state:'idle',root:{position:{x:47,z:43}},currentScheduleTarget:null})); // Simulated existing walkers with positions.
load('festival-calendar');load('map-layout-system'); // Load before injecting CalendarSystem, avoiding wrapping an incomplete stub.
W.CalendarSystem={
 isInitialized:()=>true,monthNumber:()=>Math.floor((civilDay-1)/28)+1,dayOfMonth:()=>((civilDay-1)%28)+1,
 aotYearNumber:()=>1156,getHour:()=>hour,currentWeekdayName:()=> 'Anan'
}; // Same public civil-day contract used by production.
W.HobunjiCookingData={
 recipes:[{id:'stew',name:'Stew',baseOutputName:'Stew',slots:[{accepts:['vegetable']},{accepts:['meat']}]}],
 items:{a:{id:'a',categories:['vegetable'],primaryEffect:'speed',baseBoost:1},b:{id:'b',categories:['meat'],primaryEffect:'vigor',baseBoost:1}}
}; // Small valid subset of the actual cooking data API.
W.NpcScheduling={registerTargetOverride(_id,fn){this.override=fn},resolveNpcStationTarget(id){return this.stations?.find(s=>s.id===id)||null}};
W.EffectBuffBar={registerProvider(){},refresh(){}};
W.NpcWardrobe={registerAppearanceDecorator(){}};
W.CookingSystem={registerExternalFoodProvider(_id,fn){this.external=fn},availableQualityEntries:()=>[{stars:5,count:1}],consumeQuality:()=>true};
W.NpcGifting={evaluateHeldGift:rec=>({tier:rec.id==='friend'?'disliked':'liked',favorDelta:rec.id==='friend'?-4:4})};
W.DialogueContent={getNpcDlgState:id=>({favor:favors.get(id)||0}),adjustNpcFavor:(id,amount,reason)=>{awarded.push({id,amount,reason});favors.set(id,(favors.get(id)||0)+amount);}};
W.NpcRapport={get:()=>250};
W.SocialActionWheel={startDance:()=>true,stopDance(){},getDebug:()=>({dancing:true})};
W.FestivalUI={close(){},update(){}};
W.AmbientDialogue={showAlcoholOfferResponse(){}};
W.HobunjiActivityEvents={emit(){}};
W.SCRATCHBONES_CONFIG={game:{romance:{likes:{sloomi:['favorite']}}}};
load('festival-system');
const effective=()=>W.MapLayoutSystem.getEffectiveMapData(town,{dateOrdinal:civilDay,minutes:hour*60,weekday:'Anan'}); // Selected map layout with all locale children.
const layout=effective();
assert.equal(layout.activeLayoutId,'festival_gorkunash');
assert(!layout.decor.some(prop=>prop.activity?.type==='welcome'),'no generic Gorkunash guide board');
assert.equal(layout.decor.filter(prop=>prop.festivalRoadArch).length,6,'town-wide overhead arches');
assert(layout.decor.filter(prop=>prop.festivalRoadArch).every(prop=>prop.key==='festivalArch' && prop.festivalArchWidth>=4), 'road arches use real variable-width furniture, not rug proxies');
assert.equal(layout.npcStations.filter(station=>station.festivalLocaleParent).length,31,'all generated locale destinations');
assert.equal(layout.decor.filter(prop=>prop.festivalLocaleParent).length,22,'all generated locale furnishings');
const originalRoot=town.layouts.find(l=>l.id==='festival_gorkunash').decor.find(p=>p.id==='gorkunash_bandstand');
const originalMusic=layout.npcStations.find(station=>station.id==='gorkunash_bandstand:station:foroji');
const moved=structuredClone(town);
moved.layouts.find(l=>l.id==='festival_gorkunash').decor.find(p=>p.id==='gorkunash_bandstand').col += 4;
const movedMusic=W.MapLayoutSystem.getEffectiveMapData(moved,{dateOrdinal:civilDay,minutes:hour*60,weekday:'Anan'}).npcStations.find(station=>station.id===originalMusic.id);
assert.equal(movedMusic.col,originalMusic.col+4,'music station follows moved root without a duplicate station list');
assert.equal(originalRoot.col,42,'authored map remains unmutated after expansion');
W.NpcScheduling.stations=layout.npcStations;
const itemDefs={meal:{label:'Special stew',isCookedFood:true,foodEffects:{vigor:2}}},inventory={meal:1};
let player={c:47,r:43}, aimed={c:47.02,r:43.185}, heldMode='item', isSeated=true, queuedBite=null, bowlAnimationCount=0; // Player reticle and held state for bowl targeting and real seated animation checks.
let currentSeat=null; // Player's actual ordinary chair, shared with table membership and meal company.
load('furniture-table-system');
const furniture=W.FurnitureTableSystem; // Production area/table/targeting authority.
furniture.init({getArea:()=> 'town',getWalkers:()=>walkers,getPlayerSeat:()=>isSeated&&currentSeat?{...currentSeat,phase:'active'}:null,
 getPlayerPosition:()=>({x:player.c,z:player.r}),getAim:()=>aimed,
 makeSitInteractable:()=>({getButtons:()=>[{action:'obj_sit',label:'Sit',allowed:true}],onAction:()=>({ok:true})})});
const servingData=JSON.parse(fs.readFileSync('docs/config/furniture-authored/servingTable.json','utf8')); // Same surface placements loaded by the live furniture renderer.
for(const record of layout.decor){
 const size={fw:record.key==='servingTable'?4:record.key==='rug'?2:1,fd:record.key==='rug'?2:1,sit:record.key==='chairSimple'};
 const root={parent:{},position:{x:record.col+size.fw/2,z:record.row+size.fd/2},userData:{}};
 if(record.serviceId)root.userData.authoredItemPlacements={children:servingData.itemPlacements.map(placement=>({userData:{surfacePlacement:placement},getWorldPosition(out){out.x=root.position.x+placement.position.u;out.z=root.position.z+placement.position.v;return out;}}))};
 furniture.registerPlacement('town',record,root,size);
}
function aimSurface(kind,index=0){const placement=servingData.itemPlacements.find(item=>item.service.kind===kind&&(kind!=='meal'||item.service.index===index));aimed={c:48+placement.position.u,r:43.5+placement.position.v};return furniture.aimedService('town');}
const api=W.FestivalSystem;
api.init({getTownMap:()=>town,getNpcs:()=>residents,getWalkers:()=>walkers,getArea:()=> 'town',
 getPlayerTile:()=>player,getDecorSize:key=>({fw:['tableLong','servingTable'].includes(key)?4:key==='rug'?2:1,fd:key==='rug'?2:1}),
 getItemDefs:()=>itemDefs,inventory,save(){persisted++},refresh(){},toast(){},isBlocked:()=>false,
 getPlayerSeatedSeat:()=>currentSeat,getHeldMealChoice:()=>({key:'meal',stars:5}),getAimPosition:()=>aimed,getActiveItemKey:()=> 'meal',getHeldMode:()=>heldMode,isPlayerSeated:()=>isSeated,
 equipFestivalBowl:()=>{heldMode='item';},
 playFestivalBowlDrink:cb=>{bowlAnimationCount++;queuedBite=cb;return true;}});
const target=id=>W.NpcScheduling.override(residents.find(rec=>rec.id===id)); // Existing schedule override, not a copied planner.
hour=12;assert.equal(target('foroji_funji'),null,'festival schedules do not replace ordinary daytime work');
hour=16;assert.equal(target('foroji_funji').toolKey,'kurraya','Foroji leads early');
assert.equal(target('foroji_funji').festivalLocaleKind,'bandstand');
assert.equal(target('friend').festivalLocaleKind,'dining','nonromance guests favor feast');
hour=21;assert.equal(target('kaboku_kunji').toolKey,'kurraya','Kaboku leads late');
hour=0;assert.equal(target('kaboku_kunji').toolKey,'kurraya','music continues after midnight');
hour=1;assert.equal(target('foroji_funji'),null,'festival gathering ends at 1 AM');
// Approaching the active feast without a bowl must never abort gameplay's action-button pass.
// Its eight-tile activity radius also overlaps the nearby bandstand.
for (const festivalHour of [14.999, 15, 17, 23.999, 0.999, 1]) {
  hour=festivalHour;
  for (const position of [{c:56.01,r:43.5},{c:55.99,r:43.5},{c:43,r:43}]) {
    player=position;
    assert.doesNotThrow(()=>api.actionButton(),`empty-handed approach at ${hour}h (${player.c},${player.r})`);
    assert.notEqual(api.actionButton()?.action,'festival_fill_bowl','taking a bowl is required before offering Fill');
  }
}
player={c:47,r:43};hour=17;
assert.equal(api.actionButton(),null,'Gorkunash never becomes an activity input');
assert.equal(aimSurface('bowls').provider.buttons(aimSurface('bowls'))[0].action,'obj_take_bowl','the actual bowl stack offers Take');
hour=17;assert.equal(api.feastMenu().length,5,'five free pots leave room for the first offering');
assert.equal(api.takeFestivalBowl().ok,true);
assert.equal(aimSurface('meal').provider.buttons(aimSurface('meal'))[0].action,'obj_fill_bowl','the actual pot offers Fill');
assert.equal(api.fillFestivalBowl(0).ok,true);
assert.equal(api.festivalBowl().uses,10);
assert.equal(api.eatFestivalBowl().ok,true);
assert.equal(api.festivalFoodStacks('speed'),1,'festival meal contributes to the live cooking stat');
assert.equal(api.festivalBowl().uses,9);
assert.equal(api.currentFullness(),1);
const seat=layout.decor.find(p=>p.festivalLocaleParent==='gorkunash_feast' && p.key==='chairSimple');
assert(seat,'dining locale contains a real authored chair mesh');
player={c:seat.col+.5,r:seat.row+.5};
currentSeat=seat;
assert.equal(furniture.objectAt('town',Math.floor(seat.col),Math.floor(seat.row))?.getButtons()[0].action,'obj_sit','outdoor chair uses the ordinary Sit interaction');
assert.equal(api.isDiningSeat(seat.col,seat.row,seat.key),true,'seated identity is bound to the festival locale furniture');
assert.equal(api.actionButton(),null,'there is no festival-specific table-sitting input');
assert.equal(api.seatedMealAction()?.swigFraction,'9/10','eating shows bottle-style portion count on the arch');
assert.equal(api.toggleSeatedMeal().ok,true);
realMs+=600;api.update();
assert.equal(bowlAnimationCount,1,'festival meal starts exactly one authored drink animation');
const guest=walkers.find(w=>w.rec.id==='friend');
const sameSeat=layout.npcStations.find(st=>st.id==='gorkunash_feast:station:seat_1');
guest.currentScheduleTarget={...sameSeat,c:sameSeat.col,r:sameSeat.row};
guest.root.position={x:sameSeat.col+.5,z:sameSeat.row+.5}; // Simulates another villager already sitting at the very same dining table.
assert.equal(api.currentFullness(),1,'no bowl portion is consumed before drink-strike callback');
queuedBite();
assert.equal(api.currentFullness(),2,'drink strike commits exactly one serving');
assert.equal(api.serialize().festivalFun.friend,25,'only the arrived guest sharing the table gains 25 Festival Fun');
assert.equal(api.festivalBowl().uses,8);
realMs+=1000;api.update();
assert.equal(bowlAnimationCount,1,'drinks are spaced by the authored bite interval');
isSeated=false;api.update();
assert.equal(api.seatedMealAction(),null,'standing immediately removes seated meal action');
heldMode='tool';realMs+=600;api.update();
assert.equal(api.festivalBowl(),null,'drawing a different tool drops the temporary serving bowl');
player={c:47,r:43};isSeated=true;heldMode='item';
const potluck=aimSurface('meal');
assert.equal(potluck.provider.onAction('obj_contribute_meal',potluck).ok,true,'contribute the normal held meal directly to its serving pot');
assert(!awarded.some(e=>e.id==='friend'&&e.reason==='festival_potluck'),'disliked meal is neutral');
assert(awarded.some(e=>e.id==='kaboku_kunji'&&e.amount===40&&e.reason==='festival_potluck'),'liked meal gives tenfold Favor');
assert.equal(api.feastMenu().length,6,'donated dish fills reserved sixth pot immediately');
assert.equal(api.feastMenu()[5].label,'Special stew','sixth serving pot contains the supplied meal, not a random one');
const state=api.serialize();
assert(state.feastBuffs[0].remainingS>0,'meal remaining duration is portable');
api.restore(state);
assert.equal(api.currentFullness(),2,'fullness survives save/load after real drink-strike servings');
assert.equal(api.festivalFoodStacks('speed'),1,'festival food buff survives save/load');
civilDay++;
assert.equal(api.feastMenu().length,6,'the sixth pot is filled with a new meal next day');
api.addFestivalFun('sloomi',201);
api.update();
civilDay++;
realMs+=1000;api.update();
assert(awarded.some(e=>e.id==='sloomi'&&e.amount===40&&e.reason==='festival_fun_rollover'),'200 Festival Fun converts to a heart after midnight');
assert.equal(api.serialize().festivalFun.sloomi,1,'leftover Festival Fun is preserved');
assert(persisted>0,'activities persist through existing save hook');
assert.equal(W.MapLayoutSystem.getEffectiveMapData(town,{dateOrdinal:1}).decor.length,town.decor.length,'base town untouched outside festivals');
let pairedActive=false, pairedSeconds=0, pairedStartCount=0, pairedStopCount=0; // Verify social invitation uses the dedicated two-avatar driver, not the solo-wheel fallback.
W.FestivalWheelDanceRuntime={
 start(walker,model){ assert.equal(walker.rec.id,'sloomi'); pairedActive=true;pairedStartCount++;return true; },
 activeFor:id=>pairedActive&&id==='sloomi',
 elapsedSeconds:id=>pairedActive&&id==='sloomi'?pairedSeconds:0,
 stop(){pairedActive=false;pairedStopCount++;return true;},
 diagnostics:()=>({active:pairedActive}),
};
W.SocialActionWheel.startDance=()=>{throw Error('festival NPC dance must not use solo social wheel');};
const partner=walkers.find(walker=>walker.rec.id==='sloomi');
partner.currentScheduleTarget={festivalLocaleKind:'dance'};
partner.root.position={x:37,z:42};player={c:37,r:42};hour=17;
api.init({getTownMap:()=>town,getNpcs:()=>residents,getWalkers:()=>walkers,getArea:()=> 'town',
 getPlayerTile:()=>player,getPlayerMesh:()=>({name:'player-root'}),getDecorSize:key=>({fw:['tableLong','servingTable'].includes(key)?4:key==='rug'?2:1,fd:key==='rug'?2:1}),
 getItemDefs:()=>itemDefs,inventory,save(){persisted++},refresh(){},toast(){},isBlocked:()=>false});
assert.equal(api.askFestivalDance(partner).ok,true,'accepted NPC invitation starts the real two-avatar runtime');
assert.equal(pairedStartCount,1);
pairedSeconds=1.15;realMs+=400;api.update();
assert.equal(api.serialize().festivalFun.sloomi,16,'exactly 15 Festival Fun gained for one played second plus saved overnight remainder');
assert.equal(api.diagnostics().festivalWheel.active,true,'pair status is visible in mobile diagnostics');
api.cancelDance();
assert.equal(pairedStopCount,1,'festival cancel cleans up paired actor driver');
realMs+=400;api.update();
assert.equal(api.serialize().festivalFun.sloomi,16,'interrupted paired dance cannot continue accruing Festival Fun');

// Solo wheel participation is spatial, not tied to a festival rug or bandstand.
let wheelDancing=true, musicPlaying=false;
W.SocialActionWheel.isDancing=()=>wheelDancing;
W.MusicMinigame={get state(){return {active:musicPlaying};}};
player={c:10,r:10};partner.root.position={x:11,z:10};
const beforeWheel=api.serialize().festivalFun.sloomi;
const otherBefore=api.serialize().festivalFun.friend||0;
function playSecond(){for(let i=0;i<4;i++){realMs+=250;api.update();}}
playSecond();
assert.equal(api.serialize().festivalFun.sloomi,beforeWheel+15,'existing solo wheel dance works away from festival locales');
assert.equal(api.serialize().festivalFun.friend||0,otherBefore,'distant villagers receive no participation points');
wheelDancing=false;musicPlaying=true;playSecond();
assert.equal(api.serialize().festivalFun.sloomi,beforeWheel+30,'existing instrument wheel session shares the same nearby participation');
musicPlaying=false;playSecond();
assert.equal(api.serialize().festivalFun.sloomi,beforeWheel+30,'stopped wheel sessions cannot accrue points');
wheelDancing=true;hour=1;playSecond();
assert.equal(api.serialize().festivalFun.sloomi,beforeWheel+30,'festival end stops participation without blocking ordinary wheel actions');

console.log('Gorkunash locale placement, schedule shifts, six-pot food, potluck, save, and heart conversion passed.');
