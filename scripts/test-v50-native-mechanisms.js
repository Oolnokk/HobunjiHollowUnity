#!/usr/bin/env node
'use strict';
// Native V50 proof: real generator-authored activators are driven by the
// original V50 pose API, without replacing them with fake parent-game puzzles.
const assert=require('node:assert/strict');
const Native=require('../docs/js/ruin-v50-native-mechanisms.js');
class Vector3 {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z}
}
class Box3 {
  setFromObject(object){
    let x=0,y=0,z=0;
    for(let p=object;p;p=p.parent){x+=p.position?.x||0;y+=p.position?.y||0;z+=p.position?.z||0;}
    this.min={x:x-.25,y:y-.25,z:z-.25};this.max={x:x+.25,y:y+.25,z:z+.25};
    return this;
  }
  isEmpty(){return false}
  getCenter(v){v.x=(this.min.x+this.max.x)/2;v.y=(this.min.y+this.max.y)/2;v.z=(this.min.z+this.max.z)/2;return v;}
}
class Node {
  constructor(x=0,y=0,z=0){this.parent=null;this.children=[];this.userData={};
    this.position={x,y,z,set(x,y,z){this.x=x;this.y=y;this.z=z;}};
    this.rotation={y:0};this.scale={x:1,y:1,z:1};this.visible=true;
    this.isMesh=false;
  }
  add(child){this.children.push(child);child.parent=this;}
  traverse(fn){fn(this);this.children.forEach(child=>child.traverse(fn));}
  updateWorldMatrix(){}
}
const THREE={Box3,Vector3},root=new Node(0,4,0),controls=[],surfaces=[],blockers=[],removed=[],calls=[]; // Native V50 geometry is mounted under its upper-story world-elevation parent.
const DS={
  registerSurface:def=>surfaces.push(def),registerBlocker:def=>blockers.push(def),
  remove:id=>removed.push(id)
};
let pressureSyncs=0; // Confirms real authored weight signals are recalculated whenever the player pushes their block.
const generator={
  applyProgress(object,value){calls.push({object,value});},
  syncPressurePlates(object){assert.equal(object,root);pressureSyncs++;},
  rotateLinkedCube(object,index){object.userData.solveProgress=1;object.userData.lastTurn=index;},
};
const player={x:1,y:4,z:1},getPlayerY=()=>player.y;
const addControl=c=>controls.push(c),removeControl=c=>controls.splice(controls.indexOf(c),1);
const linked=(mechanismId,kind,x,z)=>{
  const a=new Node(x,0,z);a.userData={linkedMechanismId:mechanismId,activatorType:kind};
  root.add(a);return a;
};
const create=(id,motion,x,z)=>{
  const m=new Node(x,0,z);m.userData={mechanismId:id,previewMotion:{type:motion}};
  const panel=new Node();panel.isMesh=true;panel.geometry={};
  m.add(panel);root.add(m);return m;
};
const plateDoor=create('door_plate','stoneDoor',3,2),plate=linked('door_plate','pressurePlate',2,2);
plate.userData.weightProgress=0;plateDoor.userData.linkedPressurePlateRoot=plate;
const block=new Node(2,0,2);block.userData={pushable:true,previewMotion:{type:'pushPuzzleBlock'},
  pushPath:[{x:2,y:0,z:2},{x:3,y:0,z:2}]};root.add(block);
