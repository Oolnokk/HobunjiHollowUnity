#!/usr/bin/env node
'use strict';
// Native multi-floor V50 proof: preserve each generator's actual scene root,
// place its room/hallway graph at the pre-reserved shaft portal, and solve the
// standard gate/brazier chain without a teleport or a shared-floor blocker.
const assert=require('assert');
const Plan=require('../docs/js/ruin-layer-plan.js');
const Native=require('../docs/js/ruin-v50-native-floors.js');
const CG=require('../docs/js/cell-grid-3d.js');
const Corridors=require('../docs/js/ruin-shaft-corridor.js');
const Playable=require('../docs/js/ruin-layer-playable.js');
const Challenges=require('../docs/js/ruin-layer-challenges.js');

class Group{
  constructor(){this.children=[];this.parent=null;this.userData={};
    this.position={x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;}};
    this.rotation={x:0,y:0,z:0};this.scale={x:1,y:1,z:1};this.visible=true;}
  add(child){child.parent?.remove?.(child);this.children.push(child);child.parent=this;}
  remove(child){this.children=this.children.filter(item=>item!==child);child.parent=null;}
  traverse(fn){fn(this);for(const child of this.children)child.traverse?.(fn);}
}
class Geometry{dispose(){}rotateX(){return this}}
class Material{constructor(){}dispose(){}clone(){return new Material()}}
class Mesh extends Group{constructor(geometry,material){super();this.geometry=geometry;this.material=material}}
class InstancedMesh extends Mesh{constructor(geometry,material,count){super(geometry,material);this.count=count;
  this.instanceMatrix={needsUpdate:false};this.matrices=[]}
  setMatrixAt(i,m){this.matrices[i]=m.xyz}}
class Matrix4{makeTranslation(x,y,z){this.xyz=[x,y,z];return this}}
const THREE={Group,Mesh,InstancedMesh,Matrix4,BoxGeometry:Geometry,PlaneGeometry:Geometry,
  ConeGeometry:Geometry,CylinderGeometry:Geometry,MeshBasicMaterial:Material,DoubleSide:2};
function metadata(){
  const rooms=Array.from({length:4},(_,i)=>({id:'room_'+(i+1),col:2+i*18,row:12,w:12,h:12,
    parentRoomId:i?'room_'+i:null,progressionDepth:i}));
  const hallways=[],doorways=[],floorCells=[];
  const occupied=new Set(),fill=(r)=>{
    for(let z=r.row;z<r.row+r.h;z++)for(let x=r.col;x<r.col+r.w;x++)occupied.add(x+','+z);
  };
  rooms.forEach(fill);
  for(let i=0;i<3;i++){
    const left=rooms[i],right=rooms[i+1],h={id:'hall_'+(i+1),col:left.col+12,row:16,w:6,h:4,axis:'x'};
    hallways.push(h);fill(h);
    doorways.push({from:left.id,to:h.id,axis:'x',boundary:h.col,center:18,widthCells:4},
      {from:h.id,to:right.id,axis:'x',boundary:right.col,center:18,widthCells:4});
  }
  for(const item of occupied)floorCells.push(item.split(',').map(Number));
  return {rooms,hallways,doorways,floorCells,gridCols:72,gridRows:36,
    worldWidth:36,worldDepth:18,cellSize:.5,floorSurfaceY:0,
    entrance:{roomId:'room_1',side:'west',axis:'x',boundary:2,center:18,widthCells:3},
    dungeonProgression:{entranceRoomId:'room_1',coreTreasureRoomId:'room_4'},
    plateauModel:{stepHeight:.42,levelByCell:{}},
  };
}
const meta=metadata(),analysis=Native.analyze(meta);
assert(analysis.ok&&analysis.stages.length===3&&analysis.gates.length===3,
  'independent V50 room graphs are recognized by their actual parent/doorway metadata');
assert.equal(analysis.rooms,4);assert.equal(analysis.hallways,3);
assert(!Native.analyze({...meta,doorways:[]}).ok,
  'a disconnected native V50 graph must not be placed with a fake progression gate');
assert(!Native.analyze({...meta,rooms:meta.rooms.slice(0,2)}).ok,
  'V50 native floor requires two challenge rooms before its brazier');
const plan=Plan.compose({seed:22,anchorX:320,anchorZ:320,minFloors:3,maxFloors:3,nativeV50:true});
assert(plan.ok&&plan.nativeFloorCount===2);
for(const floor of plan.floors)if(floor.floor>0){
  assert(floor.nativePort?.side==='E');
  assert(!floor.wings.some(wing=>wing.side==='E'),'native and custom wings may not share a shaft portal');
  assert(floor.wings.length+1<=4,'at most four physical wing exits per story');
}
const scene=new Group(),floors=[],nativeRoots=[];
for(let floor=1;floor<3;floor++){
  const root=new Group();root.name='v50-real-render-root-'+floor;
  root.add(new Mesh(new Geometry(),new Material())); // Preserve genuine produced geometry, never replace it with mocked stone-room boxes.
  nativeRoots.push(root);
  floors.push({floor,roots:{localeRoot:root,particleRoot:new Group()},
    generated:{locale:{meta:{interiorShell:meta}}}});
}
const rec={scene,cols:100,rows:100,grid:[],
  floorSet:new Set(),mapData:{id:'map_i_dev_random_ruin',floor:[]}};
