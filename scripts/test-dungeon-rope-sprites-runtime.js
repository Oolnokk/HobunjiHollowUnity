#!/usr/bin/env node
'use strict';
// Executable geometry/material regression using the shipped sprite and authored runtime.
// The browser owns rendering; these mocks test camera updates, UVs and asynchronous resource sharing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8'); // Real production sources under review.
const png = fs.readFileSync(path.join(root, 'docs/assets/objectsprites/rope_long.png')); // Exact PNG proportions.
const imageW=png.readUInt32BE(16), imageH=png.readUInt32BE(20);
assert.equal(imageW,152);assert.equal(imageH,2164);
class Vector3 {
  constructor(x=0,y=0,z=0){this.set(x,y,z)}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this}
  copy(v){return this.set(v.x,v.y,v.z)}
  sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this}
  addScaledVector(v,k){this.x+=v.x*k;this.y+=v.y*k;this.z+=v.z*k;return this}
  dot(v){return this.x*v.x+this.y*v.y+this.z*v.z}
  lengthSq(){return this.dot(this)}
  length(){return Math.sqrt(this.lengthSq())}
  divideScalar(n){this.x/=n;this.y/=n;this.z/=n;return this}
  crossVectors(a,b){return this.set(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x)}
  normalize(){return this.divideScalar(this.length()||1)}
}
class Matrix4 {makeBasis(x,y,z){this.axes=[x.x,x.y,x.z,y.x,y.y,y.z,z.x,z.y,z.z];return this}}
class Material {
  constructor(values={}){Object.assign(this,values);this.userData={};this.color={set(){}};this.handlers=[]}
  clone(){const result=new Material({...this});result.color={set(){}};return result}
  addEventListener(_,fn){this.handlers.push(fn)}
  dispose(){for(const fn of this.handlers)fn()}
}
class Attribute {
  constructor(array,size){this.array=array;this.itemSize=size;this.count=array.length/size}
  getX(i){return this.array[i*this.itemSize]}
  getY(i){return this.array[i*this.itemSize+1]}
  getZ(i){return this.array[i*this.itemSize+2]}
}
class Geometry {
  constructor(){this.attributes={};this.groups=[];this.index=null}
  setAttribute(key,value){this.attributes[key]=value;return this}
  getAttribute(key){return this.attributes[key]}
  computeVertexNormals(){}
  clearGroups(){this.groups=[]}
  addGroup(a,b,c){this.groups.push({start:a,count:b,index:c})}
  clone(){const g=new Geometry();g.attributes={...this.attributes};return g}
  dispose(){this.disposed=true}
}
class Mesh {
  constructor(geometry,material){this.geometry=geometry;this.material=material;this.position=new Vector3();this.scale=new Vector3(1,1,1);this.userData={};this.isMesh=true;this.orientations=[];this.quaternion={setFromRotationMatrix:m=>{this.orientations.push([...m.axes])}}}
  updateMatrixWorld(){this.matrixRefreshes=(this.matrixRefreshes||0)+1}
}
const drawCalls=[]; // Measures full sprite draws into the four-sided transparent net atlas.
const makeCanvas=()=>({width:0,height:0,getContext:()=>({
  clearRect(){},save(){},restore(){},translate(){},rotate(){},
  drawImage(...args){drawCalls.push(args)},
})});
const THREE={
  Vector3,Matrix4,Mesh,MeshBasicMaterial:Material,
  PlaneGeometry:class{constructor(w,h){this.parameters={width:w,height:h}}dispose(){}},
  TextureLoader:class{load(url,ready){const texture={image:{width:imageW,height:imageH}};Promise.resolve().then(()=>ready(texture));return texture}},
  CanvasTexture:class{constructor(canvas){this.image=canvas}},
  BufferGeometry:Geometry,Float32BufferAttribute:Attribute,BufferAttribute:Attribute,
  ClampToEdgeWrapping:1001,RepeatWrapping:1002,sRGBEncoding:3001,DoubleSide:2,
};
const FakeImage=class {
  get naturalWidth(){return imageW}
  get naturalHeight(){return imageH}
  set src(value){this.url=value;this.onload?.()}
};
const context=vm.createContext({window:{THREE},THREE,document:{createElement:makeCanvas},Image:FakeImage,console});
vm.runInContext(read('docs/js/dungeon-rope-art.js'),context);
vm.runInContext(read('docs/js/furniture-surface-png-runtime.js'),context);
(async()=>{
  await Promise.resolve();
  const art=context.window.DungeonRopeArt;
  const plane=art.createRopePlane(),anchor={x:0,y:3,z:0},bob={x:0,y:1,z:0};
  art.updateRopePlane(plane,anchor,bob,null);
  assert(Math.abs(plane.geometry.parameters.width-imageW/imageH)<1e-8);
  assert.equal(plane.material.transparent,true);
  assert.equal(plane.scale.y,2);
  const cameraA={getWorldPosition(out){return out.set(0,2,5)}};
  const cameraB={getWorldPosition(out){return out.set(5,2,0)}};
  plane.onBeforeRender(null,null,cameraA);
  const a=plane.orientations.at(-1);
  plane.onBeforeRender(null,null,cameraB);
  assert.notDeepEqual(plane.orientations.at(-1),a,'rope stays camera-facing even when no simulation tick occurs');
  assert.equal(plane.matrixRefreshes,2,'renderer matrix refreshed after billboard turn');
  const net=art.createNetFrustum();
  assert.equal(net.geometry.getAttribute('position').count,24,'four faces, two triangles each');
  assert.equal(net.geometry.getAttribute('uv').count,24);
  assert.equal(net.material.map.wrapS,THREE.ClampToEdgeWrapping);
  assert.equal(net.material.map.wrapT,THREE.ClampToEdgeWrapping);
  assert.equal(drawCalls.length,8,'five lengthwise and three cross-rope sprite draws');

  const original = new Geometry();
  original.setAttribute('position',new Attribute(new Float32Array([0,0,0,1,0,0,1,1,0, 0,0,0,1,1,0,0,1,0]),3));
  original.setAttribute('uv',new Attribute(new Float32Array(12),2));
  const settings={version:2,source:'../../assets/objectsprites/rope_long.png',tileSize:.5,mapping:'tile-x',paddingX:.10,paddingY:.45,opacity:1,transparent:true};
  const data={recognizedSurfaces:[{id:'s',partId:'box-a',faceIndices:[0,1],basisU:[1,0,0],basisV:[0,1,0],bounds:{minU:0,maxU:1,minV:0,maxV:1}}],surfaceSettings:{s:{texture:settings}}};
  const runtime=context.window.FurnitureSurfacePngRuntime;
  const createMesh=()=>new Mesh(original,new Material());
  const first=createMesh();
  assert.equal(runtime.applyToPart(first,data,{id:'box-a',kind:'box'}),true);
  const second=createMesh();
  assert.equal(runtime.applyToPart(second,data,{id:'box-a',kind:'box'}),true);
  assert.equal(runtime.applyToPart(createMesh(),data,{id:'box-a',kind:'sphere'}),false,'nonmatching editor/runtime sphere topology is rejected');
  await Promise.resolve();await Promise.resolve();await Promise.resolve();await Promise.resolve();await new Promise(resolve=>setImmediate(resolve));
  const tex=first.material[1].map;
  assert(tex,'asynchronous PNG actually gets applied');
  assert.equal(second.material[1].map,tex,'identical furniture instances share one GPU texture');
  assert(tex.image.width<=4096&&tex.image.height<=4096,'45% padding cannot overflow mobile GPU texture size');
  assert.equal(tex.wrapS,THREE.RepeatWrapping);
  assert.equal(tex.wrapT,THREE.ClampToEdgeWrapping,'Y-only direction remains untiled');
  assert.equal(first.material[1].depthWrite,true,'opaque rope cutouts preserve correct depth ordering');
  assert(first.material[1].alphaTest>0,'fully transparent pixels do not occlude furniture');
  assert.equal(runtime.debugSnapshot().cachedTextures,1);
  assert.equal(runtime.debugSnapshot().failed,0);
  console.log('Dungeon rope PNG runtime geometry, camera, atlas, alpha, padding and shared texture tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
