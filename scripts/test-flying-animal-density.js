#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const flyingSource=fs.readFileSync('docs/js/flying-animal-rig.js','utf8'); // Test the shipped flying-creature rig, not a duplicate tessellator.
class Attribute{
  constructor(array,size){this.array=array;this.itemSize=size;this.count=array.length/size;}
  getX(i){return this.array[i*this.itemSize];}
  getY(i){return this.array[i*this.itemSize+1];}
  setX(i,value){this.array[i*this.itemSize]=value;}
  setXYZ(i,x,y,z){const o=i*this.itemSize;this.array[o]=x;this.array[o+1]=y;this.array[o+2]=z;}
}
class Plane{
  constructor(width,height,nx=1,ny=1){
    this.parameters={width,height,widthSegments:nx,heightSegments:ny};
    const p=[],uv=[];
    for(let y=0;y<=ny;y++)for(let x=0;x<=nx;x++){
      const u=x/nx,v=1-y/ny;
      p.push((u-.5)*width,(v-.5)*height,0);uv.push(u,v);
    }
    this.attributes={position:new Attribute(new Float32Array(p),3),uv:new Attribute(new Float32Array(uv),2)};
  }
  setAttribute(key,value){this.attributes[key]=value;}
  computeBoundingSphere(){}
  computeVertexNormals(){}
  dispose(){this.disposed=true;}
}
class Vector{
  constructor(){this.x=0;this.y=0;this.z=0;}
  set(x,y,z){Object.assign(this,{x,y,z});return this;}
}
class Object3D{
  constructor(){this.position=new Vector();this.rotation={x:0,y:0,z:0};this.userData={};this.children=[];this.visible=true;}
  add(child){this.children.push(child);child.parent=this;}
  worldToLocal(value){return value;}
}
class Mesh extends Object3D{constructor(geometry,material){super();this.geometry=geometry;this.material=material;}}
class Bone extends Object3D{}
class Skeleton{constructor(bones){this.bones=bones;}dispose(){this.disposed=true;}}
class SkinnedMesh extends Mesh{bind(value){this.skeleton=value;}}
const THREE={Group:Object3D,Mesh,PlaneGeometry:Plane,Bone,Skeleton,SkinnedMesh,Vector3:Vector,
  Uint16BufferAttribute:Attribute,Float32BufferAttribute:Attribute,DoubleSide:2,FrontSide:0,BackSide:1,AdditiveBlending:3};
let density=40; // Changes as if a player had dragged the developer slider.
const handlers=new Map(); // Prevents false positives when a despawned actor forgets to unsubscribe.
const image={width:1600,height:1000};
const images=Object.fromEntries(['flying','perched','wings','eyes','blink','glowFlying','glowPerched',
  'patternFlying','patternPerched','detailFlying','detailPerched'].map(key=>[key,image]));
const environment={
  THREE,PNGPlaneAvatar:{meshBudget:{portraitDensityPercent:()=>density}},
  AnimalShoulderSpline:{POINT_COUNT:7,
    linearPointsForGuide:()=>Array.from({length:7},(_,i)=>({x:i/6,y:.45})),
    normalizeRest:rest=>rest,
    deformNormalizedPoint:point=>({x:point.x+.08,y:point.y+.11})},
  HobunjiSpritePngSurface:{
    makeCanvasTexture:(_,img,name)=>({img,name,dispose(){this.disposed=true;}}),
    makeMaterial:(_,map,name,options)=>({map,name,...options,dispose(){this.disposed=true;}})},
  addEventListener:(event,handler)=>handlers.set(event,handler),
  removeEventListener:(event,handler)=>{if(handlers.get(event)===handler)handlers.delete(event);}
};
new Function('window',flyingSource)(environment);
const before=Array.from({length:7},(_,i)=>({x:i/6,y:.45})),after=before.map(point=>({...point,x:point.x+.07}));
const animal=environment.FlyingAnimalRig.create({perchSpline:{beforePoints:before,afterPoints:after}},images);
const low=animal.perched.geometry;
assert.equal(low.parameters.widthSegments,13,'40% of 32 horizontal segments');
assert.equal(low.parameters.heightSegments,8,'40% of 20 vertical segments');
assert.equal(handlers.size,1,'one density-change listener per flying rig');
const overlays=animal.pitch.children.filter(mesh=>mesh!==animal.perched&&mesh.geometry===low);
assert(overlays.length>=5,'perched eye/glow/pattern/detail overlays all reuse the body mesh');
const baseX=-image.width/image.height/2;
assert(low.attributes.position.array[0]>baseX,'seven-point perch spline is applied at initial resolution');
const originalWing=animal.pitch.children.find(mesh=>mesh.skeleton);
density=100;
handlers.get('hobunji:portrait-density-changed')();
const high=animal.perched.geometry;
assert.equal(high.parameters.widthSegments,32);
assert.equal(high.parameters.heightSegments,20);
assert(low.disposed,'old geometry released after swap');
assert(overlays.every(mesh=>mesh.geometry===high),'all eyes/markings share the retessellated body, not old vertices');
assert(high.attributes.position.array[0]>baseX,'authored spline reapplied to replacement vertices');
assert.strictEqual(animal.pitch.children.find(mesh=>mesh.skeleton),originalWing,'the three-column skinned wing is not rebuilt');
density=40;
handlers.get('hobunji:portrait-density-changed')();
assert.equal(animal.perched.geometry.parameters.widthSegments,13);
assert(high.disposed,'second change also frees retired geometry');
animal.dispose();
assert.equal(handlers.size,0,'despawn removes its live slider callback');
assert(animal.perched.geometry.disposed,'final buffer freed on despawn');
console.log('OK: flying animal 40%/100%/40% perches, six shared overlays, authored spline, untouched wings and listener cleanup');
