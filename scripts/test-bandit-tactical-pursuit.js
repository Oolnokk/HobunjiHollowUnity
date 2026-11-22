#!/usr/bin/env node
'use strict';

// Tests the shipped bandit tactical functions, enemy difficulty config and ranged movement decisions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = path => fs.readFileSync(path, 'utf8'); // Reads the current gameplay implementations instead of duplicate tactics.
const bandit = read('docs/js/combat/combat-bandit.js'); // Melee decisions, difficulty scaling and Backstab flank geometry.
const ranged = read('docs/js/combat/ranged-weapons.js'); // The real ranged bandit attack and chase state machine.
const tuning = JSON.parse(read('docs/config/bandits/bandit-gang-config.json')); // Authored rank and danger-tier controls.
const arenaLog = read('docs/js/bandit-combat-log.js'); // Mobile-only combat diagnostics exposed to players.
const section = (source, start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from); // Boundaries isolate actual production functions from browser/Three.js setup.
  assert(from >= 0 && to > from, 'missing gameplay section: ' + start);
  return source.slice(from, to);
};
const close = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-8, message + ': ' + actual + ' vs ' + expected); // Floating-point comparison for percent and angular geometry.

const definitionHelpers = [
  'const BANDIT_BASE_MAX_HEALTH=70, BANDIT_BASE_MAX_STAMINA=46, BANDIT_BASE_ATTACK_DAMAGE=17;',
  'const BANDIT_ATTACK_RANGE_TILES=1.1, BANDIT_ATTACK_HALF_CONE_DEG=30, BANDIT_ATTACK_STAMINA_COST=12;',
  'const BANDIT_ATTACK_COOLDOWN_S_CAPTAIN=.95, BANDIT_ATTACK_COOLDOWN_S_OTHER=1.15, BANDIT_MASTERY_DAMAGE_PER_LEVEL=.06;',
  'const BANDIT_QUICK_ATTACK_CHANCE=.45;',
  "const BANDIT_RANK_LABEL={ grunt:'Bandit', lieutenant:'Bandit Lieutenant', captain:'Bandit Captain', flasker:'Bandit Flasker' };",
  "function banditWeaponFor(){return { shapeKey:'hatchet', weaponKey:'hatchet_nativeCopper', dmgType:'sharp', dmgMultiplier:1 };}",
  'function banditRangedWeaponFor(){return null;}',
  'function rollBanditFlaskLoadout(){return [];}',
  'function banditFlaskerTuning(){return {};}',
  "function banditAbilityLoadout(){return {tap1:'swingCombo',tap2:'backstabFlick',hold1:null,hold2:null};}",
].join('\n'); // Only the unrelated weapon/audio/animation dependencies are stubbed.
const definitionContext = {
  window: { WeaponShapeStats: { forShape: () => ({ power:1, speed:1, range:1, efficiency:1 }) }, EnemyTierProgression: { MAX_TIER:7 } },
  deps: { TILE:55, clamp:(value,min,max)=>Math.max(min,Math.min(max,value)) },
  Number, Math,
};
const makeBanditDef = vm.runInNewContext(
  '(function(){' + definitionHelpers + '\n' +
  section(bandit, '  function makeBanditDef(', '  // ── Bandit ability AI') +
  '\nreturn makeBanditDef;})()', definitionContext
); // Executes the actual enemy stat factory for ordinary, high-tier and mine cases.
const low = makeBanditDef(tuning,'grunt',0,0,1);
const high = makeBanditDef(tuning,'captain',7,5,1);
assert.equal(low.chaseSpeed,290,'tier-zero grunt starts with meaningful pursuit speed');
assert.equal(high.chaseSpeed,352,'high-tier captain is significantly faster');
close(low.aggroRangePx,55*8.5,'normal bandits notice threats beyond the old six-tile boundary');
close(low.leashRangePx,55*16,'bandits continue pursuing beyond the former ten-tile leash');
close(low.quickAttackChance,.2,'tier zero has lower conditional Quick Attack selection');
close(high.quickAttackChance,.83,'tier seven has higher conditional Quick Attack selection');
const oldMine = makeBanditDef({ ...tuning, _preserveMineEnemyTiers:true, combatPursuit:null, quickAttackTuning:null },'grunt',3,0,1); // Mine Ghouls explicitly opt out through makeBanditEntity.
assert.equal(oldMine.chaseSpeed,180,'mine progression remains unchanged');
close(oldMine.quickAttackChance,.45,'special enemy Quick Attack chance preserves the previous fallback');
assert.equal(oldMine.banditStandoffMaxTiles,null,'special enemies keep their original full-size standoff rings');

const quickChance = vm.runInNewContext(
  '(function(){' + section(bandit,'  const BANDIT_QUICK_ATTACK_CHANCE =','  const BANDIT_GUARD_WINDOW_S') +
  'return banditQuickAttackChance;})()', { Number, Math }
); // Tests the actual authored-technique condition gate, not just a copied probability formula.
assert.equal(quickChance({def:low},{tap2:'exhaustCutter'},{exhausted:true}),.2);
assert.equal(quickChance({def:high},{tap2:'exhaustCutter'},{exhausted:true}),.83);
assert.equal(quickChance({def:high},{tap2:'exhaustCutter'},{lowHealth:true}),0,'Exhaust Cutter cannot trigger merely because the target has low Health');
assert.equal(quickChance({def:high},{tap2:'mercySpike'},{lowHealth:true}),.83);
assert.equal(quickChance({def:high},{tap2:'mercySpike'},{exhausted:true}),0,'Mercy Spike cannot trigger merely because Stamina is low');
assert.equal(quickChance({def:low},{tap2:'backstabFlick'},{behind:true}),1,'Backstab Flick reliably takes its earned opportunity');
assert.equal(quickChance({def:high},{tap2:'backstabFlick'},{lowHealth:true}),0,'Backstab Flick cannot trigger from unrelated target conditions');
assert.equal(quickChance({def:high},{tap2:'none'},{behind:true,exhausted:true}),0,'nonexistent Quick Attack must never be rolled');

