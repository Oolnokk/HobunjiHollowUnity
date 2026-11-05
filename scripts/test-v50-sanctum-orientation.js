#!/usr/bin/env node
'use strict';
// Polished entry geometry: the physical shaft must not share ground tiles with
// the endgame-only boss sanctum, even when V50 authors an east-facing doorway.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const script=fs.readFileSync('docs/js/dev-random-ruin-sanctum.js','utf8');
const runtime=fs.readFileSync('docs/js/dev-random-ruin-interior-map.js','utf8');
const windowMock={THREE:{},DynamicSurfaces:{},
  DevRandomRuinSimplePuzzles:{registerComposer(){}},
  DevRandomRuinConfig:{get:(_key,fallback)=>fallback}};
new Function('window','THREE',script)(windowMock,windowMock.THREE);
const Sanctum=windowMock.DevRandomRuinSanctum;
assert(Sanctum?.reserve&&Sanctum?.planLayout,'real sanctum reservation API must be exported');
const dims={aw:14,ad:14,vw:8,vd:6};
const center=256,shaftMin=center-24,shaftMax=center+24; // Same physical shell width used by the 33+2×8 octagonal shaft.
let cases=0; // Stress the compact east doorway across many positive translations and room-grid sizes.
for(const leftOfX of [110,150,180,200,220,230]){
  for(const baseRows of [64,160,280]){
    const reserved=Sanctum.reserve(leftOfX+30,baseRows,{leftOfX});
    const area=reserved.plan;
    assert(area.westPlacement);
    assert(area.arena.minX>=2,'boss arena must not cross world origin');
    assert(area.vault.maxX<leftOfX,'complete boss passage and vault must fit west of V50 room');
    assert([...reserved.tiles].every(cell=>Number(cell.split(',')[0])<leftOfX),
      'no sanctuary walkable tile may cross the entry chamber into the physical shaft');
    assert.equal(reserved.cols,leftOfX+30,
      'west-side reservation must not unnecessarily extend the ground-level map width');
    assert(![...reserved.tiles].some(cell=>{
      const [x,z]=cell.split(',').map(Number);
      return x>=shaftMin&&x<=shaftMax&&z>=232&&z<=280;
    }),'east-facing shaft masonry must never overlap sanctuary floor');
    cases++;
  }
}
assert(runtime.includes('options.compactVestibule&&meta.entrance?.side'),
  'only a compact east-facing entrance may relocate the sanctum');
assert(runtime.includes('sanctumPlan:projected.sanctumPlan'),
  'the reserved boss geometry must be preserved with the actual generated map record');
assert(runtime.includes('shaftEntrance:ruin.compactVestibule'),
  'the Great Door must know to avoid the physical V50 shaft entrance');
assert(script.includes('context?.sanctumPlan?.arena'),
  'sanctum scene construction must reuse the same west-side reservation');
console.log('ok '+cases+' boss sanctuary placements: shaft clearance, east-facing entry, exact reserved geometry');
