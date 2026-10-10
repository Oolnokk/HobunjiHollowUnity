'use strict';
const assert = require('node:assert/strict'); // Checks the production reticle tracker and camera-ray handoff.
const fs = require('node:fs'); // Reads the existing owners instead of duplicating tracking math.
const vm = require('node:vm'); // Supplies deterministic camera projection and frame fixtures.
const game = fs.readFileSync('docs/game.js','utf8'); // Production targeting and reticle-ray source.
class Vector {
  constructor(x=0,y=0,z=0){this.set(x,y,z);}
  set(x,y,z=0){this.x=x;this.y=y;this.z=z;return this;}
  project(camera){this.x=camera.screenX;this.y=camera.screenY;this.z=camera.screenZ;return this;}
} // Deterministic projection isolates elapsed-time tracking from camera positioning.
function tracker(distance=5) {
  const target={x:distance*10,y:0}; // Same projected target location at different gameplay distances.
  const context={THREE:{Vector2:Vector,Vector3:Vector},TILE:10,player:{x:0,y:0},mobileArchCombatAim:null,meleeAttackFacingCommit:null,meleeAttackCurrentlyActive:()=>false,_screenCenterNDC:new Vector(),mobileAutoTargetEnabled:()=>true,findAutoTarget:()=>target,autoTargetVisible:()=>!target.blocked,isDesktop:false,menuOpen:false,dialogueOpen:false,sitInteraction:null,farmEditMode:false,characterViewMode:{enabled:false},camera:{screenX:0.8,screenY:0.4,screenZ:0,updateMatrixWorld(){}},window:{FormatUtils:{clamp:(v,a,b)=>Math.max(a,Math.min(b,v))}},activeSurfaceYAtWorld:()=>0,_cachedPerspectiveTargetAt:1}; // Minimal surface required by the real continuous tracker.
  vm.createContext(context);
  const start=game.indexOf('      const mobileAutoReticleNDC'); // Executes state and tracker from the production owner.
  vm.runInContext(game.slice(start,game.indexOf('      function autoTargetCandidateValid(',start)),context);
  context.target=target;
  return context;
}
const close=tracker(0.5), far=tracker(8); // Distance is the only difference between tracking fixtures.
close.updateMobileAutoTargetReticle(1/60);far.updateMobileAutoTargetReticle(1/60);
assert(close.currentCombatReticleNDC().x>0&&close.currentCombatReticleNDC().x<far.currentCombatReticleNDC().x,'close target tracks more slowly');
assert(far.currentCombatReticleNDC().x<0.8,'first frame cannot snap to target');
const sixty=tracker(), thirty=tracker(); // Compare equal elapsed time across common mobile frame rates.
for(let i=0;i<60;i++)sixty.updateMobileAutoTargetReticle(1/60);
for(let i=0;i<30;i++)thirty.updateMobileAutoTargetReticle(1/30);
assert(Math.abs(sixty.currentCombatReticleNDC().x-thirty.currentCombatReticleNDC().x)<1e-10,'tracking is frame-rate independent');
const before=sixty.currentCombatReticleNDC().x; // A moving target must leave a real tracking error.
sixty.camera.screenX=-0.8;sixty.updateMobileAutoTargetReticle(1/60);
assert(sixty.currentCombatReticleNDC().x<before&&sixty.currentCombatReticleNDC().x>-0.8,'sidestep is followed gradually');
sixty.target.blocked=true;
const blocked=sixty.currentCombatReticleNDC().x; // Obstruction pauses tracking without discarding lock identity.
sixty.updateMobileAutoTargetReticle(1/60);
assert.equal(sixty.currentCombatReticleNDC().x,blocked);
sixty.target.blocked=false;sixty.camera.screenZ=2;sixty.updateMobileAutoTargetReticle(1/60);
assert.equal(sixty.currentCombatReticleNDC().x,blocked,'behind-camera projection cannot flip the sight');
sixty.mobileArchCombatAim={angle:1};
assert.equal(sixty.currentCombatReticleNDC().x,0,'manual drag owns aim immediately, before the next frame');
sixty.updateMobileAutoTargetReticle(1/60);
assert.equal(sixty.currentCombatReticleNDC().x,0,'tracker does not fight dragged attack aim');
sixty.mobileArchCombatAim=null;sixty.meleeAttackFacingCommit={angle:1};sixty.meleeAttackCurrentlyActive=()=>true;
sixty.updateMobileAutoTargetReticle(1/60);
assert.equal(sixty.currentCombatReticleNDC().x,0,'released heavy attack retains its manual windup/strike aim');
sixty.meleeAttackFacingCommit=null;sixty.findAutoTarget=()=>null;sixty.updateMobileAutoTargetReticle(1/60);
assert.equal(sixty.currentCombatReticleNDC().x,0,'no eligible target restores center');

const rayFixture=tracker(); // Eased HUD coordinates are fed straight to the existing camera raycaster.
rayFixture.updateMobileAutoTargetReticle(1/60);
rayFixture.activeCameraMode='orbit';rayFixture.SHOULDER_SURF_MODE='shoulder';rayFixture.heldMode='tool';rayFixture.activeTool='weapon';rayFixture.equipmentSlots={weapon:'sword'};
let usedNDC=null; // Captures the production camera-ray input.
rayFixture._shoulderSurfReticleRaycaster={setFromCamera(ndc){usedNDC={x:ndc.x,y:ndc.y};},ray:{origin:{x:1,y:2,z:3},direction:{x:0.1,y:0.2,z:-0.9}}};
const rayStart=game.indexOf('      function currentPlayerAimRay()'); // No direct target vector may replace the reticle ray.
vm.runInContext(game.slice(rayStart,game.indexOf('      function currentPlayerInteractionRay()',rayStart)),rayFixture);
assert.equal(rayFixture.currentPlayerAimRay().direction.x,0.1,'attack retains the existing raycaster direction');
assert.equal(usedNDC.x,rayFixture.currentCombatReticleNDC().x,'raycaster uses the partially aligned visible reticle');
rayFixture.mobileArchCombatAim={angle:Math.PI/2};
assert(Math.abs(rayFixture.currentPlayerAimRay().direction.x)<1e-10,'manual ranged/heavy yaw bypasses automatic tracking');
assert.equal(usedNDC.x,0,'manual stick ray uses the manual center sight');

for(const file of ['docs/js/combat/ranged-hud-reticle.js','docs/js/combat/melee-hud-reticle.js']) {
  const source=fs.readFileSync(file,'utf8'); // Execute each real HUD positioning block with a shared offset.
  const start=source.indexOf('    const reticleNDC =');
  const end=source.indexOf(file.includes('melee-')?'    const slotProfiles =':'    const wouldHit =',start);
  let writes=0; // Repeating a stationary position must not enqueue DOM mutations.
  const style=new Proxy({},{set(o,k,v){writes++;o[k]=v;return true;}});
  const context={window:{Combat:{deps:{getCombatReticleNDC:()=>({x:0.4,y:-0.2})}}},image:{style},root:{style}};
  vm.runInNewContext('{'+source.slice(start,end)+'}',context);
  assert.equal(style.left,'70%');assert.equal(style.top,'60%');assert.equal(writes,2);
  vm.runInNewContext('{'+source.slice(start,end)+'}',context);
  assert.equal(writes,2,'stationary sight does not write duplicate styles');
}
console.log('mobile reticle lag, proximity, retention handoff, manual priority, and HUD/ray agreement passed');
