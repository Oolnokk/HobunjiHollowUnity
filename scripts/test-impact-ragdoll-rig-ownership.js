#!/usr/bin/env node
'use strict';
// Exercises actual recorded impact runtime + unified compositor; no WebGL is needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class V {
  constructor(x=0,y=0,z=0) { this.set(x,y,z); }
  set(x,y,z) { this.x=x;this.y=y;this.z=z;return this; }
  clone() { return new V(this.x,this.y,this.z); }
  copy(v) { return this.set(v.x,v.y,v.z); }
}
class Q {
  constructor(x=0,y=0,z=0,w=1) { this.set(x,y,z,w);this.isQuaternion=true; }
  set(x,y,z,w) { this.x=x;this.y=y;this.z=z;this.w=w;return this; }
  clone() { return new Q(this.x,this.y,this.z,this.w); }
  copy(q) { return this.set(q.x,q.y,q.z,q.w); }
  identity() { return this.set(0,0,0,1); }
  setFromAxisAngle(axis,t) { const s=Math.sin(t/2);return this.set(axis.x*s,axis.y*s,axis.z*s,Math.cos(t/2)); }
  invert() { return this.set(-this.x,-this.y,-this.z,this.w); }
  multiply(q) {
    const a=this.clone(); // Preserve operands for exact quaternion multiplication.
    return this.set(a.x*q.w+a.w*q.x+a.y*q.z-a.z*q.y,
      a.y*q.w+a.w*q.y+a.z*q.x-a.x*q.z,
      a.z*q.w+a.w*q.z+a.x*q.y-a.y*q.x,
      a.w*q.w-a.x*q.x-a.y*q.y-a.z*q.z);
  }
  slerp(q,t) { const value=t>=1?q:this.clone();if(t<=0)return this;return this.set(
    this.x+(value.x-this.x)*t,this.y+(value.y-this.y)*t,
    this.z+(value.z-this.z)*t,this.w+(value.w-this.w)*t); }
}
class Group {
  constructor() { this.isObject3D=true;this.position=new V();this.quaternion=new Q();this.children=[];this.userData={};this.parent=null; }
  add(child) { if(child.parent)child.parent.remove(child);this.children.push(child);child.parent=this; }
  remove(child) { const i=this.children.indexOf(child);if(i>=0)this.children.splice(i,1);child.parent=null; }
}
const THREE={Quaternion:Q,Vector3:V,Group};
const rotate=t=>new Q().setFromAxisAngle(new V(1,0,0),t);
const recorded=()=>{
  const make=(t,y)=>({t,ragdoll:{
    body:{localQuaternion:rotate(t*.4),localPosition:{y}},
    ik:Object.fromEntries(['left','right'].map(side=>[side,{
      thighQuaternion:rotate(t*.3),calfLocalQuaternion:rotate(-t*.2),
      upperLength:.2,lowerLength:.2}]))
  }});
  return {frames:[make(0,0),make(1,.16)],durationSeconds:1};
}; // Deterministic two-frame clip covers prone, live hit and creature death.
let clip=recorded(); // Swapped to the shipped prone bank in the all-creature portrait regression.
let rescueFrame = null; // Registered render-time fallback; invoked below to simulate throttled hostile update frames.
const window={THREE,ImpactBlendLibrary:{getClip(_bank,_direction){return clip;}},RenderHooks:{
  ORDER:{ANIMAL_ELEVATION:50},
  register(spec){if(spec.id==='creature-prone-pose-rescue')rescueFrame=spec.before;},
}};
let fakeNowMs=1000; // Advances an actual render clock while the creature update intentionally stalls.
const context={window,THREE,console,performance:{now:()=>fakeNowMs}};
vm.runInNewContext(fs.readFileSync('docs/js/rig-transform-layers.js','utf8'),context);
vm.runInNewContext(fs.readFileSync('docs/js/combat/impact-ragdoll-playback.js','utf8'),context);
const rig=window.ActorRigCompositor,impact=window.ImpactRagdollPlayback;
function near(a,b) {assert(Math.abs(a-b)<1e-7, String(a)+' should equal '+String(b));}
function makeWalker() {
  const root=new Group(), avatarGroup=new Group(), legs={group:new Group(),standingPosteriorY:.36,
    calls:0,applyRecordedLegPose(){this.calls++;}};
  root.add(avatarGroup);root.add(legs.group);
  return {root,avatarGroup,legs};
}
{
  const walker=makeWalker();
  impact.holdHumanoidProne(walker,'front',1);
  const pivot=walker._cinematicPosePivot; // Permanent neutral pivot remains between actor root and authored skeleton.
  assert.equal(pivot.parent,walker.root);
  assert.equal(walker.avatarGroup.parent,pivot);
  assert.equal(walker.legs.group.parent,pivot);
  assert.equal(rig.getDebug().activeAbsoluteClaims,2);
  impact.clearHumanoidProne(walker);
  near(pivot.position.y,.36);
  near(pivot.quaternion.w,1);
  assert.equal(rig.getDebug().activeAbsoluteClaims,0);
  impact.holdHumanoidProne(walker,'front',1);
  pivot.position.y=4.2;
  pivot.quaternion.copy(rotate(.71)); // New scene/animation now owns this pivot.
  impact.clearHumanoidProne(walker);
  near(pivot.position.y,4.2);
  assert(Math.abs(pivot.quaternion.x-rotate(.71).x)<1e-7,'an interrupted pivot retains a newer pose');
  assert.equal(rig.getDebug().activeAbsoluteClaims,0);
  const newAvatar=new Group(),newLegs=new Group();
  walker.avatarGroup=newAvatar;walker.legs.group=newLegs;walker.root.add(newAvatar);walker.root.add(newLegs);
  impact.holdHumanoidProne(walker,'front',.5);
  assert.notEqual(walker._cinematicPosePivot,pivot,'recreated humanoid rig cannot reuse its old pose pivot');
  impact.clearHumanoidProne(walker);
  assert.equal(rig.getDebug().activeAbsoluteClaims,0);
}
function creature() {
  const group=new Group(),frontPlane=new Group(),backPlane=new Group();
  group.add(frontPlane);group.add(backPlane);
  return {health:20,prone:false,halfHeight:.45,avatarRef:{group,frontPlane,backPlane}};
}
{
  const enemy=creature();
  assert(impact.triggerCreature(enemy,'breakThrow','front')>0);
  const state=enemy._impactRagdollPlayback;
  assert.equal(rig.absoluteOwner(state.pivot,'quaternion'),'impact-creature-reaction');
  assert.equal(rig.getDebug().activeAbsoluteClaims,2);
  impact.updateCreature(enemy,.5);
  impact.stopCreature(enemy);
  assert.equal(rig.getDebug().activeAbsoluteClaims,0);
  near(state.pivot.position.y,0);
  assert(impact.triggerCreature(enemy,'breakThrow','front')>0);
  const interrupted=enemy._impactRagdollPlayback;
  interrupted.pivot.quaternion.copy(rotate(.9));
  assert.equal(impact.updateCreature(enemy,.1),false,'newer creature rotation invalidates obsolete impact');
  assert(Math.abs(interrupted.pivot.quaternion.x-rotate(.9).x)<1e-7);
  assert.equal(rig.getDebug().activeAbsoluteClaims,0);
  assert(impact.startCreatureDeath(enemy,'front')>0,'corpse retains a separately owned recorded throw');
  assert.equal(rig.absoluteOwner(enemy._deathRecordedThrow.pivot,'quaternion'),'impact-creature-death');
  assert.equal(impact.triggerCreature(enemy,'breakThrow','front'),0,'live impacts cannot displace corpse pose');
  impact.sampleCreatureDeath(enemy,.7);
  impact.stopCreatureDeath(enemy);
  assert.equal(rig.getDebug().activeAbsoluteClaims,0);
  const oldPivot=enemy.avatarRef.impactPivot; // Simulate rebuilding the two planes after a genotype/dye refresh.
  const replacementFront=new Group(),replacementBack=new Group();
  enemy.avatarRef.group.add(replacementFront);enemy.avatarRef.group.add(replacementBack);
  enemy.avatarRef.frontPlane=replacementFront;enemy.avatarRef.backPlane=replacementBack;
  assert(impact.triggerCreature(enemy,'breakThrow','front')>0);
  assert.notEqual(enemy.avatarRef.impactPivot,oldPivot,'new creature card generation creates a fresh pose pivot');
  assert.equal(oldPivot.parent,null,'old creature card pivot is retired rather than rendering a ghost of the previous sprite');
  impact.stopCreature(enemy);
  const previousAvatar=enemy.avatarRef.group; // Preserve the old group only to verify it cannot be targeted after an avatar rebuild.
  const previousPivot=enemy.avatarRef.impactPivot; // A valid old sprite pivot must not be reused by the replacement actor.
  const nextAvatar=new Group(),nextFront=new Group(),nextBack=new Group();
  nextAvatar.add(nextFront);nextAvatar.add(nextBack);
  enemy.avatarRef.group=nextAvatar;
  enemy.avatarRef.frontPlane=nextFront;
  enemy.avatarRef.backPlane=nextBack;
  assert(impact.triggerCreature(enemy,'breakThrow','front')>0);
  assert.equal(enemy.avatarRef.impactPivot.parent,nextAvatar,'new pivot must be attached under the NEW visible avatar root');
  assert.notEqual(enemy.avatarRef.impactPivot,previousPivot);
  assert.equal(previousPivot.parent,null,'the previous actor generation is detached from its old avatar root');
  assert(!previousAvatar.children.includes(previousPivot));
  impact.stopCreature(enemy);
  assert.equal(rig.getDebug().activeAbsoluteClaims,0);
}

