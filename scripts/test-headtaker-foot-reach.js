'use strict';
// Exercise the actual procedural leg contact transform with and without the
// Headtaker's opt-in extended reach. No canvas, GPU, or Unity required.
const assert = require('node:assert/strict');
const fs = require('node:fs');

const legSource = fs.readFileSync('docs/js/procedural-leg-animation.js', 'utf8');
const headtakerSource = fs.readFileSync('docs/js/combat/combat-maskbound-headtaker.js', 'utf8');
const start = legSource.indexOf('    function applyWorldFootTargets(targets,footWorldQuaternion=null,allowExtendedReach=false,allowDeepFold=false) {');
const end = legSource.indexOf('    function setExternalFootTargets(', start); // Stop at the next function, not the relocated contact state declarations.
assert(start >= 0 && end > start, 'extract the real external foot-target solver');
assert(legSource.includes('applyWorldFootTargets(externalFootTargets, null, externalFootExtendedReach, externalFootDeepFold)'), 'runtime forwards the special reach flag and the separate deep-fold option');
assert(legSource.includes('externalFootExtendedReach = !!(externalFootTargets && options?.allowExtendedReach)'), 'disabling external foot IK also resets extended reach');
assert(headtakerSource.includes('legs.setExternalFootTargets(feet, { allowExtendedReach: true })'), 'only Headtaker explicitly requests longer contact reach');
const functionSource = legSource.slice(start, end);

class Vector3 {
  constructor(x=0,y=0,z=0){this.set(x,y,z);}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  copy(p){return this.set(p.x,p.y,p.z);}
  clone(){return new Vector3(this.x,this.y,this.z);}
  sub(p){this.x-=p.x;this.y-=p.y;this.z-=p.z;return this;}
  add(p){this.x+=p.x;this.y+=p.y;this.z+=p.z;return this;}
  multiplyScalar(n){this.x*=n;this.y*=n;this.z*=n;return this;}
  distanceTo(p){return Math.hypot(this.x-p.x,this.y-p.y,this.z-p.z);}
  applyEuler(){return this;}
}
class Quaternion {
  copy(){return this;}
  invert(){return this;}
  multiply(){return this;}
}
class Euler {
  set(){return this;}
}
const THREE={Vector3,Quaternion,Euler};
const targets={left:new Vector3(-.2,-1.5,1.1),right:new Vector3(.2,-1.5,1.1)};
const measured=[];
const makeChain=()=>({
  hip:{position:new Vector3()},
  thigh:{position:new Vector3(),quaternion:new Quaternion()},
  calf:{position:new Vector3(),quaternion:new Quaternion(),userData:{},
    getWorldQuaternion(out){return out;}},
});
const leftChain=makeChain(),rightChain=makeChain();
const state={
  disposed:false, left:{position:new Vector3(),quaternion:new Quaternion()},
  right:{position:new Vector3(),quaternion:new Quaternion()},
  leftContactY:-.5,rightContactY:-.5,
  leftTarget:new Vector3(),rightTarget:new Vector3(),
};
const fakeWindow={LegBones:{solveTwoBoneLeg(_three,{foot,foldMaxLength}){
  measured.push({foot:foot.clone(),foldMaxLength});
  return {thighQuaternion:new Quaternion(),calfLocalQuaternion:new Quaternion(),thighLength:.25,calfLength:.25};
}}};
const makeFn=new Function('THREE','state','root','legChains','pairedFootLocal','pairedBend','pairedForward','legBend','posteriorY','pairedFootRotation','applyBoneGuideTransforms','window','worldQuaternionWithoutScale','prepareLegSolve','publishSolvedLegPose',
  'let pairedBendInternal=pairedBend;'+functionSource.replace('pairedBend ||=', 'pairedBendInternal ||=').replace('pairedBend.set(', 'pairedBendInternal.set(')+
  '\nreturn applyWorldFootTargets;');
const apply=makeFn(THREE,state,{updateWorldMatrix(){},worldToLocal(p){return p;}},
  {left:leftChain,right:rightChain},new Vector3(),null,new Vector3(),
  {left:{x:0,z:0},right:{x:0,z:0}},0,new Quaternion(),()=>{},fakeWindow,(node,out)=>node.getWorldQuaternion(out),
  ()=>{},()=>{}); // Only the isolated function is extracted; its compositor lifecycle helpers are exercised by the full rig tests.
assert.equal(apply(targets,null,false),true);
assert(measured.every(({foot})=>Math.hypot(foot.x,foot.y,foot.z) <= .5+.001), 'ordinary legs retain their walking reach cap');
measured.length=0;
assert.equal(apply(targets,null,true),true);
assert.equal(measured.length,2);
assert(Math.abs(measured[0].foot.distanceTo(targets.left))<1e-8,'left foot reaches exact surface');
assert(Math.abs(measured[1].foot.distanceTo(targets.right))<1e-8,'right foot reaches exact surface');
measured.length = 0;
const closeTargets={left:new Vector3(-.04,-.03,.02),right:new Vector3(.04,-.03,.02)}; // Posterior-straddle knee fold stays within normal fixed bone reach.
assert.equal(apply(closeTargets,null,false,true),true);
assert(measured.every(({foot})=>Math.hypot(foot.x,foot.y,foot.z)<.25),
  'spouse-only deep fold can plant toes near the hip without triggering Headtaker extended-reach behavior');
