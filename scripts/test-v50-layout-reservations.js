#!/usr/bin/env node
'use strict';
// Execute the shipped embedded patches and V50's real room-placement code.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Native = require('../docs/js/ruin-v50-native-floors.js');
const Plan = require('../docs/js/ruin-layer-plan.js');
const bootstrap = fs.readFileSync('docs/tools/debris-ifier/debrisifier-01.js', 'utf8'); // Real guarded patch list.
const original = fs.readFileSync('docs/tools/debris-ifier/debrisifier-v50-source.js', 'utf8'); // Immutable generator.
const context = vm.createContext({window:{}, EMBEDDED_TREE:'unused', SOURCE_SHA256:'unused', EMBEDDED_FURNITURE_COUNT:11});
vm.runInContext(bootstrap.slice(bootstrap.indexOf('  function patchEmbeddedRuntime('), bootstrap.lastIndexOf('\n  if (embeddedRuntime)')), context);
const patched = context.patchEmbeddedRuntime(original); // Also fails if any patch no longer matches its source.
vm.runInContext(`const INTERIOR_CELL_SIZE=.5;const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function doorwaySideForRoom(room,door){return door.axis==='x'?(door.boundary===room.col?'west':'east'):(door.boundary===room.row?'north':'south');}
  ${original.match(/function seededRng\(seedText\).*\n/)[0]}
  ${patched.slice(patched.indexOf('function addInteriorRectToFloorSet('),patched.indexOf('function mergeInteriorSegments('))}
`, context);
const bridge = fs.readFileSync('docs/tools/debris-ifier/debrisifier-v50-api.js','utf8'); // Validate the public API's input contract as well as placement.
vm.runInContext(bridge.slice(bridge.indexOf('  function normalizeLayoutReservation('),bridge.indexOf('  async function generateInteriorLocale(')),context);
assert.equal(context.normalizeLayoutReservation(null),null);
assert.throws(()=>context.normalizeLayoutReservation({w:180}),/Invalid/);
let accepted=0; // Count usable native stage paths over actual generated networks.
for(let seed=0;seed<200;seed++){
  const plan=Plan.compose({seed,anchorX:320,anchorZ:320,nativeV50:true});
  assert(plan.ok);
  const floor=plan.floors[1];
  context.window.__devRuinLayoutReservation=context.normalizeLayoutReservation({...floor.nativePort.reservation,floor:1,y:4,tileScale:2});
  const network=context.generateInteriorRoomNetwork({kind:'small'},context.seededRng(Native.nativeSeed(seed,1)),.62,{min:6,max:8});
  assert.equal(network.rooms.length,network.targetRooms);
  assert(network.cols<=180&&network.rows<=180);
  for(const rect of [...network.rooms,...network.hallways]){
    assert(rect.col>=2&&rect.row>=2&&rect.col+rect.w<=178&&rect.row+rect.h<=178);
  }
  const meta={...network,gridCols:network.cols,gridRows:network.rows,
    floorCells:[...network.floorSet].map(k=>k.split(',').map(Number)),dungeonProgression:network.progression};
  if(Native.analyze(meta).ok)accepted++;
}
assert(accepted>150,`native topology acceptance unexpectedly low: ${accepted}`);
// A constrained allocation must alter placement, not only reject its final result.
context.window.__devRuinLayoutReservation={w:50,d:50,tileScale:2};
let constrained=0; // Tight layouts may legitimately exhaust placement; they must never escape the budget.
for(let seed=0;seed<30;seed++){
  try{
    const network=context.generateInteriorRoomNetwork({kind:'small'},context.seededRng(seed),.62,{min:6,max:6});
    assert(network.cols<=50&&network.rows<=50);constrained++;
  }catch(error){assert.match(error.message,/could not place required room/);}
}
assert(constrained>0,'bounded placement still finds complete room networks');
context.window.__devRuinLayoutReservation={w:8,d:8,tileScale:2};
assert.throws(()=>context.generateInteriorRoomNetwork({kind:'small'},context.seededRng(1),.62),/First V50 room/);
context.window.__devRuinLayoutReservation=null;
assert.equal(context.generateInteriorRoomNetwork({kind:'small'},context.seededRng(1),.62,{min:6,max:6}).rooms.length,6);
console.log(`ok real V50 reservations: 200 full layouts, ${accepted} stage paths, ${constrained} tight allocations, invalid bounds and reset`);

(async()=>{
  const plan=Plan.compose({seed:22,anchorX:320,anchorZ:320,nativeV50:true}); // Exercise the same owner called by the game, with the real V50 layout function.
  const calls=[],snapshots=[],records=[]; // Observe iframe handoffs and caller-owned cleanup snapshots.
  let injectedFailure=false;
  const api={
    async generateInteriorLocale(options){
      calls.push(options);
      if(!injectedFailure){injectedFailure=true;throw new Error('placement exhausted');}
      context.window.__devRuinLayoutReservation=context.normalizeLayoutReservation(options.layoutReservation);
      const network=context.generateInteriorRoomNetwork({kind:options.size},context.seededRng(options.seed),.62,{min:options.roomMin,max:options.roomMax});
      return {locale:{meta:{interiorShell:{...network,gridCols:network.cols,gridRows:network.rows,
        floorCells:[...network.floorSet].map(k=>k.split(',').map(Number)),dungeonProgression:network.progression,
        layoutReservation:{...options.layoutReservation}}}}};
    },
    snapMechanismState(value){assert.equal(value,0,'native V50 puzzle actors must remain unsolved after being transferred to the game');},
    takePreviewRoots(options){snapshots.push(options);return {localeRoot:{floor:options.floor}};},
  };
  assert.equal(await Native.generateFloors({api,plan,seed:22,records,pieceSet:'stoneAge',floorProps:'pillarsOnly'}),records);
  assert.equal(records.length,plan.nativeFloorCount);
  assert.equal(snapshots.length,records.length,'failed attempts never transfer stale roots');
  assert(calls[0].seed!==calls[1].seed,'a failed placement gets a deterministic new seed');
  for(const call of calls){
    const floor=plan.floors[call.layoutReservation.floor];
    assert.deepEqual(call.layoutReservation,{...floor.nativePort.reservation,floor:floor.floor,y:floor.y,tileScale:2});
    assert.equal(call.pieceSet,'stoneAge');assert.equal(call.floorProps,'pillarsOnly');
    assert.deepEqual(call.puzzles,{pressurePlate:true,brazier:true,glyphObelisk:true,
      stackedObelisk:true,linkedCubePillars:true,nestedRoom:true,maxPerRoom:2},
      'each V50 upper floor should independently author the entire original puzzle repertoire');
  }
  let failures=0;
  await assert.rejects(Native.generateFloors({api:{...api,async generateInteriorLocale(){failures++;throw new Error('no room');}},plan,seed:22}),/no room/);
  assert.equal(failures,6,'allocation failures stop after the bounded retry budget');
  console.log(`ok generation-to-mount contract: ${records.length} real floor graphs, retries, exact allocations, scene ownership`);
})().catch(error=>{console.error(error);process.exitCode=1;});
