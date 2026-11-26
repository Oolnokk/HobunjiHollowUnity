const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context={window:{}};
vm.runInNewContext(fs.readFileSync('docs/js/held-ground-pose.js','utf8'),context);
const {contractedZ,minimumY,chooseAngle}=context.window.HeldGroundPose;
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} vs ${b}`);
const segments=[{a:-2,b:-1},{a:1,b:3}];
close(contractedZ(0,0,segments,.5),0);
close(contractedZ(-3,0,segments,.5),-2.5);
close(contractedZ(4,0,segments,.5),3);
close(contractedZ(3,0,segments,.5)-contractedZ(1,0,segments,.5),1);
close(contractedZ(1,0,segments,.5)-contractedZ(-1,0,segments,.5),2);
close(contractedZ(2,2,segments,.5),2);
const points=[{a:-1,b:1},{a:0,b:0}];
const angle=chooseAngle(points,1,.5);assert.ok(angle>0&&angle<Math.PI/2);
assert.ok(minimumY(points,1,angle)>=.5);
assert.equal(chooseAngle(points,1,.5,()=>false),null);
assert.equal(chooseAngle(points,2,.5),0);
assert.equal(chooseAngle([{a:0,b:0}],0,.5),null);
console.log('held ground pose: pure contraction and rotation checks passed');

// Protruding axe head: contact X is not a fictitious full-width rectangle.
const box={min:{x:-1,y:-2},max:{x:1,y:2}};
const axe=[{x:-.1,z:-2},{x:.1,z:-2},{x:.1,z:1},{x:1,z:1},{x:1,z:2},{x:-.1,z:2}];
const contacts=[];assert.equal(context.window.HeldGroundPose.contactVertices(box,axe,[{a:0,b:.5}],contacts),true);
assert.ok(contacts.some(p=>p.x===1&&p.z===2));
assert.ok(!contacts.some(p=>p.x===1&&p.z===-2));
assert.ok(contacts.some(p=>Math.abs(p.x-.1)<1e-6&&p.z===.5),'edge split at shortening boundary');
assert.equal(context.window.HeldGroundPose.contactVertices(box,[{x:2,z:0},{x:0,z:0},{x:0,z:1}],[],contacts),false);
assert.equal(contacts.length,4,'invalid outline uses rectangle');

const rope=context.window.HeldGroundPose.ropeClearance;
assert.equal(rope(2,.5,-1,3).length,2);
assert.equal(rope(2,.5,-1,1.5).length,1.5);
const drag=rope(2,.5,-1,.6);assert.equal(drag.length,1);assert.equal(drag.directionY,-.6);assert.equal(drag.trailing,true);
assert.equal(rope(2,.5,-1,-2),null);
