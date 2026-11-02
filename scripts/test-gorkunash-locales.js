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
let inspectedPot = null; // Records which surface opened the festival inspection; should not consume a serving.
W.FestivalUI={close(){},update(){},openFeast(index){inspectedPot=index;return true;}};
W.AmbientDialogue={showAlcoholOfferResponse(){}};
W.HobunjiActivityEvents={emit(){}};
W.SCRATCHBONES_CONFIG={game:{romance:{likes:{sloomi:['favorite']}}}};
load('festival-potluck-contest'); load('festival-system');
const effective=()=>W.MapLayoutSystem.getEffectiveMapData(town,{dateOrdinal:civilDay,minutes:hour*60,weekday:'Anan'}); // Selected map layout with all locale children.
const layout=effective();
assert.equal(layout.activeLayoutId,'festival_gorkunash');
assert(!layout.decor.some(prop=>prop.activity?.type==='welcome'),'no generic Gorkunash guide board');
assert.equal(layout.decor.filter(prop=>prop.festivalRoadArch).length,6,'town-wide overhead arches');
assert(layout.decor.filter(prop=>prop.festivalRoadArch).every(prop=>prop.key==='festivalArch' && prop.festivalArchWidth>=4), 'road arches use real variable-width furniture, not rug proxies');
const authoredSlots=town.layouts.find(l=>l.id==='festival_gorkunash').decor.reduce((n,root)=>n+(root.festivalLocale?.slots?.length||0),0); // Includes authored buffet queue/service destinations.
assert.equal(layout.npcStations.filter(station=>station.festivalLocaleParent).length,authoredSlots,'all generated locale destinations');
assert.equal(layout.decor.filter(prop=>prop.festivalLocaleParent).length,22,'all generated locale furnishings; the stage now owns its editable platform');
const originalRoot=town.layouts.find(l=>l.id==='festival_gorkunash').decor.find(p=>p.id==='gorkunash_bandstand');
const originalMusic=layout.npcStations.find(station=>station.id==='gorkunash_bandstand:station:foroji');
assert.equal(originalRoot.key,'festivalStage','stage is complete editable furniture');
assert.equal(layout.decor.find(prop=>prop.id==='gorkunash_dancefloor').key,'festivalDanceFloor');
for(const station of layout.npcStations.filter(station=>station.festivalRole==='musician'))assert.equal(station.rotY,90,'both musician shifts face east toward the dance area');
const moved=structuredClone(town);
moved.layouts.find(l=>l.id==='festival_gorkunash').decor.find(p=>p.id==='gorkunash_bandstand').col += 4;
const movedMusic=W.MapLayoutSystem.getEffectiveMapData(moved,{dateOrdinal:civilDay,minutes:hour*60,weekday:'Anan'}).npcStations.find(station=>station.id===originalMusic.id);
assert.equal(movedMusic.col,originalMusic.col+4,'music station follows moved root without a duplicate station list');
assert.equal(originalRoot.col,15,'authored map remains unmutated after expansion');
W.NpcScheduling.stations=layout.npcStations;
const itemDefs={meal:{label:'Special stew',isCookedFood:true,foodEffects:{vigor:2}}},inventory={meal:1};
const buffet=layout.decor.find(p=>p.id==='gorkunash_feast');
let player={c:buffet.col+1,r:buffet.row+1}, aimed={c:buffet.col+1.02,r:buffet.row+.185}, heldMode='item', isSeated=true, queuedBite=null, bowlAnimationCount=0; // Player reticle and held state for bowl targeting and real seated animation checks.
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
function aimSurface(kind,index=0){const placement=servingData.itemPlacements.find(item=>item.service.kind===kind&&(kind!=='meal'||item.service.index===index));aimed={c:buffet.col+2+placement.position.u,r:buffet.row+.5+placement.position.v};return furniture.aimedService('town');}
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
// Shop actions and attendance use the same live window, with no latched early closing time.
load('npc-shop-buttons');
W.NpcShopButtons.init({getCurrentArea:()=> 'map_i_smithy'});
const smith = {rec:{id:'sloomi',homeId:'smithy'}}; // The smithy action must close even before the smith has walked out.
const general = {rec:{id:'furunji_funji',homeId:'general_store'},state:'idle',root:{position:{x:.5,z:.5}},currentScheduleTarget:{c:0,r:0,label:'Counter'}}; // Actual counter proximity used by the general-store action.
const carpenter = {rec:{id:'dzibim_khibu',homeId:'carpenters'},state:'idle',root:{position:{x:.5,z:.5}},currentScheduleTarget:{c:0,r:0,label:'Carpentry Work'}}; // Actual carpentry station used by the carpenter action.
W.SCRATCHBONES_CONFIG.game.mobileControls={generalStoreButton:{stationLabels:['Counter']}};
for (const [testHour,closed] of [[14,false],[14.999,false],[15,true],[23.999,true],[0,true],[.999,true],[1,false],[8,false]]) {
  hour=testHour;
  assert.equal(api.shopsClosedFor(smith.rec),closed,`shop closure at ${hour}`);
  assert.equal(W.NpcShopButtons.isSmithyNpcInBronzeworks(smith),!closed,`smithy action at ${hour}`);
  assert.equal(W.NpcShopButtons.isGeneralStoreNpcOnDuty(general),!closed,`store counter at ${hour}`);
  assert.equal(W.NpcShopButtons.isCarpenterNpcOnDuty(carpenter),!closed,`carpenter counter at ${hour}`);
}
hour=14.999;assert.equal(target('foroji_funji'),null,'stage preparation cannot close the general store before the gathering');
civilDay=1;hour=16;
assert.equal(api.festivalHours(),false,'ordinary afternoons do not activate a festival window');
assert.equal(api.shopsClosedFor(smith.rec),false,'ordinary shop hours remain available');
civilDay=120;
const currentFestival = api.festival(); // Temporary shorter gathering exercises reopening before normal closing time.
currentFestival.gatheringHours={start:13,end:16};
hour=15.999;assert.equal(api.shopsClosedFor(smith.rec),true);
hour=16;assert.equal(api.shopsClosedFor(smith.rec),false,'short gathering releases shops exactly at its end');
assert.equal(target('foroji_funji'),null,'musicians also return to ordinary schedules after an earlier end');
assert.equal(W.NpcShopButtons.isGeneralStoreNpcOnDuty(general),true,'store can resume counter service before 18:00');
general.currentScheduleTarget.label='Home';
assert.equal(W.NpcShopButtons.isGeneralStoreNpcOnDuty(general),false,'festival end never forces an off-duty shopkeeper to trade');
delete currentFestival.gatheringHours;
hour=16;
assert.equal(api.shopsClosedFor({id:'jubmir',homeId:'inn',visitorPresence:{}}),false,'visiting traders keep their own schedule');
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
player={c:buffet.col+1,r:buffet.row+1};hour=17;
assert.equal(api.actionButton(),null,'Gorkunash never becomes an activity input');
assert.equal(aimSurface('bowls').provider.buttons(aimSurface('bowls'))[0].action,'obj_take_bowl','the actual bowl stack offers Take');
hour=17;assert.equal(api.feastMenu().length,7,'six rotating NPC dishes and the reserved player pot');
assert.equal(api.feastMenu()[6].id,'reserved','player pot stays empty before donation');
assert.equal(api.takeFestivalBowl().ok,true);
assert.equal(aimSurface('meal').provider.buttons(aimSurface('meal'))[0].action,'obj_fill_bowl','the actual pot offers Fill');
const inspected = aimSurface('meal',2);
assert(inspected.provider.buttons(inspected).some(button=>button.action==='obj_inspect_meal' && button.allowed),'a dish can be inspected independently of filling the bowl');
const servingsBefore = api.festivalBowl().uses;
assert.equal(inspected.provider.onAction('obj_inspect_meal',inspected).ok,true,'inspect action is wired to the existing furniture service');
assert.equal(inspectedPot,2,'the inspector opens the pot that the player aimed at');
assert.equal(api.festivalBowl().uses,servingsBefore,'inspecting never consumes a bowl serving');
assert.equal(api.feastDishDetails(2).score,api.feastDishDetails(2).ingredientDetails.reduce((sum,item)=>sum+item.points,0),'visible ingredient points explain the contest score');
assert.deepEqual(
  JSON.parse(JSON.stringify(api.feastDishDetails(2).foodEffects)),
  JSON.parse(JSON.stringify(W.FestivalPotluckContest.mealEffects(api.feastDishDetails(2).ingredients,itemDefs))),
  'dish preview displays exactly the effects that festival eating applies'
);