// A wildlife creature has only its two portrait planes. Simulate the real
// breakThrow recording stalling partway through: the next world draw must
// finish it without any leg or hand rig, and keep the pose while prone.
{
  const originalClip=clip;
  const bank=JSON.parse(fs.readFileSync('docs/config/animations/spinthrow-blend-v1.json','utf8'));
  clip=bank.clips.front.clip;
  assert.equal(typeof rescueFrame,'function','prone portrait is independently advanced by the normal render pipeline');
  const creatureWithoutLimbs=creature();
  creatureWithoutLimbs.prone=true;
  const started=impact.triggerCreature(creatureWithoutLimbs,'breakThrow','front');
  assert(started>0,'real recorded knockdown starts for an animal without hands or legs');
  const state=creatureWithoutLimbs._impactRagdollPlayback;
  impact.updateCreature(creatureWithoutLimbs,.16);
  const earlyY=1-2*(state.pivot.quaternion.x**2+state.pivot.quaternion.z**2);
  assert(Math.abs(earlyY)>.3,'a partial knockdown leaves the portrait recognizably upright or tilted');
  fakeNowMs+=50;rescueFrame();
  assert.equal(state.holding,false,'healthy 50 ms creature update gaps do not snap a fall forward');
  fakeNowMs+=1500;
  impact.updateCreature(creatureWithoutLimbs,0); // A zero-delta game frame must not reset the watchdog timestamp.
  rescueFrame();
  const finalY=1-2*(state.pivot.quaternion.x**2+state.pivot.quaternion.z**2);
  assert(Math.abs(finalY)<.2,'SHIPPED clip must orient the creature portrait horizontally even without limbs');
  assert.equal(state.holding,true,'stalled animation must settle in a full held prone pose');
  assert(impact.getDebug().pronePoseRescue.rescuedStalls>=1,'mobile diagnostics records the rescued stalled creature');
  assert.equal(impact.triggerCreature(creatureWithoutLimbs,'impact','front'),0,
    'a second normal impact cannot replace the held prone pose with a partial upright stagger');
  assert.equal(creatureWithoutLimbs._impactRagdollPlayback,state);
  creatureWithoutLimbs.prone=false;rescueFrame();
  assert.equal(creatureWithoutLimbs._impactRagdollPlayback,null,'render-boundary recovery releases the prone pivot when Footing recovers');

  // Different incoming attack angles select different authored source clips,
  // but all four must turn an actual two-sided animal portrait horizontal.
  for(const [direction,sourcePole] of Object.entries({front:'left',back:'right',left:'back',right:'front'})) {
    clip=bank.clips[sourcePole].clip;
    const animal=creature();animal.prone=true;
    assert(impact.triggerCreature(animal,'breakThrow',direction)>0);
    impact.updateCreature(animal,clip.durationSeconds+.01);
    const q=animal._impactRagdollPlayback.pivot.quaternion;
    const upY=1-2*(q.x*q.x+q.z*q.z);
    assert(Math.abs(upY)<.2,direction+' live prone card is horizontal with its actual authored directional clip');
    impact.stopCreature(animal);
    assert.equal(animal._impactRagdollPlayback,null);
  }

  clip=null; // Simulate the async clip request being unfinished when a creature is knocked down.
  const earlyCreature=creature();earlyCreature.prone=true;
  assert.equal(impact.triggerCreature(earlyCreature,'breakThrow','front'),0,'no recording reports zero clip duration');
  const fallback=earlyCreature._impactRagdollPlayback;
  assert(fallback?.holding,'missing recording still gets a temporary held prone pose');
  const fallbackY=1-2*(fallback.pivot.quaternion.x**2+fallback.pivot.quaternion.z**2);
  assert(Math.abs(fallbackY)<.05,'animal with no recording is visibly horizontal instead of standing at a tilt');
  earlyCreature.prone=false;rescueFrame();
  assert.equal(earlyCreature._impactRagdollPlayback,null,'fallback releases cleanly on recovery');
  clip=originalClip; // No following test can inherit the synthetic missing-bank state.
}

