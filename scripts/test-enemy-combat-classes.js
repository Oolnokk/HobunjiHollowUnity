// Run from repository root with node scripts/test-enemy-combat-classes.js.
const fs=require('node:fs');
const sources=["docs/js/combat/resource-system.js","docs/js/perk-system.js","docs/js/combat/combat-bandit.js"].map(path=>fs.readFileSync(path,'utf8'));

const player = {health:100,maxHealth:100,stamina:100,maxStamina:100,footing:100,maxFooting:100}; // Isolate the live player's resources and ranks from enemy builds.
const document = {getElementById:()=>null}; // Perk restore renders the existing UI if present.
const window = {SkillSystem:{MAX_LEVEL:20},Combat:{deps:{player}},dispatchEvent(){}};
const performance = {now:()=>1000};
class CustomEvent {}
for (const code of sources) new Function('window','performance','CustomEvent','document',code)(window,performance,CustomEvent,document);
const P=window.PerkSystem,R=window.ResourceSystem,B=window.BanditCombat;
function check(condition,message){if(!condition)throw Error(message);}
function close(actual,expected,message){check(Math.abs(actual-expected)<1e-8,message+': '+actual+' != '+expected);}
let cases=0; // Count each level/class/attack-tag/slot combination.
for(const cls of Object.keys(P.ENEMY_COMBAT_CLASSES)){
  for(let level=1;level<=20;level++){
    for(const tag of ['sharp','blunt','poison']){
      for(const held of [0,1,2]){
        const loadout={tap1:'swingCombo',tap2:P.enemyQuickAttack(cls,()=>0.5),hold1:held>=1?'chargedBreaker':null,hold2:held>=2?'counterShield':null};
        const profile=P.buildEnemyCombatProfile(cls,level,loadout,tag);
        check(profile.combatPerkPointsSpent===P.pointEntitlementAtLevel('combat',level),'Spend full budget');
        check(!profile.combatPerks.increaseLootQuality,'Skip loot-only perks');
        // Swing/poke both end in a player-authored Heavy finisher, even without a held slot.
        if(held<2)check(!profile.combatPerks.empowerDefensiveAttacks,'Skip unavailable counter ability');
        for(const [id,rank] of Object.entries(profile.combatPerks)){
          const perk=P.TREES.combat.find(p=>p.id===id);
          check(perk&&rank<=perk.maxRank,'Legal purchased ranks');
          if(perk.tier>1)check(profile.combatPerkPointsSpent-rank>=[10,20,30][perk.tier-2],'Tier gate');
        }
        cases++;
      }
    }
  }
}
check(P.enemyCombatLevel('grunt',0)===2,'Lowest danger grunt');
check(P.enemyCombatLevel('captain',7)===20,'Highest danger captain');
check(P.enemyCombatLevel('grunt',7)>P.enemyCombatLevel('grunt',0),'Danger increases level');
check(P.enemyCombatLevel('captain',3)>P.enemyCombatLevel('grunt',3),'Rank increases level');
check(P.enemyQuickAttack('assassin',()=>0)==='backstabFlick','Assassin pool');
check(P.enemyHeldAttack('guardian',()=>0.5)==='counterShield','Guardian counter pool');
check(P.enemyHeldAttack('bruiser',()=>0.5)==='chargedBreaker','Bruiser charge pool');
B.init({rnd:()=>0.45});
function baseDef(){return {maxHealth:70,maxStamina:46,attackDamage:17,attackStaminaCost:10,attackTag:'sharp',banditAbilityLoadout:{tap1:'swingCombo',tap2:'mercySpike',hold1:'chargedBreaker',hold2:null}};}
const guard=baseDef(); // Spawn an ordinary one-held-ability Guardian.
B.applyEnemyCombatBuild(guard,'lieutenant',7,false);
check(guard.combatClass==='guardian','Faction-independent combat class');
check(guard.banditAbilityLoadout.hold2==='counterShield'&&!guard.banditAbilityLoadout.hold1,'One held ability, class-focused');
check(guard.combatPerks.empowerDefensiveAttacks>0,'Class perk fits ability');
const health=guard.maxHealth; // Verify no duplicate application.
B.applyEnemyCombatBuild(guard,'lieutenant',7,false);
check(guard.maxHealth===health,'Idempotent spawn build');
const authored=baseDef();
B.applyEnemyCombatBuild(authored,'lieutenant',7,false,{defOverride:{banditAbilityLoadout:{tap2:'mercySpike',hold1:'chargedBreaker',hold2:null}}});
check(authored.banditAbilityLoadout.tap2==='mercySpike'&&authored.banditAbilityLoadout.hold1==='chargedBreaker','Explicit caller slots win');
const boss=baseDef();
B.applyEnemyCombatBuild(boss,'captain',7,false,{extra:{lichType:'kanthic'}});
check(!boss.combatClass&&boss.maxHealth===70,'Scripted lich exempt');
const build=P.buildEnemyCombatProfile('assassin',20,{tap1:'swingCombo',tap2:'backstabFlick'},'sharp');
const actor={def:build}; // NPC damage source, with no player ranks.
const hit=P.scaleEnemyCombatHit(actor,10,{enchantmentSlot:'tap2',footingDamageMultiplier:0});
close(hit.amount,10*build.combatPerkModifiers.quickDamage,'Quick damage');
close(hit.options.footingDamageMultiplier,0,'Ranged zero Footing stays zero');
check(P.scaleEnemyCombatHit(player,10,{})===null,'Never scale player as NPC');
close(P.scaleEnemyCombatHit(actor,10,{}).amount,10*build.combatPerkModifiers.comboDamage,'Ranged and ordinary hits use raw damage perk');
R.initEntity(player);
const enemy={health:100,maxHealth:100,stamina:100,maxStamina:100,footing:100,maxFooting:100,def:guard};
R.initEntity(enemy);
close(R.spendFooting(enemy,10),Math.round(10*guard.combatPerkModifiers.footingResistance*10)/10,'NPC Footing resistance');
R.applyDamage(player,1,{attacker:actor,attackPower:10,afflictionBonuses:{bleedingHealth:1}});
close(R.getAffliction(player,'bleedingHealth'),10*(1+(build.combatPerks.empowerDamageEffects||0)*0.12),'Enemy own affliction ranks');
check(P.purchasedRank('combat','empowerRawDamage')===0,'NPC builds never write player perks');


