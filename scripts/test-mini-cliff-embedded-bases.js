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
const tileY=t=>(t?.elevTier||0)*9; // Taller test faces accommodate the doubled embedded underside.
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
    assert(shelf.y-lower.y>=2.70-0.001,'minimum internal height is doubled from 1.35 to 2.70');
    assert.equal(shelf.overhangDepths.length,3,'overhang varies along three points on one cap');
    assert.equal(new Set(shelf.overhangDepths).size,3,'each cap mixes three distinct depths');
    assert(Math.abs(Math.max(...shelf.overhangDepths)-shelf.depth)<0.001,'max projection extends the previous cap by one tile');
    assert(Math.abs(Math.min(...shelf.overhangDepths)-(shelf.depth-1))<0.001,'min projection keeps the previous reach');
    for(const u of [-0.9,0,0.9]){
      const i=u<0?0:1,t=u<0?u+1:u;
      const depth=shelf.overhangDepths[i]+(shelf.overhangDepths[i+1]-shelf.overhangDepths[i])*t;
      const along=u*shelf.width/2,edge=-shelf.depth/2+depth;
      const at=d=>({x:shelf.x+shelf.tangent.x*along+shelf.normal.x*d,z:shelf.z+shelf.tangent.z*along+shelf.normal.z*d});
      const inside=at(edge-0.06),outside=at(edge+0.06);
      assert(routes.shelfContains(shelf,inside.x,inside.z),'inside profile is supported');
      assert(!routes.shelfContains(shelf,outside.x,outside.z),'outside profile has no phantom collision');
    }
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
  addGroup(start,count,materialIndex){(this.groups??=[]).push({start,count,materialIndex});}
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
const TOP_FLOATS_PER_SHELF=8*3*3, ROCK_FLOATS_PER_SHELF=32*3*3; // One top fan + four triangles per perimeter edge.
assert.equal(coordinates.length,net.balconies.length*(TOP_FLOATS_PER_SHELF+ROCK_FLOATS_PER_SHELF),
  'every mini-plateau is tessellated as one top and an embedded tapered underside');
assert.equal(rock.material.length,2,'mini-cliff mesh has independently selectable top and rock materials');
assert.equal(rock.geometry.groups.length,2,'one batch each for grass cap and rocky shell');
assert.equal(rock.geometry.groups[0].count,net.balconies.length*TOP_FLOATS_PER_SHELF/3,
  'grass material covers all upward-facing cap triangles');
assert.equal(rock.geometry.groups[1].count,net.balconies.length*ROCK_FLOATS_PER_SHELF/3,
  'rock material covers all vertical and sloping rock triangles');
for(let i=0;i<net.balconies.length;i++) {
  const shelf=net.balconies[i],base=shelf.base;
  const topStart=i*TOP_FLOATS_PER_SHELF;
  const rockStart=net.balconies.length*TOP_FLOATS_PER_SHELF+i*ROCK_FLOATS_PER_SHELF;
  const buf=[...coordinates.subarray(topStart,topStart+TOP_FLOATS_PER_SHELF),
    ...coordinates.subarray(rockStart,rockStart+ROCK_FLOATS_PER_SHELF)];
  const verts=[];
  for(let j=0;j<buf.length;j+=3)verts.push({x:buf[j],y:buf[j+1],z:buf[j+2]});
  const bottom=verts.filter(v=>Math.abs(v.y-base.y)<0.001);
  const top=verts.filter(v=>Math.abs(v.y-shelf.y)<0.001);
  assert(bottom.length>0&&top.length>0,'both elevations appear in the actual render geometry');
  for (const axis of ['x', 'z']) {
    const span = points => Math.max(...points.map(v => v[axis])) - Math.min(...points.map(v => v[axis]));
    assert(span(top) > span(bottom), 'the rock shell tapers inward on both axes');
  }
  const route = net.routes[shelf.routeId];
  const landing = route.nodes[shelf.nodeId], approach = route.nodes[landing.links[0]];
  assert(!routes.shelfContains(shelf, approach.x, approach.z) && routes.shelfContains(shelf, landing.x, landing.z),
    'the climb joins the cap from the side');
  assert.equal(approach.y, landing.y, 'the transfer reaches across at cap height');

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
