#!/usr/bin/env node
'use strict';
// Actual Three.js geometry contract for the five physical wilderness blossom trees (not the feast's table vases).
const assert = require('node:assert/strict'); // Checks measured world-scale bounds, distinct leaf canopy and tiny blossom sprigs.
const fs = require('node:fs'); // Reads actual Debris-ifier recipes to test every small chip and shaft's dimensions.
let THREE; // Matches the production foliage-generator runtime.
try { THREE = require('three'); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('skip - wilderness blossom Three.js check (three not installed)');
  process.exit(0);
}
const previousTextureLoad = THREE.TextureLoader.prototype.load; // PNG fetching needs a DOM; the geometry/UVs still use real Three.js.
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
global.window = { THREE, __farmLog() {} };
global.THREE = THREE;
require('../docs/js/foliage-generator.js'); // Use the real generator and its cached variants, not a handcrafted tree fixture.
const generator = window.FoliageGenerator;
require('../docs/js/furniture-pattern-surfaces.js'); // Use the production face projector to verify complete engraving coverage, without needing canvas or WebGL.
require('../docs/js/procedural-furniture.js'); // Build actual source tapered masonry with real material groups, not approximate BoxGeometry fixtures.
assert.ok(generator?.buildWildernessBlossomTreeMesh, 'wilderness builder is exported independently of table flowers');
assert.equal(generator.wildernessBlossomRecipe.map_northern_cliffs.species,'crownedPine');
assert.equal(generator.wildernessBlossomRecipe.map_western_slope.species,'deadTree');
assert.equal(generator.wildernessBlossomRecipe.map_southern_cloud_forest.species,'shadewood');
assert.equal(generator.pottedBlossomRecipe.knotTiers,1,'the feast table flower remains a one-tier sapling');
const nativeForZone = {
  map_northern_cliffs:{id:'cyan',species:'crownedPine',color:'#00ffff',make:()=>generator.buildCrownedPineMesh(12,13)},
  map_western_slope:{id:'white',species:'deadTree',color:'#ffffff',make:()=>generator.buildDeadTreeMesh(12,13)},
  map_southern_cloud_forest:{id:'amber',species:'shadewood',color:'#ff8000',make:()=>generator.buildShadewoodMesh(12,13)}
}; // The three real biome builders are the authoritative non-event counterparts.
for(const [zone,info] of Object.entries(nativeForZone)) {
  const normal = info.make(),first = generator.buildWildernessBlossomTreeMesh('bloom:'+zone,info.color,zone);
  const second = generator.buildWildernessBlossomTreeMesh('bloom:'+zone,info.color,zone);
  const originalBounds = new THREE.Box3().setFromObject(normal);
  const bloomBounds = new THREE.Box3().setFromObject(first);
  const nativeHeight = originalBounds.getSize(new THREE.Vector3()).y;
  const bloomHeight = bloomBounds.getSize(new THREE.Vector3()).y;
  assert.ok(bloomHeight>1.5 && bloomHeight/nativeHeight>0.6 && bloomHeight/nativeHeight<1.6,
    zone+': a single native-scale tree replaces the miniature standalone blossom tree');
  assert.equal(first.userData.wildernessBlossom.nativeSpecies,info.species);
  assert.equal(first.userData.wildernessBlossom.blossomColor,info.color);
  assert.equal(first.userData.wildernessBlossom.unfellable,true,'story locale tree is not a resource for an axe');
  assert.equal(first.userData.unfellableStoryTree,true);
  const petals=first.getObjectByName('wilderness-blossom-sprigs');
  assert.ok(petals?.isMesh && petals.geometry.attributes.uv,zone+': native branches carry tiny leaf-textured clusters');
  assert.ok(petals.geometry.attributes.position.count>=100,zone+': leaf bunches appear on multiple real branches');
  assert.equal(petals.material.color.getHex(),new THREE.Color(info.color).getHex(),'leaf bunches retain the exact temple swatch');
  assert.equal(petals.geometry,second.getObjectByName('wilderness-blossom-sprigs').geometry,
    'each species/color combination reuses cached vertex buffers and one blossom mesh');
  const leaves=first.children.find(child=>child.isMesh && child.userData.noOutline && child!==petals);
  if(info.species==='deadTree') assert.equal(leaves,undefined,'Western Slope keeps native leafless limbs except the blossom leaf bunches');
  else {
    assert.ok(leaves?.material?.map,zone+': ordinary leaf canopy is still present');
    assert.notEqual(leaves.material.color.getHex(),petals.material.color.getHex(),zone+': the whole tree must not turn blossom-colored');
    const anotherLeaves=second.children.find(child=>child.isMesh && child.userData.noOutline && child!==second.getObjectByName('wilderness-blossom-sprigs'));
    assert.equal(leaves.geometry,anotherLeaves.geometry,'native foliage stays instanced by reference');
  }
}
// Exercise the real year-round scenery module against a real Three.js scene, including scene/Shift lifecycle.
async function verifyScenery(){
const scenery = require('../docs/js/wilderness-landmark-scenery.js'); // Built witness stones are the exact physical referents named in saved riddles.
const worldLayout = {
  cols:120, rows:120,
  tiles:Array.from({length:120},()=>Array.from({length:120},()=>({type:'grass',elevTier:1}))), // Large enough that limited dye witness sites do not consume every ordinary cairn.
  localeInstances:[{localeId:'locale_five_blossoms_cyan',x:28,y:28}]
}; // A flat generated wilderness still needs one deterministic, uniquely dyed route anchor.
const zoneId='map_northern_cliffs';
const zoneLayouts=new Map([[zoneId,worldLayout]]);
const scene=new THREE.Scene(); // A real Scene allows the actual InstancedMeshViewCull renderer scope to be checked.
let cycle='1156',decorations=0; // Count projected masonry surfaces across Tothal regeneration.
const sharedStoneArt={geometry:new THREE.CylinderGeometry(.46,.5,1,6),material:new THREE.MeshLambertMaterial({color:0x85857c})};
let sharedStoneDisposed=false; // The real OreRockTextures.smallStoneArt resource is shared by all wilderness cairns.
sharedStoneArt.geometry.addEventListener('dispose',()=>{sharedStoneDisposed=true;});
window.OreRockTextures={smallStoneArt:()=>sharedStoneArt}; // Renderer-provided shared rock art is required for both cairns and the newly engraved witness.
const cliffMaterial=new THREE.MeshBasicMaterial({color:0xffffff,map:new THREE.Texture()}); // Unique proxy for the configured cliff-tinted material.
let cliffNaturalizations=0,cliffUnwraps=0,cullRegistrations=0; // Count one shared UV solve and per-chunk cull registration across scene rebuilds.
window.NaturalSurfaceMaterials={naturalizeMesh(mesh,surface){
  assert.equal(surface,'cliffs','cairns request the same natural-surface classification as wilderness cliffs');
  assert.notEqual(mesh.geometry,sharedStoneArt.geometry,'cliff UVs must never mutate the shared quarry/witness geometry');
  mesh.material=cliffMaterial;mesh.userData.naturalSurface=surface;cliffNaturalizations++;return mesh;
}};
window.HobunjiSurfaceStretchUV={mapMesh(mesh){
  assert.equal(mesh.userData.naturalSurface,'cliffs','the cliff material is assigned before surface-island unwrapping');
  mesh.geometry=mesh.geometry.clone();cliffUnwraps++;
  return {patchCount:8}; // Six polygon walls and two caps use independent full-PNG texture islands.
}};
require('../docs/js/instanced-mesh-bounds.js'); // Use actual r128-compatible local instance bounds, not a tag-only mock.
const realInstanceBounds=window.InstancedMeshBounds;
window.InstancedMeshBounds={...realInstanceBounds,tag(mesh){
  assert.ok(mesh.isInstancedMesh,'only spatial cairn chunks enter the instanced cull registry');
  cullRegistrations++;return realInstanceBounds.tag(mesh);
}}; // Retain the production culler and count its registrations for mobile diagnostics.
require('../docs/js/instanced-mesh-view-cull.js'); // Exercises the real render-only visibility/restore scope.
window.GridTileAccessors={getActiveScene:()=>scene};
window.AuthoredFurniture={
  async load(key){return JSON.parse(fs.readFileSync('docs/config/furniture-authored/'+key+'.json','utf8'));},
  buildGroup(def){const root=new THREE.Group(),parts=new Map();
    for(const part of def.parts){const mesh=window.ProceduralFurniture.buildPartMesh(part);
      assert.ok(mesh.geometry.getAttribute('uv'),'real authored tapered stone must expose source UVs');
      assert.equal(mesh.geometry.groups.length,0,'actual tapered masonry uses one material group: one overlay really is one draw call');
      parts.set(part.id,mesh);root.add(mesh);}
    // Preserve real authored masonry while testing that camera-facing billboards remain exempt from mesh culling.
    const billboard=new THREE.Mesh(new THREE.PlaneGeometry(.4,.4),new THREE.MeshBasicMaterial());
    billboard.userData.billboardSurface=true;billboard.frustumCulled=false;root.add(billboard);
    root.userData.meshById=parts;return root;} // Run production furniture geometry, material, taper, transforms and authored metadata with no independent imitation.
};
window.ClimbSystem={groundYAt:()=>1.25};
const ruinSurfaces=window.FurniturePatternSurfaces; // The real projector is the coverage oracle, not the test's simulated atlas.
window.RuinPatternSurfaceRules={mergedConfig:()=>({defaultScale:4,rules:{}})}; // The canonical intact ruin pillar's four-world-unit motif scale is the source.
window.FurniturePatternSurfaces={
  applyPart(mesh,part) {
    if(!part?.patternSurfaces?.length)return mesh; // The source furniture builds plain before this test's wilderness engraving is applied.
    const patterns=part.patternSurfaces||[],rock=part.kind==='sphere';
    assert.deepEqual(patterns.map(record=>record.selector),rock?['all']:['pillar-wrap'],
      'one engraving covers every source face: original pillar side wrap and both planar cut faces');
    for(const pattern of patterns){
      assert.match(pattern?.patternId||'',/^harlyao_glyph_(entropy|ignorance|servitude)$/,
        'dyed stones reuse an authored Harlyao ruin-wall motif, not a separate decal');
      assert.equal(pattern.mode,'engraving','all projected surfaces use the ruin-wall engraving mode');
      assert.equal(pattern.scale,4,'wilderness debris inherits the original ruin pillar tile-4 layout');
      assert.equal(pattern.layerTransforms,undefined,'native repo motif tiling and placement must not be overwritten');
      assert.equal(pattern.glowIntensity,0,'wilderness masonry engravings must never glow');
      assert.equal(pattern.glowPulseDepth,0,'wilderness masonry must never pulse');
      assert.ok(pattern.maxAtlasPx<=256,'mobile pattern atlases stay bounded');
      assert.match(pattern.palette[1],/^#[0-9a-f]{6}$/i,'engraving ink has the authored dye hex');
      const record=ruinSurfaces.normalize(pattern); // Production geometry projector, not a proxy decal.
      const projected=ruinSurfaces.surfaceGeometry(mesh,record,part);
      assert.ok(projected,'the real ruin surface projector accepts all authored faces');
      const positionCount=mesh.geometry.index?.count||mesh.geometry.attributes.position.count;
      assert.equal(projected.getAttribute('position').count,positionCount,
        'every source triangle has exactly one engraving without face omissions');
      if(!rock){
        const triangleMap=geometry=>{
          const p=geometry.getAttribute('position').array,u=geometry.getAttribute('uv').array,out=new Map();
          for(let i=0;i<p.length/9;i++)out.set(Array.from(p.slice(i*9,i*9+9)).join(','),Array.from(u.slice(i*6,i*6+6)));
          return out;
        }; // Triangle keys let source side/cap layouts be compared regardless of source face order.
        const actual=triangleMap(projected),expected=new Map();
        for(const selector of ['sides','top','bottom']){
          const reference=ruinSurfaces.surfaceGeometry(mesh,{...record,selector},part);
          assert.ok(reference,selector+' must select real authored faces from '+part.id);
          for(const [key,uv] of triangleMap(reference)){
            assert.ok(!expected.has(key),'original pillar reference faces must be disjoint');
            expected.set(key,uv);
          }
          reference.dispose();
        }
        assert.equal(expected.size,actual.size,'original wrapped sides and both ends partition the full authored mesh');
        for(const [key,uv] of expected)assert.deepEqual(actual.get(key),uv,
          'each triangle preserves its original ruin UV, including minuscule chips');
      }
      projected.dispose();
      const engraving=new THREE.Mesh(new THREE.PlaneGeometry(.2,.2),new THREE.MeshBasicMaterial());
      engraving.userData.furniturePattern={mode:'engraving',slot:pattern.slot,patternId:pattern.patternId,status:'ready'};
      mesh.add(engraving);
      decorations++; // One overlay per original fragment, including formerly plain chips.
    }
    return mesh;
  },
  attachStoneSignal(){assert.fail('wilderness landmarks must not receive rune decals or glow effects');}
};
scenery.init({
  _zoneLayouts:zoneLayouts,getCurrentArea:()=>zoneId,
  tothalWorldId:()=> 'test-world',currentTothalYear:()=>cycle,TILE:64
});
scenery.update();
await new Promise(resolve=>setImmediate(resolve)); // Await debrisified pillar model assembly before counting their rendered markings.
const decoratedFor = () => scenery.planForLayout(zoneId,zoneLayouts.get(zoneId),'test-world:'+cycle).filter(x=>x.marked);
const originalMarked=decoratedFor().length; // The planned dye-bearing objects are exactly those the renderer engraves.
const witnessFor = () => scene.getObjectByName('wilderness-dye-inscribed-witness-stone');
let first=witnessFor();
assert.ok(first?.isMesh,'the physically rendered dyed stone exists inside the live wilderness scene');
assert.ok(decorations>originalMarked,'major parts of broken pillars each receive their own ruin pattern, not just one front decal');
const firstCycleDecorations=decorations; // Used to verify cleanup and exactly one rebuild per new Shift.
assert.equal(first.userData.witnessDye.unique,true);
assert.equal(first.children.some(child=>child.userData?.ruinStoneSignalGlyph),false,'the witness has no rune decal');
assert.equal(scenery.debugSnapshot().dyedWitness.fullSurface,true,'mobile debug reports the projected full-surface motif');
assert.equal(scenery.debugSnapshot().dyedWitness.patternScale,4,'mobile debug shows the original pillar repeat size');
assert.equal(scenery.debugSnapshot().dyedWitness.nonGlowing,true,'mobile debug reports non-glowing engraving');
assert.ok(scenery.debugSnapshot().dyedWitness.present,'mobile Dev Companion can verify the rendered rock');
const cairnGroup=scene.getObjectByName('wilderness-stone-cairns'); // Spatial instances are the render-only cull granularity, not one wilderness-wide draw.
const plannedCairns=scenery.planForLayout(zoneId,worldLayout,'test-world:'+cycle).filter(site=>site.kind==='stoneCairn');
const expectedBuckets=new Set(plannedCairns.map(site=>Math.floor(site.point.col/24)+','+Math.floor(site.point.row/24)));
assert.ok(plannedCairns.length>0,'fixture includes actual normal cairns, not only the marked witness stone');
assert.equal(cairnGroup.children.length,expectedBuckets.size,'one independently cullable instance batch per occupied 24-tile cell');
assert.equal(cairnGroup.children.reduce((n,mesh)=>n+mesh.count,0),plannedCairns.length*4,'four stones survive for each cairn');
assert.ok(cairnGroup.children.every(mesh=>mesh.material===cliffMaterial&&mesh.geometry!==sharedStoneArt.geometry),
  'each cairn chunk shares the cliff material and its own mapped geometry, never the quarry geometry');
assert.ok(cairnGroup.children.every(mesh=>mesh.userData.hobunjiInstanceBounds===true
  &&mesh.userData.hobunjiWildernessDistanceCull===true&&mesh.frustumCulled===false),
  'custom instance bounds control frustum/distance culling without unsafe Three r128 geometry-only culling');
assert.equal(cullRegistrations,cairnGroup.children.length,'every spatial chunk is enrolled in the render-only frustum culler');
scene.updateMatrixWorld(true);
const firstStone=plannedCairns[0].point; // Camera aims at one generated cairn while other spatial batches are outside its view.
const camera=new THREE.PerspectiveCamera(48,1,.1,30); // The test camera has a tightly bounded near view, unlike the whole-zone instance union.
camera.position.set(firstStone.col+.5,10,firstStone.row+13);
camera.lookAt(firstStone.col+.5,1,firstStone.row+.5);
const restoreCull=window.InstancedMeshViewCull.suspendForRender(scene,camera);
const hiddenChunks=cairnGroup.children.filter(mesh=>mesh.visible===false);
assert.ok(hiddenChunks.length>0,'the actual view frustum hides at least one off-camera cairn batch');
assert.ok(cairnGroup.children.some(mesh=>mesh.visible!==false),'nearby visible cairn chunks remain drawn');
assert.ok(hiddenChunks.every(mesh=>!window.InstancedMeshBounds.worldSphere(mesh,new THREE.Sphere())
  ||mesh.userData.hobunjiInstanceBounds),'offscreen hides operate on tracked instance spheres');
restoreCull?.();
assert.ok(cairnGroup.children.every(mesh=>mesh.visible===true),'temporary render culling restores all instance visibility for gameplay');
assert.equal(cliffNaturalizations,1,'cliff material assigned once and shared across chunks');
assert.equal(cliffUnwraps,1,'individual rock faces unwrapped once and shared across all chunk instances');
assert.equal(scenery.debugSnapshot().cairnRendering.frustumTracked,expectedBuckets.size,'mobile diagnostics show registered frustum chunks');
assert.equal(scenery.debugSnapshot().cairnRendering.cliffMappedFaces,8,'mobile diagnostics show separate face mapping');
assert.equal(scenery.debugSnapshot().plan.marked.length,originalMarked,'mobile diagnostics enumerate every marked object');
let paintedPillars=0;scene.traverse(node=>{if(node.userData?.wildernessDyeId){paintedPillars++;
  const parts=node.userData.meshById, expected=[...parts.keys()];
  assert.equal(node.userData.wildernessPatternedParts,expected.length,'all original fragments are decorated once, including chips');
  for(const id of expected){
    const target=parts.get(id),children=target.children.filter(part=>part.userData?.furniturePattern);
    assert.deepEqual(children.map(part=>part.userData.furniturePattern.slot),['ruin-pillar-entire-fragment'],
      id+' has one full original-side + both-cap engraving, not two overlapping overlays');
    assert.deepEqual(target.userData.wildernessPatternSurfaces,{expected:1,actual:1,scale:4},
      id+' reports complete original ruin pattern coverage');
  }
}});
assert.ok(paintedPillars>0,'even a small generated area renders colored full-surface pillar patterns');
assert.ok(scenery.debugSnapshot().patternedPillarParts>paintedPillars,'mobile debug counts multi-part masonry patterns');
assert.deepEqual(scenery.debugSnapshot().pillarPatterns,{
  ready:scenery.debugSnapshot().patternedPillarParts,loading:0,failed:0,missing:0
},'mobile debug verifies *visible* atlases on every authored stone, with no missing or failed surfaces');
let preservedBillboards=0; // Count deliberately non-culled special effects that remain attached to debris.
scene.traverse(node=>{if(node.name==='wilderness-broken-stone-pillar')node.traverse(part=>{
  if(!part.isMesh)return;
  if(part.userData?.billboardSurface){
    preservedBillboards++;
    assert.equal(part.frustumCulled,false,'authored camera-facing debris artwork keeps its no-cull override');
    assert.equal(part.userData.hobunjiWildernessDistanceCull,undefined,'billboards do not enter the distance pass');
  }else assert.ok(part.frustumCulled&&part.userData.hobunjiWildernessDistanceCull,
    'ordinary debris-ifier stone geometry receives independent camera and distance culling');
});});
assert.ok(preservedBillboards>0,'debris fixture includes camera-facing visuals as well as masonry');
assert.equal(scenery.debugSnapshot().dyedWitness.engraving,'ready','mobile diagnostics report the actual patterned-child status');
assert.equal(first.geometry,sharedStoneArt.geometry,'witness uses the same natural rubble mesh instead of a new box');
scenery.update();
assert.equal(witnessFor(),first,'unchanged world/layout does not regenerate scenery every frame');
const oldEngraving=first.children.find(child=>child.userData?.furniturePattern).geometry; // The atlas is marker-owned; quarry stone mesh/material are shared.
let disposed=false;
oldEngraving.addEventListener('dispose',()=>{disposed=true;});
cycle='1157';
scenery.update();
await new Promise(resolve=>setImmediate(resolve));
const nextMarked=decoratedFor().length; // The next Shift may distribute a different count among deadwood, pillars and boulders.
assert.notEqual(witnessFor(),first,'a new Tothal generation rebuilds the marker even with the same zone object and scene');
assert.ok(disposed,'the old marker-owned engraving geometry is disposed on Shift');
assert.equal(sharedStoneDisposed,false,'Shift must not dispose shared stone geometry');
assert.equal(cliffNaturalizations,1,'Tothal rebuilds reuse the same cached cliff material');
assert.equal(cliffUnwraps,1,'Tothal rebuilds reuse the same per-face UV geometry');
const secondCycleDecorations=decorations-firstCycleDecorations; // Each newly drawn surface is counted once after cleanup.
assert.ok(secondCycleDecorations>=nextMarked,'the new cycle redraws the full marked-surface set');
const second=witnessFor();
zoneLayouts.set(zoneId,{...worldLayout}); // Same cycle but forced regeneration replaces the workspace object.
scenery.update();
await new Promise(resolve=>setImmediate(resolve));
assert.notEqual(witnessFor(),second,'a forced same-cycle layout replacement also rebuilds the physical riddle witness');
assert.equal(decorations,firstCycleDecorations+secondCycleDecorations*2,
  'same-cycle regeneration uses the same surface projection count on every marked part');
scenery.clear();
assert.equal(witnessFor(),undefined,'leaving a zone removes the marked rock, not a stale hidden decoration');
assert.equal(sharedStoneDisposed,false,'zone cleanup must not dispose the mainline shared quarry art used by other wilderness rocks');
THREE.TextureLoader.prototype.load = previousTextureLoad;
console.log('ok - regional native blossom tree geometry, shared leaf bunches, dyed landmarks and Shift redraw');
}
// Validate actual connected-surface UVs on the same six-sided stone topology before the integration fixture substitutes a counting mapper.
require('../docs/js/surface-stretch-uv-furniture.js'); // Production island mapper, tested here independently of network image loading.
const naturalMapper=window.HobunjiSurfaceStretchUV; // Real function is used on an independent cylinder, never on shared quarry art.
const sixFaceStone=new THREE.Mesh(new THREE.CylinderGeometry(.46,.5,1,6),new THREE.MeshBasicMaterial());
const stoneSurfaceReport=naturalMapper.mapMesh(sixFaceStone,{label:'six-sided cairn standalone UV validation'});
assert.ok(stoneSurfaceReport?.patchCount>=8,'the real mapper recognizes separate side and cap surfaces on a faceted cairn stone');
const mappedPosition=sixFaceStone.geometry.getAttribute('position');
const mappedUv=sixFaceStone.geometry.getAttribute('uv');
assert.equal(mappedUv.count,mappedPosition.count,'seam expansion preserves one independent UV per rendered corner');
assert.ok(Array.from(mappedUv.array).every(value=>Number.isFinite(value)&&value>=-0.0001&&value<=1.0001),
  'all stretched stone-face UVs stay within the one-PNG texture domain');
verifyScenery().catch(error=>{console.error(error);process.exitCode=1;});
