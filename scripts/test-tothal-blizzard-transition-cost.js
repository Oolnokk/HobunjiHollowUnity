#!/usr/bin/env node
'use strict';
// The real surface owner must create its temporary Cloud Forest snow only during
// the Tothal event, then fully dispose the mesh and stop spending GPU/CPU work.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
let area='map_southern_cloud_forest'; // Simulates the active wilderness zone.
let snow=0; // Tothal calendar's temporary accumulation fraction.
let loads=0; // Texture load requests across clear-storm-clear.
let meshes=0; // Count of snow Mesh objects ever created.
let disposals=0; // Released snow geometry on the first clear-weather tick.
let walks=0; // Scene traversals; should not continue after snow is removed.
let tick=null; // Production scheduler callback.
let uvMapRuns=0; // Count expensive whole-zone UV mapping calls during repeated snow depth changes.
class Attribute {
  constructor(array,itemSize){this.array=array;this.itemSize=itemSize;this.count=array.length/itemSize;}
  getX(i){return this.array[i*this.itemSize];}
  getY(i){return this.array[i*this.itemSize+1];}
  getZ(i){return this.array[i*this.itemSize+2];}
}
class Geometry {
  constructor(){this.attributes={};this.index=null;}
  setAttribute(k,v){this.attributes[k]=v;return this;}
  getAttribute(k){return this.attributes[k];}
  setIndex(v){this.index=v;return this;}
  computeBoundingBox(){
    const min={x:Infinity,y:Infinity,z:Infinity},max={x:-Infinity,y:-Infinity,z:-Infinity};
    const p=this.attributes.position;
    for(let i=0;i<p.count;i++)for(const [key,get] of [['x','getX'],['y','getY'],['z','getZ']]){
      const value=p[get](i);min[key]=Math.min(min[key],value);max[key]=Math.max(max[key],value);
    }
    this.boundingBox={min,max};
  }
  computeBoundingSphere(){}
  toNonIndexed(){
    const g=new Geometry(),p=this.attributes.position.array,u=this.attributes.uv?.array,p2=[],u2=[];
    for(const i of this.index.array){
      p2.push(p[i*3],p[i*3+1],p[i*3+2]);
      if(u)u2.push(u[i*2],u[i*2+1]);
    }
    g.setAttribute('position',new Attribute(p2,3));
    if(u)g.setAttribute('uv',new Attribute(u2,2));
    return g;
  }
  dispose(){disposals++;}
}
class Group {
  constructor(){this.children=[];this.userData={};this.visible=true;}
  add(object){object.parent=this;this.children.push(object);}
  remove(object){this.children=this.children.filter(x=>x!==object);object.parent=null;}
  traverse(fn){fn(this);for(const child of this.children)fn(child);}
}
class Mesh {
  constructor(geometry,material){this.geometry=geometry;this.material=material;this.userData={};meshes++;}
}
class Material {
  constructor(data){Object.assign(this,data);this.userData={};}
}
const THREE={Group,Mesh,MeshBasicMaterial:Material,BufferGeometry:Geometry,
  Float32BufferAttribute:Attribute,BufferAttribute:Attribute,
  TextureLoader:class{load(url,onReady){loads++;onReady({image:null});}},
  RepeatWrapping:1,LinearFilter:2,DoubleSide:2};
const scene={
  children:[],
  add(object){object.parent=this;this.children.push(object);},
  remove(object){this.children=this.children.filter(x=>x!==object);object.parent=null;},
  traverse(fn){walks++;for(const object of this.children)object.traverse(fn);},
}; // Tracks what remains attached to the real scene's role in rendering.
let grid=Array.from({length:5},()=>Array.from({length:5},()=>({type:'grass',elevTier:0}))); // Nine interior tiles permit compact tessellation.
const win={
  THREE,HobunjiSurfaceStretchUV:{mapGeometry(geometry){
    uvMapRuns++;
    const positions=geometry.getAttribute('position');
    geometry.setAttribute('uv',new Attribute(new Float32Array(positions.count*2),2));
    return geometry; // Mimics the UV mapper's stable triangle ordering without running its 140-step solver.
  }},RuntimeFrameScheduler:{register(id,fn){assert.equal(id,'environment-surface-micro-plateau-tick');tick=fn;}},
  GridTileAccessors:{getCurrentArea:()=>area,getActiveScene:()=>scene,getActiveGrid:()=>grid,getActiveCols:()=>5,getActiveRows:()=>5},
  CalendarSystem:{currentSeason:()=>({name:'Longpour'})},
  TothalBlizzard:{snowCoverageFor:()=>snow},
};
vm.runInNewContext(fs.readFileSync('docs/js/environment-surface-micro-plateau.js','utf8'),
  {window:win,document:{currentScript:{src:'https://example.org/docs/js/environment-surface-micro-plateau.js'}},
    URL,console,performance:{now:()=>0}}, {filename:'environment-surface-micro-plateau.js'});
