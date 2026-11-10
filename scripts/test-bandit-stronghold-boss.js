'use strict';
// Native Bandit Lord integration regression. Run with:
// node scripts/test-bandit-stronghold-boss.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const stateStore=new Map(); // Same storage contract as the existing CaveSiteSystem world-save test.
const inventory={}; // Original item inventory receives genuine keys and mastery-scroll item keys.
const grants=[]; // Captures exactly-once native Shattercasks loot mutations.
const ctx={
  console,setTimeout,clearTimeout,Promise,Map,Set,Math,Number,String,JSON,Object,
  __farmLog(){},__hobunjiPlayerProfile:{worldId:'bandit-lord-fixture'},
  CalendarSystem:{tothalCycle:()=>3},
  localStorage:{getItem:key=>stateStore.get(key)||null,setItem:(key,value)=>stateStore.set(key,String(value))},
  CavernGenerator:{expandCavernMapData(map){map.outerRimTiles=[];return map;}}, // The production boss passes its circular floor into this actual cavern-generation API.
  BanditCamps:{makeCorpseWorldObject:()=>({onAction:()=>({ok:true,message:'Looted the Bandit Lord'})})},
  Shattercasks:{grantBurdenLoot(items){
    grants.push({...items});
    for(const [key,count] of Object.entries(items))inventory[key]=(inventory[key]||0)+count;
    return Object.entries(items).map(([key,count])=>key+'×'+count);
  }},
  ItemProcessing:{init(deps){this.deps=deps;}},
  LootRolling:{rollLootPool(id){assert.match(id,/^dungeonChest_tier[234]$/);return {gold:21};}},
  TrinketSystem:{claimLoot:()=>[]},
};
ctx.window=ctx;
vm.createContext(ctx);
for(const file of ['docs/js/cave-site-system.js','docs/js/bandit-stronghold-boss.js']) {
  vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});
}
const Cave=ctx.CaveSiteSystem;
const Boss=ctx.BanditStrongholdBoss;
const plain=value=>JSON.parse(JSON.stringify(value)); // Objects from the VM realm have different prototypes.
Cave.init({save(){}});
ctx.ItemProcessing.init({ITEM_DEFS:{},inventoryItems:[],inventory});
assert(ctx.ItemProcessing.deps.ITEM_DEFS.strongholdTreasuryKey,'real key definition registered');
assert.equal(ctx.ItemProcessing.deps.ITEM_DEFS.strongholdTreasuryKey.sellPrice,0);

const parent=Cave.registerFortifiedStronghold('map_western_slope',1); // Existing camp converted without another den anchor.
const lord=Cave.profileForMapId(parent.mapId+'_boss');
const treasury=Cave.profileForMapId(parent.mapId+'_treasury');
assert.equal(lord.fortifiedStrongholdChild,'boss');
assert.equal(treasury.fortifiedStrongholdChild,'treasury');
const candidates=Array.from({length:15},(_,x)=>Array.from({length:15},(_,y)=>({col:x+3,row:y+3}))).flat();
const original={floor:candidates.map(t=>[t.col,t.row]),exits:[{id:'den_exit',tiles:[[4,4]]}],exitCol:4,exitRow:4};
const plan={banditSpawns:[{col:7,row:7}]};
assert.equal(Boss.decorateParent(parent,original,plan,new Set(['4,4']),candidates),true);
assert.equal(original.keyGatedDoors[0].requiresKeyItem,'strongholdGarrisonSeal');
assert.equal(original.exits[1].targetMap,lord.mapId);
assert(Cave.strongholdGateReturn(parent.mapId,'boss'),'boss gate tile persists separately from the room shell');
const initial=()=>({floor:[],exits:[{id:'den_exit',tiles:[[12,12]]}],
  exitCol:12,exitRow:12,outerRimTiles:[],colliders:[[1,1]],mesh:{}});
