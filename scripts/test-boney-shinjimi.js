#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8'); // Executes the real feature modules, not copied simulation logic.

const species=JSON.parse(read('docs/config/species/boney-shinjimi-skeleton.json'));
const defaultSkeleton=JSON.parse(read('docs/config/species/mao-ao-skeleton.json'));
const beard='appearance::Mao-ao_M::mao-ao_grandbeard'; // The repository's authored Grand Beard cosmetic id.
const hat='appearance::hat::old_highlands_kasa'; // Actual authored Old Highlands Kasa cosmetic id.
assert.equal(species.speciesId,'boney-shinjimi-skeleton');
assert(species.male.allowedCosmetics.includes(beard));
assert(species.male.allowedCosmetics.includes(hat));
const hatDef=JSON.parse(read('docs/config/cosmetics/oldhighlandskasa.json')); // Both portrait layers come from main's uploaded PNGs.
assert.equal(hatDef.slot,'hat');
assert.equal(hatDef.parts.head.layers.front.image.url,'./assets/cosmetics/clothes/hat/oldhighlandskasa-front.png');
assert.equal(hatDef.parts.head.layers.back.image.url,'./assets/cosmetics/clothes/hat/oldhighlandskasa-back.png');
assert(JSON.parse(read('docs/config/cosmetics/index.json')).entries.some(e=>e.id===hat&&e.path==='./oldhighlandskasa.json'));
assert.equal(JSON.parse(read('docs/config/items/item-index.json'))['cosmetic:'+hat]?.cat,'clothing');
for(const path of ['docs/config/species/mao-ao.json','docs/config/species/tletingan.json']) {
 const species=JSON.parse(read(path));
 for(const gender of ['male','female']) assert(species[gender].allowedCosmetics.includes(hat),path+' '+gender+' can wear it');
}
assert(read('docs/config/scratchbones-config.js').includes('oldhighlandskasa-front.png'));
assert.match(read('docs/js/equipment-panel.js'),/grantPackClothing,.*Quest clothing/);
assert.equal(species.male.forcedCosmetics.facialHair,undefined);
assert.equal(defaultSkeleton.male.forcedCosmetics.facialHair,'none','ordinary skeletons remain beard-free');
const index=JSON.parse(read('docs/config/species/index.json')).entries;
assert(index.some(e=>e.speciesId===species.speciesId));
assert.match(read('docs/js/attachment-rig-latest-authored-snapshot.js'),/boney-shinjimi-skeleton-species-runtime\.js/);
const html=read('docs/index.html');
assert(html.indexOf('boney-shinjimi-wilderness.js')>0&&html.indexOf('boney-shinjimi-wilderness.js')<html.indexOf('slagothim-traders.js'));
const travellers=read('docs/js/slagothim-traders.js');
assert.match(travellers,/BoneyShinjimiWilderness\?\.init/);
assert.match(travellers,/BoneyShinjimiWilderness\?\.update/);
assert.match(travellers,/boneyShinjimi: window\.BoneyShinjimiWilderness\?\.serialize/);
assert.match(travellers,/BoneyShinjimiWilderness\?\.restore/);

// Rewards: donation-first, high-value duplicate fallback, unseen Base guarantee,
// missing-trinket fallback, and the currently wearable kasa asset.
const W={GameRandom:{random:()=>0},ArtifactCollection:{ARTIFACTS:{
  artifactLow:{label:'Low',sellPrice:30},artifactHigh:{label:'High',sellPrice:900}}},
  WorldMetaStore:{loadArtifactCollection:()=>({donated:['artifactLow']})},
  EnchantmentSystem:{DEFINITIONS:{locked:{id:'locked',type:'Base',alignment:'Fey'},learned:{id:'learned',type:'Base',alignment:'Fey'},
    ruin:{id:'ruin',type:'Base',alignment:'Hronal'}},
    BASE_LIMIT:2,isBaseUnlocked:id=>id==='learned',isFlourishUnlocked:()=>false},
  HarlyaoRelics:{makeFeyRelic:()=>({shape:'dagger',origin:'Fey',uid:'u1',enchantments:{base:['learned'],flourishes:{}}}),
    grantBoundRelic:()=> 'feyBound_dagger_u1'},
  TrinketSystem:{DEFINITIONS:{first:{displayName:'First'},second:{displayName:'Second'}},
    ownedEntries:()=>[{id:'first'}],grant:id=>'trinket-'+id}};
