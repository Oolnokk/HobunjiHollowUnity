#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Exercise the real renderer's shared depth-material transaction.
const fs = require('node:fs'); // Read production functions instead of maintaining a second replayer.
const source = fs.readFileSync('docs/js/held-object-render-order.js', 'utf8'); // Source of truth for player/NPC/enemy passes.
function block(begin, end) {
  const a = source.indexOf(begin), b = source.indexOf(end, a + begin.length);
  assert(a >= 0 && b > a, 'shipping helper exists: ' + begin);
  return source.slice(a, b);
} // Bounded extraction avoids starting the browser-only rendering engine.

const outline = new Function(block('  function isAuthoredInkPlane(', '  function enforceHeldMesh(')
  + '\nreturn isAuthoredInkPlane;')();
const inked = [
  { geometry: { type: 'PlaneGeometry' }, userData: {} }, // Tool/weapon and character body PNG.
  { geometry: { type: 'BufferGeometry' }, userData: { isPngPlane: true } }, // Replacement portrait meshes.
  { geometry: { type: 'BufferGeometry' }, userData: { hobunjiWeaponAssemblyPart: true } }, // Flail heads/ropes.
  { geometry: { type: 'BufferGeometry' }, userData: { noOutline: true } }, // Merged tree leaf cards.
  { geometry: { type: 'BufferGeometry' }, userData: { isBillboard: true } }, // Town and farm grass.
  { geometry: { type: 'BufferGeometry' }, userData: { isRichFoliageBillboard: true } }, // Wilderness grass.
]; // Flat authored artwork that must never receive new black shell pixels.
for (const mesh of inked) assert(outline(mesh), 'authored sprites are excluded from generated outlines');
for (const flag of ['hobunjiProceduralHand','hobunjiProceduralFoot']) {
  assert(!outline({ ...inked[0], userData: { [flag]: true } }), 'volumetric ' + flag + ' keeps the shell pass');
}
assert(!outline({ geometry: { type: 'BoxGeometry' }, userData: {} }), '3D furniture keeps its shell');

const enforceSource = block('  function isAuthoredInkPlane(', '  function markHeldPlane(');
const enforce = new Function('h', [
  'const {hasLayer,forEachMaterial,DEFAULT_LAYER,SHELL_LAYER,HELD_OVERLAY_LAYER,LEGACY_HELD_RENDER_ORDER}=h;',
  'let invariantRepairCount = 0;',
  enforceSource,
  'return enforceHeldMesh;'
].join('\n'))({
  hasLayer:(mesh,layer)=>!!(mesh.layers.mask & (1<<layer)),
  forEachMaterial:(material,fn)=>(Array.isArray(material)?material:[material]).forEach(fn),
  DEFAULT_LAYER:0, SHELL_LAYER:1, HELD_OVERLAY_LAYER:29, LEGACY_HELD_RENDER_ORDER:0,
}); // Production held-material/layer enforcement, with no Three.js dependency.
function heldFixture(geometry, userData={}) {
  return {isMesh:true,geometry,userData,material:{depthTest:true},renderOrder:0,
    layers:{mask:3,enable(n){this.mask |= 1<<n;},disable(n){this.mask &= ~(1<<n);}}};
} // Starts with an accidentally enabled shell layer as might happen after a visual rebuild.
const weapon = heldFixture({type:'PlaneGeometry'});
enforce(weapon);
assert.equal(weapon.layers.mask & 2,0,'existing PNG weapons lose only the synthetic shell layer');
assert(weapon.layers.mask & (1<<29),'PNG weapons retain their selective held x-ray layer');
assert(weapon.layers.mask & 1,'PNG weapons retain ordinary color rendering');
const hand = heldFixture({type:'BoxGeometry'}, {hobunjiProceduralHand:true});
enforce(hand);
assert(hand.layers.mask & 2,'hand still receives a volumetric outline');

