#!/usr/bin/env node
'use strict';
// Regression suite for octagonal shared-room shafts, wide-grid 2D layers,
// and the ordinary walkable hallway replacing the old shaft teleport.
const assert=require('assert');
const fs=require('fs');
const G=require('../docs/js/cell-grid-3d.js');
const H=require('../docs/js/shaft-hub.js');
const Plan=require('../docs/js/ruin-layer-plan.js');
const Corridor=require('../docs/js/ruin-shaft-corridor.js');
const Connector=require('../docs/js/ruin-shaft-connector.js');

const runtime=fs.readFileSync('docs/js/dev-random-ruin-interior-map.js','utf8');
const index=fs.readFileSync('docs/index.html','utf8');
assert(runtime.includes('attachShaftHub(rec,candidateSeed);'),'every generated ruin retains a shaft');
assert(runtime.includes('attachShaftHub(rec,0);'),'story vault retains the shaft');
assert(runtime.includes('window.RuinShaftConnector'),'runtime must use physical hallway module');
assert(!runtime.includes("passage('Enter Shaft Hub'"),'no gameplay teleporter into the shaft');
assert(!runtime.includes("passage('Return to Ruin'"),'no gameplay teleporter out of the shaft');
for(const file of ['ruin-layer-plan.js','ruin-shaft-corridor.js','ruin-shaft-connector.js'])
  assert(index.includes(file),'game page must load '+file);

// Every floor is an independent ordinary 2D plan, with one shared, grid-snapped,
// wide octagonal anchor, 1..4 wings, multiple challenges and one brazier per wing.
let plannedWings=0;
for(let seed=1;seed<=1000;seed++){
  const plan=Plan.compose({seed});
  assert(plan.ok,'planner seed '+seed+' '+plan.checks.filter(c=>!c.ok).map(c=>c.name).join(','));
  assert(plan.floorCount>=3&&plan.floorCount<=5);
  assert.equal(plan.floors.length,plan.floorCount);
  assert.equal(plan.shaft.shape,'octagon');
  for(const floor of plan.floors){
    assert.deepEqual(floor.anchor,plan.shaft.anchor,'shaft position shared across all 2D floors');
    assert(floor.wings.length>=1&&floor.wings.length<=4);
    assert.equal(floor.wings.length,floor.braziers.length);
    for(const wing of floor.wings){
      plannedWings++;
      assert(wing.rooms.filter(r=>!!r.challenge).length>=2,'multiple challenge rooms before brazier');
      assert.equal(wing.rooms.filter(r=>r.kind==='brazier-chamber').length,1,'exactly one brazier endpoint');
      assert.equal(wing.corridors.length,wing.rooms.length,'hallway per progression stage');
      assert(wing.corridors.every(h=>h.length>0&&h.rects.length>=1),'variable-length halls must have footprint');
    }
  }
}

