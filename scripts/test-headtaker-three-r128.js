'use strict';
// Regression for the project's Three.js r128 renderer (no removeFromParent).
// Exercises the actual Headtaker + Combat.attach code through the full throw.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Vector3 {
  constructor(x=0,y=0,z=0) { this.set(x,y,z); }
  set(x,y,z) { Object.assign(this,{x,y,z}); return this; }
  copy(p) { return this.set(p.x,p.y,p.z); }
  clone() { return new Vector3(this.x,this.y,this.z); }
}
let disposalCount=0;
class Object3D {
  constructor() {
    this.position=new Vector3();this.rotation={x:0,y:0,z:0};
    this.userData={};this.children=[];this.parent=null;this.visible=true;
  }
  add(child) { child.parent=this;this.children.push(child); }
  remove(child) { child.parent=null;this.children=this.children.filter(c=>c!==child); }
  getWorldPosition(out) { return out.copy(this.position); }
  updateWorldMatrix() {}
  localToWorld(point) { return point; }
  traverse() {}
}
class Geometry {
  dispose() { disposalCount++; }
  setAttribute(name,value) { (this.attributes ||= {})[name]=value; }
}
class Material {
  constructor(options) { Object.assign(this,options); }
  dispose() { disposalCount++; }
}
class Mesh extends Object3D {
  constructor(geometry,material) { super();this.geometry=geometry;this.material=material; }
}
class CanvasTexture {
  dispose() { disposalCount++; }
}
const THREE={
  Vector3,Quaternion:class {},Group:Object3D,Mesh,Points:Mesh,
  RingGeometry:Geometry,PlaneGeometry:Geometry,BufferGeometry:Geometry,
  BufferAttribute:class { constructor(array,size) { this.array=array;this.itemSize=size; } },
  MeshBasicMaterial:Material,PointsMaterial:Material,CanvasTexture,
  DoubleSide:2,SRGBColorSpace:'sRGB',
};
const scene=new Object3D();
const enemyGroup=new Object3D(),hostGroup=new Object3D();
hostGroup.userData.neckRig = {
  available:true,headCentroidPx:{x:100,y:30},
  headBoundsPx:{left:35,right:150,top:14,bottom:65},
  spineBase:{x:.1,y:.1},spinePosteriorY:-.48, // Neck-base and posterior are deliberately far apart: use node 0 for the RIGHT foot.
}; // Target anatomy fixture: separately resolved skull edges, spine and left shoulder.
scene.add(enemyGroup);scene.add(hostGroup);
hostGroup.position.y=0.5; // Victim's entity origin is not the portrait's visible vertical midpoint.
const footSamples=[];
const handSamples={};
const footOptions=[]; // The Headtaker alone must request extended portrait reach from leg IK.
let gripProvider=null;
const frontCanvas={
  width:200,height:200,getContext() { return { drawImage(){},clearRect(){} }; },
};
const document={
  createElement(type) {
    assert.equal(type,'canvas');
    return { width:0,height:0,getContext() { return { drawImage(){},clearRect(){} }; } };
  },
};
const player={x:10000,y:10000,health:100};
const target={
  isBandit:true,x:0,y:0,health:500,facing:0,
  avatarRef:{
    group:hostGroup,frontCanvas,backCanvas:frontCanvas,
    profile:{name:'fixture'},modelWidth:1,modelHeight:1.5,
    frontPlane:{rotation:{y:Math.PI/2},isSkinnedMesh:true,updateWorldMatrix(){},onBeforeRender(){},
      getWorldPosition(out){return out.set(hostGroup.position.x,hostGroup.position.y+.22,hostGroup.position.z);},
      getWorldDirection(out){return out.set(Math.SQRT1_2,0,Math.SQRT1_2);}}, // Visible geometric centre and normal are independent of body root origin.
    handRigAvatarRoot:{userData:{
      proceduralHandRig:{shoulderPositionLocal(side,out){assert.equal(side,'left');return out.set(-.3,.2,0);}},
      proceduralHandParent:{updateWorldMatrix(){},localToWorld(point){return point;}},
    }},
    headScaleJoint:{front:{scale:new Vector3(1,1,1),position:new Vector3()}}, // Real neck joint confirms fast-up/slow-back timing.
    neckJoint:{front:{rotation:{x:.03,y:.4,z:0},userData:{}},back:{rotation:{x:-.05,y:-.2,z:0},userData:{}}}, // Both card bones must stop tracking independently but restore their exact old angles.
    backPlane:{isSkinnedMesh:true,updateWorldMatrix(){},localToWorld(point){return point;},worldToLocal(point){return point;}},
  },
};
const enemy={
  isMaskboundGuardian:true,maskboundTroop:'headtaker',
  x:-50,y:0,health:500,attackCooldownT:0,facing:0,
  def:{chaseSpeed:180},scene,
  avatarRef:{
    group:enemyGroup,armLength:0.8,halfHeight:0.45,modelHeight:0.9,legs:{setExternalFootTargets(points,options){if(points){footSamples.push({left:points.left.clone(),right:points.right.clone()});footOptions.push(options);}}},
    frontPlane:{rotation:{y:Math.PI/2},getWorldPosition(out){return out.set(enemyGroup.position.x,enemyGroup.position.y+.13,enemyGroup.position.z);}}, // Attacker's portrait midpoint is 0.13 above the group root.
    backPlane:{rotation:{y:-Math.PI/2}},
    legsPivot:{rotation:{y:0}},
    handRigAvatarRoot:{userData:{proceduralHandRig:{
      setPoseProvider(_owner,fn){gripProvider=fn;},
      placeHandWorld(side,position){handSamples[side]=position.clone();},
    }}},
  },
};
let kills=0;
const combat={
  deps:{
    TILE:55,player,worldSurfaceY:()=>0,activeSurfaceYAtWorld:()=>0,
    getActorWorldY:()=>.5,damageCreature(host,amount){kills++;host.health-=amount;},
  },
  animalAttacks:{register(){}},
};
const ctx={
  window:null,document,console,Math,THREE,Combat:combat,
  BanditCombat:{updateCombatAI(){},updateToolMesh(){}},
  PNGPlaneAvatar:{resolveSkinnedPixelWorldPosition(_root,pixel,out){const lateral=pixel.x/200-.5;return out.set(lateral*Math.SQRT1_2,(.5-pixel.y/200)*1.5,-lateral*Math.SQRT1_2); /* Same rotated skin plane as head-bound grips. */}},
  NpcAvatarPreview:{async renderProfileToCanvas(){}},
  HobunjiCharacterSpine:{layoutFor(_x,_y,_h,posterior){return {nodes:[{x:0,y:posterior}]};}}, // The live spline's posterior endpoint is pinned to x=0.
};
ctx.window=ctx;
vm.createContext(ctx);
for (const path of [
  'docs/js/combat/combat-attach.js',
  'docs/js/combat/combat-maskbound-headtaker.js',
]) vm.runInContext(fs.readFileSync(path,'utf8'),ctx,{filename:path});
const api=ctx.MaskboundHeadtaker;
const beforeNeckDraw = target.avatarRef.frontPlane.onBeforeRender; // Scoped render hook must be restored after dodge/kill.
const contains=name=>scene.children.some(object=>object.name===name);
(async()=>{
  api.update(enemy,.05,target);
  assert(contains('maskbound_skyfall_one_tile_aoe'), 'landing ring is shown');
  assert.equal(api.tuning.descentS,0.56,'skyfall descent has a dedicated, visible transition');
  assert(api.tuning.skyHeight>9,'Headtaker enters above the visible camera');
  for(let i=0;i<12;i++)api.update(enemy,.05,target); // Pass the unseen apex into the opening of the descent.
  target.x=20; hostGroup.position.x=target.x/55; // Move the visible target portrait as well as its collision centre.
  for(let i=0;i<6;i++)api.update(enemy,.05,target);
  const pose=ctx.Combat.attach.poseFor(enemy,api.id,target); // Shared attachment resolver, not a duplicate height formula.
  assert(enemy.x>Math.min(0,pose.x) && enemy.x<Math.max(0,pose.x),'live airborne X interpolates towards the rotated rear-plane depth');
  assert(enemy._banditLungeHopCurrent>pose.hop+1,'Headtaker is visibly still above the final attachment height');
  assert.equal(enemyGroup.visible,true,'descending attacker enters the frame from above');
  for(let i=0;i<6;i++)api.update(enemy,.05,target); // Stop as soon as contact is established, before the first pull is already underway.
  assert(Math.abs(enemyGroup.rotation.y + Math.PI/4)<.0001,'Headtaker portrait is parallel to victim plane');
  const rearDistance = 0.75*enemy.avatarRef.armLength; // Rendered arm length alone determines the offset.
  assert(Math.abs(enemy.x/55 - (hostGroup.position.x - Math.SQRT1_2 * rearDistance))<.001,
    'rear normal moves the portrait in world X when its plane is angled');
  assert(Math.abs(enemy.y/55 - (hostGroup.position.z - Math.SQRT1_2 * rearDistance))<.001,
    'rear normal moves the portrait in world Z by 75% of arm length');
  assert.equal(api.tuning.targetHeightFraction,.85,'grapple aims to 85% portrait height');
  assert(Math.abs(enemyGroup.position.y + .13 - (hostGroup.position.y + .22 + 1.5*.35))<.001,
    'attacker full portrait centroid aligns to 85% victim height, respecting both centre offsets');
  assert(Math.abs(enemyGroup.rotation.z + Math.PI/12)<.0001,'Headtaker leans 15 degrees forward toward the victim');
  ctx.Combat.attach.register('unmodified-rider-test',{verticalAnchor:'upper-quarter',heightAboveHost:.1});
  const normalRiderPose = ctx.Combat.attach.poseFor(enemy,'unmodified-rider-test',target);
  assert.equal(normalRiderPose.x,target.x,'ordinary shared attachment still uses host X without Headtaker offset');
  assert.equal(normalRiderPose.y,target.y,'ordinary shared attachment still uses host Z without Headtaker offset');
  const normalDepthPose = ctx.Combat.attach.poseFor(enemy,api.id,target);
  enemy.avatarRef.armLength=1.6; // Double authored anatomical reach: depth must grow by exactly the same factor.
  const longArmPose = ctx.Combat.attach.poseFor(enemy,api.id,target);
  assert(Math.abs((longArmPose.y-normalDepthPose.y)/55 + Math.SQRT1_2*.6)<.001,
    'rear separation derives from 75% of current arm length, not a fixed Z constant');
  enemy.avatarRef.armLength=.8; // Restore the normal anatomy before executing the remaining grapple.
  const planeNormal = target.avatarRef.frontPlane.getWorldDirection;
  target.avatarRef.frontPlane.getWorldDirection = out => out.set(-Math.SQRT1_2,0,-Math.SQRT1_2);
  const reversedPose = ctx.Combat.attach.poseFor(enemy,api.id,target);
  assert(reversedPose.y>target.y && reversedPose.x>target.x, 'behind flips with victim portrait orientation');
  target.avatarRef.frontPlane.getWorldDirection = planeNormal;
  assert(footSamples.length>0,'shared leg IK received both contact coordinates');
  const right=footSamples.at(-1).right, left=footSamples.at(-1).left;
  assert(Math.abs(right.x)<.001 && Math.abs(right.y+.48)<.001,
    'right foot braces at posterior spine node 0, NOT neck-base node 6');
  assert(Math.abs(left.y-.2)<.001 && left.x < 0,'left foot follows victim left shoulder');
  const surfaceDepth=point=>(point.x+point.z)*Math.SQRT1_2; // Rotated portrait normal dot: zero is the same skin plane as the skull-bound hands.
  assert(Math.abs(surfaceDepth(left))<.001 && Math.abs(surfaceDepth(right))<.001,
    'both feet actually touch the same rotated portrait plane as the hand grips');
  assert(right.y < left.y - .45, 'spine posterior foot is visibly lower than shoulder foot');
  assert(right.y < -.25 && left.y < .3, 'neither foot can be confused with the head-bound hands');
  assert(footOptions.at(-1)?.allowExtendedReach===true,'foot IK can extend to the true portrait surface rather than clamp to walking reach');
  assert.equal(typeof gripProvider,'function','grip owns the existing hand runtime');
  gripProvider({placeHandWorld(side,position){handSamples[side]=position.clone();}});
  assert(handSamples.left && handSamples.right,'both bound-specific hand contacts emitted');
  assert(Math.abs(handSamples.left.x-(35/200-.5)*Math.SQRT1_2)<.001,'left hand grips left head bound');
  assert(Math.abs(handSamples.right.x-(150/200-.5)*Math.SQRT1_2)<.001,'right hand grips right head bound');
  assert(!contains('maskbound_skyfall_one_tile_aoe'), 'landing ring removed using parent.remove');
  assert.equal(enemy._attachment?.stage,'attached', 'landing proceeds to real shared attachment');
  assert.equal(target._maskboundHeadtakerNeckControlled!==undefined,true,'host neck is locked without replacing movement state');
  assert.equal(target.avatarRef.neckJoint.front.rotation.y,0,'front neck yaw is locked while the victim body still moves');
  assert.equal(target.avatarRef.neckJoint.back.rotation.y,0,'back neck yaw is independently locked');
  target.avatarRef.neckJoint.front.rotation.y = 1.2; // Simulate a late game camera-look writer before skinning.
  target.avatarRef.frontPlane.onBeforeRender(); // Render-boundary lock must win without pausing the host.
  assert.equal(target.avatarRef.neckJoint.front.rotation.y,0,'rendering restores scripted neck after late gaze updates');
  assert(Math.abs(enemy.x-pose.x)<.001 && Math.abs(enemy.y-pose.y)<.001,
    'contact ends at the shared rear-portrait anchor (no landing snap)');
  assert(Math.abs(enemy._banditLungeHopCurrent-pose.hop)<.001,'contact ends at exactly the shared attachment height');
  await api.headArtReady(enemy);
  const joint=target.avatarRef.headScaleJoint.front; // Head sprite scale is an independently measurable yank/recoil signal.
  for(let i=0;i<4;i++)api.update(enemy,.05,target);
  const fastPull=joint.scale.y;
  assert(fastPull>=1.22,'heartbeat yank reaches strong head extension within 200ms');
  for(let i=0;i<18;i++)api.update(enemy,.05,target);
  assert(joint.scale.y<fastPull-0.1,'the remaining 1.3 seconds are a distinct slow recoil');
  assert.equal(api.tuning.finalPullS,3,'third pull lasts exactly three seconds');
  assert(api.tuning.finalHeadStretch>api.tuning.neckStretch*2,'third pull stretches much farther than heartbeat pulls');
  target.x += 1; hostGroup.position.x = target.x/55; // The grapple must not freeze the victim's locomotion.
  for(let i=0;i<68 && enemy._attachment?.stage==='attached';i++) api.update(enemy,.05,target); // The private shared clock is on the manual attachment state, not the entity marker.
  assert(Math.abs(enemy.x/55 - (hostGroup.position.x-Math.SQRT1_2*rearDistance))<.001,
    'Headtaker follows the moving target during the neck-locked pull');
  assert(joint.scale.y>1.30,'third pull visibly lengthens the head beyond the reversible pulls');
  assert(target.avatarRef.neckJoint.front.rotation.x < -.15,'third pull pitches target face backward toward Headtaker');
  assert(target.avatarRef.neckJoint.back.rotation.x > .15,'rear card pitch mirrors the face rather than turning away');
  assert(target.avatarRef.neckJoint.front.rotation.y===0,'target neck cannot yaw during scripted backward pitch');
  let sawHead=false,sawBlood=false;
  for(let i=0;i<200;i++) {
    api.update(enemy,.05,target);
    sawHead ||= contains('maskbound_severed_head_origin');
    sawBlood ||= contains('maskbound_head_blood_spew');
    if(!enemy._attachment)break;
  }
  assert(sawHead && sawBlood,'head clone and blood render through the final pull and throw');
  assert(!contains('maskbound_severed_head_origin'), 'thrown head is disposed');
  assert(!contains('maskbound_head_blood_spew'), 'blood is disposed');
  assert.equal(kills,1,'finishing attack kills exactly once');
  assert.equal(api.getDebug().finishes,1);
  assert.equal(api.getDebug().errors,0);
  assert(disposalCount>=7,'GPU geometry/material/texture resources disposed');
  assert(Math.abs(enemyGroup.rotation.y)<.0001,'normal portrait yaw restored after detached throw');
  assert(Math.abs(enemyGroup.rotation.z)<.0001,'Headtaker forward lean is restored after the throw');
  assert.equal(target._maskboundHeadtakerNeckControlled,undefined,'victim neck lock is released, movement controls never overwritten');
  assert(Math.abs(target.avatarRef.neckJoint.front.rotation.y-.4)<.0001,'front neck returns to its previous gaze on release');
  assert(Math.abs(target.avatarRef.neckJoint.back.rotation.y+.2)<.0001,'rear neck returns to its previous gaze on release');
  assert.equal(target.avatarRef.frontPlane.onBeforeRender,beforeNeckDraw,'skinned rendering hook is restored');
  console.log('PASS Headtaker 85%-height, 15-degree lean, mobile victim, neck lock and three-second pitched final pull, throw and cleanup');
})().catch(error=>{console.error(error);process.exitCode=1;});
