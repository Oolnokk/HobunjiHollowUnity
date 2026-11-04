'use strict';
// Executes production trinket/resource/combat adapters with a small headless player.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const w={console,Date,Math,performance:{now:()=>10000},CustomEvent:class CustomEvent{constructor(type,opts){this.type=type;this.detail=opts?.detail;}},
  SCRATCHBONES_CONFIG:{game:{combat:{resourceSystem:{pukeChancePerSec:0}}}},addEventListener(){},dispatchEvent(){}};
w.window=w;vm.createContext(w);
const load=p=>vm.runInContext(read(p),w,{filename:p});
load('docs/js/combat/resource-system.js');
const R=w.ResourceSystem,player={health:100,maxHealth:100,stamina:100,maxStamina:100,footing:100,maxFooting:100,x:0,y:0};
R.initEntity(player);
const gear={trinkets:[],equippedTrinkets:[]},calls=[];
const deps={player,getGearInventory:()=>gear,saveGearInventory(){},showToast(){},
  damageCreature:(target,amount,fromX,fromY,knockback,options)=>{calls.push({target,amount,options});return amount;},
  damagePlayer:(amount,fromX,fromY,knockback,options)=>{calls.push({amount,knockback,options});return amount;}};
w.Combat={deps,init(injected){this.deps=injected;},update(){}};
load('docs/js/activity-events.js');load('docs/js/trinket-system.js');
load('docs/js/combat/specialized-combat-trinket-hooks.js');
load('docs/js/combat/double-edged-combat-trinkets.js');
w.Combat.init(deps);
const T=w.TrinketSystem,E=w.DoubleEdgedCombatTrinkets;
const names=['unstableBalance','glassFang','leadKnuckles','bloodrush','ironAnchor','hollowLungs',
  'falseCourage','fracturedGuard','venomousBlood','berserkersBargain','shatterheart','deathsMomentum','gamblersEye'];
const loot=read('docs/config/loot/loot-pools.json');
const game=read('docs/game.js'); // Extracts the real Health/Footing routing rather than treating modifier fields as sufficient proof.
const gameHitMarker='function hitResourceDamage(amount, dmgOpts) {'; // Exact utility invoked by actual damageCreature and damagePlayer.
const gameHitStart=game.indexOf(gameHitMarker); // Finds the shared routing helper inside the large game closure.
assert(gameHitStart>=0,'missing game.js resource damage routing');
const gameHitEnd=game.indexOf('\n      }',gameHitStart); // The routing function ends at this indented closing brace.
assert(gameHitEnd>gameHitStart,'missing game.js hitResourceDamage closing brace');
const gameHitSource=game.slice(gameHitStart,gameHitEnd+8); // Self-contained function uses only window config and Number.
const realHitResources=vm.runInNewContext(gameHitSource+'\n hitResourceDamage;', {window:w,Number}); // Executes the real damage-to-Footing formula after trinket modification.
for(const name of names){const def=T.DEFINITIONS[name];assert(def,'missing '+name);
  assert.equal(def.category,'combat');assert(def.attunementCost>=1&&def.attunementCost<=2);
  assert.equal(def.source,undefined);assert(!loot.includes('trinket_'+name),'no loot entries for '+name);}
const wear=id=>{const uid=T.grant(id,'dev');assert(T.equip(uid).ok);return uid;};
const unwear=id=>assert(T.unequip(id));
const hit=(options={},target={health:100,prone:false},sourceX=0,sourceY=0)=>{
  calls.length=0;w.Combat.deps.damageCreature(target,10,sourceX,sourceY,0,options);assert.equal(calls.length,1);return calls[0];};