const arena=Boss.decorateChild(lord,initial());
const annex=Boss.decorateChild(treasury,initial());
assert(arena.floor.length>125&&arena.floor.length<180,'circular arena has controlled round footprint');
assert.equal(arena.caveBanditSpawns.length,1,'one real mastery-5 captain, not four standard hideout enemies');
assert.equal(arena.caveBanditSpawns[0].tier,3);
assert.equal(arena.exits[0].targetMap,parent.mapId);
assert.equal(arena.keyGatedDoors[0].requiresKeyItem,'strongholdTreasuryKey');
assert.equal(annex.exits[0].targetMap,lord.mapId,'treasury returns to the separate boss room');
assert.equal(annex.colliders,annex.outerRimTiles,'stale generic-den colliders replaced by round arena rim');
assert.deepEqual(plain(annex.strongholdTreasuryChests.map(c=>c.key)),
  ['ruinDungeonChestT2','ruinDungeonChestT3','ruinDungeonChestT4']);
assert(annex.strongholdBarrels.length>=5&&annex.strongholdBarrels.length<=8,
  'treasury contains 5–8 physical reusable Aging Barrel Burdens');
assert.equal(Cave.fortifiedStrongholdCleared(parent.mapId),false,'a living lord prevents premature camp turnover');
const parentState=Cave.__test.runtimeStateBySignature.get(parent.signature);
parentState.occupantsCleared=true;
assert.equal(Boss.tick(parent,plan,parentState,{}),true,'cleared garrison unlocks native physical gate');
assert.equal(inventory.strongholdGarrisonSeal,1);
assert.equal(Boss.tick(parent,plan,parentState,{}),false,'garrison seal is not awarded twice');
assert.equal(Cave.fortifiedStrongholdCleared(parent.mapId),false,'boss must also be defeated');

const hostiles=new Set(),companions=new Set(),wolves=[];
const victim={x:512.1,y:512.1,health:100};
let footing=0,collateral=0;
ctx.ResourceSystem={spendFooting:()=>{footing++;}};
const nativeDeps={TILE:64,hostileObjects:hostiles,companionObjects:companions,
  getActiveScene:()=>({}),getActiveGrid:()=>[],getActiveCols:()=>32,getActiveRows:()=>32,
  makeCreatureEntity(kind,x,y,options){
    assert.equal(kind,'gar-wolf');
    const wolf={id:'native-beast-'+wolves.length,x,y,health:40,maxHealth:40,def:{maxHealth:40,attackDamage:12},...options};
    wolves.push(wolf);return wolf;
  },
  damageCreature:()=>{collateral++;return 1;},
  despawnCreature(){},
};
const lordEntity={id:'native-lord',health:80,maxHealth:80,def:{maxHealth:80,attackTag:'sharp',
    banditAbilityLoadout:{tap1:'swingCombo'}},x:512,y:512,areaId:lord.mapId};
assert.equal(Boss.entityOptions(lord,{strongholdLord:true})?.nameOverride,'Bandit Lord');
Boss.onEntitySpawned(lord,{strongholdLord:true,bossVariant:'beastkeeper'},lordEntity,nativeDeps);
assert.equal(lordEntity.banditMastery,5);
assert(lordEntity.health>=180,'Bandit Lord substantially more durable than a captain');
assert.equal(wolves.length,3,'Beastkeeper summons three actual gar-wolf entities');
assert(wolves.every(w=>w.banditStrongholdBossWolf&&w.banditCompanion&&w.health>60));
assert.equal(Boss.onWolfPounce(wolves[0],victim,nativeDeps),true);
assert.equal(footing,1,'native pounce adds extra Footing damage');
assert.equal(collateral,1,'Beastkeeper wolf pounce can accidentally damage the lord');

