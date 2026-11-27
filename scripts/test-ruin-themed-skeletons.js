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
window.DynamicSurfaces.sampleSupport=()=>({y:4});k.prone=true;m.trailMovement(k,256,0,384,0,'move',64);assert.equal(plasm.length,count);assert.ok(plasm.every(p=>p.tiles.length===1&&p.opts.ttl===5));console.log('ruin themed skeleton regressions passed');
})().catch(e=>{console.error(e);process.exitCode=1;});