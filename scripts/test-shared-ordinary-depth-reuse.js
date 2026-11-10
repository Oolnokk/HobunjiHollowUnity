#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Verifies the real renderer functions with deterministic WebGL substitutes.
const fs = require('node:fs'); // Reads the shipping renderer, not a copied implementation.
const source = fs.readFileSync('docs/js/held-object-render-order.js', 'utf8'); // Production x-ray contract.

function block(start, end) {
  const i = source.indexOf(start), j = source.indexOf(end, i + start.length);
  assert(i >= 0 && j > i, 'renderer helper boundaries: ' + start);
  return source.slice(i, j);
} // Extracts the actual functions without WebGL initialization.

const supplemental = block('  function replayOrdinaryOccluderDepth(', '  function prepareHeldStencilMaterials(');
const stencilState = new Map(); // Material snapshots used by the production depth-only helper.
let drawCount = 0, failDraw = false; // Counts depth-only draws and verifies exception cleanup.
const world = { PerfProfiler: { begin(){ return null; }, end(){} } }; // Existing optional game profiler.
const forEachMaterial = (material, fn) => (Array.isArray(material) ? material : [material]).forEach(fn);
const saveMaterialState = (states, material) => {
  if (!states.has(material)) states.set(material, { colorWrite:material.colorWrite, depthWrite:material.depthWrite, stencilWrite:material.stencilWrite });
}; // Minimal real material-state contract used by the helper.
const restoreMaterialStates = states => { for (const [m,v] of states) Object.assign(m,v); };
const prepareCutoutDepthMaterials = (cutouts,covers) => {
  const states = new Map();
  for (const mesh of [...covers,...cutouts]) forEachMaterial(mesh.material, material => {
    saveMaterialState(states,material); material.depthWrite = true;
  });
  return states;
}; // Covered alpha-cutouts normally need depthWrite forced on.

const rawRender = function(scene,camera) {
  drawCount++;
  assert.equal(camera.layers.mask, (1 << 29) >>> 0, 'cutout depth uses the private overlay layer');
  assert.equal(scene.background, null, 'ordinary depth repair keeps backdrop disabled');
  if (failDraw) throw Error('simulated WebGL interruption');
}; // Tests the renderer's no-color-write pass and cleanup.
const createSupplemental = new Function('h', 'const {HELD_OVERLAY_LAYER, HELD_OVERLAY_MASK, prepareCutoutDepthMaterials, forEachMaterial, saveMaterialState, restoreMaterialStates, rawRender, window} = h; let ordinaryCutoutDepthPassCount = 0;' + supplemental + 'return replayOrdinaryOccluderDepth;');
const depth = createSupplemental({
  HELD_OVERLAY_LAYER:29, HELD_OVERLAY_MASK:(1 << 29) >>> 0,
  prepareCutoutDepthMaterials, forEachMaterial, saveMaterialState, restoreMaterialStates, rawRender, window:world,
});
const mesh = { isMesh:true,visible:true,layers:{mask:1,enable(n){this.mask |= (1 << n);}},material:{colorWrite:true,depthWrite:false,stencilWrite:true,alphaTest:0.4} }; // NPC sprite occluder.
const camera = { layers:{ mask:1 } }; // Ordinary world camera mask, restored after prepass.
const scene = { background:null }; // Scene already rendered once.
assert.equal(depth({},scene,camera,[],[]),false,'no extra draw without an exceptional occluder');
assert.equal(drawCount,0);
assert.equal(depth({},scene,camera,[mesh],[mesh]),true,'deduplicated depth repair for a PNG that is also a cover');
assert.equal(drawCount,1);
assert.equal(mesh.layers.mask,1,'occluder restores its original render-layer mask');
assert.equal(camera.layers.mask,1,'camera restores original world layer');
assert.equal(mesh.material.colorWrite,true,'depth pass never permanently suppresses color');
assert.equal(mesh.material.depthWrite,false,'depth pass never permanently forces depth writes');
assert.equal(mesh.material.stencilWrite,true,'depth pass never permanently disables existing stencil writes');

failDraw=true;
assert.throws(()=>depth({},scene,camera,[mesh],[]),/simulated WebGL interruption/);
failDraw=false;
assert.equal(mesh.layers.mask,1,'layer cleanup runs even on failed draw');
assert.equal(mesh.material.depthWrite,false,'material cleanup runs even on failed draw');
assert.equal(camera.layers.mask,1,'camera cleanup runs even on failed draw');

