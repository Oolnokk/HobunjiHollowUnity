'use strict';
// Executable travel/checkpoint regression: tap vs hold, distinct white fire,
// progress restore and exact Action 2 fallback destinations.
const assert=require('node:assert/strict');
const Travel=require('../docs/js/ruin-checkpoint-travel.js');
const Jump=require('../docs/js/ruin-jump-shaft.js'); // Real fixture reservation API used by the Tothal checkpoint integration.
class Node {
  constructor(){this.children=[];this.position={x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;}};
    this.scale={setScalar(n){this.x=this.y=this.z=n;},set(x,y,z){this.x=x;this.y=y;this.z=z;}};this.rotation={x:0,y:0,z:0};this.visible=true;this.userData={};}
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
for(const key of ['RuinMultifloorV50Style','RuinV50NativeFloors','PersistentGroundFire','ProceduralFurniture','DevRandomRuin','CloudForestFog','RuinInteractionAudio','RuinJumpShaft','DevRandomRuinSanctum','RangedWeapons','DungeonFire','_desktopSelectionArc']){
  old[key]=globalThis[key];
}
let lightRefreshes=0,ignitions=0,fireArms=0; // Confirms activation is a state transition, not repeated every frame.
const destinations=[];
let location={x:24,z:12,y:0}; // Actor world position used by proximity and teleport tests.
let currentScene=null; // The active generated ruin scene distinguishes live white checkpoints from disposed/foreign ones.
globalThis.RuinMultifloorV50Style={chooseHubBrazierCell:(_hub,story)=>[10+story,10+story]};
globalThis.RuinV50NativeFloors={nativeRoom:()=>({x:60,z:10,w:8,d:8})}; // Native rooms can sit on fractional raised V50 plateaus.
globalThis.PersistentGroundFire={attachCampfireFlame:(_anchor,opts)=>{
  assert(['#ffffff','#ffb25a'].includes(opts.colorA),'only white checkpoint or orange fire-source emitters');
  assert(['#d9edff','#ff5f1d'].includes(opts.colorB),'all fire particle colors are valid hex strings');
  return {update(){},dispose(){}};
}};
globalThis.ProceduralFurniture={makePartMaterial:()=>new Material()};
globalThis.DevRandomRuin={setPlayerWorldPoint:at=>{location={...at};destinations.push({...at});return true;},
  getRuntimeContext:()=>({scene:currentScene})};
