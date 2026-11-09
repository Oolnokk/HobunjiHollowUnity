// Checks the actual bone-baked Hachutu player tear module without a browser.
// node scripts/test-hachutu-root-tear.js
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
class Vec {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  copy(v){return this.set(v.x,v.y,v.z);}
  clone(){return new Vec(this.x,this.y,this.z);}
  fromBufferAttribute(a,i){return this.set(a.getX(i),a.getY(i),a.getZ(i));}
  applyMatrix4(m){return this;} // Mesh fixtures have identity world matrices.
  add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this;}
  addScaledVector(v,k){this.x+=v.x*k;this.y+=v.y*k;this.z+=v.z*k;return this;}
  sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this;}
  lerp(v,t){this.x+=(v.x-this.x)*t;this.y+=(v.y-this.y)*t;this.z+=(v.z-this.z)*t;return this;}
  multiplyScalar(t){this.x*=t;this.y*=t;this.z*=t;return this;}
  lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z;}
  normalize(){const d=Math.sqrt(this.lengthSq())||1;return this.multiplyScalar(1/d);}
}
class Attr {
  constructor(array,size){this.array=array;this.itemSize=size;this.count=array.length/size;}
  getX(i){return this.array[i*this.itemSize];}
  getY(i){return this.array[i*this.itemSize+1];}
  getZ(i){return this.array[i*this.itemSize+2];}
}
class Geo {
  constructor(pos,uv){this.attributes={};if(pos)this.setAttribute('position',new Attr(pos,3));if(uv)this.setAttribute('uv',new Attr(uv,2));this.groups=[];this.index=null;}
  getAttribute(k){return this.attributes[k];}
  setAttribute(k,v){this.attributes[k]=v;}
  computeVertexNormals(){}
  dispose(){this.disposed=true;}
}
class Group {
  constructor(){this.isObject3D=true;this.children=[];this.position=new Vec();this.scale={set(){},setScalar(){}};this.rotation={z:0};this.visible=true;this.userData={};
    this.quaternion={setFromUnitVectors(a,b){this.rotation=b.clone();return this;}};}
  add(o){this.children.push(o);o.parent=this;}
  remove(o){this.children=this.children.filter(c=>c!==o);o.parent=null;}
  traverse(cb){cb(this);for(const c of this.children)c.traverse(cb);}
  updateWorldMatrix(){}
  localToWorld(p){return p.add(this.position);}
}
class Mesh extends Group {
  constructor(geometry,material){super();this.isMesh=true;this.geometry=geometry;this.material=material;}
}
const T={Vector3:Vec,Group,Mesh,BufferGeometry:Geo,Float32BufferAttribute:Attr,DoubleSide:2,
  SphereGeometry:class{dispose(){}},MeshBasicMaterial:class{constructor(options){Object.assign(this,options);}dispose(){}}
};
const ctx={window:{THREE:T,__HACHUTU_ROOT_TEAR_TEST__:true},console};
function load(path){vm.runInNewContext(fs.readFileSync(path,'utf8'),ctx,{filename:path});}
load('docs/js/root-snare-runner.js');
load('docs/js/root-snare-player-tear.js');
const api=ctx.window.RootSnarePlayerTear;
assert(api?.__test?.bakeMeshes);
const scene=new Group(),root=new Group();scene.add(root);
const mat=()=>({visible:true,clone(){return mat();},dispose(){this.disposed=true;}});
const upper=new Mesh(new Geo([
  -.3,.6,0, .3,.6,0, 0,1.4,0,
  -.3,.6,0, .3,.6,0, 0,1.4,0,
],Array(12).fill(0)),mat());
upper.name='full skinned spine and neck';
upper.isSkinnedMesh=true;
upper.skeleton={update(){}};
let bonesApplied=0;
upper.boneTransform=(index,v)=>{v.y+=.45;bonesApplied++;return v;};
const feet=new Mesh(new Geo([
  -.15,-.10,0, .15,-.10,0, 0,.62,0,
  -.15,-.10,0, .15,-.10,0, 0,.62,0,
],Array(12).fill(0)),mat());
feet.name='independent procedural leg GLB';
root.add(upper);root.add(feet);
const baked=api.__test.bakeMeshes(root);
assert.equal(baked.records.length,2,'capture includes both painted spine and separate bone-driven feet');
assert(Math.abs(baked.minY-(-.1))<1e-8,'full height includes actual sole vertices');
assert(Math.abs(baked.maxY-1.85)<1e-8,'skin deformation changes top of head/neck geometry');
assert(bonesApplied>0,'bone transformation applied to source skin');
assert.equal(upper.geometry.getAttribute('position').getY(2),1.4,'source GLB vertices are never mutated');
const polygon=[
  {p:new Vec(0,0,0),u:0,v:0,color:null},
  {p:new Vec(1,1,0),u:1,v:0,color:null},
  {p:new Vec(0,1,1),u:0,v:1,color:null},
];
const clipped=api.__test.crop(polygon,.5,true);
assert(clipped.length>=3&&clipped.every(v=>v.p.y>=.5-1e-8),'world-space triangle clipping preserves top section');
assert(clipped.some(v=>Math.abs(v.p.y-.5)<1e-8),'split seam interpolates an actual skinned edge');
const parent=new Group();
const high=api.__test.section(parent,baked,'upper',.55,.75,new Vec(0,.7,0));
const low=api.__test.section(parent,baked,'lower',.55,.75,new Vec(0,.7,0));
assert(high?.children.length&&low?.children.length,'both skinned upper body and leg fragments render');
let camera=null,deaths=0,tosses=0,disposals=0,stops=0;
ctx.window.PlayerBodyTransformComposer={getPlayerMesh:()=>root};
ctx.window.Combat={deps:{TILE:64}};
ctx.window.CinematicCameraRuntime={
  activeRecord:()=>camera,isActive:()=>!!camera,
  activate:(area,shot)=>camera={area,shot},
  deactivate:()=>{camera=null;stops++;},
};
ctx.window.RootSnareToss={create:options=>{tosses++;assert(options.upperSource.children.length);assert(options.lowerSource.children.length);
  return {update(){},dispose(){disposals++;}};}};