const rehydratedA=baseDef(),rehydratedB=baseDef();
B.init({rnd:()=>0.02});
B.applyEnemyCombatBuild(rehydratedA,'captain',7,false,{combatBuildSeed:'marcher-42'});
B.init({rnd:()=>0.99});
B.applyEnemyCombatBuild(rehydratedB,'captain',7,false,{combatBuildSeed:'marcher-42'});
check(JSON.stringify(rehydratedA)===JSON.stringify(rehydratedB),'Same abstract identity must rebuild the same profile despite unrelated RNG changes');
const identities=new Set();
for(let i=0;i<100;i++){
  const d=baseDef();
  B.applyEnemyCombatBuild(d,'captain',7,false,{combatBuildSeed:'marcher-'+i});
  identities.add(d.combatClass);
}
check(identities.size===5,'Stable identity seed still distributes all five classes');
B.init({rnd:()=>0.05});
const switched=baseDef();
B.applyEnemyCombatBuild(switched,'captain',7,false);
const switchedActor={def:switched,health:switched.maxHealth/2,maxHealth:switched.maxHealth,stamina:switched.maxStamina/2,maxStamina:switched.maxStamina,footing:100,maxFooting:100};
R.initEntity(switchedActor);
check(switched.combatPerks.empowerDamageEffects>0,'Sharp bruiser buys damage affliction perk');
switched.attackTag='blunt';
B.refreshEnemyCombatBuild(switchedActor);
check(switched.combatPerks.empowerOffensiveDebuffs>0&&!switched.combatPerks.empowerDamageEffects,'Final blunt weapon replaces incompatible affliction ranks');
close(switchedActor.health/switchedActor.maxHealth,0.5,'Weapon refresh preserves missing health fraction');
close(switchedActor.stamina/switchedActor.maxStamina,0.5,'Weapon refresh preserves missing stamina fraction');
const afterRefresh=JSON.stringify(switched);
B.refreshEnemyCombatBuild(switchedActor);
check(JSON.stringify(switched)===afterRefresh,'Repeated reconciliation is idempotent');
switched.attackTag='sharp';
B.refreshEnemyCombatBuild(switchedActor);
const original=baseDef(); B.applyEnemyCombatBuild(original,'captain',7,false);
check(switched.maxHealth===original.maxHealth&&switched.maxStamina===original.maxStamina,'Changing back to original weapon does not accumulate resource multipliers');
close(switched.attackStaminaCost,original.attackStaminaCost,'Repeated refresh does not compound stamina cost');
window.RangedWeapons={config:{dart:{afflictionBonuses:{poisonedHealth:1}}}};
const rangedBuild=P.buildEnemyCombatProfile('assassin',20,{tap1:'swingCombo',tap2:'backstabFlick'},'blunt','dart');
check(rangedBuild.combatPerks.empowerDamageEffects>0,'Equipped ranged weapon makes its actual affliction family eligible');
const titan=baseDef();B.applyEnemyCombatBuild(titan,'captain',7,false,{extra:{isMaskboundTitan:true}});
check(!titan.combatClass,'Scripted Titan preserves original tuning');
P.restore({perkRanks:{combat:{empowerDamageEffects:5}}});
const neutral={health:100,maxHealth:100,stamina:100,maxStamina:100,footing:100,maxFooting:100};R.initEntity(neutral);
R.applyDamage(neutral,1,{attacker:null,attackPower:10,afflictionBonuses:{bleedingHealth:1}});
close(R.getAffliction(neutral,'bleedingHealth'),10,'Explicit anonymous NPC attack must not borrow player ranks');
R.applyDamage(neutral,1,{attacker:player,attackPower:10,afflictionBonuses:{bleedingHealth:1}});
close(R.getAffliction(neutral,'bleedingHealth'),26,'Explicit player attack still uses player affliction perks');
close(P.scaleEnemyCombatHit(actor,10,null).amount,10*build.combatPerkModifiers.comboDamage,'Null hit options remain safe');

