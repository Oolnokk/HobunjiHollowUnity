#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Regression expectations for rigid ends and attached central surfaces.
const fs = require('node:fs'); // Reads the real browser module and editor wiring.
const vm = require('node:vm'); // Evaluates the browser module without a DOM or GPU.

class Vector3 {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  clone(){return new Vector3(this.x,this.y,this.z);}
  copy(p){this.x=p.x;this.y=p.y;this.z=p.z;return this;}
  applyMatrix4(m){
    const e=m.elements,x=this.x,y=this.y,z=this.z;
    this.x=e[0]*x+e[4]*y+e[8]*z+e[12];
    this.y=e[1]*x+e[5]*y+e[9]*z+e[13];
    this.z=e[2]*x+e[6]*y+e[10]*z+e[14];
    return this;
  }
}
class Matrix4 {
  constructor(){this.identity();}
  identity(){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];return this;}
  clone(){const m=new Matrix4();m.elements=this.elements.slice();return m;}
  compose(position,quaternion,scale){
    this.makeScale(scale.x,scale.y,scale.z);
    return this.setPosition(position.x,position.y,position.z);
  }
  makeScale(x,y,z){this.identity();this.elements[0]=x;this.elements[5]=y;this.elements[10]=z;return this;}
  setPosition(x,y,z){this.elements[12]=x;this.elements[13]=y;this.elements[14]=z;return this;}
  invert(){
    const e=this.elements;
    e[12]=-e[12]/e[0];e[13]=-e[13]/e[5];e[14]=-e[14]/e[10];
    e[0]=1/e[0];e[5]=1/e[5];e[10]=1/e[10];
    return this;
  }
  multiply(b){
    const a=this.elements,c=b.elements,out=new Array(16).fill(0);
    for(let col=0;col<4;col++)for(let row=0;row<4;row++)for(let k=0;k<4;k++)
      out[col*4+row]+=a[k*4+row]*c[col*4+k];
    this.elements=out;return this;
  }
}
class Geometry {
  constructor(width,depth=1){
    this.vertices=[];
    for(const x of [-width/2,width/2])for(const y of [0,1])for(const z of [-depth/2,depth/2])
      this.vertices.push(new Vector3(x,y,z));
    this.computeBoundingBox();
  }
  computeBoundingBox(){
    const minimum=new Vector3(Infinity,Infinity,Infinity),maximum=new Vector3(-Infinity,-Infinity,-Infinity);
    for(const v of this.vertices)for(const a of ['x','y','z']){minimum[a]=Math.min(minimum[a],v[a]);maximum[a]=Math.max(maximum[a],v[a]);}
    this.boundingBox={min:minimum,max:maximum};
  }
  clone(){const copy=new Geometry(1);copy.vertices=this.vertices.map(v=>v.clone());copy.computeBoundingBox();return copy;}
  applyMatrix4(matrix){this.vertices.forEach(v=>v.applyMatrix4(matrix));this.computeBoundingBox();return this;}
  dispose(){this.disposed=true;}
}
class Mesh {
  constructor(x=0,z=0,width=1){
    this.position=new Vector3(x,0,z);
    this.quaternion={clone(){return this;},copy(){return this;}};
    this.scale=new Vector3(1,1,1);
    this.matrix=new Matrix4();
    this.geometry=new Geometry(width);
    this.userData={};
  }
  updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);}
}
const window={THREE:{Vector3,Matrix4}};
vm.runInNewContext(fs.readFileSync('docs/js/furniture-tile-span.js','utf8'),{window});
const stretch=window.FurnitureTileSpan;
const near=(actual,expected,label)=>assert.ok(Math.abs(actual-expected)<1e-8,label+': '+actual+' expected '+expected);
const extrema=(geometry,axis)=>[Math.min(...geometry.vertices.map(v=>v[axis])),Math.max(...geometry.vertices.map(v=>v[axis]))];

function bridge(axis='x'){
  const first=new Mesh(axis==='x'?-1.25:0,axis==='z'?-1.25:0,.5);
  const middle=new Mesh(0,0,axis==='x'?2:1);
  if(axis==='z'){middle.geometry=new Geometry(1,2);first.geometry=new Geometry(1,.5);}
  const last=new Mesh(axis==='x'?1.25:0,axis==='z'?1.25:0,.5);
  if(axis==='z')last.geometry=new Geometry(1,.5);
  const parts=[
    {id:'first',tileSpanRole:'start'},
    {id:'deck',kind:'box',tileSpanRole:'stretch',tileSpanRoots:{start:{partId:'first',face:'max'},end:{partId:'last',face:'min'}}},
    {id:'last',tileSpanRole:'end'},
  ];
  const meshes=new Map([['first',first],['deck',middle],['last',last]]);
  const group={userData:{meshById:meshes}};
  const data={parts,tileSpan:{enabled:true,axis,startTiles:2,middleTiles:2,endTiles:2,totalTiles:8,tileSize:1}};
  return {group,data,first,middle,last};
}

