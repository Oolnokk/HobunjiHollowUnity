'use strict';

// Runtime regression for the Northern Cliffs' single immense flat-topped loose rock.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync('docs/js/northern-cliffs-plateau-backdrop.js','utf8'); // Exact production geometry and lifecycle code.
const mountains = fs.readFileSync('docs/js/western-slope-mountain-backdrops.js','utf8'); // Reference height and distant-depth contract.
const loader = fs.readFileSync('docs/js/environment-surface-runtime.js','utf8'); // Bootstrap order must preserve material/geometry dependencies.
assert.match(mountains,/getDebugState:debug,keepInFrontOfSky/);
assert(loader.indexOf("'WesternSlopeMountainBackdrops'") < loader.indexOf("'NorthernCliffsPlateauBackdrop'"));
assert.match(source,/HobunjiSurfaceStretchUV/);
assert.match(source,/NaturalSurfaceMaterials/);

class Node3D {
  constructor(){this.children=[];this.parent=null;this.userData={};this.visible=true;}
  add(node){node.parent=this;this.children.push(node);}
  remove(node){this.children=this.children.filter(child=>child!==node);node.parent=null;}
  getObjectByName(name){if(this.name===name)return this;for(const child of this.children){const found=child.getObjectByName(name);if(found)return found;}return null;}
}
class Group extends Node3D {}
class Attribute {
  constructor(array,size){this.array=Array.from(array);this.itemSize=size;this.count=this.array.length/size;}
  getX(i){return this.array[i*this.itemSize];}
  getY(i){return this.array[i*this.itemSize+1];}
  getZ(i){return this.array[i*this.itemSize+2];}
  setXYZ(i,x,y,z){this.array[i*3]=x;this.array[i*3+1]=y;this.array[i*3+2]=z;}
}
class Geometry {
  constructor(values,indices=null){
    this.attributes={position:new Attribute(values,3)};
    this.index=indices?{array:indices,count:indices.length,getX:i=>indices[i]}:null;
    this.userData={};this.disposed=false;
  }
  getAttribute(name){return this.attributes[name];}
  toNonIndexed(){if(!this.index)return this;const out=[],pos=this.getAttribute('position');for(const i of this.index.array)out.push(pos.getX(i),pos.getY(i),pos.getZ(i));return new Geometry(out);}
  computeBoundingBox(){
    const min={x:Infinity,y:Infinity,z:Infinity},max={x:-Infinity,y:-Infinity,z:-Infinity},p=this.getAttribute('position');
    for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i);min.x=Math.min(min.x,x);min.y=Math.min(min.y,y);min.z=Math.min(min.z,z);max.x=Math.max(max.x,x);max.y=Math.max(max.y,y);max.z=Math.max(max.z,z);}
    this.boundingBox={min,max};
  }
  computeBoundingSphere(){}
  computeVertexNormals(){this.normalsComputed=true;}
  dispose(){this.disposed=true;}
}
class Material{
  constructor(options={}){Object.assign(this,options);this.userData={...(options.userData||{})};this.disposed=false;}
  clone(){return new Material(this);}
  dispose(){this.disposed=true;}
}
class Mesh extends Node3D{
  constructor(geometry,material){super();this.isMesh=true;this.geometry=geometry;this.material=material;this.layers={disable(){}};}
}
const THREE={Mesh,Group,MeshBasicMaterial:Material,DoubleSide:2};
const sources=[]; // Tracks all stone and grass source allocations across mountain measurements and scene rebuilds.
const calls={natural:0,map:0,sky:0,shell:0}; // Ensures the farm cliff render pipeline actually runs.
function buildRockTileGeo(){
  const positions=[],indices=[];
  for(let r=0;r<6;r++)for(let c=0;c<6;c++){
    const top=c>=2&&c<=3&&r>=2&&r<=3;
    const shoulder=c>=1&&c<=4&&r>=1&&r<=4;
    positions.push(c/5-0.5,top?0.7:(shoulder?0.12:0),r/5-0.5);
  }
  // The full source attribute has unused grass-grid corners. Only rendered
  // stone indices may contribute to the scaled rock's visible footprint.
  for(let r=1;r<=3;r++)for(let c=1;c<=3;c++){const a=r*6+c,b=a+1,d=a+7,e=a+6;indices.push(a,e,d,a,d,b);}
  const stoneGeo=new Geometry(positions,indices),grassGeo=new Geometry(positions,[0,1,6]);
  sources.push(stoneGeo,grassGeo);
  return {stoneGeo,grassGeo};
}
const west={
  constants:{ROCKS_PER_LAYER:8,ROCK_SEED_BASE:1731,ROCK_HEIGHT_FRACTION:0.72},
  resolveLayoutFromSizes(_sizes,cols,rows){
    assert.equal(cols,200);assert.equal(rows,200);
    return [{index:0,layer:1,visible:true,width:8,height:0.72,targetLength:40,scale:[2,1.5,1.25],position:[-12,20,10],rotationDeg:[0,0,0]}];
  },
  keepInFrontOfSky(material){calls.sky++;material.userData.distantDepthShader=true;}
};
const window={
  THREE,WesternSlopeMountainBackdrops:west,
  TerrainGeometry:{buildRockTileGeo},
  NaturalSurfaceMaterials:{naturalizeMesh(mesh,surface){
    assert.equal(surface,'rocks');calls.natural++;
    mesh.material=mesh.material.clone();mesh.material.map='carved_smooth.png';
    mesh.material.userData.naturalSurface='rocks';mesh.userData.naturalSurface='rocks';return mesh;
  }},
  HobunjiSurfaceStretchUV:{mapMesh(mesh,options){
    assert.equal(options.label,'northern-cliffs-giant-rock');calls.map++;
    return mesh.geometry.userData.hobunjiSurfaceStretch={patchCount:2,fallbackCount:0};
  }},
  FacetedNaturalSurfaceShellReduction:{suppressMesh(mesh){calls.shell++;mesh.userData.noOutline=true;}},
  BorderTerrain:{buildZoneBorderTerrain(scene,cols,rows,mapId){return {scene,cols,rows,mapId};}},
  WildernessChunks:{destroyZone(mapId){return mapId;}}
};
vm.runInNewContext(source,{window,Math,Number,Object,Array,Map,WeakSet,Error,String});
const api=window.NorthernCliffsPlateauBackdrop;
assert(api?.installed);
assert.equal(api.constants.HEIGHT_RATIO,0.7);
assert.equal(api.constants.TOP_FLATTEN_START,0.7);
const other=new Group();
window.BorderTerrain.buildZoneBorderTerrain(other,200,200,'map_western_slope');
assert.equal(other.children.length,0,'unrelated wilderness cannot gain the Northern backdrop');
const scene=new Group();scene.items=[];
window.BorderTerrain.buildZoneBorderTerrain(scene,200,200,'map_northern_cliffs');
const root=api.getActiveRoot(),mesh=root?.children[0],layout=api.getDebugState().lastLayout;
assert(mesh&&mesh.isMesh&&scene.items.includes(root),'one mesh must be registered in the scene');
assert.equal(root.children.length,1,'single enormous rock rather than separate peaks');
assert.equal(sources.length,18,'eight reference rocks plus one source rock, each with disposable stone and grass');
assert(sources.every(geo=>geo.disposed),'temporary source geometries must be released');
assert.equal(calls.natural,1,'farm rock material factory used');
assert.equal(calls.map,1,'connected-surface mapping used');
assert.equal(calls.sky,1,'distant sky-depth shader used');
assert.equal(calls.shell,1,'natural rock edge outline policy used');
assert.equal(mesh.material.map,'carved_smooth.png');
assert.equal(mesh.material.userData.northernCliffsDistantPlateau,true);
assert.equal(mesh.material.userData.naturalSurface,'rocks');
assert.equal(mesh.userData.naturalSurfaceUvOwner,'HobunjiSurfaceStretchUV');
assert.equal(layout.detectedSurfaceIslands,2);
assert.equal(layout.uvFallbackIslands,0);
assert.equal(layout.sourceShape,'TerrainGeometry.buildRockTileGeo:stoneGeo');
assert.equal(mesh.raycast(),undefined,'scenery must never catch game tool rays');
assert.equal(mesh.castShadow,false);
assert.equal(mesh.frustumCulled,false,'existing distant-scenery view culler owns camera/offscreen visibility');
assert.equal(mesh.userData.nonTraversable,true);
assert.equal(mesh.userData.noOutline,true);
assert.equal(layout.topWorldY,layout.referencePeakWorldY*0.7);
assert.equal(layout.width,layout.referenceMountainChainWidth);
assert.equal(layout.baseFrontZ,-24);
assert.equal(layout.outsideSceneryClearance,6);
assert(layout.triangleCount>0&&layout.triangleCount<100,'source must remain low poly');
assert(mesh.geometry.normalsComputed);
const box=mesh.geometry.boundingBox;
assert(Math.abs(box.max.x-box.min.x-layout.width)<1e-5,'visible stone, not unused source tile vertices, must span the full ridge width');
assert(Math.abs(box.max.z-box.min.z-layout.depth)<1e-5,'visible stone must extend into a giant deep rock');
assert(box.max.z<=-24,'all rendered stone remains outside the map and border terrain');
assert(Math.abs(box.max.y-layout.topWorldY)<1e-5,'flat stone crown exactly reaches the intended height');
assert(layout.flatCapVertices>=3,'several vertices must form a level cap');
assert.equal(api.getDebugState().clearOfPlayableMap,true);
assert.strictEqual(api.attach(scene,200,200),root,'duplicate attach must not create second rock');
assert.equal(sources.length,18,'duplicate attach must not rebuild');
window.WildernessChunks.destroyZone('map_northern_cliffs');
assert.equal(scene.children.length,0,'zone destruction removes rock');
assert.equal(scene.items.length,0,'zone destruction removes scene-item ownership');
assert(mesh.geometry.disposed&&mesh.material.disposed,'zone destruction disposes owned GPU resources');
assert.equal(api.getDebugState().attached,false);
window.BorderTerrain.buildZoneBorderTerrain(scene,200,200,'map_northern_cliffs');
assert.equal(scene.children.length,1,'re-entering zone rebuilds just one rock');
console.log('Northern Cliffs giant rock shape, farm material, UV fitting, culling, clearance, and lifecycle tests passed.');