aimSurface('meal',0); // Restore the physical reticle to pot zero after inspecting pot two.
assert.equal(api.fillFestivalBowl(0).ok,true);
assert.equal(api.festivalBowl().uses,10);
// Open the real festival inspection UI without a mouse, console, or browser devtools.
const fakeNodes = Object.fromEntries(['#festivalTitle','#festivalSubtitle','#festivalContent','#festivalStatus']
  .map(id=>[id,{textContent:'',innerHTML:'',hidden:false}]));
const modal = {style:{display:'',setProperty(){}},setAttribute(){},addEventListener(){},
  querySelector(key){return fakeNodes[key] || (key==='button:not(:disabled)'?{focus(){}}:null);}};
context.document.createElement=tag=>tag==='section'?modal:{textContent:'',append(){}};
context.document.head={append(){}};
context.document.body={append(){}};
context.document.activeElement={focus(){}};
context.document.exitPointerLock=()=>{};
W.CalendarSystem.formatCalendarDate=()=> 'Highheat 8';
load('festival-ui');
const surfaceForDetails=aimSurface('meal',0);
assert.equal(surfaceForDetails.provider.onAction('obj_inspect_meal',surfaceForDetails).ok,true,'real modal opens via the actual furniture service');
assert.equal(W.FestivalUI.isOpen(),true,'inspection uses the shared accessible modal');
assert.match(fakeNodes['#festivalContent'].innerHTML,/Ingredient quality and contribution/);
assert.match(fakeNodes['#festivalContent'].innerHTML,/Effects when eaten/);
assert.match(fakeNodes['#festivalContent'].innerHTML,/contest points/);
assert.match(fakeNodes['#festivalContent'].innerHTML,/data-festival-action="inspect-pot"/);
assert.match(fakeNodes['#festivalContent'].innerHTML,/★/);
W.FestivalUI.close();
assert.equal(W.FestivalUI.isOpen(),false,'closing the inspector restores ordinary interactions');

