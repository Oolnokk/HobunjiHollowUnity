#!/usr/bin/env node
'use strict';
// Native multi-floor V50 proof: preserve each generator's actual scene root,
// place its room/hallway graph at the pre-reserved shaft portal, and solve the
// standard gate/brazier chain without a teleport or a shared-floor blocker.
const assert=require('assert');
const fs=require('fs'); // Read the real V50 bridge source to prove scene snapshots preserve native meshes across generations.
const Plan=require('../docs/js/ruin-layer-plan.js');
const Native=require('../docs/js/ruin-v50-native-floors.js');
const NativeMechanisms=require('../docs/js/ruin-v50-native-mechanisms.js'); // Real V50 authored activators must remain attached to each generated story.
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
class Vector3{constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}}
class Box3{setFromObject(){return this}isEmpty(){return false}getCenter(target){return target}}
const THREE={Group,Mesh,InstancedMesh,Matrix4,Box3,Vector3,BoxGeometry:Geometry,PlaneGeometry:Geometry,
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
// The V50 bridge must physically transfer its current preview children
// instead of shallow-cloning or reusing roots that V50 clears next round.
{
  const source=fs.readFileSync('docs/tools/debris-ifier/debrisifier-v50-api.js','utf8');
  const begin=source.indexOf('  function takePreviewRoots(options = {}) {');
  const end=source.indexOf('  function pausePreviewLoop()',begin);
  assert(begin>=0&&end>begin,'native source transfer hook is present on the actual V50 API');
  const original=new Group(),particles=new Group(),child=new Mesh(new Geometry(),new Material());
  const spark=new Group(),host=new Group();
  host.add(original);host.add(particles);original.add(child);particles.add(spark);
  const detach=obj=>obj.parent?.remove(obj);
  const take=new Function('localePreviewRoot','mechanismParticleRoot','detachObject','THREE',
    source.slice(begin,end)+String.fromCharCode(10)+'return takePreviewRoots;')(original,particles,detach,THREE);
  const snap=take({snapshot:true,floor:2});
  assert(child.parent===snap.localeRoot&&spark.parent===snap.particleRoot);
  assert(original.children.length===0&&particles.children.length===0);
  original.add(new Mesh(new Geometry(),new Material())); // Simulate V50 clearing and regenerating into its fixed preview root.
  assert(snap.localeRoot.children[0]===child,
    'generating floor two may never erase meshes kept from floor one');
  const legacy=take();
  assert(legacy.localeRoot===original&&legacy.particleRoot===particles,
    'normal single-floor V50 callers retain the original takePreviewRoots behavior');
}

const meta=metadata(),analysis=Native.analyze(meta);
assert(analysis.ok&&analysis.stages.length===3&&analysis.gates.length===3,
  'independent V50 room graphs are recognized by their actual parent/doorway metadata');
assert.equal(analysis.rooms,4);assert.equal(analysis.hallways,3);
assert.deepEqual(Native.doorwayCells({axis:'x',boundary:20,center:18.5,widthCells:5}),
  [[20,16],[20,17],[20,18],[20,19],[20,20]],'odd-width gates must match their half-cell centers');
const strayTiles=[]; // A floor-only shortcut is invisible to the room graph but must invalidate the gate.
for(let x=8;x<=62;x++)strayTiles.push([x,25]);
for(let z=18;z<=25;z++){strayTiles.push([8,z]);strayTiles.push([62,z]);}
assert(!Native.analyze({...meta,floorCells:[...meta.floorCells,...strayTiles]}).ok,
  'actual walkable tiles, not only doorway edges, must be cut by each sealed gate');

assert(!Native.analyze({...meta,doorways:[]}).ok,
  'a disconnected native V50 graph must not be placed with a fake progression gate');
const shortcut={id:'hall_shortcut',col:10,row:25,w:50,h:4};
const bypass={...meta,hallways:[...meta.hallways,shortcut],doorways:[
  ...meta.doorways,
  {from:'room_1',to:'hall_shortcut',axis:'z',boundary:25,center:12,widthCells:4},
  {from:'hall_shortcut',to:'room_3',axis:'z',boundary:25,center:46,widthCells:4},
]};
assert(!Native.analyze(bypass).ok,
  'a native hallway loop that bypasses a sealed V50 challenge gate must be rejected');
assert(!Native.analyze({...meta,rooms:meta.rooms.slice(0,2)}).ok,
  'V50 native floor requires two challenge rooms before its brazier');
const plan=Plan.compose({seed:22,anchorX:320,anchorZ:320,minFloors:3,maxFloors:3,nativeV50:true});
assert(plan.ok&&plan.nativeFloorCount===2);
for(const floor of plan.floors)if(floor.floor>0){
  assert(floor.nativePort?.side==='E');
  assert(!floor.wings.some(wing=>wing.side==='E'),'native and custom wings may not share a shaft portal');
  assert(floor.wings.length+1<=4,'at most four physical wing exits per story');
}
assert.throws(()=>Native.layoutPlacement({...meta,layoutReservation:{...plan.floors[1].nativePort.reservation,floor:2,y:8,tileScale:2}},plan.floors[1].nativePort),/reservations differ/);
const scene=new Group(),floors=[],nativeRoots=[];
for(let floor=1;floor<3;floor++){
  const root=new Group();root.name='v50-real-render-root-'+floor;
  root.add(new Mesh(new Geometry(),new Material())); // Preserve genuine produced geometry, never replace it with mocked stone-room boxes.
  nativeRoots.push(root);
  const levels={'8,18':1,'62,18':1}; // Test native objective height and both positive and negative doorway plateaus.
  for(let z=16;z<20;z++)levels[(floor===1?'20':'38')+','+z]=floor===1?3:-2;
  const floorMeta={...meta,layoutReservation:{...plan.floors[floor].nativePort.reservation,floor,y:plan.floors[floor].y,tileScale:2},
    plateauModel:{stepHeight:.42,levelByCell:levels}};
  floors.push({floor,roots:{localeRoot:root,particleRoot:new Group()},
    generated:{locale:{meta:{interiorShell:floorMeta}}}});
}
const rec={scene,cols:100,rows:100,grid:[],
  floorSet:new Set(),mapData:{id:'map_i_dev_random_ruin',floor:[]}};
const ruin={controls:[],api:{applyProgress(){},syncPressurePlates(){}},
  shaftLayerRuntime:{calls:[],setNativeGoalState(total,lit){this.calls.push({total,lit})}}}; // V50's original pose bridge is required even when this fixture has no authored activators.
const registered=[],surfaces=[],cleared=[],toasts=[],player={x:0,z:0,y:0};
const DS={registerSurface:r=>surfaces.push(r),registerBlocker:r=>surfaces.push(r),
  remove(){},clearScope:id=>cleared.push(id)};
const Dev={registerShaftGrid:(id,grid,dispose,contains)=>registered.push({id,grid,dispose,contains}),
  unregisterShaftGrid:id=>registered.splice(registered.findIndex(v=>v.id===id),1)};
const targets=new Map(),fireTargets=new Map();
const music={state:{echoChallenge:null},closed:0,close(){this.closed++;this.state.echoChallenge=null;}}; // Injects the real session-close lifecycle without requiring the browser flute UI.
const nativeScanRoots=new Set(),hitPuzzles={registerExternalRoot(root){
  nativeScanRoots.add(root);return ()=>nativeScanRoots.delete(root);
}}; // The shared source glyph/torch runtime follows the exact story-root lifetime.
const authoredSolved=new Set(); // Synthetic V50 mechanism signal used to prove the old substitute puzzle cannot bypass a real authored stage.
const nativeAdapter={...NativeMechanisms,mount(options){
  const runtime=NativeMechanisms.mount(options),choose=runtime.stageCandidate,solved=runtime.isSolved;
  return {...runtime,
    stageCandidate:room=>options.floor===1&&room.id==='room_1'
      ?{id:'authored-gate-1',kind:'glyphObelisk'}:choose(room),
    isSolved:id=>authoredSolved.has(id)||solved(id)};
}};
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
    RuinLayerPlayable:Playable,RuinLayerChallenges:Challenges,MusicMinigame:music,
    RuinV50NativeMechanisms:nativeAdapter,hitPuzzles,
    DevRandomRuin:Dev,getPlayerPosition:()=>player,getPlayerY:()=>player.y,
    showToast:message=>toasts.push(message),tileScale:2,
  });
  assert.equal(native.getState().floors,2);
  assert(native.getState().perFloor.every(f=>f.reservationVerified));
  assert.equal(native.records[0].challenges[0].floorY,4.42,'native puzzle height comes from V50 surface metadata');
  assert.equal(native.getState().rooms,8);
  assert.equal(native.records[0].challenges[0].kind,'v50Authored','a V50-authored signal is the chamber gate authority when one exists');
  assert.equal(native.getState().perFloor[0].nativeAuthoredStages,1);
  assert.equal(nativeScanRoots.size,2,'both upper-floor V50 roots join the real glyph/torch runtime');
  assert(native.getState().perFloor.every(record=>record.nativeMechanisms?.mechanisms===0),
    'an empty fixture still mounts and disposes its independent native mechanism bridge');
  assert.equal(native.getState().hallways,6);
  assert.equal(registered.length,2);
  assert(registered.every(v=>Native.isNativeGrid(v.grid)),
    'native floor collision is independent from the existing 2D V50 entry grid');
  assert(nativeRoots.every(root=>root.parent?.name?.startsWith('native-v50-story-')),
    'authentic V50 meshes are transferred intact to their owning physical floors');
  const raised=native.records[0].challenges[0],lowered=native.records[1].challenges[1]; // Both doors must obstruct at their actual plateau, not at a nominal story elevation.
  assert(Math.abs(raised.gate.surfaceY-(plan.floors[1].y+1.26))<1e-6);
  assert(Math.abs(lowered.gate.surfaceY-(plan.floors[2].y-.84))<1e-6);
  for(const stage of [raised,lowered]){
    const [gx,gz]=stage.gate.tiles[0],grid=stage.gate.grid;
    const col=grid.xToCol(gx+.5),row=grid.zToRow(gz+.5);
    const level=grid.yToLevel(stage.gate.surfaceY+.5);
    assert(grid.isSolid(col,row,level),'native gate collision aligns with its own actual plateau height');
    assert(Math.abs(stage.gate.object.position.y-(stage.gate.surfaceY+stage.gate.height/2))<1e-6,
      'stone gate geometry spans the same raised or lowered doorway as the 3D collision');
    if(level!==0)assert(!grid.isSolid(col,row,0),'gate must not project invisible collision into lower air cells');
  }
  for(const state of native.records){
    const found=registered.find(r=>r.id==='ruin-native-v50-story-'+state.floor);
    assert(found?.contains?.(state.place.originX+5,state.place.originZ+18));
    assert(state.route.length>0,'native V50 entrance is joined by an actual exterior corridor');
    assert(state.routeWallSegments>0,'physical corridor walls must visually match its 3D collision');
    for(const stage of state.challenges){
      const before=state.solved;
      const grid=stage.gate.grid,[gx,gz]=stage.gate.tiles[0];
      assert(grid.isSolid(grid.xToCol(gx+.5),grid.zToRow(gz+.5),
        grid.yToLevel(stage.gate.surfaceY+.5)));
      player.x=stage.kind==='pressurePlate'?stage.x:state.place.originX+5;
      player.z=stage.kind==='pressurePlate'?stage.z:state.place.originZ+18;
      player.y=stage.floorY;
      if(stage.kind==='v50Authored'){
        native.tick(.05);
        assert.equal(state.solved,before,'an unsolved V50 puzzle cannot be bypassed with a substitute challenge');
        authoredSolved.add(stage.nativeMechanism.id);
        native.tick(.05);
      }else if(stage.kind==='pressurePlate')for(let i=0;i<17;i++)native.tick(.05);
      else if(stage.kind==='melodyEcho')stage.onMelodyResult({id:stage.id,solved:true});
      else if(stage.kind==='dungeonFire'){native.tick(.05);assert(stage.fireRecord.onBurn());}
      else for(let i=0;i<stage.targetCount;i++){native.tick(.05);stage.simulateHit(i);}
      assert.equal(state.solved,before+1,'only native puzzle completion opens this particular stage gate');
      assert(!grid.isSolid(grid.xToCol(gx+.5),grid.zToRow(gz+.5),
        grid.yToLevel(stage.gate.surfaceY+.5)));
    }
    const controls=ruin.controls.filter(control=>control.kind==='v50NativeBrazier'
      &&control.floorY===plan.floors[state.floor].y+.42);
    assert.equal(controls.length,1);
    player.y=controls[0].floorY;
    controls[0].onPress();
    assert(state.lit,'the actual final V50 room contains one lit wing brazier');
  }
  assert.equal(native.getState().lit,2);
  assert.deepEqual(ruin.shaftLayerRuntime.calls.at(-1),{total:2,lit:2},
    'original Harlyao Great Door sees native and authored braziers as one completion graph');
  music.state.echoChallenge={id:'native-cleanup-probe'};
  native.records[0].challenges.push({id:'native-cleanup-probe',kind:'melodyEcho'}); // A mid-session reroll must close exactly the native floor's flute puzzle.
  native.dispose();
  assert.equal(music.closed,1,'native floor teardown closes its own active melody session');
  assert.equal(registered.length,0);
  assert.equal(ruin.controls.length,0);
  assert(cleared.length===2,'both native stories release their own independent surface and voxel scope');
  assert.equal(targets.size,0);
  assert.equal(fireTargets.size,0);
  assert.equal(nativeScanRoots.size,0,'native glyph and torch roots must unregister when the dungeon closes');
  console.log('ok preplanned native V50: real room graphs, 2 upper stories, plateau-aware 3D gates, physical halls, native braziers, cleanup');
}finally{
  native?.dispose();
  globalThis.DevRandomRuinSimplePuzzles=oldBus;
  globalThis.DungeonFire=oldFire;
}
