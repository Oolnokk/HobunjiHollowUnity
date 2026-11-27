'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const code = fs.readFileSync('docs/js/distant-scenery-view-cull.js', 'utf8'); // Shipping culler, not a copied test algorithm.
const instanced = fs.readFileSync('docs/js/instanced-mesh-view-cull.js', 'utf8'); // Existing render scope must restore distant scenery in finally.
const actors = fs.readFileSync('docs/js/actor-render-occlusion.js', 'utf8'); // Shared after-base depth slot must submit GPU proxies.
const loader = fs.readFileSync('docs/js/environment-surface-runtime.js', 'utf8'); // Both scenery owners load before the new culler.
assert.match(instanced, /DistantSceneryViewCull\?\.suspendForRender/, 'new culler must participate in the existing render-only scope');
assert.match(instanced, /sceneryRestore\?\.\(\)/, 'temporarily hidden scenery must be restored on world-render completion');
assert.match(actors, /DistantSceneryViewCull\?\.probeAfterBase/, 'GPU depth queries must run only after the opaque base pass');
assert(loader.indexOf("'WesternSlopeMountainBackdrops'") < loader.indexOf("'NorthernCliffsPlateauBackdrop'"));
assert(loader.indexOf("'NorthernCliffsPlateauBackdrop'") < loader.indexOf("'DistantSceneryViewCull'"));

class V {
  constructor(x=0,y=0,z=0) { this.x=x;this.y=y;this.z=z; }
  clone() {return new V(this.x,this.y,this.z);}
  copy(v) {this.x=v.x;this.y=v.y;this.z=v.z;return this;}
  set(x,y,z) {this.x=x;this.y=y;this.z=z;return this;}
  distanceToSquared(v) {return (this.x-v.x)**2+(this.y-v.y)**2+(this.z-v.z)**2;}
}
class Q {
  clone() {return new Q();}
  copy() {return this;}
  dot() {return 1;}
}
class Box3 {
  constructor() {this.min=new V(Infinity,Infinity,Infinity);this.max=new V(-Infinity,-Infinity,-Infinity);}
  setFromObject(obj) {
    const b=obj.userData.testBounds;
    assert(b,'test scene objects need a known world-space bounding volume');
    this.min.copy(b.min);this.max.copy(b.max);return this;
  }
  isEmpty() {return this.min.x>this.max.x;}
  getCenter(out) {return out.set((this.min.x+this.max.x)/2,(this.min.y+this.max.y)/2,(this.min.z+this.max.z)/2);}
  getSize(out) {return out.set(this.max.x-this.min.x,this.max.y-this.min.y,this.max.z-this.min.z);}
  distanceToPoint(v) {
    const dx=Math.max(this.min.x-v.x,0,v.x-this.max.x);
    const dy=Math.max(this.min.y-v.y,0,v.y-this.max.y);
    const dz=Math.max(this.min.z-v.z,0,v.z-this.max.z);
    return Math.hypot(dx,dy,dz);
  }
}
class Matrix4 {
  multiplyMatrices() {return this;}
}
class Frustum {
  setFromProjectionMatrix() {
    // The fifth plane rejects ALL distant scenery as if beyond camera.far.
    // The new culler must ignore that plane while preserving the other five.
    this.planes=[
      {normal:{x:1,y:0,z:0},constant:100},
      {normal:{x:-1,y:0,z:0},constant:100},
      {normal:{x:0,y:1,z:0},constant:100},
      {normal:{x:0,y:-1,z:0},constant:100},
      {normal:{x:0,y:0,z:-1},constant:-500},
      {normal:{x:0,y:0,z:1},constant:200},
    ];
    return this;
  }
}
class Object3D {
  constructor() {
    this.children=[];this.visible=true;this.parent=null;this.userData={};
    this.position=new V();this.scale=new V(1,1,1);
  }
  add(node) {node.parent=this;this.children.push(node);}
  remove(node) {const i=this.children.indexOf(node);if(i>=0)this.children.splice(i,1);node.parent=null;}
  updateWorldMatrix() {}
}
class Scene extends Object3D {}
class Group extends Object3D {}
class Material {
  constructor(options) {Object.assign(this,options);this.userData={};}
}
class Mesh extends Object3D {
  constructor(geometry,material) {super();this.geometry=geometry;this.material=material;}
}
class BoxGeometry {}
const THREE={Vector3:V,Quaternion:Q,Box3,Matrix4,Frustum,Scene,Group,Mesh,MeshBasicMaterial:Material,BoxGeometry,DoubleSide:2};
const gl={
  ANY_SAMPLES_PASSED_CONSERVATIVE:50,QUERY_RESULT_AVAILABLE:100,QUERY_RESULT:101,
  createQuery(){return {ready:false,passed:false};},
  beginQuery(_target,query){this.active=query;},
  endQuery(){this.active.ready=true;this.active=null;},
  getQueryParameter(query,kind){return kind===this.QUERY_RESULT_AVAILABLE?query.ready:query.passed;},
  deleteQuery(query){query.deleted=true;},
};
const renderer={
  capabilities:{isWebGL2:true},autoClear:true,shadowMap:{autoUpdate:true},
  getContext(){return gl;},
  render(scene,camera) {
    assert(scene.children.length<=3,'query scene must stay within its existing probe budget');
    assert(camera.layers.mask&1,'proxy render must include the normal world layer');
    for(const proxy of scene.children) if(proxy.visible) {
      assert(proxy.material.colorWrite===false && proxy.material.depthWrite===false,'depth queries may never change the base image');
      assert(proxy.material.userData.depthShader===true,'proxy shader must keep the same background depth as real scenery');
      proxy.onBeforeRender?.();
      proxy.onAfterRender?.();
    }
  },
};
const camera={
  isCamera:true,projectionMatrix:{elements:Array(16).fill(1)},matrixWorldInverse:{},
  position:new V(0,0,0),quaternion:new Q(),layers:{mask:32,enable(n){this.mask|=1<<n;}},
  updateMatrixWorld(){},getWorldPosition(v){return v.copy(this.position);},getWorldQuaternion(q){return q.copy(this.quaternion);},
};
const scene=new Scene();scene.name='Western Slope';
const western=new Group();western.userData={cullBoundsRevision:1};scene.add(western);
const layer=new Group();western.add(layer);
const visibleRock=new Group();visibleRock.userData.testBounds={min:new V(-1,2,-100),max:new V(1,45,-50)};layer.add(visibleRock);
const offscreenRock=new Group();offscreenRock.userData.testBounds={min:new V(400,2,-100),max:new V(500,45,-50)};layer.add(offscreenRock);
const northScene=new Scene();northScene.name='Northern Cliffs';
const plateau=new Group();northScene.add(plateau);
const mesa=new Mesh(null,null);mesa.userData.testBounds={min:new V(-60,0,-195),max:new V(60,80,-24)};plateau.add(mesa);
const window={
  THREE,
  WesternSlopeMountainBackdrops:{
    getActiveRoot:()=>western.parent?western:null,
    keepInFrontOfSky(material){material.userData.depthShader=true;},
  },
  NorthernCliffsPlateauBackdrop:{getActiveRoot:()=>plateau.parent?plateau:null},
};
vm.runInNewContext(code,{window,Math,Number,Object,Map,Array,WeakSet,String,Error});
const cull=window.DistantSceneryViewCull;
assert(cull?.installed);
const enter=()=>cull.suspendForRender(scene,camera);
let restore=enter();
assert.equal(visibleRock.visible,true,'a rock beyond camera.far remains visible when it faces the camera');
assert.equal(offscreenRock.visible,false,'a rock outside the side frustum must be hidden before draw submission');
assert.equal(cull.snapshot().frustumHidden,1);
assert.equal(cull.snapshot().candidates,2);
assert.equal(cull.snapshot().submitted,1);
restore();
assert.equal(visibleRock.visible,true);
assert.equal(offscreenRock.visible,true,'gameplay visibility must be restored when the render ends');

