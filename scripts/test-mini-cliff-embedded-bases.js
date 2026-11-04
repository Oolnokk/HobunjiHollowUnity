#!/usr/bin/env node
'use strict';

// The upside-down mini-plateau's lower tile footprint is physically EMBEDDED
// inside its higher parent plateau. It is authored visually, never walkable.
const assert=require('node:assert/strict');
const routes=require('../docs/js/cliff-route-network.js');
const elevated=require('../docs/js/cliff-elevated-surfaces.js');
const cubic=require('../docs/js/cell-grid-3d.js'); // Actual dungeon support footprint API; underside must not be registered.

function buildGrid(rows=28, upperThird=false) {
  return Array.from({length:rows},()=>Array.from({length:upperThird?19:14},(_,col)=>({
    type:col===6||(upperThird&&col===12)?'rock':'grass',
    incline:col===6||(upperThird&&col===12),
    elevTier:col<6?0:col<12?1:2,
  })));
}
const tileY=t=>(t?.elevTier||0)*3;
const build=grid=>routes.build(grid,{
  area:'mini-cliff-underside-test',tileY,
  blocked:tile=>!tile||tile.incline||tile.type==='rock',
});
const layouts=[build(buildGrid()),build(buildGrid(28,true))];
assert(layouts.every(net=>net.balconies.length>0),'test maps generate intermediate mini-plateaus');
for(const net of layouts) {
  assert(net.verification.ok,'all route links and inset lower footprints must pass validation');
  assert.equal(net.verification.invalidEmbeddedBases.length,0);
  for(const shelf of net.balconies) {
    const lower=shelf.base;
    const route=net.routes[shelf.routeId];
    assert(lower&&lower.footprint.length>0,'separate lower footprint exists');
    assert(lower.y<shelf.y,'underside base elevation is below walkable top');
    assert.notDeepEqual(lower.footprint.map(t=>[t.c,t.r]),shelf.footprint.map(t=>[t.c,t.r]),
      'base is independently authored rather than recycling the top footprint');
    for(const cell of lower.footprint) {
      assert.equal(routes.componentAt(net,cell.c,cell.r),route.bComp,
        'every lower footprint tile belongs to the higher parent plateau');
      assert(cell.elevation < tileY(net.grid[cell.r][cell.c]),
        'lower footprint sits below the real parent plateau surface');
      assert(cell.elevation <= lower.y+0.001,'individual base tile elevation remains a first-class geometric value');
    }
    assert(lower.x>=Math.min(...lower.footprint.map(c=>c.c))&&
      lower.x<=Math.max(...lower.footprint.map(c=>c.c+1)),
      'lower profile centroid lies within parent-owned tiles');
  }
}

// Tiny THREE stand-in records the exact final triangle positions. It does
// not simulate rasterization, only the renderer's authored geometry contract.
class Geometry {
  constructor(){this.attrs={};}
  setAttribute(k,v){this.attrs[k]=v;}
  getAttribute(k){return this.attrs[k];}
  computeVertexNormals(){}
  computeBoundingSphere(){}
}
class Attribute { constructor(array,itemSize){this.array=Float32Array.from(array);this.itemSize=itemSize;} }
class Mesh {
  constructor(geometry,material){this.geometry=geometry;this.material=material;this.userData={};this.isMesh=true;}
}
class Matrix4 {
  constructor(){this.hidden=false;}
  makeScale(x,y,z){this.hidden=x===0&&y===0&&z===0;return this;}
  clone(){const m=new Matrix4();m.hidden=this.hidden;return m;}
}
class Object3D {
  constructor(){this.position={set(){}};this.scale={set(){}};this.rotation={y:0};this.matrix=new Matrix4();}
  updateMatrix(){}
}
class InstancedMesh extends Mesh {
  constructor(geo,mat,count){super(geo,mat);this.count=count;this.instanceMatrix={setUsage(){},needsUpdate:false};}
  setMatrixAt(){}
  computeBoundingSphere(){}
}
const THREE={
  BufferGeometry:Geometry,Float32BufferAttribute:Attribute,Mesh,
  MeshBasicMaterial:class{},MeshStandardMaterial:class{},
  BoxGeometry:class{},DodecahedronGeometry:class{},
  Matrix4,Object3D,InstancedMesh,DoubleSide:2,DynamicDrawUsage:1,
  TextureLoader:class{load(){return {};}},
};
const net=layouts[1],scene={objects:[],add(mesh){this.objects.push(mesh);}};
const meshes=routes.render(THREE,scene,net);
const rock=meshes.find(m=>m.userData?.cliffGenerated);
assert(rock,'a single merged rock shell replaces every old flat box top');
assert.equal(meshes.filter(m=>m.userData?.cliffGenerated).length,1,'no per-mini-cliff draw-call growth');
assert(rock.userData.hobunjiGroundSurface&&rock.userData.cameraObstacle,
  'the composite keeps top-surface camera and occlusion tags');
