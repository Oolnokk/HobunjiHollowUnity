#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const shoulderSource = fs.readFileSync('docs/js/animal-shoulder-spline.js','utf8'); // Real seven-point shoulder and split-layer adapter.
const responseSource = fs.readFileSync('docs/js/animal-head-material-response.js','utf8'); // Real compression/stretch head skinning adapter.

class Attribute {
  constructor(array,size){this.array=array;this.itemSize=size;this.count=array.length/size;}
  getX(i){return this.array[i*this.itemSize];}
  getY(i){return this.array[i*this.itemSize+1];}
}
class Geometry {
  constructor(nx,ny){
    this.parameters={width:2,height:1};this.userData={};
    const uv=[],position=[],skinWeight=[],skinIndex=[];
    for(let row=0;row<=ny;row++) for(let col=0;col<=nx;col++){
      const u=col/nx,v=1-row/ny;
      uv.push(u,v);position.push((u-.5)*2,v-.5,0);
      skinWeight.push(.5,.5,0,0);skinIndex.push(0,1,0,0);
    }
    this.attributes={uv:new Attribute(new Float32Array(uv),2),
      position:new Attribute(new Float32Array(position),3),
      skinWeight:new Attribute(new Float32Array(skinWeight),4),
      skinIndex:new Attribute(new Uint16Array(skinIndex),4)};
  }
  getAttribute(name){return this.attributes[name];}
  setAttribute(name,value){this.attributes[name]=value;}
  clone(){
    const copy=Object.create(Geometry.prototype);copy.parameters={...this.parameters};copy.userData={...this.userData};
    copy.attributes=Object.fromEntries(Object.entries(this.attributes).map(([key,attr])=>[key,new Attribute(attr.array.slice(),attr.itemSize)]));
    return copy;
  }
  computeBoundingBox(){}
  computeBoundingSphere(){}
  dispose(){this.disposed=true;}
}
function transform(){return{x:0,y:0,z:0,copy(other){this.x=other.x;this.y=other.y;this.z=other.z;return this;}};}
class Material { clone(){return new Material();}dispose(){this.disposed=true;} }
class Mesh {
  constructor(geometry,material){
    this.geometry=geometry;this.material=material;this.name='animal';this.userData={};this.isSkinnedMesh=true;
    this.position=transform();this.quaternion=transform();this.scale=transform();
    this.skeleton={bones:[]};this.bindMatrix={clone(){return {};}};this.visible=true;this.renderOrder=2;
  }
  bind(skeleton){this.skeleton=skeleton;}
}
const THREE={SkinnedMesh:Mesh,CanvasTexture:class{dispose(){}}};
const group={children:[],userData:{},add(mesh){this.children.push(mesh);mesh.parent=this;},remove(mesh){this.children=this.children.filter(other=>other!==mesh);}};
const frontBone={},backBone={};
const front=new Mesh(new Geometry(12,7),new Material()),back=new Mesh(new Geometry(12,7),new Material());
front.skeleton.bones=[frontBone];back.skeleton.bones=[backBone];
front.userData.hobunjiPlaneFace='front';back.userData.hobunjiPlaneFace='back';
group.add(front);group.add(back);
const state={frontHeadBone:frontBone,backHeadBone:backBone,currentDeg:20,appliedDeg:20,currentYawDeg:0};
let originalDisposals=0; // Proves developer retessellation does not replace or dispose the real animal avatar.
const avatar={group,headRig:state,dispose(){originalDisposals++;},
  setHeadRotation(deg){state.currentDeg=state.appliedDeg=deg;return deg;},
  updateHeadYaw(deg){state.currentYawDeg=deg;return deg;}};
let wireframe=false;
const windowStub={AnimalHeadRigRuntime:{normalizeRig:raw=>raw,UNSET_WEIGHT:256},
  PNGPlaneAvatar:{meshBudget:{wireframeEnabled:()=>wireframe},buildAnimalPlaneAvatarModel:()=>avatar}};
