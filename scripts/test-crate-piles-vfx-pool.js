#!/usr/bin/env node
// Crate wood fragments reuse a bounded instanced VFX pool, even during rapid camp combat.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'..','docs/js/crate-piles.js'),'utf8');
let allocations=0; // Counts actual new GPU-backed instance-mesh allocations.
class Vector3 {constructor(x=0,y=0,z=0){this.set(x,y,z);}set(x,y,z){Object.assign(this,{x,y,z});return this;}copy(v){return this.set(v.x,v.y,v.z);}}
class Group {
  constructor(){this.isObject3D=true;this.children=[];this.parent=null;this.userData={};this.position=new Vector3();
    this.rotation={set(){}};this.scale={set(){},setScalar(){}};}
  add(mesh){mesh.parent?.remove(mesh);mesh.parent=this;this.children.push(mesh);}
  remove(mesh){this.children=this.children.filter(value=>value!==mesh);mesh.parent=null;}
  getWorldPosition(target){return target.copy(this.position);}
  updateWorldMatrix(){}
}
class Mesh extends Group {constructor(geometry,material){super();this.geometry=geometry;this.material=material;}}
class InstancedMesh extends Mesh {
  constructor(geometry,material,count){super(geometry,material);allocations++;this.count=count;this.instanceMatrix={needsUpdate:false};}
  setMatrixAt(){}
}
class Object3D extends Group {constructor(){super();this.matrix={};}updateMatrix(){this.matrix={x:this.position.x,y:this.position.y,z:this.position.z};}}
const THREE={Vector3,Group,Mesh,InstancedMesh,Object3D,PlaneGeometry:class{},TetrahedronGeometry:class{},
  MeshBasicMaterial:class{},CanvasTexture:class{},DoubleSide:2,RepeatWrapping:1000,
  TextureLoader:class{load(){return{repeat:{set(){}},offset:{set(){}}};}}};
const scene=new Group(); // All piles share one active test zone scene.
const window={
  THREE,GridTileAccessors:{getCurrentArea:()=>'test_zone',getActiveScene:()=>scene},
  Combat:{deps:{TILE:64,getCurrentArea:()=>'test_zone',player:{x:70*64,y:70*64},getGroundYAtWorld:()=>0}},
  AuthoredFurniture:{setRuntimeValues(){}},Shattercasks:{applyBlast(){},grantBurdenLoot:()=>['ok']},
  LootRolling:{rollLootPool:()=>({heftroot:1})},AudioSystem:{},
};
const document={createElement:()=>({getContext:()=>({clearRect(){},fillText(){}})})};
vm.runInNewContext(source,{window,document,console},{filename:'crate-piles.js'});
function shatterOne(number) {
  const group=new Group();group.position.set(number+.5,0,3.5);scene.add(group);
  window.CratePiles.registerPile({id:'pile_'+number,mapId:'test_zone',scene,group,count:3,lootable:true});
  const collider={origin:{x:number,y:.5,z:3.5},yaw:0,horizontalRangeWorld:2,
    verticalRiseWorld:0,halfConeRad:.6,halfHeightWorld:.8};
  assert.equal(window.CratePiles.sweepMelee(collider),true,'crate melee must trigger the real debris effect');
}
shatterOne(1);
assert.equal(allocations,1,'first shatter allocates exactly one instanced buffer');
for(let i=0;i<10;i++)window.CratePiles.tick(.1);
assert.equal(window.CratePiles.debugSnapshot().reusableDebrisBuffers,1,'completed burst returns to pool');
shatterOne(2);
assert.equal(allocations,1,'repeated shatter reuses the same GPU buffer');
for(let i=0;i<12;i++)shatterOne(3+i);
const result=window.CratePiles.debugSnapshot();
assert.equal(result.activeDebrisBursts,10,'never display over ten simultaneous sprays');
assert.equal(allocations,10,'never allocate more than ten instance meshes for the same effect');
console.log('PASS crate VFX pooling: one-buffer reuse and ten-simultaneous cap');