assert.equal(api.eatFestivalBowl().ok,true);
assert.equal(api.festivalFoodStacks('speed'),api.feastDishDetails(0).foodEffects.speed || 0,'festival meal contributes to the live cooking stat');
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
assert.equal(api.feastMenu().length,7,'the seven pots remain after donation');
assert.equal(api.feastMenu()[6].label,'Your Special stew','seventh serving pot permanently holds the contest entry');
const state=api.serialize();
assert(state.feastBuffs[0].remainingHours>0,'meal remaining in-game hours are portable');
api.restore(state);
assert.equal(api.currentFullness(),2,'fullness survives save/load after real drink-strike servings');
assert.equal(api.festivalFoodStacks('speed'),api.feastDishDetails(0).foodEffects.speed || 0,'festival food buff survives save/load');
const originalContest = Object.keys(state.potluckContests)[0]; // Upgrade a prize-entry record written by the initial potluck implementation.
const legacyState = JSON.parse(JSON.stringify(state));
const legacyEntry = legacyState.potluckContests[originalContest].entry;
const previousScore = legacyEntry.score;
delete legacyEntry.ingredients;
delete legacyEntry.foodEffects;
delete legacyEntry.estimatedQuality;
W.HobunjiCookingData.recipes.push({id:'tea_test',slots:[{id:'main',contributesEffects:true},{id:'milk',contributesEffects:false}]});
itemDefs.meal.recipeId = 'tea_test';
itemDefs.meal.festivalIngredientQuality = [{key:'a',stars:5},{key:'b',stars:3}]; // Old quality snapshots had no slot contribution flags.
api.restore(legacyState);
const upgraded = api.feastDishDetails(6);
assert.equal(upgraded.score,previousScore,'migrating previous saves never rerolls the donated meal score');
assert.equal(upgraded.ingredientDetails[0].stars,5,'legacy input quality is retained');
assert.equal(upgraded.ingredientDetails[1].points,3,'structural ingredients continue to count in judging');
assert.equal(Object.keys(upgraded.ingredientDetails[1].effects).length,0,'legacy no-buff slots do not advertise eating effects');
assert.equal(upgraded.foodEffects.vigor,2,'legacy donated meal retains the original cooked eating buff total');
assert.equal(Object.keys(upgraded.foodEffects).length,1,'legacy eating buff has no extra effects');
assert.equal(api.serialize().potluckContests[originalContest].entry.ingredients[1].contributesEffects,false,'migration persists reconstructed slot provenance');

