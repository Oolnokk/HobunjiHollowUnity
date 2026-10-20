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
  multiply(v){this.x*=v.x;this.y*=v.y;this.z*=v.z;return this;}
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
const window={THREE,WorldActionInputClaims:{setClaims:(id,claims)=>inputClaims.set(id,claims),clearClaims:id=>inputClaims.delete(id)},CharacterActionLocks:{acquire(opts){assert.deepEqual(Array.from(opts.participants,p=>p.id),['player','npc:sloomi']);assert(opts.participants[1].channels.includes('pose'),'NPC pose lock uses the shared character participant');return {release(){releaseCount++;}};}},
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
 const pants={depthBiasBase:.25,maskUniforms:{uPantsDepthBias:{value:.25}},setDepthBiasLimit(owner,limit){this.maskUniforms.uPantsDepthBias.value=limit??this.depthBiasBase;},update(){}}; // Verifies action ownership/restoration; the garment module's own limit API is tested separately.
 const legs={pants,group:legGroup,anatomyRevision:()=>revision,replaceFeet(){contact=0;revision++;},get contact(){return contact;},motionAnatomy:()=>['left','right'].map(side=>({side,hip:new Vector3((side==='left'?-1:1)*height*.055,height*.32,0),ankle:new Vector3(0,contact,0),length:height*.32-contact,bend:{x:0,z:0}})),
 applyWorldFootTargets(targets){this.targets={left:targets.left.clone(),right:targets.right.clone()};},update(){}};
 return {root,model,legs,hands,height};
}
vm.runInNewContext(fs.readFileSync('docs/config/character-rig-scale-defaults.js','utf8'),{window});
const authoredScaleCases=[['mao-ao','male','mashtzarr','male'],['nuhongan','female','kenkari','male']].map(([sa,ga,sb,gb])=>{
 const a=window.HobunjiCharacterRigScaleDefaults.scaleFor(sa,ga),b=window.HobunjiCharacterRigScaleDefaults.scaleFor(sb,gb); // Shipped whole-character scales exercise the actual rejected inputs.
 return [1,1,a.x,a.y,b.x,b.y];
}); // Kept alongside neutral, mismatched-height and mirrored fixtures below.
for(const [ha,hb,ax=1,ay=1,bx=1,by=1] of [[1,1],[.8,1.3],[1.3,.8],[.6,1.8],[1.8,.6],[1,1,.9,1.15,1.1,.85],[.8,1.3,1.15,.9,.85,1.2],[1,1,-.9,1.15,1.1,.85],...authoredScaleCases]) {
 const a=actor(ha,0),b=actor(hb,.6),walker={rec:{id:'sloomi'},area:'town',root:b.root,avatarGroup:b.model,legs:b.legs}; // Both orderings cover short and tall support phases.
 a.root.scale.set(ax,ay,Math.abs(ax));b.root.scale.set(bx,by,Math.abs(bx)); // Ordinary independent width/height and PNG-facing reflection.
 const initialScaleA=a.root.scale.clone(),initialScaleB=b.root.scale.clone();
 const initialA=a.root.position.clone(),initialB=b.root.position.clone();
 api.init({getPlayerModel:()=>a.model,getPlayerLegs:()=>a.legs,surfaceY:()=>0,shoulderOffsetH:()=>.7,refreshCamera:()=>cameraRefreshes++});
 assert(api.start(walker,a.root),`start ${ha}/${hb}`);assert(!api.start(walker,a.root),'only one pair owns the actors');
 const shot=activeShot;assert.equal(shot.camera.id,'paired-dance');
 assert.equal(api.diagnostics().shoulderOffsetH,.7,'follow reads the existing horizontal shoulder setting');
 assert.equal(api.cameraButton().inputAction,'action2');
 assert.equal(a.legs.pants.maskUniforms.uPantsDepthBias.value,0,'paired clothing retains physical depth');
 api.update(.05,true,'town');assert.equal(api.elapsedSeconds('sloomi'),0,'pause preserves the transport');
 let previousSupport=null,anchors=null,roles=new Set(); // Support anchors must remain fixed throughout a half-hop.
 for(let i=0;i<480;i++) {
  if(i===120){
   const followDistance=new Vector3().copy(api.diagnostics().cameraPosition).distanceTo(api.diagnostics().cameraTarget); // View switch must zoom out significantly without changing the pair.
   inputClaims.get('paired-dance').find(c=>c.actionId==='action2').onPress();
   assert(api.isActive(),'view input does not cancel the dance');assert.equal(api.diagnostics().cameraMode,'orbit');
   assert.equal(api.cameraButton().label,'Follow view');assert.notStrictEqual(activeShot,shot,'new shot blends through the existing camera owner');
   const before=api.diagnostics();api.update(.05,true,'town');assert.equal(api.diagnostics().orbitAzimuthDeg,before.orbitAzimuthDeg,'paused orbit stays still');
   assert(new Vector3().copy(before.cameraPosition).distanceTo(before.cameraTarget)>followDistance*2,'orbit frames the full pair from farther away');
  }
  if(i===240){assert(api.toggleCameraView());assert.equal(api.diagnostics().cameraMode,'follow');a.legs.replaceFeet();previousSupport=null;}
  const beforeOrbit=api.diagnostics().orbitAzimuthDeg; // Counter-orbit speed is independent of the paired spin.
  api.update(1/60,false,'town');if(api.diagnostics().cameraMode==='orbit')assert(Math.abs(api.diagnostics().orbitAzimuthDeg-beforeOrbit+4/60)<1e-8);assert(api.activeFor('sloomi'),`pair remains anatomically reachable at frame ${i}`);
  const diagnostic=api.diagnostics(),support=diagnostic.actors.findIndex(v=>v.grounded);roles.add(support);
  assert.equal(diagnostic.actors.filter(v=>v.grounded).length,1);
  if(support!==previousSupport){anchors={left:[a,b][support].legs.targets.left.clone(),right:[a,b][support].legs.targets.right.clone()};previousSupport=support;}
  for(const [index,p] of [a,b].entries())for(const side of ['left','right']) {
   const wrist=p.hands.group.getObjectByName(side+'_hand_socket').localToWorld(new Vector3());
   const localWrist=p.root.worldToLocal(wrist.clone()),localShoulder=new Vector3((side==='left'?1:-1)*p.height*.13,p.height*.62,0); // Reach is authored in rig-local units, including a mirrored root.
   assert(localWrist.distanceTo(localShoulder)<=p.height*.4+1e-6,'hand never exceeds this actor’s anatomical arm reach');
   const leg=p.legs.motionAnatomy().find(l=>l.side===side),localFoot=p.root.worldToLocal(p.legs.targets[side].clone());
   assert(localFoot.distanceTo(leg.hip)<=leg.length+1e-6,'nonuniform scale never extends a local leg');
   assert(localFoot.distanceTo(leg.hip)>=leg.length*.72-1e-6,'support stays inside the existing safe knee bend');
   const other=[a,b][1-index].hands.group.getObjectByName((side==='left'?'right':'left')+'_hand_socket').localToWorld(new Vector3());
   assert(wrist.distanceTo(other)<1e-6,'opposite hands share the same world contact');
   if(index===support){assert(p.legs.targets[side].distanceTo(anchors[side])<1e-6,'support feet stay planted');assert(Math.abs(p.legs.targets[side].y-p.legs.contact*p.root.scale.y)<1e-6,'support soles remain at the floor');}
   assert(Number.isFinite(diagnostic.actors[index].neckDeg.pitch));
   assert(Math.abs(diagnostic.actors[index].neckDeg.pitch)<=32+1e-6,'preview pitch bound');
   assert(Math.abs(diagnostic.actors[index].neckDeg.yaw)<=38+1e-6,'preview yaw bound');
  }
  assert.equal(a.hands.applyOwnedPose(),true,'the final hand sync retains paired ownership');
  const eye=b.model.userData.neckRig.neckJoint.localToWorld(new Vector3(0,hb*.05,.006)); // Preview eye-marker landmark, including the solved moving neck.
  if(diagnostic.cameraMode==='follow')assert(shot.camera.targetProvider().distanceTo(eye)<1e-6,'cinematic aims at the exact partner eye landmark');
 }
 assert(a.root.scale.distanceTo(initialScaleA)<1e-9&&b.root.scale.distanceTo(initialScaleB)<1e-9,'dance preserves authored proportions');
 assert.equal(roles.size,2,'both partners alternate supporting and hopping');
 const before=releaseCount;
 api.update(.01,false,'interior');assert(!api.activeFor('sloomi'));assert.equal(releaseCount,before+1);
 assert(a.root.position.distanceTo(initialA)<1e-6&&b.root.position.distanceTo(initialB)<1e-6,'roots restored');
 assert.equal(a.legs.pants.maskUniforms.uPantsDepthBias.value,.25,'ordinary garment foot overlay restored');
 assert.equal(api.cameraButton(),null,'view action disappears after stop');
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

window.SocialActionWheel={isDancing:()=>true};
assert.equal(api.start(cancelWalker,cancelA.root),false);assert.equal(api.diagnostics().lastStartFailure.code,'solo-dance-active');
window.SocialActionWheel={isDancing:()=>false};activeShot={camera:{id:'busy'}};
assert.equal(api.start(cancelWalker,cancelA.root),false);assert.equal(api.diagnostics().lastStartFailure.code,'camera-busy');activeShot=null;
scene.add(cancelB.root);api.init({getPlayerModel:()=>null,getPlayerLegs:()=>cancelA.legs});
assert.equal(api.start(cancelWalker,cancelA.root),false);assert.equal(api.diagnostics().lastStartFailure.actor,'player');assert.equal(api.diagnostics().lastStartFailure.code,'hands-not-ready');

api.init({getPlayerModel:()=>cancelA.model,getPlayerLegs:()=>cancelA.legs});cancelA.root.scale.set(0,1,1);
assert.equal(api.start(cancelWalker,cancelA.root),false);assert.equal(api.diagnostics().lastStartFailure.code,'invalid-rig-scale');
assert.equal(api.diagnostics().lastStartFailure.scale.x,0,'invalid-scale diagnostics expose the actual failed transform');

// Execute the actual game wiring: paired controls take priority over an aimed chair.
{
 const game=fs.readFileSync('docs/game.js','utf8'); // Covers the mobile arch entry point rather than only exported runtime methods.
 const a=game.indexOf('      function computeActionButtonsImpl() {'),b=game.indexOf('\n      // Fallback anchor',a);
 const context=vm.createContext({window:{FestivalWheelDanceRuntime:{isActive:()=>true,cameraButton:()=>({action:'festival_dance_view',inputAction:'action2'})},FestivalSystem:{actionButton:()=>({action:'festival_stop_dance'})}}});
 vm.runInContext(game.slice(a,b),context);
 assert.deepEqual(Array.from(context.computeActionButtonsImpl(),b=>b.action),['festival_stop_dance','festival_dance_view']);
 let injected=null;
 const window={FestivalWheelDanceRuntime:{init:deps=>injected=deps}}; // The ordinary Settings value must reach the follow camera through production injection.
 const init=game.indexOf('      window.FestivalWheelDanceRuntime?.init({');
 vm.runInNewContext(game.slice(init,game.indexOf('\n      });',init)+10),{window,playerAvatarGroup:{},playerLegs:{},s_shoulderSurfOffsetH_current:-.4,refreshActionBar(){},updateCameraPosition(){}});
 assert.equal(injected.shoulderOffsetH(),-.4,'negative left-shoulder offsets are preserved');
}
