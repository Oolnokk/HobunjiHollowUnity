#!/usr/bin/env node
'use strict';
// Four target-relative approach roles, one resolved strike at a time, plus one independent visible held charge.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = file => fs.readFileSync(file, 'utf8'); // Regression reads production modules, not copied coordination rules.
const source = read('docs/js/combat/combat-bandit.js'); // Includes the real slot, attack-turn and preparatory-charge logic.
const hypeSource = read('docs/js/combat/fey-hyped-attacks.js'); // Fey follow-up is a real second hit and must keep the turn through it.
const logSource = read('docs/js/bandit-combat-log.js'); // Mobile output must expose each actor's assignments and charge status.
const section = (body,start,end) => {
  const i=body.indexOf(start), j=body.indexOf(end,i);
  assert(i>=0&&j>i,'missing production boundary: '+start);
  return body.slice(i,j);
};
const near=(a,b,label)=>assert(Math.abs(a-b)<1e-8,label+': '+a+' vs '+b); // Angular values may wrap and need floating point tolerance.
const stages=[]; // Real onStrike/onComplete callbacks are driven explicitly to prove the precise release boundary.
const windowStub={
  Combat:{
    beginStagedAction(options){
      const stage={...options,t:0,cancelled:false,windupS:options.windupS||0,strikeS:options.strikeS||0,
        cancel(){this.cancelled=true;this.onCancel?.(this);}};
      stages.push(stage);
      return stage;
    },
    chargedBreakerData:{WINDUP_S:1,MAX_CHARGE_S:1,WINDUP_SLOWDOWN:.35,POWER:1.7,
      holdSecondsForPoseCharge:ratio=>ratio},
    poses:{SWEEP_POSE:{}},
  },
}; // The actual Combat begin-staged API returns a callback-bearing handle; physics/rendering is not needed.
const deps={TILE:55,rnd:()=>.5,clamp:(x,lo,hi)=>Math.max(lo,Math.min(hi,x)),
  angleDiff:(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b))}; // Existing game world-to-tile and wrapped-bearing conventions.
let simulatedNow=1000; // Shared 12ms pruning cadence for directional and queued records, under a deterministic clock.
const context={window:windowStub,deps,WeakMap,Math,Number,Object,performance:{now:()=>simulatedNow},
  banditEngagementReachPx:()=>170, // The real melee AI owns the attack reach; isolate that calculation in this coordinator-specific unit.
  resetBanditSwingToNatural(c){c.restored=true;}};
const coordinator=vm.runInNewContext(
  '(()=>{' +
  section(source,'  const BANDIT_MAX_ATTACK_SLOTS =','  // Queued (non-slot-holding)') +
  section(source,'  const BANDIT_QUEUE_RING_CAPACITY =','  // A point on a ring of the given radius') +
  section(source,'  function beginBanditMeleeStage(', '  function resolvedBanditCombatTarget(') +
  'return {slots:_banditAttackSlots,claim:claimBanditAttackSlot,angle:banditFacingSlotAngle,' +
  'owner:banditAttackTurnOwner,acquire:claimBanditAttackTurn,release:releaseBanditAttackTurn,' +
  'chargeOwner:banditChargeOwner,prepare:beginBanditPreparedCharge,uncharge:releaseBanditCharge,' +
  'queue:claimBanditQueueRing,queued:_banditQueueRings,releaseApproach:releaseBanditApproach,' +
  'stage:beginBanditMeleeStage,max:BANDIT_MAX_ATTACK_SLOTS};})()',context
); // Executes production functions unmodified, including the real Fey stage integration wrapper.
assert.equal(coordinator.max,4,'four approaches permitted');
const target={x:0,y:0,angle:0,health:100,areaId:'zone'};
function actor(id,x,y,tap2='exhaustCutter'){
  return {id,x,y,health:100,state:'chase',areaId:'zone',
    avatarRef:{group:{parent:{}}},def:{
      banditStandoffMaxTiles:3.6,banditAbilityLoadout:{tap1:'swingCombo',tap2,hold1:'chargedBreaker'},
      weaponShapeStats:{speed:1},
    },_banditStrafePhase:.5};
} // All four use real bandit directional configuration and a valid scene-parent marker.
const front=actor('front',140,0),left=actor('left',0,140),right=actor('right',0,-140),rear=actor('rear',-140,0);
const holders=[front,left,right,rear].map(c=>coordinator.claim(c,0,target));
assert.deepEqual(Array.from(holders,p=>p.sector),[0,1,2,3],'four attackers own unique front, left, right and rear sectors');
assert.equal(coordinator.slots.length,4,'no redundant slot objects');
assert.equal(coordinator.claim(actor('fifth',70,70),0,target),null,'a fifth actor must queue');
target.angle=Math.PI/2;
const retained=coordinator.claim(front,0,target);
assert.strictEqual(retained,holders[0],'target rotation must not churn the actor/slot record');
near(coordinator.angle(retained,target),Math.PI/2,'front rotates with its opponent facing');
target.angle=0;

