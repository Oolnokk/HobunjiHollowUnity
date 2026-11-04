'use strict';
// Regression: specialized combat trinkets and attributable Shattercask chains.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const shatter=read('docs/js/shattercasks.js'); // Same source used for the runtime, not a copied detonation model.
const flask=read('docs/js/alchemy-flasks.js'); // Player release snapshots are checked against real module source.
const ranged=read('docs/js/combat/ranged-weapons.js'); // Projectile ownership branch decides attribution.
const loot=JSON.parse(read('docs/config/loot/loot-pools.json')); // Regular dungeon reward tables.
const env={console,Date,performance:{now:()=>1000},CustomEvent:class CustomEvent{},
  SCRATCHBONES_CONFIG:{game:{combat:{resourceSystem:{pukeChancePerSec:0}}}},
  addEventListener(){},dispatchEvent(){}};
env.window=env;vm.createContext(env);
const load=p=>vm.runInContext(read(p),env,{filename:p});
load('docs/js/combat/resource-system.js');
const rs=env.ResourceSystem;
const player={health:100,maxHealth:100,stamina:100,maxStamina:100,footing:100,maxFooting:100,x:0,y:0};
rs.initEntity(player);
let gear={trinkets:[],equippedTrinkets:[]}; // Mirrors saved player gear passed to Combat.
env.Combat={deps:{player,getGearInventory:()=>gear,saveGearInventory(){}},
  init(d){this.deps=d;},update(){return true;}};
load('docs/js/trinket-system.js');
const ts=env.TrinketSystem;
const all=['evasion','companionPoise','rapidRecovery','unshaken','secondBreath','counterweight','flaskmaster']; // User-approved combat trinket IDs.
for(const id of all){
  assert.equal(ts.DEFINITIONS[id]?.category,'combat',id+' must be combat-only');
  assert(['dungeonChest_tier2','dungeonChest_tier3','dungeonChest_tier4'].some(t=>
    loot.pools[t].entries.some(e=>e.itemKey==='trinket_'+id)),id+' must drop in real chests');
}
const equip=id=>{const uid=ts.grant(id,'test');assert(ts.equip(uid).ok);return uid;};
const restore=uid=>assert(ts.unequip(uid));
const recoveryBase=rs.getAfflictionRecoveryMultiplier(player,'bruisedHealth');
const rapid=equip('rapidRecovery');
assert(Math.abs(rs.getAfflictionRecoveryMultiplier(player,'bruisedHealth')/recoveryBase-1.4)<1e-9);
assert.equal(rs.getAfflictionRecoveryMultiplier(player,'bleedingHealth'),0,'does not accelerate bleeding tick');
restore(rapid);
assert.equal(rs.getAfflictionRecoveryMultiplier(player,'bruisedHealth'),recoveryBase);
const breath=equip('secondBreath');
assert.equal(rs.statModifier(player,'exhaustionRecovery'),1.35);
assert.equal(rs.statModifier(player,'staminaRegen'),1);
restore(breath);
const poise=equip('companionPoise');
assert.equal(ts.companionModifiers().footing,1.4);
assert.equal(ts.companionModifiers().damage,1);
restore(poise);
load('docs/js/footing-damage-recovery-bridge.js');
player.lastFootingDamageAt=1000;
assert.equal(env.HobunjiFootingDamageRecovery.recoveryDelayRemaining(player),1.5);
const unshaken=equip('unshaken');
assert(Math.abs(env.HobunjiFootingDamageRecovery.recoveryDelayRemaining(player)-0.9)<1e-9);
restore(unshaken);
assert.equal(env.HobunjiFootingDamageRecovery.recoveryDelayRemaining(player),1.5);
assert(read('docs/index.html').includes('src="js/combat/specialized-combat-trinket-hooks.js?'));
load('docs/js/combat/specialized-combat-trinket-hooks.js');
const dodge=equip('evasion');
env.Combat.update(.016);
player.dodging=true;player.dodgeT=.22;player.invulnUntil=1380;
env.Combat.update(.016);
assert(Math.abs(player.dodgeT-.253)<1e-9);
assert(Math.abs(player.invulnUntil-1437)<1e-9);
env.Combat.update(.016);
assert(Math.abs(player.dodgeT-.253)<1e-9,'no double-application mid-dodge');
restore(dodge);player.dodging=false;env.Combat.update(.016);
const weight=equip('counterweight');
const hits=[]; // Collects the unchanged gameplay damage and Footing payload.
env.Combat.init({...env.Combat.deps,damagePlayer:(damage,x,y,knockback,opts)=>hits.push({damage,knockback,opts})});
const opts={footingDamageMultiplier:1.5};
env.Combat.deps.damagePlayer(20,0,0,300,opts);
assert.equal(hits[0].damage,20);assert.equal(hits[0].knockback,210);assert.equal(hits[0].opts,opts);
restore(weight);
env.Combat.deps.damagePlayer(20,0,0,300,opts);assert.equal(hits[1].knockback,300);
const master=equip('flaskmaster');
for(const [k,mul] of [['flaskPower',1.25],['flaskRadius',1.15],['shatterPower',1.25],['shatterRadius',1.15]])assert.equal(ts.combatMultiplier(k),mul);
assert.equal(rs.statModifier({},'shatterPower'),1);
restore(master);
assert(ranged.includes('Shattercasks.hitProjectile(shatterHit, true)'),'player projectile must carry explicit attribution');
assert(ranged.includes('Shattercasks.hitProjectile(shatterHit);'),'enemy projectile remains unowned');
assert(flask.includes("const flaskmasterPower = window.TrinketSystem?.combatMultiplier?.('flaskPower') || 1;"));
assert(flask.includes("const flaskmasterRadius = window.TrinketSystem?.combatMultiplier?.('flaskRadius') || 1;"));
assert(shatter.includes('c._flaskmasterSource ='),'player throw retains source attribution');