// A real prone creature can lose its rendered sprite or its stored animation
// state independently of its gameplay Footing/prone status.
{
  const authored=JSON.parse(fs.readFileSync('docs/config/animations/spinthrow-blend-v1.json','utf8'));
  const originalClip=clip;
  clip=authored.clips.left.clip;
  const animal=creature();animal.prone=true;
  assert.equal(impact.updateCreature(animal,.016),true,'prone animals reattach when the initial breakThrow did not start');
  let state=animal._impactRagdollPlayback;
  assert(state?.holding,'late rig acquisition holds the settled pose instead of replaying a launch');
  assert.equal(animal.avatarRef.frontPlane.parent,state.pivot);
  assert.equal(animal.avatarRef.backPlane.parent,state.pivot);
  assert(Math.abs(1-2*(state.pivot.quaternion.x**2+state.pivot.quaternion.z**2))<.2,'late-attached portrait lies horizontal');
  assert.equal(rig.getDebug().activeAbsoluteClaims,2);

  // The common species/skin refresh path can swap front/back meshes without
  // touching the gameplay entity or the old impact pivot/session.
  const previous=state;
  const freshFront=new Group(),freshBack=new Group();
  animal.avatarRef.group.add(freshFront);animal.avatarRef.group.add(freshBack);
  animal.avatarRef.frontPlane=freshFront;animal.avatarRef.backPlane=freshBack;
  assert.equal(impact.updateCreature(animal,.016),true,'live animation detects newer portrait planes');
  state=animal._impactRagdollPlayback;
  assert.notEqual(state,previous,'fresh plane generation replaces stale impact state');
  assert.equal(freshFront.parent,state.pivot);
  assert.equal(freshBack.parent,state.pivot);
  assert.equal(previous.pivot.parent,null,'stale invisible pivot is retired');
  assert.equal(rig.getDebug().activeAbsoluteClaims,2,'new rig owns exactly one active transform pair');
  const q=state.pivot.quaternion;
  assert(Math.abs(1-2*(q.x*q.x+q.z*q.z))<.2,'recreated portrait remains lying flat');

  // Entire avatar generation replacement on the same entity (wildlife
  // streaming, shoulder skin or age/species rebuild).
  const formerAvatar=animal.avatarRef;
  const replacement=creature().avatarRef;
  animal.avatarRef=replacement;
  assert.equal(impact.updateCreature(animal,.016),true,'complete new avatar receives prone pose');
  state=animal._impactRagdollPlayback;
  assert.equal(replacement.frontPlane.parent,state.pivot);
  assert.equal(replacement.backPlane.parent,state.pivot);
  assert.equal(state.pivot.parent,replacement.group);
  assert(!formerAvatar.group.children.includes(state.pivot),'replacement never leaves the active pivot on the old avatar');
  assert.equal(rig.getDebug().activeAbsoluteClaims,2);

  // External rig disposal currently clears the entity pointer directly.
  // The render rescue must release that orphan's claims and its strong Set
  // reference before a new visual is promoted.
  animal._impactRagdollPlayback=null;
  animal._wildlifeVisualsReleased=true;
  rescueFrame();
  assert.equal(rig.getDebug().activeAbsoluteClaims,0,'streamed-out actor does not retain an invisible pose claim');
  assert.equal(impact.getDebug().activeCreatureReactions,0,'all old active states are retired');
  animal._wildlifeVisualsReleased=false;
  animal.avatarRef=creature().avatarRef;
  assert.equal(impact.updateCreature(animal,.016),true,'streamed-in prone actor recovers its horizontal card');
  assert.equal(animal._impactRagdollPlayback.holding,true);
  animal.prone=false;
  impact.updateCreature(animal,.016);
  assert.equal(animal._impactRagdollPlayback,null,'prone end restores the newly built sprite to standing');
  assert.equal(rig.getDebug().activeAbsoluteClaims,0);
  assert(impact.getDebug().pronePoseRescue.reboundVisuals>=2,'in-game diagnostics report both sprite-generation rebindings');
  assert(impact.getDebug().pronePoseRescue.retiredOrphans>=1,'in-game diagnostics report external animation disposal');
  clip=originalClip;
}