ctx.CombatProgression={
  getTree:()=>[[{label:'Bleeding',effectId:'bleed',afflictions:{bleedingHealth:10}},
    {label:'Poison',effectId:'poison',afflictions:{poisonedHealth:8}},
    {label:'Wind',effectId:'wound',quickBonusAfflictions:{woundedStamina:6}}]],
  getEffectCatalog:()=>['bleed','poison','wound'].map(id=>({id,unlockRanks:{sharp:[3,4,5]}})),
  itemKey:(type,rank,id)=>'masteryScroll:'+type+':'+rank+':'+id,
};
const augmented=Boss.enrichHit(lordEntity,{tag:'sharp',afflictionBonuses:{bleedingHealth:2}});
assert.equal(lordEntity._banditLordLastMasteryEffects.length,3);
assert.equal(augmented.afflictionBonuses.bleedingHealth,12);
assert.equal(augmented.afflictionBonuses.poisonedHealth,8);
assert.equal(augmented.afflictionBonuses.woundedStamina,6);
const first=ctx.BanditCamps.makeCorpseWorldObject(lordEntity).onAction('obj_loot_corpse');
assert(first.ok&&grants.at(-1).strongholdTreasuryKey===1);
assert.equal(Object.keys(grants.at(-1)).filter(key=>key.startsWith('masteryScroll:')).length,3,
  'lord corpse drops three real mastery-unlock scrolls');
const count=grants.length;
ctx.BanditCamps.makeCorpseWorldObject(lordEntity).onAction('obj_loot_corpse');
assert.equal(grants.length,count,'corpse loot hook cannot grant duplicate treasury keys or scrolls');
assert.equal(Cave.strongholdStage(lord.mapId).lordKeyClaimed,true);

const chest=annex.strongholdTreasuryChests[0],chestPlan={strongholdTreasuryChests:annex.strongholdTreasuryChests};
const object=Boss.objectAt(treasury,chestPlan,chest.col,chest.row,{},
  {currentArea:treasury.mapId,distanceTiles:.1});
assert.equal(object.getButtons()[0].action,'obj_loot_stronghold_chest');
assert.equal(object.onAction('obj_loot_stronghold_chest').ok,true);
assert.equal(object.onAction('obj_loot_stronghold_chest').ok,false,'second action cannot duplicate loot');
assert.equal(Cave.strongholdStage(treasury.mapId).treasuryClaimed.length,1);
const saved=Cave.serialize();
Cave.restore(saved);
assert.equal(Cave.profileForMapId(lord.mapId).fortifiedStrongholdChild,'boss',
  'loading into the boss map restores synthetic profile even when wilderness has not generated');
assert.equal(Cave.profileForMapId(treasury.mapId).fortifiedStrongholdChild,'treasury');
assert.equal(Cave.strongholdStage(treasury.mapId).treasuryClaimed.length,1,'chest claims persist with world save');
assert.equal(Cave.strongholdStage(lord.mapId).lordKeyClaimed,true);

const volleys=[];let staged;
ctx.BanditCombat={availableFlaskRecipeIds:()=>['fire','ice'],finishAction:entity=>{entity._banditAction=null;}};
ctx.BanditStrongholdCombat={launch:(entity,target,kind)=>{volleys.push(kind);return Promise.resolve(true);}};
ctx.AlchemyFlasks={throwFromEntity:(entity,recipe,tier,x,y)=>{volleys.push({recipe,tier,x,y});return true;}};
ctx.Combat={beginStagedAction:spec=>{staged=spec;return {active:true};}};
ctx.HeldActionAnimations={throwFlask:{poses:{},durationS:1,style:'chop'}};
ctx.RangedWeapons={hasLineOfSight:()=>true};
const demo={id:'demolitionist',areaId:lord.mapId,banditStrongholdBoss:true,
  banditStrongholdVariant:'demolitionist',x:0,y:0,health:100,_strongholdTileSize:64};
const hero={x:64*6,y:0,health:100};
for(let i=0;i<3;i++){
  demo._strongholdVolleyCooldown=0;
  assert.equal(Boss.updateAI(demo,.12,hero).handled,true,'volley uses native staged attack');
  staged.onStrike();staged.onComplete();
}
assert.equal(volleys.filter(x=>typeof x==='string').length,3,'three physical Shattercasks thrown');
assert.equal(volleys.filter(x=>x.recipe).length,6,'two real Alchemy flasks per volley');
assert(demo._strongholdVolleyCooldown>=6,'demolitionist must melee after exactly three volleys');
Boss.forgetMap(lord.mapId,nativeDeps);
console.log('Bandit Lord circle, native keys, 3 wolves, effects, corpse scrolls, treasury and Demolitionist volleys: OK');
