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
const hat='appearance::hat::riverlandskasa_wide'; // Documented temporary stand-in for the missing Old Highlands kasa art.
assert.equal(species.speciesId,'boney-shinjimi-skeleton');
assert(species.male.allowedCosmetics.includes(beard));
assert(species.male.allowedCosmetics.includes(hat));
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
  EnchantmentSystem:{DEFINITIONS:{locked:{id:'locked',type:'Base'},learned:{id:'learned',type:'Base'}},
    BASE_LIMIT:2,isBaseUnlocked:id=>id==='learned',isFlourishUnlocked:()=>false},
  HarlyaoRelics:{makeRelic:()=>({shape:'longsword',uid:'u1',enchantments:{base:['learned'],flourishes:{}}}),
    grantBoundRelic:()=> 'bound-u1'},
  TrinketSystem:{DEFINITIONS:{first:{displayName:'First'},second:{displayName:'Second'}},
    ownedEntries:()=>[{id:'first'}],grant:id=>'trinket-'+id}};
const ctx=vm.createContext({window:W,console,Math,Date});
vm.runInContext(read('docs/js/boney-shinjimi-rewards.js'),ctx);
const rewards=W.BoneyShinjimiRewards;
assert.equal(rewards.artifactChoice(['artifactLow'],()=>0).key,'artifactHigh');
assert.equal(rewards.artifactChoice(['artifactLow','artifactHigh'],()=>0).key,'artifactHigh');
assert.equal(rewards.relicWithUnlearnedEnchantment(()=>0).enchantments.base[0],'locked');
const deps={inventory:{},ITEM_DEFS:{['cosmetic:'+hat]:{label:'Kasa'}},
  tothalWorldId:()=> 'w',buildInventoryGrid(){},saveMemberWorldData(){},showToast(){}};
assert.equal(rewards.grant('valuable',deps,()=>0).key,'artifactHigh');
assert.equal(deps.inventory.artifactHigh,1);
assert.equal(rewards.grant('useful',deps,()=>0).key,'bound-u1');
delete W.EnchantmentSystem.DEFINITIONS.locked;
assert.equal(rewards.grant('apologize',deps,()=>0).id,'second');
assert.equal(rewards.grant('hat',deps,()=>0).key,'cosmetic:'+hat);

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