globalThis.CloudForestFog={refreshLightingOverlay:()=>lightRefreshes++};
globalThis.RuinInteractionAudio={igniteTorch:()=>ignitions++};
globalThis.RuinJumpShaft=Jump;
let rangedEquipped=true; // Fire prompts are available only with a ranged weapon.
globalThis.RangedWeapons={equippedRangedKey:()=>rangedEquipped?'test-bow':null};
globalThis.DungeonFire={armNextProjectile:()=>{if(!rangedEquipped)return false;fireArms++;return true;}};
function spawn(withNative=false,withTothal=false,withHachutu=false){
  const scene=new Node(),controls=[]; // The actual ruin interaction list is injected, not replaced.
  currentScene=scene;
  const ruin={controls,seed:77,theme:withTothal?'tothal':'hronal',hachutu:withHachutu,spawn:{x:2,z:3},shaftGrids:new Map([
    ['wing',{grid:{xToCol:n=>Math.floor(n),zToRow:n=>Math.floor(n),yToLevel:n=>n,inBounds:()=>true,canStand:()=>true},contains:()=>true}]
  ])};
  const manual={kind:'layerBrazier',object:new Node(),floorY:0,range:1.7,lit:()=>true};
  controls.push(manual);
  if(withNative)ruin.nativeV50Runtime={records:[{floor:0,floorY:0,
    analysis:{stages:[{}]},place:{},supportYAt:()=>7.5}]}; // Raises the native floor independently of its story datum.
  const plan={floors:[{floor:0,y:0,wings:[
    {id:'east',side:'E',rooms:[{x:20,z:10,w:8,d:8}]},
    {id:'west',side:'W',rooms:[{x:40,z:10,w:8,d:8}]}
  ]},{floor:1,y:16,wings:[]},{floor:2,y:32,wings:[]}]};
  const hub={grid:{colToX:n=>n,rowToZ:n=>n,levelToY:n=>n},options:{spacing:16}};
  if(withTothal){
    const jumpPlan=Jump.compose({shaft:23,spacing:6,floors:2,theme:'tothal',seed:77});
    assert(jumpPlan.ok,'Tothal jump route is solvable');
    const columns=new Map(jumpPlan.platforms.map(p=>{
      const holder=new Node();holder.position.set(p.x,p.y,p.z);
      scene.add(holder);
      return [p.id,{...p,holder}];
    }));
    ruin.shaftObeliskRuntime={method:'jumpPlatforms',plan:jumpPlan,columns};
  }
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
  assert.equal(controls.filter(c=>c.kind==='ruinShaftTravel').length,3,'every physical shaft story offers the same recovery travel interaction');
  assert.deepEqual(owner.getState().shaftTravel.floors.map(entry=>entry.y),[0,16,32],
    'three shaft braziers sit on their own supported stories, not the ground story');
  assert.equal(action2.inputAction,'action2');
  assert.equal(shaft.inputAction,'action1');
  assert(small.every(c=>c.inputAction==='action1'));
  assert.equal(action2.available(),true,'Action 2 only appears on an already lit wing');
  assert.equal(Travel.isActive(),true,'the current ruin owns the white checkpoints');
  assert.equal(Travel.lightSources().length,5,'every story of the shaft plus two small white checkpoints has one cached light source');
  action2.onPress();
  assert.deepEqual(destinations.at(-1),{x:2,z:3,y:0},'before shaft ignition, lit wing Action 2 returns to the entrance');
  location={x:10.5,z:10.5,y:0};owner.tick();
  assert.deepEqual(owner.serializeProgress(),{shaftLit:true,activeCheckpoint:'shaft',unlockedShaftFloors:[0]});
  assert.deepEqual(Travel.activeRespawnPoint(),{x:10.5,z:10.5,y:0},'lit shaft is the initial respawn');
  assert.equal(ignitions,1,'shaft ignites automatically once');
  assert.equal(writes.length,1,'shaft ignition persists once, not per frame');
  location={x:21.5,z:11.5,y:0};owner.tick();
  assert.equal(owner.serializeProgress().activeCheckpoint,'wing:east');
  const east=owner.getState().checkpoints.find(x=>x.id==='wing:east');
  assert.equal(east.lit,true);
  assert.equal(ignitions,2,'small checkpoints ignite automatically when approached');
  location={x:46.5,z:11.5,y:0};owner.tick(); // West wing's white checkpoint belongs on the entry (right) bank.
  const state=owner.getState();
  assert.equal(state.activeCheckpoint,'wing:west');
  assert.deepEqual(Travel.activeRespawnPoint(),{x:46.5,z:11.5,y:0},'white wing fire wins over legacy rope-bank checkpoints');
  assert.equal(state.checkpoints.find(c=>c.id==='wing:east').lit,false,'replaced checkpoints extinguish');
  assert.equal(state.checkpoints.find(c=>c.id==='shaft').lit,true,'shaft never extinguishes');
  assert.equal(writes.length,3,'checkpoint changes persist only on transitions');
  owner.tick();assert.equal(writes.length,3,'proximity on subsequent frames cannot trigger another save');
  location={x:10.5,z:10.5,y:0};owner.tick();
  assert.equal(owner.getState().activeCheckpoint,'wing:west','approaching shaft cannot overwrite discovered checkpoint');
  clock+=100;shaft.onHoldStart();clock+=100;shaft.onHoldEnd();
  assert.deepEqual(destinations.at(-1),{x:46.5,z:11.5,y:0},'Action 1 tap on shaft returns to the current checkpoint');
  clock+=100;small[1].onHoldStart();clock+=600;small[1].onHoldEnd();
  assert.deepEqual(destinations.at(-1),{x:10.5,z:10.5,y:0},'Action 1 hold on small brazier returns to shaft');
  clock+=100;shaft.onHoldStart();clock+=700;shaft.onHoldEnd({canceled:true});
  assert.deepEqual(destinations.at(-1),{x:10.5,z:10.5,y:0},'canceling a hold never teleports the player');
  clock+=100;shaft.onHoldStart();clock+=600;shaft.onHoldEnd();
  assert.deepEqual(destinations.at(-1),{x:2,z:3,y:0},'Action 1 hold on shaft returns to entrance');
  action2.onPress();
  assert.deepEqual(destinations.at(-1),{x:10.5,z:10.5,y:0},'lit wing Action 2 returns to the lit shaft');
  const saved=owner.serializeProgress();
  assert.equal(Travel.snapshotValid({version:1,seed:77},77),true);
  assert.equal(Travel.snapshotValid({version:1,seed:78},77),false,'a different ruin seed cannot adopt checkpoints');
  owner.dispose();assert.equal(Travel.lightSources().length,0,'teardown leaves no global lighting references');
  assert.equal(Travel.isActive(),false,'the disposed ruin relinquishes checkpoint authority');
  location={x:2,z:3,y:0};
  const restored=spawn();
  assert(restored.owner.restore({version:1,seed:77,...saved}),'world-save snapshot restores');
  assert.equal(restored.owner.getState().activeCheckpoint,'wing:west');
  assert.deepEqual(Travel.activeRespawnPoint(),{x:46.5,z:11.5,y:0},'restored white checkpoint controls the next respawn');
  assert(restored.owner.getState().checkpoints.find(c=>c.id==='wing:west').lit);
  assert(restored.owner.getState().checkpoints.find(c=>c.id==='shaft').lit);
  assert.equal(restored.writes.length,0,'restoring a world save does not cause another write');
  assert.equal(restored.owner.restore({version:1,seed:999,...saved}),false,'wrong ruin seed is ignored');
  restored.owner.dispose();
  // A held Action 1 uses the shared selection arch and cannot target an undiscovered floor.
  const multi=spawn();
  location={x:10.5,z:10.5,y:0};multi.owner.tick();
  const hubControls=multi.controls.filter(c=>c.kind==='ruinShaftTravel');
  const top=hubControls.find(c=>c.floorY===32),middle=hubControls.find(c=>c.floorY===16);
  const floorZero=hubControls.find(c=>c.floorY===0);
  assert(top&&middle&&floorZero);
  const arc={mode:null,entries:[],selectedId:'cancel',closeCalls:0,commitCalls:0,
    openEntries(mode,entries){this.mode='entries:'+mode;this.entries=entries;},
    currentMode(){return this.mode;},
    releaseSelection(){this.commitCalls++;const entry=this.entries.find(e=>e.id===this.selectedId);this.mode=null;entry?.onSelect?.();},
    close(){this.closeCalls++;this.mode=null;}};
  globalThis._desktopSelectionArc=arc;
  const actualTimer=globalThis.setTimeout,actualClear=globalThis.clearTimeout;
  let timerId=0;const timers=new Map(); // Synthetic held-input clock drives the actual travel menu without browser delays.
  globalThis.setTimeout=(fn)=>{const id=++timerId;timers.set(id,fn);return id;};
  globalThis.clearTimeout=id=>timers.delete(id);
  const fireHeldTimers=()=>{for(const [id,fn] of [...timers]){timers.delete(id);fn();}};
  try {
    clock+=100;floorZero.onHoldStart();
    clock+=360;fireHeldTimers();
    assert.equal(arc.mode,'entries:ruin-shaft-travel','a held input opens the existing entry selector before release');
    assert.equal(arc.entries.filter(e=>e.id.startsWith('shaft')).length,1,'undiscovered floors cannot appear as destinations');
    assert.equal(arc.entries.find(e=>e.id==='cancel').initial,true,'cancel is selected by default: holding alone cannot teleport');
    arc.selectedId='cancel';floorZero.onHoldEnd();
    assert.equal(destinations.at(-1).x,10.5,'cancel never changes the player location');
    location={x:11.5,z:11.5,y:16};multi.owner.tick();
    assert.deepEqual(multi.owner.serializeProgress().unlockedShaftFloors,[0,1],
      'reaching floor two unlocks its permanent shaft brazier');
    location={x:12.5,z:12.5,y:32};multi.owner.tick();
    assert.deepEqual(multi.owner.serializeProgress().unlockedShaftFloors,[0,1,2],
      'reaching floor three unlocks it independently');
    const unlocked=multi.owner.getState().shaftTravel;
    assert(unlocked.floors.every(entry=>entry.unlocked),'mobile diagnostics show all three discovered destinations');
    assert(unlocked.floors.every(entry=>multi.owner.getState().checkpoints.find(cp=>cp.id===entry.id)?.lit),
      'all discovered shaft braziers remain lit after moving between stories');
    assert.equal(multi.owner.getState().activeCheckpoint,'shaft:2','newly discovered upper shaft fires become recovery checkpoints');
    location={x:10.5,z:10.5,y:0};
    clock+=100;floorZero.onHoldStart();clock+=360;fireHeldTimers();
    arc.selectedId='shaft:2';floorZero.onHoldEnd();
    assert.deepEqual(destinations.at(-1),{x:12.5,z:12.5,y:32},
      'held wheel travels to the exact upper-story grounded shaft brazier');
    assert.equal(arc.commitCalls,2,'the held wheel commits through the ordinary selector release');
    location={x:10.5,z:10.5,y:0}; // Source proximity is independently revalidated before a destination is used.
    clock+=100;top.onHoldStart();clock+=360;fireHeldTimers();
    assert.notEqual(arc.mode,'entries:ruin-shaft-travel','upper-story brazier cannot open a wheel for a player on floor zero');
    top.onHoldEnd();assert.equal(destinations.at(-1).y,32,'wrong-story input cannot teleport the player');
    location={x:12.5,z:12.5,y:32}; // Cancel from the correct story is also honored.
    clock+=100;top.onHoldStart();clock+=360;fireHeldTimers();
    arc.selectedId='shaft';top.onHoldEnd({canceled:true});
    assert.equal(arc.closeCalls,1,'canceled held input closes the selector without choosing a floor');
    assert.equal(destinations.at(-1).y,32,'canceling a wheel does not teleport');
    const multiSaved=multi.owner.serializeProgress();
    multi.owner.dispose();
    const reentered=spawn();
    assert(reentered.owner.restore({version:1,seed:77,...multiSaved}));
    assert.deepEqual(reentered.owner.getState().shaftTravel.unlocked,['shaft','shaft:1','shaft:2'],
      'all unlocked shaft destinations survive a world save and reload');
    assert.equal(reentered.owner.getState().activeCheckpoint,'shaft:2','saved upper-floor respawn point remains authoritative');
    reentered.owner.dispose();
  } finally {
    globalThis.setTimeout=actualTimer;globalThis.clearTimeout=actualClear;
    delete globalThis._desktopSelectionArc;
  }
  // The dynamic sanctum fixture appears after the checkpoint runtime has mounted/restored.
  let doorUnlocked=false;
  globalThis.DevRandomRuinSanctum={isGreatDoorUnlocked:()=>doorUnlocked};
  const site={shaft:true,x:14,z:20,floorY:0,normal:{x:0,z:1},tangent:{x:1,z:0}};
  const doorRun=spawn();
  assert(doorRun.owner.registerDoorCheckpoint(site,3.2));
  const doorCp=doorRun.owner.getState().checkpoints.find(c=>c.id==='sanctum-door');
  location={x:doorCp.x,y:doorCp.y,z:doorCp.z};doorRun.owner.tick();
  assert.equal(doorRun.owner.getState().checkpoints.find(c=>c.id==='sanctum-door').lit,false);
  assert.notEqual(doorRun.owner.getState().activeCheckpoint,'sanctum-door');
  doorUnlocked=true;doorRun.owner.tick();
  assert.equal(doorRun.owner.getState().activeCheckpoint,'sanctum-door');
  assert.deepEqual(doorRun.owner.activeRespawnPoint(),location);
  const doorSaved=doorRun.owner.serializeProgress();doorRun.owner.dispose();
  const doorReload=spawn();doorUnlocked=false;location={x:2,y:0,z:3};
  assert(doorReload.owner.restore({version:1,seed:77,...doorSaved}));
  assert(doorReload.owner.registerDoorCheckpoint(site,3.2));
  assert.equal(doorReload.owner.getState().checkpoints.find(c=>c.id==='sanctum-door').lit,false);
  doorUnlocked=true;doorReload.owner.tick();
  assert.equal(doorReload.owner.getState().activeCheckpoint,'sanctum-door','saved door checkpoint restores after actual door unlock without revisiting it');
  assert.equal(doorReload.writes.length,0,'restoring door checkpoint never triggers another save');
  doorReload.owner.dispose();
  const raised=spawn(true);
  const plateau=raised.owner.getState().checkpoints.find(c=>c.id==='native:0');
  assert(plateau&&plateau.y===7.5,'native V50 checkpoints stand on the actual plateau, not floor.y');
  raised.owner.dispose();
  const frozen=spawn(false,true);
  const sources=frozen.owner.getState().ignitionSources; // Mobile debug exposes both low braziers without input claim handlers.
  assert.equal(frozen.controls.filter(control=>control.kind==='dungeonFireSource').length,0,
    'short fire-source braziers never claim Action 1 or Action 2 to arm a projectile');
  assert.equal(sources.length,2,'shaft and platform each have their own reusable torch-lighting source');
  assert.equal(frozen.owner.getState().shaftIgnitionAvailable,false,'old projectile arm interaction is disabled');
  assert.equal(frozen.owner.getState().shaftTorchFireAvailable,true,'mobile debug reports a torch-lighting fallback');
  assert(sources.every(source=>Math.abs(source.y)<100),'fire-source debug coordinates remain finite');
  const platform=frozen.ruin.shaftObeliskRuntime.plan.platforms[0];
  assert.equal(platform.fixtureSlot.occupiedBy,'ignitionBrazier','the short platform source retains the shared fixture slot');
  const fireObjects=Travel.litSourceObjects(); // Actual live THREE objects are consumed by the torch's physical fire-hazard contact test.
  assert.equal(fireObjects.filter(obj=>obj.userData.fireHazard===true).length,2,
    'shaft and platform fire sources are both lit and hazard-marked');
  assert(fireObjects.some(obj=>obj.name==='ruin-source-shaft-fire'),
    'floor-zero supplies its own short torch-lighting brazier, not the checkpoint interaction');
  rangedEquipped=false;
  assert.equal(frozen.controls.filter(control=>control.kind==='dungeonFireSource').length,0,
    'changing weapons never adds back a projectile ignition control');
  assert.equal(fireArms,0,'fire hazards light the adventuring torch without arming an ordinary arrow');
  frozen.owner.dispose();
  assert.equal(frozen.ruin.shaftObeliskRuntime.columns.get(platform.id).holder.children.length,0,
    'platform fixture is detached on teardown');
  rangedEquipped=true;
  const temple=spawn(false,true,true); // Hachutu uses the shaft but never borrows Tothal fire puzzles.
  assert.equal(temple.controls.some(c=>c.kind==='dungeonFireSource'),false,
    'exclusive Hachutu temples must not acquire Tothal fire controls');
  assert.equal(temple.owner.getState().shaftIgnitionAvailable,false);
  temple.owner.dispose();
  assert(lightRefreshes>=4);
  console.log('Ruin shaft / small braziers, Action 1 holds, Action 2, world restore: PASS');
}finally{
  globalThis.performance=previousPerformance;
  for(const [key,value] of Object.entries(old)){
    if(value===undefined)delete globalThis[key];else globalThis[key]=value;
  }
}
