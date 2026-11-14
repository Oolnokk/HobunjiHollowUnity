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
  const surfacePoint=new Vector3(axis==='x'?.5:0,0,axis==='z'?.5:0);
  stretch.mapLocalPoint(middle,surfacePoint);
  near(surfacePoint[axis],1,'named deck surface coordinates follow the stretched mesh');
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
  const restoredPoint=new Vector3(axis==='x'?.5:0,0,axis==='z'?.5:0);
  stretch.mapLocalPoint(middle,restoredPoint);
  near(restoredPoint[axis],.5,'surface mapping resets with the original shape');
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
{
  const {group,data,middle}=bridge();
  data.parts[1].tileSpanRoots.start.surfaceId='missing-named-face';
  const result=stretch.apply(group,data);
  assert.equal(result.errors.length,1,'missing named surface cannot silently fall back to the mesh bounding box');
  assert.ok(result.errors[0].includes('attachment surfaces'));
  assert.equal(middle.userData.tileSpanSource,undefined,'source geometry is not embedded in serializable mesh metadata');
}
{
  const {group,data}=bridge();
  data.parts[0].tileSpanRole='stretch';
  assert.ok(stretch.apply(group,data).errors[0].includes('rigid beginning'),'stretch roots must belong to rigid beginning/end pieces');
}
{
  const spec=stretch.normalize({enabled:true,startTiles:256,endTiles:256,middleTiles:256,totalTiles:9999});
  assert.equal(spec.baseTiles,512,'all authored tile sections fit within maximum footprint');
  assert.equal(spec.totalTiles,512,'total tile count never exceeds supported footprint');
}
{
  const {group,data,middle}=bridge();
  const original=middle.geometry;
  stretch.apply(group,data);
  const stretched=middle.geometry;
  stretch.release(middle);
  assert.equal(original.disposed,true,'disposing a stretched mesh also releases its hidden rest geometry');
  assert.notEqual(stretched.disposed,true,'the ordinary mesh disposer retains ownership of the active geometry');
}
// Execute the real preset author, not only a test-made replica of its bridge geometry.
{
  const inputs=new Map(); // Fake editor controls capture configured tile counts without needing a browser.
  const node=id=>{
    if(!inputs.has(id))inputs.set(id,{
      value:'',checked:false,textContent:'',innerHTML:'',selectedIndex:0,
      classList:{toggle(){}},addEventListener(){},appendChild(){},after(){},querySelector(){return this;}
    });
    return inputs.get(id);
  };
  const document={getElementById:node,querySelector:node,createElement:()=>({
    appendChild(){},after(){},querySelector(){return this;}
  })};
  vm.runInNewContext(fs.readFileSync('docs/tools/furniture-avatar-author/tile-span-author.js','utf8'),{window,document});
  const state={parts:[],tileBase:{tileSize:1,footprintW:2,footprintD:1},tileSpan:{enabled:false}};
  let partNumber=0; // Unique part IDs simulate authoring pushPart and let roots resolve by identity.
  const context={
    state,root:{userData:{}},meshes:new Map(),surfaceGroups:new Map(),selectedPart:()=>null,
    pushPart:(kind,overrides)=>{
      const part={kind,...overrides,id:'preset_part_'+ ++partNumber};
      state.parts.push(part);
      return part;
    },
    beginPreset:(width,depth)=>{
      state.parts=[];
      state.tileSpan={enabled:false};
      state.tileBase.footprintW=width;
      state.tileBase.footprintD=depth;
    },
    setPresetFootprint:(width,depth)=>{
      state.tileBase.footprintW=width;
      state.tileBase.footprintD=depth;
    },
    rebuildAll(){},rebuildTileBase(){},frameFurniture(){},selectObject(){},
    recognizedSurfaceExport:()=>[],ensureSurfaceSetting:()=>({}),queueUndoHistory(){},
    updateLists(){},log(){}
  };
  window.FurnitureTileSpanAuthor.init(context);
  window.FurnitureTileSpanAuthor.stairBridge();
  const steps=state.parts.filter(part=>part.name?.includes('staircase'));
  const moving=state.parts.filter(part=>part.tileSpanRole==='stretch');
  const deck=moving.find(part=>part.name.includes('deck'));
  assert.equal(steps.length,8,'preset has four rigid steps on each end');
  assert.equal(moving.length,3,'only the walkway and two rails stretch');
  assert.equal(state.tileSpan.startTiles,1);
  assert.equal(state.tileSpan.endTiles,1);
  assert.equal(state.tileSpan.middleTiles,2);
  assert.equal(state.tileSpan.totalTiles,8);
  assert.equal(state.tileBase.footprintW,8,'footprint matches preview tile count');
  assert.equal(state.tileBase.footprintD,2,'stairs and deck are two tiles wide');
  const left=state.parts.find(part=>part.id===deck.tileSpanRoots.start.partId);
  const right=state.parts.find(part=>part.id===deck.tileSpanRoots.end.partId);
  near(left.transform.x+left.transform.sx/2,-deck.transform.sx/2,'preset deck joins start landing');
  near(right.transform.x-right.transform.sx/2,deck.transform.sx/2,'preset deck joins end landing');
  near(left.transform.y+left.transform.sy/2,deck.transform.y+deck.transform.sy/2,'stairs end flush with flat walkway');
  near(right.transform.y+right.transform.sy/2,deck.transform.y+deck.transform.sy/2,'opposite stair is level');
  assert.ok(steps.every(part=>part.tileSpanRole==='start'||part.tileSpanRole==='end'),'steps remain rigid');
  for (const side of ['start','end']) {
    const flight=steps.filter(part=>part.tileSpanRole===side);
    const min=Math.min(...flight.map(part=>part.transform.x-part.transform.sx/2));
    const max=Math.max(...flight.map(part=>part.transform.x+part.transform.sx/2));
    near(max-min,1,side+' full four-step stair flight is only one tile long');
    assert.ok(flight.every(part=>Math.abs(part.transform.sz-1.8)<1e-8),'each rigid stair spans two tiles across Z');
    assert.ok(flight.every(part=>Math.abs(part.transform.sx-.25)<1e-8),'all four steps are scaled, not removed');
    near(side==='start'?max:min,side==='start'?-1:1,'rigid stairs remain flush with deck in authored base pose');
  }
  const meshes=new Map(state.parts.map(part=>{
    const mesh=new Mesh(part.transform.x,part.transform.z,part.transform.sx);
    mesh.geometry=new Geometry(part.transform.sx,part.transform.sz);
    mesh.position.y=part.transform.y;
    return [part.id,mesh];
  }));
  const scene={userData:{meshById:meshes}};
  const result=stretch.apply(scene,{parts:state.parts,tileSpan:state.tileSpan},8);
  assert.equal(result.errors.length,0,'actual stair bridge preset has valid roots at eight tiles');
  near(result.delta,4,'four extra middle tiles stretch the eight-tile bridge');
  near(meshes.get(left.id).position.x+left.transform.sx/2,-3,'extended start landing meets deck at -3');
  near(meshes.get(right.id).position.x-right.transform.sx/2,3,'extended end landing meets deck at +3');
  near(extrema(meshes.get(deck.id).geometry,'x')[0],-3,'extended deck reaches left landing');
  near(extrema(meshes.get(deck.id).geometry,'x')[1],3,'extended deck reaches right landing');
  assert.ok(steps.every(part=>meshes.get(part.id).geometry.vertices.every(vertex=>vertex.x>=-.126&&vertex.x<=.126)),
    'all stair geometries stay a quarter-tile step and are never stretched');
}
const html=fs.readFileSync('docs/tools/furniture-avatar-author/index.html','utf8');
const author=fs.readFileSync('docs/tools/furniture-avatar-author/tile-span-author.js','utf8');
const runtime=fs.readFileSync('docs/js/authored-furniture-runtime.js','utf8');
const index=fs.readFileSync('docs/index.html','utf8');
assert.match(html,/tileSpan:cloneJson\(state\.tileSpan/,'project export preserves tile-span settings');
assert.match(html,/state\.tileSpan=cloneJson\(data\.tileSpan/,'project import restores tile-span settings');
// Execute the real author import helper: named surfaces must follow newly assigned part IDs.
{
  const begin=html.indexOf('function remapSpanSurfaceRoots(');
  const end=html.indexOf('function importFurnitureDatabaseEntry(',begin);
  assert.ok(begin>=0 && end>begin,'author exposes shared import root remapper');
  const sandbox={};
  vm.runInNewContext(html.slice(begin,end),sandbox);
  const parts=[{tileSpanRoots:{
    start:{partId:'old-left',surfaceId:'old-left:surface:12'},
    end:{partId:'old-right',surfaceId:'old-right:surface:18'}
  }}];
  sandbox.remapSpanSurfaceRoots(parts,new Map([['old-left','new-left'],['old-right','new-right']]));
  assert.equal(parts[0].tileSpanRoots.start.partId,'new-left','start root piece remapped');
  assert.equal(parts[0].tileSpanRoots.start.surfaceId,'new-left:surface:12','start named surface remapped');
  assert.equal(parts[0].tileSpanRoots.end.surfaceId,'new-right:surface:18','end named surface remapped');
}
assert.match(html,/remapSpanSurfaceRoots\(addedParts,idMap\)/,'database imports use shared remapper');
assert.match(html,/remapSpanSurfaceRoots\(importedParts,importedPartIds\)/,'repository imports use shared remapper');
assert.match(author,/Stair Bridge \(Stretchable\)/,'preset bridge is present in the author');
assert.match(author,/tileSpanRole:'stretch'/,'bridge has flexible center geometry');
assert.match(author,/tileSpanRole:role/,'bridge has fixed stair ends');
assert.match(runtime,/setTileSpan\(group\)/,'runtime invokes span deformation');
assert.match(runtime,/record\.tileSpanTiles/,'placed instances can specify the saved span length');
assert.match(runtime,/setItemPlacements\(group, data, data\.itemPlacements\)/,'live resizing refreshes attached item positions');
assert.match(runtime,/createSurfaceAnchor\(group, surfaceId, anchor\.userData/,'live resizing updates cached surface anchors');
assert.match(html,/FurnitureTileSpan\?\.mapLocalPoint/,'editor recognized surfaces follow the preview deformation');
assert.ok(index.indexOf('js/furniture-tile-span.js')<index.indexOf('js/authored-furniture-runtime.js'),'game loads stretch solver before authored furniture');
console.log('Furniture tile-span tests passed: rigid stair ends, two-axis surface-rooted deck, preview resizing, restore, broken roots and integration.');