// A visible new rig can be promoted before normal hostile AI resumes.
// The draw hook must not keep displaying that replacement upright.
{
  const previousClip=clip; // This fixture inspects horizontal orientation from the real authored bank, not the synthetic rig-ownership clip.
  clip=JSON.parse(fs.readFileSync('docs/config/animations/spinthrow-blend-v1.json','utf8')).clips.left.clip;
  const animal=creature();animal.prone=true;
  assert(impact.updateCreature(animal,.016));
  const original=animal._impactRagdollPlayback;
  animal.avatarRef=creature().avatarRef; // Newly promoted rig is now current.
  animal._impactRagdollPlayback=null; // Existing visual teardown can clear this directly.
  rescueFrame();
  const rebound=animal._impactRagdollPlayback;
  assert(rebound?.holding,'render rescue reattaches a visible newly promoted prone animal without waiting for AI');
  assert.notEqual(rebound,original);
  assert.equal(animal.avatarRef.frontPlane.parent,rebound.pivot);
  const q=rebound.pivot.quaternion;
  assert(Math.abs(1-2*(q.x*q.x+q.z*q.z))<.2);
  animal.prone=false;rescueFrame();
  assert.equal(impact.getDebug().activeCreatureReactions,0);
  assert.equal(rig.getDebug().activeAbsoluteClaims,0);
  clip=previousClip;
}

