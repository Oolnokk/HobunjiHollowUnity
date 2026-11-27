'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const read=p=>fs.readFileSync(p,'utf8');
const stance=read('docs/js/weapon-tool-stances.js');
const start=stance.indexOf('  function groundPoseEligible(');
const end=stance.indexOf('  function installHolderMatrixHook(',start);
const eligible=vm.runInNewContext(stance.slice(start,end)+'\ngroundPoseEligible',{window:{}});
for(const slot of ['weapon','ranged','axe','hoe','shovel','pick','harpoon','torch']){
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
