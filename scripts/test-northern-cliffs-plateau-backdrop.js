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
const weather = fs.readFileSync('docs/js/bootstrap/classic-groups/weather-surfaces.js','utf8'); // Manifest is uncached per navigation and owns rain-plane versioning.
const rain = fs.readFileSync('docs/js/rain-planes.js','utf8'); // The rain bootstrap is the only parser-time loader of this backdrop's runtime.
const manifestRainVersion = weather.match(/js\/rain-planes\.js\?v=([A-Za-z0-9_-]+)/)?.[1]; // Must agree with the revised weather module.
const loadedRuntimeVersion = rain.match(/js\/environment-surface-runtime\.js\?v=([A-Za-z0-9_-]+)/)?.[1]; // Must bypass a previously cached parent loader.
const plateauVersion = loader.match(/js\/northern-cliffs-plateau-backdrop\.js\?v=([A-Za-z0-9_-]+)/)?.[1]; // Must bypass a previously cached child backdrop.
// Every loader needs a versioned URL, but the exact token must be free to change
// when rain, surface and plateau owners are updated independently. The CI
// cache-bust checker verifies that a changed module's referencing URL moves.
assert(manifestRainVersion && loadedRuntimeVersion && plateauVersion,
  'rain, surface bootstrap and plateau scripts must each have a cache-busting version');
assert.match(rain, /if \(!window\.EnvironmentSurfaceRuntime\)/,
  'the rain loader must still load the surface-runtime dependency');
