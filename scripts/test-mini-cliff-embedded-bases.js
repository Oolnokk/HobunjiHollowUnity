#!/usr/bin/env node
'use strict';

// Original miniature plateaus grow inside a taller parent cliff from actual
// ground level; the same grass cap is displaced 1-3 tiles into open space.
// Only the displaced cap is a gameplay support; the rock body is visual.
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
const medium=routes.build(buildGrid(28,true),{area:'mini-cliff-medium-height',
  tileY:t=>(t?.elevTier||0)*4,blocked:tile=>!tile||tile.incline||tile.type==='rock'});
assert(medium.balconies.length>0,'intermediate ledges work on four-unit neighboring cliffs');
assert(medium.verification.ok,'medium height routes and moved caps remain climbable');
assert(layouts.every(net=>net.balconies.length>0),'both layouts grow embedded miniature plateaus');
let exposedCaps=0; // Count newly exposed top cells, as opposed to simply overlapping the higher parent.
const observedProjections=new Set(); // Ensure projection distance is authored as a real whole-tile displacement.
for(const net of layouts) {
  assert(net.verification.ok,'route links and the original plateau footprints must pass validation');
  assert.equal(net.verification.invalidEmbeddedBases.length,0);
  for(const shelf of net.balconies) {
    const base=shelf.base,route=net.routes[shelf.routeId];
    assert(base?.footprint.length>0,'original base must overlap real higher-parent cells');
    assert(base.y < shelf.y,'rocky body begins below the intermediate cap');
    assert.equal(base.y,0,'the original miniature plateau is rooted at the true zone ground, not an embedded raised tile');
    assert(shelf.y > base.neighborY+2.7-0.001 && shelf.y<tileY(net.grid[route.b.r][route.b.c]),
      'mini-plateau elevation lies strictly between neighboring and parent plateau heights');
    assert(Number.isInteger(shelf.projectionTiles) && shelf.projectionTiles>=1 && shelf.projectionTiles<=3,
      'original plateau lid moves out by 1-3 whole tiles');
    observedProjections.add(shelf.projectionTiles);
    assert.equal(base.projectionTiles,shelf.projectionTiles,'body and cap agree on translation');
    assert(base.parentCoverage>=0.54 && base.embeddedCoverage>=0.72,
      'most of the original plateau is actually buried in parent rock geometry');
    assert(base.boundaryCells.length>0,'body shares actual unwalkable stone boundary tiles with its parent');
    for(const cell of base.footprint) {
      assert.equal(routes.componentAt(net,cell.c,cell.r),route.bComp,
        'the nested original plateau belongs to its owning higher plateau');
      assert(cell.elevation<tileY(net.grid[cell.r][cell.c]),'ground-rooted body remains below the parent surface');
    }
    const cells=new Set(shelf.footprint.map(cell=>cell.c+','+cell.r));
    for(let x=Math.max(0,shelf.x-shelf.width/2-2);x<Math.min(net.cols,shelf.x+shelf.width/2+2);x+=0.10)
      for(let z=Math.max(0,shelf.z-shelf.width/2-2);z<Math.min(net.rows,shelf.z+shelf.width/2+2);z+=0.10)
        if(routes.shelfContains(shelf,x,z))
          assert(cells.has(Math.floor(x)+','+Math.floor(z)),
            'every curved cap fragment is inside its exact registered tile footprint');
    if(shelf.footprint.some(cell=>routes.componentAt(net,cell.c,cell.r)!==route.bComp))
      exposedCaps++;
    const landing=route.nodes[shelf.nodeId],approach=route.nodes[landing.links[0]];
    assert(!routes.shelfContains(shelf,approach.x,approach.z)&&routes.shelfContains(shelf,landing.x,landing.z),
      'the climber transfers from the wall onto an exposed top');
    assert.equal(approach.y,landing.y,'transfer occurs at the cap elevation');
  }
}
assert(exposedCaps>0,'translated grass caps expose previously unavailable ground tiles');
assert(observedProjections.size>0,'mini-plateau generation recorded its displacement');

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
const grassTopMaterial={name:'plateau-grass'}, stoneSideMaterial={name:'cliff-rock'}; // Verifies the same separate material slots used by zone-plateau-mesa.
const meshes=routes.render(THREE,scene,net,stoneSideMaterial,grassTopMaterial);
const rock=meshes.find(m=>m.userData?.cliffGenerated);
assert(rock,'a single merged rock shell replaces every old flat box top');
assert.equal(meshes.filter(m=>m.userData?.cliffGenerated).length,1,'no per-mini-cliff draw-call growth');
assert(rock.userData.hobunjiGroundSurface&&rock.userData.cameraObstacle,
  'the composite keeps top-surface camera and occlusion tags');