let u=wear('unstableBalance');assert.equal(hit().options.footingDamageMultiplier,1.25);
player.footing=100;R.spendFooting(player,20);assert.equal(player.footing,75);
const unstableHit=hit(); // Verify the final Footing routed into game.js before ResourceSystem protection.
assert.equal(realHitResources(unstableHit.amount,unstableHit.options).footing,12.5);
unwear(u);
u=wear('glassFang');let h=hit({afflictionBonuses:{bruisedHealth:.4}});
assert.equal(h.amount,14);assert(Math.abs(h.options.footingDamageMultiplier-1/1.4)<1e-8);
assert(Math.abs(h.options.afflictionBonuses.bruisedHealth-.4/1.4)<1e-8);
assert.equal(realHitResources(h.amount,h.options).health,14,'Glass Fang boosts actual direct Health');
assert.equal(realHitResources(h.amount,h.options).footing,10,'Glass Fang must not boost actual Footing');
assert(Math.abs(h.amount*h.options.afflictionBonuses.bruisedHealth-4)<1e-8,'Glass Fang must not boost actual affliction buildup');
player.health=100;R.applyDamage(player,10);assert.equal(player.health,87);
assert.equal(hit({environmentalImpact:true}).amount,10,'Environmental collision damage must not inherit wearer bonuses');
unwear(u);
u=wear('leadKnuckles');assert.equal(hit({heavy:true}).options.footingDamageMultiplier,1.6);
assert.equal(hit({heavy:false}).options.footingDamageMultiplier,1);
player.stamina=100;R.spendStamina(player,10,'Forehand Swing',{actionKind:'combatCombo',heavy:true});
assert.equal(player.stamina,85);
player.stamina=100;R.spendStamina(player,10,'Thrown charge',{actionKind:'offensiveHeldCharge',abilityId:'thrownWeapon'});
assert.equal(player.stamina,90,'Lead Knuckles must not tax a thrown weapon charge');
player.stamina=100;R.spendStamina(player,10,'Charged Breaker',{actionKind:'offensiveHeldCharge',abilityId:'chargedBreaker'});
assert.equal(player.stamina,85,'Lead Knuckles must tax melee-heavy hold charges');
unwear(u);
u=wear('bloodrush');assert.equal(E.attackSpeed(),1.35);
player.stamina=100;R.spendStamina(player,10,'Forehand Swing',{actionKind:'combatCombo'});
assert.equal(player.stamina,86.5);
player.stamina=100;R.spendStamina(player,10,'farm tool',{actionKind:'farmWork'});
assert.equal(player.stamina,90);unwear(u);
u=wear('ironAnchor');assert.equal(R.statModifier(player,'knockbackDistance'),.4);
w.Combat.update(.016);player.dodging=true;player.dodgeT=.4;player.invulnUntil=10380;
w.Combat.update(.016);assert(Math.abs(player.dodgeT-.24)<1e-8);assert.equal(player.invulnUntil,10380);
calls.length=0;w.Combat.deps.damagePlayer(15,0,0,300,{footingDamageMultiplier:1.5});
assert.equal(calls[0].knockback,120);
player.dodging=false;w.Combat.update(.016);unwear(u);
u=wear('hollowLungs');assert.equal(R.getEffectiveMax(player,'stamina'),75);
assert.equal(R.statModifier(player,'exhaustionRecovery'),1.75);unwear(u);
u=wear('falseCourage');player.health=100;R.applyDamage(player,10);assert.equal(player.health,94);
player.footing=100;R.spendFooting(player,10);assert.equal(player.footing,84);unwear(u);
u=wear('fracturedGuard');w.Combat.update(.016);player.dodging=true;player.dodgeT=.4;player.invulnUntil=10380;
w.Combat.update(.016);assert.equal(player.dodgeT,.4);assert.equal(player.invulnUntil,10532);
player.stamina=100;R.spendStamina(player,10,'dodge');assert.equal(player.stamina,80);
player.dodging=false;w.Combat.update(.016);unwear(u);
u=wear('venomousBlood');h=hit({afflictionBonuses:{bruisedHealth:.5},fixedAfflictionBuildup:{windedStamina:4}});
assert.equal(h.options.afflictionBonuses.bruisedHealth,.8);
assert.equal(h.options.fixedAfflictionBuildup.windedStamina,6.4);
const before=R.getAffliction(player,'bruisedHealth');R.addAffliction(player,'bruisedHealth',10);
assert(Math.abs(R.getAffliction(player,'bruisedHealth')-before-14)<1e-8);unwear(u);
u=wear('berserkersBargain');player.health=34;assert.equal(hit().amount,15);
R.applyHealthRecovery(player,20);assert.equal(player.health,44);
player.health=40;assert.equal(hit().amount,10);unwear(u);
u=wear('shatterheart');assert.equal(hit({}, {health:100,prone:true}).amount,20);
assert.equal(hit({}, {health:100,prone:false}).amount,10);
assert.equal(R.statModifier(player,'footingRegen'),.6);unwear(u);
u=wear('deathsMomentum');assert.equal(R.statModifier(player,'ordinaryStaminaRegen'),.5);
player.stamina=10;player.health=100;
w.HobunjiActivityEvents.emit('creature_killed',{isPredator:false});
assert.equal(player.stamina,10);
w.HobunjiActivityEvents.emit('creature_killed',{isPredator:true,creatureKey:'gar-wolf'});
assert.equal(player.stamina,50);
player.exhaustion.active=true;player.exhaustion.blackStamina=20;player.stamina=0;
w.HobunjiActivityEvents.emit('creature_killed',{isBandit:true});
assert.equal(player.stamina,0);assert.equal(player.exhaustion.blackStamina,60);
player.exhaustion.active=false;player.exhaustion.blackStamina=100;unwear(u);
u=wear('gamblersEye');assert.equal(hit({ranged:true,rangedItemKey:'crossbow'}).amount,16);
assert.equal(hit({ranged:false}).amount,10);
assert.equal(hit({ranged:true,rangedItemKey:'crossbow',attacker:{}}).amount,10);
assert.equal(R.statModifier(player,'rangedProjectileSpeed'),.65);
// Game initializes RangedWeapons and Combat with different deps objects.
// Test the production projectile-impact statements rather than mocking the
// correct central Combat route and assuming RangedWeapons invokes it.
const rangedCode=read('docs/js/combat/ranged-weapons.js'); // Source of the real player-shot callback statements.
assert(rangedCode.includes("rangedTrinketDamageMultiplier: team === 'player' ?"),'Gambler power and speed must both snapshot on player projectile launch');
const speedMarker='const projectileSpeedPxS = def.speedPxS * flightStats.speedMultiplier *'; // Uses the actual velocity assigned to every projectile.
const speedStart=rangedCode.indexOf(speedMarker); // Locates the production launch velocity calculation.
assert(speedStart>=0,'Gambler projectile speed must apply at launch');
const speedEnd=rangedCode.indexOf(';',speedStart); // Isolates only the pure launch-speed assignment.
assert(speedEnd>speedStart,'missing speed assignment terminator');
const speedExpression=rangedCode.slice(speedStart,speedEnd+1); // Production formula, executable without THREE scene setup.
const sampleSpeed=team=>vm.runInNewContext(speedExpression+'\n projectileSpeedPxS',
  {window:w,def:{speedPxS:700},flightStats:{speedMultiplier:1.15},team}); // Distinguishes wearer projectiles from enemy shots.
