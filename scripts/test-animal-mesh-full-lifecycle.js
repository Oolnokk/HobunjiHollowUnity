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
  weightMap:{width:128,height:75,data:Array.from({length:128*75},(_,i)=>
    i%128<40&&Math.floor(i/128)<40?255:0)}}; // Authored head cutout: chest/legs stay unpainted even ahead of the neck.
const animal=windowStub.PNGPlaneAvatar.buildAnimalPlaneAvatarModel(THREE,'animal.png',
  {name:'gar-wolf',modelWidth:2.1,modelHeight:.95,headRig});
assert(animal.frontPlane.isSkinnedMesh&&animal.backPlane.isSkinnedMesh,'both faces upgraded to skinned live cards');
assert.equal(animal.headRig.yawMode, 'paper-fold', 'yaw mode is visible to the mobile diagnostics');
for (const face of [animal.frontPlane, animal.backPlane]) {
  assert.equal(face.skeleton.bones.length, 4, 'each card has separate pitch, yaw and combined transforms');
  assert.equal(face.geometry.userData.hobunjiAnimalYawFold, true, 'material response can preserve independent yaw weights');
  assert.equal(face.geometry.userData.hobunjiAnimalYawMask, 'binary-head', 'rigid yaw excludes non-head anatomy');
  const weights = face.geometry.getAttribute('skinWeight').array;
  const width = face.geometry.userData.segmentsX + 1;
  const faceCol = face === animal.frontPlane ? 0 : width - 1;
  const bodyCol = face === animal.frontPlane ? width - 1 : 0;
  const faceFold = weights[faceCol * 4 + 2] + weights[faceCol * 4 + 3];
  const bodyFold = weights[bodyCol * 4 + 2] + weights[bodyCol * 4 + 3];
  const legOffset = (face.geometry.userData.segmentsY * width + faceCol) * 4;
  const legFold = weights[legOffset + 2] + weights[legOffset + 3];
  assert(Math.abs(faceFold - 1) < 1e-5, 'authored head pixels fold rigidly at the neck');
  assert(Math.abs(bodyFold) < 1e-5, 'unpainted torso pixels remain independent of yaw');
  assert(Math.abs(legFold) < 1e-5, 'unpainted front leg pixels ahead of the neck remain unaffected');
  for (let i = 0; i < weights.length; i += 4) {
    const yaw = weights[i + 2] + weights[i + 3];
    const head = weights[i + 1] + weights[i + 3];
    assert(yaw === 0 || yaw === 1, 'each head vertex turns like one rigid paper card');
    assert.equal(yaw, +(head >= .5), 'yaw is a binary cutout classification, not graded Influence');
  }
  for (let i = 0; i < weights.length; i += 4) {
    assert(Math.abs(weights[i] + weights[i + 1] + weights[i + 2] + weights[i + 3] - 1) < 1e-5,
      'four-way skin weights remain normalized');
  }
}
assert.equal(animal.frontPlane.geometry.userData.segmentsX,12);
assert.equal(animal.backPlane.geometry.userData.segmentsY,7);
assert.equal(meshBudget.portraitDensityDebug().animalFaces,2,'both head skins are registered');
const headBone=animal.headRig.frontHeadBone, material=animal.frontPlane.material, oldGeometry=animal.frontPlane.geometry;
animal.setHeadRotation(18);
const oldAngle=headBone.rotation.z;
animal.updateHeadYaw(18, 1);
assert.equal(animal.headRig.frontYawBone.rotation.y, animal.headRig.backYawBone.rotation.y,
  'both side-view cards yaw with the same handedness');
assert.equal(animal.headRig.frontCombinedBone.rotation.y, animal.headRig.frontYawBone.rotation.y,
  'combined head transform carries the independent rigid hinge yaw');
assert.equal(animal.headRig.frontCombinedBone.rotation.z, oldAngle,
  'combined transform retains painted pitch while the head turns');
assert.equal(animal.headRig.backCombinedBone.rotation.z, -oldAngle,
  'reverse-facing pitch keeps its normal handedness');
assert.equal(headBone.rotation.y, 0, 'legacy painted pitch bone never receives yaw');
assert.equal(meshBudget.setPortraitDensityPercent(100),true);
assert.equal(animal.frontPlane.geometry.userData.segmentsX,30);
assert.equal(animal.backPlane.geometry.userData.segmentsY,18);
assert.strictEqual(animal.headRig.frontHeadBone,headBone,'existing animated head bone retained');
assert.equal(headBone.rotation.z,oldAngle,'posed head angle remains unchanged through retessellation');
assert.equal(animal.headRig.frontCombinedBone.rotation.z, oldAngle, 'pitch part of folding yaw survives retessellation');
assert.equal(animal.headRig.frontCombinedBone.rotation.y, animal.headRig.frontYawBone.rotation.y, 'yaw survives retessellation');
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