const ruin={controls:[],shaftLayerRuntime:{calls:[],setNativeGoalState(total,lit){this.calls.push({total,lit})}}};
const registered=[],surfaces=[],cleared=[],toasts=[],player={x:0,z:0,y:0};
const DS={registerSurface:r=>surfaces.push(r),clearScope:id=>cleared.push(id)};
const Dev={registerShaftGrid:(id,grid,dispose,contains)=>registered.push({id,grid,dispose,contains}),
  unregisterShaftGrid:id=>registered.splice(registered.findIndex(v=>v.id===id),1)};
const targets=new Map(),fireTargets=new Map();
const oldBus=globalThis.DevRandomRuinSimplePuzzles,oldFire=globalThis.DungeonFire;
globalThis.DevRandomRuinSimplePuzzles={
  registerExternalProjectileTarget(t){targets.set(t.id,t);return ()=>targets.delete(t.id)},
  hasActiveRuinState:()=>true,
};
globalThis.DungeonFire={
  registerTarget:t=>{fireTargets.set(t.id,t);return t.id},
  unregisterTarget:id=>fireTargets.delete(id),
};
let native;
try{
  native=Native.mount({ruin,rec,plan,
    hub:{ok:true,cols:49},records:floors,makeTile:open=>({type:open?'grass':'rock'}),
    THREE,DynamicSurfaces:DS,CellGrid3D:CG,RuinShaftCorridor:Corridors,
    RuinLayerPlayable:Playable,RuinLayerChallenges:Challenges,
    DevRandomRuin:Dev,getPlayerPosition:()=>player,getPlayerY:()=>player.y,
    showToast:message=>toasts.push(message),tileScale:2,
  });
  assert.equal(native.getState().floors,2);
  assert.equal(native.getState().rooms,8);
  assert.equal(native.getState().hallways,6);
  assert.equal(registered.length,2);
  assert(registered.every(v=>v.grid.nativeV50),
    'native floor collision is independent from the existing 2D V50 entry grid');
  assert(nativeRoots.every(root=>root.parent?.name?.startsWith('native-v50-story-')),
    'authentic V50 meshes are transferred intact to their owning physical floors');
  for(const state of native.records){
    const found=registered.find(r=>r.id==='ruin-native-v50-story-'+state.floor);
    assert(found?.contains?.(state.place.originX+5,state.place.originZ+18));
    assert(state.route.length>0,'native V50 entrance is joined by an actual exterior corridor');
    for(const stage of state.challenges){
      const before=state.solved;
      const grid=stage.gate.grid,[gx,gz]=stage.gate.tiles[0];
      assert(grid.isSolid(grid.xToCol(gx+.5),grid.zToRow(gz+.5),0));
      player.x=stage.kind==='pressurePlate'?stage.x:state.place.originX+5;
      player.z=stage.kind==='pressurePlate'?stage.z:state.place.originZ+18;
      player.y=plan.floors[state.floor].y;
      if(stage.kind==='pressurePlate')for(let i=0;i<17;i++)native.tick(.05);
      else if(stage.kind==='melodyEcho')stage.onMelodyResult({id:stage.id,solved:true});
      else if(stage.kind==='dungeonFire'){native.tick(.05);assert(stage.fireRecord.onBurn());}
      else for(let i=0;i<stage.targetCount;i++){native.tick(.05);stage.simulateHit(i);}
      assert.equal(state.solved,before+1,'only native puzzle completion opens this particular stage gate');
      assert(!grid.isSolid(grid.xToCol(gx+.5),grid.zToRow(gz+.5),0));
    }
    const controls=ruin.controls.filter(control=>control.kind==='v50NativeBrazier'
      &&control.floorY===plan.floors[state.floor].y);
    assert.equal(controls.length,1);
    controls[0].onPress();
    assert(state.lit,'the actual final V50 room contains one lit wing brazier');
  }
  assert.equal(native.getState().lit,2);
  assert.deepEqual(ruin.shaftLayerRuntime.calls.at(-1),{total:2,lit:2},
    'original Harlyao Great Door sees native and authored braziers as one completion graph');
  native.dispose();
  assert.equal(registered.length,0);
  assert.equal(ruin.controls.length,0);
  assert(cleared.length===2,'both native stories release their own independent surface and voxel scope');
  assert.equal(targets.size,0);
  assert.equal(fireTargets.size,0);
  console.log('ok preplanned native V50: real room graphs, 2 upper stories, physical halls, 3-stage gates, native braziers, cleanup');
}finally{
  native?.dispose();
  globalThis.DevRandomRuinSimplePuzzles=oldBus;
  globalThis.DungeonFire=oldFire;
}
