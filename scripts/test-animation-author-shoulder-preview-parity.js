#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('docs/tools/animation-author/index.html', 'utf8'); // Exercises the actual editor adapter rather than a duplicated Y-axis conversion.
const rig = fs.readFileSync('docs/config/attachment-rig-profiles.js', 'utf8'); // Canonical gameplay socket used in the parity assertions.
const begin = html.lastIndexOf('// V15.48 — Shoulder-pet viewport parity with the gameplay attachment solver.');
const end = html.lastIndexOf('</script>');
assert(begin > 0 && end > begin);
const clone = item => JSON.parse(JSON.stringify(item));
const rigWindow = { SCRATCHBONES_CONFIG:{game:{appearanceEditor:{species:{}},assets:{pngPlaneAvatar:{
  behindView:{headUrls:{}},portraitScaleBySpecies:{},portraitVerticalPlacement:{},proceduralFeet:{footScale:{default:1}},
}}}} };
vm.runInNewContext(rig,{window:rigWindow});
const master = clone(rigWindow.HOBUNJI_ATTACHMENT_RIG_MASTER); // Live runtime source of truth.
const grip = master.profiles.creatures.drenkirra.anchors.shoulderGrip;
assert.equal(grip.rotationDeg.y,61);
const oldGrip = {position:{x:.01,y:-.1636307385658067,z:.0009131708735385657},rotationDeg:{x:0,y:-61,z:0}};
const library = () => ({creatures:{
  drenkirra:{anchors:{shoulderGrip:clone(oldGrip)}},
  puktuk:{anchors:{shoulderGrip:{position:{x:0,y:0,z:0},rotationDeg:{x:0,y:-61,z:0}}}},
}});

