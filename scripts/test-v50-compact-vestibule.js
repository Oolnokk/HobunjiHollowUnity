#!/usr/bin/env node
'use strict';
// Regression: ordinary V50 ruins enter one authored room, then a straight short
// threshold into the shaft. Hachutu retains its separate old vestibule.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Plan=require('../docs/js/ruin-layer-plan.js');
const Shaft=require('../docs/js/shaft-hub.js');
const Corridor=require('../docs/js/ruin-shaft-corridor.js');
const Connector=require('../docs/js/ruin-shaft-connector.js');
const Vestibule=require('../docs/js/ruin-v50-vestibule.js');
const orientation={north:{dx:0,dz:-1},east:{dx:1,dz:0},south:{dx:0,dz:1},west:{dx:-1,dz:0}};
let cases=0; // Number of deterministic cardinal/seed layouts whose physical threshold is checked.
for(const side of Object.keys(orientation))for(let seed=1;seed<=60;seed++){
  const axis=side==='east'||side==='west'?'x':'z';
  const boundary=side==='east'||side==='south'?24:2;
  const meta={cellSize:.5,entrance:{side,axis,boundary,center:13,roomId:'room_1'},
    rooms:[{id:'room_1',col:2,row:2,w:22,h:22}]};
  const placed=Vestibule.compose({meta,seed,LayerPlan:Plan,ShaftHub:Shaft,Connector});
  assert(placed.plan.ok,'valid single-room plan');
  assert.equal(placed.plan.options.groundEntranceSide,placed.entranceSide);
  assert(!placed.plan.floors[0].wings.some(wing=>wing.side===placed.entranceSide),'do not occupy entrance portal');
  const portal=Connector.entranceOutside(meta,{x:placed.padX,z:placed.padZ},2);
  const outward=orientation[side];
  assert.equal(portal.x+outward.dx*placed.distance,placed.mouth.x);
  assert.equal(portal.z+outward.dz*placed.distance,placed.mouth.z);
  const oldFloor=new Set(); // Synthetic unobstructed interior cells of the one V50 chamber.
  for(let c=3;c<=22;c++)for(let r=3;r<=22;r++)
    oldFloor.add((placed.padX+c)+','+(placed.padZ+r));
  const spawn=Vestibule.spawnAcrossRoom({meta,padX:placed.padX,padZ:placed.padZ,floorSet:oldFloor});
  assert(oldFloor.has(Math.floor(spawn.x)+','+Math.floor(spawn.z)),'arrival lies inside V50 room');
  assert(Math.hypot(spawn.x-portal.x,spawn.z-portal.z)>8,'arrival is across the vestibule from the shaft');
  const shell=placed.plan.options.shaftSize+2*placed.plan.options.shaftWall;
  const offset=Math.floor(shell/2),center=placed.plan.shaft.anchor;
  const route=Corridor.route({start:portal,end:placed.mouth,existing:oldFloor,
    shaftBounds:{minX:center.x-offset,minZ:center.z-offset,
      maxX:center.x+offset+1,maxZ:center.z+offset+1},
    width:3,entryClearance:3,maxX:512,maxZ:512});
  assert(route.ok,JSON.stringify({side,seed,reason:route.reason}));
  assert.equal(route.corners,0,'no dogleg hallway');
  assert(route.length<=12,'short direct approach');
  assert(route.tiles.some(([x,z])=>x===portal.x&&z===portal.z),'doorway is on the walkable route');
  cases++;
}

// The complete connector must also bridge V50's offset threshold in the same
// mounted record, not just return an abstract hallway path.
const Playable=require('../docs/js/ruin-layer-playable.js');
class Group {constructor(){this.children=[];this.userData={}}add(child){this.children.push(child);child.parent=this}remove(child){this.children=this.children.filter(item=>item!==child)}traverse(fn){fn(this);for(const child of this.children)child.traverse?.(fn)}}
class Material {clone(){return new Material()}dispose(){}}
class Geometry {dispose(){}}
class InstancedMesh {constructor(geometry,material,count){Object.assign(this,{geometry,material,count,userData:{}})}setMatrixAt(){}}
const THREE={Group,MeshBasicMaterial:Material,BoxGeometry:Geometry,InstancedMesh,
  Matrix4:class{makeTranslation(){return this}}};
