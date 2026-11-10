'use strict';
// Global 60% geometry setting: browser-independent test of the REAL render-only
// swap lifecycle. Collision/raycast geometry must remain original outside render.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const script=path.resolve(__dirname,'../docs/js/geometry-auto-lod.js');
const source=fs.readFileSync(script,'utf8');
const index=fs.readFileSync(path.resolve(__dirname,'../docs/index.html'),'utf8');
assert.match(index,/id="settingGeometryAutoOptimize"/);
assert.match(index,/id="geometryAutoLODStatus"/);
assert.match(index,/js\/geometry-auto-lod\.js\?v=/);
assert.match(source,/GeometryWorkshopCore\.reduceGeometry\(geo, TARGET_REDUCTION, MAX_SIMPLIFY_ERROR\)/);
assert.doesNotMatch(source,/THREE\.WebGLRenderer\s*=/,'never rewrap the WebGLRenderer constructor');
assert.match(source,/if \(!enabled \|\| !scan \|\| scanScheduled\) return;/,'discovery scan must run before WASM is ready');
assert.doesNotMatch(source,/if \(!enabled \|\| !ready \|\| !scan \|\| scanScheduled\)/,'no circular readiness dependency during discovery');
execFileSync(process.execPath,['--check',script],{stdio:'pipe'});
const callbacks=[]; // Simulated idle scheduler used to distinguish render work from background simplification.
const mem=new Map(); // LocalStorage contract for the experimental setting.
let timestamp=10000, simplifyCount=0, lastReducerArgs=null, rendered=[];
const control={checked:false,dataset:{},addEventListener(type,fn){this.listener=fn;}};
const status={textContent:''};
const inputs={settingGeometryAutoOptimize:control,geometryAutoLODStatus:status};
const actualOriginal={isBufferGeometry:true,index:{count:900,version:0},drawRange:{start:0,count:Infinity},
  groups:[],attributes:{position:{itemSize:3,count:300,version:0,array:new Float32Array(900)}},
  getAttribute(name){return this.attributes[name];}};
function mesh(name, material, additions={}){
  return {name,isMesh:true,visible:true,geometry:actualOriginal,
    material:material||{opacity:1,visible:true,transparent:false,alphaTest:0},userData:{},...additions};
}
const a=mesh('one'),b=mesh('two'),
  authored=mesh('prebaked-source',null,{userData:{geometryQualityGLBSource:true}}),
  alpha=mesh('alpha',{opacity:1,visible:true,transparent:true}),
  collision=mesh('collision',null,{userData:{isCollisionMesh:true}}),
  skinned=mesh('skinned',null,{isSkinnedMesh:true});
