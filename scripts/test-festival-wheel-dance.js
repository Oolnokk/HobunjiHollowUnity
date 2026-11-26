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
vm.runInNewContext(fs.readFileSync('docs/js/rig-transform-layers.js','utf8'),{window,console}); // Standalone workshop and game share the scoped absolute rig owner.
vm.runInNewContext(fs.readFileSync('docs/js/festival-wheel-dance-runtime.js','utf8'),{window,console});
const api=window.FestivalWheelDanceRuntime,scene=new Node(); // Real public lifecycle under test.
window.NpcSocialInhibition={getDebug:()=>({poseOwnedSkips:7})}; // Existing mobile Pixel Probe should expose the actual late-render suppression count.
assert.equal(api.diagnostics().suppressedNpcSocialRenderFrames,7,'paired dance debug reports skipped legacy NPC social render frames');
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
 const shot=activeShot;assert.equal(shot.camera.id,'paired-dance-orbit','the initial shot shows both dancers');
 assert.equal(api.diagnostics().cameraMode,'orbit','paired dance begins in the wide full-pair view');
 assert.equal(api.cameraButton().inputAction,'action2');
 assert.equal(a.legs.pants.maskUniforms.uPantsDepthBias.value,0,'paired clothing retains physical depth');
 api.update(.05,true,'town');assert.equal(api.elapsedSeconds('sloomi'),0,'pause preserves the transport');
 let previousSupport=null,anchors=null,roles=new Set(); // Support anchors must remain fixed throughout a half-hop.
 for(let i=0;i<480;i++) {
  if(i===120){
   const orbitDistance=new Vector3().copy(api.diagnostics().cameraPosition).distanceTo(api.diagnostics().cameraTarget); // The initial camera reveals both actors.
   inputClaims.get('paired-dance').find(c=>c.actionId==='action2').onPress();
   assert(api.isActive(),'view input does not cancel the dance');assert.equal(api.diagnostics().cameraMode,'follow');assert.equal(api.diagnostics().shoulderOffsetH,.7);
   assert.equal(api.cameraButton().label,'Orbit view');assert.notStrictEqual(activeShot,shot,'new shot blends through the existing camera owner');
   const before=api.diagnostics();api.update(.05,true,'town');assert.equal(api.diagnostics().orbitAzimuthDeg,before.orbitAzimuthDeg,'paused orbit stays still');
   assert(new Vector3().copy(before.cameraPosition).distanceTo(before.cameraTarget)<orbitDistance*.7,'the close follow camera is nearer than the full-pair orbit');
  }
  if(i===240){assert(api.toggleCameraView());assert.equal(api.diagnostics().cameraMode,'orbit');a.legs.replaceFeet();previousSupport=null;}
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
  if(diagnostic.cameraMode==='follow')assert(activeShot.camera.targetProvider().distanceTo(eye)<1e-6,'cinematic aims at the exact partner eye landmark');
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
// The real world loop repositions the player/NPC roots and may return their facing/neck to idle
// between the paired solver's frames. These are expected native baselines, not a new cutscene.
{
  const a=actor(1,0),b=actor(1,.6),walker={rec:{id:'sloomi'},area:'town',root:b.root,avatarGroup:b.model,legs:b.legs};
  const initialA=a.root.position.clone(),initialB=b.root.position.clone(); // Logical world coordinates remain fixed while dance visuals orbit.
  const facingA=a.root.quaternion.clone(),facingB=b.root.quaternion.clone(); // Normal actor-facing reset should be accepted by this exclusive dance.
  const idleNeck=b.model.userData.neckRig.neckJoint.quaternion.clone(); // Ordinary NPC head/look update can reset to idle between frames.
  api.init({getPlayerModel:()=>a.model,getPlayerLegs:()=>a.legs,surfaceY:()=>0});
  assert(api.start(walker,a.root));
  a.root.position.copy(initialA);b.root.position.copy(initialB);
  a.root.quaternion.copy(facingA);b.root.quaternion.copy(facingB);
  b.model.userData.neckRig.neckJoint.quaternion.copy(idleNeck);
  api.update(1/60,false,'town');
  assert(api.activeFor('sloomi'),'expected player/NPC position and facing resets do not cancel the pair');
  assert(api.diagnostics().nativeResets>=3,'mobile dance diagnostics count native animation handoffs');
  a.root.position.copy(initialA); // Engine may reset logical player position directly before a cancellation.
  assert(api.stop('player-canceled'));
  assert(Math.abs(a.root.quaternion.w-facingA.w)<1e-8,'a mid-handoff cancel still removes the authored root tilt');
  assert(b.root.position.distanceTo(initialB)<1e-8,'uninterrupted NPC root returns to its original position');
  assert(Math.abs(b.model.userData.neckRig.neckJoint.quaternion.w-idleNeck.w)<1e-8,'paired head gaze releases normally');
  assert.equal(window.ActorRigCompositor.getDebug().activeAbsoluteClaims,0,'all claims release after normal world-loop resets');
}
// Regression: severe height mismatch may briefly prevent a shared hand contact, not cancel the dance.
{
 const tiny=actor(.35,0),tall=actor(2.35,.6),walker={rec:{id:'sloomi'},area:'town',root:tall.root,avatarGroup:tall.model,legs:tall.legs};
 const p=tiny.root.position.clone(),n=tall.root.position.clone();
 api.init({getPlayerModel:()=>tiny.model,getPlayerLegs:()=>tiny.legs,surfaceY:()=>0});
 assert(api.start(walker,tiny.root),'very different heights still begin a dance');
 for(let frame=0;frame<240;frame++){
  api.update(1/60,false,'town');
  assert(api.activeFor('sloomi'),`an unreachable shared wrist must not interrupt dance at frame ${frame}`);
 }
 assert(api.diagnostics().reachFallbacks>0,'diagnostics report fallback when arm spheres cannot intersect');
 assert(api.diagnostics().unjoinedHandFrames>0,'unreachable frames clamp each partner wrist separately');
 assert(api.stop('player-canceled'));
 assert(tiny.root.position.distanceTo(p)<1e-6&&tall.root.position.distanceTo(n)<1e-6,'both roots recover their starting positions');
 assert(Math.abs(tiny.root.quaternion.w-1)<1e-8&&Math.abs(tall.root.quaternion.w-1)<1e-8,'neither body remains tilted after stop');
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

// A newer absolute animation must survive cancellation of an interrupted paired dance.
{
 const newA=actor(1,0),newB=actor(1,.6),newWalker={rec:{id:'sloomi'},area:'town',root:newB.root,avatarGroup:newB.model,legs:newB.legs};
 const beforeB=newB.root.position.clone(); // The untouched partner's base is still restored.
 api.init({getPlayerModel:()=>newA.model,getPlayerLegs:()=>newA.legs,surfaceY:()=>0});
 assert(api.start(newWalker,newA.root),'scoped action acquires both rigs');
 assert.equal(api.diagnostics().poseOwnership,'actor-rig-compositor');
 const replacement=newA.root.position.clone().add(new Vector3(1.3,0,-.4)); // A newer teleport/animation owner takes over one claimed transform.
 newA.root.position.copy(replacement);
 api.update(.016,false,'town');
 assert(!api.isActive(),'an unexpected absolute owner stops the previous dance');
 assert.equal(api.diagnostics().lastStopReason,'pose-owner-taken-over');
 assert(newA.root.position.distanceTo(replacement)<1e-8,'newer root position must survive delayed cleanup');
 assert(Math.abs(newA.root.quaternion.w-1)<1e-8,'a displaced root must not retain the authored backward lean if its rotation was untouched');
 assert(newB.root.position.distanceTo(beforeB)<1e-8,'the untouched partner returns to the pre-dance pose');
 assert.equal(window.ActorRigCompositor.getDebug().activeAbsoluteClaims,0,'all paired ownership claims release after takeover');
 assert(api.start(newWalker,newA.root),'a replacement action may acquire the released rigs');
 const neckReplacement=newB.model.userData.neckRig.neckJoint;
 neckReplacement.quaternion.setFromAxisAngle(new Vector3(1,0,0),.41);
 const preservedNeck=neckReplacement.quaternion.clone(); // A newer scripted gaze replaces just the neck while the dance is active.
 assert(api.stop('script-took-over'),'explicit cancellation releases every surviving claim');
 assert(Math.abs(neckReplacement.quaternion.x-preservedNeck.x)<1e-8,'newer neck rotation survives delayed paired cleanup');
 assert.equal(window.ActorRigCompositor.getDebug().activeAbsoluteClaims,0,'no residual absolute owner after normal cancel');
}

window.CharacterActionLocks.isLocked=(id,channel)=>id==='player'&&channel==='movement';
assert.equal(api.start(cancelWalker,cancelA.root),false,'paired dance respects calendar/shared movement ownership');
assert.equal(api.diagnostics().lastStartFailure.code,'player-busy');
delete window.CharacterActionLocks.isLocked;
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
 // Verify the player avatar and feet share the world root used by the festival system.
 assert(game.includes('playerMesh.add(avatarGroup);'),'the rendered player portrait is a child of the real world root');
 assert(game.includes('getPlayerMesh: () => playerMesh, // Passes the real player avatar root'),'festival injection supplies that same world root');
 assert(game.includes("window.CharacterActionLocks?.isLocked?.('player', 'pose') === true"),'ordinary player mesh update respects paired pose ownership');
 assert(game.includes('window.FestivalWheelDanceRuntime?.isPartner?.(w)'),'ordinary NPC walker update skips the paired partner');
 const choreographyUpdate='window.FestivalWheelDanceRuntime?.update?.(dt,worldPaused(),currentArea);'; // The sole paired pose commit point before rendering.
 const choreographyOffset=game.indexOf(choreographyUpdate); // Prevent an update-order regression that could hide only the player's dance.
 assert(choreographyOffset>game.indexOf('function updatePlayerMesh(dt)'), 'paired pose runs after the player mesh update function is defined');
 assert(game.lastIndexOf("window.RuntimeFrameScheduler.checkpoint('pre-render');",choreographyOffset)<choreographyOffset,'paired dance must run AFTER ordinary pre-render subscribers');
 assert(game.indexOf('renderWorldPasses(now);',choreographyOffset)>choreographyOffset,'paired dance must run BEFORE the actual world render');
 const a=game.indexOf('      function computeActionButtonsImpl(context = null) {'),b=game.indexOf('\n      // Fallback anchor',a);
 const context=vm.createContext({window:{FestivalWheelDanceRuntime:{isActive:()=>true,cameraButton:()=>({action:'festival_dance_view',inputAction:'action2'})},FestivalSystem:{actionButton:()=>({action:'festival_stop_dance'})}}});
 vm.runInContext(game.slice(a,b),context);
 assert.deepEqual(Array.from(context.computeActionButtonsImpl(),b=>b.action),['festival_stop_dance','festival_dance_view']);
 let injected=null;
 const window={FestivalWheelDanceRuntime:{init:deps=>injected=deps}}; // The ordinary Settings value must reach the follow camera through production injection.
 const init=game.indexOf('      window.FestivalWheelDanceRuntime?.init({');
 vm.runInNewContext(game.slice(init,game.indexOf('\n      });',init)+10),{window,playerAvatarGroup:{},playerLegs:{},s_shoulderSurfOffsetH_current:-.4,refreshActionBar(){},updateCameraPosition(){}});
 assert.equal(injected.shoulderOffsetH(),-.4,'negative left-shoulder offsets are preserved');
}

// Real input ownership suppresses repeats and survives replacing clothing mid-action.
{
 cancelA.root.scale.set(1,1,1);
 api.init({getPlayerModel:()=>cancelA.model,getPlayerLegs:()=>cancelA.legs});
 vm.runInNewContext(fs.readFileSync('docs/js/world-action-input-claims.js','utf8'),{window,console});
 assert(api.start(cancelWalker,cancelA.root));
 const input=window.WorldActionInputClaims,oldPants=cancelA.legs.pants; // The production claim owner must pair each press/release.
 assert(input.dispatch('action2','press'));assert.equal(api.diagnostics().cameraMode,'follow');
 assert(input.dispatch('action2','press'));assert.equal(api.diagnostics().cameraMode,'follow','held input does not toggle repeatedly');
 input.dispatch('action2','release');input.dispatch('action2','press');assert.equal(api.diagnostics().cameraMode,'orbit');input.dispatch('action2','release');
 const replacement=actor(1,0).legs.pants; // A wardrobe refresh replaces the handle while the action still owns its depth cap.
 cancelA.legs.pants=replacement;api.update(.01,false,'town');
 assert.equal(oldPants.maskUniforms.uPantsDepthBias.value,.25,'replaced garment releases its cap');
 assert.equal(replacement.maskUniforms.uPantsDepthBias.value,0,'new garment gets physical depth');
 input.dispatch('action1','press');assert(!api.isActive());assert.equal(replacement.maskUniforms.uPantsDepthBias.value,.25);
 assert(input.dispatch('action1','release'),'stop consumes its matching release after clearing claims');
 assert.equal(input.snapshot().pressed.length,0);assert.equal(input.snapshot().claims.length,0);
}
