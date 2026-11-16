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
delete W.EnchantmentSystem.DEFINITIONS.locked;
assert.equal(rewards.grant('apologize',deps,()=>0).id,'second');
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
const map={cols:60,rows:60,tiles:Array.from({length:3600},()=>({type:'grass'})),buildings:[]};
const moonWindow={
  __hobunjiGameStarted:true,GameRandom:{random:()=>0.5},
  NpcPathfinding:{isNpcTileWalkable:()=>true,findNpcPath:()=>[1]},
  AreaFootprintBlockers:{register:(id,provider)=>{registered.push({id,provider});return ()=>{};}},
  NpcScheduling:{registerTargetOverride(){}},
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
C.update(0.016);assert.equal(C.debugSnapshot().phase,'waiting');
liveDay.day=14;C.update(0.016);
const active=C.debugSnapshot();
assert.equal(active.phase,'roam');
assert.equal(active.zone,'map_western_slope');
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
C.restore(persisted);
assert.equal(C.debugSnapshot().phase,'roam');
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
  let savedDuringGrant=null;
  moonWindow.BoneyShinjimiRewards={grant(kind){
    rewards.push(kind); return {kind:'boundRelic',key:'feyBound_dagger_123'};
  }};
  moonWindow.AuthoredCutsceneRuntime={async run(scene,handlers){
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
  await Promise.resolve();await Promise.resolve();
  assert.equal(rewards.length,1,'entering while Boney is home grants exactly one chosen prize');
  assert.equal(rewards[0],'useful');
  assert.equal(savedDuringGrant.phase,'leaving','an immediate mid-cutscene save must not revive the gift dialogue');
  assert.equal(C.serialize().phase,'leaving');
  C.restore({...C.serialize(),phase:'home'});
  assert.equal(C.debugSnapshot().phase,'leaving','old inconsistent saves with an awarded prize are upgraded to departure');
  for(let i=0;i<4;i++)C.update(.10);
  assert.equal(rewards.length,1,'reloading in a gifted house never awards another item');
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
}
testRealEncounterFlow().then(()=>console.log('Boney chase, scene, reward-idempotence and next-moon integration passed.'))
  .catch(error=>{console.error(error);process.exitCode=1;});