class Q {
  constructor(x=0,y=0,z=0,w=1) { Object.assign(this,{x,y,z,w}); }
  copy(b) { Object.assign(this,{x:b.x,y:b.y,z:b.z,w:b.w});return this; }
  clone() { return new Q().copy(this); }
  setFromAxisAngle(a,t) { return this.copy({x:a.x*Math.sin(t/2),y:a.y*Math.sin(t/2),z:a.z*Math.sin(t/2),w:Math.cos(t/2)}); }
  setFromEuler(e) { assert.equal(e.order,'YXZ');return this.setFromAxisAngle({x:0,y:1,z:0},e.y); }
  invert() { this.x=-this.x;this.y=-this.y;this.z=-this.z;return this; }
  multiply(b) {
    const a=this.clone();
    return this.copy({x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z});
  }
}
class V {
  constructor(x=0,y=0,z=0) { this.set(x,y,z); }
  set(x,y,z) { Object.assign(this,{x,y,z});return this; }
  copy(v) { return this.set(v.x,v.y,v.z); }
  clone() { return new V(this.x,this.y,this.z); }
  negate() { return this.set(-this.x,-this.y,-this.z); }
  applyQuaternion(q) { const b=q.clone().multiply(new Q(this.x,this.y,this.z,0)).multiply(q.clone().invert());return this.set(b.x,b.y,b.z); }
}
class Euler { constructor(x,y,z,order) { Object.assign(this,{x,y,z,order}); } }
const yaw = n => new Q().setFromAxisAngle({x:0,y:1,z:0},n*Math.PI/180);
const angle = q => Math.atan2(2*(q.w*q.y+q.x*q.z),1-2*(q.y*q.y+q.z*q.z))*180/Math.PI;
const near = (a,b,why) => assert(Math.abs(a-b)<1e-8, why+': '+a+' vs '+b);
const foot = new V(grip.position.x,grip.position.y,grip.position.z); // Exact scaled Small-pet grip for this fixture.
const socket = {quaternion:new Q(),updateMatrixWorld(){}};
const owner = {
  model:{getWorldQuaternion:()=>yaw(12)},
  neckRig:{neckJoint:{isObject3D:true,updateWorldMatrix(){},getWorldQuaternion:()=>yaw(27)}},
  rigAnchors:{shoulderPerch:{rotation:{x:0,y:5*Math.PI/180,z:0},updateWorldMatrix(){},getWorldQuaternion:()=>yaw(8)}},
  rigAnchorSockets:{shoulderPerch:socket},
};
const pet = {
  source:{kind:'drenkirra',type:'creature'},
  attachment:{enabled:true,carrierAnchor:'shoulderPerch',riderAnchor:'shoulderGrip'},
  root:{parent:socket},
  attachmentAlignment:{position:foot.clone().applyQuaternion(yaw(-61)).negate(),quaternion:yaw(-61),scale:new V(1,1,1),updateMatrixWorld(){}},
};
let restorations = 0;
const context = {
  window:{HOBUNJI_ATTACHMENT_RIG_MASTER:master},
  structuredCloneSafe:clone,animationAuthor:{actors:[pet,owner],mode:'rig',attachmentRigProfiles:library()},
  DEFAULT_ATTACHMENT_RIG_PROFILE_LIBRARY_V1516:library(),
  approvedRigLibraryCloneV1524:library,
  normalizedRigProfileLibrary:value=>{const copy=clone(value);for(const p of Object.values(copy.creatures||{}))p.anchors.shoulderGrip.rotationDeg.y=-61;return copy;},
  state:{three:{THREE:{Quaternion:Q,Vector3:V,Euler}}},
  shoulderPetCarrierV1521:actor=>actor===pet?owner:null,
  actorRigAnchorLocalMatrix:()=>({decompose(p,q,s){p.copy(foot);q.copy(yaw(61));s.set(1,1,1);}}),
  attachmentRigProfileForActor:actor=>context.animationAuthor.attachmentRigProfiles.creatures[actor.source.kind],
  updateActorAttachmentAlignment:actor=>{assert.equal(actor,pet);restorations++;actor.attachmentAlignment.position.copy(foot.clone().applyQuaternion(yaw(-61)).negate());actor.attachmentAlignment.quaternion.copy(yaw(-61));},
  updateAnimationRelationLines:()=>{},renderAttachmentRigInspector:()=>{},selectedAnimationActor:()=>pet,
  $:()=>null,document:{createElement(){throw Error('preview test has no inspector surface');}},setAnimationRecentChange:()=>{},
};
vm.runInNewContext(html.slice(begin,end)+'\nthis.previewParity={approvedRigLibraryCloneV1524,normalizedRigProfileLibrary,updateAnimationRelationLines};',context);
const api=context.previewParity;
for(const candidate of [
  api.approvedRigLibraryCloneV1524().creatures.drenkirra.anchors.shoulderGrip,
  context.animationAuthor.attachmentRigProfiles.creatures.drenkirra.anchors.shoulderGrip,
  api.normalizedRigProfileLibrary(library()).creatures.drenkirra.anchors.shoulderGrip,
]) {
  assert.deepEqual(clone(candidate.position),clone(grip.position),'default/legacy editor grip XYZ matches game');
  assert.equal(candidate.rotationDeg.y,61,'default/legacy editor grip rotation matches game');
}
const edited=library();
edited.creatures.drenkirra.anchors.shoulderGrip.position.x=.03;
edited.creatures.drenkirra.anchors.shoulderGrip.rotationDeg.y=17;
edited.creatures.puktuk.anchors.shoulderGrip.rotationDeg.y=24;
const normalized=api.normalizedRigProfileLibrary(edited);
assert.equal(normalized.creatures.drenkirra.anchors.shoulderGrip.rotationDeg.y,17,'custom Drenkirra yaw survives');
assert.equal(normalized.creatures.puktuk.anchors.shoulderGrip.rotationDeg.y,24,'custom Puktuk yaw survives');
const worldYaw = () => angle(yaw(8).multiply(socket.quaternion).multiply(pet.attachmentAlignment.quaternion));
api.updateAnimationRelationLines();
near(worldYaw(),-29,'outward Y matches head 27 + perch 5 - grip 61');
pet.previewShoulderFacingInward=true;
api.updateAnimationRelationLines();
near(worldYaw(),151,'inward stage adds 180 local degrees');
const offset=foot.clone().applyQuaternion(pet.attachmentAlignment.quaternion);
for(const axis of ['x','y','z'])near(pet.attachmentAlignment.position[axis]+offset[axis],0,'foot pin '+axis);
pet.previewShoulderFacingInward=false;
api.updateAnimationRelationLines();
near(worldYaw(),-29,'outward orientation restored');
assert.equal(restorations,1,'original alignment restored once');
assert.equal(pet.previewShoulderParityDebug.rotationSource,'player-head-neck');
console.log('animation author shoulder pet preview parity tests passed');
