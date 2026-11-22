#!/usr/bin/env node
'use strict';
// Real Three.js regression: visible native blossom clusters and one pooled, scheduler-owned falling-petal mesh per tree.
const assert = require('node:assert/strict'); // Verifies GPU resource ownership and mobile-safe upper bounds.
let THREE; // The repository's production WebGL geometry API.
try { THREE = require('three'); } catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('skip - pooled blossom petals (three not installed)');
  process.exit(0);
}
const priorLoad = THREE.TextureLoader.prototype.load; // Test PNG access without a browser document.
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
const scheduler = {
  records:new Map(), // Captures the one stable frame-owner registration and its enabled flag.
  register(id,fn,options){this.records.set(id,{fn,...options});},
  setEnabled(id,enabled){const rec=this.records.get(id);if(!rec)return false;rec.enabled=!!enabled;return true;}
};
global.window={THREE,RuntimeFrameScheduler:scheduler,__farmLog(){}};
global.THREE=THREE;
require('../docs/js/foliage-generator.js');
require('../docs/js/festival-blossom-petals.js');
const trees=window.FoliageGenerator; // Native tree builder with its original plant geometry still intact.
const petals=window.FestivalBlossomPetals; // Actual production scheduler integration, not a fake particle implementation.
const zone='map_southern_cloud_forest'; // Southern Cloud Forest has two blossom trees, so test the worst case.
const tree=trees.buildWildernessBlossomTreeMesh('amber:petal-test','#ff8000',zone);
const tree2=trees.buildWildernessBlossomTreeMesh('rose:petal-test','#ffb3b3',zone);
const native=trees.buildShadewoodMesh(11,12); // Normal forest foliage must not inherit festival flowers.
const scene=new THREE.Group();
scene.add(tree,tree2);tree.position.set(10.5,0,10.5);tree2.position.set(16.5,0,10.5);
for(const blossom of [tree,tree2]) {
  const source=blossom.userData.wildernessBlossomPetalSources;
  const cluster=blossom.getObjectByName('wilderness-blossom-sprigs');
  assert.ok(Array.isArray(source)&&source.length===24,'reservoir samples up to 24 real 3D flower clusters');
  assert.ok(source.every(p=>p.length===3&&p.every(Number.isFinite)),'sampled bloom origins are finite local coordinates');
  assert.equal(blossom.userData.wildernessBlossom.blossomSprigsPerBranch,4,'blossom canopy has four colorful clusters per branch');
  assert.ok(cluster.geometry.attributes.position.count>1000,'the flower canopy has numerous visible petal cards');
  assert.equal(cluster.renderOrder,2,'flowers render after native leaf cards without disabling depth testing');
  assert.equal(cluster.material.depthTest,true,'terrain and walls can still occlude clusters');
  assert.equal(cluster.material.color.getHex(),new THREE.Color(blossom.userData.wildernessBlossom.blossomColor).getHex());
}
assert.equal(native.getObjectByName('wilderness-blossom-sprigs'),undefined,'normal shadewood remains unchanged');
assert.equal(petals.attach(tree),true);
assert.equal(petals.attach(tree),true,'attaching twice does not duplicate the emitter');
assert.equal(petals.attach(tree2),true);
assert.equal(petals.debugSnapshot().trees,2,'both trees use one emitter each');
const points=tree.getObjectByName('wilderness-blossom-falling-petals');
const secondPoints=tree2.getObjectByName('wilderness-blossom-falling-petals');
assert.equal(points.isPoints,true,'one Three.js Points object renders all falling petals per tree');
assert.equal(points.material.map,secondPoints.material.map,'the petal sprite texture is shared between flower colors');
assert.equal(points.material.color.getHex(),new THREE.Color('#ff8000').getHex());
assert.equal(secondPoints.material.color.getHex(),new THREE.Color('#ffb3b3').getHex());
assert.equal(points.geometry.drawRange.count,0,'no premature particles appear at the trunk origin');
assert.equal(points.frustumCulled,false,'dynamic points cannot be dropped for stale local geometry bounds');
assert.equal(scheduler.records.size,1,'exactly one permanent frame subscriber services both trees');
const [[id,slot]]=scheduler.records;
assert.equal(slot.phase,'pre-render','particle transforms update before the game draws the frame');
assert.equal(slot.enabled,false,'distant or newly mounted flowers cannot pay a permanent frame cost');
petals.setContext({area:zone,col:10,row:10},zone);
assert.equal(slot.enabled,true);
for(let i=0;i<320;i++)slot.fn({deltaMs:16});
assert.ok(points.geometry.drawRange.count>0 && points.geometry.drawRange.count<=14,
  'active tree emits multiple falling petals but stays within the per-tree GPU limit');
