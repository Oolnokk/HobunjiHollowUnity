'use strict';
// Test the actual Hronal native-pillar conversion, including cleanup.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync('docs/js/dev-random-ruin-lich-themes.js', 'utf8');

class V {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  setScalar(v){return this.set(v,v,v);}
  applyAxisAngle(){return this;}
}
class Obj {
  constructor(){this.children=[];this.parent=null;this.position=new V();this.rotation=new V();this.scale=new V(1,1,1);this.userData={};this.visible=true;this.matrix={};}
  add(...items){for(const item of items){item.parent=this;this.children.push(item);}}
  remove(item){this.children=this.children.filter(child=>child!==item);item.parent=null;}
  traverse(fn){fn(this);for(const child of [...this.children])child.traverse(fn);}
  updateWorldMatrix(){}
  updateMatrix(){}
  getWorldPosition(out){let x=0,y=0,z=0;for(let node=this;node;node=node.parent){x+=node.position.x;y+=node.position.y;z+=node.position.z;}return out.set(x,y,z);}
}
class Geo {
  constructor(){
    this.boundingBox={min:new V(-.2392,0,-.2392),max:new V(.2392,1.36,.2392)};
    const vertices=[];for(const [y,r] of [[0,.2392],[1.36,.207]])for(const x of [-r,r])for(const z of [-r,r])vertices.push([x,y,z]);
    this.attributes={position:{count:vertices.length,getX:i=>vertices[i][0],getY:i=>vertices[i][1],getZ:i=>vertices[i][2]}};
    this.disposed=false;
  }
  computeBoundingBox(){}
  rotateX(){return this;}
  rotateZ(){return this;}
  setAttribute(k,v){this.attributes[k]=v;}
  computeVertexNormals(){}
  dispose(){this.disposed=true;}
}
class Mat {constructor(props={}){Object.assign(this,props);this.disposed=false;}dispose(){this.disposed=true;}}
class Mesh extends Obj {constructor(g,m){super();this.isMesh=true;this.geometry=g;this.material=m;}}
class InstancedMesh extends Mesh {constructor(g,m,n){super(g,m);this.count=n;this.instanceMatrix={};}setMatrixAt(){}}
class Box3 {
  setFromObject(obj){const p=obj.getWorldPosition(new V());this.min=new V(p.x-.39,p.y,p.z-.39);this.max=new V(p.x+.39,p.y+3.1,p.z+.39);return this;}
  isEmpty(){return false;}
  getSize(v){return v.set(this.max.x-this.min.x,this.max.y-this.min.y,this.max.z-this.min.z);}
  getCenter(v){return v.set((this.max.x+this.min.x)/2,(this.max.y+this.min.y)/2,(this.max.z+this.min.z)/2);}
}
const THREE={
  Group:Obj,Object3D:Obj,Vector3:V,Mesh,InstancedMesh,Box3,
  BoxGeometry:Geo,PlaneGeometry:Geo,TetrahedronGeometry:Geo,ConeGeometry:Geo,BufferGeometry:Geo,
  Float32BufferAttribute:class{constructor(values,size){this.values=values;this.itemSize=size;}},
  MeshBasicMaterial:Mat,DoubleSide:2,MathUtils:{lerp:(a,b,t)=>a+(b-a)*t}
};

