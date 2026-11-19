#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const avatarSource=fs.readFileSync('docs/js/png-plane-avatar.js','utf8'); // Real animal head-rig registration and disposal, not a duplicate adapter.
class Attribute{
  constructor(array,size){this.array=array;this.itemSize=size;this.count=array.length/size;}
  getX(i){return this.array[i*this.itemSize];}
  getY(i){return this.array[i*this.itemSize+1];}
}
class PlaneGeometry{
  constructor(width,height,nx=1,ny=1){
    this.parameters={width,height,widthSegments:nx,heightSegments:ny};this.userData={};
    const uv=[];for(let row=0;row<=ny;row++)for(let col=0;col<=nx;col++)uv.push(col/nx,1-row/ny);
    this.attributes={uv:new Attribute(new Float32Array(uv),2)};
  }
  getAttribute(key){return this.attributes[key];}
  setAttribute(key,value){this.attributes[key]=value;}
  clone(){const p=this.parameters;return new PlaneGeometry(p.width,p.height,p.widthSegments,p.heightSegments);}
  computeBoundingBox(){}
  computeBoundingSphere(){}
  dispose(){this.disposed=true;}
}
class Vector{
  constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}
  copy(other){Object.assign(this,{x:other.x,y:other.y,z:other.z});return this;}
  set(x,y,z){Object.assign(this,{x,y,z});return this;}
}
class Object3D{
  constructor(){this.position=new Vector();this.rotation=new Vector();this.scale=new Vector(1,1,1);this.userData={};this.children=[];this.visible=true;this.renderOrder=0;}
  add(child){this.children.push(child);child.parent=this;}
  remove(child){this.children=this.children.filter(other=>other!==child);child.parent=null;}
}
class Mesh extends Object3D{constructor(geometry,material){super();this.geometry=geometry;this.material=material;this.isMesh=true;}}
class SkinnedMesh extends Mesh{constructor(geometry,material){super(geometry,material);this.isSkinnedMesh=true;}bind(skeleton){this.skeleton=skeleton;}}
class Bone extends Object3D{}
class Skeleton{constructor(bones){this.bones=bones;}dispose(){this.disposed=true;}}
class Material{constructor(options){Object.assign(this,options);}dispose(){this.disposed=true;}}
const THREE={Group:Object3D,Mesh,SkinnedMesh,Bone,Skeleton,PlaneGeometry,
  Uint16BufferAttribute:Attribute,Float32BufferAttribute:Attribute,MeshBasicMaterial:Material,DoubleSide:2};
const storage={getItem:()=>null,setItem(){}};
const windowStub={localStorage:storage,dispatchEvent(){}};
const start=avatarSource.indexOf('  // Mesh budgets:');
const stop=avatarSource.indexOf('  function buildSkinnedPlaneGeometry(',start);
assert(start>0 && stop>start);
const meshBudget=new Function('window','WeakRef','FinalizationRegistry','Event','console',
  avatarSource.slice(start,stop)+'return meshBudget;')(windowStub,
  class {constructor(value){this.value=value;}deref(){return this.value;}},undefined,
  class {constructor(type){this.type=type;}},console);
let sourceDisposals=0; // The initial rigid cards are still owned by the original avatar builder's cleanup.
const sourceGeometries=[];
windowStub.PNGPlaneAvatar={meshBudget,buildAnimalPlaneAvatarModel(THREE_NS,url,opts){
  const group=new THREE_NS.Group();
  const front=new THREE_NS.Mesh(new THREE_NS.PlaneGeometry(opts.modelWidth,opts.modelHeight),new Material({map:'genotype-front'}));
  const back=new THREE_NS.Mesh(front.geometry.clone(),new Material({map:'genotype-back'}));
  front.name='front';back.name='back';sourceGeometries.push(front.geometry,back.geometry);group.add(front);group.add(back);
  return {group,frontPlane:front,backPlane:back,dispose(){sourceDisposals++;front.geometry.dispose();back.geometry.dispose();}};
}};
const animalStart=avatarSource.indexOf('// Optional painted-weight head rig for side-view animal planes.');
assert(animalStart>0);
new Function('window','localStorage',avatarSource.slice(animalStart))(windowStub,storage);
const headRig={enabled:true,pivot:{x:.35,y:.5},meshResolution:48,minDeg:-30,maxDeg:30,restDeg:0,
  weightMap:{width:128,height:75,encoding:'rle-u9',data:[128*75,128]}}; // Authored format rather than a hand-built normalized rig.
const animal=windowStub.PNGPlaneAvatar.buildAnimalPlaneAvatarModel(THREE,'animal.png',
  {name:'gar-wolf',modelWidth:2.1,modelHeight:.95,headRig});
assert(animal.frontPlane.isSkinnedMesh&&animal.backPlane.isSkinnedMesh,'both faces upgraded to skinned live cards');
assert.equal(animal.frontPlane.geometry.userData.segmentsX,12);
assert.equal(animal.backPlane.geometry.userData.segmentsY,7);
assert.equal(meshBudget.portraitDensityDebug().animalFaces,2,'both head skins are registered');
const headBone=animal.headRig.frontHeadBone, material=animal.frontPlane.material, oldGeometry=animal.frontPlane.geometry;
animal.setHeadRotation(18);
const oldAngle=headBone.rotation.z;
assert.equal(meshBudget.setPortraitDensityPercent(100),true);
assert.equal(animal.frontPlane.geometry.userData.segmentsX,30);
assert.equal(animal.backPlane.geometry.userData.segmentsY,18);
assert.strictEqual(animal.headRig.frontHeadBone,headBone,'existing animated head bone retained');
assert.equal(headBone.rotation.z,oldAngle,'posed head angle remains unchanged through retessellation');
assert.strictEqual(animal.frontPlane.material,material,'genotype material and map are retained');
assert(oldGeometry.disposed,'old GPU buffer freed after replacement');
meshBudget.setPortraitWireframeEnabled(true);
assert.notEqual(animal.frontPlane.material, material);
animal.frontPlane.material.map = 'new-grown-frame'; // Frame writers still target the active material during diagnostics.
assert.equal(animal.frontPlane.material.map, null, 'wireframe draws the whole geometry with no sampled sprite');
assert.equal(meshBudget.originalPortraitMaterial(animal.frontPlane).map, 'new-grown-frame');
meshBudget.setPortraitWireframeEnabled(false);
assert.equal(animal.frontPlane.material.map, 'new-grown-frame', 'turning wireframe off reveals the latest bound sprite');

animal.dispose();
animal.dispose();
assert.equal(sourceDisposals,1,'both modern and original dispose chains are idempotent');
assert.equal(meshBudget.portraitDensityDebug().animalFaces,0,'both weak registrations removed');
assert(animal.frontPlane.geometry.disposed&&animal.backPlane.geometry.disposed,'current weighted GPU buffers released');
assert(sourceGeometries.every(geometry=>geometry.disposed),'original rigid-card source buffers also released');
console.log('OK: full authored animal head-rig lifecycle across live density changes, skeleton/material preservation, and disposal');
