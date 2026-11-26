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
// A touching tall blocker must never be selected as the target's opening.
vm.runInContext(bridge.slice(bridge.indexOf('  function choosePillarShotSide('),bridge.indexOf('  // Run once, after every V50 prop')),context);
const chooseFace=context.choosePillarShotSide;
const origin={x:0,y:1.5,z:0}, openFloor=()=>true;
const box=(minX,maxX,minZ,maxZ,minY=0,maxY=3)=>({min:{x:minX,y:minY,z:minZ},max:{x:maxX,y:maxY,z:maxZ}});
const blockers={
  north:box(-.5,.5,-1.2,-.24),east:box(.24,1.2,-.5,.5),
  south:box(-.5,.5,.24,1.2),west:box(-1.2,-.24,-.5,.5),
};
for(const side of Object.keys(blockers)){
  assert.equal(chooseFace(origin,side,[],openFloor),side,'preserves clear authored orientation');
  assert.notEqual(chooseFace(origin,side,[blockers[side]],openFloor),side,'touching tall box blocks '+side);
  assert.equal(chooseFace(origin,side,Object.values(blockers),openFloor),null,'rejects fully enclosed pillar');
  assert.equal(chooseFace(origin,side,Object.entries(blockers).filter(([key])=>key!==side).map(([,value])=>value),openFloor),side,'accepts only clear face');
}
assert.equal(chooseFace(origin,'north',[box(-.5,.5,-1.2,-.24,0,.6)],openFloor),'north','low scenery below shot is not cover');
assert.equal(chooseFace(origin,'north',[],(_x,z)=>z>=0),'east','opening must face supported floor');
assert.equal(chooseFace(origin,'north',[],()=>false),null,'no shooting approach on missing floor');
// Exercise the scene-level correction and metadata, not just the pure side selector.
const fixtureContext=vm.createContext({
  THREE:{
    Vector3:class {constructor(x=0,y=0,z=0){this.set(x,y,z);}set(x,y,z){Object.assign(this,{x,y,z});return this;}},
    Box3:class {setFromObject(o){this.value=o.box;return this;}getCenter(out){const {min,max}=this.value;return out.set((min.x+max.x)/2,(min.y+max.y)/2,(min.z+max.z)/2);}}
  },
  sideDirection:side=>({north:{dx:0,dz:-1},east:{dx:1,dz:0},south:{dx:0,dz:1},west:{dx:-1,dz:0}}[side]),
  yawForLocalNegativeZ:(dx,dz)=>Math.atan2(-dx,-dz),
  DEG:Math.PI/180,
});
vm.runInContext(bridge.slice(bridge.indexOf('  function choosePillarShotSide('),bridge.indexOf('  function normalizeLayoutReservation(')),fixtureContext);
function clearanceFixture(solidBoxes, embedded=true){
  const core={userData:embedded?{pillarNicheMouthZ:-.24}:{obeliskProfile:'pillarHoused'},box:box(-.1,.1,-.1,.1,1.4,1.6)};
  const housing={id:1,userData:{hiddenActivatorMount:'pillarNiche',openingSide:'north',pillarSlotKey:'room:5,5'},
    children:[core],rotation:{y:0},box:box(-.39,.39,-.39,.39,0,2),
    updateMatrixWorld(){},getWorldPosition:out=>out.set(0,0,0)};
  core.parent=housing;
  const meshes=solidBoxes.map(bounds=>({isMesh:true,userData:{},visible:true,material:{},geometry:{
    boundingBox:{clone:()=>({...bounds,applyMatrix4(){return this;},isEmpty:()=>false})}
  }}));
  const root={userData:{},children:[housing,...meshes],updateMatrixWorld(){},worldToLocal:v=>v,
    traverse(fn){fn(this);fn(housing);fn(core);for(const mesh of meshes)fn(mesh);}};
  housing.parent=root;for(const mesh of meshes)mesh.parent=root;
  const anchor={pillarSlotKey:'room:5,5',openingSide:'north'};
  const record={rot:0,previewRuin:{mountType:'pillarNiche',...anchor}};
  const floorCells=Array.from({length:36},(_,i)=>[i%6,Math.floor(i/6)]);
  const locale={objects:[record],meta:{interiorShell:{floorCells,cellSize:.5,worldWidth:3,worldDepth:3,movingParts:[{anchors:[anchor]}]}}};
  return {root,locale,housing,anchor,record};
}
for(const embedded of [true,false]){
  const fixture=clearanceFixture([blockers.north],embedded);
  const result=fixtureContext.ensurePillarShotClearance(fixture.root,fixture.locale);
  assert.equal(result.checked,1);assert.equal(result.turned,1);
  assert.equal(fixture.housing.userData.openingSide,'east');
  assert.equal(fixture.housing.rotation.y,-Math.PI/2);
  assert.equal(fixture.anchor.openingSide,'east');assert.equal(fixture.record.previewRuin.openingSide,'east');
  assert.equal(fixture.record.rot,-90);
}
const trapped=clearanceFixture(Object.values(blockers));
assert.throws(()=>fixtureContext.ensurePillarShotClearance(trapped.root,trapped.locale),{name:'V50PillarClearanceError'});
console.log('ok pillar projectile clearance: four orientations, touching cover, floor and elevation');
assert.equal(context.normalizeLayoutReservation(null),null);
assert.throws(()=>context.normalizeLayoutReservation({w:180}),/Invalid/);
let accepted=0; // Count usable native stage paths over actual generated networks.
let shortHalls=0,totalHalls=0,fullPuzzleHalls=0; // Regression metrics: short room links and preserved puzzle-capable hallways.
for(let seed=0;seed<200;seed++){
  const plan=Plan.compose({seed,anchorX:320,anchorZ:320,nativeV50:true});
  assert(plan.ok);
  const floor=plan.floors[1];
  context.window.__devRuinLayoutReservation=context.normalizeLayoutReservation({...floor.nativePort.reservation,floor:1,y:4,tileScale:2});
  const network=context.generateInteriorRoomNetwork({kind:'small'},context.seededRng(Native.nativeSeed(seed,1)),.62,{min:6,max:8});
  assert.equal(network.rooms.length,network.targetRooms);
  const compact=network.hallways.filter(hall=>(hall.axis==='x'?hall.w:hall.h)<=4); // Short V50 corridors must actually occur in generated room graphs.
  shortHalls+=compact.length;totalHalls+=network.hallways.length;
  fullPuzzleHalls+=network.hallways.filter(hall=>(hall.axis==='x'?hall.w:hall.h)>=5).length;
  assert(network.hallways.every(hall=>(hall.axis==='x'?hall.h:hall.w)>=5),'do not shrink playable doorway widths');
  assert(network.hallways.every(hall=>(hall.axis==='x'?hall.w:hall.h)>=5),'reserved V50 stages retain tested 5+ cell hallway lengths');
  assert(network.cols<=180&&network.rows<=180);
  for(const rect of [...network.rooms,...network.hallways]){
    assert(rect.col>=2&&rect.row>=2&&rect.col+rect.w<=178&&rect.row+rect.h<=178);
  }
  const meta={...network,gridCols:network.cols,gridRows:network.rows,
    floorCells:[...network.floorSet].map(k=>k.split(',').map(Number)),dungeonProgression:network.progression};
  if(Native.analyze(meta).ok)accepted++;
}
assert(accepted>150,`native topology acceptance unexpectedly low: ${accepted}`);
assert.equal(shortHalls,0,'reserved native floors retain unchanged hallway lengths');
let compactHalls=0,unreservedHalls=0; // Standalone V50 networks should still use compact 2–4-cell passages.
context.window.__devRuinLayoutReservation=null;
for(let seed=0;seed<120;seed++){
  const network=context.generateInteriorRoomNetwork({kind:'small'},context.seededRng(seed),.62,{min:6,max:8});
  compactHalls+=network.hallways.filter(hall=>(hall.axis==='x'?hall.w:hall.h)<=4).length;
  unreservedHalls+=network.hallways.length;
  assert(network.hallways.every(hall=>(hall.axis==='x'?hall.h:hall.w)>=5),'standalone hallways keep player width');
}
assert(compactHalls>unreservedHalls*.2,`standalone corridors failed to compact (${compactHalls}/${unreservedHalls})`);
assert(fullPuzzleHalls>=200*2,'retain puzzle-capable halls on every V50 floor');
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
