#!/usr/bin/env node
'use strict';
// Actual Three.js geometry contract for the five physical wilderness blossom trees (not the feast's table vases).
const assert = require('node:assert/strict'); // Checks measured world-scale bounds, distinct leaf canopy and tiny blossom sprigs.
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
const scene=new THREE.Group(); // Same active scene persists when the Tothal cycle is forcibly advanced.
let cycle='1156',decorations=0,signals=0;
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
window.InstancedMeshBounds={tag(mesh){
  assert.ok(mesh.isInstancedMesh,'only spatial cairn chunks enter the instanced cull registry');
  mesh.userData.hobunjiInstanceBounds=true;cullRegistrations++;return mesh;
}};
window.GridTileAccessors={getActiveScene:()=>scene};
window.AuthoredFurniture={
  async load(key){return {key};}, // Simulate the real asynchronous furniture data load.
  buildGroup(def){const root=new THREE.Group(),shaft=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());
    root.userData.meshById=new Map([['stump',shaft]]);root.add(shaft);return root;} // A real mesh owns the pillar's inscribed shaft.
};
window.ClimbSystem={groundYAt:()=>1.25};
window.FurniturePatternSurfaces={
  applyPart(mesh,part) {
    const pattern=part.patternSurfaces?.[0];
    assert.ok(pattern?.pattern?.motifUrl?.startsWith('assets/patterns/motif_harlyao_glyph_'),
      'dyed stones use a real Harlyao ruin engraving motif');
    assert.equal(pattern.mode,'engraving','stone engravings use the existing ruin-wall pattern mode');
    assert.match(pattern.palette[1],/^#[0-9a-f]{6}$/i,'engraving ink has the authored dye hex');
    const engraving=new THREE.Mesh(new THREE.PlaneGeometry(.2,.2),new THREE.MeshBasicMaterial());
    engraving.userData.furniturePattern={mode:'engraving',status:'ready'}; // Real surface owner creates a separate child atlas mesh.
    mesh.add(engraving);
    decorations++; // Counts actual runtime engraving calls, not merely planner output.
    return mesh;
  },
  attachStoneSignal(mesh,options) {
    assert.equal(options.face,'front','immediate visible glyph sits on the standing rock front');
    const glyph=new THREE.Mesh(new THREE.PlaneGeometry(.1,.1),new THREE.MeshBasicMaterial());
    glyph.userData.ruinStoneSignalGlyph=true;
    mesh.add(glyph);signals++;
    return {glyph};
  }
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
assert.equal(decorations,originalMarked,'every distinct marked pillar and stone uses one ruin engraving atlas');
assert.equal(signals,originalMarked,'one visible colored rune is attached to each dyed object');
assert.equal(first.userData.witnessDye.unique,true);
assert.equal(first.children.find(child=>child.userData?.ruinStoneSignalGlyph)?.position.z,.57,
  'the dyed rune is outside the irregular stone instead of buried inside its geometry');
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
assert.equal(cliffNaturalizations,1,'cliff material assigned once and shared across chunks');
assert.equal(cliffUnwraps,1,'individual rock faces unwrapped once and shared across all chunk instances');
assert.equal(scenery.debugSnapshot().cairnRendering.frustumTracked,expectedBuckets.size,'mobile diagnostics show registered frustum chunks');
assert.equal(scenery.debugSnapshot().cairnRendering.cliffMappedFaces,8,'mobile diagnostics show separate face mapping');
assert.equal(scenery.debugSnapshot().plan.marked.length,originalMarked,'mobile diagnostics enumerate every marked object');
let paintedPillars=0;scene.traverse(node=>{if(node.userData?.wildernessDyeId){paintedPillars++;
  assert.ok(node.userData.meshById.get('stump').children.some(part=>part.userData?.furniturePattern),
    'the real authored pillar shaft receives the existing ruin pattern overlay');
}});
assert.ok(paintedPillars>0,'even a small generated area renders colored pillar inscriptions');
scene.traverse(node=>{if(node.name==='wilderness-broken-stone-pillar')node.traverse(part=>{
  if(part.isMesh)assert.ok(part.frustumCulled&&part.userData.hobunjiWildernessDistanceCull,
    'debris-ifier ruin parts get independent frustum and distance culling');
});});
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
assert.equal(decorations,originalMarked+nextMarked,'the new cycle decorates each new marked object exactly once');
const second=witnessFor();
zoneLayouts.set(zoneId,{...worldLayout}); // Same cycle but forced regeneration replaces the workspace object.
scenery.update();
await new Promise(resolve=>setImmediate(resolve));
assert.notEqual(witnessFor(),second,'a forced same-cycle layout replacement also rebuilds the physical riddle witness');
assert.equal(decorations,originalMarked+nextMarked*2,'same-cycle regeneration reuses the canonical engraving pipeline on every dyed object');
scenery.clear();
assert.equal(witnessFor(),undefined,'leaving a zone removes the marked rock, not a stale hidden decoration');
assert.equal(sharedStoneDisposed,false,'zone cleanup must not dispose the mainline shared quarry art used by other wilderness rocks');
THREE.TextureLoader.prototype.load = previousTextureLoad;
console.log('ok - regional native blossom tree geometry, shared leaf bunches, dyed landmarks and Shift redraw');
}
verifyScenery().catch(error=>{console.error(error);process.exitCode=1;});