const pack=[]; // Real clothing belongs to Pack, not to a bag item counter.
W.EquipmentPanel={
 grantPackClothing:item=>{pack.push(item);return item;},
 clothingSpriteForCosmetic:()=> 'assets/cosmetics/clothes/hat/oldhighlandskasa-front.png',
};
const ctx=vm.createContext({window:W,console,Math,Date});
vm.runInContext(read('docs/js/boney-shinjimi-rewards.js'),ctx);
const rewards=W.BoneyShinjimiRewards;
assert.equal(rewards.artifactChoice(['artifactLow'],()=>0).key,'artifactHigh');
assert.equal(rewards.artifactChoice(['artifactLow','artifactHigh'],()=>0).key,'artifactHigh');
assert.equal(rewards.relicWithUnlearnedEnchantment(()=>0).enchantments.base[0],'locked');
assert(rewards.lockedEnchantments().every(entry=>W.EnchantmentSystem.DEFINITIONS[entry.id].alignment==='Fey'),
  'Boney never teaches ruin-origin enchantments');
const deps={inventory:{},ITEM_DEFS:{['cosmetic:'+hat]:{label:'Kasa'}},
  tothalWorldId:()=> 'w',buildInventoryGrid(){},saveMemberWorldData(){},showToast(){}};
assert.equal(rewards.grant('valuable',deps,()=>0).key,'artifactHigh');
assert.equal(deps.inventory.artifactHigh,1);
assert.equal(rewards.grant('useful',deps,()=>0).key,'feyBound_dagger_u1');
assert.equal(rewards.grant('milk',deps,()=>0).origin,'Fey', 'milk uses the same Fey relic generator as Useful');
delete W.EnchantmentSystem.DEFINITIONS.locked;
assert.equal(rewards.grant('apologize',deps,()=>0).id,'second');
assert.equal(rewards.grant('milk',deps,()=>0).kind,'boundRelic', 'milk keeps giving a Fey weapon even after all Fey enchants are learned');
const hatPrize=rewards.grant('hat',deps,()=>0);
assert.equal(hatPrize.kind,'clothing');
assert.equal(hatPrize.cosmeticId,hat);
assert.equal(pack.length,1);
assert.equal(pack[0].slot,'hat');
assert.equal(pack[0].cosmeticId,hat);
assert.equal(deps.inventory['cosmetic:'+hat],undefined,'not a numeric bag stack');

// NPC felling must affect the same live grid and regrowth records as player tools,
// never player inventory, and must refuse to fell the same tree twice.
const tree={type:'shrub',floraKind:'copse'},rock={type:'rock',rockKind:'diggableRockOre'};
const grid=Array.from({length:10},()=>Array.from({length:10},()=>({type:'grass'})));
grid[3][2]=tree;grid[3][4]=rock;
const felled=new Map(),mined=new Map();
const world={};
vm.runInNewContext(read('docs/js/zone-regrowth.js'),{window:world,console,Math});
const calendar={day:14};
world.ZoneRegrowth.init({_zoneScenes:new Map([['zone',{grid}]]),_zoneFelledTreePersist:felled,
  _zoneMinedRockPersist:mined,TileType:{SHRUB:'shrub',ROCK:'rock',GRASS:'grass'},
  calendar,TREE_REGROWTH_DAYS:7,ROCK_REGROWTH_DAYS:7,getCurrentArea:()=> 'town',
  removeZoneVegetationVisual:()=>true,removeZoneMineableRockVisual:()=>true});