const layerMount={collect:Playable.collect,mount:()=>({getState:()=>({floors:4,wings:1,braziers:1}),dispose(){}})};
const nativeMount={mount:()=>({getState:()=>({floors:3,rooms:3}),dispose(){}})};
const shaftMount={compose:Shaft.compose,mount:()=>({})};
const DS={registerSurface(){},clearScope(){}};
for(const side of Object.keys(orientation)){
  const meta={cellSize:.5,entrance:{side,
    axis:side==='east'||side==='west'?'x':'z',
    boundary:side==='east'||side==='south'?24:2,center:13,roomId:'room_1'},
    rooms:[{id:'room_1',col:2,row:2,w:22,h:22}]};
  const aligned=Vestibule.compose({meta,seed:13,LayerPlan:Plan,ShaftHub:Shaft,Connector});
  const floorSet=new Set();
  for(let col=3;col<=22;col++)for(let row=3;row<=22;row++)
    floorSet.add((aligned.padX+col)+','+(aligned.padZ+row));
  const spawn=Vestibule.spawnAcrossRoom({meta,padX:aligned.padX,padZ:aligned.padZ,floorSet});
  const makeTile=walkable=>({type:walkable?'floor':'rock'});
  const cols=aligned.padX+30,rows=aligned.padZ+30;
  const rec={cols,rows,floorSet,grid:Array.from({length:rows},()=>Array.from({length:cols},()=>makeTile(false))),
    mapData:{id:'map_i_dev_random_ruin',floor:[...floorSet].map(key=>key.split(',').map(Number))},scene:new Group()};
  for(const cell of floorSet){const [col,row]=cell.split(',').map(Number);rec.grid[row][col]=makeTile(true)}
  const ruin={spawn,localeRoot:{traverse(){}},occupancy:{blocksBox:()=>false},
    mechanisms:new Map(),transitDoors:[],activators:[],pushBlocks:[],controls:[]};
  const connected=Connector.connect({rec,ruin,seed:13,meta,preplanned:aligned.plan,
    pad:{x:aligned.padX,z:aligned.padZ},THREE,makeTile,DynamicSurfaces:DS,
    ShaftHub:shaftMount,RuinLayerPlan:Plan,RuinShaftCorridor:Corridor,
    RuinLayerPlayable:layerMount,RuinLayerChallenges:{},RuinLayerDefense:{},
    RuinV50NativeFloors:nativeMount,CellGrid3D:{},getPlayerPosition:()=>spawn});
  assert.equal(connected.route.length,6,'V50 door-to-shaft distance is exactly the authored short passage');
  assert.equal(connected.route.corners,0);
  assert(ruin.shaftConnection.thresholdConnected,'physical room-to-shaft reachability was proved');
  assert(ruin.shaftConnection.straightVestibule);
  const path=new Set([...floorSet,...connected.route.tiles.map(([x,z])=>x+','+z)]);
  const starting=Math.floor(spawn.x)+','+Math.floor(spawn.z);
  const target=aligned.mouth.x+','+aligned.mouth.z;
  const visited=new Set([starting]),queue=[starting];
  for(let head=0;head<queue.length&&!visited.has(target);head++){
    const [x,z]=queue[head].split(',').map(Number);
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const adjacent=(x+dx)+','+(z+dz);
      if(!path.has(adjacent)||visited.has(adjacent))continue;
      visited.add(adjacent);queue.push(adjacent);
    }
  }
  assert(visited.has(target),'the original V50 room and the shaft really share one connected set of tiles');
  ruin.shaftConnectorCleanup();
}

const runtime=fs.readFileSync('docs/js/dev-random-ruin-interior-map.js','utf8');
const bootstrap=fs.readFileSync('docs/js/dev-random-ruin-bootstrap.js','utf8');
const index=fs.readFileSync('docs/index.html','utf8');
const map=fs.readFileSync('docs/js/dev-random-ruin-tile-occupancy.js','utf8');
assert(runtime.includes('singleRoom:singleVestibule'),'V50 itself must generate only one room, not simply hide extra rooms');
assert(runtime.includes('padX:entryPadX,padZ:entryPadZ'),'solvability reads the relocated V50 room');
assert(runtime.includes('getShaftCollisionMap:(requestedFloor=0)'),'map must obtain actual height-aware collision voxels');
assert(map.includes("getShaftCollisionMap?.(selectedRuinFloor)"),'map must render real voxel walls at the chosen elevation');
assert(map.includes('data-ruin-floor'),'controller/touch must be able to select a dungeon story');
for(const name of ['ruin-v50-vestibule.js','ruin-multifloor-v50-style.js'])
  assert(index.includes(name),'new architecture file must load before game bootstrap: '+name);
for(const name of ['dev-random-ruin-interior-map.js','dev-random-ruin-solvability.js','dev-random-ruin-tile-occupancy.js'])
  assert(bootstrap.includes(name+'?v=20261104directVestibule2'),'bootstrap cache must use current code: '+name);
console.log('ok '+cases+' one-chamber V50 vestibules: four orientations, straight shaft connection, world projection, floor-map diagnostics');