assert.match(loader, /global: 'NorthernCliffsPlateauBackdrop', src: 'js\/northern-cliffs-plateau-backdrop\.js\?v=/,
  'surface runtime must still load the Northern Cliffs backdrop');
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
  constructor(values=[],indices=null){
    this.attributes={position:new Attribute(values,3)};
    this.index=indices?{array:indices,count:indices.length,getX:i=>indices[i]}:null;
    this.userData={};this.disposed=false;
  }
  getAttribute(name){return this.attributes[name];}
  setAttribute(name,attribute){this.attributes[name]=attribute;return this;}
  setIndex(index){this.index=index;return this;}
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
const THREE={Mesh,Group,MeshBasicMaterial:Material,BufferGeometry:Geometry,BufferAttribute:Attribute,Float32BufferAttribute:Attribute,DoubleSide:2};
const sources=[]; // Tracks all stone and grass source allocations across mountain measurements and scene rebuilds.
const calls={natural:0,map:0,sky:0,shell:0}; // Ensures the farm cliff render pipeline actually runs.
const canonicalFarmRock = new Material({ map: 'carved_smooth.png', userData: { naturalSurface: 'rocks' } }); // Must remain shared and undisposed after backdrop unload.
let splitRidge = true; // Tests both real farm ridge-slot output and the unsplit single-material fallback.
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
    mesh.material=splitRidge?[canonicalFarmRock,canonicalFarmRock]:canonicalFarmRock; // Mirrors NaturalSurfaceCliffRidgeIsolation's material [top, side] when a cap exists.
    mesh.userData.naturalSurface='rocks';
    if(splitRidge){
      mesh.userData.naturalSurfaceCliffSlot=1; // The shared mapper must only remap steep side faces, leaving the tabletop alone.
      mesh.geometry.groups=[{start:0,count:6,materialIndex:0},{start:6,count:mesh.geometry.getAttribute('position').count-6,materialIndex:1}];
    }
    return mesh;
  }},
  HobunjiSurfaceStretchUV:{remapNaturalTerrainMesh(mesh,label){
    assert.equal(label,'northern-cliffs-giant-rock');calls.map++;
    if(splitRidge)assert.equal(mesh.userData.naturalSurfaceCliffSlot,1,'ridge side UV mapping must preserve the flat top');
    return mesh.geometry.userData.hobunjiSurfaceStretch={patchCount:2,fallbackCount:0,materialIndex:mesh.userData.naturalSurfaceCliffSlot??null};
  }},
  FacetedNaturalSurfaceShellReduction:{suppressMesh(mesh){calls.shell++;mesh.userData.noOutline=true;}},
  BorderTerrain:{buildZoneBorderTerrain(scene,cols,rows,mapId){return {scene,cols,rows,mapId};}},
  WildernessChunks:{destroyZone(mapId){return mapId;}}
};
vm.runInNewContext(source,{window,Math,Number,Object,Array,Map,WeakSet,Error,String});
const api=window.NorthernCliffsPlateauBackdrop;
assert(api?.installed);
assert.equal(api.constants.HEIGHT_RATIO,1.05,'the same plateau is 50% taller than its previous 0.70 peak ratio');
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
assert(Array.isArray(mesh.material)&&mesh.material.length===2,'ridge isolator must retain two material slots');
assert.strictEqual(mesh.material[0],mesh.material[1],'both slots share one backdrop-owned clone, not extra GPU materials');
assert.notStrictEqual(mesh.material[0],canonicalFarmRock,'backdrop depth shader cannot mutate the farm rock cache');
assert.equal(mesh.material[0].map,'carved_smooth.png');
assert.equal(mesh.material[0].userData.northernCliffsDistantPlateau,true);
assert.equal(mesh.material[0].userData.naturalSurface,'rocks');
assert.equal(mesh.material[0].fog,true,'both top and cliff slot must use the zone fog, not bypass it');
const fogShader = { uniforms:{}, vertexShader:'void main() {\n#include <fog_vertex>\n}', fragmentShader:'' }; // Compiles the real plateau fog adapter against a minimal fog-enabled Three shader.
mesh.material[0].onBeforeCompile(fogShader);
assert.match(fogShader.vertexShader,/vFogDepth = min\(vFogDepth, 24\.0\) \+ max\(0\.0, vFogDepth - 24\.0\) \* 0\.22;/,'normal nearby fog must remain unchanged before far-plateau distance compression begins');
assert.match(fogShader.vertexShader,/#ifdef USE_FOG/,'fog distance compression applies only to fog-enabled scenes');
const fogDepth = depth => Math.min(depth, layout.fogNearDistance) + Math.max(0, depth - layout.fogNearDistance) * layout.fogDistanceScale; // Mirrors the shader's near/far piecewise fog distance at the transition.
assert.equal(fogDepth(0),0,'camera-adjacent points must not receive artificial minimum fog');
assert.equal(fogDepth(12),12,'ordinary scene fog must be preserved inside the near 24-unit range');
assert.equal(fogDepth(24),24,'the near/far distance transition must be continuous');
assert(Math.abs(fogDepth(100)-40.72)<1e-9,'past the transition, distant fog keeps growing at the backdrop scale');
assert.match(mesh.material[0].customProgramCacheKey(),/northern-plateau-scene-fog-v2/,'fog shader program must not reuse the old unfogged skyline variant');
assert.equal(layout.materialSlotCount,2);
assert.equal(layout.cliffMaterialSlot,1);
assert.equal(mesh.geometry.groups.length,2,'keep the top and side material groups');
assert.equal(mesh.geometry.userData.hobunjiSurfaceStretch.materialIndex,1,'flat cap UVs must survive cliff-only mapping');
assert.equal(mesh.userData.naturalSurfaceUvOwner,'HobunjiSurfaceStretchUV');
assert.equal(layout.detectedSurfaceIslands,2);
assert.equal(layout.uvFallbackIslands,0);
assert.equal(layout.sourceShape,'TerrainGeometry.buildRockTileGeo:stoneGeo');
assert.equal(mesh.raycast(),undefined,'scenery must never catch game tool rays');
assert.equal(mesh.castShadow,false);
assert.equal(mesh.frustumCulled,false,'existing distant-scenery view culler owns camera/offscreen visibility');
assert.equal(mesh.userData.nonTraversable,true);
assert.equal(mesh.userData.noOutline,true);
assert.equal(layout.topWorldY,layout.referencePeakWorldY*1.05);
assert.equal(layout.fogEnabled,true,'the Northern Cliffs plateau must participate in zone scene fog');
assert.equal(layout.fogNearDistance,24,'the ordinary distant cliff border keeps its native fog distance');
assert.equal(layout.fogDistanceScale,0.22,'beyond-far-plane backdrop uses bounded fog distance compression');
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
assert(layout.flatCapTriangles>=1,'flattening must create an actual horizontal plateau triangle, not just high vertices');
const ridgeThreshold=1/Math.sqrt(1+0.194); // Matches NaturalSurfaceCliffRidgeIsolation's production top-vs-side normal threshold.
const position=mesh.geometry.getAttribute('position'); // Inspect the actual transformed triangle winding, not only the heights.
let upwardCapTriangles=0,steepCliffTriangles=0; // The ridge split depends on having both upward top and sloped side faces.
for(let i=0;i+2<position.count;i+=3){
  const a=[position.getX(i),position.getY(i),position.getZ(i)];
  const b=[position.getX(i+1),position.getY(i+1),position.getZ(i+1)];
  const c=[position.getX(i+2),position.getY(i+2),position.getZ(i+2)];
  const ab=b.map((value,j)=>value-a[j]),ac=c.map((value,j)=>value-a[j]);
  const nx=ab[1]*ac[2]-ab[2]*ac[1],ny=ab[2]*ac[0]-ab[0]*ac[2],nz=ab[0]*ac[1]-ab[1]*ac[0];
  const len=Math.hypot(nx,ny,nz);
  if(!(len>1e-9))continue;
  const normalY=ny/len;
  if(a[1]===layout.topWorldY&&b[1]===layout.topWorldY&&c[1]===layout.topWorldY){
    assert(normalY>0.99,'the horizontal cap must face upward: negative Y normals break the ridge-surface detector');
    upwardCapTriangles++;
  }
  if(normalY<ridgeThreshold)steepCliffTriangles++;
}
assert(upwardCapTriangles>=1,'the rock must contain at least one upward-facing cap triangle');
assert(steepCliffTriangles>=1,'the rock must contain visibly distinct steep side triangles for the ridge isolator');
assert.equal(api.getDebugState().clearOfPlayableMap,true);
assert.strictEqual(api.attach(scene,200,200),root,'duplicate attach must not create second rock');
assert.equal(sources.length,18,'duplicate attach must not rebuild');
window.WildernessChunks.destroyZone('map_northern_cliffs');
assert.equal(scene.children.length,0,'zone destruction removes rock');
assert.equal(scene.items.length,0,'zone destruction removes scene-item ownership');
assert(mesh.geometry.disposed&&mesh.material[0].disposed,'zone destruction disposes the owned cliff material and geometry');
assert.equal(canonicalFarmRock.disposed,false,'zone destruction must never dispose shared farm rock materials');
assert.equal(api.getDebugState().attached,false);
splitRidge=false; // The same renderer must also work when no ridge-material split was necessary.
window.BorderTerrain.buildZoneBorderTerrain(scene,200,200,'map_northern_cliffs');
assert.equal(scene.children.length,1,'re-entering zone rebuilds just one rock');
const single=scene.children[0].children[0]; // Exercises the no-ridge fallback after the grouped-cliff path.
assert.equal(Array.isArray(single.material),false,'unsplit rock retains the normal single material contract');
assert.equal(single.material.userData.northernCliffsDistantPlateau,true);
assert.equal(single.material.fog,true,'the unsplit farm-rock material fallback also gets scene fog');
assert.equal(api.getDebugState().lastLayout.materialSlotCount,1);
assert.equal(api.getDebugState().lastLayout.cliffMaterialSlot,null);
window.WildernessChunks.destroyZone('map_northern_cliffs');
assert(single.material.disposed,'single-material backdrop must clean up too');
assert.equal(canonicalFarmRock.disposed,false,'shared farm rock material must survive both teardown paths');
// Build again from the actual production rock generator, not just our fixture:
// its winding and deterministic seed must produce a flat, upward-facing crown
// plus side triangles after the backdrop's gigantic X/Z scaling.
const terrainSource=fs.readFileSync('docs/js/terrain-geometry.js','utf8'); // Original generator used for real wilderness loose rocks.
const rockStart=terrainSource.indexOf('  function buildRockTileGeo(col, row) {');
const rockEnd=terrainSource.indexOf('  function buildTerrainTileGeo(',rockStart);
assert(rockStart>=0&&rockEnd>rockStart,'production loose-rock generator must remain discoverable for the regression');
const originalRockBuilder=new Function('THREE',terrainSource.slice(rockStart,rockEnd)+'\nreturn buildRockTileGeo;')(THREE); // Runs the real generator with the same minimal THREE buffer shim.
window.TerrainGeometry.buildRockTileGeo=originalRockBuilder;
splitRidge=true;
window.BorderTerrain.buildZoneBorderTerrain(scene,200,200,'map_northern_cliffs');
const realMesh=api.getActiveRoot()?.children[0],realLayout=api.getDebugState().lastLayout; // Inspects the actual chosen rock seed after the complete backdrop transform.
assert(realMesh&&realLayout,'production loose-rock source must build the full northern backdrop');
const actualPositions=realMesh.geometry.getAttribute('position'); // Counts true upward triangles from source index winding, not fixture assumptions.
let actualCap=0,actualSteep=0; // Both groups are necessary for the real ridge-isolation pipeline.
for(let i=0;i+2<actualPositions.count;i+=3){
  const a=[actualPositions.getX(i),actualPositions.getY(i),actualPositions.getZ(i)];
  const b=[actualPositions.getX(i+1),actualPositions.getY(i+1),actualPositions.getZ(i+1)];
  const c=[actualPositions.getX(i+2),actualPositions.getY(i+2),actualPositions.getZ(i+2)];
  const ab=b.map((x,j)=>x-a[j]),ac=c.map((x,j)=>x-a[j]);
  const nx=ab[1]*ac[2]-ab[2]*ac[1],ny=ab[2]*ac[0]-ab[0]*ac[2],nz=ab[0]*ac[1]-ab[1]*ac[0],len=Math.hypot(nx,ny,nz);
  if(len<=1e-9)continue;
  const normalY=ny/len;
  if(a[1]===realLayout.topWorldY&&b[1]===realLayout.topWorldY&&c[1]===realLayout.topWorldY){
    assert(normalY>0.99,'the actual loose rock crown must face up after world-space transform');
    actualCap++;
  }else if(normalY<ridgeThreshold)actualSteep++;
}
assert(actualCap>0&&actualSteep>0,'the actual loose rock must contain both a flat tabletop and distinct steep cliff faces');
assert.equal(realLayout.flatCapTriangles,actualCap,'debug cap count must match the real generator geometry');
assert.equal(realLayout.sourceShape,'TerrainGeometry.buildRockTileGeo:stoneGeo');
window.WildernessChunks.destroyZone('map_northern_cliffs');
console.log('PASS Northern Cliffs 50%-taller fogged plateau: two-slot ridge, scene fog shader, cliff-only UVs, farm material ownership, single-slot fallback, culling, clearance, lifecycle, actual rock seed.');