const heavyBuild=P.buildEnemyCombatProfile('bruiser',20,{tap1:'swingCombo',tap2:'exhaustCutter'},'sharp');
check(heavyBuild.combatPerks.empowerHeavyAttacks>0,'Heavy combo finishers are available without a charged held slot');
const heavyActor={def:heavyBuild};
close(P.scaleEnemyCombatHit(heavyActor,10,{enchantmentSlot:'tap1',perkHeavy:true}).amount,10*heavyBuild.combatPerkModifiers.heavyDamage,'Heavy combo finisher uses the heavy damage channel');
const combined=P.scaleEnemyCombatHit(heavyActor,10,{enchantmentSlot:'tap2',heavy:true});
close(combined.amount,10*heavyBuild.combatPerkModifiers.quickDamage*heavyBuild.combatPerkModifiers.heavyDamage/heavyBuild.combatPerkModifiers.comboDamage,'Heavy and quick modifiers compose as in player tree');
const customNoHeavy=P.buildEnemyCombatProfile('bruiser',20,{tap1:'customCombo'},'sharp');
check(!customNoHeavy.combatPerks.empowerHeavyAttacks,'No heavy perk when no heavy action exists');
check(!customNoHeavy.combatPerks.empowerQuickAttacks,'No quick perk without a valid quick ability');
const payer={health:100,maxHealth:100,stamina:100,maxStamina:100,footing:100,maxFooting:100,def:build};
R.initEntity(payer);
const discount=build.combatPerkModifiers.staminaCost;
check(discount<1,'Assassin fixture must have a stamina discount');
const payment=R.spendStamina(payer,10,'enemy dodge');
close(payment.spent,Math.round(10*discount*10)/10,'NPC dodge benefits from Reduce Stamina Use');
payer.stamina=100;
const prepaid=R.spendStamina(payer,10*discount,'bandit attack',{actionKind:'combatNpcMelee'});
close(prepaid.spent,Math.round(10*discount*10)/10,'Pre-discounted melee does not receive the same perk twice');
payer.stamina=100;
close(R.spendStamina(payer,10,'thrown charge',{actionKind:'offensiveHeldCharge',abilityId:'thrownWeapon'}).spent,Math.round(10*discount*10)/10,'Thrown charge benefits from Reduce Stamina Use');
// Exercise the actual ranged reload calculation and resource debit, preserving the authored Exhaust Cutter threshold.
const rangedSource=fs.readFileSync('docs/js/combat/ranged-weapons.js','utf8');
const loadStart=rangedSource.indexOf('  function rangedLoadStaminaCost('),loadEnd=rangedSource.indexOf('  function spendRangedLoadStamina(',loadStart);
check(loadStart>=0&&loadEnd>loadStart,'Production ranged cost function located');
const reloadCost=new Function('window','deps','DEFAULT_RANGED_LOAD_STAMINA_FRACTION',rangedSource.slice(loadStart,loadEnd)+'\nreturn rangedLoadStaminaCost;')(window,{player},0.5);
payer.stamina=100;
const actualReload=R.spendStamina(payer,reloadCost(payer,{loadStaminaFraction:0.5}), 'reload',{actionKind:'rangedWeaponLoad'});
close(actualReload.spent,50,'NPC reload retains the fixed resource-threshold rule rather than double-discounting');
// The live game installs the alcohol adapter over ResourceSystem; run its real implementation, not a mock that bypasses it.
const coreSource=fs.readFileSync('docs/js/combat/combat-core.js','utf8');
const alcoholStart=coreSource.indexOf('// Alcohol / drunken-affliction integration'),alcoholEnd=coreSource.indexOf('  RS.spendStamina = function drunkenAwareSpendStamina',alcoholStart);
check(alcoholStart>=0&&alcoholEnd>alcoholStart,'Production alcohol adapter found');
new Function('window','performance','CustomEvent',coreSource.slice(alcoholStart,alcoholEnd)+'\n})();')(window,performance,CustomEvent);
const liveTarget={health:100,maxHealth:100,stamina:100,maxStamina:100,footing:100,maxFooting:100};
R.initEntity(liveTarget);
R.applyDamage(liveTarget,1,{attacker:actor,attackPower:10,afflictionBonuses:{bleedingHealth:1}});
close(R.getAffliction(liveTarget,'bleedingHealth'),10*(1+(build.combatPerks.empowerDamageEffects||0)*0.12),'Live alcohol wrapper applies attacker-specific affliction rank exactly once');
R.addAffliction(liveTarget,'drunkenHealth',10);
const healthBefore=liveTarget.health;
R.applyDamage(liveTarget,5,{attacker:actor,attackPower:10,afflictionBonuses:{poisonedHealth:1}});
close(liveTarget.health,healthBefore,'Existing Drunken Health conversion remains functional');
close(R.getAffliction(liveTarget,'poisonedHealth'),10*(1+(build.combatPerks.empowerDamageEffects||0)*0.12),'Affliction perks survive Drunken Health absorption');
console.log('Enemy combat class progression passed: '+cases+' allocation combinations plus spawn, hit, and resource tests.');