const specialist=actor('specialist',-200,20,'backstabFlick');
rear._banditAction = { phase: 'windup' }; // A fifth bandit must never interrupt an already committed rear-holder's swing.
assert.equal(coordinator.claim(specialist,0,target),null,'active rear-slot attacks cannot be displaced');
rear._banditAction = null;
rear._banditPreparedCharge = { target, action: { windupS:.5 }, t:.3, duration:.5 }; // A separate visible held charge retains its slot too.
assert.equal(coordinator.claim(specialist,0,target),null,'rear slot cannot be stolen during visible held preparation');
rear._banditPreparedCharge = null;
const promoted=coordinator.claim(specialist,0,target);
assert.equal(promoted.sector,3,'a true Backstab specialist displaces a non-specialist rear holder');
assert.equal(coordinator.slots.length,4,'rear upgrade maintains exactly four occupied directions');
assert.equal(coordinator.slots.some(s=>s.bandit===rear),false,'displaced rear actor returns to ordinary queue');
assert.strictEqual(coordinator.claim(rear,0,target),null,'rear replacement cannot create a fifth slot');
// Waiting fighters retain the multi-ring capacity, but repeated frames no longer rescan the entire queue.
const waitingTarget={x:900,y:500,angle:0,health:100,areaId:'zone'};
const waiting=[actor('wait-1',900,600),actor('wait-2',930,600),actor('wait-3',870,600),actor('wait-4',930,650)];
const waits=waiting.map(c=>coordinator.queue(c,0,waitingTarget));
assert.deepEqual(Array.from(waits,q=>q.ringIndex),[0,0,0,1],'three waiting combatants per ring, then the next concentric ring');
assert.strictEqual(coordinator.queue(waiting[0],1.3,waitingTarget),waits[0],'repeat frames reuse one stable queue assignment');
assert.equal(waits[0].angle,0,'queued facing does not jitter with a new bearing');
const otherWaitingTarget={x:1300,y:500,angle:0,health:100,areaId:'zone'};
assert(coordinator.queue(waiting[0],0,otherWaitingTarget),'a queued fighter can change its target');
assert.equal(coordinator.queued.filter(q=>q.bandit===waiting[0]).length,1,'switching targets releases the previous queue record');
waiting[1].health=0;
simulatedNow+=16;
coordinator.queue(waiting[2],0,waitingTarget);
assert.equal(coordinator.queued.some(q=>q.bandit===waiting[1]),false,'batched cleanup removes dead queued actors and target references');

// Ranged, flask and staged-duel transitions release stale melee/queue positions without waiting for another enemy to prune them.
coordinator.releaseApproach(waiting[2]);
assert.equal(coordinator.queued.some(q=>q.bandit===waiting[2]),false,'switching out of close melee releases the waiting-ring reference immediately');
coordinator.releaseApproach(waiting[2]);
coordinator.releaseApproach(front);
assert.equal(coordinator.slots.some(q=>q.bandit===front),false,'switching from melee to ranged gives up the occupied front direction immediately');
const replacement=actor('replacement-front',110,0);
const oldWaitingPlace=coordinator.queue(replacement,0,target); // A fifth attacker starts in the existing waiting ring before a frontline place opens.
assert(coordinator.queued.includes(oldWaitingPlace),'queued fighter originally consumes one waiting-ring place');
assert.equal(coordinator.claim(replacement,0,target).sector,0,'another fighter can immediately occupy the newly cleared approach direction');
assert.equal(coordinator.queued.some(q=>q.bandit===replacement),false,'promotion frees the old waiting-ring record rather than making the fighter occupy both');
assert.strictEqual(coordinator.claim(replacement,0,target).sector,0,'stable front ownership does not re-add a waiting record');

