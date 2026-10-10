'use strict';
const assert = require('node:assert/strict'); // Executes production camera tracking, proximity lag, and manual priority.
const fs = require('node:fs'); // Reads the existing camera/attack owners.
const vm = require('node:vm'); // Supplies deterministic camera-local target coordinates and frame fixtures.
const game = fs.readFileSync('docs/game.js','utf8');
class Vector {
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  applyMatrix4(matrix){return this.set(...matrix.localTarget(this));}
} // Projection seam: production camera errors use real angular geometry below.
function tracker(distance=5) {
  const context={THREE:{Vector3:Vector},TILE:10,player:{x:0,y:0},mobileArchCombatAim:null,meleeAttackFacingCommit:null,meleeAttackCurrentlyActive:()=>false,_screenCenterNDC:{x:0,y:0},findAutoTarget:()=>context.target,autoTargetVisible:()=>!context.target.blocked,isDesktop:false,menuOpen:false,dialogueOpen:false,sitInteraction:null,farmEditMode:false,characterViewMode:{enabled:false},cameraAzimuthOffsetDeg:0,cameraAngleOffsetDeg:0,desiredYaw:0.6,desiredPitch:0.2,camera:{updateMatrixWorld(){}},wrapAzimuthDeg:value=>((value+540)%360)-180,clampCameraPitchOffsetDeg:value=>Math.max(-80,Math.min(80,value)),window:{},activeSurfaceYAtWorld:()=>0,_cachedPerspectiveTargetAt:1,target:{x:distance*10,y:0}}; // Deterministic geometry isolates the tracker from camera collision/layout.
  context.camera.matrixWorldInverse={localTarget(){const yaw=context.desiredYaw+context.cameraAzimuthOffsetDeg*Math.PI/180,pitch=context.desiredPitch+context.cameraAngleOffsetDeg*Math.PI/180;return [Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch)];}};
  vm.createContext(context);
  const start=game.indexOf('      const mobileAutoTargetView');
  vm.runInContext(game.slice(start,game.indexOf('      function autoTargetCandidateValid(',start)),context);
  return context;
}
const close=tracker(0.5),far=tracker(8); // Distance is the only difference between initial tracking cases.
close.updateMobileAutoTargetCamera(1/60);far.updateMobileAutoTargetCamera(1/60);
assert(far.cameraAzimuthOffsetDeg<close.cameraAzimuthOffsetDeg&&close.cameraAzimuthOffsetDeg<0,'close targets turn the camera more slowly');
assert(Math.abs(far.cameraAzimuthOffsetDeg)<0.6*180/Math.PI,'camera cannot snap to target');
assert(far.cameraAngleOffsetDeg<0,'target above center lowers downward pitch');
assert.deepEqual({...far.currentCombatReticleNDC()},{x:0,y:0},'reticle always stays at screen center');
const sixty=tracker(),thirty=tracker(); // Equal elapsed time must produce equivalent camera tracking across mobile frame rates.
for(let i=0;i<60;i++)sixty.updateMobileAutoTargetCamera(1/60);
for(let i=0;i<30;i++)thirty.updateMobileAutoTargetCamera(1/30);
assert(Math.abs(sixty.cameraAzimuthOffsetDeg-thirty.cameraAzimuthOffsetDeg)<1e-9);
const before=sixty.cameraAzimuthOffsetDeg; // Target movement leaves a real angular error instead of instantaneous alignment.
sixty.desiredYaw=-0.6;sixty.updateMobileAutoTargetCamera(1/60);
assert(sixty.cameraAzimuthOffsetDeg>before&&sixty.cameraAzimuthOffsetDeg<0.6*180/Math.PI,'sidestep is tracked gradually');
sixty.target.blocked=true;
const blocked=sixty.cameraAzimuthOffsetDeg; // Obstruction retains selection but pauses camera steering.
sixty.updateMobileAutoTargetCamera(1/60);assert.equal(sixty.cameraAzimuthOffsetDeg,blocked);
sixty.target.blocked=false;sixty.mobileArchCombatAim={angle:1};
sixty.updateMobileAutoTargetCamera(1/60);assert.equal(sixty.cameraAzimuthOffsetDeg,blocked,'heavy/ranged manual stick owns the camera');
sixty.mobileArchCombatAim=null;sixty.meleeAttackFacingCommit={angle:1};sixty.meleeAttackCurrentlyActive=()=>true;
sixty.updateMobileAutoTargetCamera(1/60);assert.equal(sixty.cameraAzimuthOffsetDeg,blocked,'released heavy strike keeps manual authority');
sixty.meleeAttackFacingCommit=null;sixty.window.__mapEditorOrbitActive=true;
sixty.updateMobileAutoTargetCamera(1/60);assert.equal(sixty.cameraAzimuthOffsetDeg,blocked,'map editor camera is not overridden');
sixty.window.__mapEditorOrbitActive=false;sixty.target=null;
sixty.updateMobileAutoTargetCamera(1/60);assert.equal(sixty.cameraAzimuthOffsetDeg,blocked,'no target leaves the camera unchanged');
const behind=tracker();behind.desiredYaw=2.5;behind.updateMobileAutoTargetCamera(1/60);
assert(behind.cameraAzimuthOffsetDeg<0&&Math.abs(behind.cameraAzimuthOffsetDeg)<10,'behind-camera lock turns gradually without flipping');

