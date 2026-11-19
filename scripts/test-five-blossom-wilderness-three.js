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
require('../docs/js/furniture-pattern-surfaces.js'); // Use the production face projector to verify complete engraving coverage, without needing canvas or WebGL.
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
  cols:70, rows:70,
  tiles:Array.from({length:70},()=>Array.from({length:70},()=>({type:'grass',elevTier:1}))),
  localeInstances:[{localeId:'locale_five_blossoms_cyan',x:28,y:28}]
}; // A flat generated wilderness still needs one deterministic, uniquely dyed route anchor.
const zoneId='map_northern_cliffs';
const zoneLayouts=new Map([[zoneId,worldLayout]]);
const scene=new THREE.Group(); // Same active scene persists when the Tothal cycle is forcibly advanced.
let cycle='1156',decorations=0; // Count projected masonry surfaces across Tothal regeneration.
const sharedStoneArt={geometry:new THREE.CylinderGeometry(.46,.5,1,6),material:new THREE.MeshLambertMaterial({color:0x85857c})};
let sharedStoneDisposed=false; // The real OreRockTextures.smallStoneArt resource is shared by all wilderness cairns.
sharedStoneArt.geometry.addEventListener('dispose',()=>{sharedStoneDisposed=true;});
window.OreRockTextures={smallStoneArt:()=>sharedStoneArt}; // Renderer-provided shared rock art is required for both cairns and the newly engraved witness.
window.GridTileAccessors={getActiveScene:()=>scene};
window.AuthoredFurniture={
  async load(key){return {key};}, // Simulate the real asynchronous furniture data load.
  buildGroup(def){const root=new THREE.Group(),parts=new Map();
    const partIds=def.key==='ruinPillarBroken'?['base','stump','fallen','cap','chip']:['base','stub','chip_a'];
    for(const id of partIds){const part=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());
      part.userData.authoredPart={id,kind:'box'};parts.set(id,part);root.add(part);}
    root.userData.meshById=parts;return root;} // Mirror the real multi-part authored debris so every major stone is checked.
};
window.ClimbSystem={groundYAt:()=>1.25};
const ruinSurfaces=window.FurniturePatternSurfaces; // The real projector is the coverage oracle, not the test's simulated atlas.
window.RuinPatternSurfaceRules={mergedConfig:()=>({defaultScale:4,rules:{}})}; // The canonical intact ruin pillar's four-world-unit motif scale is the source.
window.FurniturePatternSurfaces={
  applyPart(mesh,part) {
    const patterns=part.patternSurfaces||[],rock=part.kind==='sphere';
    assert.deepEqual(patterns.map(record=>record.selector),rock?['all']:['sides','caps'],
      'intact pillar sides use the perimeter unwrap and broken caps cover the complementary exposed faces');
    let selectedTriangles=0, sideTriangles=0, capTriangles=0; // Count real source triangles included in each pattern projection.
    for(const pattern of patterns) {
      assert.match(pattern?.patternId||'',/^harlyao_glyph_(entropy|ignorance|servitude)$/,
        'dyed stones reuse an authored Harlyao ruin-wall motif, not a separate decal');
      assert.equal(pattern.mode,'engraving','all projected surfaces use the ruin-wall engraving mode');
      assert.equal(pattern.scale,4,'wilderness debris inherits the original ruin pillar tile-4 layout');
      assert.equal(pattern.layerTransforms,undefined,'native repo motif tiling and placement must not be overwritten');
      assert.equal(pattern.glowIntensity,0,'wilderness masonry engravings must never glow');
      assert.equal(pattern.glowPulseDepth,0,'wilderness masonry must never pulse');
      assert.ok(pattern.maxAtlasPx<=256,'mobile pattern atlases stay bounded');
      assert.match(pattern.palette[1],/^#[0-9a-f]{6}$/i,'engraving ink has the authored dye hex');
      const projected=ruinSurfaces.surfaceGeometry(mesh,ruinSurfaces.normalize(pattern),part);
      assert.ok(projected,'the real ruin surface projector accepts every assigned face class');
      const triangles=projected.getAttribute('position').count/3;
      selectedTriangles+=triangles;
      if(pattern.selector==='sides') {
        sideTriangles=triangles;
        const uv=projected.getAttribute('uv').array; // Production's original continuous pillar-side unwrap is the same geometry generator.
        const us=Array.from({length:uv.length/2},(_,i)=>uv[i*2]);
        assert.ok(Math.max(...us)-Math.min(...us)>0.8,'side UVs wrap around all four faces, not a single decal');
      }
      if(pattern.selector==='caps')capTriangles=triangles;
      projected.dispose();
      const engraving=new THREE.Mesh(new THREE.PlaneGeometry(.2,.2),new THREE.MeshBasicMaterial());
      engraving.userData.furniturePattern={mode:'engraving',slot:pattern.slot,patternId:pattern.patternId,status:'ready'};
      mesh.add(engraving);
      decorations++; // Each runtime overlay is counted separately; a marker no longer disguises incomplete sides as a full pattern.
    }
    assert.equal(selectedTriangles,(mesh.geometry.index?.count||mesh.geometry.attributes.position.count)/3,
      'every source triangle has exactly one projected engraving (sides plus both broken ends)');
    if(!rock) {
      assert.ok(sideTriangles>0,'all vertical masonry side triangles are selected');
      assert.ok(capTriangles>0,'the broken piece also engraves both local end-cap faces');
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
assert.equal(scenery.debugSnapshot().plan.marked.length,originalMarked,'mobile diagnostics enumerate every marked object');
let paintedPillars=0;scene.traverse(node=>{if(node.userData?.wildernessDyeId){paintedPillars++;
  const parts=node.userData.meshById, expected=[...parts.keys()].filter(id=>['base','stump','stub','fallen','cap'].includes(id));
  assert.equal(node.userData.wildernessPatternedParts,expected.length,'every major stone part is decorated exactly once');
  for(const id of expected){
    const target=parts.get(id),children=target.children.filter(part=>part.userData?.furniturePattern);
    assert.deepEqual(children.map(part=>part.userData.furniturePattern.slot),['ruin-pillar-sides','ruin-pillar-broken-ends'],
      id+' retains the intact pillar side UV and also covers both broken end caps');
    assert.deepEqual(target.userData.wildernessPatternSurfaces,{expected:2,actual:2,scale:4},
      id+' reports complete side and cap coverage');
  }
  for(const [id,mesh] of parts)if(id.startsWith('chip'))assert.equal(mesh.children.some(part=>part.userData?.furniturePattern),false,
    'tiny loose chips are not separate atlas/draw call owners');
}});
assert.ok(paintedPillars>0,'even a small generated area renders colored full-surface pillar patterns');
assert.ok(scenery.debugSnapshot().patternedPillarParts>paintedPillars,'mobile debug counts multi-part masonry patterns');
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
verifyScenery().catch(error=>{console.error(error);process.exitCode=1;});
