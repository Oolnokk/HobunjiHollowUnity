#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Protects shared player/NPC/hostile x-ray batching with real shipping helpers.
const fs = require('node:fs'); // Reads the actual renderer and rig adapters instead of duplicating algorithms.
const renderer = fs.readFileSync('docs/js/held-object-render-order.js','utf8'); // Current depth-grouping and scissor owner.
const hand = fs.readFileSync('docs/js/procedural-hand-outline-parity.js','utf8'); // Procedural hand pose-parity owner.
const foot = fs.readFileSync('docs/js/procedural-feet-outline-parity.js','utf8'); // Procedural foot pose-parity owner.
const leg = fs.readFileSync('docs/js/procedural-leg-animation.js','utf8'); // The real foot depth-push callback is installed before parity wrapping.
function section(a,b) {
  const i=renderer.indexOf(a),j=renderer.indexOf(b,i+a.length);
  assert(i>=0&&j>i,'production renderer boundary: '+a);
  return renderer.slice(i,j);
} // Extracts exact production functions into GPU-free fixtures.

const cullableCode=section('  function isReplayCullable(', '  function hasAlternateReplayPose(');
const actualReplayCullable=new Function(cullableCode+'\nreturn isReplayCullable;')(); // The real eligibility policy, including geometry and frustum flags.
const canBoundCode=section('  function canBoundXrayMesh(', '  function buildXrayGroups(');
const noop=function noop(){}; // The default THREE.Object3D draw hook is safe to project.
const canBound=new Function('isReplayCullable','objectProto',canBoundCode+'\nreturn canBoundXrayMesh;')(
  actualReplayCullable,
  {onBeforeRender:noop}
);
const hooked=function hooked(){}; // Recognized hand/foot pose-parity draw hook.
const otherHook=function unknownAnimation(){}; // Arbitrary custom animation must never be assumed projection-safe.
const mkMesh=(hook=null)=>({isMesh:true,visible:true,children:[],isSkinnedMesh:false,isInstancedMesh:false,frustumCulled:true,
  geometry:{morphAttributes:{}},material:{isShaderMaterial:false},userData:{},onBeforeRender:hook||noop});
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

