'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const read=p=>fs.readFileSync(p,'utf8');
const stance=read('docs/js/weapon-tool-stances.js');
const start=stance.indexOf('  function groundPoseEligible(');
const end=stance.indexOf('  function installHolderMatrixHook(',start);
const eligible=vm.runInNewContext(stance.slice(start,end)+'\ngroundPoseEligible',{window:{}});
for(const slot of ['weapon','ranged','axe','hoe','shovel','pick','harpoon','adventuring']){
  assert.equal(eligible(slot,'test',{visible:true,userData:{}}),true,slot);
}
assert.equal(eligible('ranged','test',{visible:true,userData:{headRelativeBackPlane:true}}),false);
assert.equal(eligible('axe','test',{visible:false}),false);
assert.equal(eligible('axe',null,{visible:true}),false);
const src=read('docs/js/held-ground-pose.js');
const win={};
vm.runInNewContext(src,{window:win});
assert.equal(typeof win.HeldGroundPose.constrainCarry,'function');
assert.equal(win.HeldGroundPose.constrainCarry(null,null),false);
assert.match(stance,/clearanceContext\.fitOnly=activeSlot!==/);
assert.match(stance,/clearanceContext\.preserveOrientation=/);
assert.match(read('docs/js/procedural-hand-frame-driver.js'),/groundPoseIdle/);
assert.match(read('docs/js/kurraya-instrument.js'),/groundPoseIdle/);
assert.match(read('docs/js/shattercasks.js'),/groundPoseIdle/);
console.log('Idle-clearance policy and owner wiring passed.');

// Run the actual hand preparation helper with the live eligibility policy,
// not the legacy fallback stub, for every equipped slot.
const driver=read('docs/js/procedural-hand-frame-driver.js');
const from=driver.indexOf('  function prepareGroundPoseForSockets('),to=driver.indexOf('  function syncRigToTool(',from);
let slot='weapon',fresh=false,bakes=0,dualCalls=0;
const player={},holder={visible:true,userData:{},parent:{updateWorldMatrix(){}},updateMatrixWorld(){fresh=true;bakes++;}};
const record={rig:{parent:player},avatarRoot:{userData:{}}};
const prepare=vm.runInNewContext('('+driver.slice(from,to).trim()+')',{gameDeps:{playerMesh:player,toolHolder:holder},inAttackEditor:()=>false,toolGrips:{offhandIdleStateForTool:()=>null},global:{HeldGroundPose:{enabled:()=>true,hasCurrentGripPose:()=>fresh},WeaponToolStances:{groundPoseEligible:eligible,getRuntimeState:()=>({activeSlot:slot,itemKey:'test'})},HobunjiDualWieldWeaponVisuals:{syncNow(){dualCalls++;}}}});
for(slot of ['axe','hoe','shovel','pick','harpoon','adventuring','ranged']){
  fresh=false;const before=bakes;prepare(record,holder,'test',slot==='ranged'?'ranged':'melee',{},null,{});assert.equal(bakes,before+1,slot+' pre-bakes once');prepare(record,holder,'test','melee',{},null,{});assert.equal(bakes,before+1,slot+' does not re-bake');
}
assert.equal(dualCalls,0);holder.userData.headRelativeBackPlane=true;fresh=false;const before=bakes;assert.equal(prepare(record,holder,'test','ranged',{},null,{}),undefined);assert.equal(bakes,before);
console.log('Actual nonweapon hand preparation and mouth ownership passed');