const routeShaper=new Node(4,0,2);routeShaper.userData={immovable:true,blockerPurpose:'route shaper'};root.add(routeShaper); // Native floor obstacle collision is separate from floor-zero TileOccupancy.
const cubeDoor=create('door_cube','stoneDoor',5,3),cubes=linked('door_cube','linkedCubePillars',4,3);
cubes.userData.rotatingSegments=Array.from({length:4},(_,controlIndex)=>{
  const segment=new Node();cubes.add(segment);return{segment,controlIndex};
});
cubeDoor.userData.linkedCubePuzzleRoot=cubes;
cubes.userData.solveProgress=0;
const obeliskDais=create('dais','movingDais',8,4),rings=linked('dais','stackedObelisk',7,4);
rings.userData.rotatingSegments=Array.from({length:3},()=>{
  const segment=new Node();rings.add(segment);segment.rotation.y=Math.PI*.5;return{segment};
});
const glyphBridge=create('glyph_bridge','bridge',11,4),glyph=linked('glyph_bridge','glyphObelisk',10,4);
const fireBridge=create('fire_bridge','bridgeSequence',14,4),brazier=linked('fire_bridge','brazier',13,4);
const stoneStairs=create('stairs','collapsingStairs',17,4);
stoneStairs.userData.stairTreads=[new Node(0,0,0),new Node(1,0,0)];
stoneStairs.userData.stairTreads.forEach(t=>stoneStairs.add(t));
const transit=new Node(20,0,4);transit.userData.transitDoor=true;root.add(transit);
const inventoryBefore=Native.inspect(root);
assert.equal(inventoryBefore.mechanisms.size,6);
assert.equal(inventoryBefore.activators.length,5);
assert.equal(inventoryBefore.blocks.length,1);
assert.equal(inventoryBefore.fixedBlocks.length,1);
assert.equal(inventoryBefore.transitDoors.length,1);
Native.namespace(root,2);
assert.equal(plateDoor.userData.mechanismId,'native-v50-f2-door_plate');
assert.equal(plate.userData.linkedMechanismId,'native-v50-f2-door_plate');
let rootsRegistered=0,rootsReleased=0;const hitPuzzles={registerExternalRoot(other){
  assert.equal(other,root);rootsRegistered++;return ()=>rootsReleased++;
}};
const runtime=Native.mount({nativeRoot:root,floor:2,scope:'story-f2',api:generator,THREE,
  DynamicSurfaces:DS,getPlayerPosition:()=>player,getPlayerY,addControl,removeControl,
  hitPuzzles,heightAt:()=>4,showToast(){}});
assert.equal(rootsRegistered,1);
assert.equal(runtime.getState().mechanisms,6);
assert(controls.every(control=>control.floorY===4),
  'all native cube, obelisk, push-block, mechanism and transit controls must be limited to the owning story height');
