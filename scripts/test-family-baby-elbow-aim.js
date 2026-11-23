#!/usr/bin/env node
'use strict';
// Regression for real player-only elbow targets, shared Attack Editor bone guides,
// and nullable shoulder-relative values in FamilyBabyCarryPose.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const runtime=fs.readFileSync('docs/js/hand-shoulder-pose-runtime.js','utf8');
const editor=fs.readFileSync('docs/tools/furniture-avatar-author/carryable-objects.js','utf8');
const html=fs.readFileSync('docs/tools/furniture-avatar-author/index.html','utf8');
const profile=fs.readFileSync('docs/config/family-baby-carry-pose.js','utf8');
const playerMesh={},playerAvatar={parent:playerMesh},npcAvatar={parent:{}},previewAvatar={parent:null};
const authored={left:{x:-.13,y:-.14,z:.11},right:{x:.09,y:-.16,z:.06}};
const held={id:'family_baby_test',kind:'familyBaby'};
let current=held,found=0;
const babyBurden={data:{carryable:{elbows:authored}}};
const window={
  Combat:{deps:{playerMesh}},
  Shattercasks:{
    heldBurdenInfo(){return current;},
    getBurden(id){assert.equal(id,held.id);found++;return babyBurden;},
  },
};
vm.runInNewContext(runtime,{window,console,document:{getElementById:()=>null}});
const solver=window.HobunjiHandShoulderPoseRuntime;
assert(solver,'Attack Editor shared elbow pose runtime initialized');
assert.equal(solver.currentElbow('left',playerAvatar).x,-.13,
  'player left arm reads baby shoulder-relative elbow from actual held Burden');
assert.equal(solver.currentElbow('right',playerAvatar).z,.06,
  'player right arm reads other baby elbow from the shared carry profile');
const before=found;
assert.equal(solver.currentElbow('left',npcAvatar),null,
  'player holding infant never changes unrelated NPC elbow targets');
assert.equal(found,before,'NPC arm solver does not consult player carried burdens');
current=null;
assert.equal(solver.currentElbow('left',playerAvatar),null,
  'stowed/released baby does not leave held elbow pose active');
current={id:'crate',kind:'furniture'};
assert.equal(solver.currentElbow('left',playerAvatar),null,
  'furniture burden does not inherit infant arm bends');
current=held;
window.HobunjiFurnitureBabyElbowFor=(side,root)=>
  root===previewAvatar&&side==='left'?{x:.22,y:-.18,z:.07}:null;
assert.equal(solver.currentElbow('left',previewAvatar).x,.22,
  'Furniture Author preview feeds the SAME solver without a synthetic decorative elbow');
assert.equal(solver.currentElbow('right',npcAvatar),null,
  'editor preview callback never bleeds elbow edits into NPCs');

const storage={};vm.runInNewContext(profile,{window:storage,console});
const config=storage.FamilyBabyCarryPose;
const carry=config.forSize(.25,.3);
assert.equal(carry.elbows.left,null,'elbow is nullable until user authors one (legacy aiming preserved)');
carry.elbows.left={x:-.1,y:-.15,z:.2};
const saved=config.toProfile(carry,.25,.3);
assert.equal(saved.elbows.left.y,-.15,'elbows are shoulder-relative, unscaled by baby portrait');
const next=config.forSizeFrom(saved,.13,.19);
assert.equal(next.elbows.left.y,-.15,'newborn size change does not scale adult elbow offsets');
assert.equal(next.elbows.right,null,'right elbow remains genuinely unkeyed');
const active={billboardAnchor:{position:{},rotation:{}},backCarry:{position:{},rotation:{}},
  handTargets:{left:{rotation:{}},right:{rotation:{}}}};
config.applyFrom(active,saved,.13,.19);
assert.equal(active.elbows.left.z,.2,'live physical Baby Burden receives authored elbow pose');
assert.equal(active.elbows.right,null,'elbows do not acquire accidental zero keyframes');
const oldElbow=active.elbows.left;
config.applyFrom(active,saved,.3,.31);
assert.equal(active.elbows.left,oldElbow,'live arm solver keeps elbow object identity on infant geometry rebuild');

assert(html.indexOf('hand-shoulder-pose-runtime.js')>0,'Furniture Author loads Attack Editor elbow data owner');
assert(html.indexOf('procedural-hand-shoulder-aim.js')>html.indexOf('hand-shoulder-pose-runtime.js'),
  'the native paper-arm solver loads after its pose runtime');
for(const id of ['carryBabyBones','carryBabyElbowLeft','carryBabyElbowRight',
  'carryBabyMidLeft','carryBabyMidRight','carryBabyClearLeft','carryBabyClearRight'])
  assert(editor.includes('id="'+id+'"'),id+' is available on the mobile Carryable tab');
assert(editor.includes('shoulderPositionLocal'), 'editor samples real attachment-rig shoulder positions');
assert(editor.includes('elbowGuideRoot'), 'elbow gizmos remain in the ADULT frame rather than the rotated baby');
assert(editor.includes('authorElbowFromMarker(side)'), 'elbow manipulator serializes shoulder-relative XYZ');

const start=editor.indexOf('  function setBabyBones(enabled){');
const end=editor.indexOf('  function authorElbowFromMarker(',start);
assert(start>=0&&end>start,'reuse the actual bone-view toggle implementation');
const boneCalls=[],checkbox={checked:false};
const boneToggle=new Function('el','window','editingBaby','babyPoseIsBack','updateBabyElbowGuides',
  editor.slice(start,end)+'\nreturn setBabyBones;')(
  id=>id==='carryBabyBones'?checkbox:null,
  {ProceduralHandShoulderAim:{setPaperArmGuideVisible:on=>boneCalls.push(on)}},
  true,()=>false,()=>boneCalls.push('refresh'));
boneToggle(true);
assert.equal(checkbox.checked,true,'on-screen Show bones checkbox updates');
assert.equal(boneCalls[0],true,'Show bones invokes shared Attack Editor paper-arm guide');
boneToggle(false);
assert.equal(boneCalls[2],false,'Hide bones disables the original shared paper-arm guide');
console.log('PASS shoulder-relative baby elbows, player scope, null fallbacks, author gizmos and real bone-view toggle');
