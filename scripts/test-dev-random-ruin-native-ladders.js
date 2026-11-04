#!/usr/bin/env node
'use strict';
// The real floor-zero ladder provider must discover V50 native-story ladders
// and choose their interaction by physical height, not identical map X/Z.
const assert=require('node:assert/strict');
const fs=require('node:fs'); // Reads the actual browser ladder implementation, including the climb starting-height calculation.
const vm=require('node:vm');
const source=fs.readFileSync('docs/js/dev-random-ruin-interactions.js','utf8');
function shippedFunction(start,end){
  const a=source.indexOf('  function '+start+'('),b=source.indexOf('  function '+end+'(',a+1);
  assert(a>=0&&b>a,'Missing shipped ladder function '+start);
  return source.slice(a,b);
}
const makeRoot=(children=[])=>({parent:{},traverse(visit){
  visit(this);children.forEach(child=>visit(child));
}});
const low={userData:{generatedAccessType:'stoneLadder',ladderHeight:1.5},floor:0,x:10,z:10};
const high={userData:{generatedAccessType:'stoneLadder',ladderHeight:1.5},floor:4,x:10,z:10};
const base=makeRoot([low]),native=makeRoot([high]);
let physicalY=0,tagged=0,climbed=null,nativeAvailable=true;
const frame={
  root:base,preparedRoot:null,ladders:[],lastSemanticScanAt:-Infinity,
  SEMANTIC_RESCAN_MS:250,LADDER_RANGE:1.7,
  ruinRoot:()=>base,tagLadder:()=>{tagged++;},
  playerWorldPosition:()=>({x:10,z:10,y:physicalY}),
  worldPosition:object=>({x:object.x,z:object.z,y:object.floor}),
  window:{
    DevRandomRuinHitPuzzles:{
      getNativeRoots:()=>nativeAvailable?[native]:[],
      distanceToWorldObject:ladder=>Math.max(0,Math.abs(ladder.floor-physicalY)-.3),
    },
    DevRandomRuin:{getPlayerGroundSupportY:()=>physicalY,
      setPlayerWorldPoint(){return false;}},
    ClimbSystem:{startScriptedWorldClimb:args=>{climbed=args;return true;}},
  },
  deps:{player:{x:10,y:10},TILE:1,playerMesh:{position:{y:8}},showToast(){}},
  DS:{sampleSupport:()=>({y:8})}, // Would erroneously select a floor far above the player without the physical-height fix.
  chooseLadderEndpoints:()=>({bottom:{x:10,y:0,z:10},top:{x:10,y:1.5,z:10}}),
};
vm.createContext(frame);
vm.runInContext([
  shippedFunction('prepareSemanticObjects','kindMatches'),
  shippedFunction('nearestLadder','supportCandidatesForLadder'),
  shippedFunction('climbLadder','controlWorldPoint'),
].join('\n'),frame);
frame.prepareSemanticObjects(0);
assert.equal(frame.ladders.length,2,'the entrance-floor and native-story ladder roots both register');
assert.equal(tagged,2);
assert.equal(frame.nearestLadder()?.ladder,low,'the low-story ladder wins with overlapping coordinates');
assert.equal(frame.climbLadder(low),true);
assert.equal(climbed.startWorldY,0,'climb starts at physical support, not the highest DynamicSurfaces floor or player mesh Y');
physicalY=4;
assert.equal(frame.nearestLadder()?.ladder,high,'the upper-story ladder wins when the player climbs up');
nativeAvailable=false;native.parent=null;
frame.prepareSemanticObjects(300);
assert.equal(frame.ladders.length,1,'native ladder registrations disappear after upper-floor teardown');
assert.equal(frame.nearestLadder(),null,'upper-story player cannot select a lower-story ladder after teardown');
console.log('ok V50 native ladders: both story roots scanned, nearest by physical Y, correct climb height, native cleanup');
