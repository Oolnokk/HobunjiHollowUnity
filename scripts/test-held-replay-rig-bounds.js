#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Protects the shared player/NPC/hostile held-replay scissor and cull helpers with real shipping code.
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

const isAuthoredInkPlane=new Function(section('  function isAuthoredInkPlane(', '  function enforceHeldMesh(')
  + '\nreturn isAuthoredInkPlane;')(); // Production classification for PNG bodies, weapon art and grass/leaf cards.
assert(isAuthoredInkPlane({geometry:{type:'PlaneGeometry'},userData:{}}),
  'PNG weapon planes cannot enter the generated shell pass');
assert(isAuthoredInkPlane({geometry:{type:'BufferGeometry'},userData:{hobunjiPantsGarment:true}}),
  'authored skinned pants grid never enters a generated outline shell');
assert(isAuthoredInkPlane({geometry:{type:'BufferGeometry'},userData:{noOutline:true}}),
  'merged leaf cards marked noOutline remain excluded');
assert(isAuthoredInkPlane({geometry:{type:'BufferGeometry'},userData:{isBillboard:true}}),
  'instanced grass billboards remain excluded');
assert(isAuthoredInkPlane({userData:{hobunjiWeaponAssemblyPart:true}}),
  'modular flail rope and head sprite parts remain excluded');
assert(!isAuthoredInkPlane({geometry:{type:'BufferGeometry'},userData:{hobunjiProceduralHand:true}}),
  'volumetric character hands retain the generated shell');
assert(!isAuthoredInkPlane({geometry:{type:'BufferGeometry'},userData:{hobunjiProceduralFoot:true}}),
  'volumetric character feet retain the generated shell');
assert(!isAuthoredInkPlane({geometry:{type:'BufferGeometry'},userData:{}}),
  'ordinary 3D props keep their authored shell outline behavior');
const cullableCode=section('  function isReplayCullable(', '  function hasAlternateReplayPose(');
const actualReplayCullable=new Function(cullableCode+'\nreturn isReplayCullable;')(); // The real eligibility policy, including geometry and frustum flags.
const noop=function noop(){}; // The default THREE.Object3D draw hook is safe to project.
const hooked=function hooked(){}; // Recognized hand/foot pose-parity draw hook.
const otherHook=function unknownAnimation(){}; // Arbitrary custom animation must never be assumed projection-safe.
const mkMesh=(hook=null)=>({isMesh:true,visible:true,children:[],isSkinnedMesh:false,isInstancedMesh:false,frustumCulled:true,
  geometry:{morphAttributes:{}},material:{isShaderMaterial:false},userData:{},onBeforeRender:hook||noop});
assert.match(leg,/mesh\.onBeforeRender = function footDepthPushBefore\(/,
  'foot pose installs a camera-relative draw-time depth push');
assert.match(leg,/mesh\.onBeforeRender\.__hobunjiScreenSpaceInvariantDepthPush\s*=/,
  'screen-preserving known depth-push hooks receive explicit provenance, not a wildcard trust');
assert.match(leg,/!camera\?\.isPerspectiveCamera/,
  'orthographic cameras skip the camera-scaled depth push');
assert.match(leg,/let k = 1 \+ \(state\.footDepthPush \+ fore\) \/ distance/,
  'the certified push starts from uniform eye-relative scaling');
assert.match(leg,/k = groundSafeDepthFactor\(k, pushCamera\.y, bottom, root\.matrixWorld\.elements\[13\]\)/,
  'the same scale is capped against the world floor before drawing');
assert.match(leg,/e\[column\] \*= k; e\[column \+ 1\] \*= k; e\[column \+ 2\] \*= k/,
  'every spatial matrix column uses the identical capped scale');
for (const [i, axis] of [[12,'x'],[13,'y'],[14,'z']]) {
  assert(leg.includes(`e[${i}] = pushCamera.${axis} + (e[${i}] - pushCamera.${axis}) * k`),
    'all submesh translations scale about the same camera origin, preserving perspective projection');
}
assert.match(foot,/previousBefore\.__hobunjiScreenSpaceInvariantDepthPush === true/,
  'only previously certified foot push hooks may expose safe two-pose scissor bounds');
const trustMatch=foot.match(/if \((!previousBefore[\s\S]*?)\) \{\s*\/\/ The foot-depth push/);
assert(trustMatch,'extract real foot parity registration guard');
const acceptsFootHook = new Function('previousBefore','THREE','return ('+trustMatch[1]+');');
const threeLike={Object3D:{prototype:{onBeforeRender:noop}}};
const knownPush=function knownFootPush(){};
knownPush.__hobunjiScreenSpaceInvariantDepthPush=true;
assert(acceptsFootHook(knownPush,threeLike),'certified depth push unlocks conservative foot batching');
assert(!acceptsFootHook(otherHook,threeLike),'untrusted foot hook still cannot batch');
assert(acceptsFootHook(noop,threeLike),'ordinary foot with no depth push remains safe');
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
const noParity={...sourceMesh,__hobunjiXrayBoundParity:undefined,onBeforeRender:undefined}; // Ordinary NPC weapon without any hook metadata.
assert(project(view,camera,[noParity],new Vec4()),
  'projecting unmarked gear cannot access a missing pose record');

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
  'let lastReplayCulledCount=0,lastReplayKeptCount=0,lastReplayInstancedCulled=0,lastReplayInstancedKept=0,lastReplayInertCount=0;',
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
assert.deepEqual(culling.filterOffscreenReplayMeshes(viewCamera,[noParity]),[],
  'normal off-screen meshes with undefined onBeforeRender must not dereference absent pose metadata');
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

console.log('Held-replay rig bounds: authored-ink classification, hand/foot pose-parity registration, two-pose scissor projection and alternate-pose cull predicates passed.');