assert.ok(secondPoints.geometry.drawRange.count>0 && secondPoints.geometry.drawRange.count<=14,
  'nearby second blossom is bounded independently');
assert.ok(points.geometry.attributes.position.array.every(Number.isFinite),'falling petals never produce NaN GPU coordinates');
assert.ok(petals.debugSnapshot().livePetals<=28,'two-tree southern cloud forest cannot exceed 28 live petals');
tree.visible=false;slot.fn({deltaMs:16});
assert.equal(points.visible,false,'native zone culling also hides its entire particle emitter');
assert.equal(points.geometry.drawRange.count,0,'off-camera petals are cleared, not frozen for the next return');
tree.visible=true;for(let i=0;i<60;i++)slot.fn({deltaMs:16});
assert.equal(points.visible,true,'visibility resumes when native tree returns to frustum');
assert.ok(points.geometry.drawRange.count>0,'returning to view spawns fresh falling petals from real branches');
petals.setContext({area:zone,col:99,row:99},zone);
assert.equal(slot.enabled,false,'long-range absence disables the entire shared frame subscriber');
assert.equal(points.geometry.drawRange.count,0,'leave/reenter clears previously animated particles');
petals.setContext({area:zone,col:10,row:10},zone);
assert.equal(slot.enabled,true,'returning near a tree can re-enable the existing subscriber');
let geometryDisposed=0,materialDisposed=0; // Detects the permanent-tree teardown resource path.
points.geometry.addEventListener('dispose',()=>geometryDisposed++);
points.material.addEventListener('dispose',()=>materialDisposed++);
assert.equal(petals.detach(tree),true);
assert.equal(geometryDisposed,1);
assert.equal(materialDisposed,1);
assert.equal(points.parent,null,'Shift/zone teardown removes the entire pooled Points child');
assert.equal(petals.debugSnapshot().trees,1);
assert.equal(petals.detach(tree2),true);
assert.equal(slot.enabled,false,'removing the last emitter disables the frame subscriber');
assert.equal(petals.debugSnapshot().livePetals,0);
// The hunt renders these trees outside normal wilderness tile vegetation. Use the
// production outline registrar and shared collision registry to verify that
// the real live-scene integration behaves like ordinary unharvestable trunks.
require('../docs/js/world-render-pipeline.js');
require('../docs/js/area-footprint-blockers.js');
require('../docs/js/festival-blossom-hunt.js');
const hunt=window.FestivalBlossomHunt; // Actual festival renderer and its scene/Shift lifecycle.
let activeZone='map_southern_cloud_forest'; // Switching areas must unregister the previous provider without touching shared foliage.
const gameScene=new THREE.Scene(); // Scene for real world bounds, native cullables and renderer layer masks.
const cullables=[]; // Production zone registry used by the same vegetation culler as ordinary trees.
const blossomLayout={localeInstances:[
  {localeId:'locale_five_blossoms_amber',objects:[{x:10,y:10,key:'blossom-tree'}]},
  {localeId:'locale_five_blossoms_rose',objects:[{x:16,y:10,key:'blossom-tree'}]}
]}; // Explicit generated locale objects; stable physical positions are also the riddle's targets.
const layouts=new Map([[activeZone,blossomLayout]]);
window.GridTileAccessors={getActiveScene:()=>gameScene,getZoneSceneInfo:()=>({scene:gameScene,cullables})};
window.LocaleRiddleGenerator={positionOf:(instance)=>({col:instance.objects[0].x,row:instance.objects[0].y})};
window.ClimbSystem={groundYAt:()=>0};
hunt.init({_zoneLayouts:layouts,getCurrentArea:()=>activeZone,TILE:64});
hunt.update();
const trunkProvider='five-blossoms-trunks'; // Real AreaFootprintBlockers ID should exist exactly once regardless of update cadence.
assert(window.AreaFootprintBlockers.providerIds().includes(trunkProvider),'blossom trees register the shared physical obstacle');
const firstTree=gameScene.getObjectByName('locale_five_blossoms_amber');
const nextTree=gameScene.getObjectByName('locale_five_blossoms_rose');
assert(firstTree&&nextTree,'the actual festival runtime renders both authored wilderness blossoms');
const visibleStem=firstTree.children.find(child=>child.isMesh&&!child.userData?.noOutline);
const flowerCards=firstTree.getObjectByName('wilderness-blossom-sprigs');
assert(visibleStem.layers.isEnabled(1),'the real shell-outlines helper includes volumetric bark');
assert(!flowerCards.layers.isEnabled(1),'flat alpha-cutout blossom cards are not inked as black rectangles');
assert.equal(window.AreaFootprintBlockers.blocksBox(activeZone,10.5,10.5,0),true,'the amber blossom trunk blocks movement');
assert.equal(window.AreaFootprintBlockers.blocksBox(activeZone,16.5,10.5,.1),true,'the rose blossom trunk blocks movement');
assert.equal(window.AreaFootprintBlockers.blocksBox(activeZone,11.5,10.5,.1),false,'open ground beside blossom branches remains traversable');
assert.equal(window.AreaFootprintBlockers.blocksBox(activeZone,10.5,10.5,0,1e4),false,'projectiles above the tree remain unobstructed');
assert.equal(window.AreaFootprintBlockers.blocksBox('map_western_slope',10.5,10.5,0),false,'trunks are scoped to the active zone');
const firstProviderCount=window.AreaFootprintBlockers.providerIds().length;
hunt.update();
assert.equal(window.AreaFootprintBlockers.providerIds().length,firstProviderCount,'steady-state festival ticks do not register duplicate blockers');
assert.equal(hunt.debugSnapshot().treeTrunkCollision.count,2,'mobile diagnostics report both actual blossom tree obstacles');
activeZone='map_northern_cliffs';
layouts.set(activeZone,{localeInstances:[{localeId:'locale_five_blossoms_cyan',objects:[{x:4,y:6,key:'blossom-tree'}]}]});
hunt.update();
assert.equal(window.AreaFootprintBlockers.blocksBox(activeZone,4.5,6.5,0),true,'changing zone installs the new tree trunk');
assert.equal(window.AreaFootprintBlockers.blocksBox(activeZone,10.5,10.5,0),false,'old zone trunks cannot persist at a reused location');
assert.equal(cullables.length,1,'old zone tree cull entries are discarded when foliage is replaced');
activeZone='map_farm';
hunt.update();
assert.equal(window.AreaFootprintBlockers.providerIds().includes(trunkProvider),false,'leaving wilderness unregisters all blossom colliders');
assert.equal(hunt.debugSnapshot().treeTrunkCollision.registered,false,'mobile diagnostics reveal a cleaned-up collision provider');
assert.equal(cullables.length,0,'leaving wilderness clears old zone cull entries');

THREE.TextureLoader.prototype.load=priorLoad;
console.log('ok - visible native blossoms and capped, cull-aware, scheduled, teardown-safe falling petals');
