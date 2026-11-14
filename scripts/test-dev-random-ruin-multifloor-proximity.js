#!/usr/bin/env node
'use strict';
// Exercise the actual shipped hit-puzzle functions: native stories can share
// X/Z, but a physical floor Y difference must prevent fire-contact/prompt theft.
const assert=require('node:assert/strict');
const fs=require('node:fs'); // Loads the shipped puzzle runtime rather than a reimplemented reach calculation.
const vm=require('node:vm');
const source=fs.readFileSync('docs/js/dev-random-ruin-hit-puzzles.js','utf8');
function shippedFunction(start,end){
  const a=source.indexOf('  function '+start+'('),b=source.indexOf('  function '+end+'(',a+1);
  assert(a>=0&&b>a,'Missing shipped function '+start);
  return source.slice(a,b);
}
let physicalY=0,meshY=0; // Physical floor height wins over animated presentation height.
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
  // Legacy pickup callbacks are deliberately absent: fixed braziers ignite inventory torches.
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
assert.equal(frame.worldDistanceTo(low),0,'same-floor fire hazard is reachable from its actual bounding box');
assert(frame.worldDistanceTo(high)>1.65,'upper-floor fire source cannot be reached through the ceiling');
assert.equal(frame.nearestPickupControl(),null,'upper-floor fire source never dispenses temporary torches');
frame.updateInteractionSuppression();
assert.equal(frame.suppressedBaseInteract,false,'upper-floor glyph, ignition and ladder must not steal input below');
frame.torchSources.push(low);
frame.ladders.push(low);frame.glyphTargets.push({object:low});
assert.equal(frame.nearestPickupControl(),null,'same-floor fixed fire source never dispenses a torch');
frame.updateInteractionSuppression();
assert.equal(frame.suppressedBaseInteract,true,'nearby hit-driven targets still suppress misleading Interact prompts');
atFloor(4);
assert(frame.worldDistanceTo(low)>1.65,'lower-story fire source cannot be reached through the upper floor');
assert.equal(frame.worldDistanceTo(high),0,'same-story upper fire source is reachable');
assert.equal(frame.nearestPickupControl(),null,'upper-floor source also never dispenses a torch');
frame.temporaryTorches.push({group:low,status:'dropped',lit:true});
assert.equal(frame.nearestPickupControl(),null,'legacy dropped torches are not pickups in the new system');
atFloor(0);
assert.equal(frame.nearestPickupControl(),null,'no legacy torch pickup can return after descending');
// The authoritative support must win over an animated player-mesh offset.
physicalY=0;meshY=4;frame.window.DevRandomRuin.getPlayerSupportY=()=>4;
assert.equal(frame.currentSupportY(),0,'physical support wins over apparent elevation');
frame.window.DevRandomRuin.getPlayerGroundSupportY=()=>null;
assert.equal(frame.currentSupportY(),4,'when physical support is absent, presentation height is the fallback');
assert.match(source,/source\.userData\.fireHazard = true/,'V50 lit sources must expose the fireHazard tag');
assert.match(source,/isIgnitionSourceAlongSegment/,'real V50 source geometry must be accessible to the equipped torch');
console.log('ok stacked V50 proximity: real floor heights, stationary torch fire hazards, no temporary pickups, glyphs and ladders');
