'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const game = fs.readFileSync('docs/game.js', 'utf8');
const onboarding = fs.readFileSync('docs/onboarding-core.js', 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
function functionSource(source, name, indent) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `production function ${name} exists`);
  const end = source.indexOf(`\n${indent}function `, start + 1);
  assert(end > start, `production function ${name} has a following declaration`);
  return source.slice(start, end);
}

let civilDay = 127, civilYear = 1156, clockMs = 3000, provider, writes = 0;
let definitionsReady = true, residentsReady = true;
const residents = [{id:'hreesh',homeId:'inn',speciesId:'engh-sho'}, {id:'teacup_unumanuk',homeId:'unumanuk_household',speciesId:'engh-sho'}];
const W = {
  CalendarSystem:{isInitialized:()=>true,aotYearNumber:()=>civilYear,
    monthNumber:()=>Math.floor((civilDay-1)/28)+1,dayOfMonth:()=>((civilDay-1)%28)+1,getHour:()=>16},
  NpcWardrobe:{registerAppearanceDecorator(){}},NpcScheduling:{registerTargetOverride(){}},
  EffectBuffBar:{registerProvider(){},refresh(){}},SocialActionWheel:{stopDance(){}},
  FestivalUI:{close(){}},CookingSystem:{},DoorstepVisits:{registerProvider:p=>provider=p,markDone(){}},
  MapLayoutSystem:{resolveActiveLayout:()=>null,getEffectiveMapData:raw=>raw},
};
const context = vm.createContext({window:W,performance:{now:()=>clockMs},document:{hidden:false},console});
for (const name of ['cooking-data','festival-calendar','festival-potluck-contest','festival-system'])
  vm.runInContext(fs.readFileSync(`docs/js/${name}.js`,'utf8'), context, {filename:name});
const defs = Object.fromEntries(Object.entries(W.HobunjiCookingData.items).map(([key,item])=>[key,{label:item.name,cookingProcessingTier:item.processingTier||'raw'}]));
defs.processed = {cookingProcessingTier:'medium'};
defs.meal = {label:'Test Pie',isCookedFood:true,festivalContestScore:50,
  festivalIngredientQuality:Array.from({length:5},()=>({key:'processed',stars:5,contributesEffects:true})),foodEffects:{vigor:2}};
const api = W.FestivalSystem, rules = W.FestivalPotluckContest;
api.init({getItemDefs:()=>definitionsReady?defs:{},getNpcs:()=>residentsReady?residents:[],
  getWalkers:()=>[],getTownMap:()=>({decor:[]}),getArea:()=> 'farm',inventory:{},save:()=>writes++,grantMask:()=>true});
const days = rules.buildDays(residents,1156,defs);
const entry = {key:'meal',stars:5,label:'Test Pie',score:50,ingredients:defs.meal.festivalIngredientQuality,foodEffects:{vigor:2}};
const claim = {potluck:{key:'meal',stars:5,day:1156*336+122}};
const savedFestivals = {claims:{'1156:gorkunash':claim},potluckContests:{'1156:gorkunash':{days,entry,rewarded:false}}};

// Follow the actual save-selection handoff, restore, and gameplay-save callbacks.
const member = {festivals:clone(savedFestivals),cookingState:{cookedDefinitions:{meal:defs.meal}},
  nonGearInventory:{},packClothing:[],questProgress:{},doorstepVisitState:{done:{other_visit:1}}};
const char = {id:'char_test',playerId:'player_test',stats:{},gearInventory:{},skillLevels:{}};
const world = {id:'world_test',ownerCharacterId:char.id,label:'Test Farm',members:{[char.id]:member}};
const meta = {characters:[char],worlds:[world]};
const boot = {_selCharId:char.id,_selWorldId:world.id,_saveMeta:meta,_el:{classList:{add(){}}},window:{},
  document:{dispatchEvent(){}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},
  setTimeout(){},removeOnboardingOverlay(){},saveSaveMeta(){},saveProfile(){},isWorldOwner:()=>true,getFarmhandPermissions:()=>({})};
vm.createContext(boot);
for (const name of ['worldsForCharacter','ensureWorldMember','_playSaveSelect'])
  vm.runInContext(functionSource(onboarding,name,'  '),boot);
boot._playSaveSelect();
const playerData = boot.window.__hobunjiPlayerProfile;
assert.deepEqual(clone(playerData.festivals),clone(savedFestivals),'normal Play must pass festival state into gameplay');
api.restore(playerData.festivals);
assert.equal(provider.next()?.npcId,'hreesh','a winning entry still queues Hreesh after a normal reload');
const emptyObject = ()=>({}), emptyArray = ()=>[];
Object.assign(W,{__hobunjiPlayerProfile:playerData,
  DialogueContent:{npcRelationshipsSnapshot:emptyObject,npcFavorRescaleApplied:()=>true},
  AlchemySystem:{serializeKnownEffects:emptyObject,serializeKnownRecipes:emptyArray,serializeActiveEffects:emptyArray},
  ReagentPlants:{serializeZoneReagentState:emptyObject},CookingSystem:{serialize:()=>playerData.cookingState},
  WildBerries:{serializeState:emptyObject},WildTreasure:{serializeState:emptyObject}});
