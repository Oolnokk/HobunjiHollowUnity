#!/usr/bin/env node
'use strict';
// Exercise the actual shipped hit-puzzle functions: native stories can share
// X/Z, but a physical floor Y difference must prevent pickup/prompt theft.
const assert=require('node:assert/strict');
const fs=require('node:fs'); // Loads the shipped puzzle runtime rather than a reimplemented reach calculation.
const vm=require('node:vm');
const source=fs.readFileSync('docs/js/dev-random-ruin-hit-puzzles.js','utf8');
function shippedFunction(start,end){
  const a=source.indexOf('  function '+start+'('),b=source.indexOf('  function '+end+'(',a+1);
  assert(a>=0&&b>a,'Missing shipped function '+start);
  return source.slice(a,b);
}
let physicalY=0,meshY=0,called=0;
const low={box:{min:{x:10,y:0,z:10},max:{x:10.6,y:.85,z:10.6}}};
const high={box:{min:{x:10,y:4,z:10},max:{x:10.6,y:4.85,z:10.6}}};
const distant={box:{min:{x:20,y:0,z:20},max:{x:20.6,y:.85,z:20.6}}};
const frame={
  PLAYER_REACH_HEIGHT:1.65,PLAYER_REACH_BELOW:.18,CONTROL_RANGE:1.65,MAP_ID:'map_i_dev_random_ruin',
  window:{DevRandomRuin:{getPlayerGroundSupportY:()=>physicalY,getPlayerSupportY:()=>meshY}},
  devDeps:{playerMesh:{position:{y:meshY}}},
  DS:{sampleSupport:()=>({y:17})},
  currentPlayerWorld:()=>({x:10.3,z:10.3}),boxFor:object=>object.box,
  torchSources:[high],temporaryTorches:[],ladders:[high],glyphTargets:[{object:high}],ignitionTargets:[{object:high}],
  carriedTorch:null,root:{},currentArea:()=> 'map_i_dev_random_ruin',
  spawnSourceTorch:()=>{called++;return true;},pickupDroppedTorch:()=>{called++;return true;},
};
vm.createContext(frame);
vm.runInContext([
  shippedFunction('currentSupportY','boxFor'),
  shippedFunction('worldDistanceTo','rootContainsActivatorDescendant'),
  shippedFunction('nearestPickupControl','nearestLadderDistance'),
  shippedFunction('nearestLadderDistance','updateInteractionSuppression'),
  shippedFunction('updateInteractionSuppression','installInputBindingGuard'),
].join('\n'),frame);
function atFloor(y){physicalY=y;meshY=y;}
atFloor(0);
assert.equal(frame.currentSupportY(),0,'zero is a valid physical floor elevation');
assert.equal(frame.worldDistanceTo(low),0,'same-floor prop is reachable from its actual bounding box');
assert(frame.worldDistanceTo(high)>1.65,'upper-floor torch cannot be reached through the ceiling');
assert.equal(frame.nearestPickupControl(),null,'upper-floor torch pickup is not offered on the lower story');
frame.updateInteractionSuppression();
assert.equal(frame.suppressedBaseInteract,false,'upper-floor glyph, ignition and ladder must not steal input below');
frame.torchSources.push(low);
frame.ladders.push(low);frame.glyphTargets.push({object:low});
const lowPickup=frame.nearestPickupControl();
assert(lowPickup&&lowPickup.object===low,'same-floor torch remains reachable');
assert.equal(lowPickup.onPress(),true);assert.equal(called,1);
frame.updateInteractionSuppression();assert.equal(frame.suppressedBaseInteract,true);
atFloor(4);
assert(frame.worldDistanceTo(low)>1.65,'lower-story torch cannot be reached from above');
const upstairs=frame.nearestPickupControl();
assert(upstairs&&upstairs.object===high,'upper-floor torch is selected over a horizontally coincident lower source');
assert.equal(upstairs.onPress(),true);assert.equal(called,2);
frame.torchSources.splice(0);frame.torchSources.push(low);
assert.equal(frame.nearestPickupControl(),null,'lower-story source is never picked upstairs');
frame.temporaryTorches.push({group:low,status:'dropped',lit:true});
assert.equal(frame.nearestPickupControl(),null,'dropped lower-story torch cannot be picked from another floor');
atFloor(0);
assert.equal(frame.nearestPickupControl()?.kind,'droppedTorch','dropped torch still works on its own floor');
// The authoritative support must win over an animated player-mesh offset.
physicalY=0;meshY=4;frame.window.DevRandomRuin.getPlayerSupportY=()=>4;
assert.equal(frame.currentSupportY(),0,'physical support wins over the apparent presentation elevation');
assert.equal(frame.nearestPickupControl()?.kind,'droppedTorch');
// Even a cached pickup callback must recheck reach after the player changes floors.
const stale=frame.nearestPickupControl();physicalY=4;
assert.equal(stale.onPress(),false,'stale lower-story torch callback is rejected upstairs');
assert.equal(called,2);
frame.window.DevRandomRuin.getPlayerGroundSupportY=()=>null;
assert.equal(frame.currentSupportY(),4,'when physical support is absent, presentation height is the fallback');
console.log('ok stacked V50 proximity: real floor heights, overlapping X/Z, torch pickup and drop, glyphs, ladders, stale callbacks');
