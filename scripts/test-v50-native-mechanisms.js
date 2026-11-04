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
const THREE={Box3,Vector3},root=new Node(),controls=[],surfaces=[],blockers=[],removed=[],calls=[];
const DS={
  registerSurface:def=>surfaces.push(def),registerBlocker:def=>blockers.push(def),
  remove:id=>removed.push(id)
};
const generator={
  applyProgress(object,value){calls.push({object,value});},
  syncPressurePlates(object){assert.equal(object,root);},
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
assert(runtime.getState().families.includes('glyphObelisk')&&runtime.getState().families.includes('brazier'));
assert(controls.some(c=>c.kind==='v50NativePushBlock'));
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
assert(blockers.length>=4,'door panels, push blocks, transit doors register game collision');
assert(surfaces.length>=4,'moving bridges, daises and stair treads register actual game support');
runtime.dispose();runtime.dispose();
assert.equal(rootsReleased,1,'native torch/glyph roots unregister exactly once');
assert.equal(controls.length,0,'all upper story interactions unregister on exit');
assert.equal(removed.length,surfaces.length+blockers.length,'no 3D supports or blockers survive a reroll');
console.log('ok V50 native authored puzzles: plates, blocks, glyphs, torches, ring obelisks, linked cubes, moving stone, transit controls, cleanup');