assert.equal(world.ZoneRegrowth.npcResourceTargets('zone',3,3,5).length,2);
assert.equal(world.ZoneRegrowth.npcCompleteResourceWork('zone',{col:2,row:3,kind:'tree'}),true);
assert.equal(world.ZoneRegrowth.npcCompleteResourceWork('zone',{col:2,row:3,kind:'tree'}),false);
assert.equal(world.ZoneRegrowth.npcCompleteResourceWork('zone',{col:4,row:3,kind:'rock'}),true);
assert.equal(tree.type,'grass');assert.equal(rock.type,'grass');
assert.equal(felled.get('zone')[0].feltDay,14);
assert.equal(mined.get('zone')[0].minedDay,14);
calendar.day=21;
world.ZoneRegrowth.tickFelledTreeRegrowth();
world.ZoneRegrowth.tickMinedRockRegrowth();
assert.equal(tree.type,'shrub');assert.equal(rock.type,'rock');

// Full moon is 14/28; a planned site has collision even when render is absent;
// reward-state persistence is additive and does not re-roll an unfinished house.
const registered=[];
let spoilerPanel=null; // Captures the Dev Companion's opt-in readout without a browser or a second-window connection.
const map={cols:60,rows:60,tiles:Array.from({length:3600},()=>({type:'grass'})),buildings:[]};
const moonWindow={
  __hobunjiGameStarted:true,GameRandom:{random:()=>0.5},
  NpcPathfinding:{isNpcTileWalkable:()=>true,findNpcPath:()=>[1]},
  AreaFootprintBlockers:{register:(id,provider)=>{registered.push({id,provider});return ()=>{};}},
  NpcScheduling:{registerTargetOverride(){}},
  DevCompanion:{registerStateProvider(){},registerCheatPanel(spec){spoilerPanel=spec;}},
};
const moonContext=vm.createContext({window:moonWindow,console,Math,Date,URLSearchParams});
vm.runInContext(read('docs/js/boney-shinjimi-wilderness.js'),moonContext);
const C=moonWindow.BoneyShinjimiWilderness;
let saved=0;const liveDay={day:13},game={
  calendar:liveDay,EXTERIOR_ZONES:{map_western_slope:{}},
  getZoneLayout:zone=>zone==='map_western_slope'?map:null,
  getCurrentArea:()=> 'town',tothalWorldId:()=> 'unit-test',TILE:64,
  player:{x:64*25,y:64*25,health:100},save:()=>{saved++;},
};
C.init(game);
assert(spoilerPanel,'Dev Companion location spoilers must be registered during the encounter init');
assert.equal(spoilerPanel.render().summary,'Location hidden');
assert.equal(spoilerPanel.render().rows.length,0,'no zone or sector reaches the companion before the spoiler button');
assert.equal(spoilerPanel.onAction('invalid').ok,false,'unknown actions do not reveal anything');
assert.equal(spoilerPanel.onAction('toggle').ok,true);
assert.equal(spoilerPanel.render().rows.find(row=>row[0]==='Zone')[1],'Not selected');
C.update(0.016);assert.equal(C.debugSnapshot().phase,'waiting');
liveDay.day=14;C.update(0.016);
const active=C.debugSnapshot();
assert.equal(active.phase,'roam');
assert.equal(active.zone,'map_western_slope');
const expectedSector=[
  ['Northwest','North','Northeast'],['West','Center','East'],['Southwest','South','Southeast'],
][Math.floor((active.home.r+1.5)/map.rows*3)][Math.floor((active.home.c+1.5)/map.cols*3)]; // Independent check against the fixed nine-sector compass grid.
assert.equal(active.home.sector,expectedSector,'new sites save their correct geographical sector');
assert.equal(spoilerPanel.render().rows.find(row=>row[0]==='Zone')[1],'Western Slope');
assert.equal(spoilerPanel.render().rows.find(row=>row[0]==='Sector')[1],expectedSector);
assert.equal(spoilerPanel.onAction('toggle').ok,true);
assert.equal(spoilerPanel.render().rows.length,0,'Hide spoilers conceals the location again');
const levelSurface=map.tiles; // Intentionally varied authored cliff tiers must not be accepted as a 3×3 level house foundation.
map.tiles=levelSurface.map((tile,index)=>({...tile,elevTier:Math.floor(index/map.cols)%2}));
assert.equal(C.__test.chooseHouseSite('map_western_slope',active.cycle),null,
  'the Highland house cannot span alternating cliff/mesa tiers');
