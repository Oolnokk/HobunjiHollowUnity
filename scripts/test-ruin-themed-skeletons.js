const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let theme='hronal',calls=[],fires=[],plasm=[];
const window={GameRandom:{random:()=>.1},DevRandomRuin:{getRuntimeContext:()=>({theme})},DevRandomRuinLichThemes:{activeTheme:()=>theme,createSkeletonPlasmTile:(x,z,y)=>{plasm.push({tiles:[{x,z,y}],opts:{ttl:5}});return {};}},
DynamicSurfaces:{sampleSupport:()=>({y:4})},PersistentGroundFire:{ignite:o=>{fires.push(o);return true;}},ResourceSystem:{setImmutableAffliction(){}},
GhoulSpecialVariants:{rollEnchantedWeapon:(rnd,o)=>{assert.equal(o.singleBase,true);return {enchantments:{base:['burning'],flourishes:{}}};}},
BanditCombat:{makeEntity:async(cfg,rank,tier,x,y,o)=>{calls.push(o);return {maxFooting:10,maxHealth:100,def:{weaponShapeKey:'warhammer'},rosterRecord:o.rosterOverride,...o.extra};}}};
vm.runInNewContext(fs.readFileSync('docs/js/combat/combat-minion.js','utf8'),{window,console});
(async()=>{const m=window.MinionCombat,o={zoneId:'map_i_dev_random_ruin',roster:{appearance:{speciesId:'harlyao-skeleton'}},baseConfig:{}};
await m.makeEntity(o);assert.equal(calls.at(-1).extra.ruinSkeletonHealthMultiplier,1.5);
const e=await m.makeEntity({...o,extra:{wallCoffin:0}});assert.equal(e.ruinSkeletonHealthMultiplier,3);assert.equal(e.rosterRecord.enchantedWeapon.relicShape,'warhammer');
await m.makeEntity({...o,zoneId:'map_mine'});assert.equal(calls.at(-1).extra.ruinSkeletonTheme,undefined);
const c={health:10,ruinSkeletonTheme:'hronal',physicalFeetY:4};m.trailMovement(c,0,0,128,0,'move',64);assert.equal(fires.length,0);
m.trailMovement(c,0,0,128,0,'lunge',64);assert.equal(fires.length,3);assert.ok(fires.every(f=>f.y===4));
theme='kanthic';const k={health:10,ruinSkeletonTheme:theme,physicalFeetY:4};m.trailMovement(k,0,0,128,0,'dodge',64);
assert.ok(plasm.length>=2);const count=plasm.length;
window.DynamicSurfaces.sampleSupport=()=>({y:null});m.trailMovement(k,128,0,256,0,'move',64);assert.equal(plasm.length,count);
window.DynamicSurfaces.sampleSupport=()=>({y:4});k.prone=true;m.trailMovement(k,256,0,384,0,'move',64);assert.equal(plasm.length,count);assert.ok(plasm.every(p=>p.tiles.length===1&&p.opts.ttl===5));
// Exercise the actual shared hit publisher, enchantment listener and bound-loot helper, not just mocks.
const gear={weaponEnchantments:{sameWeapon:{base:['mirrored','soulweight'],flourishes:{tap1:'fury'}},control:{base:['burning'],flourishes:{}}}};
let grants=0;const nativeWindow={Combat:{deps:{getGearInventory:()=>gear,player:{}},loadout:{SLOT_IDS:['tap1','tap2','hold1','hold2']}},
  ResourceSystem:{addAffliction(a,id,n){a[id]=(a[id]||0)+n;return n;},addEnhancedResource(a,id,n){a[id]=(a[id]||0)+n;return n;}},
  GameRandom:{random:()=>.9},__farmLog(){},HarlyaoRelics:{SHAPES:{warhammer:{label:'Harlyao Warhammer'}},makeRelic:shape=>({shape}),grantBoundRelic:relic=>{grants++;assert.equal(relic.shape,'warhammer');assert.equal(relic.enchantments.base.length,1);assert.equal(relic.enchantments.base[0],'burning');return 'bound';}}};
const nativeCtx={window:nativeWindow,console,performance:{now:()=>3000}};
for(const path of ['combat-attack-events','combat-enchantments','ghoul-special-variants'])vm.runInNewContext(fs.readFileSync('docs/js/combat/'+path+'.js','utf8'),nativeCtx);
const weapon=nativeWindow.GhoulSpecialVariants.rollEnchantedWeapon(()=>.1,{singleBase:true,baseIds:['burning']});
assert.equal(weapon.enchantments.base.length,1);assert.equal(Object.keys(weapon.enchantments.flourishes).length,0);weapon.relicShape='warhammer';
const guard={health:100,ruinWallCoffin:true,rosterRecord:{enchantedWeapon:weapon}},victim={health:30},control={health:30};
const hit=(attacker,target,key)=>nativeWindow.CombatAttackEvents.hit(null,{attacker,target,weaponKey:key,slotId:'tap1',attackCategory:'combo',comboFinisher:true,actualDamage:12});
hit(guard,victim,'sameWeapon');hit({health:100},control,'control');
assert.ok(victim.burningHealth>0);assert.equal(victim.burningHealth,control.burningHealth);
assert.equal(victim.soulweightedHealth,undefined);assert.equal(guard.mirroredHealth,undefined);assert.equal(guard.furiousStamina,undefined);
assert.equal(gear.weaponEnchantments.sameWeapon.base.length,2);
assert.equal(nativeWindow.GhoulSpecialVariants.lootEnchantedWeapon(guard).key,'bound');assert.equal(nativeWindow.GhoulSpecialVariants.lootEnchantedWeapon(guard).key,'bound');assert.equal(grants,1);
console.log('ruin themed skeleton regressions passed');
})().catch(e=>{console.error(e);process.exitCode=1;});