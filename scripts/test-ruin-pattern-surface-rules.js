'use strict';
// Executes the ruin pattern rules module together with the real surface renderer:
// per-piece types, enable/scale rules, sliver skipping, and the Dev Companion panel.
const assert = require('assert');
const fs = require('fs'), vm = require('vm');

class Vector3 {
  constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}
  fromBufferAttribute(a,i){this.x=a.array[i*3];this.y=a.array[i*3+1];this.z=a.array[i*3+2];return this;}
  subVectors(a,b){this.x=a.x-b.x;this.y=a.y-b.y;this.z=a.z-b.z;return this;}
  cross(b){const x=this.y*b.z-this.z*b.y,y=this.z*b.x-this.x*b.z,z=this.x*b.y-this.y*b.x;Object.assign(this,{x,y,z});return this;}
  negate(){this.x=-this.x;this.y=-this.y;this.z=-this.z;return this;}
  normalize(){const n=Math.hypot(this.x,this.y,this.z)||1;this.x/=n;this.y/=n;this.z/=n;return this;}
  dot(b){return this.x*b.x+this.y*b.y+this.z*b.z;}
}
class Attribute {constructor(array,itemSize){this.array=Float32Array.from(array);this.itemSize=itemSize;this.count=this.array.length/itemSize;}}
class Geometry {constructor(){this.attributes={};this.userData={};}getAttribute(n){return this.attributes[n];}setAttribute(n,a){this.attributes[n]=a;return this;}computeVertexNormals(){}dispose(){this.disposed=true;}}
class Material {constructor(o){Object.assign(this,o);this.listeners={};}addEventListener(n,fn){this.listeners[n]=fn;}dispose(){this.listeners.dispose?.();this.disposed=true;}}
class Mesh {
  constructor(geometry,material){this.geometry=geometry;this.material=material;this.userData={};this.children=[];this.isMesh=!!geometry;this.name='';this.matrixWorld={elements:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]};}
  add(c){c.parent=this;this.children.push(c);return this;}
  remove(c){this.children=this.children.filter(x=>x!==c);c.parent=null;}
  traverse(fn){fn(this);for(const c of [...this.children])c.traverse?.(fn);}
}
class Matrix3 {constructor(){this.elements=[1,0,0,0,1,0,0,0,1];}copy(o){this.elements=[...o.elements];return this;}}
class Vector2 {constructor(x=0,y=0){this.x=x;this.y=y;}set(x,y){this.x=x;this.y=y;return this;}}
const THREE={Matrix3,Vector2,Vector3,BufferGeometry:Geometry,Float32BufferAttribute:Attribute,Mesh,MeshBasicMaterial:Material,DoubleSide:2};

// A vertical side quad (normal +z) of the given width (x) and height (y).
function sideMesh(name,width,height){
  const g=new Geometry(),w=width/2,h=height/2;
  g.setAttribute('position',new Attribute([-w,-h,0, w,h,0, w,-h,0, -w,-h,0, -w,h,0, w,h,0],3));
  const mesh=new Mesh(g,new Material({}));mesh.name=name;return mesh;
}
function group(name,userData={}){const node=new Mesh(null,null);node.name=name;Object.assign(node.userData,userData);return node;}

const storage=new Map();
const panels=[];
const pieceJson={'pillar_square':{parts:[{id:'p1',name:'Square Tapered Shaft',patternScale:3}]}};
const sizes=[];
const window={THREE,
  PatternLibrary:{getById:()=>null,getCatalog:()=>[{id:'rune-a',pattern:{motifDataUrl:'data:a'}}],unlock:()=>true},
  ClothingWeavingSystem:{async applyPatternStackToTintedImage(canvas){sizes.push([canvas.width,canvas.height]);return canvas;}},
  HobunjiSpritePngSurface:{makeMaterial:(_T,_t,_n,o)=>new Material(o),makeCanvasTexture:(_T,canvas)=>({canvas,image:canvas,dispose(){}})},
  DevCompanion:{registerPanel:spec=>panels.push(spec)},
};
const document={createElement(){const c={width:0,height:0,getContext:()=>({fillRect(){},drawImage(){}}),click(){},remove(){}};return c;},body:{appendChild(){}}};
const context={window,document,console,performance:{now:()=>Date.now()},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))},
  fetch:async url=>{const id=String(url).match(/data\/([^/]+)\.json$/)?.[1];if(url.includes('ruin-surface-rules'))return{ok:true,json:async()=>({minSurfaceTiles:.25,maxAtlasPx:512,rules:{'pillar_square › Broad Stone Capital':{enabled:false}}})};return id&&pieceJson[id]?{ok:true,json:async()=>pieceJson[id]}:{ok:false};},
  setTimeout,URL:{createObjectURL:()=>'blob:x',revokeObjectURL(){}},Blob:class{},encodeURIComponent};
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/furniture-pattern-surfaces.js','utf8'),context);
vm.runInContext(fs.readFileSync('docs/js/ruin-pattern-surface-rules.js','utf8'),context);
const S=window.FurniturePatternSurfaces,R=window.RuinPatternSurfaceRules;

