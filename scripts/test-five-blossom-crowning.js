#!/usr/bin/env node
'use strict';
// Full annual Five Blossoms award lifecycle using the shipped modules, real character/world metadata,
// actual quest item grants, canonical gear equipment and Director-format ceremony staging.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(ROOT,relative),'utf8'); // Loads the actual scripts used by the game.
const layout=JSON.parse(read('docs/config/maps/hobunji_hollow_town.map.json')).layouts.find(l=>l.id==='festival_five_blossoms');
const stage=layout.decor.find(item=>item.key==='festivalStage'&&item.festivalLocale?.kind==='bandstand');
assert(stage,'the authored Five Blossoms bandstand must exist');
const scenery=read('docs/js/foliage-generator.js'); // Foliage source is the ground truth for the large stamped trees.
assert.match(scenery,/leafTexture:'assets\/leaves\/leaf_1\.png'/,'blossom foliage uses the existing berry-bush leaf PNG');
assert.match(scenery,/const texture = petals \? 'assets\/leaves\/leaf_1\.png'/,'petal color fill still uses the transparent bush-leaf PNG');
const festivalScript=read('docs/js/festival-system.js'); // Regression for the existing NPC action route, not an invented board UI.
assert.match(festivalScript,/father_hunundi_hodu'[\s\S]{0,200}festival_npc_gift/,'Father Hunundi offers the canonical festival NPC action');
assert.match(festivalScript,/FestivalBlossomHunt\?\.turnInAtHunundi/,'Father Hunundi action executes the real hunt submission');

let civilYear=1156,area='town',tile=null,listener=null,cutscenes=0,gearSaves=0,avatarRefresh=0,questsSaved=0,scheduleInvalidations=0;
let failNextCompletionSave=false; // Simulates a transient quest-persistence failure after the ceremony has already saved its physical reward.
const initial={characters:[
  {id:'owner',nickname:'Naku',gearInventory:{keyItems:[],clothingItems:[],
    clothing:{hat:{uid:'old-hat',cosmeticId:'appearance::hat::old_highlands_kasa',slot:'hat'},
      hood:{uid:'old-hood',cosmeticId:'simple_hood',slot:'hood'}}}},
  {id:'farmhand',nickname:'Pell',gearInventory:{keyItems:[],clothingItems:[],
    clothing:{hat:{uid:'farmhand-hat',cosmeticId:'appearance::hat::basic_headband',slot:'hat'},
      hood:{uid:'facewrap',cosmeticId:'facewrap',slot:'hood'}}}}
],worlds:[{id:'world-one'}]};
let save=JSON.stringify(initial);
const localStorage={getItem(key){return key==='hobunjiSaveMeta'?save:null;},setItem(key,value){if(key==='hobunjiSaveMeta')save=String(value);}};
const getMeta=()=>JSON.parse(save); // Local persisted snapshot is the source of truth across character changes.
const byChar=new Map(); // Per-character quest progress mirrors the actual member-owned QuestProgressStore.
const zoneId={cyan:'map_northern_cliffs',white:'map_western_slope',gold:'map_western_slope',
  amber:'map_southern_cloud_forest',rose:'map_southern_cloud_forest'};
const names=['cyan','white','gold','amber','rose']; // The five authored physical tree sites.
const layouts=new Map();
const treeLocation={cyan:[13,15],white:[22,24],gold:[38,35],amber:[25,28],rose:[42,39]};
for(const id of names){
  const zone=zoneId[id];if(!layouts.has(zone))layouts.set(zone,{cols:80,rows:80,tiles:[],localeInstances:[]});
  const [col,row]=treeLocation[id];
  layouts.get(zone).localeInstances.push({localeId:'locale_five_blossoms_'+id,objects:[{key:'blossom-tree',x:col,y:row}]});
}
const walkers=[
  {rec:{id:'father_hunundi_hodu',name:'Father Hunundi'},area:'town',root:{position:{x:33,z:42}}},
  {rec:{id:'foroji_funji',name:'Foroji'},area:'town',root:{position:{x:31,z:41}}},
  {rec:{id:'kaboku_kunji',name:'Kaboku'},area:'town',root:{position:{x:32,z:41}}},
  {rec:{id:'fallen_villager',name:'Retired',dead:true},area:'town',root:{position:{x:35,z:41}}}
]; // Only living villagers form the temporary crowd; no NPC independently searches for blossoms.
const claims=[],audienceShots=[],announcements=[],toasts=[];
const sceneGraph={children:[],add(root){this.children.push(root);root.parent=this;},remove(root){this.children=this.children.filter(r=>r!==root);}};
const W={
  __hobunjiPlayerProfile:null,localStorage,
  CalendarSystem:{aotYearNumber:()=>civilYear,isInitialized:()=>true},
  FestivalCalendar:{current:()=>({id:'five_blossoms'})},
  FestivalProps:{blossomWindowSwatches:['#00ffff','#ff8000','#ffffff','#ffbf00','#ffb3b3'].map(color=>({color}))},
  LocaleRiddleGenerator:{positionOf(instance){const o=instance.objects[0];return {col:o.x,row:o.y};}},
  PlayerTileEvents:{current:()=>tile,subscribe(fn){listener=fn;return()=>{if(listener===fn)listener=null;};}},
  GameplayInputRouter:{setClaims(id,rows){claims.push({id,active:rows?.length||0});},clearClaims(id){claims.push({id,active:0});}},
  QuestProgressStore:{
    snapshot(){const id=W.__hobunjiPlayerProfile?.characterId||'anonymous';return byChar.get(id)||{};},
    setStatus(id,status,progress){
      if (status==='completed' && failNextCompletionSave) { failNextCompletionSave=false; return false; }
      const who=W.__hobunjiPlayerProfile?.characterId||'anonymous',records=byChar.get(who)||{};
      records[id]={status,progress:{...(records[id]?.progress||{}),...progress}};byChar.set(who,records);
      questsSaved++;return true;
    }
  },
  DevCompanion:{registerStateProvider(){}},
  GridTileAccessors:{getActiveScene:()=>sceneGraph},
  ClimbSystem:{groundYAt:()=>0},
  FoliageGenerator:{buildPottedBlossomTreeMesh(){return {
    userData:{},position:{set(){}},scale:{multiplyScalar(){}},
    traverse(callback){callback({geometry:{},userData:{}});}
  };}},
  NpcScheduling:{registerTargetOverride(id,fn,priority){audienceShots.push({owner:id,fn,priority});},invalidateTargetDecisions(){scheduleInvalidations++;}},
  LocalDBOverrides:{async loadDatabase(){return {npcs:walkers.map(w=>({id:w.rec.id,name:w.rec.name}))};}},
  CharacterActionLocks:{acquire(){return {release(){}};}},
  AmbientDialogue:{cheer(){}},
  __farmLog() {}
};
const ctx=vm.createContext({window:W,localStorage,console,Map,Set,Promise,Date,Math,JSON,Number,String,Array,Object});
function load(file){vm.runInContext(read(file),ctx,{filename:file});} // Same scripts served to browsers; no reimplemented prize behavior.
for(const file of ['docs/js/world-meta-store.js','docs/js/key-item-system.js','docs/js/equipment-panel.js',
  'docs/js/festival-blossom-ceremony.js','docs/js/festival-blossom-hunt.js'])load(file);
const equipment=W.EquipmentPanel;
function login(id){
  const character=getMeta().characters.find(entry=>entry.id===id);
  W.__hobunjiPlayerProfile={characterId:id,worldId:'world-one',nickname:character.nickname,
    gearInventory:JSON.parse(JSON.stringify(character.gearInventory))};
  equipment.__test.setCrownTestDeps({
    getGearInventory:()=>W.__hobunjiPlayerProfile.gearInventory,
    saveGearInventory(){
      const meta=getMeta(),record=meta.characters.find(c=>c.id===W.__hobunjiPlayerProfile.characterId);
      record.gearInventory=JSON.parse(JSON.stringify(W.__hobunjiPlayerProfile.gearInventory));
      localStorage.setItem('hobunjiSaveMeta',JSON.stringify(meta));gearSaves++;
    },
    refreshPlayerAvatar(){avatarRefresh++;}
  });
}
const mapDeps={_zoneLayouts:layouts,TILE:64,getCurrentArea:()=>area,currentTothalYear:()=>1156,
  tothalWorldId:()=> 'world-one',showToast(message){toasts.push(message);}};
W.FestivalBlossomCeremony.init({getLayout:()=>layout,getWalkers:()=>walkers,getArea:()=>area});
let activeScene=null;
W.AuthoredCutsceneRuntime={
  async run(scene,options){
    cutscenes++;activeScene=scene;
    const crowning=scene.stages.find(step=>step.id==='blossom_crown_proclaim');
    assert(crowning && scene.stages.some(step=>step.id==='blossom_crown_reveal'));
    assert.equal(scene.mapId,'map_hobunji_town','Director uses the authored town map, not the runtime town area alias');
    assert.equal(scene.actors[0].name,W.__hobunjiPlayerProfile.nickname);
    assert.equal(scene.actors[1].npcId,'father_hunundi_hodu');
    assert.equal(scene.actors[0].worldR,Number(stage.row)+1.05);
    assert.equal(equipment.devWornClothing().hat,null,'hat is hidden before ceremony');
    const hood=equipment.devWornClothing().hood;
    assert(W.__hobunjiPlayerProfile.characterId==='farmhand' ? hood?.cosmeticId==='facewrap' : hood===null,
      'only the facewrap may remain worn during a first-Finder ceremony');
    const crowd=W.FestivalBlossomCeremony.snapshot();
    assert.equal(crowd.crowdCount,2,'all living villagers in the sample are gathered, not the deceased');
    for(const w of walkers.slice(1,3)) {
      const target=audienceShots[0].fn(w.rec);
      assert.equal(target?.pose,'stand');assert.equal(target?.rotY,180,'crowd looks north at raised stage');
    }
    announcements.push(crowning.text);
    options.onDialogueContinue(crowning);
    assert.equal(equipment.devWornClothing().hat?.prizeCosmeticId,'appearance::hat::five_blossom_crown',
      'the crown replaces the old hat at the exact announcement callback');
    assert.equal(equipment.devWornClothing().hood,hood,'hood stays temporarily hidden until scene exits');
    return true;
  }
};
function readyHunt(){
  W.FestivalBlossomHunt.bindQuestDeps({getQuestProgress:()=>W.QuestProgressStore.snapshot()});
  W.FestivalBlossomHunt.init(mapDeps);
  W.FestivalBlossomHunt.update();
  for(const id of names){
    const [col,row]=treeLocation[id];area=zoneId[id];tile={area,col,row};
    listener?.({to:tile});
    assert.equal(W.FestivalBlossomHunt.nearbyTree()?.id,id,'tree is physical and interactable');
    assert(!W.FestivalBlossomHunt.menuStatus().ready,'presence does not complete the quest');
    assert.equal(W.FestivalBlossomHunt.pickBlossom(id),true,'explicitly picking '+id+' succeeds');
    assert.equal(W.KeyItemSystem.has(W.FestivalBlossomHunt.itemKey(id)),true,'picked blossom appears in character Pack');
    assert.equal(W.FestivalBlossomHunt.pickBlossom(id),false,'one blossom per tree/year');
  }
  assert.equal(W.FestivalBlossomHunt.menuStatus().ready,true,'all five real blossoms unlock Father Hunundi turn-in');
  area='town';tile={area,col:33,row:40};
}
async function main(){
  login('owner');readyHunt();
  const ownerBefore=equipment.devWornClothing().hat;
  const ownerHood=equipment.devWornClothing().hood;
  failNextCompletionSave=true;
  const failedCompletion=await W.FestivalBlossomHunt.turnInAtHunundi(walkers[0]);
  assert(!failedCompletion.ok,'a failed completion save reports failure without eating flowers');
  assert.equal(cutscenes,1,'one stage ceremony played before the failed quest save');
  assert.equal(equipment.ownsFiveBlossomCrown(1156),true,'the crown was saved even if the later quest write failed');
  const first=await W.FestivalBlossomHunt.turnInAtHunundi(walkers[0]);
  assert(first.ok&&first.first,'retry finishes the first Finder reward');
  assert.equal(cutscenes,1,'retry does not replay the ceremony after a real crown was already saved');assert.match(announcements[0],/first to complete our challenge this year/);
  assert.equal(getMeta().worlds[0].fiveBlossomsFinders['1156'].characterId,'owner');
  assert.equal(W.QuestProgressStore.snapshot()['five_blossoms_wilderness_hunt:1156'].status,'completed');
  assert.equal(equipment.devWornClothing().hat?.label,'Five Blossom Crown');
  assert.equal(equipment.devWornClothing().hood?.uid,ownerHood.uid,'original non-facewrap hood is restored after scene');
  assert.notEqual(equipment.devWornClothing().hat?.uid,ownerBefore.uid,'original hat is replaced by prize hat');
  assert.equal(W.__hobunjiPlayerProfile.gearInventory.clothingItems.length,2,'the crown and the previously worn hat remain owned');
  assert(W.__hobunjiPlayerProfile.gearInventory.clothingItems.some(item=>item.uid===ownerBefore.uid),'old equipped hat survives crowning even in a legacy worn-only save');
  for(const id of names)assert.equal(W.KeyItemSystem.has(W.FestivalBlossomHunt.itemKey(id)),false,'blossom is handed in after the reward');
  assert.equal((await W.FestivalBlossomHunt.turnInAtHunundi(walkers[0])).ok,false,'repeat turn-in is rejected');
  const art=equipment.FIVE_BLOSSOM_CROWN_ART;
  assert.equal(art.fallback,'assets/cosmetics/clothes/hat/headband.png');
  assert.match(art.front,/fiveblossomcrown-front\.png$/);
  assert.match(art.back,/fiveblossomcrown-back\.png$/);
  assert(!fs.existsSync(path.join(ROOT,'docs',art.front)),'future front sprite is deliberately uncreated');
  assert(!fs.existsSync(path.join(ROOT,'docs',art.back)),'future back sprite is deliberately uncreated');
  login('farmhand');readyHunt();
  const second=await W.FestivalBlossomHunt.turnInAtHunundi(walkers[0]);
  assert(second.ok&&!second.first,'later farmhand receives crown without fanfare');
  assert.equal(cutscenes,1,'only one cinematic per shared world-year');
  assert.equal(equipment.devWornClothing().hat?.label,'Five Blossom Crown');
  assert.equal(equipment.devWornClothing().hood?.cosmeticId,'facewrap','later finder keeps their facewrap');
  assert.equal(getMeta().worlds[0].fiveBlossomsFinders['1156'].characterId,'owner','later farmhand cannot replace winner');
  civilYear=1157;area='town';tile={area,col:33,row:40};W.FestivalBlossomHunt.update();
  readyHunt();
  const newYear=await W.FestivalBlossomHunt.turnInAtHunundi(walkers[0]);
  assert(newYear.ok&&newYear.first,'the first farmhand in a new year is crowned on stage');
  assert.equal(cutscenes,2);
  assert.equal(getMeta().worlds[0].fiveBlossomsFinders['1157'].characterId,'farmhand');
  assert.equal(equipment.devWornClothing().hood?.cosmeticId,'facewrap','first-Finder facewrap was never hidden');
  assert.equal(equipment.devWornClothing().hat?.awardYear,1157);
  const farmhandGear=W.__hobunjiPlayerProfile.gearInventory; // Replaying two different years verifies the actual owned-gear normalization path.
  const annualCrowns=()=>farmhandGear.clothingItems.filter(item=>item.prizeCosmeticId==='appearance::hat::five_blossom_crown');
  assert.equal(annualCrowns().length,2,'both years award separate crowns in the current live Gear collection');
  assert.notEqual(equipment.__test.clothingGearCollectionKey(annualCrowns()[0]),equipment.__test.clothingGearCollectionKey(annualCrowns()[1]),'annual award identity must not collapse to an ordinary cosmetic grouping');
  equipment.__test.normalizeGearClothingItems(farmhandGear);
  assert.equal(annualCrowns().length,2,'character loading/migration preserves both earned crown years');
  assert.equal(farmhandGear.clothing.hat?.awardYear,1157,'normalization leaves the most recent crown equipped');
  civilYear=1158;W.FestivalBlossomHunt.update();readyHunt();
  const savedCutsceneRuntime=W.AuthoredCutsceneRuntime; // Temporarily missing renderer proves a failed ceremony does not lock out the next first finisher.
  W.AuthoredCutsceneRuntime=null;
  const interrupted=await W.FestivalBlossomHunt.turnInAtHunundi(walkers[0]);
  assert(!interrupted.ok,'an unavailable stage cutscene fails without a crown');
  assert.equal(getMeta().worlds[0].fiveBlossomsFinders?.['1158'],undefined,'unawarded year claim was rolled back');
  W.AuthoredCutsceneRuntime=savedCutsceneRuntime;
  login('owner');readyHunt();
  const nextFirst=await W.FestivalBlossomHunt.turnInAtHunundi(walkers[0]);
  assert(nextFirst.ok&&nextFirst.first,'another character can become the first Finder after an interrupted attempt');
  assert.equal(getMeta().worlds[0].fiveBlossomsFinders['1158'].characterId,'owner');
  assert.equal(cutscenes,3,'no cinematic for the failed attempt, one for each successful first-Finder year');
  assert.equal(equipment.devWornClothing().hat?.baseCosmeticId,'appearance::hat::basic_headband',
    'new prize id retains the real headband portrait fallback');
  assert(gearSaves>=3 && avatarRefresh>=4 && questsSaved>=18,'real persistence and portrait refresh were exercised');
  assert(audienceShots.some(item=>item.owner==='five-blossoms-crowning' && item.priority>0),'crowning audience outranks ordinary town plans');
  assert(scheduleInvalidations>=7,'crowd gathering and release both invalidate cached NPC destinations');
  const fullVillage=Array.from({length:100},(_,i)=>({rec:{id:'crowd_'+i},area:'town',root:{position:{x:0,z:0}}})); // Oversized authored roster probes the edge of the actual 50-row town map.
  assert.equal(W.FestivalBlossomCeremony.arrangeCrowd(stage,fullVillage),100);
  const audience=fullVillage.map(walker=>W.FestivalBlossomCeremony.__test.scheduleOverride(walker.rec));
  assert(audience.every(target=>target.r>=0 && target.r<49.5),'even a 100-person audience stays inside the town south edge');
  assert(Math.abs((audience[0].c+audience[24].c)/2-(Number(stage.col)+1.5))<0.01,'the large first audience rank centers on the stage');
  console.log('Five Blossoms crowning: picked Pack items, world-year first finder, player/farmhand stage ceremony, crowd, temporary hood removal, real hat gear/fallback, later awards, persistence, duplicate lockout passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