const alternate={x:700,y:0,angle:0,health:100,areaId:'zone'};
assert(coordinator.claim(rear,0,alternate),'other targets maintain independent approach reservations');

assert(coordinator.acquire(front,target),'front fighter gets the first attack');
assert.strictEqual(coordinator.owner(target),front);
assert.equal(coordinator.acquire(left,target),false,'another fighter cannot enter the same target attack windup');
let hits=0; // Incremented inside the actual staged onStrike callback.
const attackStage=coordinator.stage(front,{windupS:.2,strikeS:.4,recoverS:.7,
  onStrike(){hits++;},onComplete(){}},target);
assert.strictEqual(coordinator.owner(target),front,'permission stays held through committed windup');
attackStage.onStrike(attackStage);
assert.equal(hits,1,'the real strike callback ran');
assert.strictEqual(coordinator.owner(target),null,'permission releases after hit resolution, before strike recovery');
assert(coordinator.acquire(left,target),'second fighter may start windup while the first cosmetic attack is still finishing');
assert.equal(attackStage.cancelled,false,'first animation was not canceled just to allow another windup');
assert.strictEqual(coordinator.owner(target),left);
attackStage.onComplete(attackStage);
assert.strictEqual(coordinator.owner(target),left,'late recovery completion cannot clear a newer fighter’s turn');
const cancelled=coordinator.stage(left,{windupS:.5,strikeS:.2,onCancel(){}},target);
cancelled.cancel();
assert.strictEqual(coordinator.owner(target),null,'stagger/cancel releases turn without requiring a strike');
assert(coordinator.acquire(rear,alternate),'an unrelated target can be attacked independently');

assert(coordinator.acquire(right,target),'an attack may coexist with a separate preparatory charge');
specialist.x=-130; specialist.y=20; // Move into the ability's actual safe reach, as the full AI's approach does before beginning preparation.
assert(coordinator.prepare(specialist,target),'a second actor can visibly draw a held charge while an attack is committed');
const charge=specialist._banditPreparedCharge;
assert(charge&&charge.action.windupS>0,'charge has a draw-only animation stage');
assert.equal(stages.length,2,'preparing a held attack must NOT create a Combat staged strike');
assert.strictEqual(coordinator.chargeOwner(target),specialist);
assert.equal(coordinator.prepare(front,target),false,'only one extra preparer is permitted');
charge.t=charge.duration;
assert.equal(coordinator.acquire(left,target),false,'current attacker still owns the sole committed slot');
coordinator.release(right,target);
specialist.x=-350; // Losing actual reach while charging must NOT freeze ready-to-strike squadmates.
assert(coordinator.acquire(left,target),'an out-of-range prepared charge cannot starve the target');
coordinator.release(left,target);
specialist.x=-130;
assert.equal(coordinator.acquire(left,target),false,'fully readied held charge gets priority only when it can release');
assert(coordinator.acquire(specialist,target),'readied actor can commit after the other strike resolves');
coordinator.uncharge(specialist,target,true);
assert.strictEqual(coordinator.chargeOwner(target),null,'preparation is relinquished when the staged release takes over');
assert.strictEqual(coordinator.owner(target),specialist);
const releaseStage=coordinator.stage(specialist,{windupS:.12,strikeS:.2,onStrike(){hits++;},onComplete(){}},target);
releaseStage.onStrike(releaseStage);
assert.strictEqual(coordinator.owner(target),null,'a held release also frees the turn at its final hit');
assert.equal(hits,2);
assert(coordinator.prepare(specialist,target),'the same actor may start another charge only after the old one is released');
coordinator.uncharge(specialist,target);
assert.strictEqual(coordinator.chargeOwner(target),null,'a canceled preparatory pose leaves no target reservation');
assert.equal(specialist.restored,true,'canceling a held windup restores the natural tool stance');

const payed={tempo:2,ratio:.5,used:2}; // One real Fey enhancement yields two independent physical strikes.
const numeric=(value,defaultValue=0)=>Number.isFinite(Number(value))?Number(value):defaultValue;
const fey=vm.runInNewContext('(()=>{let lastNpcEcho=null;' +
  section(hypeSource,'  function beginNpcMelee(', '  function prepare(context)') +
  'return beginNpcMelee;})()',{window:windowStub,numeric,Math,Number});