assert.equal(typeof tick,'function','surface uses existing shared scheduler');
tick({timestamp:100});
const idle=win.EnvironmentSurfaceMicroPlateau.debugSnapshot();
assert.equal(idle.mode,'none');assert.equal(idle.snowMeshCount,0);
assert.equal(idle.textureState,'not-requested');assert.equal(loads,0);
snow=1;tick({timestamp:1000});
const active=win.EnvironmentSurfaceMicroPlateau.debugSnapshot();
assert.equal(active.mode,'snow');assert.equal(active.snowMeshCount,1);
assert.equal(active.builtTiles,25);assert.equal(active.compactTiles,9);
assert.equal(active.detailedTiles,16);assert.equal(active.triangleCount,306);
assert.equal(loads,1,'one lazy texture request');
assert.equal(uvMapRuns,1,'first snow build performs one stretch-map');
snow=0;tick({timestamp:1017});
const melted=win.EnvironmentSurfaceMicroPlateau.debugSnapshot();
assert.equal(melted.mode,'none');assert.equal(melted.snowMeshCount,0);
assert.equal(melted.active,false);assert.equal(disposals,1,'entire snow mesh geometry disposed');
assert.equal(scene.children.length,0,'no hidden group remains in the live scene');
const priorWalks=walks; // Inactive cooldown should not traverse the scene again.
for(let i=0;i<1200;i++)tick({timestamp:1034+i*17});
const afterward=win.EnvironmentSurfaceMicroPlateau.debugSnapshot();
assert.equal(afterward.snowMeshCount,0);assert.equal(meshes,1,'no dormant new meshes');
assert.equal(loads,1,'texture retained for reuse, never re-requested');
assert.equal(scene.children.length,0);assert.equal(walks,priorWalks);
assert(afterward.skippedInactiveTicks>900,'over 75% of subsequent frames skip surface mode work');
snow=.2;tick({timestamp:24000});
assert.equal(uvMapRuns,2,'a new storm recomputes its own connected UV islands');
const surface = win.EnvironmentSurfaceMicroPlateau;
const geometry = scene.children[0].children[0].geometry; // Same render geometry and UV buffer through rising and melting snow.
const positions = geometry.getAttribute('position');
const uv = geometry.getAttribute('uv');
const originalY = Array.from(positions.array);
const builds = surface.debugSnapshot().buildCount;
const meshCount = meshes;
const disposalCount = disposals;
const close = (actual, expected) => assert(Math.abs(actual - expected) < 1e-6, `expected ${expected}, got ${actual}`);
snow=.4;tick({timestamp:24017});
snow=.7;tick({timestamp:24034});
assert.equal(uvMapRuns,2,'multiple changing depths reuse the expensive UV solution');
assert.equal(surface.debugSnapshot().snowDepthUpdates,2);
assert.equal(surface.debugSnapshot().buildCount,builds);
assert.equal(meshes,meshCount,'depth steps do not allocate replacement meshes');
assert.equal(disposals,disposalCount,'depth steps do not dispose snow geometry');
assert.equal(scene.children[0].children[0].geometry,geometry);
assert.equal(geometry.getAttribute('uv'),uv);
assert.equal(positions.needsUpdate,true,'only the live position attribute needs a GPU upload');
for (let i=0;i<positions.count;i++) {
  const original = originalY[i*3+1];
  close(positions.getY(i),original > 0 ? .154 : 0);
}
close(surface.cameraSurfaceYAt(2.5,2.5),.154);
close(surface.cameraSurfaceYAt(2.5,0),0);
close(surface.cameraSurfaceYAt(2.5,.11),.077);
snow=.2;tick({timestamp:24051});
close(surface.cameraSurfaceYAt(2.5,.11),.022);
for (let i=0;i<positions.count;i++) close(positions.getY(i),originalY[i*3+1]);
const newGrass={visible:true,userData:{isWildernessGrassChunkGroup:true},traverse(fn){fn(this);}}; // Simulates wilderness foliage streamed in after a terrain regeneration.
scene.children.push(newGrass);
grid=Array.from({length:5},()=>Array.from({length:5},()=>({type:'grass',elevTier:2}))); // New grid identity on the same active scene and snow step.
tick({timestamp:24068});
assert.equal(uvMapRuns,3,'regeneration recomputes the changed terrain topology even without a scene swap');
assert.equal(newGrass.visible,false,'newly streamed grass is hidden immediately, not one second later');
snow=0;tick({timestamp:24085});
assert.equal(newGrass.visible,true,'grass visibility restores after the storm');
assert.equal(scene.children.length,1,'melt removes the snow mesh and its retained depth buffers');
console.log('Tothal snow clear/storm/clear GPU geometry lifecycle and idle overhead passed.');
