'use strict';
// Regression for authored GLBs cloned by the real hand, foot and furniture rigs.
// The original GLTFLoader scene is not the final mesh in gameplay: both tools
// clone BufferGeometry, then add a stretch-fit PNG UV attribute per actor.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.resolve(__dirname,'../docs/js/geometry-auto-lod.js'),'utf8');
const callbacks=[]; // Mock browser idle scheduler; no bake/geometry work in renderer.render.
const store=new Map(); // Setting persistence between mode switches.
let tick=10000;
class Attribute {
  constructor(array,itemSize){this.array=array;this.itemSize=itemSize;this.count=array.length/itemSize;this.version=0;this.normalized=false;}
  getX(i){return this.array[i*this.itemSize];}
  getY(i){return this.array[i*this.itemSize+1];}
  getZ(i){return this.array[i*this.itemSize+2];}
}
function makeGeometry(count,uid,positions=null) {
  const geo={
    isBufferGeometry:true,uuid:uid,
    index:{count,version:0},groups:[],drawRange:{start:0,count:Infinity},
    userData:{geometryQualityGLBSource:true,geometryQualitySourceUid:uid},
    attributes:{position:new Attribute(positions||Float32Array.from({length:900},(_,i)=>i%3===0?i/9:0),3)},
    morphAttributes:{},disposed:false,
    getAttribute(name){return this.attributes[name];},
    setAttribute(name,value){this.attributes[name]=value;return this;},
    computeBoundingBox(){
      const a=this.attributes.position; const min={x:Infinity,y:Infinity,z:Infinity},max={x:-Infinity,y:-Infinity,z:-Infinity};
      for(let i=0;i<a.count;i++){for(const [k,value] of [['x',a.getX(i)],['y',a.getY(i)],['z',a.getZ(i)]]){min[k]=Math.min(min[k],value);max[k]=Math.max(max[k],value);}}
      this.boundingBox={min,max};
    },
    clone(){
      const out=makeGeometry(this.index.count,this.uuid,this.attributes.position.array.slice());
      out.userData={...this.userData};
      out.attributes={...this.attributes};
      return out;
    },
    dispose(){this.disposed=true;},
  };
  return geo;
}
function mesh(name,geo,material){
  return {name,isMesh:true,visible:true,geometry:geo,material,
    userData:{geometryQualityGLBSource:true},parent:null};
}
const original=makeGeometry(900,'source-hand-feline');
const baked=makeGeometry(360,'optimized-hand-feline',original.attributes.position.array.slice(0,360)); // 120 baked vertices vs 300 original.
const exact=mesh('source-mesh',original,{opacity:1});
const clone=original.clone();
clone.setAttribute('uv',new Attribute(new Float32Array(600),2));
clone.userData.hobunjiStretchFitUvAxes='xy'; // Same metadata the actual hand/foot rig writes.
const hand=mesh('hand-instance',clone,{transparent:true,alphaTest:0.001,opacity:1,userData:{hobunjiHandRole:'body'}});
const corrupted=original.clone();
corrupted.attributes.position=new Attribute(original.attributes.position.array.slice(),3);
corrupted.attributes.position.array[0]+=5; // Rock/authoring reshaped a clone, so the precomputed surface must NOT replace it.
corrupted.setAttribute('uv',new Attribute(new Float32Array(600),2));
corrupted.userData.hobunjiStretchFitUvAxes='xy';
const edited=mesh('modified-instance',corrupted,{transparent:true,alphaTest:0.001,opacity:1,userData:{hobunjiFootRole:'body'}});
const alphaCard=mesh('foliage-card',original.clone(),{transparent:true,alphaTest:0.05,opacity:1});
const scene={isScene:true,visible:true,children:[exact,hand,edited,alphaCard]};
for(const node of scene.children)node.parent=scene;
let drawn=[];
const renderer={render(){drawn.push(scene.children.map(x=>x.geometry));}};
const control={checked:false,dataset:{},addEventListener(){}};
const root={
  THREE:{BufferGeometry:class{},BufferAttribute:Attribute},
  localStorage:{getItem:key=>store.get(key)||null,setItem(key,value){store.set(key,String(value))}},
  document:{readyState:'complete',getElementById:id=>id==='settingGeometryAutoOptimize'?control:{textContent:''}},
  performance:{now:()=>tick++},
  requestIdleCallback(fn){callbacks.push(fn)},
  setTimeout(fn){callbacks.push(fn)},
  __hobunjiGameRenderer:renderer,
};
new Function('window',src)(root);
const lod=root.GeometryAutoLOD;
lod.setEnabled(true);
const assets=(node)=>({scene:{traverse(fn){fn(node)}}});
const entryCount=lod.registerPrebaked(assets(exact),assets(mesh('baked-mesh',baked,{opacity:1})));
assert.equal(entryCount,1);
renderer.render(scene,{});
let count=0;
while(callbacks.length && count++<50)callbacks.shift()({timeRemaining:()=>5});
assert.ok(count<50,'background scene scan must finish without a perpetual callback');
drawn=[];renderer.render(scene,{});
assert.equal(drawn[0][0],baked,'original mesh draws precomputed geometry');
assert.notEqual(drawn[0][1],clone,'cloned hand draws precomputed counterpart');
assert.equal(drawn[0][1].index.count,360);
assert.equal(drawn[0][1].getAttribute('uv').count,120,'stretch-fit UVs match the lower-vertex-count candidate');
assert.equal(drawn[0][2],corrupted,'edited geometry cannot be replaced by unrelated baked LOD');
assert.equal(drawn[0][3],alphaCard.geometry,'alpha-card geometry is protected');
assert.equal(hand.geometry,clone,'gameplay retains ORIGINAL hand rig geometry after draw');
assert.equal(edited.geometry,corrupted,'gameplay retains edited geometry');
assert.equal(lod.snapshot().processed,0,'no simplifier/WASM needed for baked geometry');
assert.equal(lod.snapshot().prebakedRegistered,1);
lod.setEnabled(false);drawn=[];renderer.render(scene,{});
assert.equal(drawn[0][0],original,'global OFF immediately draws original GLB');
assert.equal(drawn[0][1],clone,'global OFF immediately draws original hand clone');
assert.equal(hand.geometry,clone);
console.log('Prebaked cloned meshes: closed hand-foot stretch UV parity, unchanged physics, edited/alpha exclusions, no runtime simplification OK');
