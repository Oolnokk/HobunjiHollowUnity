'use strict';
// Run: node scripts/test-pingdort-exterior-nest-hold.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../docs/js/den-nest-system.js'),'utf8');
class Vector3 {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z;}
  normalize(){const n=Math.sqrt(this.lengthSq())||1;this.x/=n;this.y/=n;this.z/=n;return this;}
  clone(){return new Vector3(this.x,this.y,this.z);}
}
class Group {
  constructor(){this.children=[];this.parent=null;this.visible=true;this.userData={};
    this.position=new Vector3();this.position.set=(x,y,z)=>{Object.assign(this.position,{x,y,z});};
    this.rotation={y:0};this.scale={multiplyScalar(){}};
  }
  add(child){child.parent=this;this.children.push(child);}
  remove(child){this.children=this.children.filter(x=>x!==child);child.parent=null;}
  traverse(fn){fn(this);for(const c of this.children)c.traverse(fn);}
  updateWorldMatrix(){}
}
class Geometry {dispose(){}}
class Material {constructor(opts){Object.assign(this,opts);}dispose(){}}
class Mesh extends Group {constructor(geometry,material){super();this.geometry=geometry;this.material=material;}}
class Texture {constructor(canvas){this.image=canvas;}dispose(){}}
class Raycaster {
  intersectObjects(hitPlanes){return hitPlanes.length?[{object:hitPlanes[0],distance:1,
    uv:{x:.5,y:.5},point:new Vector3(0,0,0)}]:[];}
}
const THREE={Group,Mesh,Vector3,Raycaster,PlaneGeometry:Geometry,MeshBasicMaterial:Material,
  CanvasTexture:Texture,Box3:class {setFromObject(){return this;}},DoubleSide:2};
const scene=new Group(),furniture=new Group();scene.add(furniture);
const inventory={},player={x:45.5*64,y:45.5*64,physicalFeetY:12.5};
const nest={id:'native-exterior-eggs',areaId:'map_southern_cloud_forest',
  x:player.x,y:player.y,col:45,row:45,w:1,h:1,
  worldY:12.5,remaining:3,itemKey:'fertilePingdortEgg',
  genotype:{base:{color:'#849877'}},mesh:furniture,eggCollected:0};
nest.onEggCollected=()=>nest.eggCollected++;
const classNames=new Set();
const hud={classList:{add:v=>classNames.add(v),remove:v=>classNames.delete(v),
  contains:v=>classNames.has(v)}};
const widgets={nestTakeHud:hud,nestTakeLabel:{textContent:''},
  nestTakeFill:{style:{width:''}}};
const canvasData=new Uint8ClampedArray(128*128*4);
for(let i=3;i<canvasData.length;i+=4)canvasData[i]=255;
const document={getElementById:id=>widgets[id]||null,
  createElement:kind=>{assert.equal(kind,'canvas');return {width:128,height:128,getContext:()=>({
    clearRect(){},fillText(){},getImageData:()=>({data:canvasData}),
  })};}};
const window={FarmAnimals:{queueItemGenotype(){window.queued++}},
  PingdortFlocks:{nestRecords:()=>[nest]},
  InventoryStacks:{MAX_TOTAL:99},
  __farmLog(){},queued:0};
const sandbox={window,document,THREE,performance:{now:()=>1000},
  console,Promise,Uint8ClampedArray};
vm.runInNewContext(source,sandbox,{filename:'den-nest-system.js'});
let holdSeconds=0,action='nest_take',pressed=true;
const toasts=[];
const deps={_denNests:new Map(),getCurrentArea:()=>nest.areaId,
  getActiveScene:()=>scene,player,playerMesh:{position:{y:12.5}},TILE:64,
  inventory,ITEM_DEFS:{fertilePingdortEgg:{icon:'🥚',label:'Fertile Pingdort Egg'}},
  itemIconForKey:()=> '🥚',
  getPlayerAimRay:()=>({origin:new Vector3(45.5,13,45.5),direction:new Vector3(0,-.4,1)}),
  getNestHoldT:()=>holdSeconds,setNestHoldT:value=>{holdSeconds=value;},
  getActiveAction:()=>action,getActionHeldDown:()=>pressed,
  clampInventoryStack(){},buildInventoryGrid(){},refreshItemScroll(){},
  refreshActionBar(){},saveMemberWorldData(){},
  showToast:(message,ok)=>toasts.push({message,ok}),
};
window.DenNestSystem.init(deps);
async function run(){
  // Promises mirror the asynchronous native PNG/emoji egg-plane renderer.
  assert.equal(window.DenNestSystem.currentAimedNest(),null,'eggs are initially queued');
  await Promise.resolve();await Promise.resolve();
  assert.equal(window.DenNestSystem.currentAimedNest(),nest,'aimed egg claims native interaction');
  for(let i=0;i<51;i++)window.DenNestSystem.updateNestInteraction(.1);
  assert.equal(inventory.fertilePingdortEgg,1,'five-second hold takes one real egg');
  assert.equal(nest.remaining,2,'clutch count updates after one egg');
  assert.equal(nest.eggCollected,1,'existing save callback invoked');
  assert.equal(window.queued,1,'the inherited genotype joins the livestock item queue');
  assert.equal(window.DenNestSystem.debugSnapshot().renderedContents,2);
  player.physicalFeetY=null;deps.playerMesh.position.y=0;
  assert.equal(window.DenNestSystem.currentAimedNest(),null,
    'standing below the cliff cannot interact through its rock');
  for(let i=0;i<55;i++)window.DenNestSystem.updateNestInteraction(.1);
  assert.equal(nest.remaining,2,'the hidden elevated nest cannot be harvested remotely');
  player.physicalFeetY=12.5;deps.playerMesh.position.y=12.5;
  inventory.fertilePingdortEgg=99;
  for(let i=0;i<51;i++)window.DenNestSystem.updateNestInteraction(.1);
  assert.equal(nest.remaining,2,'full inventory cannot discard a real nest egg');
  inventory.fertilePingdortEgg=1;
  for(let i=0;i<51;i++)window.DenNestSystem.updateNestInteraction(.1);
  assert.equal(nest.remaining,1,'a second successful hold only takes one more');
  pressed=false;window.DenNestSystem.updateNestInteraction(.1);
  assert.equal(holdSeconds,0,'releasing the input resets the hold timer');
  console.log('Pingdort exterior hold interaction, cliff elevation, inventory and genotype PASS');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