(async()=>{
  await R.ready;
  // Two copies of a repo pillar (same type) + a wall; thin plinth strip is a sliver.
  const root=group('ruin_interior_complex');
  const pillars=[0,1].map(()=>{const p=group('repo_furniture_pillar_square',{interiorRuinRole:'baseboard'});p.add(sideMesh('Square Tapered Shaft',1.2,1.4));p.add(sideMesh('Wide Stone Plinth',.8,.11));p.add(sideMesh('Broad Stone Capital',.7,.6));root.add(p);return p;});
  const wall=sideMesh('ruin_wall_wn_0',4,2);wall.userData.ruinInteriorWall=true;root.add(wall);
  window.DevRandomRuin={getRuntimeContext:()=>({root})};
  assert.equal(R.identify(wall,root).key,'ruin_wall','per-instance wall suffixes collapse into one type');
  assert.equal(R.identify(pillars[0].children[0],root).key,'pillar_square › Square Tapered Shaft');
  await R.preloadPieces(root);

  S.decorateRuin(root,7);
  const types=root.userData.ruinPatternTypes;
  const shaft=types.get('pillar_square › Square Tapered Shaft');
  assert.equal(shaft.meshes,2,'repeated pieces share one type entry');
  assert.equal(shaft.overlays,2);
  assert.equal(shaft.partScale,3,'Furniture Author patternScale is read from the piece JSON');
  assert.equal(pillars[0].children[0].children[0].userData.furniturePattern.scale,3,'piece patternScale drives the engraving tile size');
  assert.equal(types.get('pillar_square › Wide Stone Plinth').overlays,0,'sliver strips are skipped');
  assert.equal(pillars[0].children[1].children.length,0,'skipped slivers leave no overlay mesh');
  assert.equal(types.get('pillar_square › Broad Stone Capital').overlays,0,'repo rule disables a type');
  assert.equal(types.get('ruin_wall').overlays,1);
  assert(sizes.every(([w,h])=>Math.max(w,h)<=512),'repo maxAtlasPx caps atlas size');
  assert(sizes.every(([w,h])=>(w<=64||w%64===0)&&(h<=64||h%64===0)),'atlas sizes are quantized for sharing');

  const panel=panels.find(p=>p.id==='ruin-patterns');
  assert(panel&&panel.when(),'Dev Companion panel shows while a decorated ruin is loaded');
  const body=panel.render();
  assert(body.actions.some(a=>a.id==='toggle'&&a.args.key==='ruin_wall'));
  // Turn the wall off: it is removed live, and the edit persists locally.
  panel.onAction('toggle',{key:'ruin_wall'});
  assert.equal(wall.children.filter(c=>c.userData.furniturePattern).length,0,'toggling off removes the overlays immediately');
  assert.equal(root.userData.ruinPatternTypes.get('ruin_wall').overlays,0);
  assert(JSON.parse(storage.get('hobunjiRuinPatternRules.v1')).rules.ruin_wall.enabled===false);
  // Re-enable the repo-disabled capital locally, and override the shaft scale above the piece value.
  panel.onAction('toggle',{key:'pillar_square › Broad Stone Capital'});
  assert.equal(root.userData.ruinPatternTypes.get('pillar_square › Broad Stone Capital').overlays,2,'local edit overrides a repo-disabled type');
  panel.onAction('scale',{key:'pillar_square › Square Tapered Shaft',direction:1,from:3});
  assert.equal(pillars[1].children[0].children[0].userData.furniturePattern.scale,4,'rule scale overrides the piece scale');
  assert.equal(R.mergedConfig().rules['pillar_square › Broad Stone Capital'],undefined,'export replaces the repo file, so a re-enabled type drops out');assert.equal(R.mergedConfig().rules.ruin_wall.enabled,false);
  panel.onAction('reset',{key:'pillar_square › Square Tapered Shaft'});
  assert.equal(pillars[1].children[0].children[0].userData.furniturePattern.scale,3);
  assert.equal(R.stepScale(1.5,-1),1.25);assert.equal(R.stepScale(1.4,1),1.5);
  console.log('ruin pattern surface rules ok');
})().catch(error=>{console.error(error);process.exit(1);});
