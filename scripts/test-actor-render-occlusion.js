#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Verify production actor visibility and asynchronous query behavior.
const fs = require('node:fs'); // Load the exact shipped module rather than copying its algorithm.
const code = fs.readFileSync('docs/js/actor-render-occlusion.js','utf8'); // Renderer-only NPC/hostile culling source.
const html = fs.readFileSync('docs/index.html','utf8'); // Browser bootstrap must load both culling modules.
const game = fs.readFileSync('docs/game.js','utf8'); // Production world passes must use the actor query for both render modes.
assert(html.includes('js/npc-view-frustum-cull.js?v='),'existing NPC frustum culler is actually loaded');
assert(html.includes('js/actor-render-occlusion.js?v='),'actor GPU occlusion module is actually loaded');
assert(game.includes('window.ActorRenderOcclusion?.beginFrame?.('),'renderWorldPasses enters actor culling');
assert.equal(game.split('window.ActorRenderOcclusion?.probeAfterBase?.()').length-1,2,
  'outlines enabled and disabled both call the depth query');
assert(game.includes('window.ActorRenderOcclusion?.endFrame?.()'),'all world render passes restore actors in finally');


class Vector3 {
  constructor(x=0,y=0,z=0){this.set(x,y,z);}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  copy(v){return this.set(v.x,v.y,v.z);}
  clone(){return new Vector3(this.x,this.y,this.z);}
  distanceToSquared(v){const x=this.x-v.x,y=this.y-v.y,z=this.z-v.z;return x*x+y*y+z*z;}
} // World tile positions used by the existing character roots and camera.
class Quaternion {
  constructor(x=0,y=0,z=0,w=1){Object.assign(this,{x,y,z,w});}
  clone(){return new Quaternion(this.x,this.y,this.z,this.w);}
  copy(q){Object.assign(this,q);return this;}
  dot(q){return this.x*q.x+this.y*q.y+this.z*q.z+this.w*q.w;}
} // The occlusion culler uses only camera-pose dot products.
class Matrix4 {multiplyMatrices(){return this;}}
class Frustum {setFromProjectionMatrix(){return this;} intersectsSphere(s){return s.center.x < 14;}}
class Sphere {constructor(center,radius){this.center=center;this.radius=radius;}}
class Scene {
  constructor(){this.isScene=true;this.children=[];}
  add(m){this.children.push(m);m.parent=this;}
  remove(m){const i=this.children.indexOf(m);if(i>=0)this.children.splice(i,1);m.parent=null;}
} // Distinct main scene and lightweight query scene.
class Mesh {
  constructor(geometry,material){
    this.isObject3D=true;this.geometry=geometry;this.material=material;
    this.position=new Vector3();this.scale=new Vector3(1,1,1);
    this.visible=true;this.frustumCulled=true;this.parent=null;
  }
} // Shared single material/geometry bounding cuboids.
const THREE={
  Sphere,Vector3,Frustum,Matrix4,Quaternion,Scene,Mesh,
  BoxGeometry:class{},MeshBasicMaterial:class{constructor(options){Object.assign(this,options);}},
  DoubleSide:2
}; // Production module runs unchanged with deterministic GPU-free primitives.
const win={THREE};
new Function('window',code)(win);
const api=win.ActorRenderOcclusion; // The actual API loaded by gameplay.
assert(api,'actor culling module installed');

