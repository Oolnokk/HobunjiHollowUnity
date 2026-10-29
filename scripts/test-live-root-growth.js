// Executable unit tests for the independent LiveRootGrowth controller.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Vector3 {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  clone(){return new Vector3(this.x,this.y,this.z);}
  copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;}
  add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this;}
  sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this;}
  multiplyScalar(k){this.x*=k;this.y*=k;this.z*=k;return this;}
  lerp(v,t){this.x+=(v.x-this.x)*t;this.y+=(v.y-this.y)*t;this.z+=(v.z-this.z)*t;return this;}
  distanceToSquared(v){return (v.x-this.x)**2+(v.y-this.y)**2+(v.z-this.z)**2;}
  distanceTo(v){return Math.sqrt(this.distanceToSquared(v));}
  toArray(){return [this.x,this.y,this.z];}
  fromBufferAttribute(attr,i){this.x=attr.getX(i);this.y=attr.getY(i);this.z=attr.getZ(i);return this;}
}
class Group {
  constructor(){this.isObject3D=true;this.children=[];this.userData={};this.position=new Vector3();this.rotation={x:0,y:0,z:0};this.visible=true;}
  add(...children){children.forEach(child=>{child.parent=this;this.children.push(child);});}
  remove(child){this.children=this.children.filter(item=>item!==child);child.parent=null;}
  traverse(fn){fn(this);this.children.forEach(child=>child.traverse(fn));}
  updateWorldMatrix(){}
  localToWorld(v){let node=this;while(node){v.add(node.position);node=node.parent;}return v;}
  worldToLocal(v){let node=this;while(node){v.sub(node.position);node=node.parent;}return v;}
  clone(recursive){
    const result=new this.constructor();
    result.position.copy(this.position);result.rotation={...this.rotation};result.visible=this.visible;
    result.userData={...this.userData};
    if(recursive)this.children.forEach(child=>result.add(child.clone(true)));
    return result;
  }
}
class Attribute {
  constructor(points){this.points=points;this.count=points.length;}
  getX(i){return this.points[i].x;}getY(i){return this.points[i].y;}getZ(i){return this.points[i].z;}
  setXYZ(i,x,y,z){this.points[i].x=x;this.points[i].y=y;this.points[i].z=z;}
}
class Geometry {
  constructor(points){this.attribute=new Attribute(points||[new Vector3(),new Vector3(1,0,0),new Vector3(0,0,1)]);this.index={count:Math.max(3,this.attribute.count*3)};this.drawRange={start:0,count:Infinity};}
  getAttribute(name){return name==='position'?this.attribute:null;}
  setDrawRange(start,count){this.drawRange={start,count};}
  computeVertexNormals(){}
  dispose(){this.disposed=true;}
}
class PlaneGeometry extends Geometry {}
class TubeGeometry extends Geometry {
  constructor(curve,segments,radius,radial){
    const points=[];
    for(let ring=0;ring<=segments;ring++){
      const p=curve.getPointAt(ring/segments);
      for(let spoke=0;spoke<=radial;spoke++)points.push(p.clone().add(new Vector3(Math.cos(spoke)*radius,0,Math.sin(spoke)*radius)));
    }
    super(points);this.parameters={path:curve};this.index={count:segments*radial*6};
  }
}
class Material {
  constructor(){this.visible=true;}
  clone(){return new Material();}
  dispose(){this.disposed=true;}
}
class Mesh extends Group {
  constructor(geometry=new Geometry(),material=new Material()){
    super();this.isMesh=true;this.geometry=geometry;this.material=material;
  }
  clone(){const c=new Mesh(this.geometry,this.material);c.name=this.name;c.position.copy(this.position);c.visible=this.visible;c.userData={...this.userData};return c;}
}
class Curve {
  constructor(points){this.points=points;}
  getPointAt(t){
    const x=t*(this.points.length-1),i=Math.min(this.points.length-2,Math.floor(x));
    return this.points[i].clone().lerp(this.points[i+1],x-i);
  }
}
const three={Group,Mesh,Vector3,PlaneGeometry,TubeGeometry,MeshBasicMaterial:Material,CatmullRomCurve3:Curve};
function fakeGrowth(parent,recipe){
  const output=new Group();
  const points=recipe.target==='floors'
    ? Array.from({length:40},(_,i)=>new Vector3((i%10-5)*.2,.045,Math.floor(i/10)*.3))
    : Array.from({length:12},(_,i)=>new Vector3(i%3-.8,.6+Math.floor(i/3)*.2,Math.floor(i/3)-1));
  output.add(new Mesh(new Geometry(points),new Material()));
  output.userData.generatedStrands=13;
  output.userData.surfaceGrowthEndpoints=recipe.target==='floors'?[]:[{start:[-.8,.5,-.8],end:[.8,.8,.8]}];
  output.userData.diagnostics='13 wrap strands';
  return output;
}
const calls=[];
const foliage={
  buildSurfaceGrowth(parent,recipe){calls.push({parent,recipe});return fakeGrowth(parent,recipe);},
  normalizeSurfaceGrowth(v){return v;},
  surfaceGrowthDefaults(){return {color:'#424242',texture:'assets/textures/wibbly_surface.png'};}
};
const windowMock={THREE:three,FoliageGenerator:foliage};
vm.runInNewContext(fs.readFileSync('docs/js/live-root-growth.js','utf8'),{window:windowMock,console});
const feature=windowMock.LiveRootGrowth;
assert.equal(feature.version,1);
const normalized=feature.normalizeRecipe({branchCount:Infinity,floorWidth:-2,targetDensity:5,duration:'NaN'});
assert.equal(normalized.branchCount,9);assert.equal(normalized.floorWidth,1);
assert.equal(normalized.targetDensity,1);assert.equal(normalized.duration,3.5);
const input=new Group();input.add(new Mesh(new Geometry(),new Material())); // Caller must retain its original visible source.
const options={target:input,recipe:{seed:'fixed',branchCount:4,duration:2},THREE:three,foliage};
const first=feature.create(options);
assert.equal(first.branches.length,4);
assert.equal(first.group.children.length,3);
assert.equal(input.children[0].visible,true,'hidden geometry must be cloned');
assert.equal(first.target.children[0].visible,false,'the imported furniture must be hidden');
assert.equal(first.getProgress(),0);
assert.equal(first.getDiagnostics().floorNodesFromWrap,true);
assert.equal(first.getDiagnostics().shapeWrapEndpointPairs,1);
assert.deepEqual(calls.map(x=>x.recipe.style),['wrap','wrap']);
assert.deepEqual(calls.map(x=>x.recipe.kind),['roots','roots']);
assert.equal(first.branches[0].geometry.drawRange.count,0);
const second=feature.create(options);
assert.deepEqual(first.branches.map(x=>x.geometry.parameters?.path?.points?.[0]?.toArray()||x.position.toArray()),
  second.branches.map(x=>x.geometry.parameters?.path?.points?.[0]?.toArray()||x.position.toArray()));
first.extend();
first.update(.25);assert(first.getProgress()>0);
first.setProgress(1);
assert.equal(first.getProgress(),1);
assert(first.branches.every(x=>x.geometry.drawRange.count===x.userData.fullDrawCount));
first.retract();
for(let i=0;i<16;i++)first.update(.25);
assert.equal(first.getProgress(),0);
assert(first.branches.every(x=>x.geometry.drawRange.count===0));
const scene=new Group();scene.add(first.group); // Disposal must detach from a real scene parent.
const owned=first.branches[0].geometry;first.dispose();first.dispose();
assert.equal(owned.disposed,true);
assert.equal(first.group.parent,null);
assert.throws(()=>feature.create({target:null,THREE:three,foliage}),/furniture group/);
assert.match(fs.readFileSync('docs/tools/index.html','utf8'),/live-root-growth\/index\.html/);
assert.match(fs.readFileSync('docs/tools/live-root-growth/index.html','utf8'),/js\/live-root-growth\.js\?v=[A-Za-z0-9_-]+/);
console.log('Live root growth: wrap reuse, source preservation, deterministic nodes, controls, retraction, disposal and Tools Hub wiring passed.');