windowStub.FeyHypedAttacks={claimNpcMelee:()=>payed,beginNpcMelee:fey}; // Run the real Fey stage sequencer through our production attack-turn wrapper.
const empowered=actor('fey',100,25);
assert(coordinator.acquire(empowered,target));
const first=coordinator.stage(empowered,{windupS:.2,strikeS:.2,recoverS:0,
  data:{isBandit:true,attacker:empowered},onStrike(){hits++;},onComplete(){}},target);
first.onStrike(first);
assert.strictEqual(coordinator.owner(target),empowered,'first Fey hit cannot unlock another melee windup before its echo');
first.onComplete(first);
const echoed=empowered._banditAction;
assert(echoed&&echoed!==first,'real Fey executor creates the second physical strike stage');
assert.strictEqual(coordinator.owner(target),empowered,'Fey echo windup keeps the original target attack lock');
echoed.onStrike(echoed);
assert.strictEqual(coordinator.owner(target),null,'the second Fey hit finally releases the target');
echoed.onComplete(echoed);
assert.equal(hits,4,'both ordinary and both Fey strikes actually called the production callback');
assert.equal(empowered._feyHypedNpcSequence,undefined,'Fey second-strike state is cleaned up');


// A reactive Counter Shield riposte must obey the same single-strike rule.
windowStub.Combat.counterShieldData={COUNTER_DAMAGE_MUL:1,COUNTER_RANGE_MUL:1,COUNTER_HALF_CONE_DEG:30,COUNTER_KNOCKBACK_MUL:1};
windowStub.Combat.meleeAimSolution=()=>({pitch:0});
windowStub.Combat.meleeHit=()=>false;
const riposte=vm.runInNewContext(
  '(()=>{'+section(source,'  function fireBanditCounterRiposte(', '  // "Choose an attack, then judge how close to get"')+
  'return fireBanditCounterRiposte;})()',{
    window:windowStub,deps,Math,Number,banditDirectional:()=>true,
    claimBanditAttackTurn:coordinator.acquire,releaseBanditAttackTurn:coordinator.release,
    banditAttackBaseline:()=>({damage:5,rangePx:60,knockbackPxS:60}),spawnBanditTrailArc(){},
  }
);
const countBeforeCounter=stages.length;
assert(coordinator.acquire(front,target));
riposte(left,{attackTag:'blunt',weaponShapeStats:{speed:1}},target);
assert.equal(stages.length,countBeforeCounter,'reactive Counter Shield cannot overlap a committed melee windup');
coordinator.release(front,target);
riposte(left,{attackTag:'blunt',weaponShapeStats:{speed:1}},target);
assert.equal(stages.length,countBeforeCounter+1,'Counter Shield acquires the one free melee turn');
assert.strictEqual(coordinator.owner(target),left);
const counterStage=stages.at(-1);
assert.equal(coordinator.acquire(left,target),false,'countering actor cannot start its own second attack while the untracked counter is winding up');
assert.equal(coordinator.acquire(front,target),false,'other fighters also remain locked during the counter');
counterStage.onStrike(counterStage);
assert.strictEqual(coordinator.owner(target),null,'Counter Shield turn releases after resolving its own reactive hit');
assert(coordinator.acquire(left,target),'after the reactive hit resolves, the same actor is allowed another new turn');
coordinator.release(left,target);


// Older mine/special humanoids must still have their original two-angle capacity.
const specialTarget={x:500,y:500,angle:0,health:100,areaId:'zone'}; // Independent enemy target with its own two-slot legacy choreography.
const oldSpecials=[actor('s1',600,500),actor('s2',400,500),actor('s3',500,600)];
for(const c of oldSpecials)c.def.banditStandoffMaxTiles=null; // Real def factory opts non-bandit classes out of the new coordinator.
assert(coordinator.claim(oldSpecials[0],0,specialTarget));
assert(coordinator.claim(oldSpecials[1],0,specialTarget));
assert.equal(coordinator.claim(oldSpecials[2],0,specialTarget),null,'special humanoids keep their two-slot limit');
assert.equal(coordinator.slots.filter(s=>s.target===specialTarget).length,2);
assert.match(source,/_banditSlotForActor = new WeakMap/,'directional coordinator does not linearly scan for every existing actor on every frame');
assert.match(source,/BANDIT_SLOT_PRUNE_INTERVAL_MS = 12/,'dead/unloaded slot pruning is batched rather than repeated for each actor');