// The old pants cover pass pushes soles away from the camera, under the
// opaque victim plane. Verify that the *actual rendering hook* is bypassed
// for the exact grapple while staying active during normal walking.
assert(legSource.includes('(externalFootTargets && externalFootExtendedReach)'), 'render hook opts out of pants depth push on exact contacts');
const pushStart=legSource.indexOf('    function installFootDepthPush(foot) {');
const pushEnd=legSource.indexOf('    const childLimbMetadata =',pushStart); // The attach-time metadata is outside the render-hook closure under test.
assert(pushStart>0 && pushEnd>pushStart,'read the actual foot render hook');
const pushSource=legSource.slice(pushStart,pushEnd);
const supportMathStart = legSource.indexOf('  function transformedFootBottomY(');
const supportMathEnd = legSource.indexOf('  function buildFallbackFoot(', supportMathStart);
assert(supportMathStart > 0 && supportMathEnd > supportMathStart, 'read the production ground-cap math');
const supportMath = legSource.slice(supportMathStart, supportMathEnd); // Real bound and ground-cap functions used by the render hook.
const makePush=new Function('THREE','state','root','externalFootTargets','externalFootExtendedReach',
  'const pushCamera = new THREE.Vector3(); const rootScaleY=()=>1; const usesFloorContact=()=>state.motionMode==="walk"; '+supportMath+pushSource+'; return installFootDepthPush;');
class RenderVector extends Vector3 { setFromMatrixPosition(m){return this.set(m.elements[12],m.elements[13],m.elements[14]);} }
const renderThree={Vector3:RenderVector};
const fakeFoot={traverse(cb){cb(this)},isMesh:true,userData:{},onBeforeRender(){},onAfterRender(){},
  matrixWorld:{elements:new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,1,1])}};
const perspectiveCamera={isPerspectiveCamera:true,matrixWorld:{elements:new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,4,1])}};
const renderState={footDepthPush:1,leftTarget:new Vector3(),rightTarget:new Vector3()};
makePush(renderThree,renderState,{matrixWorld:{elements:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}},{left:targets.left,right:targets.right},true)(fakeFoot);
fakeFoot.onBeforeRender(null,null,perspectiveCamera);
assert.equal(fakeFoot.matrixWorld.elements[14],1,'grapple foot remains in front of the portrait, not moved behind it');
fakeFoot.onAfterRender();
const walkFoot={...fakeFoot,userData:{},onBeforeRender(){},onAfterRender(){}};
makePush(renderThree,renderState,{matrixWorld:{elements:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}},null,false)(walkFoot);
walkFoot.onBeforeRender(null,null,perspectiveCamera);
assert(walkFoot.matrixWorld.elements[14]<1,'ordinary walking feet still use pants depth covering');
walkFoot.onAfterRender();
// The ordinary push remains a uniform eye-relative transform, but an actual
// planted support box must stop it from crossing the floor under an elevated eye.
renderState.motionMode = 'walk';
const groundedFoot={...fakeFoot,userData:{groundSupportBox:{min:{x:-.1,y:-.1,z:-.2},max:{x:.1,y:.1,z:.2}}},
  matrixWorld:{elements:new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,.1,1,1])},onBeforeRender(){},onAfterRender(){}};
const elevatedEye={isPerspectiveCamera:true,matrixWorld:{elements:new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,2,4,1])}};
const floorRoot={matrixWorld:{elements:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}};
makePush(renderThree,renderState,floorRoot,null,false)(groundedFoot);
const plantedMatrix=Array.from(groundedFoot.matrixWorld.elements);
groundedFoot.onBeforeRender(null,null,elevatedEye);
assert(Math.abs(groundedFoot.userData.groundDepthFactor-1)<1e-7,'a planted sole cannot be pushed below ground');
groundedFoot.onAfterRender();
assert.deepEqual(Array.from(groundedFoot.matrixWorld.elements),plantedMatrix,'the draw hook restores the original planted matrix');
groundedFoot.matrixWorld.elements[13]=.3;
const liftedMatrix=Array.from(groundedFoot.matrixWorld.elements);
groundedFoot.onBeforeRender(null,null,elevatedEye);
const e=groundedFoot.matrixWorld.elements, k=groundedFoot.userData.groundDepthFactor;
assert(k>1,'a raised foot retains available depth covering');
assert(e[13]-.1*e[5]>=-1e-6,'depth bias respects the true scaled bottom');
assert(Math.abs(e[14]-(4+(liftedMatrix[14]-4)*k))<1e-6,'the capped transform still preserves perspective projection');
groundedFoot.onAfterRender();
assert.deepEqual(Array.from(groundedFoot.matrixWorld.elements),liftedMatrix,'the capped draw restores the raised foot matrix');
console.log('PASS Headtaker feet reach spine/shoulder portrait contacts, bypass pants occlusion; ordinary gait unchanged');
