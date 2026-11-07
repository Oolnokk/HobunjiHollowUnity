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
  clone() { const m=new Matrix4(this.visible);m.x=this.x;m.y=this.y;m.z=this.z;return m; }
}
class Object3D {
  constructor() {
    this.position = { x:0, y:0, z:0, set(x,y,z) { Object.assign(this,{x,y,z}); } };
    this.scale = { set(){}, multiplyScalar(){} };
    this.rotation = { y: 0, set(){} };
    this.matrix = new Matrix4();
  }
  updateMatrix() { this.matrix = new Matrix4();Object.assign(this.matrix,{x:this.position.x,y:this.position.y,z:this.position.z}); }
}
class Group extends Object3D {
  constructor() { super(); this.children=[]; this.userData={}; this.visible=true; }
  add(obj) { this.children.push(obj); obj.parent=this; }
}
class BufferGeometry {
  constructor(){ this.attributes={};this.groups=[]; }
  setAttribute(key,value){this.attributes[key]=value;}
  addGroup(start,count,materialIndex){this.groups.push({start,count,materialIndex});}
  computeVertexNormals(){}
  computeBoundingSphere(){}
}
class Mesh {
  constructor(geometry,material){this.geometry=geometry;this.material=material;this.userData={};this.isMesh=true;}
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
  Matrix4, Object3D, Group, InstancedMesh, Mesh, BufferGeometry,
  Float32BufferAttribute:class { constructor(values,itemSize){this.values=values;this.itemSize=itemSize;} },
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
for (const ledge of [herb,ore,chest]) {
  ledge.base={x:ledge.x-0.3,z:ledge.z-0.4,y:0,footprint:[{c:Math.floor(ledge.x),r:5}]};
}
const network={area,routes:[],balconies:[herb,ore,chest]};
const naturalRock={tag:'terrain-rock-mound'};
const rockMaterial={tag:'zone-rock-material'};
const groundMaterial={tag:'zone-grass-material'};
globalThis.TerrainGeometry={buildRockTileGeo:()=>({stoneGeo:naturalRock})};
globalThis.AlchemySystem={
  REAGENT_DEFS:{nativeHerb:{icon:'🌿',label:'Native Herb',color:0x55aa44}},
  reagentsForZone:()=>['nativeHerb'],
};
globalThis.ReagentPlants={
  buildReagentPlantMesh(){ const plant=new Group();plant.add({});plant.add({});return plant; },
};
const result=routes.render(T,scene,network,rockMaterial,groundMaterial);
const miniCliffTerrain=result.find(m=>m.name.endsWith('-cliff-balconies'));
assert(miniCliffTerrain,'mini-cliff plateau shell is rendered');
assert.equal(miniCliffTerrain.material[0],groundMaterial,'walkable cap shares the zone ground material');
assert.equal(miniCliffTerrain.material[1],rockMaterial,'cliff sides share the same zone rock material');
assert(miniCliffTerrain.geometry.groups.every(g=>g.count>0),'both cap and cliff rock faces are present');
const oreMesh=result.find(m=>m.name.endsWith('cliff-balcony-ores'));
assert.equal(oreMesh.geometry,naturalRock,'mini-cliff ore uses the same mound model as loose ground rock');
assert.equal(oreMesh.material,rockMaterial,'mini-cliff ore uses the zone stone material');
const herbs=routes.herbRewardMesh(area,herb.id);
assert(herbs && herbs.children.length===6,'herb reward is visibly clustered into six plants');
assert.equal(herbs.position.y,herb.y+0.016,'herbs grow from the mini-cliff lid');
assert.equal(herb.herbTile.c,4,'cluster belongs to one mini-cliff tile');
assert.equal(herb.herbTile.r,5,'cluster belongs to one mini-cliff row');
for (const plant of herbs.children) {
  assert.equal(Math.floor(herbs.position.x+plant.position.x),4,'every herb stalk stays on the selected tile');
  assert.equal(Math.floor(herbs.position.z+plant.position.z),5,'no herb stalk spills into a neighboring tile');
}
assert.equal(chest.reagentKey,undefined,'buried chests remain separate rewards');
routes.setRewardStage(area,herb.id,'claimed');
assert.equal(herbs.visible,false,'harvesting hides all six plants immediately');
routes.restoreRewards({[area]:{[herb.id]:{claimed:false,revealed:false}}});
assert.equal(herbs.visible,true,'load restores an unpicked herb reward');
routes.restoreRewards({[area]:{[herb.id]:{claimed:true,revealed:true}}});
assert.equal(herbs.visible,false,'load never respawns a picked herb reward');
routes.restoreRewards({});

// Exercise the actual game.js mini-cliff reward handler with a minimal game
// context; it must win over ground-floor reagent objects on the same tile.
const game = fs.readFileSync('docs/game.js', 'utf8');
const handlerStart=game.indexOf('function getCliffBalconyResourceAt(col, row) {');
const handlerEnd=game.indexOf('function getWorldObjectAt(col, row) {',handlerStart);
assert(handlerStart>=0 && handlerEnd>handlerStart,'the actual game entry point still owns cliff rewards');
const inventory={};
let xp=0; // Tracks the Foraging XP calls for each pick.
let bonusChance=0; // Simulates the Foraging extra-yield chance.
let doubleRank=0; // Simulates Double Forageables.
let randomDraws=0; // Verifies five separate yield rolls per cluster.
let herbEvents=0; // Tracks per-pick activity events.
let rolls=[0.99]; // Deterministic perk rolls for test scenarios.
const handlerWindow={
  CliffRouteNetwork:{...routes,forArea:()=>network},
  InventoryStacks:{MAX_TOTAL:20}, PerkSystem:{rank:()=>doubleRank},
  AlchemySystem:globalThis.AlchemySystem,
  SkillSystem:{bonusYieldChance:()=>bonusChance,XP_GAINS:{forage:4},award:()=>{xp++;}},
  HobunjiActivityEvents:{emit(type){if(type==='herb_picked')herbEvents++;}},
  AudioSystem:{playObjectSfx(){},objectSfxConfig:()=>({harvest:'pick'})},
};
const ctx={
  window:handlerWindow,currentArea:area,player:{onCliffBalcony:herb.id},
  _isZoneArea:()=>true,inventory,activeTool:'pick',heldMode:'tool',
  rnd(){return rolls[(randomDraws++)%rolls.length];},refreshItemScroll(){},
  buildInventoryGrid(){},buildPackClothingSection(){},
};
vm.runInNewContext(game.slice(handlerStart,handlerEnd)
  + ';this.getCliffResource = getCliffBalconyResourceAt;',ctx);
const pick=ctx.getCliffResource(4,5);
assert(pick,'elevated herb receives an interactable with the existing reward priority');
herb.footprint.push({c:5,r:5}); // Long ledges can overlap multiple ground grid tiles.
assert.equal(ctx.getCliffResource(5,5),null,'herbs are pickable only from their actual clustered tile');
assert.equal(pick.getButtons()[0].action,'obj_balcony_pick','herb picking is neither mining nor digging');
assert.equal(pick.onAction('obj_balcony_dig').ok,false,'herbs cannot be dug into treasure chests');
assert.equal(pick.onAction('obj_balcony_pick').ok,true,'picking harvests the real elevated reward');
assert.equal(inventory.nativeHerb,5,'one cluster is five ordinary native-reagent picks');
assert.equal(randomDraws,5,'each pick gets its own bonus roll');
assert.equal(xp,5,'all five picks grant normal Foraging XP');
assert.equal(herbEvents,5,'all five picks notify the normal activity system');
assert.equal(routes.getRewardState(area,herb.id).claimed,true,'picking persists in cliff reward state');
assert.equal(herbs.visible,false,'picking hides the entire clustered model');
assert.equal(ctx.getCliffResource(4,5),null,'claimed ledges do not create duplicate forage actions');
// All five yield rolls must receive Foraging's extra-yield chance independently,
// then Double Forageables must double each individual pick.
routes.restoreRewards({});
inventory.nativeHerb=0; xp=0; herbEvents=0; randomDraws=0;
bonusChance=0.5; doubleRank=1; rolls=[0.1,0.9,0.2,0.8,0.3]; // 3 successful bonuses of 5.
const perkPick=ctx.getCliffResource(4,5);
assert.equal(perkPick.onAction('obj_balcony_pick').ok,true,'perked cluster harvest succeeds');
assert.equal(inventory.nativeHerb,16,'five independent picks with three bonuses and double-yield grant (5+3)*2');
assert.equal(randomDraws,5,'perked harvest still rolls exactly five times');
assert.equal(xp,5,'yield perks do not replace any of the five XP grants');
assert.equal(herbEvents,5,'perked harvest still reports five picked herbs');
assert.equal(herbs.visible,false,'perked harvest removes its visual cluster');

// Insufficient stack space must not silently throw away four of the five picks.
routes.restoreRewards({});
inventory.nativeHerb=handlerWindow.InventoryStacks.MAX_TOTAL-1;
xp=0; herbEvents=0; randomDraws=0;
const noRoom=ctx.getCliffResource(4,5).onAction('obj_balcony_pick');
assert.equal(noRoom.ok,false,'a partly full stack cannot consume a five-pick cluster');
assert.equal(inventory.nativeHerb,19,'failed pick grants no partial loot');
assert.equal(routes.getRewardState(area,herb.id).claimed,false,'failed pick leaves cluster available');
assert.equal(herbs.visible,true,'failed pick leaves the visual cluster');
assert.equal(xp,0,'failed pick grants no XP');
assert.equal(herbEvents,0,'failed pick emits no events');
ctx.player.onCliffBalcony=ore.id;
assert.equal(ctx.getCliffResource(10,5).getButtons()[0].action,'obj_balcony_mine','ore still uses a pick');
ctx.player.onCliffBalcony=chest.id;
assert.equal(ctx.getCliffResource(16,5).getButtons()[0].action,'obj_balcony_dig','buried treasure still uses a shovel');
routes.restoreRewards({});
const grassContext={window:{CliffRouteNetwork:routes},THREE:T,console};
vm.runInNewContext(fs.readFileSync('docs/js/zone-grass-billboards.js','utf8'),grassContext);
const grass=grassContext.window.ZoneGrassBillboards;
grass.init({
  grassBladeGeo:{tag:'shared-grass-blade'},getGrassBillboardMat:()=>({tag:'shared-wind-shader'}),
  getGrassEnabled:()=>true,
  mbRng(seed){let n=seed>>>0;return ()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);},
});
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
