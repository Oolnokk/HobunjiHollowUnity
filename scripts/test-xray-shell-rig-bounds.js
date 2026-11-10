#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Protects shared player/NPC/hostile x-ray batching with real shipping helpers.
const fs = require('node:fs'); // Reads the actual renderer and rig adapters instead of duplicating algorithms.
const renderer = fs.readFileSync('docs/js/held-object-render-order.js','utf8'); // Current depth-grouping and scissor owner.
const hand = fs.readFileSync('docs/js/procedural-hand-outline-parity.js','utf8'); // Procedural hand pose-parity owner.
const foot = fs.readFileSync('docs/js/procedural-feet-outline-parity.js','utf8'); // Procedural foot pose-parity owner.
function section(a,b) {
  const i=renderer.indexOf(a),j=renderer.indexOf(b,i+a.length);
  assert(i>=0&&j>i,'production renderer boundary: '+a);
  return renderer.slice(i,j);
} // Extracts exact production functions into GPU-free fixtures.

const canBoundCode=section('  function canBoundXrayMesh(', '  function buildXrayGroups(');
const noop=function noop(){}; // The default THREE.Object3D draw hook is safe to project.
const canBound=new Function('isReplayCullable','objectProto',canBoundCode+'\nreturn canBoundXrayMesh;')(
  mesh=>!mesh.isSkinnedMesh&&!mesh.isInstancedMesh&&(!mesh.children||!mesh.children.length),
  {onBeforeRender:noop}
);
const hooked=function hooked(){}; // Recognized hand/foot pose-parity draw hook.
const otherHook=function unknownAnimation(){}; // Arbitrary custom animation must never be assumed projection-safe.
const mkMesh=(hook=null)=>({isMesh:true,children:[],isSkinnedMesh:false,material:{isShaderMaterial:false},
  userData:{},onBeforeRender:hook||noop});
assert(canBound(mkMesh()),'ordinary static weapon sprite stays boundable');
assert(!canBound(mkMesh(otherHook)),'unrecognized dynamic onBeforeRender remains a conservative unbatchable group');
const trusted=mkMesh(hooked);
trusted.__hobunjiXrayBoundParity={hook:hooked,visibleMatrixWorld:{},isFresh:()=>true};
assert(canBound(trusted),'registered procedural hand/foot parity can use its two known matrices');
trusted.onBeforeRender=otherHook;
assert(!canBound(trusted),'later third-party hook automatically invalidates pose-bound trust');
trusted.onBeforeRender=hooked;
trusted.material.isShaderMaterial=true;
assert(!canBound(trusted),'GPU shader deformation still keeps independent conservative occlusion');
assert(!canBound({...trusted,isSkinnedMesh:true}), 'skinned meshes are not treated as rigid');