// GPU probes run every eight rendered frames; keep the camera fixed long enough
// for two independent negative results, not just two consecutive draw frames.
for(let i=0;i<18;i++) {
  restore=enter();
  cull.probeAfterBase(renderer,camera,scene);
  assert.equal(renderer.autoClear,true,'query pass must restore autoClear');
  assert.equal(camera.layers.mask,32,'query pass must restore camera layer masks');
  assert.equal(renderer.shadowMap.autoUpdate,true,'query pass must restore shadows');
  restore?.();
}
restore=enter();
assert.equal(visibleRock.visible,false,'two available negative GPU depth queries must hide a fully covered rock');
assert.equal(offscreenRock.visible,false,'off-camera rock remains skipped independently');
assert.equal(cull.snapshot().occludedHidden,1);
restore();

camera.position.set(1,0,0); // Movement exceeds the stable-pose reset threshold.
restore=enter();
assert.equal(visibleRock.visible,true,'camera movement invalidates stale occlusion immediately');
restore();

// Repeatedly query more scenery objects than can be submitted in one pass.
const extraRocks=Array.from({length:12},(_,i)=>{
  const rock=new Group();rock.userData.testBounds={min:new V(i,2,-100),max:new V(i+1,45,-50)};
  layer.add(rock);return rock;
});
for(let i=0;i<30;i++){restore=enter();cull.probeAfterBase(renderer,camera,scene);restore?.();}
assert.equal(cull.snapshot().proxySlots,3,'scenery slot pool stays bounded while rotating queries');
assert(cull.snapshot().tracked>=14,'all individual scenery histories remain tracked');
for(const rock of extraRocks)layer.remove(rock);
cull.setGpuEnabled(false);
restore=enter();
assert.equal(visibleRock.visible,true,'WebGL1/disabled-GPU fallback must keep on-screen rock visible');
assert.equal(offscreenRock.visible,false,'frustum culling must still work without GPU queries');
restore();