civilDay++;
assert.equal(api.feastMenu().length,7,'the seven-pot layout persists next day');
assert.equal(api.feastMenu()[6].label,'Your Special stew','the player contribution remains on display for the full festival');
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
const danceReplies=[];W.AmbientDialogue={showSocialResponse:(_walker,response)=>danceReplies.push(response)}; // Explicit invitation result uses the same ambient dialogue owner.
assert.equal(api.askFestivalDance(partner).ok,true,'accepted NPC invitation starts the real two-avatar runtime');
assert.equal(pairedStartCount,1);
assert.equal(danceReplies.at(-1).accepted,true);
pairedSeconds=1.15;realMs+=400;api.update();
assert.equal(api.serialize().festivalFun.sloomi,16,'exactly 15 Festival Fun gained for one played second plus saved overnight remainder');
assert.equal(api.diagnostics().festivalWheel.active,true,'pair status is visible in mobile diagnostics');
api.cancelDance();
assert.equal(pairedStopCount,1,'festival cancel cleans up paired actor driver');
favors.set('sloomi',0);assert.equal(api.askFestivalDance(partner).ok,false);assert.equal(danceReplies.at(-1).accepted,false,'refused dance is ambient speech');favors.set('sloomi',120);
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

// A crowd larger than the dining capacity must reserve distinct chairs or stand.
hour=17;realMs+=3000;
for(let i=0;i<38;i++){const rec={id:'crowd-'+i,name:'Guest '+i,homeId:'inn'};residents.push(rec);walkers.push({rec,area:'town',root:{position:{x:20+i%5,z:30+Math.floor(i/5)}},currentScheduleTarget:null});}
const seats=new Set();let standing=0;
for(const rec of residents){
 const next=target(rec.id),walker=walkers.find(w=>w.rec.id===rec.id);walker.currentScheduleTarget=next;
 if(next?.pose==='sit'){
  const key=furniture.seatKey(next.area||'town',next);
  assert(!seats.has(key),'festival crowd never shares a physical seat: '+key);seats.add(key);
 }else if(next?.pose==='stand')standing++;
}
assert(standing>0,'overflow guests without another preferred locale wait standing');
assert(seats.size>0,'available dining chairs are still used');

console.log('Gorkunash locale placement, schedule shifts, seven-pot contest food, potluck, save, and heart conversion passed.');