assert(runtime.getState().families.includes('glyphObelisk')&&runtime.getState().families.includes('brazier'));
const push=controls.find(c=>c.kind==='v50NativePushBlock');
assert(push);
push.onPress();
assert.equal(block.position.x,3,'player pushes the native V50 block along the actual authored path');
assert.equal(pressureSyncs,1,'push rechecks the original V50 pressure plate solver');
assert.equal(controls.filter(c=>c.kind==='v50NativeLinkedCube').length,4);
assert.equal(controls.filter(c=>c.kind==='v50NativeObelisk').length,3);
assert(controls.some(c=>c.kind==='v50NativeTransitDoor'));
assert.equal(runtime.stageCandidate({x:9,z:3,w:3,d:3})?.kind,'glyphObelisk');
runtime.tick(.05);
assert.equal(runtime.isSolved(plateDoor.userData.mechanismId),false,'plate requires real V50 weight signal');
plate.userData.weightProgress=1;runtime.tick(.05);
assert.equal(runtime.isSolved(plateDoor.userData.mechanismId),true);
controls.find(c=>c.kind==='v50NativeLinkedCube').onPress();
runtime.tick(.05);
assert.equal(cubes.userData.lastTurn,0);
assert(runtime.isSolved(cubeDoor.userData.mechanismId),'linked cubes retain their original V50 solver');
for(const control of controls.filter(c=>c.kind==='v50NativeObelisk'))for(let n=0;n<3;n++)control.onPress();
runtime.tick(.05);
assert.equal(runtime.isSolved(obeliskDais.userData.mechanismId),true);
assert.equal(rings.userData.solveProgress,1,'three actual V50 ring alignments solve the obelisk');
glyphBridge.userData.linkedCubePuzzleRoot={userData:{solveProgress:1}};
fireBridge.userData.linkedCubePuzzleRoot={userData:{solveProgress:1}};
runtime.tick(.05);
assert(runtime.isSolved(glyphBridge.userData.mechanismId),'projectile glyph signal is authoritative');
assert(runtime.isSolved(fireBridge.userData.mechanismId),'authentic torch ignition signal is authoritative');
const door=controls.find(c=>c.kind==='v50NativeTransitDoor');
door.onPress();runtime.tick(.05);assert(transit.children.length===0);
assert(blockers.some(record=>record.id.includes('v50-fixed-block')),'immovable native push-route shapers have real upper-story collision');
assert(blockers.length>=4,'door panels, push blocks, transit doors register game collision');
assert(surfaces.length>=4,'moving bridges, daises and stair treads register actual game support');
runtime.dispose();runtime.dispose();
assert.equal(rootsReleased,1,'native torch/glyph roots unregister exactly once');
assert.equal(controls.length,0,'all upper story interactions unregister on exit');
assert.equal(removed.length,surfaces.length+blockers.length,'no 3D supports or blockers survive a reroll');
// Reuse a real V50-authored elevator block curve with a rising native dais.
// This fixture stays independent from the six ordinary mechanisms above.
{
  const liftRoot=new Node(0,4,0),liftDais=new Node(25,0,25),liftSignal=new Node(24,0,25);
  liftDais.userData={mechanismId:'lift',previewMotion:{type:'movingDais'},previewRange:[.05,.34]};
  liftSignal.userData={activatorType:'glyphObelisk',linkedMechanismId:'lift'};
  liftDais.userData.linkedCubePuzzleRoot={userData:{solveProgress:0}};
  const raisedBlock=new Node(25,-.8,25);
  raisedBlock.userData={pushable:true,previewMotion:{type:'elevatorPushBlock'},
    previewRange:[.28,.94],pushPath:[{x:25,y:.13,z:25},{x:26,y:.13,z:25}],
    ridesMovingDais:true};
  liftRoot.add(liftDais);liftRoot.add(liftSignal);liftRoot.add(raisedBlock);
  const liftCalls=[],liftGenerator={
    applyProgress(object,progress){
      liftCalls.push({object,progress});
      if(object!==raisedBlock)return;
      const local=Math.max(0,Math.min(1,(progress-.28)/(.94-.28)));
      raisedBlock.position.y=-.8+(.13+.8)*Math.min(1,local/.45);
      if(local>.45)raisedBlock.position.x=25+(local-.45)/.55;
    },
    syncPressurePlates(){pressureSyncs++;}
  };
  const liftRuntime=Native.mount({nativeRoot:liftRoot,floor:2,scope:'lift-story',api:liftGenerator,THREE,
    DynamicSurfaces:DS,getPlayerPosition:()=>player,getPlayerY,addControl,removeControl,
    hitPuzzles:{registerExternalRoot:()=>()=>{}},heightAt:()=>4,showToast(){}});
  const liftPush=controls.find(c=>c.kind==='v50NativePushBlock');
  assert(liftPush,'the original elevatorPushBlock receives a real interaction');
  player.x=24;player.z=25;player.y=3;liftPush.onPress();
  assert.equal(raisedBlock.position.x,25,'the block cannot move across the room until its elevator rises');
  liftDais.userData.linkedCubePuzzleRoot.userData.solveProgress=1;
  for(let index=0;index<20;index++)liftRuntime.tick(.05);
  assert.equal(liftRuntime.getState().nestedElevatorBlocks,1,'the nested V50 block is linked to its original moving dais');
  assert(Math.abs(raisedBlock.position.y-.13)<.01,'the block rides its original V50 lift curve to the upper route');
  assert(Math.abs(liftPush.floorY-(4+.13-.25))<.01,'interaction prompt follows the raised block rather than the sunken socket');
  player.y=4;liftPush.onPress();
  assert(Math.abs(raisedBlock.position.x-26)<.01,'once raised, the block can be pushed along its actual V50 route');
  assert(liftCalls.some(entry=>entry.object===raisedBlock&&Math.abs(entry.progress-.94)<.001),
    'the push reaches the original V50 elevator-block route endpoint');
  liftRuntime.dispose();assert.equal(controls.length,0,'nested elevator controls release on floor teardown');
}
// Bridge-drop pressure puzzle: ON holds the native bridge; OFF must be
// what physically drops its block onto the final pressure plate.
{
  const dropRoot=new Node(0,4,0),bridge=new Node(30,0,30),onGlyph=new Node(30,0,29);
  bridge.userData={mechanismId:'bridge',previewMotion:{type:'bridgeSequence'},
    linkedCubePuzzleRoot:{userData:{solveProgress:.5}}};
  onGlyph.userData={activatorType:'glyphObelisk',linkedMechanismId:'bridge',bridgeCommand:'ON'};
  const dropBlock=new Node(30.4,0,30);
  dropBlock.userData={pushable:true,previewMotion:{type:'pushPuzzleBlock'},
    dropOntoPlateAfterRetraction:true,pushPath:[{x:30.4,y:0,z:30},{x:31.4,y:0,z:30},{x:31.4,y:-1.1,z:30}]};
  const plate=new Node(31.4,-1.1,30);
  plate.userData={activatorType:'pressurePlate',linkedMechanismId:'door',
    previewMotion:{type:'pressurePlate'},weightProgress:0,linkedWeightBlock:dropBlock};
  const door=new Node(34,0,30);
  door.userData={mechanismId:'door',previewMotion:{type:'stoneDoor'},linkedPressurePlateRoot:plate};
  for(const object of [bridge,onGlyph,dropBlock,plate,door])dropRoot.add(object);
  let dropsSynced=0;const api={
    applyProgress(){},
    syncPressurePlates(){
      dropsSynced++;
      plate.userData.weightProgress=Math.abs(dropBlock.position.y+1.1)<.01?1:0;
    }
  };
  const dropRuntime=Native.mount({nativeRoot:dropRoot,floor:2,scope:'drop-story',api,THREE,
    DynamicSurfaces:DS,getPlayerPosition:()=>player,getPlayerY,addControl,removeControl,
    hitPuzzles:{registerExternalRoot:()=>()=>{}},heightAt:()=>4,showToast(){}});
  const pushing=controls.find(c=>c.kind==='v50NativePushBlock');
  assert(pushing,'native bridge-drop burden must receive its own push interaction');
  assert.equal(dropRuntime.stageCandidate({x:29,z:28,w:3,d:3}),null,
    'a preparatory ON glyph never substitutes for the final pressure-plate solution');
  player.x=29.4;player.z=30;player.y=4;
  pushing.onPress();assert.equal(dropBlock.position.x,30.4,
    'block cannot be pushed onto a bridge before the ON command extends it');
  for(let i=0;i<9;i++)dropRuntime.tick(.05);
  pushing.onPress();
  assert.equal(dropBlock.position.x,31.4,'the block travels across V50\'s bridge to the final ledge');
  pushing.onPress();assert.equal(dropBlock.position.y,0,
    'the last V50 path node is a vertical fall and cannot be solved by another push');
  bridge.userData.linkedCubePuzzleRoot.userData.solveProgress=0; // Authored OFF glyph retracts the native bridge.
  for(let i=0;i<20;i++)dropRuntime.tick(.05);
  assert(Math.abs(dropBlock.position.y+1.1)<.01,'with support removed, gravity moves the real block onto its plate');
  assert.equal(dropRuntime.getState().completedBridgeDrops,1);
  assert(dropsSynced>0,'the native plate recalculates once the block actually lands');
  dropRuntime.tick(.05);
  assert.equal(dropRuntime.isSolved('door'),true,
    'the lower pressure plate, rather than the bridge glyph, unlocks the final V50 door');
  dropRuntime.dispose();assert.equal(controls.length,0);
}
console.log('ok V50 native authored puzzles: plates, blocks, glyphs, torches, ring obelisks, linked cubes, moving stone, transit controls, cleanup');