const before=cull.snapshot().tracked;
assert(before>=2);
western.parent.remove(western); // Simulate exiting Western Slope.
restore=cull.suspendForRender(northScene,camera);
assert.equal(mesa.visible,true,'giant northern mesa must survive camera-far exemption as well');
assert.equal(cull.snapshot().tracked,1,'unloaded western rocks must be pruned from the cache');
restore?.();
northScene.remove(plateau);
cull.suspendForRender(northScene,camera)?.();
assert.equal(cull.snapshot().tracked,0,'the plateau cannot leak after leaving its area');

console.log('Distant scenery offscreen/occluded culling, conservative depth proxies, camera wakeup, and cleanup passed.');

 // Distinct delayed answers must follow scenery identity across borrowed meshes.
 {
  cull.setGpuEnabled(true);scene.add(western);
  const rocks=Array.from({length:12},(_,i)=>{
    const rock=new Group(),x=i%2?10:-10;
    rock.userData.testBounds={min:new V(x-1,2,-100),max:new V(x+1,45,-50)};
    layer.add(rock);return rock;
  });
  let tick=0;
  function delayedGpu(allVisible=false){
    const pending=new Set();
    return {pending,active:null,ANY_SAMPLES_PASSED_CONSERVATIVE:50,QUERY_RESULT_AVAILABLE:100,QUERY_RESULT:101,
      createQuery(){const q={readyAt:Infinity,passed:false};pending.add(q);return q;},
      beginQuery(_,q){assert(pending.has(q)&&!this.active);this.active=q;},
      endQuery(){assert(this.active);this.active.readyAt=tick+5;this.active=null;},
      getQueryParameter(q,key){assert(pending.has(q));if(key===100)return tick>=q.readyAt;assert(tick>=q.readyAt);return q.passed;},
      deleteQuery(q){assert(pending.delete(q));},allVisible};
  }
  let gpu=delayedGpu(),forceFailure=false;const oldGpu=gpu; // Exercise mid-draw failure after slots have been rebound.
  const delayedRenderer={capabilities:{isWebGL2:true},autoClear:true,shadowMap:{autoUpdate:true},getContext:()=>gpu,
    render(queryScene){
      assert(queryScene.children.length<=3);
      for(const proxy of [...queryScene.children].reverse())if(proxy.visible){
        proxy.onBeforeRender();assert(gpu.active);
        gpu.active.passed=gpu.allVisible||proxy.position.x>0;
        if(forceFailure)throw Error('simulated scenery render error');
        proxy.onAfterRender();assert.equal(gpu.active,null);
      }
    }};
  camera.position.set(0,0,0);
  for(tick=0;tick<100;tick++){
    const restore=enter();
    if(tick>65)for(const [i,rock] of rocks.entries())assert.equal(rock.visible,i%2===1,'delayed answer must follow the rock, not the reused proxy');
    cull.probeAfterBase(delayedRenderer,camera,scene);restore?.();
  }
  assert(oldGpu.pending.size>0);
  gpu=delayedGpu(true);
  // Context is detected during the after-base probe, so wakeup is effective at the next frame.
  let restore=enter();cull.probeAfterBase(delayedRenderer,camera,scene);restore?.();
  assert.equal(oldGpu.pending.size,0);
  tick++;restore=enter();assert(rocks.every(rock=>rock.visible));restore?.();
  cull.reset();assert.equal(gpu.pending.size,0);
  assert.equal(cull.snapshot().proxySlots,3);
  forceFailure=true;
  restore=enter();cull.probeAfterBase(delayedRenderer,camera,scene);restore?.();
  assert.equal(gpu.active,null,'fail-open closes the active query');
  assert.equal(gpu.pending.size,0,'fail-open deletes pending queries from all slots');
  assert.equal(cull.snapshot().gpuEnabled,false);
  assert.equal(delayedRenderer.autoClear,true);
  assert.equal(delayedRenderer.shadowMap.autoUpdate,true);
  assert.equal(camera.layers.mask,32);
  assert(rocks.every(rock=>rock.visible),'render failure does not leave scenery hidden after restoration');
  for(const rock of rocks)layer.remove(rock);
  scene.remove(western);
 }
 console.log('Delayed scenery query ownership, reordered draws and context replacement passed.');
