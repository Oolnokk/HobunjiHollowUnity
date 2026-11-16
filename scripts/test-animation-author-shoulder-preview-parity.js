#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('docs/tools/animation-author/index.html', 'utf8'); // Exercises the actual editor adapter rather than a duplicated Y-axis conversion.
function referencedAssetVersion(source, basename) {
  let at = source.indexOf(basename);
  while (at >= 0) {
    const after = source.slice(at + basename.length); // Checks actual loader references without hardcoding a revision.
    if (after[0] === '?') {
      const match = /^v=([A-Za-z0-9_-]+)/.exec(after.slice(1));
      if (match) return match[1];
    }
    at = source.indexOf(basename, at + basename.length);
  }
  assert.fail('Missing versioned asset reference: ' + basename);
}
const rigConsumers = ['docs/index.html', 'docs/tools/animation-author/index.html',
  'docs/tools/attack-animation-editor/index.html', 'docs/tools/enemy-loadout-editor/preview.js'];
const rigVersions = rigConsumers.map(consumer =>
  referencedAssetVersion(fs.readFileSync(consumer, 'utf8'), 'attachment-rig-profiles.js')
); // All consumers should resolve the same current master rig.
assert.equal(new Set(rigVersions).size, 1, 'game and editors must share the same versioned attachment rig');
const enemyApp = fs.readFileSync('docs/tools/enemy-loadout-editor/app.js', 'utf8');
const enemyHtml = fs.readFileSync('docs/tools/enemy-loadout-editor/index.html', 'utf8');
assert(referencedAssetVersion(enemyApp, 'preview.js'), 'Enemy Loadout must import a versioned preview');
assert(referencedAssetVersion(enemyHtml, 'app.js'), 'Enemy Loadout must import a versioned entry module');
const rig = fs.readFileSync('docs/config/attachment-rig-profiles.js', 'utf8'); // Canonical gameplay socket used in the parity assertions.
const mainEditorScriptStart = html.indexOf('<script>\n(() => {'); // The actual Animation Author runs in a private IIFE, not the separate global layout script.
const mainEditorScriptEnd = html.indexOf('</script>', mainEditorScriptStart);
const begin = html.lastIndexOf('// V15.48 — Shoulder-pet viewport parity with the gameplay attachment solver.');
const end = html.indexOf('// V15.49 — Rig Coordinates:', begin); // Isolate V15.48 without accidentally executing the newer shoulder-pose preview adapter.
assert(mainEditorScriptStart > 0 && mainEditorScriptEnd > mainEditorScriptStart);
assert(begin > mainEditorScriptStart && begin < mainEditorScriptEnd && end > begin,
  'shoulder-pet preview adapter must share the actual Animation Author IIFE scope, not the separate layout script');
