'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const terrain=require('../docs/js/terrain-preview.js'); // Exercise the real rock-mound field with a small CPU-only geometry adapter.
class Vector3{
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  clone(){return new Vector3(this.x,this.y,this.z);}
  fromBufferAttribute(a,i){this.x=a.getX(i);this.y=a.getY(i);this.z=a.getZ(i);return this;}
  subVectors(a,b){this.x=a.x-b.x;this.y=a.y-b.y;this.z=a.z-b.z;return this;}
  crossVectors(a,b){this.x=a.y*b.z-a.z*b.y;this.y=a.z*b.x-a.x*b.z;this.z=a.x*b.y-a.y*b.x;return this;}
  normalize(){const length=Math.hypot(this.x,this.y,this.z)||1;this.x/=length;this.y/=length;this.z/=length;return this;}
}
class Bounds{
  constructor(min,max){this.min=min;this.max=max;}
  clone(){return new Bounds(this.min.clone(),this.max.clone());}
  getSize(out){out.x=this.max.x-this.min.x;out.y=this.max.y-this.min.y;out.z=this.max.z-this.min.z;return out;}
  getCenter(out){out.x=(this.max.x+this.min.x)/2;out.y=(this.max.y+this.min.y)/2;out.z=(this.max.z+this.min.z)/2;return out;}
}
class Attribute{
  constructor(values,size){this.array=new Float32Array(values);this.itemSize=size;this.count=this.array.length/size;}
  getX(i){return this.array[i*this.itemSize];}getY(i){return this.array[i*this.itemSize+1];}getZ(i){return this.array[i*this.itemSize+2];}
  setXYZ(i,x,y,z){this.array.set([x,y,z],i*this.itemSize);}
}
class Geometry{
  constructor(){this.attributes={};this.index=null;}
  setAttribute(key,value){this.attributes[key]=value;return this;}getAttribute(key){return this.attributes[key];}
  clone(){const copy=new Geometry();for(const [key,value] of Object.entries(this.attributes))copy.setAttribute(key,new Attribute(value.array,value.itemSize));return copy;}
  computeBoundingBox(){const p=this.getAttribute('position'),min=new Vector3(Infinity,Infinity,Infinity),max=new Vector3(-Infinity,-Infinity,-Infinity);for(let i=0;i<p.count;i++){min.x=Math.min(min.x,p.getX(i));min.y=Math.min(min.y,p.getY(i));min.z=Math.min(min.z,p.getZ(i));max.x=Math.max(max.x,p.getX(i));max.y=Math.max(max.y,p.getY(i));max.z=Math.max(max.z,p.getZ(i));}this.boundingBox=new Bounds(min,max);}
  computeVertexNormals(){}computeBoundingSphere(){}dispose(){this.disposed=true;}
}
const windowMock={THREE:{Vector3,BufferGeometry:Geometry,BufferAttribute:Attribute,Float32BufferAttribute:Attribute,TextureLoader:class{}},TerrainPreview:terrain}; // Rendering/materials are outside this geometry regression.
vm.runInNewContext(fs.readFileSync('docs/js/procedural-furniture.js','utf8'),{window:windowMock,THREE:windowMock.THREE,console});
const api=windowMock.ProceduralFurniture;
const corners=[[-1.5,-.5,-1],[1.5,-.5,-1],[1.5,-.5,1],[-1.5,-.5,1],[-1.5,.5,-1],[1.5,.5,-1],[1.5,.5,1],[-1.5,.5,1]];
const indices=[0,1,2,0,2,3,4,6,5,4,7,6,0,5,1,0,4,5,1,6,2,1,5,6,2,7,3,2,6,7,3,4,0,3,7,4];
const source=new Geometry().setAttribute('position',new Attribute(indices.flatMap(index=>corners[index]),3));
const settings={seed:'preserved-rock-joints',roughness:1}; // Maximum roughness must still leave a contact interface exact.
const baseline=api.createRockGeometry(source,{...settings,roughness:0}).getAttribute('position');
const free=api.createRockGeometry(source,settings).getAttribute('position');
const face={source:'body',normal:[0,1,0],offset:-.5,min:[-.5,-.5,-.5],max:[.5,-.5,.5]};
const pinned=api.createRockGeometry(source,{...settings,contactFaces:[face]}).getAttribute('position');
const same=(a,b,i)=>Math.abs(a.getX(i)-b.getX(i))+Math.abs(a.getY(i)-b.getY(i))+Math.abs(a.getZ(i)-b.getZ(i))<1e-7;
let contactVertices=0,roughVertices=0;
for(let i=0;i<baseline.count;i++)if(Math.abs(baseline.getY(i)+.5)<1e-7){contactVertices++;assert(same(pinned,baseline,i),'contact faces must not be cut back after final bounds fitting');}else if(!same(pinned,baseline,i))roughVertices++;
assert(contactVertices>0&&roughVertices>0,'pinning a joint must preserve rough exposed surfaces');
const pointKey=(a,i)=>[a.getX(i),a.getY(i),a.getZ(i)].join(',');
const shared=new Map(); // Shared corners/edges must remain coincident across separate triangle faces.
for(let i=0;i<baseline.count;i++){const key=pointKey(baseline,i),value=pointKey(pinned,i);if(shared.has(key))assert.equal(value,shared.get(key));shared.set(key,value);}
const tiny={...face,min:[.11,-.5,.33],max:[.13,-.5,.35]};
const small=api.createRockGeometry(source,{...settings,contactFaces:[tiny]}).getAttribute('position');
let coveringTriangles=0;
for(let first=0;first<baseline.count;first+=3){
  if(![0,1,2].every(offset=>Math.abs(baseline.getY(first+offset)+.5)<1e-7))continue;
  const points=[0,1,2].map(offset=>[baseline.getX(first+offset)/3,baseline.getZ(first+offset)/2]);
  const [a,b,c]=points,den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
  const u=((b[1]-c[1])*(.12-c[0])+(c[0]-b[0])*(.34-c[1]))/den,v=((c[1]-a[1])*(.12-c[0])+(a[0]-c[0])*(.34-c[1]))/den;
  if(u>=0&&v>=0&&u+v<=1){coveringTriangles++;for(let offset=0;offset<3;offset++)assert(same(small,baseline,first+offset),'a tiny support between vertices must hold its entire supporting triangle');}
}
assert(coveringTriangles>0);
const other=api.createRockGeometry(source,{...settings,contactFaces:[{...face,source:'other-mesh'}]}).getAttribute('position');
assert.deepEqual(Array.from(other.array),Array.from(free.array),'GLB source masks must not leak onto unrelated child meshes');
assert.equal(source.disposed,undefined,'contact preservation never disposes caller-owned source geometry');
console.log('Rock contact geometry: exact interfaces, small support patches, watertight shared edges, rough exposed surfaces and mesh-scoped masks passed.');