let nextQuery=0, currentQuery=null, drawCalls=0, forcedFailure=false; // Fake WebGL2 query submission/result lifecycle.
const gl={
  ANY_SAMPLES_PASSED_CONSERVATIVE:0x8D6A, QUERY_RESULT_AVAILABLE:1, QUERY_RESULT:2,
  createQuery(){return {id:++nextQuery,passed:false};},
  beginQuery(_target,query){if(currentQuery)throw Error('overlapping queries');currentQuery=query;},
  endQuery(){if(!currentQuery)throw Error('no active query');currentQuery=null;},
  getQueryParameter(query,param){return param===1?true:query.passed;},
  deleteQuery(){},
}; // Query results are asynchronous in browsers; immediate availability here tests the state machine.
const renderer={
  capabilities:{isWebGL2:true}, autoClear:true, shadowMap:{autoUpdate:true},
  getContext(){return gl;},
  render(scene,camera){
    drawCalls++;
    assert.equal(this.autoClear,false,'query pass never clears the real scene depth');
    for(const mesh of scene.children)if(mesh.visible){
      mesh.onBeforeRender?.(this,scene,camera,mesh.geometry,mesh.material);
      if(forcedFailure)throw Error('simulated renderer exception'); // Tests a throw while WebGL2 query is still active.
      mesh.onAfterRender?.(this,scene,camera,mesh.geometry,mesh.material);
    }
  },
}; // One renderer.render for the whole query batch; 8 objects maximum per pass.
const rootScene=new Scene();
const makeRoot=(x,id)=>{const root={isObject3D:true,visible:true,position:new Vector3(x,0,0),parent:rootScene,id};return root;};
const nearRoot=makeRoot(1,'near');
const covered=makeRoot(10,'covered');
const offscreen=makeRoot(25,'offscreen');
const idleBandit=makeRoot(11,'bandit');
const chaseBandit=makeRoot(12,'chase');
const walkers=[
  {root:nearRoot,area:'town'},
  {root:covered,area:'town'},
  {root:offscreen,area:'town'}
]; // Nearby, camera-frustum-included but geometrically blocked, and behind-camera walker.
const hostiles=[
  {avatarRef:{group:idleBandit},areaId:'town',health:100,isBandit:true,state:'idle'},
  {avatarRef:{group:chaseBandit},areaId:'town',health:100,isBandit:true,state:'chase'},
]; // Calm hostile may be safely queried; aggressive threat must remain visibly responsive.
const camera={
  position:new Vector3(),quaternion:new Quaternion(),matrixWorldInverse:new Matrix4(),
  projectionMatrix:new Matrix4(),layers:{mask:1,enable(n){this.mask|=1<<n;}},
  updateMatrixWorld(){}
};
const context=()=>({renderer,scene:rootScene,camera,walkers,hostiles,area:'town',playerPosition:{x:0,z:0}});
const frame=()=>{
  api.beginFrame(context());
  const before=api.snapshot();
  assert.equal(nearRoot.visible,true,'near interaction partner remains drawable');
  assert.equal(offscreen.visible,false,'whole offscreen actor is hidden during ALL render passes');
  assert.equal(chaseBandit.visible,true,'combat threats never disappear from GPU occlusion');
  api.probeAfterBase();
  api.endFrame();
  for(const root of [nearRoot,covered,offscreen,idleBandit,chaseBandit])
    assert.equal(root.visible,true,'render-only hide restores root before AI resumes');
  assert.equal(renderer.autoClear,true,'renderer clears restore');
  assert.equal(renderer.shadowMap.autoUpdate,true,'shadow configuration restores');
  assert.equal(camera.layers.mask,1,'camera layers restore');
  return before;
};
let first=frame();
assert.equal(first.frustumHidden,1,'only the offscreen walker is frustum-hidden');
assert.equal(first.probes,0,'probe-after-base runs separately');
assert.equal(drawCalls,1,'one proxy scene submission for multiple eligible actors');
for(let i=0;i<8;i++)frame();
assert(api.snapshot().results>=4,'async query results are polled without forcing GPU synchronization');
api.beginFrame(context());
assert.equal(covered.visible,false,'two negative conservative queries eventually hide a fully covered NPC');
assert.equal(idleBandit.visible,false,'hostile humanoids share the same occlusion system');
assert.equal(nearRoot.visible,true,'the nearby NPC never gets query-culled');
api.endFrame();

camera.position.set(1,0,0); // Significant motion immediately invalidates the previous hidden results.
api.beginFrame(context());
assert.equal(covered.visible,true,'camera motion wakes an occluded NPC on the next render');
api.endFrame();

// A dialogue camera mounted under another transform must invalidate occlusion
// even when its LOCAL position/quaternion remain unchanged.
api.reset();
camera.position.set(0,0,0);
const cameraWorld = new Vector3(0,0,0);
camera.getWorldPosition = out => out.copy(cameraWorld);
camera.getWorldQuaternion = out => out.copy(camera.quaternion);
for(let n=0;n<9;n++)frame();
api.beginFrame(context());
assert.equal(covered.visible,false,'stable world-camera occlusion can hide a covered NPC');
api.endFrame();
cameraWorld.set(2,0,0);
api.beginFrame(context());
assert.equal(covered.visible,true,'parented camera movement instantly invalidates stale hidden-state');
api.endFrame();

const previouslyHidden={isObject3D:true,visible:false,parent:rootScene,position:new Vector3(3,0,0)};
walkers.push({root:previouslyHidden,area:'town'});
api.beginFrame(context()); api.endFrame();
assert.equal(previouslyHidden.visible,false,'gameplay-owned invisibility is never overwritten');

const status=api.snapshot(); // Mobile Performance diagnostics can surface this without devtools.
assert(status.tracked>=4 && status.enabled && status.gpuAvailable,'tracked/available counts exported');
api.setGpuEnabled(false);
const noGpu=frame();
assert.equal(api.snapshot().gpuAvailable,false,'WebGL1/disabled GPU never hides covered in-frustum rigs');
assert.equal(covered.visible,true,'GPU-disabled fallback renders all in-frustum actors');
assert.equal(noGpu.frustumHidden,1,'GPU-disabled fallback retains robust camera-frustum culling');

api.setGpuEnabled(true);
forcedFailure=true;
api.beginFrame(context());
api.probeAfterBase();
api.endFrame();
forcedFailure=false;
assert(api.snapshot().gpuError,'unexpected WebGL render failure fails open permanently');
assert.equal(currentQuery,null,'exception recovery closes the active WebGL query before normal rendering resumes');
assert.equal(covered.visible,true,'query error restores every NPC visual immediately');
api.setEnabled(false);
assert.equal(api.snapshot().tracked,0,'disabled mode releases all historical actor states');
console.log('Actor occlusion: NPC+hostile frustum, delayed GPU occlusion, camera wakeup, state restoration and WebGL fail-open passed.');