assert.match(source,/const readyToStrike = distToPlayer <= engageRangePx && !!slot && inSector && attackPermission/,'real combat AI uses direction and one-attacker gating');
assert.match(source,/claimBanditAttackTurn\(c, targetPlayer\)/,'real combat AI claims the turn before spending Stamina or starting an attack');
assert.match(source,/fireBanditChargedBreaker\(c, def, targetPlayer, prep\)/,'prepared releases reuse the actual Charged Breaker ability');
assert.match(source,/c\._banditPreparedCharge\?\.action/,'tool rendering uses the existing SharedAttackPose for a held windup');
assert.match(logSource,/sector=\$\{directionalSlot/,'mobile combat log exposes approach sector');
assert.match(logSource,/chargeOwner=\$\{activeCharge/,'mobile combat log exposes the extra held charge');

// The production combat AI must actually start a separate held-charge preview while another bandit swings.
const decisions=[]; // Records actions chosen by the full combat decision function, not a copied state machine.
const simulatedCombat={
  Combat:{...windowStub.Combat,attackAlignmentStep:()=>null},
  ResourceSystem:{spendStamina(){}},
};
const simDeps={...deps,rnd:()=>.1,JUMP_BACK_SPEED:110,
  moveCreatureToward(c,x,y,speed,dt){const dx=x-c.x,dy=y-c.y,d=Math.hypot(dx,dy),step=Math.min(speed*dt,d);
    if(d>0){c.x+=dx/d*step;c.y+=dy/d*step;}return step>0;}}; // Flat unobstructed arena uses the real move callback signature.
let simulation=null; // Collaborators below reference the exported coordinator only after the real module has been evaluated.
const aiGlobals={
  window:simulatedCombat,deps:simDeps,WeakMap,Math,Number,Object,performance:{now:()=>1000},
  resetBanditSwingToNatural(c){c.restored=true;},
  resolvedBanditCombatTarget:(c,t)=>t,_updateBanditLookAtTarget(){},
  updateBanditFlaskAI:()=>null,updateBanditLunge:()=>false,enforceBanditPlayerCollision(){},
  npcDuelStagingUpdate:()=>null,updateBanditGuardWindow(){},
  banditPersonalSpaceAdjust:(c,point,out)=>{out.x=point.x;out.y=point.y;return out;},
  banditEngagementReachPx:()=>170,claimBanditQueueRing:()=>({angle:0,ringIndex:0}),
  banditRingPoint:(t,a,r,out)=>{out.x=t.x+Math.cos(a)*r;out.y=t.y+Math.sin(a)*r;return out;},
  banditBehindTarget:()=>false,banditBackstabFlankPoint:()=>({x:0,y:0}),
  banditQuickAttackConditions:()=>({behind:false,exhausted:false,lowHealth:false}),
  banditQuickAttackChance:()=>0,fireBanditQuickAttack:()=>false,fireBanditChargedBreaker(c,def,t,prep){
    decisions.push({kind:'charged-release',prep});
    c._banditAction=simulation.stage(c,{windupS:.12,strikeS:.2,onStrike(){},onComplete(){c._banditAction=null;}},t);
    return true;
  },
  fireBanditComboStep(c,def,loadout,t){
    decisions.push({kind:'combo',actor:c.id});
    c._banditAction=simulation.stage(c,{windupS:.2,strikeS:.2,onStrike(){},onComplete(){c._banditAction=null;}},t);
    return true;
  },
  fireBanditChargedBreakerUnavailable:()=>false,
  BANDIT_HOLD1_CHANCE:.4,BANDIT_STRAFE_HZ:.14,BANDIT_STRAFE_ANGLE_AMPLITUDE_RAD:Math.PI/6,
  BANDIT_STRAFE_SPEED_PX_S:55,BANDIT_QUEUE_RING_STEP_MUL:.6,BANDIT_STANDOFF_RANGE_MUL:1.8,
}; // All other calls are existing game adapters. The full decision function is otherwise unmodified.
simulation=vm.runInNewContext(
  '(()=>{' +
  section(source,'  const BANDIT_MAX_ATTACK_SLOTS =','  // Queued (non-slot-holding)') +
  section(source,'  const BANDIT_QUEUE_RING_CAPACITY =','  // A point on a ring of the given radius') +
  section(source,'  function beginBanditMeleeStage(', '  function resolvedBanditCombatTarget(') +
  section(source,'  function updateBanditCombatAI(', '  // ── Bandit weapon visuals') +
  'return {tick:updateBanditCombatAI,slot:claimBanditAttackSlot,owner:banditAttackTurnOwner,' +
  'acquire:claimBanditAttackTurn,release:releaseBanditAttackTurn,' +
  'chargeOwner:banditChargeOwner,stage:beginBanditMeleeStage};})()',aiGlobals
);
const simulatedTarget={x:0,y:0,angle:0,health:100,stamina:100,maxHealth:100,maxStamina:100};
const striker=actor('first-to-strike',125,0);
striker.def.banditAbilityLoadout={tap1:'swingCombo',tap2:'exhaustCutter',hold1:null};
const chargingFighter=actor('prepared-followup',0,125);
for(const c of [striker,chargingFighter]){
  c.def.chaseSpeed=290;c.def.moveSpeed=118;c.def.attackRangePx=55;c.def.attackStaminaCost=10;
  c.def.backstabFlankMaxSeconds=2;c.def.banditStandoffTierStepTiles=.2;
  c.stamina=100;c.attackCooldownT=0;c.facing=0;c._banditChargeDecisionCdS=0;
}
simulation.tick(striker,.1,simulatedTarget,125);
assert.strictEqual(simulation.owner(simulatedTarget),striker,'full bandit AI claims one turn before dispatching a combo');
simulation.tick(chargingFighter,.1,simulatedTarget,125);
assert(chargingFighter._banditPreparedCharge,'the second fighter begins its visible charge DURING the first committed attack');
assert.strictEqual(simulation.chargeOwner(simulatedTarget),chargingFighter);
assert.equal(decisions.length,1,'the preparation has not fired an unauthorized second attack');
for(let i=0;i<15;i++) simulation.tick(chargingFighter,.1,simulatedTarget,Math.hypot(chargingFighter.x,chargingFighter.y));
assert.equal(decisions.length,1,'fully held charge cannot fire while another attacker owns the turn');
const firstStage=striker._banditAction;
firstStage.onStrike(firstStage);
assert.strictEqual(simulation.owner(simulatedTarget),null,'the first combo releases at the end of hit resolution, even before recovery');
simulation.tick(chargingFighter,.05,simulatedTarget,Math.hypot(chargingFighter.x,chargingFighter.y));
assert.equal(decisions.length,2,'the next attack is the separately prepared charged release');
assert.equal(decisions[1].kind,'charged-release');
assert(decisions[1].prep.chargeT>0,'release carries the original sampled charge strength');
assert.strictEqual(simulation.owner(simulatedTarget),chargingFighter,'the released held attack takes the single committed permission');

// The full AI must also respect its OWN reactive Counter Shield permission,
// even though a counter intentionally does not set the actor's _banditAction.
const counterSimTarget={x:900,y:0,angle:0,health:100,stamina:100,maxHealth:100,maxStamina:100};
const counterSimActor=actor('counter-sim',955,0);
counterSimActor.def.chaseSpeed=290;counterSimActor.def.moveSpeed=118;
counterSimActor.def.attackRangePx=55;counterSimActor.def.attackStaminaCost=10;
counterSimActor.def.banditStandoffTierStepTiles=.2;counterSimActor.attackCooldownT=0;
counterSimActor.stamina=100;counterSimActor.facing=0;
assert(simulation.acquire(counterSimActor,counterSimTarget),'reactive counter holds one committed attack turn');
const decisionsBeforeCounter=decisions.length;
simulation.tick(counterSimActor,.1,counterSimTarget,55);
assert.equal(decisions.length,decisionsBeforeCounter,'full AI must NOT start a regular attack while the same actor is countering without _banditAction');
simulation.release(counterSimActor,counterSimTarget);
simulation.tick(counterSimActor,.1,counterSimTarget,Math.hypot(counterSimActor.x-counterSimTarget.x,counterSimActor.y-counterSimTarget.y));
assert.equal(decisions.length,decisionsBeforeCounter+1,'same fighter may commit a new real attack after its counter hit resolves');

console.log('bandit directional melee: 4 sectors, one resolved attack, parallel charge, cancellations and Fey echo passed');