const shell = block('  function replayShellOutlineXray(', '  function wrappedRender(');
function fixture(failAt=0, useGpuMask=false) {
  let draws=0, clears=0, preparations=0, restorations=0, shellCount=0; // Assert pass budget and cleanup in both success and error paths.
  let internalReplay=false, fullscreenReplayCount=0, shellSceneTraversalsAvoided=0; // Production cumulative diagnostic counters.
  let nonGroundDepthReplayCount=0, shellXrayPassCount=0, shellXrayMeshDrawCount=0; // Tracks real replay outcomes.
  let currentGroundGroup=null; // Tracks active tile/elevation filter for each depth reconstruction.
  let gpuColorWrite=true, gpuLocked=false; // GPU state that must be restored even when a replay draw throws.
  const mats=Array.from({length:3},(_,i)=>({colorWrite:true,depthWrite:false,depthTest:false,marker:i}));
  const parts=mats.map((material,i)=>({isMesh:true,visible:true,material,id:i}));
  const groups=parts.map((mesh,i)=>({meshes:[mesh],regions:[{col:i*5,row:0,elevation:0}]}));
  const scene={background:'sky',autoUpdate:true,overrideMaterial:{isShaderMaterial:true}};
  const oldOverride=scene.overrideMaterial;
  const camera={layers:{mask:2}};
  const renderer={autoClear:true,autoClearColor:true,autoClearDepth:true,autoClearStencil:true,
    shadowMap:{autoUpdate:true},state:useGpuMask ? { buffers: { color: {
      setMask(value) { gpuColorWrite=value; },
      setLocked(value) { gpuLocked=value; },
    } } } : {},clearDepth(){clears++;}};
  const initialMask=camera.layers.mask; // Every renderer property must be restored even after a simulated exception.
  const saveMaterialState=(states,material)=>{
    if(!states.has(material))states.set(material,{
      colorWrite:material.colorWrite,depthTest:material.depthTest,depthWrite:material.depthWrite});
  }; // Shared snapshot policy from the production helper.
  const deps={
    rawRender(_scene,_camera){
      draws++;
      if(_scene.overrideMaterial){
        shellCount++;
        if(useGpuMask) assert.equal(gpuColorWrite,true,'colored shell draws must never inherit the depth mask');
        assert.equal(parts.filter(p=>p.visible).length,1,'one exceptional shell participates per group');
      } else {
        if(useGpuMask) {
          assert.equal(gpuColorWrite,false,'both grouped and restore depth draws are GPU color-masked');
          assert.equal(gpuLocked,true,'depth draws must hold the color mask against Three material overrides');
        } else assert(mats.every(m=>m.colorWrite===false),'fallback world depth draws remain colorless');
        assert(mats.every(m=>m.depthWrite===true),'all group and restore passes use repaired depthWrite');
      }
      if(failAt && draws===failAt)throw Error('simulated draw interruption');
    },
    collectGroundElevationMaterials:()=>mats,
    setGroundElevationFilter:(_materials,group)=>{currentGroundGroup=group;},
    collectShellReplayCandidates:()=>({depth:parts,shell:parts}),
    prepareNonGroundDepthMaterials(_scene,candidates){
      preparations++;
      const states=new Map();
      for(const mesh of candidates){
        saveMaterialState(states,mesh.material);
        mesh.material.colorWrite=false;
        mesh.material.depthWrite=true;
      }
      return states;
    },
    forEachMaterial:(material,fn)=>fn(material),
    saveMaterialState,
    restoreMaterialStates(states){
      restorations++;
      for(const [material,values]of states)Object.assign(material,values);
    },
    hideNonXrayShellMeshes(_scene,keep){
      const saved=new Map();
      for(const mesh of parts)if(!keep.has(mesh)){saved.set(mesh,mesh.visible);mesh.visible=false;}
      return saved;
    },
    restoreVisibility(states){for(const [mesh,v]of states)mesh.visible=v;},
    MASK_ALL:0xffffffff,SHELL_MASK:2,
    nearReplaySupport:()=>null, // No depth-snapshot support in this fake renderer: the original redraw path runs.
    hideColorOnlyHeldVfx:()=>null, // Exercised by test-held-color-only-depth-skip.js.
  }; // Only production dependencies that execute when replay scissoring is disabled.
  const run=new Function('deps','getCounters',[
    'const {nearReplaySupport,rawRender,collectGroundElevationMaterials,setGroundElevationFilter,collectShellReplayCandidates,prepareNonGroundDepthMaterials,forEachMaterial,saveMaterialState,restoreMaterialStates,hideNonXrayShellMeshes,restoreVisibility,hideColorOnlyHeldVfx,MASK_ALL,SHELL_MASK}=deps;',
    'const xrayRule=()=>"original"; // Preserve the original shell test scope; horizon exclusions have their own coverage.',
    'let internalReplay=false,fullscreenReplayCount=0,shellSceneTraversalsAvoided=0,nonGroundDepthReplayCount=0,shellXrayPassCount=0,shellXrayMeshDrawCount=0,shellMaskedDepthDraws=0;',
    block('  function withShellDepthColorMask(', '  // Replays shell outlines for the same meshes'),
    shell,
    'return {invoke:replayShellOutlineXray,counters:()=>({internalReplay,nonGroundDepthReplayCount,shellXrayPassCount,shellXrayMeshDrawCount,shellMaskedDepthDraws})};'
  ].join('\n'))(deps);
  let error=null;
  try{run.invoke(renderer,scene,camera,parts,[],[],false,groups,.02);}catch(e){error=e;}
  assert.equal(preparations,1,'all 3 elevation groups and final depth restore share exactly one material scan');
  assert.equal(restorations,1,'one material restore executes after every replay');
  for(const material of mats){
    assert.equal(material.colorWrite,true,'all material colors restore after replay');
    assert.equal(material.depthWrite,false,'all pre-existing material depth states restore');
    assert.equal(material.depthTest,false,'all depth-test states restore');
  }
  assert(parts.every(p=>p.visible),'all source meshes restore their visibility');
  assert.equal(currentGroundGroup,null,'tile/elevation shader filter is disabled');
  assert.equal(scene.overrideMaterial,oldOverride,'the original shell shader restores');
  assert.equal(scene.background,'sky','sky state restores');
  assert.equal(scene.autoUpdate,true,'matrix-update state restores');
  assert.equal(camera.layers.mask,initialMask,'camera shell mask restores');
  assert.equal(renderer.autoClear,true,'renderer clear settings restore');
  assert.equal(renderer.shadowMap.autoUpdate,true,'shadow state restores');
  assert.equal(gpuColorWrite,true,'depth-replay color mask restores after normal and interrupted renders');
  assert.equal(gpuLocked,false,'GPU color mask lock is released after normal and interrupted renders');
  assert.equal(run.counters().internalReplay,false,'internal replay guard never sticks after a draw failure');
  return {error,draws,clears,preparations,shellCount,counters:run.counters()};
} // Real renderer shell helper with deterministic fake draw calls and material states.
const normal=fixture();
assert.equal(normal.error,null);
assert.equal(normal.draws,7,'3 exceptional groups draw depth and shell plus one shared final depth restore');
assert.equal(normal.clears,4,'3 local depth clears and one final unfiltered depth restore');
assert.equal(normal.shellCount,3,'only the three actual shells are submitted');
assert.equal(normal.counters.nonGroundDepthReplayCount,3,'depth replay diagnostics reflect real groups');
assert.equal(normal.counters.shellXrayPassCount,3,'outline replay diagnostics reflect real groups');

const aborted=fixture(4);
assert.match(String(aborted.error),/simulated draw interruption/,
  'exceptions must still run colorless depth restoration and state cleanup');
assert.equal(aborted.preparations,1,'failed group never triggers redundant material preparation');
const gpuMasked = fixture(0,true);
assert.equal(gpuMasked.error,null);
assert.equal(gpuMasked.counters.shellMaskedDepthDraws,4,
  'three depth rebuilds plus the final restore are masked, while the three shell color draws stay unmasked');
const failedGpuDepth = fixture(3,true);
assert.match(String(failedGpuDepth.error), /simulated draw interruption/,
  'an interrupted GPU-masked elevation depth pass restores color state and scene state');
const failedGpuShell = fixture(4,true);
assert.match(String(failedGpuShell.error), /simulated draw interruption/,
  'an interrupted colored shell pass restores GPU mask and scene state');

console.log('Authored ink shell exclusions and single-transaction multi-elevation depth replay tests passed.');
