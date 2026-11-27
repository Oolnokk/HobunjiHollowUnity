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

let civilYear=1156,area='town',tile=null,listener=null,cutscenes=0,gearSaves=0,avatarRefresh=0,questsSaved=0,scheduleInvalidations=0,crownedStandIns=0;
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
  FoliageGenerator:{buildWildernessBlossomTreeMesh(){return {
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
W.NpcWardrobe={async refreshWalkerAppearance(actor,opts){
  assert.equal(opts.strict,true,'ceremony requires real visible portrait upload');
  assert(actor.rec.equippedCosmetics.includes('appearance::hat::five_blossom_crown'),'synthetic actor wears the actual earned crown');
  actor.profile={equippedCosmetics:actor.rec.equippedCosmetics};crownedStandIns++;return true;
}};
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
    const standIn={rec:{id:'player'},avatarFrontCanvas:{},avatarGroup:{},profile:null};
    const standInEntity={walker:standIn,rec:standIn.rec,profile:null};
    await options.onDialogueContinue(crowning,new Map([['player',standInEntity]]));
    assert(standInEntity.profile.equippedCosmetics.includes('appearance::hat::five_blossom_crown'),
      'the visible cutscene actor is repainted before the crown reveal');
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
  assert.match(W.FestivalBlossomHunt.menuStatus().statusText,/festival stage/,'the quest shows where to find Hunundi without creating a waypoint');
  area='town';tile={area,col:33,row:40};
}
// The production NPC entry route must offer the hunt through normal Talk.
let queuedDialogue = false; // Queued scenes still have higher priority.
let dialogueClosed = false; // The ceremony must start after dialogue releases its lock.
let lastChoice = null; // Captures the visible synthetic dialogue options.
let lastConversation = ''; // Captures the ordinary/choice route for mobile-like diagnostics.
let pendingAward = null; // Holds the true async hunt transaction triggered by a selected option.
const dialogueHandlers = new Map(); // Mirrors DialogueContent's custom action registry.
W.DialogueContent = {
  hasQueuedConversationTree: () => queuedDialogue,
  beginNpcConversation(rec) { lastConversation = 'chat:' + rec.id; },
  beginSyntheticChoice(rec) { lastConversation = 'choice:' + rec.id; },
  renderDlgNode(node) { lastChoice = node; },
  registerActionHandler(type, handler) { dialogueHandlers.set(type, handler); return true; },
};
W.ProceduralTasks = {
  getTurnInReadyTaskForNpc: () => null,
  async maybeProposeRequest() { return null; },
  maybeOfferFavor() { return null; },
};
W.FestivalSystem = {
  receiveNpcReward(walker, action) {
    assert.equal(action, 'festival_npc_gift', 'Talk reuses the existing festival reward action');
    assert.strictEqual(walker, walkers[0], 'the actual nearby Hunundi walker is passed through');
    assert.equal(dialogueClosed, true, 'dialogue closes before crowning starts');
    pendingAward = W.FestivalBlossomHunt.turnInAtHunundi(walker);
    return pendingAward;
  },
};
load('docs/js/npc-dialogue-entry-router.js');
W.NpcDialogueEntryRouter.init({
  ITEM_DEFS: {}, isGeneralStoreNpcOnDuty: () => false, isCarpenterNpcOnDuty: () => false
});
async function presentViaDialogue(walker) {
  lastChoice = null; pendingAward = null; dialogueClosed = false;
  assert.equal(await W.NpcDialogueEntryRouter.route(walker.rec, walker), true);
  assert.equal(W.NpcDialogueEntryRouter.debugSnapshot().lastDecision, 'five-blossoms-turn-in');
  assert.equal(lastConversation, 'choice:' + walker.rec.id);
  assert.equal(lastChoice?.type, 'choice');
  assert(lastChoice.choices.some(choice => choice.actions?.some(action => action.type === 'startChat')),
    'normal Chat remains available alongside the hand-in');
  const present = lastChoice.choices.find(choice => choice.actions?.[0]?.type === 'presentFiveBlossoms'); // Visible player-facing turn-in option.
  assert.match(present?.label || '', /Present the Five Blossoms/);
  const action = present.actions[0]; // Registered feature action, dispatched by the real dialogue core.
  const handler = dialogueHandlers.get(action.type); // Same handler selected by an NPC dialogue choice.
  assert.equal(typeof handler, 'function');
  assert.equal(handler(action, { npc: walkers[1].rec })?.ok, false,
    'a stale/mismatched NPC context cannot turn in blossoms');
  handler(action, { npc: walker.rec });
  assert.equal(pendingAward, null, 'award does not start before conversation closes');
  dialogueClosed = true;
  await Promise.resolve();
  assert(pendingAward, 'clicking Present begins the real crown transaction');
  return pendingAward;
}
async function main(){
  login('owner');
  await W.NpcDialogueEntryRouter.route(walkers[0].rec, walkers[0]);
  assert.equal(W.NpcDialogueEntryRouter.debugSnapshot().lastDecision, 'ordinary',
    'before five blossoms, Father Hunundi still starts normal dialogue');
  readyHunt();
  queuedDialogue = true;
  await W.NpcDialogueEntryRouter.route(walkers[0].rec, walkers[0]);
  assert.equal(W.NpcDialogueEntryRouter.debugSnapshot().lastDecision, 'queued',
    'queued authored scenes retain priority');
  queuedDialogue = false;
  const ownerBefore=equipment.devWornClothing().hat;
  const ownerHood=equipment.devWornClothing().hood;
  failNextCompletionSave=true;
  const failedCompletion=await presentViaDialogue(walkers[0]);
  assert(!failedCompletion.ok,'a failed completion save reports failure without eating flowers');
  assert.equal(cutscenes,1,'one stage ceremony played before the failed quest save');
  assert.equal(equipment.ownsFiveBlossomCrown(1156),true,'the crown was saved even if the later quest write failed');
  const first=await presentViaDialogue(walkers[0]);
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
  const crownId='appearance::hat::five_blossom_crown'; // Prize identifier shared by catalog, physical Gear and portrait configuration.
  const crownConfig=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/config/cosmetics/five_blossom_crown.json'),'utf8')); // Test the shipping config, not an invented variant resolver.
  const crownIndex=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/config/cosmetics/index.json'),'utf8'));
  assert(crownIndex.entries.some(entry=>entry.id===crownId && entry.path==='./five_blossom_crown.json'),'the portrait registry loads the actual crown');
  assert.equal(crownConfig.slot,'hat');
  assert.equal(crownConfig.hoodLayering,'under');
  assert.equal(crownConfig.palette.layers.base,'NONE','multicolour flower art must never inherit the previous hat dye');
  assert.equal(crownConfig.parts.head.layers.front.layerRole,'base','the bypass palette applies to the authored crown layer');
  assert.equal(crownConfig.parts.head.layers.front.image.url,'./'+art.defaultMale);
  const variants=[
    ['mao-ao_female',art.defaultFemale],['kenkari_male',art.kenkari],['kenkari_female',art.kenkari],
    ['rakakoan_female',art.kenkari],['tletingan_male',art.tletingan],['tletingan_female',art.tletingan],
    ['mashtzarr_male',art.mashtzarr],['mammakhbuur_female',art.mashtzarr]
  ]; // Missing gender-specific sprites deliberately reuse the closest existing authored head shape.
  for(const [speciesKey,asset] of variants) assert.equal(crownConfig.speciesVariants[speciesKey].parts.head.layers.front.image.url,'./'+asset);
  const speciesIndex=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/config/species/index.json'),'utf8')); // Every shipping fighter species has explicit male/female crown art.
  const specialSprites={kenkari:art.kenkari,rakakoan:art.kenkari,mashtzarr:art.mashtzarr,
    mammakhbuur:art.mashtzarr,tletingan:art.tletingan}; // Only these groups have a different authored head shape.
  const portraitCtx=vm.createContext({window:{},console,Image:class {},URL,document:{baseURI:'https://test.invalid/docs/index.html'}}); // Evaluate the production portrait resolver against the actual crown config.
  vm.runInContext(read('docs/js/portrait-utils.js'),portraitCtx,{filename:'docs/js/portrait-utils.js'});
  const portraitOption=vm.runInContext('portraitOptionFromJson',portraitCtx)({id:crownId},crownConfig);
  assert.equal(portraitOption.rewardOnly,true,'the crown is equippable but excluded from randomly generated outfits');
  const portraitRandom=vm.runInContext('randomProfileSeeded',portraitCtx);
  const noHat={id:'none',layers:[]},randomFighter={id:'N',speciesId:'nuhongan',gender:'male'}; // Nuhongan lacks an explicit species cosmetic allowlist.
  const generated=portraitRandom(()=>.25,[randomFighter],[noHat],[noHat],[noHat],[noHat],[noHat],[noHat],[noHat],
    {},{},[noHat,portraitOption],[noHat],{N:{hat:{none:0,five_blossom_crown:1}}},
    [noHat],[noHat],{},{},{},{},{});
  assert.notEqual(generated.hat?.id,'five_blossom_crown','even weighted random outfits cannot award the quest crown');
  const portraitResolve=vm.runInContext('resolveOptionLayers',portraitCtx);
  const portraitTintSlot=vm.runInContext('resolveLayerTintSlot',portraitCtx);
  for(const {speciesId} of speciesIndex.entries) for(const gender of ['male','female']) {
    const expected=(specialSprites[speciesId] || (gender==='female'?art.defaultFemale:art.defaultMale)).split('/').pop();
    const route=crownConfig.speciesVariants[speciesId+'_'+gender]?.parts?.head?.layers?.front?.image?.url;
    assert(route && route.endsWith(expected),speciesId+' '+gender+' has its own authored crown route');
    const layers=portraitResolve(portraitOption,{speciesId,gender}); // The actual resolver prefers opposite-gender variants when one is absent.
    assert.equal(layers.length,1,speciesId+' '+gender+' has exactly one crown layer');
    assert(layers[0].url.endsWith(expected),speciesId+' '+gender+' renders '+expected+' rather than a fallback gender');
    assert.equal(layers[0].paletteColorKey,'NONE',speciesId+' '+gender+' preserves full flower colours');
    assert.equal(portraitTintSlot(layers[0].paletteColorKey,portraitOption.tintSlot),null,'no costume dye on '+speciesId+' '+gender);
  }
  assert.equal(Object.keys(crownConfig.speciesVariants).length,speciesIndex.entries.length*2,'complete runtime variant coverage');
  const onboardingSource=read('docs/onboarding-core.js'); // Exercise the shipping save-select resolver without loading UI or a GPU.
  const onboardingHook='  window.HobunjiOnboarding = { init, reset, loadProfile, loadSaveMeta, openCreator, cancelCreator, creatorSessionInfo };';
  assert(onboardingSource.includes(onboardingHook),'save-select preview test hooks the existing live module');
  const onboardingWindow={
    FarmWorldSettings:{normalize:()=>({})},
    SCRATCHBONES_CONFIG:{game:{account:{shopCatalog:[{id:'appearance::hat::basic_headband',category:'hat'}]},
      portrait:{},dyes:{catalog:[]}}},
    getPortraitFighters:()=>[{speciesId:'mao-ao',gender:'male',id:'M'}],
    randomPortraitProfileSeeded:()=>({bodyColors:{},facialHair:null})
  }; // The renderer's shop-only lookup previously replaced earned crowns with the original headband.
  const onboardingCtx=vm.createContext({window:onboardingWindow,document:{},localStorage:{},
    console,URL,Image:class {},setTimeout(){}});
  vm.runInContext(onboardingSource.replace(onboardingHook,
    '  window.__previewCrownTest={setCosmetics(value){_cosmetics=value;},buildPreviewProfileFromAppearance};\n'+onboardingHook),
    onboardingCtx,{filename:'docs/onboarding-core.js'});
  const previewOption=id=>({id,slot:'hat',layers:[{url:id}]});
  onboardingWindow.__previewCrownTest.setCosmetics({optionCache:new Map([
    ['appearance::hat::basic_headband',previewOption('appearance::hat::basic_headband')],
    [crownId,previewOption(crownId)]]),hatOptions:[{id:'none'}],hoodOptions:[{id:'none'}]});
  const previewAppearance={speciesId:'mao-ao',gender:'male',cosmetics:{},bodyColors:{}};
  const preview=(equippedHat)=>onboardingWindow.__previewCrownTest.buildPreviewProfileFromAppearance(
    previewAppearance,['appearance::hat::basic_headband'],{}, {clothing:{hat:equippedHat}});
  assert.equal(preview({cosmeticId:crownId,prizeCosmeticId:crownId}).hat?.id,crownId,
    'saved character portrait shows the crowned hat even if original shop headband is also selected');
  assert.equal(preview({cosmeticId:'appearance::hat::basic_headband'}).hat?.id,'appearance::hat::basic_headband',
    'switching away from the crown removes it from the save-select portrait');
  assert.equal(preview(null).hat?.id,'appearance::hat::basic_headband','an unawarded character preview is unchanged');
  for(const asset of Object.values(art)) assert(fs.existsSync(path.join(ROOT,'docs',asset)),asset+' is an actual shipped PNG');
  const legacyCrown=equipment.devWornClothing().hat; // Simulates a crown earned before the new sprites were uploaded.
  legacyCrown.baseCosmeticId='appearance::hat::basic_headband';
  legacyCrown.sprite='assets/cosmetics/clothes/hat/headband.png';
  legacyCrown.artCandidates=['assets/cosmetics/clothes/hat/fiveblossomcrown-front.png'];
  legacyCrown.fallbackSprite=legacyCrown.sprite;
  assert(equipment.__test.normalizeGearClothingItems(W.__hobunjiPlayerProfile.gearInventory),'old crown art is migrated with the normal Gear save migration');
  assert.equal(legacyCrown.baseCosmeticId,crownId,'old awards now select the crown instead of the headband');
  assert.equal(legacyCrown.sprite,art.defaultMale);
  assert.equal(legacyCrown.artCandidates,undefined,'obsolete non-existent image paths are removed');
  assert.equal(legacyCrown.fallbackSprite,undefined);
  const ownerGear=W.__hobunjiPlayerProfile.gearInventory; // Old saves may deserialize worn/owned Gear records as separate objects.
  const ownedCrownCopy=JSON.parse(JSON.stringify(legacyCrown));
  const ownedIndex=ownerGear.clothingItems.findIndex(item=>item.uid===legacyCrown.uid);
  assert(ownedIndex>=0);
  ownerGear.clothingItems[ownedIndex]=ownedCrownCopy;
  for(const item of [legacyCrown,ownedCrownCopy]) {
    item.baseCosmeticId='appearance::hat::basic_headband';
    item.sprite='assets/cosmetics/clothes/hat/headband.png';
  }
  const beforeFirstPortraitMigration=gearSaves;
  const firstPortrait=equipment.applyGearClothingToPlayerData({equippedCosmetics:[],appearance:{bodyColors:{}}});
  assert(firstPortrait.equippedCosmetics.includes(crownId),'old save gets the correct crown immediately on first avatar rebuild');
  assert.equal(legacyCrown.baseCosmeticId,crownId);
  assert.equal(ownedCrownCopy.baseCosmeticId,crownId,'the owned article copy is migrated together with the worn one');
  assert.equal(gearSaves,beforeFirstPortraitMigration+1,'first avatar migration persists once');
  equipment.applyGearClothingToPlayerData({equippedCosmetics:[],appearance:{bodyColors:{}}});
  assert.equal(gearSaves,beforeFirstPortraitMigration+1,'subsequent portrait refreshes never resave the already migrated crown');
  login('farmhand');readyHunt();
  const second=await presentViaDialogue(walkers[0]);
  assert(second.ok&&!second.first,'later farmhand receives crown without fanfare');
  assert.equal(cutscenes,1,'only one cinematic per shared world-year');
  assert.equal(equipment.devWornClothing().hat?.label,'Five Blossom Crown');
  assert.equal(equipment.devWornClothing().hood?.cosmeticId,'facewrap','later finder keeps their facewrap');
  assert(W.__hobunjiPlayerProfile.gearInventory.clothingItems.some(item=>item.uid==='farmhand-hat'),'quiet crown award keeps the later finisher’s previous equipped hat owned');
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
  assert.equal(equipment.devWornClothing().hat?.baseCosmeticId,'appearance::hat::five_blossom_crown',
    'new and resumed prize awards use the authored crown portrait config');
  const equippedInPortrait=equipment.applyGearClothingToPlayerData({equippedCosmetics:[],appearance:{bodyColors:{}}});
  assert(equippedInPortrait.equippedCosmetics.includes(crownId),'the actual crown is routed into the avatar renderer');
  const crownHat=W.__hobunjiPlayerProfile.gearInventory.clothing.hat;
  W.__hobunjiPlayerProfile.gearInventory.clothing.hat=null;
  const unEquippedPortrait=equipment.applyGearClothingToPlayerData({equippedCosmetics:[crownId],appearance:{bodyColors:{}}});
  assert(!unEquippedPortrait.equippedCosmetics.includes(crownId),'switching away from a quest-only hat clears its previously rendered portrait layer');
  W.__hobunjiPlayerProfile.gearInventory.clothing.hat=crownHat;
  assert(gearSaves>=3 && avatarRefresh>=4 && questsSaved>=18,'real persistence and portrait refresh were exercised');
  assert.equal(crownedStandIns,3,'a crown portrait is uploaded for each played first-Finder ceremony');
  assert(audienceShots.some(item=>item.owner==='five-blossoms-crowning' && item.priority>0),'crowning audience outranks ordinary town plans');
  assert(scheduleInvalidations>=7,'crowd gathering and release both invalidate cached NPC destinations');
  const fullVillage=Array.from({length:100},(_,i)=>({rec:{id:'crowd_'+i},area:'town',root:{position:{x:0,z:0}}})); // Oversized authored roster probes the edge of the actual 50-row town map.
  assert.equal(W.FestivalBlossomCeremony.arrangeCrowd(stage,fullVillage),100);
  const audience=fullVillage.map(walker=>W.FestivalBlossomCeremony.__test.scheduleOverride(walker.rec));
  assert(audience.every(target=>target.r>=0 && target.r<49.5),'even a 100-person audience stays inside the town south edge');
  const frontRow = audience.filter(target=>target.r === Math.min(...audience.map(entry=>entry.r))); // NPC ids are alphabetically sorted before slot assignment, not in their generated numeric order.
  assert(Math.abs((Math.min(...frontRow.map(target=>target.c))+Math.max(...frontRow.map(target=>target.c)))/2-(Number(stage.col)+1.5))<0.01,'the large front audience rank centers on the stage');
  // Co-op: other players join the audience after the villagers, in the same ranks, then go back.
  ctx.performance=ctx.performance||{now:()=>1000};load('docs/js/actor-registry.js');load('docs/js/time-consensus.js');load('docs/js/shared-cutscene.js');
  const reg=W.ActorRegistry,hostPlayer={x:5,y:5,health:100},guestA={x:640,y:640,health:100,areaId:'cave'},guestB={x:700,y:700,health:100,areaId:'farm'};
  reg.registerPlayer(hostPlayer,{local:true});reg.registerPlayer(guestA,{playerId:'ga'});reg.registerPlayer(guestB,{playerId:'gb'});
  W.SharedCutscene.init({tilePx:64});
  W.SharedCutscene.begin({id:'five-blossoms-crowning',area:'town',controller:hostPlayer});
  const village=Array.from({length:6},(_,i)=>({rec:{id:'v_'+i},area:'town',root:{position:{x:0,z:0}}}));
  assert.equal(W.FestivalBlossomCeremony.arrangeCrowd(stage,village),6);
  const villagerSlots=village.map(w=>W.FestivalBlossomCeremony.__test.scheduleOverride(w.rec));
  assert(W.SharedCutscene.isInCrowd(guestA)&&W.SharedCutscene.isInCrowd(guestB),'both guests, whichever area they were in, joined the audience');
  assert.equal(guestA.areaId,'town');assert.equal(guestB.areaId,'town');
  const taken=new Set(villagerSlots.map(t=>t.c.toFixed(2)+','+t.r.toFixed(2)));
  for(const g of [guestA,guestB]){const key=((g.x/64-0.5).toFixed(2))+','+((g.y/64-0.5).toFixed(2));assert(!taken.has(key),'a guest never stands on a villager\'s spot');taken.add(key);}
  assert(Math.abs(guestA.angle-(-Math.PI/2))<1e-9,'guests face north at the stage like the villagers (rotY 180)');
  assert.equal(guestA._crowdSlot.pose,'stand');
  W.SharedCutscene.end();
  assert.deepEqual([guestA.x,guestA.y,guestA.areaId],[640,640,'cave'],'a guest is put back exactly where they were');
  assert.equal(guestA._inCutscene,false);
  reg.unregisterPlayer(guestA);reg.unregisterPlayer(guestB);reg.unregisterPlayer(hostPlayer);
  console.log('Five Blossoms crowning: picked Pack items, world-year first finder, player/farmhand stage ceremony, crowd, temporary hood removal, real species-aware hat art and saved-crown migration, later awards, persistence, duplicate lockout passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