// A brief ordinary-impact reaction must never substitute for a full prone
// pose if prone gameplay state overtakes it before the next presentation tick.
{
  const actor=creature();actor.prone=false;
  assert(impact.triggerCreature(actor,'impact','right')>0);
  actor.prone=true;
  assert.equal(impact.updateCreature(actor,.05),true,'new prone state supersedes older non-prone stagger');
  const state=actor._impactRagdollPlayback;
  assert.equal(state.bank,'breakThrow');
  assert.equal(state.holding,true);
  actor.prone=false;impact.updateCreature(actor,.016);
  assert.equal(rig.getDebug().activeAbsoluteClaims,0);
}

// Bandit portraits have an extra visual sway parent while hands/feet remain
// siblings. The fix must address the visible paired portrait planes, leaving
// those unrelated limbs under their original gameplay parent.
{
  const fighter=creature();fighter.prone=true;fighter.isBandit=true;
  const sway=new Group(),legs=new Group(),hands=new Group();
  fighter.avatarRef.group.add(sway);fighter.avatarRef.group.add(legs);fighter.avatarRef.group.add(hands);
  sway.add(fighter.avatarRef.frontPlane);sway.add(fighter.avatarRef.backPlane);
  fighter.avatarRef.legsPivot=legs;fighter.avatarRef.handsPivot=hands;
  assert.equal(impact.updateCreature(fighter,.016),true,'bandit missing-pose repair uses shared creature presentation');
  const state=fighter._impactRagdollPlayback;
  assert.equal(state.pivot.parent,sway,'NPC torso is posed in the actual visual-sway hierarchy');
  assert.equal(fighter.avatarRef.frontPlane.parent,state.pivot);
  assert.equal(fighter.avatarRef.backPlane.parent,state.pivot);
  assert.equal(legs.parent,fighter.avatarRef.group,'leg rig is not mistakenly repurposed as the prone owner');
  assert.equal(hands.parent,fighter.avatarRef.group,'hand rig is not mistakenly repurposed as the prone owner');
  const pose=state.pivot.quaternion.clone();
  for(let t=0;t<20;t++) {
    assert(impact.updateCreature(fighter,.016));
    assert.equal(fighter._impactRagdollPlayback,state,'held prone state must not replay or allocate a new pivot each tick');
  }
  near(state.pivot.quaternion.x,pose.x);near(state.pivot.quaternion.y,pose.y);
  near(state.pivot.quaternion.z,pose.z);near(state.pivot.quaternion.w,pose.w);
  fighter.prone=false;
  impact.updateCreature(fighter,.016);
  assert.equal(rig.getDebug().activeAbsoluteClaims,0);
}

// If knockdown is registered before the victim has a renderable avatar,
// the late visual load must immediately acquire the correct held pose.
{
  const originalClip=clip;
  clip=null;
  const later=creature();later.prone=true;
  later.avatarRef.frontPlane=null;later.avatarRef.backPlane=null;
  assert.equal(impact.triggerCreature(later,'breakThrow','front'),0);
  assert.equal(later._impactRagdollPlayback,undefined,'cannot claim missing geometry prematurely');
  const front=new Group(),back=new Group();
  later.avatarRef.group.add(front);later.avatarRef.group.add(back);
  later.avatarRef.frontPlane=front;later.avatarRef.backPlane=back;
  assert.equal(impact.updateCreature(later,.016),true);
  assert.equal(later._impactRagdollPlayback.holding,true);
  assert.equal(front.parent,later._impactRagdollPlayback.pivot);
  later.prone=false;impact.updateCreature(later,.016);
  assert.equal(rig.getDebug().activeAbsoluteClaims,0);
  clip=originalClip;
}

console.log('Ragdoll scoped pivot ownership: prone, replacement, live impacts, corpse, and cleanup PASS');
