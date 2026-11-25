// Run from repository root with node scripts/test-enemy-combat-classes.js.
const fs=require('node:fs');
const sources=["docs/js/combat/resource-system.js","docs/js/perk-system.js","docs/js/combat/combat-bandit.js"].map(path=>fs.readFileSync(path,'utf8'));

const player = {health:100,maxHealth:100,stamina:100,maxStamina:100,footing:100,maxFooting:100}; // Isolate the live player's resources and ranks from enemy builds.
const window = {SkillSystem:{MAX_LEVEL:20},Combat:{deps:{player}},dispatchEvent(){}};
const performance = {now:()=>1000};
class CustomEvent {}
for (const code of sources) new Function('window','performance','CustomEvent',code)(window,performance,CustomEvent);
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
        if(!held)check(!profile.combatPerks.empowerHeavyAttacks,'Skip unavailable heavy ability');
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

console.log('Enemy combat class progression passed: '+cases+' allocation combinations plus spawn, hit, and resource tests.');