new Function('window',shoulderSource)(windowStub);
new Function('window',responseSource)(windowStub);
const before=Array.from({length:7},(_,i)=>({x:.2+i*.11,y:.45}));
const after=before.map(point=>({...point,y:point.y+.12}));
const rig={weightMap:{width:2,height:2,values:new Uint16Array(4)},
  shoulderRest:{enabled:true,useSpline:true,splitFrame:true,frameShiftX:.2,beforePoints:before,afterPoints:after}};
windowStub.PNGPlaneAvatar.buildAnimalPlaneAvatarModel(THREE,'animal.png',{headRig:rig});
assert.equal(avatar.shoulderRest.version,10);
const overlays=group.children.filter(mesh=>mesh.userData.hobunjiShoulderSplitOverlay);
assert.equal(overlays.length,2,'two skinned split-frame overlays');
avatar.setShoulderRestEnabled(true);avatar.setShoulderSplitOverlayEnabled(true);
assert.equal(avatar.shoulderRest.enabled,true);
assert(overlays.every(mesh=>mesh.visible),'split halves visible on shoulder');
const rightTop=front.geometry.getAttribute('position').array[12*3+1];
assert(Math.abs(rightTop-.5)>1e-3,'authored shoulder spline deforms right-side position');

const materials={pivot:{y:.5},
  compressibilityMap:{width:2,height:2,encoding:'rle-u9',data:[4,32]},
  stretchabilityMap:{width:2,height:2,encoding:'rle-u9',data:[4,64]}};
windowStub.AnimalHeadMaterialResponse.decorateAvatar(avatar,materials);
assert(avatar.headMaterialResponse.active);
const oldOverlayGeometry=overlays[0].geometry,oldSkin=front.geometry.getAttribute('skinWeight');

front.geometry=new Geometry(30,18);back.geometry=new Geometry(30,18); // Simulates a 40→100% developer slider rebuild of BOTH head faces.
avatar.refreshShoulderRestGeometry();avatar.refreshHeadMaterialGeometry();
assert.equal(avatar.shoulderRest.frontVertices,31*19,'new shoulder vertex arrays tracked');
assert.equal(avatar.shoulderRest.backVertices,31*19);
assert.equal(front.geometry.getAttribute('position').count,31*19);
assert.notStrictEqual(front.geometry.getAttribute('skinWeight'),oldSkin,'old skin arrays are no longer used');
assert.equal(overlays[0].geometry.getAttribute('position').count,31*19,'split overlay tracks new mesh density');
assert.equal(oldOverlayGeometry.disposed,true,'retired overlay buffer disposed');
assert.strictEqual(overlays[0].geometry.getAttribute('skinWeight'),front.geometry.getAttribute('skinWeight'),'split overlay shares current animated head weights');
assert.equal(avatar.shoulderRest.enabled,true,'active shoulder pose survives live retessellation');
assert(Math.abs(front.geometry.getAttribute('position').array[30*3+1]-.5)>1e-3,'shoulder deformation reapplied to the new vertices');
const weights=front.geometry.getAttribute('skinWeight');
assert(weights.array.some((value,i)=>i%4===1&&value<.5),'current head material compression applied to new geometry');
avatar.updateHeadYaw(10);
assert.equal(avatar.headMaterialResponse.lastYawDeg,10,'new skin array continues to respond to head yaw');
assert(avatar.headMaterialResponse.dump().front,'existing mobile diagnostics remain usable');
wireframe=true;avatar.refreshAnimalWireframe(true);
assert(overlays.every(mesh=>!mesh.visible),'wireframe does not leak opaque split-frame texture overlays');
wireframe=false;avatar.refreshAnimalWireframe(false);
assert(overlays.every(mesh=>mesh.visible),'wireframe teardown restores requested split-frame layers');
avatar.setShoulderRestEnabled(false);
assert.equal(avatar.shoulderRest.enabled,false);
assert.equal(front.geometry.getAttribute('position').array[1],.5,'disabling shoulder returns to the new bind pose');
assert(overlays.every(mesh=>!mesh.visible));
avatar.dispose();
assert.equal(originalDisposals,1,'normal animal disposal still called exactly once');
assert(overlays.every(mesh=>mesh.geometry.disposed),'all replacement split geometries released');
console.log('OK: real animal shoulder spline, split overlays, head material compression/yaw, live retessellation, wireframe, and disposal');