const overlay = block('  function replaySelectiveHeldOverlay(', '  function isShellOutlinePass(');
function makeOverlay(groupsBuilder) {
  const metrics = {draws:0,depthClears:0,groundRestores:0,originalDepthReuses:0};
  const win = {PerfProfiler:{begin(){return null;},end(){}}};
  const helper = {
    buildXrayGroups:groupsBuilder, hasOverlappingHeldCover:()=>false,
    collectGroundElevationMaterials:()=>[],setGroundElevationFilter(){},
    replayOrdinaryOccluderDepth(){metrics.originalDepthReuses++;return false;},
    replayScissorEnabled:false, replayScissorRect(){throw Error('unexpected scissor');},
    collectVisible:()=>[], pngDepthRegistry:{}, protectedCoverRegistry:{},
    hideObjects(meshes){const m=new Map();for(const mesh of meshes){m.set(mesh,mesh.visible);mesh.visible=false;}return m;},
    restoreVisibility(states){for(const [mesh,value] of states)mesh.visible=value;},
    prepareSubmergedOverlayStencilMaterials:()=>new Map(),
    prepareNonGroundDepthMaterials:()=>new Map(),
    prepareGroundDepthMaterials(){return new Map();},
    restoreMaterialStates(){},prepareCutoutDepthMaterials(){return new Map();},
    window:win,rawRender(){metrics.draws++;},
    HELD_OVERLAY_MASK: (1 << 29) >>> 0,GROUND_REPLAY_MASK:(1 << 28) >>> 0,
    WATER_REPLAY_MASK:(1 << 27) >>> 0,
  };
  const setup = new Function('h', [
    'const {buildXrayGroups,hasOverlappingHeldCover,collectGroundElevationMaterials,setGroundElevationFilter,replayOrdinaryOccluderDepth,replayScissorEnabled,replayScissorRect,collectVisible,pngDepthRegistry,protectedCoverRegistry,hideObjects,restoreVisibility,prepareSubmergedOverlayStencilMaterials,prepareNonGroundDepthMaterials,prepareGroundDepthMaterials,restoreMaterialStates,prepareCutoutDepthMaterials,window,rawRender,HELD_OVERLAY_MASK,GROUND_REPLAY_MASK,WATER_REPLAY_MASK}=h;',
    'let internalReplay=false,lastBaseElevationGroups=0,lastHeldFullscreenReason="none",lastBaseStencilBits=0,lastScissorFailureReason="none",lastReplayScissorCoverage=1,ordinaryDepthReuseCount=0,scissoredReplayCount=0,fullscreenReplayCount=0,nonGroundDepthReplayCount=0,selectiveOverlayCount=0,groundDepthRestoreCount=0,waterReplayCount=0;',
    'const replayCullEnabled=false; const replayScissorEnabledLocal=false;',
    overlay,
    'return {run:replaySelectiveHeldOverlay,counters:()=>({ordinaryDepthReuseCount,nonGroundDepthReplayCount,groundDepthRestoreCount})};'
  ].join('\n'));
  const test = setup(helper);
  const renderer = {autoClear:true,autoClearColor:true,autoClearDepth:true,autoClearStencil:true,
    state:{},shadowMap:{autoUpdate:true},clearStencil(){},clearDepth(){metrics.depthClears++;}};
  const scene = {background:null,autoUpdate:true}, camera={layers:{mask:1}};
  return {run:(parts)=>test.run(renderer,scene,camera,parts,[],[{isMesh:true}],[],[],1),metrics,counters:test.counters};
} // Mirrors the real synchronous render loop without creating browser/WebGL state.

const ordinaryPart = {visible:true,isMesh:true,name:'hostile_weapon'};
const normal = makeOverlay((_renderer,_scene,_camera,parts)=>({groups:[],ordinary:parts}));
normal.run([ordinaryPart]);
assert.equal(normal.metrics.draws,1,'ordinary-only NPC/enemy gear draws once with intact depth');
assert.equal(normal.metrics.depthClears,0,'no full-scene depth clear for ordinary-only parts');
assert.equal(normal.counters().groundDepthRestoreCount,0,'no unnecessary ground-depth restore');
assert.equal(normal.metrics.originalDepthReuses,1,'incremental PNG/cover repair is called');
assert.equal(ordinaryPart.visible,true,'ordinary held gear visibility is restored');

const xrayPart = {visible:true,isMesh:true,name:'player_hand'};
const mixed = makeOverlay((_renderer,_scene,_camera,parts)=>({
  ordinary:[parts[0]],groups:[{meshes:[parts[1]],regions:[{col:9,row:4,elevation:0}]}]
}));
mixed.run([ordinaryPart,xrayPart]);
assert.equal(mixed.counters().nonGroundDepthReplayCount,1,'true tile x-ray still reconstructs its restricted depth once');
assert.equal(mixed.metrics.depthClears,1,'only genuine x-ray groups clear depth');
assert.equal(mixed.counters().groundDepthRestoreCount,1,'true x-ray groups still restore ground depth');
assert.equal(mixed.metrics.originalDepthReuses,1,'ordinary hostile gear shares depth with player hand x-ray');
assert.equal(mixed.metrics.draws,4,'ordinary color, restricted depth, restricted color, ground restore');
assert.equal(ordinaryPart.visible,true,'hostile gear stays visible in mixed player/enemy frame');
assert.equal(xrayPart.visible,true,'x-ray player hand is restored');

assert(!source.includes('if (ordinary.length) groups.unshift('),
  'ordinary meshes must never re-enter an artificial full-scene reconstruction group');
assert.match(source,/if \(!groups.length\) \{\s*ordinaryShellReuseCount \+= xrayMeshes.length;[\s\S]*?return originalRender.call\(this, scene, camera\);/,
  'ordinary-only shell meshes use the normal scene outline pass');
assert.match(source,/const hiddenXrayShells = hideObjects\(xrayGroupMeshes\)/,
  'shell replay hides only genuine x-ray group meshes, not other actor shells');
console.log('Shared ordinary depth: material/layer cleanup, no-world-replay, mixed x-ray parity and ordinary-shell contract passed.');