const scene={isScene:true,visible:true,children:[a,b,authored,alpha,collision,skinned]};
for(const m of scene.children)m.parent=scene;
const nativeRender=function(){
  for(const mesh of scene.children)rendered.push({name:mesh.name,geo:mesh.geometry});
  return 'rendered';
};
const renderer={render:nativeRender};
const root={
  THREE:{BufferGeometry:function(){}},
  MeshoptSimplifier:{supported:true,simplify(){},ready:Promise.resolve()},
  GeometryWorkshopCore:{reduceGeometry(geometry,reduction,error) {
    assert.equal(reduction,60);assert.equal(error,.02);
    assert.strictEqual(geometry,actualOriginal,'simplify must receive original mesh data');
    simplifyCount++;lastReducerArgs={reduction,error};
    return {...geometry,index:{count:360},dispose(){this.disposed=true;}};
  }},
  localStorage:{getItem:k=>mem.get(k)??null,setItem(k,v){mem.set(k,String(v));}},
  document:{readyState:'complete',getElementById:id=>inputs[id]||null},
  performance:{now:()=>++timestamp},
  requestIdleCallback(fn){callbacks.push(fn);},
  setTimeout(fn){callbacks.push(fn);},
  __hobunjiGameRenderer:renderer,
};
new Function('window',source)(root);
const lod=root.GeometryAutoLOD;
assert.ok(lod);
assert.equal(lod.isEnabled(),false,'safe default is off');
assert.equal(lod.protectedMesh(alpha),true);
assert.equal(lod.protectedMesh(collision),true);
assert.equal(lod.protectedMesh(skinned),true);
assert.equal(lod.protectedMesh(a),false);
assert.equal(lod.protectedMesh(authored),true,'GLBs must not be reduced again at runtime');
(async()=>{
  lod.setEnabled(true);
  await new Promise(resolve=>setImmediate(resolve)); // Wait for ready optimizers and renderer attachment.
  assert.equal(lod.snapshot().ready,false,'prebaked mode must not download WASM eagerly');
  assert.equal(mem.get('hobunjiGlobalGeometryOptimize60.v1'),'true');
  assert.equal(renderer.render(scene,{}),'rendered');
  assert.equal(rendered[0].geo,actualOriginal,'no heavy geometry changes synchronously in the render call');
  assert.equal(simplifyCount,0,'the render path cannot invoke meshoptimizer');
  let steps=0;
  while(lod.snapshot().processed===0 && steps++<100){
    while(callbacks.length)callbacks.shift()({timeRemaining:()=>5});
    // Loading WASM is asynchronous, and the first pass merely SCANS for
    // procedural meshes. Only a later idle slice may simplify the geometry.
    await new Promise(resolve=>setImmediate(resolve));
  }
  assert.ok(steps<100,'idle work must finish rather than recurse forever');
  assert.equal(lod.snapshot().ready,true,'optimizer initializes only after eligible procedural discovery');
  assert.equal(simplifyCount,1,'shared geometry simplified once for multiple meshes');
  assert.equal(lod.snapshot().processed,1);
  assert.equal(lod.snapshot().sourceTriangles,300);
  assert.equal(lod.snapshot().optimizedTriangles,120);
  rendered=[];
  renderer.render(scene,{});
  assert.equal(rendered[0].geo.index.count,360,'opaque mesh one uses reduced triangles in render');
  assert.equal(rendered[1].geo.index.count,360,'opaque mesh two uses the cached simplified geometry');
  assert.equal(rendered[2].geo,actualOriginal,'authored GLB stays intact; precomputed variant is selected while loading');
  assert.equal(rendered[3].geo,actualOriginal,'transparent mesh stays intact');
  assert.equal(rendered[4].geo,actualOriginal,'collision proxy stays intact');
  assert.equal(rendered[5].geo,actualOriginal,'skinned mesh stays intact');
  assert.equal(a.geometry,actualOriginal,'the source is restored immediately after render');
  assert.equal(b.geometry,actualOriginal,'shared source is restored');
  assert.equal(lod.snapshot().lastDrawSaved,360,'two rendered copies each avoid 180 triangles');
  assert.equal(lod.snapshot().lastRenderMeshes,2);
  // Toggle off immediately, including future renders, without discarding game geometry.
  lod.setEnabled(false);
  rendered=[];
  renderer.render(scene,{});
  assert.ok(rendered.every(x=>x.geo===actualOriginal));
  assert.equal(mem.get('hobunjiGlobalGeometryOptimize60.v1'),'false');
  lod.setEnabled(true);
  await new Promise(resolve=>setImmediate(resolve));
  rendered=[];
  renderer.render(scene,{});
  assert.equal(rendered[0].geo.index.count,360,'re-enable reuses cached mesh without re-decimating');
  assert.equal(simplifyCount,1);
  assert.ok(status.textContent.includes('60%')===false || status.textContent.length>10);
  // A separately loaded authored GLB retains its original geometry for
  // raycasts/physics. The precomputed candidate may replace it ONLY during
  // renderer.render, using the same scene-scan ownership as procedural LODs.
  const authoredGeometry = { ...actualOriginal, index:{count:900,version:0},
    attributes:{position:actualOriginal.attributes.position},
    getAttribute(name){return this.attributes[name];} };
  const bakedGeometry = { ...authoredGeometry,index:{count:360,version:0},
    attributes:{position:authoredGeometry.attributes.position},dispose(){this.disposed=true;} };
  authored.geometry = authoredGeometry;
  const bakedMesh = { ...authored,geometry:bakedGeometry };
  const originalAsset = { scene:{traverse(fn){fn(authored);} } };
  const optimizedAsset = { scene:{traverse(fn){fn(bakedMesh);} } };
  assert.equal(lod.registerPrebaked(originalAsset,optimizedAsset),1);
  assert.equal(lod.snapshot().prebakedRegistered,1);
  assert.equal(authored.geometry,authoredGeometry,'registration never swaps collision geometry');
  rendered=[];
  renderer.render(scene,{});
  for(let i=0;i<6&&callbacks.length;i++) while(callbacks.length)callbacks.shift()({timeRemaining:()=>5});
  rendered=[];
  renderer.render(scene,{});
  assert.equal(rendered[2].geo,bakedGeometry,'authored GLB uses offline-baked buffer solely during draw');
  assert.equal(authored.geometry,authoredGeometry,'source restored for raycasts and interactions immediately afterward');
  assert.equal(lod.snapshot().lastDrawSaved,540,'render savings include cached procedural + precomputed authored triangles');
  assert.equal(simplifyCount,1,'precomputed GLBs never invoke meshoptimizer again');
  lod.setEnabled(false);
  rendered=[];
  renderer.render(scene,{});
  assert.equal(rendered[2].geo,authoredGeometry,'disabling mode immediately restores original authored GLB for drawing too');
  lod.setEnabled(true);
  console.log('Global pre-baked geometry 60%: lazy optimizer, authored GLB exclusion, preserved physics, idle-only procedural cache and live toggle OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