// Real multi-level room: outer eight-sided shell, accessible upper-floor galleries,
// exposed climb surfaces, and true physical ground entrance (no room teleport).
for(const floors of [3,4,5]) for(const seed of [1,2,3,5,8,13,21,34]){
  const r=H.compose({seed,floors,shaft:33,wall:8,chambers:false,entranceSide:'W'});
  assert(r.ok,'hub '+floors+' floors seed '+seed+': '+JSON.stringify(r.checks.filter(c=>!c.ok)));
  assert.equal(r.options.octagon,true);
  assert.equal(r.stories.length,floors);
  assert.equal(r.cols,49);
  assert.equal(r.entrance.side,'W');
  assert(!r.grid.isSolid(0,0,1),'octagon must visibly clip the square shell corners');
  assert(r.grid.isSolid(0,Math.floor(r.rows/2),2),'the wall remains solid above the ground entrance');
  assert.equal(r.balconies.length,floors-1);
  const reach=H.reachable(r);
  for(const story of r.stories.slice(1)){
    assert(story.gallery.length>100,'an upper story has a substantial octagonal ring');
    assert(story.gallery.every(c=>reach.has(c.col,c.row,story.level)),
      'all open gallery cells must be physically reachable');
  }
  for(const door of r.doors)assert(reach.has(door.col,door.row,door.level),'upper floor tunnel reachable');
}
{
  const r=H.compose({floors:9,shaft:4,spacing:1});
  assert(r.ok);
  assert.equal(r.options.floors,5);assert(r.options.shaft>=17);
  assert(r.options.spacing>=3);
}
{
  const r=H.compose({floors:4,wall:8,chambers:false,entranceSide:'W'});
  const count=r.grid.standingSurfaces({clearance:2}).length;
  const records=[];
  const DS={registerSurface:d=>records.push(d),clearScope(){}};
  const mount=H.mount(r,{DynamicSurfaces:DS,scope:'test-octagonal-supports'});
  assert(mount.floors>20&&mount.floors<count*.1,
    'coalesced support surfaces must avoid thousands of per-cell records: '+count+' => '+mount.floors);
  assert(records.every(d=>d.topY<r.grid.levelToY(r.levels-1)),'no roof-top phantom support');
  assert(records.some(d=>d.topY===12),'upper level registered');
  H.unmount({scope:'test-octagonal-supports'});
}

// Four possible original entrance sides physically connect to the west shaft mouth.
// The new 2D corridor is made of real cells, with support rectangles covering them.
for(const start of [{x:20,z:1},{x:1,z:25},{x:100,z:30},{x:32,z:100}]){
  const args={start,end:{x:130,z:65},width:3,maxX:185,maxZ:145,
    mainBounds:{minX:2,minZ:2,maxX:100,maxZ:100},
    shaftBounds:{minX:130,minZ:40,maxX:179,maxZ:89}};
  const path=Corridor.route(args);
  assert(path.ok,'hallway approach from '+JSON.stringify(start)+' '+path.reason);
  assert(path.length>0&&path.path.length>0);
  const regions=Corridor.rectangles(path.tiles);
  assert(regions.length<path.tiles.length*.5,'merge hallway support boxes');
  for(const [x,z] of path.tiles)
    assert(regions.some(r=>x>=r.minC&&x<=r.maxC&&z>=r.minR&&z<=r.maxR),
      'every route tile has a broad collision/support rectangle');
}

// Real connector wiring using lightweight Three/occupancy doubles.
// No real browser is required to prove the returned floor tiles meet both ends.
class Group {
  constructor(){this.children=[];this.parent=null}
  add(node){this.children.push(node);node.parent=this}
  remove(node){this.children=this.children.filter(n=>n!==node);node.parent=null}
  traverse(fn){fn(this);for(const n of this.children)n.traverse?n.traverse(fn):fn(n)}
}
class Matrix4 {makeTranslation(x,y,z){this.xyz=[x,y,z];return this}}
class Geometry {rotateX(){return this}dispose(){}}
class Material {clone(){return new Material()}dispose(){}}
class InstancedMesh {
  constructor(geometry,material,count){this.geometry=geometry;this.material=material;this.count=count;this.instances=[]}
  setMatrixAt(i,matrix){this.instances[i]=matrix.xyz}
}
const THREE={Group,BoxGeometry:Geometry,PlaneGeometry:Geometry,Matrix4,
  MeshBasicMaterial:Material,InstancedMesh,FrontSide:0};