const clone = item => JSON.parse(JSON.stringify(item));
const rigWindow = { SCRATCHBONES_CONFIG:{game:{appearanceEditor:{species:{}},assets:{pngPlaneAvatar:{
  behindView:{headUrls:{}},portraitScaleBySpecies:{},portraitVerticalPlacement:{},proceduralFeet:{footScale:{default:1}},
}}}} };
vm.runInNewContext(rig,{window:rigWindow});
const master = clone(rigWindow.HOBUNJI_ATTACHMENT_RIG_MASTER); // Live runtime source of truth.
const grip = master.profiles.creatures.drenkirra.anchors.shoulderGrip;
assert.equal(grip.rotationDeg.y,61);
const oldGrip = {position:{x:.01,y:-.1636307385658067,z:.0009131708735385657},rotationDeg:{x:0,y:-61,z:0}};
const oldGrehlr = {position:{x:.01,y:-.3719770036140037,z:0},rotationDeg:{x:0,y:-61,z:0}}; // Previously embedded V15.24 grip.
const oldUum = {position:{x:.01,y:-.5363283597840667,z:-.012886930890300352},rotationDeg:{x:0,y:-61,z:0}}; // Previous rotation must become gameplay's neutral 0°.
const library = () => ({creatures:{
  drenkirra:{anchors:{shoulderGrip:clone(oldGrip)}},
  grehlr:{anchors:{shoulderGrip:clone(oldGrehlr)}},
  uumkaoii:{anchors:{shoulderGrip:clone(oldUum)}},
  puktuk:{anchors:{shoulderGrip:{position:clone(master.profiles.creatures.puktuk.anchors.shoulderGrip.position),rotationDeg:{x:0,y:-61,z:0}}}},
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
  window:{HOBUNJI_ATTACHMENT_RIG_MASTER:master,HOBUNJI_ATTACHMENT_RIG_MASTER_GUARD:rigWindow.HOBUNJI_ATTACHMENT_RIG_MASTER_GUARD},
  structuredCloneSafe:clone,normalizeTransformSnapshot:value=>clone(value),animationAuthor: // Identity normalization is sufficient for complete canonical test anchors.
  {actors:[pet,owner],mode:'rig',attachmentRigProfiles:library()},
  DEFAULT_ATTACHMENT_RIG_PROFILE_LIBRARY_V1516:library(),
  approvedRigLibraryCloneV1524:library,
  normalizedRigProfileLibrary:value=>{const copy=clone(value);for(const p of Object.values(copy.creatures||{})){p.anchors.shoulderGrip.rotationDeg.y=-61;p.anchors.shoulderGrip.position.x=.01;}return copy;},
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
for(const kind of ['grehlr','uumkaoii']) {
  const current = master.profiles.creatures[kind].anchors.shoulderGrip;
  const libraryGrip = api.normalizedRigProfileLibrary(library()).creatures[kind].anchors.shoulderGrip;
  const defaultGrip = api.approvedRigLibraryCloneV1524().creatures[kind].anchors.shoulderGrip;
  assert.deepEqual(clone(libraryGrip.position),clone(current.position),kind+' legacy grip position matches game');
  assert.equal(libraryGrip.rotationDeg.y,current.rotationDeg.y,kind+' legacy grip Y matches game');
  assert.deepEqual(clone(defaultGrip.position),clone(current.position),kind+' default grip matches game');
  assert.equal(defaultGrip.rotationDeg.y,current.rotationDeg.y,kind+' default yaw matches game');
}
const edited=library();
edited.creatures.drenkirra.anchors.shoulderGrip.position.x=.03;
edited.creatures.drenkirra.anchors.shoulderGrip.rotationDeg.y=17;
const legacyCustomRotation=library(); // Older Drenkirra socket XYZ may coexist with a legitimately customized Y angle.
legacyCustomRotation.creatures.drenkirra.anchors.shoulderGrip.rotationDeg={x:9,y:17,z:-4};
const migratedCustom=api.normalizedRigProfileLibrary(legacyCustomRotation).creatures.drenkirra.anchors.shoulderGrip;
assert.equal(migratedCustom.rotationDeg.y,17,'editor legacy XYZ migration preserves custom Y');
assert.equal(migratedCustom.rotationDeg.x,9,'editor legacy XYZ migration preserves custom X');
assert.equal(migratedCustom.rotationDeg.z,-4,'editor legacy XYZ migration preserves custom Z');
edited.creatures.puktuk.anchors.shoulderGrip.rotationDeg.y=24;
const normalized=api.normalizedRigProfileLibrary(edited);
assert.equal(normalized.creatures.drenkirra.anchors.shoulderGrip.rotationDeg.y,17,'custom Drenkirra yaw survives');
assert.equal(normalized.creatures.drenkirra.anchors.shoulderGrip.position.x,.03,'custom grip X survives old editor defaults');
assert.equal(normalized.creatures.puktuk.anchors.shoulderGrip.rotationDeg.y,24,'custom Puktuk yaw survives');
const activeDeadzoneStart = html.indexOf('applyViewportRotationDeadzones = function(dt = 0) {'); // Only the later V15.12 override owns actual viewport rotation.
const activeDeadzoneEnd = html.indexOf('\n};\n\nconst baseSerializeAnimationProjectV1511', activeDeadzoneStart);
assert(activeDeadzoneStart > 0 && activeDeadzoneEnd > activeDeadzoneStart, 'active V15.12 deadzone implementation is available for execution');
const activeDeadzoneSource = html.slice(activeDeadzoneStart, activeDeadzoneEnd + 3);
let petRootRefreshes = 0;
const petFacingRoot = {rotation:{y:1.6},updateMatrixWorld(){petRootRefreshes++;}}; // Stale camera correction must reset to this pet's authored resting facing.
const previewPet = {source:{type:'creature'},viewportFacingRoot:petFacingRoot,viewportVisual:{facingRootBaseRotationY:.12}};
const legacyPlane = {rotation:{y:.8}};
const previewLegacyPet = {source:{type:'creature'},viewportVisual:{creaturePlanes:[{object:legacyPlane,baseRotationY:.15}]}};
const ownerFacingRoot = {rotation:{y:0},updateMatrixWorld(){}};
const previewOwner = {source:{type:'npc'},viewportFacingRoot:ownerFacingRoot,viewportVisual:{facingRootBaseRotationY:0}};
let nonPetDeadzoneChecks = 0;
const deadzoneArgs = {
  state:{three:{ready:true}},
  animationAuthor:{actors:[previewOwner,previewPet,previewLegacyPet],viewportFacing:{hysteresisDeg:1,characterDeg:40,creatureDeg:30}},
  shoulderPetCarrierV1521:actor=>actor===previewPet||actor===previewLegacyPet?previewOwner:null,
  viewportActorsParentFirst:()=>[previewOwner,previewPet,previewLegacyPet],
  viewportCameraAzimuthRad:()=>0,degToRad:d=>d*Math.PI/180,
  viewportActorWorldYaw:()=>.1,
  viewportPerpClamp:()=>{nonPetDeadzoneChecks++;return {effectiveTarget:.4,snapTo:null};},
  viewportCreatureDeadzoneTarget:()=>{throw Error('shoulder pet must never get creature camera correction');},
  viewportCharacterPerps:()=>[0],viewportCreaturePerps:()=>[0],
  viewportAngleDiff:(a,b)=>a-b,finiteNumber:(n,fallback)=>Number.isFinite(n)?n:fallback,
};
const deadzone = new Function(...Object.keys(deadzoneArgs),
  'let applyViewportRotationDeadzones;\n' + activeDeadzoneSource + '\nreturn applyViewportRotationDeadzones;'
)(...Object.values(deadzoneArgs)); // Executes the same function the real editor uses after all overrides are installed.
deadzone(.1);
near(petFacingRoot.rotation.y,.12,'current shoulder pet root skips camera deadzone');
near(legacyPlane.rotation.y,.15,'rigid/legacy shoulder pet plane skips camera deadzone');
assert.equal(petRootRefreshes,1,'pet root matrix is updated after removing the stale camera correction');
assert.equal(nonPetDeadzoneChecks,1,'non-shoulder actor still gets its ordinary character camera deadzone');
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
