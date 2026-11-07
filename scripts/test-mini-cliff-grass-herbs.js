#!/usr/bin/env node
'use strict';

// Mini-cliff terrain shares wilderness models, wind grass and persistent reagent picking.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const routes = require('../docs/js/cliff-route-network.js');

class Matrix4 {
  constructor(visible = true) { this.visible = visible; }
  makeScale(x, y, z) { this.visible = !!(x || y || z); return this; }
  clone() { return new Matrix4(this.visible); }
}
class Object3D {
  constructor() {
    this.position = { x:0, y:0, z:0, set(x,y,z) { Object.assign(this,{x,y,z}); } };
    this.scale = { set(){}, multiplyScalar(){} };
    this.rotation = { y: 0, set(){} };
    this.matrix = new Matrix4();
  }
  updateMatrix() { this.matrix = { visible:true, x:this.position.x, y:this.position.y, z:this.position.z }; }
}
class Group extends Object3D {
  constructor() { super(); this.children=[]; this.userData={}; this.visible=true; }
  add(obj) { this.children.push(obj); obj.parent=this; }
}
class InstancedMesh {
  constructor(geometry, material, count) {
    this.geometry=geometry; this.material=material; this.count=count; this.userData={};
    this.instances=[]; this.instanceMatrix={ setUsage(){}, needsUpdate:false };
  }
  setMatrixAt(i,m) { this.instances[i]=m; }
  computeBoundingSphere(){}
}
const T = {
  Matrix4, Object3D, Group, InstancedMesh,
  TextureLoader:class {load(){return {};}},
  MeshBasicMaterial:class {}, MeshStandardMaterial:class {},
  BoxGeometry:class {}, DodecahedronGeometry:class {},
  Vector3:class {constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}},
  Quaternion:class {}, DoubleSide:2, DynamicDrawUsage:1,
};
const scene = { objects:[], add(obj){this.objects.push(obj);} };
const area='test-mini-cliff-herb';
const shelf = (id,x,reward)=>({
  id,x,z:5.5,y:7, width:2,depth:1, tangent:{x:1,z:0}, normal:{x:0,z:1},
  footprint:[{c:Math.floor(x),r:5}], reward, routeId:0,
});
const herb=shelf('herb',4.5,'herbCluster');
const ore=shelf('ore',10.5,'oreRock');
const chest=shelf('chest',16.5,'buriedTreasure');
const network={area,routes:[],balconies:[herb,ore,chest]};
const naturalRock={tag:'terrain-rock-mound'};
const rockMaterial={tag:'zone-rock-material'};
globalThis.TerrainGeometry={buildRockTileGeo:()=>({stoneGeo:naturalRock})};
globalThis.AlchemySystem={
  REAGENT_DEFS:{nativeHerb:{icon:'🌿',label:'Native Herb',color:0x55aa44}},
  reagentsForZone:()=>['nativeHerb'],
};
globalThis.ReagentPlants={
  buildReagentPlantMesh(){ const plant=new Group();plant.add({});plant.add({});return plant; },
};
const result=routes.render(T,scene,network,rockMaterial,{tag:'grass'});
const oreMesh=result.find(m=>m.name.endsWith('cliff-balcony-ores'));
assert.equal(oreMesh.geometry,naturalRock,'mini-cliff ore uses the same mound model as loose ground rock');
assert.equal(oreMesh.material,rockMaterial,'mini-cliff ore uses the zone stone material');
const herbs=routes.herbRewardMesh(area,herb.id);
assert(herbs && herbs.children.length===6,'herb reward is visibly clustered into six plants');
assert.equal(herbs.position.y,herb.y+0.016,'herbs grow from the mini-cliff lid');
assert.equal(chest.reagentKey,undefined,'buried chests remain separate rewards');
routes.setRewardStage(area,herb.id,'claimed');
assert.equal(herbs.visible,false,'harvesting hides all six plants immediately');
routes.restoreRewards({[area]:{[herb.id]:{claimed:false,revealed:false}}});
assert.equal(herbs.visible,true,'load restores an unpicked herb reward');
routes.restoreRewards({[area]:{[herb.id]:{claimed:true,revealed:true}}});
assert.equal(herbs.visible,false,'load never respawns a picked herb reward');
routes.restoreRewards({});

const registry={};
const windowStub={
  CliffRouteNetwork:routes, AlchemySystem:globalThis.AlchemySystem,
  InventoryStacks:{MAX_TOTAL:20}, PerkSystem:{rank:()=>0},
  AudioSystem:{playObjectSfx(){},objectSfxConfig:()=>({harvest:'pick'})},
};
const ctx={window:windowStub,THREE:T,console};
vm.runInNewContext(fs.readFileSync('docs/js/reagent-plants.js','utf8'),ctx);
const objects=new Map(), inventory={};
let xp=0;
windowStub.ReagentPlants.init({
  _zoneReagentObjects:new Map([[area,objects]]),
  getCurrentArea:()=>area,inventory,random:()=>0.99,bonusYieldChance:()=>0,
  awardForagingXp:()=>{xp++;},refreshItemScroll(){},
});
assert.equal(windowStub.ReagentPlants.registerMiniCliffHerbClusters(area,network),1,
  'ledge rewards register as ordinary reagent objects');
const pick=objects.get('4,5');
assert(pick,'registered forage object is at a cap tile');
assert.equal(pick.onAction('obj_pick_reagent').ok,true);
assert.equal(inventory.nativeHerb,1,'harvest grants the native reagent');
assert.equal(xp,1,'harvest awards ordinary foraging XP');
assert.equal(routes.getRewardState(area,herb.id).claimed,true,'harvest persists through existing cliff reward state');
assert.equal(herbs.visible,false,'harvest removes visual cluster');
assert.equal(windowStub.ReagentPlants.registerMiniCliffHerbClusters(area,network),0,
  'picked cliff herbs are not recreated when zone plants refresh');

routes.restoreRewards({});
const grassContext={window:{CliffRouteNetwork:routes},THREE:T,console};
vm.runInNewContext(fs.readFileSync('docs/js/zone-grass-billboards.js','utf8'),grassContext);
const grass=grassContext.window.ZoneGrassBillboards;
grass.init({
  grassBladeGeo:{tag:'shared-grass-blade'},getGrassBillboardMat:()=>({tag:'shared-wind-shader'}),
  getGrassEnabled:()=>true,
  mbRng(seed){let n=seed>>>0;return ()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);},
});
herb.base={footprint:[{c:4,r:5}]};
const grassScene={objects:[],add(obj){this.objects.push(obj);}};
const cover=grass.buildMiniCliffGrassBillboards(grassScene,{area,balconies:[herb]});
assert(cover && cover.children[0].count>0,'elevated ledge gets wind-animated grass');
assert.equal(cover.children[0].geometry.tag,'shared-grass-blade','no duplicate grass geometry');
assert.equal(cover.children[0].material.tag,'shared-wind-shader','no duplicate material or wind shader');
for(const blade of cover.children[0].instances.filter(Boolean)){
  assert(routes.shelfContains(herb,blade.x,blade.z),'every grass plane sits on the actual walkable cap');
  assert.equal(blade.y,herb.y+0.016,'grass does not grow from the ground far below');
}
routes.releaseArea(area);
delete globalThis.TerrainGeometry;
delete globalThis.ReagentPlants;
delete globalThis.AlchemySystem;
console.log('PASS mini-cliff shared rock and grass, visible herb cluster, picking, save/restore');