map.tiles=levelSurface;
assert.equal(active.collision,true);
assert.equal(registered.length,1);
assert.equal(C.__test.wallHit(active.home.c+0.05,active.home.r+1),true,'hidden house remains solid');
assert.equal(C.__test.wallHit(active.home.c+1.5,active.home.r+2.95),false,'real south doorway remains enterable');
const persisted=C.serialize();
assert.equal(persisted.home.sector,expectedSector,'sector is part of the existing world save, not a volatile UI guess');
game.getZoneLayout=()=>null; // A reload can restore saved encounter state before the target wilderness has generated.
C.restore(persisted);
assert.equal(C.debugSnapshot().phase,'roam');
spoilerPanel.onAction('toggle');
assert.equal(spoilerPanel.render().rows.find(row=>row[0]==='Sector')[1],expectedSector,
  'saved sector remains inspectable when the target map has not yet streamed in');
game.getZoneLayout=zone=>zone==='map_western_slope'?map:null;
C.restore({...persisted,home:{c:persisted.home.c,r:persisted.home.r}});
assert.equal(spoilerPanel.render().rows.find(row=>row[0]==='Sector')[1],expectedSector,
  'older world saves without a stored sector can infer it from the loaded zone');
C.restore(persisted);
assert.equal(C.debugSnapshot().home.c,active.home.c);
assert.equal(C.__test.lunarDay(14),14);
assert.equal(C.__test.lunarDay(28),28);
assert(saved>=2,'moon spawn and stable site save through existing world save adapter');
console.log('Boney Shinjimi assets, moon spawn, home collision, reward branches, work/regrowth and persistence passed.');