assert(Math.abs(sampleSpeed('player')-523.25)<1e-8,'player projectile gets -35% launch speed');
assert(Math.abs(sampleSpeed('bandit')-805)<1e-8,'enemy projectiles keep ordinary speed');
const impactMarker='const playerDamageCreature = window.Combat?.deps?.damageCreature || deps.damageCreature;';
const impactStart=rangedCode.indexOf(impactMarker); // Finds the live impact site.
assert(impactStart>=0,'player shots must use live Combat.deps callback');
const impactEnd=rangedCode.indexOf('applySpecialAmmoDebuff(c, p.specialAmmoId);',impactStart); // Excludes ammo post-hit routines.
assert(impactEnd>impactStart,'player projectile hit must invoke selected callback');
const rangedImpactStatements=rangedCode.slice(impactStart,impactEnd); // Executable real player-shot route.
const target={health:100,prone:false}; // Creature the separate ranged module just hit.
let rawRangedCalls=0; // Tracks accidental calls to the unmodified independent callback.
const rangedDeps={player,damageCreature(){rawRangedCalls++;}}; // Independent RangedWeapons.init injection.
const projectile={prevX:150,prevY:170,itemKey:'crossbow',ammoId:null,afflictionBonuses:{},footingDamageMultiplier:0,rangedTrinketDamageMultiplier:1.6}; // Shot is far from the player's position.
calls.length=0;
vm.runInNewContext(rangedImpactStatements,{window:w,deps:rangedDeps,c:target,damage:10,
  p:projectile,knockbackPxS:0}, {filename:'ranged-weapons.js player projectile impact excerpt'});
assert.equal(rawRangedCalls,0,'player shot must not bypass combat modifiers');
assert.equal(calls.length,1,'player projectile reaches Combat.damageCreature');
assert.equal(calls[0].amount,16,"The Gambler's Eye must boost real projectile damage");
assert.equal(calls[0].options.attacker,player,'player projectile carries explicit source');
projectile.rangedTrinketDamageMultiplier=1; // Represents a normal-speed launch before Gambler was equipped.
calls.length=0;
vm.runInNewContext(rangedImpactStatements,{window:w,deps:rangedDeps,c:target,damage:10,
  p:projectile,knockbackPxS:0}, {filename:'ranged-weapons.js unbuffed projectile impact'});
assert.equal(calls[0].amount,10,'equipping Gambler after firing cannot empower a fast projectile');
unwear(u);
projectile.rangedTrinketDamageMultiplier=1.6; // Represents the Gambler power sampled at firing before removing it.
calls.length=0;
vm.runInNewContext(rangedImpactStatements,{window:w,deps:rangedDeps,c:target,damage:10,
  p:projectile,knockbackPxS:0}, {filename:'ranged-weapons.js prebuffed projectile impact'});
assert.equal(calls[0].amount,16,'unequipping Gambler in flight does not erase its slower-shot power');
assert(Math.abs(sampleSpeed('player')-805)<1e-8,'player projectile launches at normal speed after unequipping Gambler');
assert(read('docs/js/combat/ranged-weapons.js').includes("team === 'player' ? (window.DoubleEdgedCombatTrinkets?.modifier?.('rangedProjectileSpeed') || 1) : 1"));
assert(read('docs/index.html').includes('src="js/combat/double-edged-combat-trinkets.js?'));
console.log('13 double-edged combat trinkets: effects, equip/unequip and zero loot sources passed');