const storage = new Map([['hobunjiSaveMeta',JSON.stringify(meta)]]);
const captureContext = vm.createContext({window:W,localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
  _tothalWorldId:()=>world.id,_playerData:playerData,defaultWorldMemberState:emptyObject,inventory:{},packClothing:[],questProgress:{},
  serializeWildernessChunkState:emptyObject,serializeZoneFelledTreeState:emptyObject,serializeZoneMinedRockState:emptyObject,
  currentArea:'interior',player:{x:1,y:1,angle:0}});
for (const name of ['captureMemberWorldData','saveMemberWorldData'])
  vm.runInContext(functionSource(game,name,'      '),captureContext);
captureContext.saveMemberWorldData();
const resaved = JSON.parse(storage.get('hobunjiSaveMeta')).worlds[0].members.char_test;
assert.deepEqual(resaved.festivals.potluckContests,clone(savedFestivals.potluckContests),'the next gameplay save must retain the winning entry and original roster');
assert.deepEqual(resaved.festivals.claims,clone(savedFestivals.claims));
api.restore(resaved.festivals);
const visit = provider.next();
assert(provider.onComplete(visit));
assert.equal(provider.next(),null,'a completed award does not repeat');
const awardedSave = api.serialize();
api.restore(awardedSave);
assert.equal(provider.next(),null,'the completed reward flag survives reload');

// Legacy claims recover after the festival, without opening the town feast UI.
api.restore({claims:{'1156:gorkunash':claim},potluckContests:{}});
assert.equal(api.feastMenu().length,0,'the feast remains closed after Gorkunash');
assert.equal(provider.next()?.npcId,'hreesh','an overdue donation recovers during the doorstep eligibility check');
const recovered = api.serialize().potluckContests['1156:gorkunash'];
assert.equal(recovered.entry.score,50);
assert.deepEqual(clone(recovered.days),clone(days),'recovery uses the original festival year for seeded opponents');
const previousWrites = writes;
provider.next();
assert.equal(writes,previousWrites,'repeated doorstep checks do not resave or reroll a recovered entry');

// Existing rolls, result flags, and an already-recorded score are authoritative.
const legacyRoster = clone(days); legacyRoster[0][0].score = 12;
api.restore({claims:{'1156:gorkunash':claim},potluckContests:{'1156:gorkunash':{days:legacyRoster,entry:null,rewarded:true}}});
assert.equal(provider.next(),null,'recovering an already-awarded entry never creates another prize');
assert.deepEqual(clone(api.serialize().potluckContests['1156:gorkunash'].days),legacyRoster,'existing opponent rolls are never regenerated');
api.restore({claims:{'1156:gorkunash':claim},potluckContests:{'1156:gorkunash':{days,entry:{...entry,score:47},rewarded:false}}});
provider.next();
assert.equal(api.serialize().potluckContests['1156:gorkunash'].entry.score,47,'recorded contest scores are not recalculated from a newer item definition');

// Hydration may reach festival restoration before cooking definitions/residents.
definitionsReady = false;
api.restore({claims:{'1156:gorkunash':claim},potluckContests:{}});
assert.equal(provider.next(),null);
assert.equal(Object.keys(api.serialize().potluckContests).length,0,'missing cooking definitions cannot create a guessed one-star donation');
definitionsReady = true; residentsReady = false; clockMs += 3000;
assert.equal(provider.next(),null);
assert.equal(Object.keys(api.serialize().potluckContests).length,0,'an empty NPC loader cannot freeze an invented fallback roster');
residentsReady = true; clockMs += 3000;
assert.equal(provider.next()?.npcId,'hreesh','recovery retries once the original inputs are ready');

// A claim from an earlier civil year remains eligible and uses that year's seed.
civilYear = 1157; civilDay = 1;
api.restore({claims:{'1156:gorkunash':claim},potluckContests:{}});
assert.equal(provider.next()?.event,'1156:gorkunash');
assert.deepEqual(clone(api.serialize().potluckContests['1156:gorkunash'].days),clone(days));
civilYear = 1156; civilDay = 126;
api.restore({claims:{'1156:gorkunash':claim},potluckContests:{}});
assert.equal(provider.next(),null,'recovery cannot award a prize on the last festival day');
civilDay++;
assert.equal(provider.next()?.npcId,'hreesh','the next civil day unlocks the recovered prize');

// Entirely lost claims cannot be inferred from merely owning/cooking a strong pie.
api.restore({claims:{},potluckContests:{}});
assert.equal(provider.next(),null);
assert.equal(Object.keys(api.serialize().potluckContests).length,0,'never fabricate a submission from a cooked item definition');
console.log('Festival save-selection round trip, award persistence, overdue multi-year recovery, and hydration retry passed.');
