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
const clip=recorded();
const window={THREE,ImpactBlendLibrary:{getClip(_bank,_direction){return clip;}}};
const context={window,THREE,console,performance:{now:()=>1000}};
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
  impact.stopCreature(enemy);
  assert.equal(rig.getDebug().activeAbsoluteClaims,0);
}
console.log('Ragdoll scoped pivot ownership: prone, replacement, live impacts, corpse, and cleanup PASS');