for (const [label,source] of [['hand',hand],['foot',foot]]) {
  assert.match(source,/Object\.defineProperty\(mesh, '__hobunjiXrayBoundParity'/,
    label+' publishes its bounded hook only from the existing adapter');
  assert.match(source,/previousBefore === THREE\.Object3D\?\.prototype\?\.onBeforeRender/,
    label+' refuses to trust unrelated preexisting animation hooks');
  assert.match(source,/visibleMatrixWorld: state\.visibleMatrixWorld/,
    label+' exposes the matrix that its real secondary draw may restore');
} // Contract is maintained by both player and hostile rig adapters.

class Vec {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  applyMatrix4(m){this.x+=m.dx||0;this.y+=m.dy||0;this.z+=m.dz||0;return this;}
} // Linear orthographic projection sufficient to test two possible matrices.
class Box {
  constructor(){this.min=new Vec();this.max=new Vec();}
  copy(b){this.min.set(b.min.x,b.min.y,b.min.z);this.max.set(b.max.x,b.max.y,b.max.z);return this;}
  applyMatrix4(m){this.min.applyMatrix4(m);this.max.applyMatrix4(m);return this;}
  isEmpty(){return false;}
  expandByScalar(x){this.min.x-=x;this.min.y-=x;this.min.z-=x;this.max.x+=x;this.max.y+=x;this.max.z+=x;return this;}
} // Dynamic shader padding and bounding rectangle use this same Box3 subset.
class Vec4 {
  constructor(x=0,y=0,z=0,w=0){this.set(x,y,z,w);}
  set(x,y,z,w){this.x=x;this.y=y;this.z=z;this.w=w;return this;}
} // Renderer viewport, target extent and scissor rectangle.

const projector=section('  function replayScissorRect(', '  function restoreRendererScissor(');
const project=new Function('Vec','Box','Vec4',[
  'const scissorBox=new Box(),scissorCorner=new Vec(),scissorViewport=new Vec4(),scissorDrawingSize=new Vec4();',
  'const SCISSOR_MARGIN_PX=4;',
  'let lastScissorFailureReason="none",lastReplayScissorCoverage=1,scissorMinimumWorldY=Infinity,scissorTargetWidth=0,scissorTargetHeight=0;',
  projector,
  'return replayScissorRect;'
].join('\n'))(Vec,Box,Vec4);
const view={getRenderTarget(){return {width:100,height:100};},
  getCurrentViewport(v){v.set(0,0,100,100);}};
const camera={isOrthographicCamera:true,isPerspectiveCamera:false,matrixWorldInverse:{},projectionMatrix:{},near:0.1};
const sourceMesh=mkMesh(hooked);
sourceMesh.geometry={boundingBox:{min:new Vec(-.07,-.07,-.07),max:new Vec(.07,.07,.07)}};
sourceMesh.matrixWorld={dx:-.45,dy:0,dz:0}; // Mesh position used for visible-actor bounds before hook.
sourceMesh.__hobunjiXrayBoundParity={hook:hooked,visibleMatrixWorld:{dx:.45,dy:0,dz:0},isFresh:()=>true}; // Pose reused by a near-adjacent outline pass.
const wide=new Vec4();
assert(project(view,camera,[sourceMesh],wide),'projecting known two-pose bounds succeeds');
assert(wide.x<=25&&wide.x+wide.z>=75,'scissor contains BOTH old and new positions even during an animation frame');
sourceMesh.__hobunjiXrayBoundParity.isFresh=()=>false;
const narrow=new Vec4();
assert(project(view,camera,[sourceMesh],narrow),'stale snapshot falls back to current transform');
assert(narrow.z<wide.z,'stale snapshots no longer inflate scissor work');
sourceMesh.__hobunjiXrayBoundParity.isFresh=()=>true;

const shellCode=section('  function wrappedRender(scene, camera) {','  wrappedRender.__hobunjiHeldRenderOrderWrapped');
function shellScenario(withException){
  const metrics={normal:0,depthReplays:0,hidden:[],replayed:[],padding:0};
  const plain=mkMesh(),special=mkMesh(hooked);
  special.__hobunjiXrayBoundParity={hook:hooked,visibleMatrixWorld:{},isFresh:()=>true};
  const held=[plain,special];
  const h={
    internalReplay:false,retiredScenes:{has(){return false;}},originalRender(){metrics.normal++;return 42;},
    scanScene(){},isShellOutlinePass(){return true;},
    heldRegistry:'held',waterOccludedRegistry:'feet',groundRegistry:'ground',topFaceGroundRegistry:'top',
    collectVisible(name){return name==='held'?held:name==='ground'?[{visible:true}]:[];},
    SHELL_LAYER:1,hasLayer(){return true;},
    filterOffscreenReplayMeshes:(camera,parts)=>parts,
    window:{HobunjiHandOutlineParity:{refreshHeldMatrices(){}}},buildXrayGroups:(renderer,scene,camera,meshes)=>{
      return withException?{groups:[{meshes:[special],regions:[{col:1,row:2,elevation:0}]}],ordinary:[plain]}:{groups:[],ordinary:meshes};
    },
    replayScissorEnabled:false,replayScissorRect(){throw Error('unneeded scissor');},
    hideObjects(parts){metrics.hidden=parts.slice();return new Map(parts.map(x=>[x,true]));},
    restoreVisibility(){},replayShellOutlineXray(renderer,scene,camera,parts,ground,top,scissored,groups,padding){metrics.depthReplays++;metrics.replayed=parts.slice();metrics.padding=padding;},
  };
  const setup=new Function('h',[
    'const {internalReplay,retiredScenes,originalRender,scanScene,isShellOutlinePass,heldRegistry,waterOccludedRegistry,groundRegistry,topFaceGroundRegistry,collectVisible,SHELL_LAYER,hasLayer,filterOffscreenReplayMeshes,window,buildXrayGroups,replayScissorEnabled,replayScissorRect,hideObjects,restoreVisibility,replayShellOutlineXray}=h;',
    'let lastShellReplayCandidates=0,lastShellOffscreenFiltered=0,lastShellElevationGroups=0,lastShellFullscreenReason="none",ordinaryShellMeshesDrawnOnce=0,ordinaryShellReplaysAvoided=0;',
    shellCode,
    'return {run:wrappedRender,stats:()=>({ordinaryShellMeshesDrawnOnce,ordinaryShellReplaysAvoided})};'
  ].join('\n'))(h);
  const fakeScene={isScene:true,overrideMaterial:{uniforms:{uThickness:{value:.02}}}};
  const fakeCamera={isCamera:true,layers:{mask:1<<1}};
  assert.equal(setup.run.call({state:{}},fakeScene,fakeCamera),42,'original render result is preserved');
  return {...metrics,stats:setup.stats(),plain,special};
} // Exercises the actual shell entrypoint without WebGL side effects.
const ordinary=shellScenario(false);
assert.equal(ordinary.normal,1,'ordinary actors keep exactly one normal shell draw');
assert.equal(ordinary.depthReplays,0,'all-ordinary NPC crowds skip the extra full-scene depth rebuild');
assert.equal(ordinary.stats.ordinaryShellReplaysAvoided,1,'skips are visible in mobile diagnostics');
const mixed=shellScenario(true);
assert.equal(mixed.normal,1,'mixed crowd retains normal shell pass');
assert.equal(mixed.depthReplays,1,'exceptional floor x-ray still gets dedicated depth');
assert.deepEqual(mixed.hidden,[mixed.special],'ordinary NPC/enemy shells are not removed from the normal pass');
assert.deepEqual(mixed.replayed,[mixed.special],'only the floor-exception part is depth-replayed');
assert.equal(mixed.padding,.04,'two-times hand/foot thickness is accounted for in shell scissor');
console.log('X-ray shell: real ordinary/mixed pass selection, pose-hook trust and dual-matrix scissor tests passed.');