const orbit=tracker(5); // Model the existing player-centered camera boom rather than an in-place camera rotation.
orbit.camera.matrixWorldInverse.localTarget=(point)=>{
  const a=orbit.cameraAzimuthOffsetDeg*Math.PI/180,t=(32.73+orbit.cameraAngleOffsetDeg)*Math.PI/180,d=14;
  const x=point.x-Math.sin(a)*Math.cos(t)*d,y=point.y-(0.55+Math.sin(t)*d),z=point.z-Math.cos(a)*Math.cos(t)*d;
  return [x*Math.cos(a)-z*Math.sin(a),-x*Math.sin(a)*Math.sin(t)+y*Math.cos(t)-z*Math.cos(a)*Math.sin(t),x*Math.sin(a)*Math.cos(t)+y*Math.sin(t)+z*Math.cos(a)*Math.cos(t)];
};
for(let i=0;i<240;i++)orbit.updateMobileAutoTargetCamera(1/60);
const local=orbit.camera.matrixWorldInverse.localTarget({x:5,y:0.4,z:0}); // Reticle center must actually converge on the prey with the real orbit geometry.
assert(Math.abs(Math.atan2(local[0],-local[2]))<0.01&&Math.abs(Math.atan2(local[1],Math.hypot(local[0],local[2])))<0.01,'camera orbit centers prey horizontally and vertically');

const rayFixture=tracker(); // Actual attacks must keep using the existing fixed-center camera ray.
rayFixture.updateMobileAutoTargetCamera(1/60);
rayFixture.activeCameraMode='orbit';rayFixture.SHOULDER_SURF_MODE='shoulder';rayFixture.heldMode='tool';rayFixture.activeTool='weapon';rayFixture.equipmentSlots={weapon:'sword'};
rayFixture.window.FormatUtils={clamp:(v,a,b)=>Math.max(a,Math.min(b,v))};
let usedNDC=null; // Captures production raycaster input.
rayFixture._shoulderSurfReticleRaycaster={setFromCamera(ndc){usedNDC={x:ndc.x,y:ndc.y};},ray:{origin:{x:1,y:2,z:3},direction:{x:0.1,y:0.2,z:-0.9}}};
const rayStart=game.indexOf('      function currentPlayerAimRay()');
vm.runInContext(game.slice(rayStart,game.indexOf('      function currentPlayerInteractionRay()',rayStart)),rayFixture);
assert.equal(rayFixture.currentPlayerAimRay().direction.x,0.1,'existing camera ray remains attack authority');
assert.deepEqual(usedNDC,{x:0,y:0});
rayFixture.mobileArchCombatAim={angle:Math.PI/2};
assert(Math.abs(rayFixture.currentPlayerAimRay().direction.x)<1e-10,'manual attack yaw still takes priority');
console.log('mobile centered reticle, camera lag/proximity, frame-rate consistency, and manual attack priority passed');
