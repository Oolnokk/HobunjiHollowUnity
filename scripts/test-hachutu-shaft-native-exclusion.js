#!/usr/bin/env node
'use strict';
// Hachutu keeps the physical multistory shaft but not V50's unrelated
// randomly authored upper-floor puzzle maps. Other ruins still get native V50.
const assert=require('node:assert/strict');
const fs=require('node:fs'); // Check the shipped generator branch instead of maintaining a second set of rules.
const Plan=require('../docs/js/ruin-layer-plan.js');
const source=fs.readFileSync('docs/js/dev-random-ruin-interior-map.js','utf8');
assert(source.includes("singleVestibule=requestedRuinType!=='hachutu'&&!stoneAgeRequested")
  &&source.includes("nativeV50:requestedRuinType!=='hachutu'"),
  'Hachutu keeps its original temple entrance while normal ruins plan upper V50 stories after inspecting the one native entrance room');
assert(source.includes('if(planned.nativeFloorCount){')&&source.includes('await window.RuinV50NativeFloors.generateFloors({'),
  'the game must skip V50 upper-floor generator calls when no native stories were reserved');
for(const seed of [1,22,96,0x6ac4b078]){
  const standard=Plan.compose({seed,anchorX:320,anchorZ:320,nativeV50:true});
  const temple=Plan.compose({seed,anchorX:320,anchorZ:320,nativeV50:false});
  assert(standard.ok&&temple.ok,'both normal and special Hachutu layouts remain valid');
  assert.equal(standard.nativeFloorCount,standard.floorCount-1);
  assert.equal(temple.nativeFloorCount,0,'Hachutu must not generate unrelated native V50 puzzle maps');
  assert(temple.floorCount>=3&&temple.floors.some(f=>f.wings.length),
    'Hachutu must preserve the real multi-floor octagonal shaft and authored wing rooms');
}
console.log('ok Hachutu multi-floor exception: no unrelated native V50 generation, real walkable shaft/wing architecture preserved');
