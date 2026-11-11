#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Assertions for conservative whole-walker visual culling.
const fs = require('node:fs'); // Evaluate the shipping culler and verify its game-loop integration.
const source = fs.readFileSync('docs/js/npc-view-frustum-cull.js','utf8'); // Production code under test.
const game = fs.readFileSync('docs/game.js','utf8'); // The render-only lifetime boundary.

class Vec3 {
  constructor(x=0,y=0,z=0){this.set(x,y,z);}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
} // Fake renderer world-position primitive.
class Sphere { constructor(center,radius){this.center=center;this.radius=radius;} }
class Matrix4 {
  multiplyMatrices(projection){this.maxX=projection.maxX;return this;}
} // Passes the camera's frame-specific visible-X plane into the fake frustum.
class Frustum {
  setFromProjectionMatrix(matrix){this.maxX=matrix.maxX;return this;}
  intersectsSphere(sphere){return sphere.center.x - sphere.radius < this.maxX;}
} // Conservative fixture: a sphere touching the view edge must remain visible.

const windowLike={THREE:{Frustum,Matrix4,Sphere,Vector3:Vec3}};
new Function('window',source)(windowLike);
const culler=windowLike.NpcViewFrustumCull;
assert(culler,'shipping module exposes a dedicated renderer-only NPC culler');
assert(culler.enabled,'safe off-camera culling starts enabled');
assert(!culler.diagnosticHideAll,'hide-all diagnostics default off');

const scene={isScene:true}, otherScene={isScene:true};
const root=(x,{parent=scene,visible=true}={})=>({
  parent,visible,position:{x,y:0,z:0},
  children:[{isSkinnedMesh:true,frustumCulled:false}], // Actual NPC portrait/pants rigs do not support mesh-level frustum culling.
});
const near=root(2), visible=root(20), offscreen=root(42), hidden=root(43,{visible:false}), elsewhere=root(44,{parent:otherScene});
const huge=root(31);
const walkers=[
  {root:near,area:'town',avatarHeight:1},
  {root:visible,area:'town',avatarHeight:1},
  {root:offscreen,area:'town',avatarHeight:1},
  {root:hidden,area:'town',avatarHeight:1},
  {root:elsewhere,area:'other',avatarHeight:1},
  {root:huge,area:'town',avatarHeight:18,_npcCharacterRigRoot:{scale:{x:3,y:3,z:3}}},
]; // Real walker-shaped objects; area transfers and preexisting hidden actors are intentionally distinct.
const camera={isCamera:true,projectionMatrix:{maxX:25},matrixWorldInverse:{},position:{x:0,y:2,z:0},
  matrixWorld:{elements:[1,0,0,0,0,1,0,0,0,0,1,0,0,2,0,1]},
  updateMatrixWorld(){this.updated=(this.updated||0)+1;},
};
const restore=culler.suspendForRender(walkers,scene,camera);
assert.equal(near.visible,true,'close NPCs retain their full appearance even near camera edge');
assert.equal(visible.visible,true,'in-frustum NPCs retain full animation and equipment');
assert.equal(offscreen.visible,false,'offscreen NPC hides entire uncullable skinned rig');
assert.equal(hidden.visible,false,'pre-hidden gameplay NPC remains untouched');
assert.equal(elsewhere.visible,true,'unrelated scene never changes');
assert.equal(huge.visible,true,'oversized Longoran-like rigs get conservative enlarged bounds');
assert.equal(culler.snapshot().eligible,4,'count only visible scene-owned NPC roots');
assert.equal(culler.snapshot().hidden,1,'only one actual off-camera world rig removed');
restore();
assert.equal(offscreen.visible,true,'world render must restore hidden roots before the next NPC AI update');
assert.equal(hidden.visible,false,'existing hidden flags are never overwritten by restore');

camera.projectionMatrix.maxX=10; // A different camera bearing must change the visible cohort immediately.
const restore2=culler.suspendForRender(walkers,scene,camera);
assert.equal(visible.visible,false,'camera turn hides distant former on-screen NPCs');
restore2();
assert.equal(visible.visible,true,'turn-back visual restoration is reversible');

culler.setDiagnosticHideAll(true);
let undo=culler.suspendForRender(walkers,scene,camera);
assert.equal(near.visible,false,'the explicit diagnostic can isolate NPC rendering while AI stays in the game');
assert.equal(visible.visible,false,'diagnostic covers all scene-owned walkers regardless of view');
assert.equal(hidden.visible,false,'diagnostic never resurrects a pre-hidden NPC');
undo();
assert.equal(near.visible,true);
culler.setEnabled(false);
undo=culler.suspendForRender(walkers,scene,camera);
assert.equal(near.visible,false,'hide-all diagnostic overrides normal frustum A/B setting');
undo();
culler.setDiagnosticHideAll(false);
assert.equal(culler.suspendForRender(walkers,scene,camera),null,
  'disabling normal culling completely opts out of modifying scene graph visibility');
culler.setEnabled(true);

try {
  const undoFailed=culler.suspendForRender(walkers,scene,camera);
  try { throw Error('simulated renderer failure'); }
  finally { undoFailed(); }
} catch(error) { assert.match(String(error),/simulated renderer failure/); }
assert.equal(offscreen.visible,true,'renderer error must never strand an NPC hidden between simulation frames');

assert.match(game,/NpcViewFrustumCull\?\.suspendForRender\?\.\(npcWalkers, activeScene, camera\)/,
  'game world render invokes one coarse cull across all its draw/depth/outline passes');
assert.match(game,/\} finally \{\s*restoreNpcVisuals\?\.\(\)/,
  'all camera-visible NPC roots are restored in a finally block');
assert.match(fs.readFileSync('docs/js/house-pieces.js','utf8'),/npc-view-frustum-cull\.js\?v=/,
  'core loader delivers the culler before game.js starts');
console.log('NPC view culling: real module, reversible frustum/near/large/area and render-failure tests passed.');
