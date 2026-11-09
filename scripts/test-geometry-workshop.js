'use strict';
// Behavioural regression for the material-preserving geometry workshop.
// Uses a small Three.js-compatible stub so the suite stays fast in Node.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
class Vector3 {
  constructor(x=0,y=0,z=0) { this.set(x,y,z); }
  set(x,y,z) { this.x=x; this.y=y; this.z=z; return this; }
}
class BufferAttribute {
  constructor(array, itemSize, normalized=false) {
    this.array=array; this.itemSize=itemSize; this.normalized=normalized; this.count=array.length/itemSize;
  }
  getX(i) { return this.array[i*this.itemSize]; }
  getY(i) { return this.array[i*this.itemSize+1]; }
  getZ(i) { return this.array[i*this.itemSize+2]; }
}
class BufferGeometry {
  constructor() { this.isBufferGeometry=true; this.attributes={}; this.morphAttributes={}; this.groups=[]; this.drawRange={start:0,count:Infinity}; this.index=null; }
  setAttribute(name,attr) { this.attributes[name]=attr; return this; }
  getAttribute(name) { return this.attributes[name]; }
  setIndex(indices) {
    this.index=indices?.isBufferAttribute ? indices : new BufferAttribute(new Uint16Array(indices),1);
    return this;
  }
  clearGroups() { this.groups=[]; }
  addGroup(start,count,materialIndex=0) { this.groups.push({start,count,materialIndex}); }
  setDrawRange(start,count) { this.drawRange={start,count}; }
  clone() {
    const g=new BufferGeometry();
    g.attributes={...this.attributes}; g.morphAttributes={...this.morphAttributes};
    g.groups=this.groups.map(x=>({...x})); g.drawRange={...this.drawRange}; g.index=this.index;
    return g;
  }
  computeBoundingBox() {
    const attr=this.getAttribute('position'), lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(let v=0;v<attr.count;v++) for(let j=0;j<3;j++){let n=attr.array[v*3+j];lo[j]=Math.min(lo[j],n);hi[j]=Math.max(hi[j],n);}
    this.boundingBox={getSize(out){return out.set(hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2]);}};
  }
  computeBoundingSphere() {}
  dispose() {}
}
class Mesh {
  constructor(geometry,material) { this.isMesh=true;this.geometry=geometry;this.material=material;this.name='two-material-shape';this.userData={}; }
  traverse(cb){cb(this);}
  clone(){const copy=new Mesh(this.geometry,this.material);copy.name=this.name;copy.userData={...this.userData};return copy;}
}
let calls=[];
const optimizer={
  supported:true,ready:Promise.resolve(),
  simplify(indices, positions, stride, target, error, flags) {
    assert.equal(stride,3); assert.ok(flags.includes('LockBorder'),'must lock material/border edges');
    calls.push({target,error,count:indices.length});
    return [indices.subarray(0, Math.max(3,Math.min(indices.length,target))),0.01];
  }
};
const window={THREE:{BufferGeometry,BufferAttribute,Vector3},MeshoptSimplifier:optimizer};
const context={window,module:{exports:{}},console,Set,Map,Array,Math,Number,Int16Array,Int32Array,Uint8Array,Uint16Array,Uint32Array,Float32Array};
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../docs/tools/geometry-workshop/core.js'),'utf8'),context);
const core=window.GeometryWorkshopCore;
function twoMaterialMesh(){
  const g=new BufferGeometry();
  g.setAttribute('position',new BufferAttribute(new Float32Array([0,0,0,2,0,0,2,2,0,0,2,0]),3));
  g.setAttribute('normal',new BufferAttribute(new Float32Array([0,0,1,0,0,1,0,0,1,0,0,1]),3));
  g.setAttribute('uv',new BufferAttribute(new Float32Array([0,0,1,0,1,1,0,1]),2));
  g.setIndex([0,1,2,0,2,3]);g.addGroup(0,3,0);g.addGroup(3,3,1);
  return new Mesh(g,[{name:'skin'},{name:'claw'}]);
}
(async()=>{
  let source=twoMaterialMesh(), oldIndices=Array.from(source.geometry.index.array);
  let output=await core.process(source,{remesh:true,edgePercent:15,reduction:0,protectCards:false});
  assert.equal(core.triangles(source.geometry),2,'the input is never changed');
  assert.deepEqual(Array.from(source.geometry.index.array),oldIndices,'source index buffer untouched');
  assert.ok(core.triangles(output.object.geometry)>2,'adaptive remesh must actually split edges');
  assert.ok(output.object.geometry.groups.length===2,'one source material group remains one group');
  assert.ok(output.object.geometry.groups.every(g=>g.count>3),'remeshed triangles keep their own material');
  assert.ok(core.preservedMaterials(source,output.object),'material identity and assignments preserved');
  assert.equal(output.object.geometry.getAttribute('uv').count,output.object.geometry.getAttribute('position').count,'UVs follow remeshed vertices');
  calls=[];
  const reduced=await core.process(output.object,{reduction:55,remesh:false,protectCards:false});
  assert.equal(calls.length,2,'each material region is simplified independently');
  assert.ok(core.preservedMaterials(output.object,reduced.object));
  assert.equal(source.geometry.groups[0].count,3,'source groups unchanged');
  const protectedSource=twoMaterialMesh();
  protectedSource.userData.noOutline=true;
  const protectedOutput=await core.process(protectedSource,{remesh:true,reduction:80});
  assert.equal(protectedOutput.object.geometry,protectedSource.geometry,'protected geometry shares unmodified original');
  const malformed=twoMaterialMesh();
  malformed.geometry.groups[1].start=0; // Overlapping groups should never be flattened or silently reassigned.
  const invalid=await core.process(malformed,{reduction:50,protectCards:false});
  assert.ok(invalid.warnings.some(x=>x.includes('Overlapping material groups')));
  assert.equal(invalid.object.geometry,malformed.geometry);
  const html=fs.readFileSync(path.resolve(__dirname,'../docs/tools/index.html'),'utf8');
  assert.match(html,/fw-geometry-workshop/,'workshop must be reachable from the Dev Tools hub');
  const shell=fs.readFileSync(path.resolve(__dirname,'../docs/tools/geometry-workshop/index.html'),'utf8');
  for(const id of ['source-kind','repo-path','generator','file','remesh','reduction','export','log'])assert.ok(shell.includes('id="'+id+'"'));
  console.log('Geometry Workshop: material boundaries, UVs, remesh, optimizer, preservation and hub wiring OK');
})().catch(err=>{console.error(err);process.exitCode=1;});
