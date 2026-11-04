#!/usr/bin/env node
'use strict';

// Real route-renderer visibility lifecycle, isolated from WebGL hardware.
// Detects claimed/revealed chests coming back after loading saved state.
const assert=require('node:assert/strict');
const routes=require('../docs/js/cliff-route-network.js');

class Matrix4 {
  constructor(){this.visible=true;}
  makeScale(x,y,z){this.visible=!(x===0&&y===0&&z===0);return this;}
  clone(){const next=new Matrix4();next.visible=this.visible;return next;}
}
class Object3D {
  constructor(){this.matrix=new Matrix4();this.position={set(){}};this.scale={set(){}};this.rotation={y:0};}
  updateMatrix(){}
}
class InstancedMesh {
  constructor(geometry,material,count){
    this.geometry=geometry;this.material=material;this.count=count;
    this.userData={};this.instances=[];
    this.instanceMatrix={setUsage(){},needsUpdate:false};
  }
  setMatrixAt(index,matrix){this.instances[index]=matrix.visible;}
  computeBoundingSphere(){}
}
const THREE={
  TextureLoader:class{load(){return {};}},
  MeshBasicMaterial:class{},MeshStandardMaterial:class{},
  BoxGeometry:class{},DodecahedronGeometry:class{},
  Matrix4,Object3D,InstancedMesh,DoubleSide:2,DynamicDrawUsage:1,
};
const scene={objects:[],add(mesh){this.objects.push(mesh);}};
const area='test-visible-cliff-chest';
const shelf={id:'treasure',x:4,z:5,y:3,tangent:{x:1,z:0},normal:{x:0,z:1},
  width:2,depth:1,reward:'buriedTreasure',routeId:0};
const net={area,routes:[],balconies:[shelf]};
const meshes=routes.render(THREE,scene,net);
const body=meshes.find(m=>m.name.includes('chest-bodies'));
const lid=meshes.find(m=>m.name.includes('chest-lids'));
assert(body&&lid,'chest render instances exist');
assert.equal(body.instances[0],false,'unrevealed treasure begins hidden');
routes.setRewardStage(area,shelf.id,'revealed');
assert.equal(body.instances[0],true,'digging reveals the chest body');
assert.equal(lid.instances[0],true,'digging also reveals the chest lid');
routes.setRewardStage(area,shelf.id,'claimed');
assert.equal(body.instances[0],false,'looting hides the chest body');
assert.equal(lid.instances[0],false,'looting hides the chest lid');

routes.restoreRewards({[area]:{[shelf.id]:{revealed:true,claimed:false}}});
assert.equal(body.instances[0],true,'restoring an unclaimed chest updates an already-rendered scene');
routes.restoreRewards({[area]:{[shelf.id]:{revealed:true,claimed:true}}});
assert.equal(body.instances[0],false,'restoring a claimed chest hides an already-rendered scene');
routes.restoreRewards({});
assert.equal(body.instances[0],false,'loading no reward progress returns to the unrevealed stage');
routes.releaseArea(area);
routes.setRewardStage(area,shelf.id,'revealed');
assert.equal(body.instances[0],false,'unloaded scenes no longer receive instance updates');
console.log('PASS balcony chest rendering: reveal, claim, restore and scene unload');
