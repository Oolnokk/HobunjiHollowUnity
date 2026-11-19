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
assert.equal(generator.wildernessBlossomRecipe.knotTiers, 3, 'wilderness trees have three canopy branch levels');
assert.equal(generator.pottedBlossomRecipe.knotTiers, 1, 'the feast table flower stays a single-rung sapling');
for (const color of ['#00ffff','#ffffff','#ffbf00','#ff8000','#ffb3b3']) {
  const a = generator.buildWildernessBlossomTreeMesh('blossom-color-'+color,color);
  const b = generator.buildWildernessBlossomTreeMesh('blossom-color-'+color,color);
  const bounds = new THREE.Box3().setFromObject(a); // Measures seeded branches and petals after normalized world transforms.
  const size = bounds.getSize(new THREE.Vector3());
  assert.ok(size.x <= 2.001 && size.y <= 2.001 && size.z <= 2.001,
    color+': all branches, foliage and petals fit the 2×2×2-tile envelope');
  assert.ok(size.y > 1.95, color+': tree is approximately two tiles tall, not a tiny table flower');
  assert.ok(bounds.min.y >= -0.001, color+': roots begin at the wilderness floor');
  assert.equal(a.userData.wildernessBlossom.branchTiers,3);
  assert.equal(a.userData.wildernessBlossom.blossomColor,color);
  const petals = a.getObjectByName('wilderness-blossom-sprigs');
  assert.ok(petals?.isMesh && petals.geometry.attributes.uv, color+': separately tinted tiny PNG blossom planes exist');
  assert.ok(petals.geometry.attributes.position.count >= 100,
    color+': multiple outer-branch blossom sprigs are distributed across all tiers');
  const leaves = a.children.find(child => child.isMesh && child.userData.noOutline && child !== petals);
  assert.ok(leaves?.material?.map, color+': green shadewood foliage remains distinct from colored blossom planes');
  assert.notEqual(leaves.material.color.getHex(),new THREE.Color(color).getHex(),
    color+': tree leaves must not become one giant colored blossom');
  const petalsB = b.getObjectByName('wilderness-blossom-sprigs');
  assert.equal(petals.geometry,petalsB.geometry,color+': repeated tree instances reuse shared petals geometry');
  assert.equal(leaves.geometry,b.children.find(child=>child.isMesh&&child.userData.noOutline&&child!==petalsB).geometry,
    color+': repeated tree instances reuse shared leaves geometry');
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
let cycle='1156',decorations=0,signals=0;
const sharedStoneArt={geometry:new THREE.CylinderGeometry(.46,.5,1,6),material:new THREE.MeshLambertMaterial({color:0x85857c})};
let sharedStoneDisposed=false; // The real OreRockTextures.smallStoneArt resource is shared by all wilderness cairns.
sharedStoneArt.geometry.addEventListener('dispose',()=>{sharedStoneDisposed=true;});
window.OreRockTextures={smallStoneArt:()=>sharedStoneArt}; // Renderer-provided shared rock art is required for both cairns and the newly engraved witness.
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
assert.equal(scenery.debugSnapshot().plan.marked.length,originalMarked,'mobile diagnostics enumerate every marked object');
let paintedPillars=0;scene.traverse(node=>{if(node.userData?.wildernessDyeId){paintedPillars++;
  assert.ok(node.userData.meshById.get('stump').children.some(part=>part.userData?.furniturePattern),
    'the real authored pillar shaft receives the existing ruin pattern overlay');
}});
assert.ok(paintedPillars>0,'even a small generated area renders colored pillar inscriptions');
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
console.log('ok - blossom tree geometry, three-tier leaves, uniquely dyed boulders/pillars, Shift redraw and cleanup');
}
verifyScenery().catch(error=>{console.error(error);process.exitCode=1;});