// Confirm the shipping tile-batching algorithm actually consolidates screen-
// separated trusted rigs, rather than merely accepting a marker in isolation.
const groupingCode=section('  function rectsOverlap(', '  function installGroundElevationShader(');
const groupActors=new Function('actorXrayScope','replayScissorRect','isReplayCullable','objectProto',[
  'const XRAY_TILE_RADIUS=1,XRAY_TILE_EDGE_EPSILON=.0001,XRAY_MAX_BATCH_TILES=8,XRAY_ELEVATION_GROUP_EPSILON=.05,XRAY_ELEVATION_TOLERANCE=.18;',
  'let lastElevationReplayGroups=0,lastUnknownElevationMeshes=0,lastXrayTileRegions=0,lastXrayOrdinaryMeshes=0,scissorMinimumWorldY=0;',
  'const xrayGearRect={},xrayGroundRect={};',
  'const pt=()=>({set(x,y,z){this.x=x;this.y=y;this.z=z;}});',
  'const xrayGroundBox={min:pt(),max:pt()};',
  groupingCode,'return buildXrayGroups;'
].join('\n'))(
  mesh=>mesh.scope,
  (_renderer,_camera,meshes,out,worldBox)=>{
    if(worldBox)Object.assign(out,{x:worldBox.min.x,y:worldBox.min.z,z:worldBox.max.x-worldBox.min.x,w:worldBox.max.z-worldBox.min.z});
    else Object.assign(out,{x:meshes[0].x,y:meshes[0].z,z:.12,w:.12});
    return true;
  },
  actualReplayCullable,
  {onBeforeRender:noop},
);
const isolated=Array.from({length:24},(_,i)=>{
  const mesh=mkMesh(hooked);
  mesh.x=i*10+.5;mesh.z=.5;mesh.scope={col:i*10,row:0,elevation:0};
  mesh.__hobunjiXrayBoundParity={hook:hooked,isFresh:()=>true,visibleMatrixWorld:{}};
  return mesh;
}); // Synthetic safe-to-bound hand-like meshes at separated tiles; not a measurement of actual NPC draw calls.
const batch=groupActors({},null,{},isolated);
assert.equal(batch.groups.length,3,'24 spaced trusted rigs share three eight-tile depth builds instead of 24');
assert(batch.groups.every(x=>x.regions.length===8),'shader tile uniform budget remains capped at eight');
const untrusted=isolated.map(mesh=>({...mesh,__hobunjiXrayBoundParity:null}));
assert.equal(groupActors({},null,{},untrusted).groups.length,24,'unknown onBeforeRender hooks keep 24 conservative independent depth draws');
assert.match(leg,/mesh\.onBeforeRender = function footDepthPushBefore\(/,
  'the real leg rig already applies a camera-relative draw-time foot depth push');
assert.match(foot,/if \(!previousBefore \|\| previousBefore === THREE\.Object3D\?\.prototype\?\.onBeforeRender\)/,
  'feet with the earlier depth-push callback must not advertise boundable parity');
const depthPushedFeet=isolated.map(mesh=>({...mesh,__hobunjiXrayBoundParity:null}));
assert.equal(groupActors({},null,{},depthPushedFeet).groups.length,24,
  'a realistic untrusted foot hook cannot claim the hand-only batching benefit');
const overlapping=isolated.slice(0,2).map((mesh,i)=>({...mesh,x:i+.5,z:.5,scope:{col:i,row:0,elevation:0}}));
assert.equal(groupActors({},null,{},overlapping).groups.length,2,'neighboring projected floor exemptions never share a potentially leaking depth buffer');

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
sourceMesh.geometry={boundingBox:Object.assign(new Box(),{min:new Vec(-.07,-.07,-.07),max:new Vec(.07,.07,.07)})};
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

// Earlier visibility culls must not reject a procedural hand just because
// its current mesh matrix is outside while the fresh captured outline matrix
// lies inside. The shared depth-rebuild cull has the same requirement.
const cullingCode=section('  function hasAlternateReplayPose(', '  function applyElevationScissor(');
const rejectCurrentMatrix={
  setFromProjectionMatrix(){},
  intersectsObject(){return false;},
  intersectsSprite(){return false;},
}; // Current pose is outside a camera/sub-frustum; the captured pose may still draw.
const culling=new Function('h',[
  'const {isReplayCullable,participantProjection,participantFrustum,replayCullFrustum,setReplayCullFrustum,elevationScissorRect,scissorTargetWidth,scissorTargetHeight}=h;',
  'let lastReplayCulledCount=0,lastReplayKeptCount=0;',
  cullingCode,
  'return {filterOffscreenReplayMeshes,collectReplayCulled,cullReplayGroup};'
].join('\n'))({
  isReplayCullable:actualReplayCullable,
  participantProjection:{multiplyMatrices(){}},
  participantFrustum:rejectCurrentMatrix,
  replayCullFrustum:rejectCurrentMatrix,
  setReplayCullFrustum:()=>true,
  elevationScissorRect:{x:0,y:0,z:30,w:30},
  scissorTargetWidth:100,scissorTargetHeight:100,
});
const viewCamera={projectionMatrix:{},matrixWorldInverse:{}};
assert.deepEqual(culling.filterOffscreenReplayMeshes(viewCamera,[sourceMesh]),[sourceMesh],
  'fresh captured pose keeps a hand in the shell replay even when its current matrix is off-screen');
const visibleScene={traverseVisible(visitor){visitor(sourceMesh);}};
assert.equal(culling.collectReplayCulled(visibleScene,new Set()).length,0,
  'shared depth rebuild cannot cull a known rig solely by its unrepresentative current pose');
assert.equal(culling.cullReplayGroup(viewCamera,[sourceMesh]).size,0,
  'individual x-ray group depth cannot cull a mesh with a fresh alternate pose');
sourceMesh.__hobunjiXrayBoundParity.isFresh=()=>false;
assert.equal(culling.filterOffscreenReplayMeshes(viewCamera,[sourceMesh]).length,0,
  'stale snapshots re-enable normal camera-frustum pruning');
assert.equal(culling.collectReplayCulled(visibleScene,new Set()).length,1,
  'stale snapshots re-enable normal depth-scissor pruning');
sourceMesh.__hobunjiXrayBoundParity.isFresh=()=>true;

const shellCode=section('  function wrappedRender(scene, camera) {','  wrappedRender.__hobunjiHeldRenderOrderWrapped');
function shellScenario(withException,enableScissor=false){
  const metrics={normal:0,depthReplays:0,hidden:[],replayed:[],padding:0,scissorParticipants:null};
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
    replayScissorEnabled:enableScissor,replayScissorRect(_renderer,_camera,parts){metrics.scissorParticipants=parts.slice();return true;},
    hideObjects(parts){metrics.hidden=parts.slice();return new Map(parts.map(x=>[x,true]));},
    restoreVisibility(){},replayShellOutlineXray(renderer,scene,camera,parts,ground,top,scissored,groups,padding){metrics.depthReplays++;metrics.replayed=parts.slice();metrics.padding=padding;},
  };
  const setup=new Function('h',[
    'const {internalReplay,retiredScenes,originalRender,scanScene,isShellOutlinePass,heldRegistry,waterOccludedRegistry,groundRegistry,topFaceGroundRegistry,collectVisible,SHELL_LAYER,hasLayer,filterOffscreenReplayMeshes,window,buildXrayGroups,replayScissorEnabled,replayScissorRect,hideObjects,restoreVisibility,replayShellOutlineXray}=h;',
    'let lastShellReplayCandidates=0,lastShellOffscreenFiltered=0,lastShellElevationGroups=0,lastShellFullscreenReason="none",ordinaryShellMeshesDrawnOnce=0,ordinaryShellReplaysAvoided=0;',
    'const scissorRect={x:0,y:0,z:100,w:100};',
    shellCode,
    'return {run:wrappedRender,stats:()=>({ordinaryShellMeshesDrawnOnce,ordinaryShellReplaysAvoided})};'
  ].join('\n'))(h);
  const fakeScene={isScene:true,overrideMaterial:{uniforms:{uThickness:{value:.02}}}};
  const fakeCamera={isCamera:true,layers:{mask:1<<1}};
  assert.equal(setup.run.call({state:{scissor(){},setScissorTest(){}}},fakeScene,fakeCamera),42,'original render result is preserved');
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
const tight=shellScenario(true,true);
assert.deepEqual(tight.scissorParticipants,[tight.special],
  'ordinary, possibly unbounded NPC gear cannot widen the special tile-replay scissor');
console.log('X-ray shell: real shell/cull predicates, ordinary/mixed replay, safe hand-vs-foot trust, and bounded scissor tests passed.');
