#!/usr/bin/env node
'use strict';
// Executes the shipped two-avatar Festival Wheel Dance against minimal Three-compatible
// vector/quaternion objects. No WebGL or browser environment required.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
class Vector3 {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  clone(){return new Vector3(this.x,this.y,this.z);}
  copy(v){return this.set(v.x,v.y,v.z);}
  add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this;}
  sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this;}
  multiplyScalar(s){this.x*=s;this.y*=s;this.z*=s;return this;}
  length(){return Math.hypot(this.x,this.y,this.z);}
  distanceTo(v){return Math.hypot(this.x-v.x,this.y-v.y,this.z-v.z);}
  lerp(v,t){this.x+=(v.x-this.x)*t;this.y+=(v.y-this.y)*t;this.z+=(v.z-this.z)*t;return this;}
  toArray(){return [this.x,this.y,this.z];}
  applyQuaternion(q){
    const {x,y,z}=this,{x:qx,y:qy,z:qz,w:qw}=q;
    const ix=qw*x+qy*z-qz*y,iy=qw*y+qz*x-qx*z,iz=qw*z+qx*y-qy*x,iw=-qx*x-qy*y-qz*z;
    return this.set(ix*qw+iw*-qx+iy*-qz-iz*-qy,iy*qw+iw*-qy+iz*-qx-ix*-qz,iz*qw+iw*-qz+ix*-qy-iy*-qx);
  }
}
class Quaternion {
  constructor(x=0,y=0,z=0,w=1){this.x=x;this.y=y;this.z=z;this.w=w;}
  clone(){return new Quaternion(this.x,this.y,this.z,this.w);}
  copy(q){Object.assign(this,q);return this;}
  identity(){return this.copy({x:0,y:0,z:0,w:1});}
  invert(){this.x=-this.x;this.y=-this.y;this.z=-this.z;return this;}
  setFromAxisAngle(a,r){const s=Math.sin(r/2);return this.copy({x:a.x*s,y:a.y*s,z:a.z*s,w:Math.cos(r/2)});}
  multiply(q){
    const a=this,b=q;
    const result={
      x:a.x*b.w+a.w*b.x+a.y*b.z-a.z*b.y,
      y:a.y*b.w+a.w*b.y+a.z*b.x-a.x*b.z,
      z:a.z*b.w+a.w*b.z+a.x*b.y-a.y*b.x,
      w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z,
    }; return this.copy(result);
  }
}

class Node {
  constructor(){this.position=new Vector3();this.quaternion=new Quaternion();this.scale=new Vector3(1,1,1);this.children=[];this.userData={};this.rotation={x:0,y:0,z:0,set:(x,y,z)=>{Object.assign(this.rotation,{x,y,z});const c1=Math.cos(x/2),c2=Math.cos(y/2),c3=Math.cos(z/2),s1=Math.sin(x/2),s2=Math.sin(y/2),s3=Math.sin(z/2);this.quaternion.copy({x:s1*c2*c3+c1*s2*s3,y:c1*s2*c3-s1*c2*s3,z:c1*c2*s3+s1*s2*c3,w:c1*c2*c3-s1*s2*s3});}};}
  add(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}}
  getObjectByName(name){if(this.name===name)return this;for(const child of this.children){const found=child.getObjectByName(name);if(found)return found;}return null;}
  updateWorldMatrix(){} updateMatrix(){}
  getWorldScale(out){out.copy(this.scale);for(let n=this.parent;n;n=n.parent){out.x*=n.scale.x;out.y*=n.scale.y;out.z*=n.scale.z;}return out;}
  getWorldQuaternion(out){out.copy(this.quaternion);if(this.parent){const parent=this.parent.getWorldQuaternion(new Quaternion());out.copy(parent.multiply(out.clone()));}return out;}
  localToWorld(out){out.x*=this.scale.x;out.y*=this.scale.y;out.z*=this.scale.z;out.applyQuaternion(this.quaternion).add(this.position);return this.parent?this.parent.localToWorld(out):out;}
  worldToLocal(out){if(this.parent)this.parent.worldToLocal(out);out.sub(this.position).applyQuaternion(this.quaternion.clone().invert());out.x/=this.scale.x;out.y/=this.scale.y;out.z/=this.scale.z;return out;}
}
const THREE={Vector3,Quaternion}; // Minimal transforms validate the production choreography independently of WebGL/assets.
const inputClaims=new Map(); // Cancellation stays on the existing physical input-claim route.
let releaseCount=0,activeShot=null,cameraRefreshes=0; // Existing game owners, injected without a second camera or update loop.
const window={THREE,WorldActionInputClaims:{setClaims:(id,claims)=>inputClaims.set(id,claims),clearClaims:id=>inputClaims.delete(id)},CharacterActionLocks:{acquire(opts){assert.deepEqual(Array.from(opts.participants,p=>p.id),['player','sloomi']);return {release(){releaseCount++;}};}},
 CinematicCameraRuntime:{isActive:()=>!!activeShot,activeRecord:()=>activeShot,activate(_area,shot){activeShot={camera:shot};return activeShot;},deactivate(){activeShot=null;}}};
