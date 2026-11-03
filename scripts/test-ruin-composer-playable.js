#!/usr/bin/env node
'use strict';
// Integration contract: materialize a real RuinComposer plan through the same gameplay
// interfaces (authored pieces, plinth controls, rope hooks, Witch-bomb tubes and enemy encounters).
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const C=require('../docs/js/ruin-composer.js');
globalThis.window=globalThis;
globalThis.RuinComposer=C;
class Group {
  constructor(){this.children=[];this.userData={};this.position={x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;}};this.rotation={y:0};this.parent=null;this.isObject3D=true;}
  add(item){item.parent?.remove(item);item.parent=this;this.children.push(item);}
  remove(item){const index=this.children.indexOf(item);if(index>=0){this.children.splice(index,1);item.parent=null;}}
}
class BoxGeometry { constructor(...size){this.size=size;this.disposed=false;} dispose(){this.disposed=true;} }
class MeshBasicMaterial { constructor(options){this.color=options.color;this.disposed=false;} dispose(){this.disposed=true;} }
class Mesh extends Group {constructor(geometry,material){super();this.geometry=geometry;this.material=material;}}
globalThis.THREE={Group,Mesh,BoxGeometry,MeshBasicMaterial};

const nodes=new Map(); // Verifies the native puzzle registration receives the correct authored piece and override.
const ropes=new Map(); // Verifies real rope options and removal.
const surfaces=new Map(), pits=new Map(); // Verifies solid shore support and explicit chasm fall volume.
const encounters=new Map(); // Verifies encounter receives world coordinates, not local room coordinates.
const statuary=new Map(), tubes=new Map(); // Verifies Key Statue and Witch-bomb dispenser registration.
const toast=[]; // Captures contextual in-game feedback from action presses.
globalThis.DynamicSurfaces={
  registerSurface(entry){surfaces.set(entry.id,entry);},
  registerPit(entry){pits.set(entry.id,entry);},
  clearScope(scope){for(const map of [surfaces,pits])for(const [id,r] of map)if(r.scope===scope)map.delete(id);},
};
globalThis.AuthoredFurniture={
  async load(key){
    const filename=path.join(__dirname,'../docs/config/furniture-authored',key+'.json');
    return JSON.parse(fs.readFileSync(filename,'utf8'));
  },
  buildGroup(data){
    const group=new Group();
    group.userData.furniturePuzzle=data.puzzle||null;
    group.userData.authoredFurnitureKey=data.key;
    group.userData.meshById=new Map(data.parts.map(part=>[part.id,{}]));
    return group;
  },
};
globalThis.FurniturePuzzleRuntime={
  registerNode(mapId,record,group,options={}){
    if(!group.userData.furniturePuzzle)return false;
    group.userData.furniturePuzzle={...group.userData.furniturePuzzle,...record.puzzle};
    nodes.set(record.id,{mapId,record,group,setBlocked:options.setBlocked});
    if(group.userData.furniturePuzzle.role==='mechanism')
      options.setBlocked?.(record,group.userData.furniturePuzzle.blocksMovement!==false);
    return true;
  },
  unregisterNode(_mapId,id){return nodes.delete(id);},
  burdenPlateButtons:(_mapId,id)=>[{label:'Insert Key Statue',action:'obj_burden_plate_'+id,allowed:true}],
  keyStatueButtons:(_mapId,id)=>[{label:'Take Key Statue',action:'obj_key_statue_'+id,allowed:true}],
  interactBurdenPlate:()=>({ok:true,message:'Burden plinth engaged.'}),
  interactKeyStatue:()=>({ok:true,message:'Key Statue acquired.'}),
};
globalThis.HangingRopes={
  registerRope(rope){ropes.set(rope.id,rope);return rope;},
  removeRope(id){return ropes.delete(id);},
};
globalThis.HronalWitchBombs={
  registerDispenser(_map,id,root){tubes.set(id,root);return true;},
  dispenseFromMechanism:async()=>({id:'witch-bomb-test'}),
};
globalThis.KeyStatues={registerDispenser(_map,id,root){statuary.set(id,root);return true;}};
globalThis.RuinEncounters={
  create(options){encounters.set(options.id,options);return options;},
  remove(id){return encounters.delete(id);},
};
const Playable=require('../docs/js/ruin-composer-playable.js');
function makeRecord(){
  const cols=18,rows=20; // Existing V50 footprint used to prove the wing only appends to the map.
  const grid=Array.from({length:rows},()=>Array.from({length:cols},()=>({type:'grass'})));
  const floorSet=new Set(['1,1']);
  const scene=new Group();
  return {cols,rows,grid,floorSet,mapData:{cols,rows,floor:[[1,1]]},scene,spawn:{x:1.5,z:1.5}};
}
const mkTile=walkable=>({type:walkable?'grass':'rock'});
(async()=>{
  const rec=makeRecord(),existing=rec.grid[1][1];
  const seed=3;
  const {composition}=Playable.plan(seed);
  assert.equal(composition.ok,true,'the full defence + crossing trial must solve');
  const wing=await Playable.mount({rec,ruin:{},seed,mapId:'map_i_dev_random_ruin',scope:'composed_test',makeTile:mkTile,
    originX:3,originZ:24,DynamicSurfaces:DynamicSurfaces,THREE,isCurrent:()=>true,
    showToast:(message,ok)=>toast.push([message,ok])});
  assert(wing.ok && wing.placed===composition.records.filter(r=>!r.marker).length,'all planned furniture must exist in the scene');
  assert.strictEqual(rec.grid[1][1],existing,'composing a wing must not alter the V50 grid');
  assert(rec.cols>18 && rec.rows>20 && rec.mapData.cols===rec.cols && rec.mapData.rows===rec.rows,'the live map was expanded');
  assert(rec.floorSet.has('4,32'),'the near bank is part of the navigable map');
  const gap=rec.grid[32][13]; // World x=13.5 = wing x=10.5, inside the gap.
  assert(gap.bottomless && gap.type==='grass','the pit permits physical entry but destroys falling burdens');
  assert([...pits.values()].some(p=>p.scope==='composed_test'),'a real DynamicSurfaces chasm pit is registered');
  assert.equal([...surfaces.values()].filter(s=>s.scope==='composed_test').length,2,'both banks have floor support');
  const pillar=composition.records.find(r=>r.piece==='crackedPillar');
  const pillarNode=nodes.get(pillar.id);
  assert(pillarNode,'pillar is registered as a blast-reactive puzzle mechanism');
  assert.equal(pillarNode.group.position.x,3+pillar.x);
  assert(Math.abs(pillarNode.group.rotation.y+Math.PI/2)<.001,'the falling shaft faces straight across the chasm');
  const footCol=Math.floor(3+pillar.x+2),footRow=Math.floor(24+pillar.z); // The upright base occupies the far bank, never the abyss.
  const originalFoot=rec.grid[footRow][footCol];
  assert.equal(originalFoot.type,'rock','an upright pillar blocks native walking and ground enemy paths');
  pillarNode.setBlocked(pillarNode.record,false); // Real FurniturePuzzleRuntime does this at collisionOpenProgress.
  assert.equal(rec.grid[footRow][footCol].type,'grass','a toppled pillar releases the far-bank collision tile');
  assert.equal(pillarNode.group.userData.furniturePuzzle.standingSurface?.partId,'part_mvzye4ag_g0i3g');
  assert(ropes.size>0 && [...ropes.values()].every(r=>r.mapId==='map_i_dev_random_ruin'),'rope mounts become real hanging rope records');
  assert.equal(tubes.size,1,'Witch-bomb tubes are registered with the live factory');
  assert.equal(statuary.size,1,'Key Statue mount is registered with the live factory');
  assert.equal(encounters.size,1,'defence spawners create exactly one live encounter');
  const enc=[...encounters.values()][0];
  assert(enc.spawners.every(s=>s.x>3+12.9 && s.z>=24),'enemy spawners are translated into world coordinates');
  assert(nodes.get(composition.records.find(r=>r.piece==='plinth').id).group.userData.furniturePuzzle.channel.startsWith('Trial-Plinth-'),'plinth inputs do not switch unrelated V50 mechanisms');
  assert(nodes.get(composition.records.find(r=>r.piece==='bombDispenser').id).group.userData.furniturePuzzle.channel.startsWith('Trial-Bomb-'),'bomb tube uses an independent activation channel');
  assert.equal(wing.controls.length,3,'three ordinary contextual interactions serve the defence and bomb tube');
  for(const control of wing.controls) {
    assert(control.point && control.promptRoot && typeof control.onPress==='function','mobile/controller action has a world-space owner');
    const response=await control.onPress();
    assert(response.ok,'a gameplay interaction resolves through its runtime');
  }
  assert.equal(toast.length,3,'action messages use the existing toast surface');
  wing.dispose();
  assert.equal(rec.grid[footRow][footCol].type,'grass','undoing the wing restores the original V50 tile instead of leaving a phantom obstacle');
  assert.equal(nodes.size,0,'furniture puzzle graph is cleaned up on exit');
  assert.equal(ropes.size,0,'the rope runtime is cleaned up');
  assert.equal(encounters.size,0,'the defence encounter is cleaned up');
  assert.equal(surfaces.size,0);assert.equal(pits.size,0);
  assert.equal(rec.scene.children.length,0,'wing geometry is detached from the game scene');
  wing.dispose(); // Idempotent: reroll and ruin exit may both request disposal.
  const before=makeRecord();
  const nativeLoad=AuthoredFurniture.load;
  AuthoredFurniture.load=async key=>key==='ruinPillarBridge'?null:nativeLoad(key);
  await assert.rejects(()=>Playable.mount({rec:before,ruin:{},seed,mapId:'map_i_dev_random_ruin',scope:'missing_asset',makeTile:mkTile,
    DynamicSurfaces,THREE}),/Missing authored ruin piece/);
  assert.equal(before.rows,20,'an asset failure leaves the existing room untouched');
  assert.equal(before.scene.children.length,0);
  AuthoredFurniture.load=nativeLoad;
  console.log('ok test-ruin-composer-playable');
})().catch(error=>{console.error(error);process.exitCode=1;});