function chain(mode){
  const vases=new Map(); // The real chain dispatcher iterates the same map.
  const records=new Map([['zone',{vases,scene:{}}]]);
  const events=[]; // Real blast event data from the isolated authoritative functions.
  const ctx={RADIUS:5,DAMAGE:34,records,THREE:{Vector3:class Vector3{}},
    held:null,flight:null,BURDEN_IMPACT_HANDLERS:new Map(),carriedWorldPosition:null,
    lastEvent:'',lastBlastAttribution:null,
    deps:()=>({player:null,hostileObjects:new Set(),npcWalkers:new Set()}),
    tileSize:()=>64,scene:()=>({}),baseHeight:()=>0,
    disposeEmitters(){},saveConsumed(){},shatterVisual(){},destroyTerrain(){return 0;},
    cancelShatterAim(){},setHeldRearXray(){},prompt(){},
    window:{WorldEvents:{emit:(_type,data)=>events.push(data)},
      AudioSystem:{playObjectSfxKey(){}},ResourceSystem:{spendFooting(){}},__farmLog(){}},
  };
  const a=shatter.indexOf('  function applyBlast('),b=shatter.indexOf('\n  function applyFruitBlast(',a);
  const d=shatter.indexOf('  function detonate(cask,'),e=shatter.indexOf('\n  function sweepMelee(',d);
  assert(a>=0&&b>a&&d>=0&&e>d);
  vm.createContext(ctx);
  const api=vm.runInContext(shatter.slice(a,b)+'\n'+shatter.slice(d,e)+'\n({detonate,triggerBurdenBlastAt})',ctx);
  for(const [id,x] of [['a',0],['b',4],['c',8]]){
    const pos={x,y:0,z:0}; // First explosion can only reach the third through the second.
    const group={position:pos,parent:{remove(){}},updateWorldMatrix(){},getWorldPosition(){return pos;}};
    vases.set(id,{id,mapId:'zone',kind:'shattercask',col:x,row:0,group,exploded:false,carried:false,flying:false});
  }
  if(mode==='wearer')api.detonate(vases.get('a'),'melee',{power:1.25,radius:1.15,rootId:'a',origin:'player-melee'});
  else if(mode==='enemy')api.detonate(vases.get('a'),'projectile');
  else api.triggerBurdenBlastAt('zone',0,0,5,'witchbomb');
  assert.equal(vases.size,0,'all three Shattercasks detonate exactly once');
  assert.equal(events.length,3);
  assert(events.every(e=>Math.abs(e.radius-(mode==='wearer'?5.75:5))<1e-9),'blast radius follows player-only provenance');
  assert.equal(ctx.lastBlastAttribution.rootId,mode==='wearer'?'a':null,'final link retains correct chain root');
}
chain('wearer');chain('enemy');chain('environment');
console.log('specialized combat trinket regressions passed');
