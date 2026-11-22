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
const context={window:windowStub,deps,WeakMap,Math,Number,Object,performance:{now:()=>1000},
  resetBanditSwingToNatural(c){c.restored=true;}};
const coordinator=vm.runInNewContext(
  '(()=>{' +
  section(source,'  const BANDIT_MAX_ATTACK_SLOTS =','  // Queued (non-slot-holding)') +
  section(source,'  function beginBanditMeleeStage(', '  function resolvedBanditCombatTarget(') +
  'return {slots:_banditAttackSlots,claim:claimBanditAttackSlot,angle:banditFacingSlotAngle,' +
  'owner:banditAttackTurnOwner,acquire:claimBanditAttackTurn,release:releaseBanditAttackTurn,' +
  'chargeOwner:banditChargeOwner,prepare:beginBanditPreparedCharge,uncharge:releaseBanditCharge,' +
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
const promoted=coordinator.claim(specialist,0,target);
assert.equal(promoted.sector,3,'a true Backstab specialist displaces a non-specialist rear holder');
assert.equal(coordinator.slots.length,4,'rear upgrade maintains exactly four occupied directions');
assert.equal(coordinator.slots.some(s=>s.bandit===rear),false,'displaced rear actor returns to ordinary queue');
assert.strictEqual(coordinator.claim(rear,0,target),null,'rear replacement cannot create a fifth slot');
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
assert(coordinator.prepare(specialist,target),'a second actor can visibly draw a held charge while an attack is committed');
const charge=specialist._banditPreparedCharge;
assert(charge&&charge.action.windupS>0,'charge has a draw-only animation stage');
assert.equal(stages.length,2,'preparing a held attack must NOT create a Combat staged strike');
assert.strictEqual(coordinator.chargeOwner(target),specialist);
assert.equal(coordinator.prepare(front,target),false,'only one extra preparer is permitted');
charge.t=charge.duration;
assert.equal(coordinator.acquire(left,target),false,'current attacker still owns the sole committed slot');
coordinator.release(right,target);
assert.equal(coordinator.acquire(left,target),false,'fully readied held charge gets priority when the turn opens');
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
counterStage.onStrike(counterStage);
assert.strictEqual(coordinator.owner(target),null,'Counter Shield turn releases after resolving its own reactive hit');

assert.match(source,/const readyToStrike = distToPlayer <= engageRangePx && !!slot && inSector && attackPermission/,'real combat AI uses direction and one-attacker gating');
assert.match(source,/claimBanditAttackTurn\(c, targetPlayer\)/,'real combat AI claims the turn before spending Stamina or starting an attack');
assert.match(source,/fireBanditChargedBreaker\(c, def, targetPlayer, prep\)/,'prepared releases reuse the actual Charged Breaker ability');
assert.match(source,/c\._banditPreparedCharge\?\.action/,'tool rendering uses the existing SharedAttackPose for a held windup');
assert.match(logSource,/sector=\$\{directionalSlot/,'mobile combat log exposes approach sector');
assert.match(logSource,/chargeOwner=\$\{activeCharge/,'mobile combat log exposes the extra held charge');
console.log('bandit directional melee: 4 sectors, one resolved attack, parallel charge, cancellations and Fey echo passed');
