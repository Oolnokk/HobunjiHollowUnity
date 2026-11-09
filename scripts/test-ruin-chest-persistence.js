'use strict';
// Real dungeon chest module: opened chests remain opened across a regenerated
// ruin session and are not a repeatable source of loot.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
class Node{
  constructor(){this.children=[];this.position={x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;}};
    this.rotation={x:0,y:0};this.scale={set(){}};this.userData={};}
  add(...children){for(const child of children){this.children.push(child);child.parent=this;}}
  remove(child){this.children=this.children.filter(x=>x!==child);child.parent=null;}
}
class Mesh extends Node{constructor(geo,mat){super();this.geometry=geo;this.material=mat;}}
class Sprite extends Mesh{}
class Material{constructor(data){Object.assign(this,data);}}
class Shape{constructor(){}}
const THREE={Group:Node,Mesh,Sprite,SpriteMaterial:Material,CanvasTexture:Shape,Vector3:class{},BoxGeometry:Shape};
const canvas={getContext:()=>({createRadialGradient:()=>({addColorStop(){}}),fillRect(){}})};
const records=new Set(); // Minimal real-site persistence API, analogous to RuinSites' saved openedChests.
let grantCount=0,savePossible=true;
const scene=new Node();scene.isScene=true;
const window={THREE,DynamicSurfaces:{addBeforeRenderClient(){}},DevSpawner:{init(){}},
  ProceduralFurniture:{makePartMaterial:()=>new Material({})},
  DevRandomRuin:{getSeed:()=>71,getState:()=>({theme:'hronal'})},
  DevRandomRuinFurniturePieces:{solid:()=>new Node(),pivotParts:()=>new Node()},
  RuinSites:{isInSite:()=>true,
    isActiveRuinChestOpened:(id,seed)=>seed===71&&records.has(id),
    markActiveRuinChestOpened:(id,seed)=>{if(!savePossible||seed!==71)return false;records.add(id);return true;}},
  LootRolling:{rollLootPool:()=>({stone:2})},
  ArtifactCollection:{ARTIFACTS:{harlyaoCopperCoin:{}},rollArtifacts:()=>({harlyaoCopperCoin:1})},
  __farmLog(){}};
const context={window,THREE,document:{createElement:()=>canvas},performance:{now:()=>1000},console};
vm.runInNewContext(fs.readFileSync('docs/js/dev-random-ruin-dungeon-chests.js','utf8'),context);
const chests=window.DevRandomRuinDungeonChests;
window.DevSpawner.init({grantLoot:()=>{grantCount++;return ['stone'];},showToast(){}});
const opts={id:'vault-chest-1',tier:3,parent:scene,x:4,z:3,theme:'hronal'};
const first=chests.create(opts);
assert.equal(first.opened,false);
assert.equal(chests.open(first),true,'first lockpick grants loot');
assert.equal(grantCount,1);
assert(records.has(first.id),'loot claim is recorded in the persistent ruin site');
const replacement=chests.create(opts);
assert.equal(replacement.opened,true,'regenerated chest restores as opened');
assert.equal(replacement.hinge.rotation.x,-1.95,'opened lid restores physically, not only the interaction flag');
assert.equal(chests.open(replacement),false,'the same chest cannot be looted twice');
assert.equal(grantCount,1,'no duplicate loot grants after re-entry');
assert.equal(chests.controlsFor([replacement]).length,0,'no contextual Open action on a previously looted chest');
savePossible=false;
const blocked=chests.create({...opts,id:'vault-chest-2'});
assert.equal(chests.open(blocked),false,'unwritable world save cannot mint repeatable loot');
assert.equal(grantCount,1);
console.log('Dungeon chest progress persists and blocks duplicate loot: PASS');