for(const axis of ['x','z']){
  const {group,data,first,middle,last}=bridge(axis);
  const originalFirst=first.geometry,originalLast=last.geometry,originalDeck=middle.geometry;
  let result=stretch.apply(group,data);
  assert.equal(result.delta,2);
  near(first.position[axis],-2.25,'start stair translated rigidly');
  near(last.position[axis],2.25,'end stair translated rigidly');
  assert.equal(first.geometry,originalFirst,'start stair geometry and cross-section unchanged');
  assert.equal(last.geometry,originalLast,'end stair geometry and cross-section unchanged');
  const [start,end]=extrema(middle.geometry,axis);
  near(start,-2,'deck starts flush against left landing');
  near(end,2,'deck ends flush against right landing');
  assert.equal(group.userData.tileSpanDiagnostics.errors.length,0);

  result=stretch.apply(group,data,10);
  assert.equal(result.delta,4);
  near(first.position[axis],-3.25,'changing preview does not accumulate movement');
  near(last.position[axis],3.25,'other rigid end tracks middle extension');
  const resized=extrema(middle.geometry,axis);
  near(resized[0],-3,'resized deck left attachment');
  near(resized[1],3,'resized deck right attachment');

  stretch.apply(group,data,6);
  near(first.position[axis],-1.25,'minimum footprint restores start');
  near(last.position[axis],1.25,'minimum footprint restores end');
  assert.equal(middle.geometry,originalDeck,'minimum footprint restores original geometry');
  data.tileSpan.enabled=false;
  stretch.apply(group,data);
  assert.equal(group.userData.tileSpanDiagnostics,undefined,'disabling removes active span diagnostics');
}

{
  const {group,data}=bridge();
  data.parts[1].tileSpanRoots.start.partId='nonexistent';
  const response=stretch.apply(group,data);
  assert.equal(response.errors.length,1,'broken roots are reported instead of creating broken geometry');
}
{
  const {group,data}=bridge();
  data.recognizedSurfaces=[
    {id:'landingStart',partId:'first',localCentroid:[.25,0,0]},
    {id:'landingEnd',partId:'last',localCentroid:[-.25,0,0]}
  ];
  data.parts[1].tileSpanRoots.start.surfaceId='landingStart';
  data.parts[1].tileSpanRoots.end.surfaceId='landingEnd';
  assert.equal(stretch.apply(group,data).errors.length,0,'explicit named surface roots resolve');
}
const html=fs.readFileSync('docs/tools/furniture-avatar-author/index.html','utf8');
const author=fs.readFileSync('docs/tools/furniture-avatar-author/tile-span-author.js','utf8');
const runtime=fs.readFileSync('docs/js/authored-furniture-runtime.js','utf8');
const index=fs.readFileSync('docs/index.html','utf8');
assert.match(html,/tileSpan:cloneJson\(state\.tileSpan/,'project export preserves tile-span settings');
assert.match(html,/state\.tileSpan=cloneJson\(data\.tileSpan/,'project import restores tile-span settings');
assert.match(html,/tileSpanRoots\[end\]\.partId=idMap\.get/,'database imports remap piece attachment IDs');
assert.match(author,/Stair Bridge \(Stretchable\)/,'preset bridge is present in the author');
assert.match(author,/tileSpanRole:'stretch'/,'bridge has flexible center geometry');
assert.match(author,/tileSpanRole:role/,'bridge has fixed stair ends');
assert.match(runtime,/setTileSpan\(group\)/,'runtime invokes span deformation');
assert.match(runtime,/record\.tileSpanTiles/,'placed instances can specify the saved span length');
assert.ok(index.indexOf('js/furniture-tile-span.js')<index.indexOf('js/authored-furniture-runtime.js'),'game loads stretch solver before authored furniture');
console.log('Furniture tile-span tests passed: rigid stair ends, two-axis surface-rooted deck, preview resizing, restore, broken roots and integration.');