const flankDeps = { TILE:55, angleDiff:(target,current)=>Math.atan2(Math.sin(target-current),Math.cos(target-current)) }; // Shared short-angle turn convention used by the bandit module.
const flankPoint = vm.runInNewContext(
  '(function(){' + section(bandit,'  function banditRingPoint(', '  // Bandits frequently request two personal-space nudges') +
  '\nreturn banditBackstabFlankPoint;})()', { deps:flankDeps, Number, Math }
); // Executes the actual incremental orbit, including its deterministic initial side choice.
const foe = { x:0,y:0,angle:0,health:100 }, fighter = {x:300,y:0,_banditStrafePhase:.5}; // Fighter starts directly ahead of an east-facing foe.
const flankTarget = {x:0,y:0}; // Reused per-frame destination, mirroring the real band's scratch point.
let reachedRear = false; // A real rear position should be reached within the authored two-second flank window.
for(let step=0;step<20;step++){
  flankPoint(fighter,foe,170,flankTarget);
  const dx=flankTarget.x-fighter.x,dy=flankTarget.y-fighter.y;
  const distance=Math.hypot(dx,dy),travel=Math.min(29,distance); // 290 px/s × 0.1 s, with the real mover's no-overshoot policy.
  if(distance>0){fighter.x+=dx/distance*travel;fighter.y+=dy/distance*travel;}
  const dot=fighter.x/Math.max(.001,Math.hypot(fighter.x,fighter.y));
  if(dot<-.35){reachedRear=true;break;}
}
assert(reachedRear,'Backstab contender should circle into the real behind bonus within its two-second budget');
assert(Math.abs(fighter.y)>40,'Backstab movement must go around the opponent rather than run straight through their center');
assert.match(bandit,/const flank = banditBackstabFlankPoint\(c, targetPlayer, engageRangePx, movementPoint\)/,'live melee AI uses the tested orbit helper');
assert.match(bandit,/const chance = banditQuickAttackChance\(c, loadout, cond\)/,'live attack AI uses the tested technique-specific chance');
assert.match(bandit,/const travelSpeed = distToTarget > sprintThreshold \? def\.chaseSpeed/,'waiting enemies sprint if their assigned point drifts away');
assert.match(bandit,/const BANDIT_MAX_ATTACK_SLOTS = 2/,'coordinated melee attack slot limit is retained');

const rangedDeps = {
  TILE:55,
  moveCreatureToward(c,x,y,speed,dt){
    const distance=Math.hypot(x-c.x,y-c.y),step=Math.min(distance,speed*dt); // Equivalent straight-line motion used only for this behavior unit test.
    if(distance>0){c.x+=(x-c.x)/distance*step;c.y+=(y-c.y)/distance*step;}
    return step>0;
  },
};
const rangedContext = {
  window:{}, deps:rangedDeps, Math, Number, performance:{now:()=>1000},
  defFor:()=>({label:'Crossbow',rangedType:'crossbow'}),
  rangedAttackRadiusPx:()=>300,
}; // Out-of-range and cooldown-pursuit cases return before sight, projectile, or Three.js dependencies.
const updateRanged = vm.runInNewContext(
  '(function(){' + section(ranged,'  function updateBanditAI(', '  function updateBanditVisual(') +
  '\nreturn updateBanditAI;})()',rangedContext
);
const shooter={x:0,y:0,enemyLoadoutKind:'bandit:captain',def:{rangedWeaponKey:'crossbow',chaseSpeed:300},_rangedCooldownT:0}; // Actual shoot-capable bandit outside its 300-pixel envelope.
const beyond = updateRanged(shooter,.1,{x:800,y:0,health:100},800);
assert.equal(beyond.handled,true);
assert.equal(beyond.moving,true,'ranged bandits chase rather than freeze beyond weapon range');
assert.equal(shooter.x,30);
assert.equal(shooter._banditTactic,'ranged-pursuit');
const cooling={x:0,y:0,enemyLoadoutKind:'bandit:captain',def:{rangedWeaponKey:'crossbow',chaseSpeed:300},_rangedCooldownT:.6}; // In weapon range but farther than preferred closing distance.
const closer=updateRanged(cooling,.1,{x:260,y:0,health:100},260);
assert.equal(closer.chasingRange,true,'ranged bandits close ground between shots');
assert.equal(cooling.x,30);
const specialShooter={x:0,y:0,enemyLoadoutKind:'ghoul:shadowknight',def:{rangedWeaponKey:'crossbow',chaseSpeed:300},_rangedCooldownT:0}; // Dedicated special enemy should keep its original ranged station.
const specialResult=updateRanged(specialShooter,.1,{x:800,y:0,health:100},800);
assert.equal(specialResult.holdingRange,true,'special ranged enemies keep their encounter-specific behavior');
assert.equal(specialShooter.x,0);
assert.match(arenaLog,/quickChance=/,'mobile arena diagnostics expose tier Quick Attack chance');
assert.match(arenaLog,/tactic=/,'mobile arena diagnostics expose pursuit versus flanking');

console.log('PASS bandit tactical pursuit: fast tier-scaled chase, matching Quick Attack opportunities, real backstab orbit, ranged pursuit and mobile diagnostics.');