// Full encounter flow: actual module state; asynchronous walker materialization,
// two-way cover gating, flight to the house, four cutscene choices, no duplicate
// reward on an interrupted save, disappearance, and next full-moon reroll.
async function testRealEncounterFlow() {
  const prior = C.serialize(); // Existing moon fixture is reused instead of inventing a second save/calendar format.
  const center = {c:prior.home.c, r:prior.home.r}; // Stable house origin for all chase/door/choice assertions.
  const npc={root:{position:{x:center.c+1.5,y:0,z:center.r+3.5},parent:{remove(){}}},
    area:'map_western_slope',rec:{id:'boney_shinjimi'},resetRouteState(){},update(){}};
  const spawned=[],despawned=[];
  const sceneGroups=[]; // Tracks the real encounter's one authored Highland house in a fake active zone scene.
  const scene={add(group){group.parent=this;sceneGroups.push(group);},remove(group){group.parent=null;}};
  let generatedPiece=null; // Captures post-cut source geometry so the door can be verified against actual authored wall vertices.
  const authoredPiece=JSON.parse(read('docs/config/pieces/house-section-3x3.json'));
  moonWindow.GridTileAccessors={getActiveScene:()=>scene};
  moonWindow.THREE={};
  moonWindow.HousePieceGen={buildGroupFromPiece(_THREE,piece,c,r){
    generatedPiece=piece;
    assert.equal(c,center.c);assert.equal(r,center.r);
    return {visible:true,userData:{},parent:null,name:''};
  }};
  moonContext.fetch=async url=>{
    assert.equal(url,'config/pieces/house-section-3x3.json');
    return {ok:true,json:async()=>authoredPiece};
  };
  const colliders=[]; // Drives the same public Combat.debugMeleeColliders() API that the live game uses for recent swing hit volumes.
  moonWindow.Combat={debugMeleeColliders:()=>colliders};
  let walkerDt=0; // Verifies that momentary escape boosts affect the installed NPC walker instead of only its debug state.
  npc.update=dt=>{walkerDt=dt;};
  let visible=false, where='map_western_slope';
  game.npcWalkers=[];
  game.getCurrentArea=()=>where;
  game.makeNpcWalker=async rec=>{npc.rec=rec;spawned.push(rec.id);return npc;}; // Same asynchronous construction contract as the real trader walker.
  game.despawnNpcWalker=w=>{despawned.push(w); const at=game.npcWalkers.indexOf(w);if(at>=0)game.npcWalkers.splice(at,1);return true;};
  moonWindow.RangedWeapons={hasLineOfSight:()=>visible,actorHitbox:()=>({center:{x:npc.root.position.x,y:0.6,z:npc.root.position.z}})};
  const rewards=[];
  let feyStacks=4; // Simulates persistent player stacks with the same CookingSystem contract.
  moonWindow.CookingSystem={consumeFeySight(){const previous=feyStacks;feyStacks=0;return previous;},grantFeySight(n){feyStacks+=n;return feyStacks;}};
  const milkDialogues=[]; // Captures each actual authored milk conversation, including its three distinct greetings.
  const snapshotsAtGrant=[]; // The real relic owner saves synchronously while granting; confirm milk and count are already updated at that point.
  let failNextMilkGrant=false; // Simulates a failed relic award to verify rollback, without consuming the single-night allowance.
  let deferNextMilk=false; // Keeps a milk cutscene open while the world restores, exposing stale callback races.
  let continueDelayedMilk=null; // Test-only callback that releases the paused cutscene after a restore.
  let savedDuringGrant=null;
  moonWindow.BoneyShinjimiRewards={grant(kind){
    assert.equal(feyStacks,0,'reward helper may save immediately, so the first save already sees consumed Fey-sight');
    if(kind==='milk'){
      snapshotsAtGrant.push({count:C.serialize().milksGiven,milk:milkInventory[held.key]});
      if(failNextMilkGrant){failNextMilkGrant=false;throw new Error('intentional test grant failure');}
    }
    rewards.push(kind); return {kind:'boundRelic',origin:'Fey',key:'feyBound_dagger_123'};
  }};
  moonWindow.AuthoredCutsceneRuntime={async run(scene,handlers){
    if(scene.stages.some(stage=>stage.id==='milk_welcome')) {
      if(deferNextMilk){
        deferNextMilk=false;
        await new Promise(resolve=>{continueDelayedMilk=()=>{handlers.onDialogueContinue({id:'milk_reward'});resolve();};});
        return;
      }
      milkDialogues.push(scene.stages.map(stage=>stage.text));
      handlers.onDialogueContinue({id:'milk_reward'});
      handlers.onDialogueContinue({id:'milk_reward'}); // A repeated Continue must not award or consume another milk.
      return;
    }
    const demand=scene.stages.find(stage=>stage.id==='demand');
    assert.equal(demand.options.length,4);
    assert.deepEqual(Array.from(demand.options,x=>x.text),
      ['Something valuable!','Something useful!','-apologize-','Your hat!']);
    assert(scene.stages.some(stage=>stage.id==='hat_confusion'&&/My hat\?/.test(stage.text)));
    assert(scene.stages.some(stage=>stage.id==='dismiss'&&/leave my house/.test(stage.text)));
    handlers.onDialogueContinue({id:'useful_grant'});
    savedDuringGrant=C.serialize();
    // Simulates an interrupted scene after the reward enters the inventory.
  }};
  game.player.x=(center.c+4.5)*64; // Outside body-collision reach: isolates cover-aware LOS from the separate physical-contact escape mechanic.
  game.player.y=(center.r+3.5)*64;
  C.update(.05);
  for(let i=0;i<8;i++)await Promise.resolve(); // Resolve the independent house-fetch and NPC-building promises without wall-clock timers.
  C.update(.05);
  assert.equal(spawned.length,1,'single NPC materialization');
  const firstSightProxy=C.__test.sightProxy(npc); // RangedWeapons caches LOS and hitboxes on this object; it must be reused across scans.
  npc.root.position.x+=.25;
  const secondSightProxy=C.__test.sightProxy(npc);
  assert.equal(firstSightProxy,secondSightProxy,'Boney retains one identity for RangedWeapons LOS/hitbox caches');
  assert.equal(secondSightProxy.x,(center.c+1.75)*64,'cached sight proxy still samples live walker motion');
  npc.root.position.x-=.25;
  const bystander={area:'map_western_slope',rec:{id:'bystander'},root:{position:{x:npc.root.position.x+1,z:npc.root.position.z}}}; // Ordinary pedestrian must be an avoidance target.
  game.npcWalkers.push(bystander);
  assert.equal(C.__test.nearbyOtherNpc().x,bystander.root.position.x,'Boney detects nearby NPC walkers');
  game.npcWalkers.pop();
  const bandit={areaId:'map_western_slope',isBandit:true,health:50,
    x:(npc.root.position.x+2)*64,y:npc.root.position.z*64}; // Hostile humanoids use pixel coordinates and are not NPC walkers.
  game.hostileObjects=[bandit];
  assert.equal(C.__test.nearbyOtherNpc().x,bandit.x/64,'Boney also detects nearby bandits and barbarians through the hostile roster');
  game.hostileObjects=[];
  assert.equal(sceneGroups.length,1,'only one authored house is materialized');
  const jambs=generatedPiece.base.faces.filter(face=>String(face.id).includes('_boneyDoor_'));
  assert.equal(jambs.length,3,'south wall has two physical jambs and a lintel');
  assert.equal(generatedPiece.footprint.cells.length,9,'Highland house retains its 3×3 footprint');
  assert.equal(sceneGroups[0].visible,true,'house is visible while Boney is near it');
  npc.root.position.x=center.c+12; npc.root.position.z=center.r+12;
  C.update(.05);
  assert.equal(sceneGroups[0].visible,false,'house is hidden when the hermit is far away');
  assert.equal(C.debugSnapshot().collision,true,'magic house remains solid even when invisible');
  npc.root.position.x=center.c+1.5; npc.root.position.z=center.r+3.5;
  C.update(.05);
  assert.equal(npc.rec.equippedCosmetics.includes(hat),true,'Boney starts wearing the real kasa');
  assert.equal(npc.rec.appearance.cosmetics.facialHair,beard,'Boney has the authored Grand Beard');
  for(let i=0;i<4;i++)C.update(.10);
  assert.equal(C.debugSnapshot().phase,'roam','cover blocks Boney from detecting the player');
  visible=true;
  for(let i=0;i<4;i++)C.update(.10);
  assert.equal(C.debugSnapshot().phase,'flee','mutual LOS starts the chase');
  assert.equal(C.debugSnapshot().escaped,1);
  const catchesBefore=C.debugSnapshot().catches;
  game.player.x=npc.root.position.x*64;
  game.player.y=npc.root.position.z*64;
  C.update(.1);
  assert.equal(C.debugSnapshot().catches,catchesBefore+1,'player-body hitbox contact triggers escape boost');
  npc.update(.1);
  assert(walkerDt>0.26&&walkerDt<0.28,'body-contact escape boost multiplies the normal walker dt by 2.7 temporarily');
  game.player.x=(npc.root.position.x-1.6)*64;
  game.player.y=npc.root.position.z*64;
  for(let i=0;i<10;i++)C.update(.1); // Let the brief contact cooldown expire without another body overlap.
  colliders.push({actor:game.player,recordedAt:Date.now(),
    origin:{x:npc.root.position.x-1,y:0.6,z:npc.root.position.z},
    horizontalRangeWorld:2.2,verticalRiseWorld:0,halfConeRad:0.8,yaw:0,halfHeightWorld:0.4});
  C.update(.1);
  assert.equal(C.debugSnapshot().weaponContacts,1,'recent real melee collider triggers the distinct weapon-contact escape boost');
  colliders.length=0;
  npc.root.position.x=center.c+1.5;npc.root.position.z=center.r+1.5;
  C.update(.1);
  assert.equal(C.debugSnapshot().phase,'home','Boney reaches his hiding place');
  game.player.x=(center.c+1.5)*64; // Walk through the south opening into the house after Boney gets home.
  game.player.y=(center.r+1.5)*64;
  C.update(.1);
  await new Promise(resolve=>setImmediate(resolve)); // Flush the sandboxed cutscene's Promise jobs before testing post-confrontation actions.
  assert.equal(C.debugSnapshot().phase,'leaving','the confrontation must finish before gifting becomes available');
  assert.equal(rewards.length,1,'entering while Boney is home grants exactly one chosen prize');
  assert.equal(rewards[0],'useful');
  assert.equal(feyStacks,0,'successful choice clears every stack');
  assert.equal(savedDuringGrant.phase,'leaving','an immediate mid-cutscene save must not revive the gift dialogue');
  assert.equal(C.serialize().phase,'leaving');

  // Use the actual NpcGifting module against Boney's live walker, not a simulated button handler.
  vm.runInContext(read('docs/js/npc-gifting.js'),moonContext);
  const milkInventory={puktukMilk:2,yellowDewMilk:1,uumkaoiiWhiteDewMilk:1,apple:2}; // Three types of real in-game milk plus a forbidden non-milk gift.
  const milkDefs={puktukMilk:{label:'Puktuk Milk',icon:'🥛'},yellowDewMilk:{label:'Yellow Uumkao’ii Milk',icon:'🫙'},
    uumkaoiiWhiteDewMilk:{label:'White Uumkao’ii Milk',icon:'🫙'},apple:{label:'Apple',icon:'🍎'}};
  let held={kind:'item',key:'apple',def:milkDefs.apple}; // Swapped as the player changes the held item in the existing gifting UI.
  const giftDeps={
    inventory:milkInventory,getItemDefs:()=>milkDefs,getHeldGiftItem:()=>held,
    clampInventoryStack(){},refreshItemScroll(){},buildInventoryGrid(){},buildEquipmentSlots(){},
    refreshActionBar(){},saveMemberWorldData(){},showToast(){},
  };
  moonWindow.NpcGifting.init(giftDeps);
  const gifting=moonWindow.NpcGifting;
  const allMilkDefs=Object.values(JSON.parse(read('docs/config/items/item-index.json')))
    .filter(item=>/Milk$/.test(item.key) && /milk$/i.test(item.label)); // Canonical milk variants, not inferred from cooking ingredients.
  assert(allMilkDefs.length>=8,'the authored item catalog contains multiple milk variants');
  for(const milk of allMilkDefs) {
    assert(C.canAcceptMilkGift({kind:'item',key:milk.key,def:milk},
      {...giftDeps,inventory:{...milkInventory,[milk.key]:1}}),milk.key+' is recognized as milk');
  }
  assert(C.canAcceptMilkGift({kind:'item',key:'garWolfMilk',def:{label:'Gar-wolf Milk'}},
    {...giftDeps,inventory:{...milkInventory,garWolfMilk:1}}),'runtime livestock milk is eligible too');
  assert.equal(gifting.getNpcGiftOfferAction(npc),null,'no gift action for non-milk, even after confrontation');
  assert.equal(gifting.offerGift(npc),false,'direct non-milk press cannot bypass rejection');
  assert.equal(milkInventory.apple,2,'rejected ordinary gift not consumed');
  held={kind:'item',key:'puktukMilk',def:milkDefs.puktukMilk};
  feyStacks=7;failNextMilkGrant=true;
  assert.equal(gifting.offerGift(npc),true,'failed grant is attempted through real gifting');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(milkInventory.puktukMilk,2,'a failed weapon grant rolls milk back');
  assert.equal(C.serialize().milksGiven,0,'failed weapon grant does not use a milk allowance');
  assert.equal(rewards.length,1,'a failed weapon grant creates no new prize');
  assert.equal(feyStacks,7,'failed reward preserves all prior stacks');
  assert.equal(snapshotsAtGrant.length,1,'a duplicate Continue does not retry a failed award');
  assert(gifting.getNpcGiftOfferAction(npc),'the gift can be retried after an unsuccessful award');
  deferNextMilk=true;
  assert.equal(gifting.offerGift(npc),true,'paused milk cutscene starts before reload');
  assert.equal(typeof continueDelayedMilk,'function','a pending dialogue Continue is available for race testing');
  C.restore(C.serialize()); // Same room and milk count; only encounter generation distinguishes the stale cutscene.
  continueDelayedMilk();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(milkInventory.puktukMilk,2,'a stale post-reload dialogue cannot consume milk');
  assert.equal(C.serialize().milksGiven,0,'a stale post-reload dialogue cannot increment the limit');
  assert.equal(snapshotsAtGrant.length,1,'a stale post-reload dialogue cannot create another Fey relic');
  assert.equal(feyStacks,7,'stale post-reload reward cannot consume Fey-sight');
  C.update(.1); // Restores the ordinary NPC walker after scene cancellation without changing the encounter.
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(C.debugSnapshot().phase,'leaving','reloaded completed confrontation remains in post-dialogue phase');
  for(const key of ['puktukMilk','yellowDewMilk','uumkaoiiWhiteDewMilk']) {
    held={kind:'item',key,def:milkDefs[key]};
    const milkAction=gifting.getNpcGiftOfferAction(npc);
    assert(milkAction,key+' is eligible before the third exchange: '+JSON.stringify({
      giftable:gifting.isItemGiftable(held),accepted:C.canAcceptMilkGift(held,giftDeps),
      phase:C.debugSnapshot().phase,milkCount:C.debugSnapshot().milksGiven,
      reward:!!C.debugSnapshot().reward,zone:C.debugSnapshot().zone,
      player:game.player,npc:npc.root.position,
    }));
    assert.equal(gifting.offerGift(npc),true,'milk gift opens its cutscene');
    assert.equal(gifting.offerGift(npc),false,'repeated input during the active cutscene is rejected');
    await new Promise(resolve=>setImmediate(resolve)); // Finish the VM-owned milk cutscene before offering the next milk.
    assert.equal(C.debugSnapshot().phase,'leaving','Boney remains in the house after a milk exchange');
    assert.equal(feyStacks,0,'successful milk reward consumes Fey-sight');
  }
  assert.equal(milkInventory.puktukMilk,1);
  assert.equal(milkInventory.yellowDewMilk,0);
  assert.equal(milkInventory.uumkaoiiWhiteDewMilk,0);
  assert.equal(rewards.filter(kind=>kind==='milk').length,3,'three milk gifts each get one Fey weapon');
  assert.equal(milkDialogues.length,4,'failed first offer may be retried without using the allowance');
  assert.match(milkDialogues[1][0],/Milk is good for my bones/);
  assert.match(milkDialogues[2][0],/More milk/);
  assert.match(milkDialogues[3][0],/A third milk/);
  assert.deepEqual(snapshotsAtGrant.slice(1).map(entry=>entry.count),[1,2,3],
    'immediate reward saves must see the incremented milk count, preventing save/load duplication');
  assert.deepEqual(snapshotsAtGrant.slice(1).map(entry=>entry.milk),[1,0,0],
    'immediate reward saves must see each consumed milk in inventory');
  assert.equal(C.serialize().milksGiven,3,'milk limit persists in the existing world record');
  held={kind:'item',key:'puktukMilk',def:milkDefs.puktukMilk};
  assert.equal(gifting.getNpcGiftOfferAction(npc),null,'fourth milk gift is never offered');
  assert.equal(gifting.offerGift(npc),false,'direct fourth gift cannot consume milk');
  assert.equal(milkInventory.puktukMilk,1);
  C.restore({...C.serialize(),phase:'home'});
  assert.equal(C.debugSnapshot().phase,'leaving','old inconsistent saves with an awarded prize are upgraded to departure');
  assert.equal(C.debugSnapshot().milksGiven,3,'gift limit survives save/restore');
  for(let i=0;i<4;i++)C.update(.10);
  assert.equal(rewards.length,4,'reloading in a gifted house never awards another encounter or milk prize');
  game.player.y=(center.r+3.3)*64; // Player steps beyond the physical south doorway, remaining in the same wilderness zone.
  C.update(.1);
  assert.equal(C.debugSnapshot().phase,'complete','crossing the door threshold makes the enchanted house vanish immediately');
  where='town';C.update(.1);
  assert.equal(C.debugSnapshot().collision,false);
  const finished=C.serialize();
  assert.equal(finished.completedCycle,finished.cycle,'moon cycle recorded as claimed');
  where='town';liveDay.day=42;C.update(.1);
  assert.equal(C.debugSnapshot().cycle,1,'next full moon starts a new encounter');
  assert.equal(C.debugSnapshot().phase,'roam');
  assert.equal(C.debugSnapshot().reward,null,'next encounter begins without an old reward');
  assert.equal(C.serialize().hatTaken,false,'kasa resets for subsequent moons');
  assert.equal(C.serialize().milksGiven,0,'the next full moon resets Boney’s per-visit milk limit');
}
testRealEncounterFlow().then(()=>console.log('Boney chase, scene, reward-idempotence and next-moon integration passed.'))
  .catch(error=>{console.error(error);process.exitCode=1;});