ctx.window.PlayerDowned={dieImmediately(reason){assert.equal(reason,'hachutu-root-hands');deaths++;return true;}};
const player={x:0,y:0,vx:4,vy:3,health:90};
const grip={point:new Vec(1,1.7,0)},foot={point:new Vec(-1,0,0)};
const start=()=>api.begin({player,areaId:'map_i_dev_random_ruin',scene,floorY:-.1,neckAnchor:grip,feetAnchor:foot});
assert.equal(start(),true,'full live character is captured on second grip');
assert.equal(root.visible,false,'the actual skinned player is hidden');
assert.equal(camera.shot.id,'hachutu-root-tear','shared cinematic owner receives dynamic providers');
assert.equal(camera.shot.horizontalCameraCollision,true,'camera preserves game collision boom');
const startTarget=new Vec();api.gripTarget('neck',startTarget);
for(let i=0;i<65;i++)api.update(.05);
assert.equal(deaths,0,'two heartbeat yanks do not kill before the third pull');
const halfway=api.debug();
assert(halfway.active&&halfway.fullHeight>1.9,'player height derives from full skinned bones, not a portrait crop');
const pulledTarget=new Vec();api.gripTarget('neck',pulledTarget);
assert(pulledTarget.y>startTarget.y,'full upper body actually extends toward the root hand');
for(let i=0;i<95;i++)api.update(.05);
assert.equal(deaths,1,'finished separation invokes immediate death exactly once');
assert.equal(tosses,1,'two visual-only halves tumble away');
assert.equal(disposals,1,'throwaway geometry is disposed after death');
assert.equal(root.visible,true,'actual player body is restored for respawn');
assert.equal(camera,null,'owned cinematic shot is released');
assert.equal(api.debug().active,false,'capture has no lingering session');
assert.equal(start(),true);
for(let i=0;i<12;i++)api.update(.05);
api.stop('dodge');
assert.equal(deaths,1,'dodge interruption avoids a scripted death');
assert.equal(root.visible,true,'dodge restores the original model');
assert.equal(camera,null,'dodge restores normal camera');
assert.equal(api.debug().counters.interrupts,1);
assert.equal(start(),true);
const competingCamera={reason:'dialogue'};
camera=competingCamera;
api.update(.05);
assert.equal(camera,competingCamera,'an unrelated dialogue camera is never deactivated by snare cleanup');
assert.equal(api.debug().active,false,'camera owner takeover cancels tear');
assert.equal(root.visible,true,'camera takeover restores real model');
console.log('Hachutu root tear: full skinned height, independent leg geometry, 6s author pulls, tilt/grips, visual toss, instant death, dodge and cinematic cleanup PASS');