const coordinates=rock.geometry.getAttribute('position').array;
const TOP_FLOATS_PER_SHELF=8*3*3,ROCK_FLOATS_PER_SHELF=32*3*3; // One eight-triangle cap and four rock triangles per outline edge.
assert.equal(coordinates.length,net.balconies.length*(TOP_FLOATS_PER_SHELF+ROCK_FLOATS_PER_SHELF),
  'batched plateau bodies use fixed-size top and ground-rooted sidewall rings');
assert.equal(rock.material.length,2,'same plateau lid and cliffside material groups');
assert.equal(rock.material[0],grassTopMaterial,'top is the resolved plateau grass material');
assert.equal(rock.material[1],stoneSideMaterial,'the connected ground-rooted rock body uses cliff stone');
assert.equal(rock.geometry.groups.length,2,'one batched grass draw and one batched rock draw');
assert.equal(rock.geometry.groups[0].count,net.balconies.length*TOP_FLOATS_PER_SHELF/3);
assert.equal(rock.geometry.groups[1].count,net.balconies.length*ROCK_FLOATS_PER_SHELF/3);
for(let i=0;i<net.balconies.length;i++){
  const shelf=net.balconies[i],base=shelf.base;
  const topStart=i*TOP_FLOATS_PER_SHELF;
  const rockStart=net.balconies.length*TOP_FLOATS_PER_SHELF+i*ROCK_FLOATS_PER_SHELF;
  const capVerts=coordinates.subarray(topStart,topStart+TOP_FLOATS_PER_SHELF);
  const rockVerts=coordinates.subarray(rockStart,rockStart+ROCK_FLOATS_PER_SHELF);
  for(let j=0;j<8;j++){
    const k=j*9;
    const top={x:capVerts[k+6],y:capVerts[k+7],z:capVerts[k+8]}; // i-th ring vertex from the fan's third corner.
    const bottomAt=(j*4+3)*9+6; // Last sidewall triangle's third corner is the original root ring vertex.
    const bottom={x:rockVerts[bottomAt],y:rockVerts[bottomAt+1],z:rockVerts[bottomAt+2]};
    assert(Math.abs(bottom.y-base.y)<0.001,'each rocky wall actually reaches ground level');
    assert(Math.abs(top.y-shelf.y)<0.001,'all translated lid triangles share the intermediate elevation');
    assert(Math.abs(top.x-bottom.x-shelf.normal.x*shelf.projectionTiles)<0.001 &&
      Math.abs(top.z-bottom.z-shelf.normal.z*shelf.projectionTiles)<0.001,
      'the walkable top is a pure 1-3 tile translation of its original footprint');
    const ax=capVerts[k],az=capVerts[k+2],bx=capVerts[k+3],bz=capVerts[k+5],cx=capVerts[k+6],cz=capVerts[k+8];
    assert((bz-az)*(cx-ax)-(bx-ax)*(cz-az)>0.001,
      'grass top triangles retain correct upward winding on curved noodles');
  }
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
for(const shelf of net.balconies){
  assert(elevated.canStandOn(net,shelf.id,shelf.x,shelf.z,0),'registered top is walkable at its center');
  for(const u of [-0.9,0,0.9]){
    const i=u<0?0:1,t=u<0?u+1:u,along=u*shelf.width/2;
    const front=-shelf.depth/2+shelf.overhangDepths[i]+(shelf.overhangDepths[i+1]-shelf.overhangDepths[i])*t;
    const x=shelf.x+shelf.tangent.x*along+shelf.normal.x*(front+0.06);
    const z=shelf.z+shelf.tangent.z*along+shelf.normal.z*(front+0.06);
    assert(!elevated.canStandOn(net,shelf.id,x,z,0),'support registry rejects the missing part of a varied overhang');
  }
}
assert.equal(mounted.supportCount,registeredRectangles,
  'base footprint introduces no additional gameplay collision rectangles');
assert(registered.every(r=>r.shelfId&&r.topY===net.balconies.find(s=>s.id===r.shelfId)?.y),
  'all registered surfaces are authored TOP elevations, never underside base elevations');
assert(elevated.clear(net.area),'cleanup releases only registered top surfaces');
assert.equal(registered.length,0,'no lower surface registration survives unloading');
console.log('PASS ground-rooted mini-plateaus: embedded boundary, 1-3 tile translated caps, batched rock sides and top-only collision');