vm.runInNewContext(fs.readFileSync('docs/js/festival-wheel-dance-runtime.js','utf8'),{window,console});
const api=window.FestivalWheelDanceRuntime,scene=new Node(); // Real public lifecycle under test.
function actor(height,x){
 const root=new Node(),model=new Node(),neck=new Node(),handGroup=new Node(),legGroup=new Node(); // Per-instance anatomy and cached procedural owners.
 root.position.x=x;scene.add(root);root.add(model,handGroup,legGroup);model.add(neck);neck.position.y=height*.8;
 model.userData={speciesId:'fixture',gender:'female',neckRig:{neckJoint:neck,neckLocal:{x:0,y:height*.8,z:0},headCentroidLocal:{x:0,y:height*.85,z:0}}};
 for(const side of ['left','right']){const socket=new Node();socket.name=side+'_hand_socket';handGroup.add(socket);}
 let provider=null; // The ordinary hand driver's provider is invoked again below to exercise final-sync ownership.
 const hands={group:handGroup,parent:root,shoulderPositionLocal:(side,out)=>out.set((side==='left'?1:-1)*height*.13,height*.62,0),armLengthForSide:()=>height*.4,
 setPoseProvider(_owner,fn){provider=fn;},applyOwnedPose(){provider?.();return !!provider;},applyToolCalibration(){},useIdlePose(){}};
 model.userData.proceduralHandRig=hands;
 let contact=.02,revision=0; // Simulates a late fallback-to-GLB sole/stance readiness change.
 const legs={group:legGroup,anatomyRevision:()=>revision,replaceFeet(){contact=0;revision++;},get contact(){return contact;},motionAnatomy:()=>['left','right'].map(side=>({side,hip:new Vector3((side==='left'?-1:1)*height*.055,height*.32,0),ankle:new Vector3(0,contact,0),length:height*.32-contact,bend:{x:0,z:0}})),
 applyWorldFootTargets(targets){this.targets={left:targets.left.clone(),right:targets.right.clone()};},update(){}};
 return {root,model,legs,hands,height};
}
for(const [ha,hb] of [[1,1],[.8,1.3],[1.3,.8],[.6,1.8],[1.8,.6]]) {
 const a=actor(ha,0),b=actor(hb,.6),walker={rec:{id:'sloomi'},area:'town',root:b.root,avatarGroup:b.model,legs:b.legs}; // Both orderings cover short and tall support phases.
 const initialA=a.root.position.clone(),initialB=b.root.position.clone();
 api.init({getPlayerModel:()=>a.model,getPlayerLegs:()=>a.legs,surfaceY:()=>0,refreshCamera:()=>cameraRefreshes++});
 assert(api.start(walker,a.root),`start ${ha}/${hb}`);assert(!api.start(walker,a.root),'only one pair owns the actors');
 const shot=activeShot;assert.equal(shot.camera.id,'paired-dance');
 api.update(.05,true,'town');assert.equal(api.elapsedSeconds('sloomi'),0,'pause preserves the transport');
 let previousSupport=null,anchors=null,roles=new Set(); // Support anchors must remain fixed throughout a half-hop.
 for(let i=0;i<480;i++) {
  if(i===240){a.legs.replaceFeet();previousSupport=null;}
  api.update(1/60,false,'town');assert(api.activeFor('sloomi'),`pair remains anatomically reachable at frame ${i}`);
  const diagnostic=api.diagnostics(),support=diagnostic.actors.findIndex(v=>v.grounded);roles.add(support);
  assert.equal(diagnostic.actors.filter(v=>v.grounded).length,1);
  if(support!==previousSupport){anchors={left:[a,b][support].legs.targets.left.clone(),right:[a,b][support].legs.targets.right.clone()};previousSupport=support;}
  for(const [index,p] of [a,b].entries())for(const side of ['left','right']) {
   const wrist=p.hands.group.getObjectByName(side+'_hand_socket').localToWorld(new Vector3());
   const shoulder=p.root.localToWorld(new Vector3((side==='left'?1:-1)*p.height*.13,p.height*.62,0));
   assert(wrist.distanceTo(shoulder)<=p.height*.4+1e-6,'hand never exceeds this actor’s anatomical arm reach');
   const other=[a,b][1-index].hands.group.getObjectByName((side==='left'?'right':'left')+'_hand_socket').localToWorld(new Vector3());
   assert(wrist.distanceTo(other)<1e-6,'opposite hands share the same world contact');
   if(index===support){assert(p.legs.targets[side].distanceTo(anchors[side])<1e-6,'support feet stay planted');assert(Math.abs(p.legs.targets[side].y-p.legs.contact)<1e-6,'support soles remain at the floor');}
   assert(Number.isFinite(diagnostic.actors[index].neckDeg.pitch));
   assert(Math.abs(diagnostic.actors[index].neckDeg.pitch)<=32+1e-6,'preview pitch bound');
   assert(Math.abs(diagnostic.actors[index].neckDeg.yaw)<=38+1e-6,'preview yaw bound');
  }
  assert.equal(a.hands.applyOwnedPose(),true,'the final hand sync retains paired ownership');
  const eye=b.model.userData.neckRig.neckJoint.localToWorld(new Vector3(0,hb*.05,.006)); // Preview eye-marker landmark, including the solved moving neck.
  assert(shot.camera.targetProvider().distanceTo(eye)<1e-6,'cinematic aims at the exact partner eye landmark');
 }
 assert.equal(roles.size,2,'both partners alternate supporting and hopping');
 const before=releaseCount;
 api.update(.01,false,'interior');assert(!api.activeFor('sloomi'));assert.equal(releaseCount,before+1);
 assert(a.root.position.distanceTo(initialA)<1e-6&&b.root.position.distanceTo(initialB)<1e-6,'roots restored');
 assert.equal(a.hands.applyOwnedPose(),false,'hand owner released');assert.equal(activeShot,null,'camera released');assert.equal(api.stop(),false);assert.equal(inputClaims.size,0,'cancel claims released');
}
assert(cameraRefreshes>0,'paired pose refreshes the existing cinematic camera owner');
assert(Math.abs(api.sample(.25).tilt-22*Math.PI/180)<1e-6,'preview rhythm retained');
console.log('Paired dance: size-aware reach, coincident hands, planted support, alternating hops, preview gaze/camera, pause and cleanup passed.');

const cancelA=actor(1,0),cancelB=actor(1,.5),cancelWalker={rec:{id:'sloomi'},area:'town',root:cancelB.root,avatarGroup:cancelB.model,legs:cancelB.legs}; // Cleanup also covers explicit input and camera takeover.
api.init({getPlayerModel:()=>cancelA.model,getPlayerLegs:()=>cancelA.legs});assert(api.start(cancelWalker,cancelA.root));
inputClaims.get('paired-dance').find(c=>c.actionId==='dodge').onPress();assert(!api.isActive());assert.equal(activeShot,null);
assert(api.start(cancelWalker,cancelA.root));const replacementShot={camera:{id:'new-cutscene'}};activeShot=replacementShot;api.update(.01,false,'town');
assert.equal(api.isActive(),false);assert.strictEqual(activeShot,replacementShot,'a new cinematic owner is preserved');activeShot=null;
assert(api.start(cancelWalker,cancelA.root));cancelB.root.parent=null;api.update(.01,false,'town');assert(!api.isActive(),'unloaded partner releases all owners');
