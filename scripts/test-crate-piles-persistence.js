#!/usr/bin/env node
// Replay a crate save across scene reconstruction and a fresh module load.
// This is the browser-local supply save; cave crate counts separately use CaveSiteSystem world saves.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'..','docs/js/crate-piles.js'),'utf8');
class Vector3 {
  constructor(x=0,y=0,z=0){this.set(x,y,z);}
  set(x,y,z){Object.assign(this,{x,y,z});return this;}
  copy(p){return this.set(p.x,p.y,p.z);}
}
class Group {
  constructor(){this.isObject3D=true;this.children=[];this.userData={};this.parent=null;this.position=new Vector3();this.rotation={x:0,y:0,z:0};this.scale={set(){}};}
  add(object){object.parent?.remove(object);object.parent=this;this.children.push(object);}
  remove(object){this.children=this.children.filter(child=>child!==object);object.parent=null;}
  getWorldPosition(target){return target.copy(this.position);}
  updateWorldMatrix(){}
}
class Mesh extends Group {constructor(geometry,material){super();this.geometry=geometry;this.material=material;}}
const THREE={Group,Mesh,Vector3,PlaneGeometry:class{},MeshBasicMaterial:class{},
  TextureLoader:class{load(file){return{file};}},CanvasTexture:class{},DoubleSide:2};
const memory=new Map(); // Stubs browser storage across simulated page reloads.
const localStorage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value)};
const document={createElement:()=>({getContext:()=>({clearRect(){},fillText(){}})})};
let scene=new Group(),allowAward=false;
const player={x:20*64,y:20*64},burdens=[],granted=[];
const window={
  THREE,__hobunjiPlayerProfile:{worldId:'crate-persistence-regression'},
  CalendarSystem:{tothalCycle:()=>1},
  GridTileAccessors:{getCurrentArea:()=>'camp_zone',getActiveScene:()=>scene},
  Combat:{deps:{getCurrentArea:()=>'camp_zone',player,TILE:64,getGroundYAtWorld:()=>0,showToast(){}}},
  AuthoredFurniture:{load:async()=>({key:'looseCrate',carryable:{}}),buildGroup:()=>new Group(),setRuntimeValues(group,state){group.userData.crateCount=state.crateCount;}},
  Shattercasks:{
    registerBurden(options){options.scene.add(options.group);const burden={...options,exploded:false};burdens.push(burden);return burden;},
    pickUp(){return true;},discardBurden(burden){burden.exploded=true;burden.group.parent?.remove(burden.group);return true;},
    applyBlast(){},grantBurdenLoot(items){if(!allowAward)return [];granted.push(items);return['awarded'];},
  },
  LootRolling:{rollLootPool:()=>({heftroot:2,cloudHerbs:1})},
  AudioSystem:{},
};
function loadModule(target){vm.runInNewContext(source,{window:target,document,localStorage,console},{filename:'crate-piles.js'});}
function makePile(){const group=new Group();group.position.set(3.5,0,5.5);scene.add(group);return group;}
(async()=>{
  loadModule(window);
  const first=window.CratePiles.registerPile({id:'one_pile',mapId:'camp_zone',scene,group:makePile(),lootable:true,count:3});
  assert.equal(first.count,3);
  assert.equal(await window.CratePiles.takeCrate(first),true);
  assert.equal(first.count,2);
  assert.equal(window.CratePiles.shatterBurden(burdens[0],'throw-impact'),true);
  window.CratePiles.tick(.03);
  const storageKey='hobunji.crate-supplies.v1:crate-persistence-regression|1';
  const before=JSON.parse(memory.get(storageKey));
  assert.equal(before.counts['camp_zone::one_pile'],2,'remaining crates must survive area reentry');
  assert.equal(before.drops.length,1,'one uncollected debris pile must be saved');
  assert.equal(before.drops[0].y,0,'thrown junk must rest on the ground, not underneath it');

  scene=new Group(); // The old scene is discarded but the world stays loaded.
  const reentered=window.CratePiles.registerPile({id:'one_pile',mapId:'camp_zone',scene,group:makePile(),lootable:true,count:3});
  assert.equal(reentered.count,2);
  window.CratePiles.tick(.02);
  assert.equal(window.CratePiles.debugSnapshot().looseJunk,1,'uncollected junk survives area rebuild');

  const afterReload={...window,CratePiles:null}; // Fresh JS scope, same persistent world and scene.
  loadModule(afterReload);
  const restored=afterReload.CratePiles.registerPile({id:'one_pile',mapId:'camp_zone',scene,group:makePile(),lootable:true,count:3});
  assert.equal(restored.count,2,'pile count survives page reload');
  afterReload.CratePiles.tick(.02);
  assert.equal(afterReload.CratePiles.debugSnapshot().looseJunk,1,'junk survives page reload');

  player.x=3.5*64;player.y=5.5*64;
  afterReload.CratePiles.tick(.02);
  assert.equal(granted.length,0,'empty inventory-grant result cannot destroy supplies');
  assert.equal(afterReload.CratePiles.debugSnapshot().looseJunk,1);
  allowAward=true;
  afterReload.CratePiles.tick(.02);
  assert.equal(granted.length,1,'walking over the pile grants loot once');
  assert.equal(afterReload.CratePiles.debugSnapshot().looseJunk,0);
  assert.equal(JSON.parse(memory.get(storageKey)).drops.length,0,'collecting removes persisted junk');

  const cave=afterReload.CratePiles.registerPile({id:'one_pile',mapId:'camp_zone',scene,group:makePile(),lootable:true,count:1,persistViaParent:true});
  assert.equal(cave.count,1,'cave world-save count overrides browser-local camp count');
  afterReload.CratePiles.forgetPile('camp_zone','one_pile');
  assert.equal(JSON.parse(memory.get(storageKey)).counts['camp_zone::one_pile'],undefined,'rerolled camp supply counts are erased');
  console.log('PASS crate persistence: throw grounding, scene rebuild, page reload, safe awarding and cave precedence');
})().catch(error=>{console.error(error);process.exitCode=1;});
