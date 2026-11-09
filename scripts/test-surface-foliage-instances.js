'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
class Matrix4 {
  constructor(elements) { this.elements=elements ? [...elements] : [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]; }
  clone(){return new Matrix4(this.elements);}
  copy(matrix){this.elements=[...matrix.elements];return this;}
  multiply(other){return this.multiplyMatrices(this,other);}
  multiplyMatrices(left,right){
    const a=left.elements,b=right.elements,out=new Array(16).fill(0); // Column-major affine composition matches production THREE.Matrix4.
    for(let col=0;col<4;col++)for(let row=0;row<4;row++)for(let k=0;k<4;k++)out[col*4+row]+=a[k*4+row]*b[col*4+k];
    this.elements=out;return this;
  }
  invert(){
    const source=[...this.elements]; // Test parents use only translation and diagonal scaling; instances separately exercise rotation.
    this.elements=[1/source[0],0,0,0,0,1/source[5],0,0,0,0,1/source[10],0,-source[12]/source[0],-source[13]/source[5],-source[14]/source[10],1];return this;
  }
}
class Vector3 {
  constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}
  fromBufferAttribute(attribute,index){return Object.assign(this,{x:attribute.array[index*3],y:attribute.array[index*3+1],z:attribute.array[index*3+2]});}
  applyMatrix4(matrix){const e=matrix.elements,x=this.x,y=this.y,z=this.z;this.x=e[0]*x+e[4]*y+e[8]*z+e[12];this.y=e[1]*x+e[5]*y+e[9]*z+e[13];this.z=e[2]*x+e[6]*y+e[10]*z+e[14];return this;}
}
const sampled=[]; // Capture production sampler coordinates before degenerate test triangles bypass the unrelated tube-building path.
class Triangle {
  constructor(...vertices){sampled.push(vertices.map(v=>[v.x,v.y,v.z]));}
  getArea(){return 0;}
}
class Group {
  constructor(){this.children=[];this.userData={};this.matrixWorld=new Matrix4();}
  add(child){this.children.push(child);child.parent=this;return this;}
  traverse(visit){visit(this);for(const child of this.children)child.traverse(visit);}
  updateWorldMatrix(){}
}
const windowForTest={THREE:{Matrix4,Vector3,Triangle,Group}}; // No external packages are needed to execute instance transform enumeration in CI.
vm.runInNewContext(fs.readFileSync('docs/js/foliage-generator.js','utf8'),{window:windowForTest});
const parent=new Group(),mesh=new Group(); // Source geometry is shared by two translated/rotated/scaled copies away from the origin.
parent.matrixWorld=new Matrix4([2,0,0,0,0,3,0,0,0,0,4,0,100,200,300,1]);
const local=new Matrix4([1,0,0,0,0,1,0,0,0,0,1,0,10,20,30,1]);
mesh.matrixWorld=parent.matrixWorld.clone().multiply(local);mesh.isMesh=true;mesh.isInstancedMesh=true;mesh.count=2;mesh.instanceMatrix={count:3};mesh.userData.surfaceFoliageRole='walls';
mesh.geometry={attributes:{position:{array:[0,0,0,1,0,0,0,1,0],count:3}},index:null,drawRange:{start:0,count:Infinity}};
const instances=[new Matrix4([1,0,0,0,0,1,0,0,0,0,1,0,40,0,0,1]),new Matrix4([0,2,0,0,-3,0,0,0,0,0,1,0,0,50,0,1]),new Matrix4()];
const calls=[]; // Unused instance capacity must not grow ghost copies at the origin.
mesh.getMatrixAt=(index,out)=>{calls.push(index);out.copy(instances[index]);};parent.add(mesh);
const before=instances.map(matrix=>[...matrix.elements]);
windowForTest.FoliageGenerator.buildSurfaceGrowth(parent,{target:'walls'});
assert.deepEqual(calls,[0,1]);
assert.deepEqual(sampled.map(triangle=>triangle.map(vertex=>vertex.map(value=>Number(value.toFixed(9))))),[[[50,20,30],[51,20,30],[50,21,30]],[[10,70,30],[10,72,30],[7,70,30]]]);
assert.deepEqual(instances.map(matrix=>matrix.elements),before,'Sampling must not mutate the shared placement matrices');
sampled.length=0;calls.length=0;mesh.count=0;windowForTest.FoliageGenerator.buildSurfaceGrowth(parent,{target:'walls'});assert.equal(sampled.length,0);assert.equal(calls.length,0);
mesh.isInstancedMesh=false;windowForTest.FoliageGenerator.buildSurfaceGrowth(parent,{target:'walls'});assert.deepEqual(sampled.map(triangle=>triangle.map(vertex=>vertex.map(value=>Number(value.toFixed(9))))),[[[10,20,30],[11,20,30],[10,21,30]]]);
sampled.length=0;mesh.isInstancedMesh=true;mesh.count=1;mesh.geometry.index={count:6,getX:index=>[0,1,2,2,1,0][index]};mesh.geometry.drawRange={start:3,count:3};windowForTest.FoliageGenerator.buildSurfaceGrowth(parent,{target:'walls'});assert.deepEqual(sampled.map(triangle=>triangle.map(vertex=>vertex.map(value=>Number(value.toFixed(9))))),[[[50,21,30],[51,20,30],[50,20,30]]]);
console.log('Surface foliage instance placements, rotation/scale, parent transforms, zero instances, unused capacity and indexed draw ranges passed.');