for(const side of ['north','east','south','west']){
  const isX=side==='west'||side==='east';
  const meta={cellSize:.5,worldWidth:54,worldDepth:49,
    entrance:{side,axis:isX?'x':'z',
      boundary:side==='west'||side==='north'?0:(side==='east'?108:98),
      center:isX?48:50}};
  const makeTile=walkable=>({type:walkable?'grass':'rock'});
  const rec={cols:150,rows:140,grid:Array.from({length:140},()=>Array.from({length:150},()=>makeTile(false))),
    floorSet:new Set(),mapData:{id:'map_i_dev_random_ruin',floor:[]},scene:new Group()};
  const ruin={localeRoot:new Group(),occupancy:{},mechanisms:new Map(),transitDoors:[],activators:[],pushBlocks:[]};
  const DS={registerSurface(){},clearScope(){}};
  const climb={registerGrid:()=>3,clearScope(){}};
  const dev={registerShaftGrid(){},unregisterShaftGrid(){}};
  const occupancy={create(config){return {cols:config.cols,rows:config.rows,getPosition:config.getPlayerPosition}}};
  const connected=Connector.connect({rec,ruin,seed:23,meta,THREE,makeTile,DynamicSurfaces:DS,
    ShaftHub:H,ClimbSurfaces:climb,DevRandomRuin:dev,TileOccupancy:occupancy,
    RuinLayerPlan:Plan,RuinShaftCorridor:Corridor,getPlayerPosition:()=>({x:5,z:7})});
  assert(connected.hub.ok,'integrated octagonal room passed reachability');
  assert(ruin.shaftConnection.physical,'the normal ruin entrance is a real corridor');
  assert.equal(ruin.shaftConnection.floorCount,connected.plan.floorCount);
  assert(ruin.shaftConnection.supportRects<100,'hallway support surfaces merged');
  assert.deepEqual(ruin.occupancy.getPosition(),{x:5,z:7},'occupancy must reuse injected player adapter');
  for(const p of [connected.route.path[0],connected.route.path.at(-1)])
    assert(rec.floorSet.has(p.x+','+p.z),'both path endpoints are actual walkable tiles');
  assert(rec.mapData.floor.some(([c,r])=>c===connected.route.path.at(-1).x&&r===connected.route.path.at(-1).z));
  ruin.shaftConnectorCleanup();
}
// The special story vault has no V50 `meta.entrance`: its authored southern
// doorway at (6,27) must still lead to the shared room on ordinary floor tiles.
{
  const makeTile=walkable=>({type:walkable?'grass':'rock'});
  const floorSet=new Set();
  for(let r=13;r<=27;r++)for(let c=5;c<=7;c++)floorSet.add(c+','+r);
  for(let r=3;r<=12;r++)for(let c=2;c<=10;c++)floorSet.add(c+','+r);
  const rec={cols:13,rows:30,
    grid:Array.from({length:30},(_,r)=>Array.from({length:13},(_,c)=>makeTile(floorSet.has(c+','+r)))),
    floorSet,mapData:{id:'map_i_dev_random_ruin',floor:[...floorSet].map(k=>k.split(',').map(Number))},
    exits:[{tiles:[[6,27]]}],scene:new Group()};
  const ruin={storyVault:true,localeRoot:new Group(),mechanisms:new Map(),
    transitDoors:[],activators:[],pushBlocks:[]};
  const ds={registerSurface(){},clearScope(){}};
  const climb={registerGrid:()=>3,clearScope(){}};
  const dev={registerShaftGrid(){},unregisterShaftGrid(){}};
  const placed=Connector.connect({rec,ruin,seed:0,meta:{rooms:[{name:'vault'}]},
    THREE,makeTile,DynamicSurfaces:ds,ShaftHub:H,ClimbSurfaces:climb,
    DevRandomRuin:dev,RuinLayerPlan:Plan,RuinShaftCorridor:Corridor});
  assert(placed.route.ok&&placed.route.path[0].x===6&&placed.route.path[0].z===28,
    'fixed story vault extends physically through its actual southern doorway');
  assert(rec.floorSet.has('6,28')&&ruin.shaftConnection.physical);
  ruin.shaftConnectorCleanup();
}
console.log('ok test-shaft-hub: 1000 layered layouts, '+plannedWings+' planned wings, 3–5 story octagons, four physical hallway approaches');
