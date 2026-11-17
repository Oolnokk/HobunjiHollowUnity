#!/usr/bin/env node
'use strict';
// Real NPC dance presentation plus shared rig compositor, exercised without WebGL.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class V {
  constructor(x=0,y=0,z=0) { this.set(x,y,z); }
  set(x,y,z) { this.x=x;this.y=y;this.z=z;return this; }
  copy(v) { return this.set(v.x,v.y,v.z); }
  clone() { return new V(this.x,this.y,this.z); }
  distanceToSquared(v) { return (this.x-v.x)**2+(this.y-v.y)**2+(this.z-v.z)**2; }
}
class Q {
  constructor(x=0,y=0,z=0,w=1) { this.set(x,y,z,w);this.isQuaternion=true; }
  set(x,y,z,w) {this.x=x;this.y=y;this.z=z;this.w=w;return this;}
  copy(q) {return this.set(q.x,q.y,q.z,q.w);}
  clone() {return new Q(this.x,this.y,this.z,this.w);}
  dot(q) {return this.x*q.x+this.y*q.y+this.z*q.z+this.w*q.w;}
  multiply(q) {
    const a=this.clone(); // Stable quaternion multiplication for real socket rotateX/rotateZ behavior.
    return this.set(a.x*q.w+a.w*q.x+a.y*q.z-a.z*q.y,
      a.y*q.w+a.w*q.y+a.z*q.x-a.x*q.z,
      a.z*q.w+a.w*q.z+a.x*q.y-a.y*q.x,
      a.w*q.w-a.x*q.x-a.y*q.y-a.z*q.z);
  }
}
class Node {
  constructor(name='node') {
    this.name=name;this.position=new V();this.quaternion=new Q();
    this.userData={};this.parent=null;this.children=[];
  }
  add(child) {if(child.parent)child.parent.remove(child);this.children.push(child);child.parent=this;}
  remove(child) {this.children=this.children.filter(n=>n!==child);child.parent=null;}
  traverse(fn) {fn(this);for(const child of this.children)child.traverse(fn);}
  rotateX(radians) {this.quaternion.multiply(new Q(Math.sin(radians/2),0,0,Math.cos(radians/2)));}
  rotateZ(radians) {this.quaternion.multiply(new Q(0,0,Math.sin(radians/2),Math.cos(radians/2)));}
  updateMatrix() {}
  updateMatrixWorld() {}
}
class Geometry {setAttribute(){} dispose(){}}
class Material {constructor(){this.colorWrite=true;}dispose(){}}
class Mesh extends Node {constructor(geometry,material){super('sentinel');this.geometry=geometry;this.material=material;}}
const THREE={BufferGeometry:Geometry,Float32BufferAttribute:class {},MeshBasicMaterial:Material,Mesh};
let tick=null,locked=false; // Real production timer is intercepted to drive it deterministically in the test.
let walkers=[]; // Supplied through the real NpcActivityPlanner.init injection.
const window={
  THREE,
  NpcActivityPlanner:{init(){}},
  NpcCharacterState:{participantId:id=>'npc:'+id},
  CharacterActionLocks:{isLocked(_id,channel){return locked&&channel==='pose';}},
  SocialRhythmClock:{dancerBeatAt(){return .25;}},
  setInterval(callback){tick=callback;},
  setTimeout(){}, // Tick is advanced explicitly after injecting the walker list.
};
const ctx={window,console,performance:{now:()=>1000}};
vm.runInNewContext(fs.readFileSync('docs/js/rig-transform-layers.js','utf8'),ctx);
vm.runInNewContext(fs.readFileSync('docs/js/npc-dance-presentation-runtime.js','utf8'),ctx);
const compositor=window.ActorRigCompositor;
const root=new Node('npc-root'),handGroup=new Node('npc-hands');
root.add(handGroup);
function socket(side,x) {const n=new Node(side+'_hand_socket');n.position.set(x,1,0);handGroup.add(n);return n;}
const left=socket('left',-.2),right=socket('right',.2);
const rig={group:handGroup,armLengthForSide(){return .3;}};
const walker={rec:{id:'npc1'},root,avatarGroup:{userData:{proceduralHandRig:rig}},
  state:'idle',currentScheduleTarget:{socialAncestorCeremony:{stimulusId:'ancestor',armStyle:'overhead-punch'}}};
walkers=[walker];
window.NpcActivityPlanner.init({getCurrentArea(){return 'town';},listNpcWalkersInArea(){return walkers;}});
assert.equal(typeof tick,'function');
tick();
const sentinel=root.children.find(node=>node.name==='npc1_npc_dance_hand_sync');
assert(sentinel?.onBeforeRender,'real render sentinel is installed on the original NPC root');
sentinel.onBeforeRender();
assert.equal(compositor.getDebug().activeAbsoluteClaims,4,'two real hand sockets own their position/quaternion through shared overlays');
const baseline=left.position.y,baselineQuat=left.quaternion.clone(); // Captured output of the first ceremony hand-pose render.
for(let repeat=0;repeat<12;repeat++) {
  sentinel.onBeforeRender();
  assert(Math.abs(left.position.y-baseline)<1e-9,'secondary renderer passes must not stack hand height');
  assert(Math.abs(Math.abs(left.quaternion.dot(baselineQuat))-1)<1e-9,'secondary renderer passes must not stack hand rotation');
}
walker.currentScheduleTarget=null;sentinel.onBeforeRender();
assert.equal(compositor.getDebug().activeAbsoluteClaims,0,'leaving the ceremony releases both hand overlays');
assert(Math.abs(left.position.y-1)<1e-9,'clean author baseline is restored on cancellation');
walker.currentScheduleTarget={socialAncestorCeremony:{stimulusId:'ancestor',armStyle:'overhead-punch'}};
left.position.y=1.4;right.position.y=1.4; // Ordinary hand solver publishes a fresh neutral standing pose.
sentinel.onBeforeRender();const refreshed=left.position.y;
assert(refreshed>1.4,'the presentation samples the current underlying hand base');
walker.currentScheduleTarget=null;sentinel.onBeforeRender();
assert(Math.abs(left.position.y-1.4)<1e-9,'returning from dance restores the NEW hand baseline');
walker.currentScheduleTarget={socialAncestorCeremony:{stimulusId:'ancestor',armStyle:'overhead-punch'}};
sentinel.onBeforeRender();
locked=true;sentinel.onBeforeRender();
assert.equal(compositor.getDebug().activeAbsoluteClaims,0,'exclusive paired pose suppresses NPC dance hand ownership');
locked=false;
tick(); // A spawned/simulated NPC keeps only its active rig generation.
assert.equal(window.NpcDancePresentationRuntime.getDebug('npc1').compositorOwner,'legacy-preview');
walkers=[];tick();
assert.equal(compositor.getDebug().activeAbsoluteClaims,0,'despawn disposes all scoped socket claims');
console.log('NPC dance hand overlay: repeated draws, new grip baselines, cancellation, locks and despawn PASS');