const coordinates=rock.geometry.getAttribute('position').array;
const TRIANGLES_PER_SHELF=40; // Top fan (8) + two vertically blended side bands (2*8*2).
const FLOATS_PER_SHELF=TRIANGLES_PER_SHELF*3*3;
assert.equal(coordinates.length,net.balconies.length*FLOATS_PER_SHELF,
  'every mini-plateau is tessellated as one top and an embedded tapered underside');
for(let i=0;i<net.balconies.length;i++) {
  const shelf=net.balconies[i],base=shelf.base;
  const buf=coordinates.subarray(i*FLOATS_PER_SHELF,(i+1)*FLOATS_PER_SHELF);
  const verts=[];
  for(let j=0;j<buf.length;j+=3)verts.push({x:buf[j],y:buf[j+1],z:buf[j+2]});
  const bottom=verts.filter(v=>Math.abs(v.y-base.y)<0.001);
  const top=verts.filter(v=>Math.abs(v.y-shelf.y)<0.001);
  assert(bottom.length>0&&top.length>0,'both elevations appear in the actual render geometry');
  assert(verts.every(v=>v.y<=shelf.y+0.001&&v.y>=base.y-0.001),'taper lies between top and embedded base');
  for(const v of bottom)assert(base.footprint.some(t=>
    v.x>=t.c-0.001&&v.x<=t.c+1.001&&v.z>=t.r-0.001&&v.z<=t.r+1.001),
    'ALL underside base vertices remain inside the parent plateau footprint');
}
const registeredRectangles=net.balconies.reduce((sum,shelf)=>
  sum+elevated.groupedRectangles(shelf.footprint).length,0);
const notRegistered=net.balconies.reduce((sum,shelf)=>
  sum+elevated.groupedRectangles(shelf.base.footprint).length,0);
assert(registeredRectangles>0&&notRegistered>0,'both independently authored tile profiles exist');
assert(!rock.userData.walkableBase,'visual underside does not advertise an additional walkable deck');
const registered=[]; // Captures only top footprints sent to the shared gameplay support registry.
const dynamic={
  registerSurface(record){registered.push(record);},
  sampleSupport(){return null;},
  clearScope(scope){for(let i=registered.length-1;i>=0;i--)if(registered[i].scope===scope)registered.splice(i,1);},
};
const mounted=elevated.mount(net,{DynamicSurfaces:dynamic,CellGrid3D:cubic});
assert(mounted.ok, mounted.reason);
assert.equal(mounted.supportCount,registeredRectangles,
  'base footprint introduces no additional gameplay collision rectangles');
assert(registered.every(r=>r.shelfId&&r.topY===net.balconies.find(s=>s.id===r.shelfId)?.y),
  'all registered surfaces are authored TOP elevations, never underside base elevations');
assert(elevated.clear(net.area),'cleanup releases only registered top surfaces');
assert.equal(registered.length,0,'no lower surface registration survives unloading');
console.log('PASS visual-only inverted mini-plateaus: separate top/base tiles, parent embedding, tapered mesh and top-only collision');