function makeFixture(hasTarget=true){
  const root=new Obj(),supports=[];let composer,refreshCount=0,sounds=0;
  for(let i=0;i<4;i++){
    const support=new Obj(),shaft=new Mesh(new Geo(),new Mat({color:0x777777}));
    support.userData={squarePillar:true,usedAuthoredPillarSquare:true,interiorRuinRole:'ceiling support pillar'};
    support.name='repo_furniture_pillar_square';
    support.position.set(4.5+i*1.5,0,6.5);
    shaft.name='Square Tapered Shaft';
    support.add(shaft);root.add(support);supports.push({support,shaft,geometry:shaft.geometry,material:shaft.material});
  }
  const target=new Obj();target.position.set(5.5,0,4.5);
  target.userData=hasTarget?{squarePillarHousing:true,hiddenActivatorMount:'pillarNiche',activatorType:'glyphObelisk',linkedMechanismId:'doorA'}:{};
  root.add(target);
  const player={x:2.5*64,y:2.5*64,health:100};
  const window={
    THREE,DevRandomRuinSimplePuzzles:{registerComposer:c=>composer=c},
    DevRandomRuinTileOccupancy:{solidAt:()=>false,addSolidBox(){},clearSolids(){},refresh(){refreshCount++;}},
    ResourceSystem:{addAffliction(){},spendFooting(){}},
    AudioSystem:{gameAudioConfig:()=>({sfxVolume:1})},
    DevRandomRuin:{syncPlayerPresentationHeight(){}}
  };
  const Audio=class{play(){sounds++;return Promise.resolve();}};
  const document={getElementById:()=>null};
  vm.runInNewContext(code,{window,Audio,document,console});
  const floorSet=new Set();for(let x=2;x<13;x++)for(let z=2;z<13;z++)floorSet.add(x+','+z);
  const context={root,seed:444,theme:'hronal',floorSet,ceilingY:3.5,meta:{floorSurfaceY:0,wallHeight:3.5,rooms:[{id:'A',col:0,row:0,w:11,h:11}]}};
  const kit={deps:{TILE:64,player,hostileObjects:new Set()},root:new Obj(),state:{context},
    group(){return this.root;},sampleSupport(){return {y:0};},
    roomBounds(){return {minX:2,maxX:13,minZ:2,maxZ:13};},makeBasic(){return new Mat();}
  };
  composer.buildRooms(kit,context);
  return {composer,kit,window,supports,target,player,
    tick(frames){for(let i=0;i<frames;i++)composer.update(kit,i*500,.5);},
    get refreshCount(){return refreshCount;},get sounds(){return sounds;}
  };
}
{
  const f=makeFixture();
  const start=f.window.DevRandomRuinLichThemes.snapshot();
  assert.equal(start.reusedDecoyPillars,2,'A mixed room converts 40% of its four decoy supports');
  assert.equal(start.totalPillars,2,'It does not insert differently shaped supplementary hazards');
  assert.equal(f.target.visible,true,'Real target pillars remain untouched');
  const cracked=f.supports.filter(({shaft})=>shaft.children.length===3);
  assert.equal(cracked.length,2,'Exactly two authored shafts get three batched four-face warning stages');
  assert.equal(cracked[0].shaft.children.filter(c=>c.visible).length,1,'Only the first four-sided fissure glows initially');
  assert.ok(cracked[0].shaft.children.every(c=>c.geometry.attributes.position.values.length===576),'Each crack stage contains all four tapered faces in one mesh');
  for(const {shaft,geometry,material} of f.supports){
    assert.strictEqual(shaft.geometry,geometry,'Original shaft geometry must not be replaced');
    assert.strictEqual(shaft.material,material,'Original shaft material must not be replaced');
  }
  f.player.x=cracked[0].support.position.x*64;f.player.y=cracked[0].support.position.z*64;
  f.tick(5);
  assert.equal(cracked[0].shaft.children.filter(c=>c.visible).length,3,'Cracks visibly expand across three pulses');
  assert.ok(f.sounds>=3,'All rock warning pulses play');
  f.tick(4);
  assert.equal(cracked[0].support.visible,false,'The exact original support disappears at detonation');
  assert.equal(f.target.visible,true,'The puzzle target survives the blast');
  assert.ok(f.refreshCount>=2,'Collision occupancy refreshes when the support disappears');
  f.composer.clear();
  for(const {support,shaft,geometry,material} of f.supports){
    assert.equal(support.visible,true,'Teardown restores the generator-owned support visibility');
    assert.equal(shaft.children.length,0,'All crack decals are disposed and removed');
    assert.equal(geometry.disposed,false,'The original shaft geometry stays owned by the ruin');
    assert.equal(material.disposed,false,'The original shaft material stays owned by the ruin');
  }
  f.composer.buildRooms(f.kit,f.kit.state.context);
  assert.equal(f.window.DevRandomRuinLichThemes.snapshot().reusedDecoyPillars,2,'The same seed reproduces the same converted count');
  f.composer.clear();
}
{
  const f=makeFixture(false);
  assert.equal(f.window.DevRandomRuinLichThemes.snapshot().reusedDecoyPillars,0,'No target means no support conversion');
  assert.ok(f.supports.every(({shaft})=>shaft.children.length===0),'Normal supports remain unmodified without a target');
  f.composer.clear();
}
console.log('Cracked decoy-pillar tests passed: native shape retained, target safe, pulses, collision cleanup and deterministic reroll.');
