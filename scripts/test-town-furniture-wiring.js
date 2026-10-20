#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const game=fs.readFileSync('docs/game.js','utf8');
const a=game.indexOf('const DECORATIVE_FURNITURE_DEFS =');
const defs=vm.runInNewContext(game.slice(a,game.indexOf('\n      };',a)+9)+';DECORATIVE_FURNITURE_DEFS');
// Minimal matrix boundaries model unrotated grass instances; production modules still own filtering and immutable restoration.
class Matrix4 {
  constructor(){this.elements=Array(16).fill(0);this.elements[0]=this.elements[5]=this.elements[10]=this.elements[15]=1;}
  fromArray(array,offset=0){this.elements=Array.from(array.slice(offset,offset+16));return this;}
  decompose(pos,quat,scale){pos.set(this.elements[12],this.elements[13],this.elements[14]);scale.set(1,1,1);return this;}
  compose(pos){this.elements[12]=pos.x;this.elements[13]=pos.y;this.elements[14]=pos.z;return this;}
  multiplyMatrices(parent,local){this.elements=local.elements.slice();this.elements[12]+=parent.elements[12];this.elements[14]+=parent.elements[14];return this;}
}
class Quaternion {}
class Vector3 { constructor(x=0,y=0,z=0){this.set(x,y,z);} set(x,y,z){Object.assign(this,{x,y,z});return this;} setFromMatrixPosition(matrix){this.x=matrix.elements[12];this.y=matrix.elements[13];this.z=matrix.elements[14];return this;} }
const scene={children:[],add(...objects){for(const obj of objects){obj.parent=this;this.children.push(obj);}return this;},remove(){},updateMatrixWorld(){},traverse(visit){this.children.forEach(visit);}};
const map={id:'map_hobunji_town',decor:[{id:'buffet',key:'servingTable',col:10,row:10},{id:'chair',key:'chairSimple',col:3,row:3}],furniture:[],buildings:[]};
const window={ProceduralFurniture:{},StructurePreload:{ensureReady:()=>Promise.resolve({ready:false})}};
function mesh(c,r,key,scene){
  const root={parent:null,userData:{},position:{x:c+defs[key].fw/2,y:0,z:r+defs[key].fd/2},rotation:{y:0},
    scale:{x:1,y:1,z:1,set(x,y,z){Object.assign(this,{x,y,z});}},traverse(){},updateWorldMatrix(){}};
  scene.add(root);return{mesh:root};
}
const context=vm.createContext({window,console,THREE:{Matrix4,Vector3,Quaternion},queueMicrotask,
  DECORATIVE_FURNITURE_DEFS:defs,PROCESSING_FURNITURE_DEFS:{},_townZone:map,townScene:scene,_townBuildingDefs:[],_townBuildingGroups:[],worldTownTransitions:[],townGrid:[],
  houseWallBuilder:{},INTERIOR_COLS:1,INTERIOR_ROWS:1,tileSurfaceY:()=>0,TileType:{},_zoneLayouts:new Map(),_zoneBuildingGroups:new Map(),_zoneBuildingsGlbUpgradePending:new Set(),_zoneScenes:new Map(),_zoneDecorFurnitureGroups:new Map(),
  makeDecorativeFurnitureMesh:mesh,buildFurnitureVisual:()=>null,_markOutline(){},_markFurnitureEdgeId(){},NORMAL_TOP:0,PLATEAU_UNIT:1,debugLog(){}});
const load=name=>vm.runInContext(fs.readFileSync(`docs/js/${name}.js`,'utf8'),context);
load('furniture-table-system');load('town-zone-buildings');
const init=game.indexOf('      window.TownZoneBuildings?.init({');
vm.runInContext(game.slice(init,game.indexOf('\n      });',init)+10),context); // Execute the actual shipped dependency injection, not a hand-written substitute.
window.TownZoneBuildings.spawnTownDecorFurniture();
const tables=window.FurnitureTableSystem;
assert(tables.findSeat('town',{furnitureId:'chair'})?.def.sit,'town loader receives the same chair definition as the game');
assert(tables.blocksBox('town',10.05,10.5));assert(tables.blocksBox('town',13.95,10.5),'buffet collision covers its far end');
function grass(){
  const node={isInstancedMesh:true,userData:{isBillboard:true},count:2,instanceMatrix:{array:new Float32Array(32)},matrixWorld:new Matrix4(),updateMatrixWorld(){},
    setMatrixAt(index,matrix){this.instanceMatrix.array.set(matrix.elements,index*16);}};
  const matrix=new Matrix4();matrix.elements[12]=11.5;matrix.elements[14]=10.5;node.setMatrixAt(0,matrix);matrix.elements[12]=20.5;matrix.elements[14]=20.5;node.setMatrixAt(1,matrix);
  scene.add(node);return node;
}
(async()=>{
  const old=grass();assert.equal(old.count,2);
  load('building-grass-suppression'); // house-pieces loads this after TownZoneBuildings.init in the real game.
  assert.equal(old.count,1,'late module recovers initialized town dependencies and filters existing grass');
  const next=grass();await Promise.resolve();await Promise.resolve();
  assert.equal(next.count,1,'newly rebuilt grass uses the same clearing footprints');
  window.HobunjiTownSubtleElevation={sampleHeightAt:()=>.25};
  load('zone-grass-billboards'); // Actual terrain follower used to restore the first unfiltered matrices here.
  for(let i=0;i<3;i++) {
    window.TownZoneBuildings.refreshTownSubtleHeightFollowersExact();
    window.BuildingGrassSuppression.refreshTown();
    for(const node of [old,next]) {
      assert.equal(node.count,1,'height refresh cannot resurrect blocked grass');
      assert.equal(node.instanceMatrix.array[12],20.5,'surviving matrix stays outside the buffet');
      assert.equal(node.instanceMatrix.array[13],.25,'height projection is applied exactly once');
    }
  }
  const rebuilt=grass();await Promise.resolve();await Promise.resolve();
  assert.equal(rebuilt.count,1,'rebuild with both hooks active stays compacted');
  assert.equal(rebuilt.instanceMatrix.array[13],.25);
  const extra={id:'extra',key:'tableSmall',col:20,row:20};
  tables.registerPlacement('town',extra,mesh(20,20,'tableSmall',scene).mesh,defs.tableSmall);
  window.BuildingGrassSuppression.refreshTown();
  assert.equal(old.count,0,'all grass can be suppressed');
  window.TownZoneBuildings.refreshTownSubtleHeightFollowersExact();assert.equal(old.count,0,'zero-visible meshes remain suppressed');
  tables.clearArea('town');window.BuildingGrassSuppression.refreshTown();
  window.TownZoneBuildings.refreshTownSubtleHeightFollowersExact();
  for(const node of [old,next,rebuilt]) {
    assert.equal(node.count,2,'removing furniture restores the entire source, including zero-visible meshes');
    assert.equal(node.instanceMatrix.array[12],11.5);
    assert.equal(node.instanceMatrix.array[13],.25,'restored grass retains terrain height without accumulating it');
  }
  console.log('Town furniture: actual init wiring, real chair/collision definitions, late grass load, rebuild and removal restoration passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
