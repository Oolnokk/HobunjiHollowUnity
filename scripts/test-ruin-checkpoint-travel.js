'use strict';
// Executable travel/checkpoint regression: tap vs hold, distinct white fire,
// progress restore and exact Action 2 fallback destinations.
const assert=require('node:assert/strict');
const Travel=require('../docs/js/ruin-checkpoint-travel.js');
class Node {
  constructor(){this.children=[];this.position={x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;}};
    this.scale={setScalar(n){this.x=this.y=this.z=n;}};this.visible=true;this.userData={};}
  add(child){this.children.push(child);child.parent=this;}
  remove(child){this.children=this.children.filter(node=>node!==child);child.parent=null;}
}
class Geometry{dispose(){}}
class Material{dispose(){}}
class Mesh extends Node {constructor(geometry,material){super();this.geometry=geometry;this.material=material;}}
const THREE={Group:Node,Mesh,CylinderGeometry:Geometry,MeshBasicMaterial:Material};
let clock=1000; // Synthetic monotonic time tests Action 1 holds without waiting.
const previousPerformance=globalThis.performance;
globalThis.performance={now:()=>clock};
const old={};
for(const key of ['RuinMultifloorV50Style','PersistentGroundFire','ProceduralFurniture','DevRandomRuin','CloudForestFog','RuinInteractionAudio']){
  old[key]=globalThis[key];
}
let lightRefreshes=0,ignitions=0; // Confirms activation is a state transition, not repeated every frame.
const destinations=[];
let location={x:24,z:12,y:0}; // Actor world position used by proximity and teleport tests.
globalThis.RuinMultifloorV50Style={chooseHubBrazierCell:()=>[10,10]};
globalThis.PersistentGroundFire={attachCampfireFlame:(_anchor,opts)=>{
  assert.equal(opts.colorA,0xffffff);return {update(){},dispose(){}};
}};
globalThis.ProceduralFurniture={makePartMaterial:()=>new Material()};
globalThis.DevRandomRuin={setPlayerWorldPoint:at=>{location={...at};destinations.push({...at});return true;}};
globalThis.CloudForestFog={refreshLightingOverlay:()=>lightRefreshes++};
globalThis.RuinInteractionAudio={igniteTorch:()=>ignitions++};
function spawn(){
  const scene=new Node(),controls=[]; // The actual ruin interaction list is injected, not replaced.
  const ruin={controls,seed:77,spawn:{x:2,z:3},shaftGrids:new Map([
    ['wing',{grid:{xToCol:n=>Math.floor(n),zToRow:n=>Math.floor(n),yToLevel:n=>n,inBounds:()=>true,canStand:()=>true},contains:()=>true}]
  ])};
  const manual={kind:'layerBrazier',object:new Node(),floorY:0,range:1.7,lit:()=>true};
  controls.push(manual);
  const plan={floors:[{floor:0,y:0,wings:[
    {id:'east',rooms:[{x:20,z:10,w:8,d:8}]},
    {id:'west',rooms:[{x:40,z:10,w:8,d:8}]}
  ]}]};
  const hub={grid:{colToX:n=>n,rowToZ:n=>n,levelToY:n=>n}};
  const notifications=[];
  const writes=[]; // World metadata integration invokes onProgressChange only when a checkpoint changes.
  const owner=Travel.mount({rec:{scene},ruin,plan,hub,THREE,getPlayerPosition:()=>location,
    getPlayerY:()=>location.y,showToast:msg=>notifications.push(msg),
    onProgressChange:()=>writes.push(owner.serializeProgress())});
  return {owner,ruin,controls,notifications,writes};
}
try{
  const {owner,controls,writes}=spawn();
  const action2=controls.find(c=>c.kind==='ruinWingReturn');
  const shaft=controls.find(c=>c.kind==='ruinShaftTravel');
  const small=controls.filter(c=>c.kind==='ruinCheckpointTravel');
  assert(action2&&shaft&&small.length===2,'all three brazier action families must exist');
  assert.equal(action2.inputAction,'action2');
  assert.equal(shaft.inputAction,'action1');
  assert(small.every(c=>c.inputAction==='action1'));
  assert.equal(action2.available(),true,'Action 2 only appears on an already lit wing');
  assert.equal(Travel.lightSources().length,3,'the universal shaft and both small white braziers emit cached lighting records');
  action2.onPress();
  assert.deepEqual(destinations.at(-1),{x:2,z:3,y:0},'before shaft ignition, lit wing Action 2 returns to the entrance');
  location={x:10.5,z:10.5,y:0};owner.tick();
  assert.deepEqual(owner.serializeProgress(),{shaftLit:true,activeCheckpoint:'shaft'});
  assert.equal(ignitions,1,'shaft ignites automatically once');
  assert.equal(writes.length,1,'shaft ignition persists once, not per frame');
  location={x:21.5,z:11.5,y:0};owner.tick();
  assert.equal(owner.serializeProgress().activeCheckpoint,'wing:east');
  const east=owner.getState().checkpoints.find(x=>x.id==='wing:east');
  assert.equal(east.lit,true);
  assert.equal(ignitions,2,'small checkpoints ignite automatically when approached');
  location={x:41.5,z:11.5,y:0};owner.tick();
  const state=owner.getState();
  assert.equal(state.activeCheckpoint,'wing:west');
  assert.equal(state.checkpoints.find(c=>c.id==='wing:east').lit,false,'replaced checkpoints extinguish');
  assert.equal(state.checkpoints.find(c=>c.id==='shaft').lit,true,'shaft never extinguishes');
  assert.equal(writes.length,3,'checkpoint changes persist only on transitions');
  owner.tick();assert.equal(writes.length,3,'proximity on subsequent frames cannot trigger another save');
  location={x:10.5,z:10.5,y:0};owner.tick();
  assert.equal(owner.getState().activeCheckpoint,'wing:west','approaching shaft cannot overwrite discovered checkpoint');
  clock+=100;shaft.onHoldStart();clock+=100;shaft.onHoldEnd();
  assert.deepEqual(destinations.at(-1),{x:41.5,z:11.5,y:0},'Action 1 tap on shaft returns to the current checkpoint');
  clock+=100;small[1].onHoldStart();clock+=600;small[1].onHoldEnd();
  assert.deepEqual(destinations.at(-1),{x:10.5,z:10.5,y:0},'Action 1 hold on small brazier returns to shaft');
  clock+=100;shaft.onHoldStart();clock+=600;shaft.onHoldEnd();
  assert.deepEqual(destinations.at(-1),{x:2,z:3,y:0},'Action 1 hold on shaft returns to entrance');
  action2.onPress();
  assert.deepEqual(destinations.at(-1),{x:10.5,z:10.5,y:0},'lit wing Action 2 returns to the lit shaft');
  const saved=owner.serializeProgress();
  assert.equal(Travel.snapshotValid({version:1,seed:77},77),true);
  assert.equal(Travel.snapshotValid({version:1,seed:78},77),false,'a different ruin seed cannot adopt checkpoints');
  owner.dispose();assert.equal(Travel.lightSources().length,0,'teardown leaves no global lighting references');
  location={x:2,z:3,y:0};
  const restored=spawn();
  assert(restored.owner.restore({version:1,seed:77,...saved}),'world-save snapshot restores');
  assert.equal(restored.owner.getState().activeCheckpoint,'wing:west');
  assert(restored.owner.getState().checkpoints.find(c=>c.id==='wing:west').lit);
  assert(restored.owner.getState().checkpoints.find(c=>c.id==='shaft').lit);
  assert.equal(restored.writes.length,0,'restoring a world save does not cause another write');
  assert.equal(restored.owner.restore({version:1,seed:999,...saved}),false,'wrong ruin seed is ignored');
  restored.owner.dispose();
  assert(lightRefreshes>=4);
  console.log('Ruin shaft / small braziers, Action 1 holds, Action 2, world restore: PASS');
}finally{
  globalThis.performance=previousPerformance;
  for(const [key,value] of Object.entries(old)){
    if(value===undefined)delete globalThis[key];else globalThis[key]=value;
  }
}
