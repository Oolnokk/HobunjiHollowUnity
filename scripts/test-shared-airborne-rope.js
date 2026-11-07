#!/usr/bin/env node
'use strict';
// Exercises the real shared PlayerJump + RopeCore + HangingRopes runtime without WebGL.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const jumpSource = read('docs/js/player-jump.js'); // Shared airborne state under test.
const ropeSource = read('docs/js/hanging-ropes.js'); // Outdoor rope riding and automatic catch owner.
const ruinSource = read('docs/js/dev-random-ruin-simple-puzzles.js'); // Ruin integration must retain special hazards.
for (const [name, source] of [['player-jump',jumpSource],['hanging-ropes',ropeSource],['ruin-ropes',ruinSource]]) {
  new vm.Script(source, { filename:name });
}
assert(ruinSource.includes('catchAirborneRope, // Called by PlayerJump'), 'ruins publish auto grab to ordinary jumps');
assert(ruinSource.includes('external:true, source:\'ruin rope swing\''), 'ruin release creates shared airborne state');
assert(ruinSource.includes('PlayerJump?.airControl?.(0.6)'), 'ruin free flight allows direction while retaining the release velocity');
assert(ruinSource.includes('PlayerJump?.syncExternalFlight?.(f)'), 'ruin renderer receives the shared physical feet');

const TILE=64; // Same unit conversion as the live game's player coordinates.
function world() {
  const grid=Array.from({length:9},()=>Array.from({length:9},()=>({type:'floor',surfaceY:0})));
  const player={x:2.5*TILE,y:3.5*TILE,health:100,climbing:false}; // Actor whose sole airborne record is tested.
  const input={x:0,y:0}; // Live movement intent, including during falls and launches.
  const window={
    RopeCore:require('../docs/js/rope-core.js'),
    MapBoundaryGuard:{isBoundaryTile:()=>false},
    GridTileAccessors:{getCurrentArea:()=> 'zone-test'},
    DynamicSurfaces:{sampleSupport:()=>null,blockerAt:()=>false},
    FallSystem:{land:()=>null},
    Combat:{deps:{player,TILE,showToast:()=>{}}},
  };
  const context={window,console,performance:{now:()=>1000}};
  vm.runInNewContext(jumpSource,context,{filename:'player-jump.js'});
  window.PlayerJump.init({
    player,TILE,getCurrentArea:()=> 'zone-test',getActiveGrid:()=>grid,getMovementInput:()=>input,
    isSolid:type=>type==='wall',_isZoneArea:()=>true,
    tileSurfaceYInArea:tile=>tile.surfaceY,worldSurfaceY:()=>0,
    getMountRideState:()=> 'none',canStartFreeJump:()=>true,
    canPlayerOccupy:()=>true,canPlayerOccupyAtHeight:()=>true,getBaseMoveSpeedTiles:()=>3.15,
  });
  vm.runInNewContext(ropeSource,context,{filename:'hanging-ropes.js'});
  const step=()=>{window.PlayerJump.tick(1/60);window.HangingRopes.tick(1/60);};
  return {window,player,input,step,grid};
}
// A falling body uses the ordinary jump control and the same physical elevation.
{
  const t=world();
  const f=t.window.PlayerJump.beginFlight({x:2.5,y:1.5,z:3.5,vx:0,vy:-0.2,vz:0},{source:'ledge fall',deliberate:false});
  assert(f && t.player._freeJump===f && f.phase==='air');
  assert(t.window.PlayerJump.start(),'falling does not permit a second jump but consumes that input');
  t.input.x=1;
  for(let i=0;i<8;i++)t.step();
  assert(t.player.x/TILE>2.65,'a falling player can move in the input direction');
  assert(t.player.physicalFeetY<1.5,'falling and jumping publish the same physical foot height');
}
// A flying body keeps release momentum when input is neutral, and may steer against it.
{
  const t=world();
  const f=t.window.PlayerJump.beginFlight({x:2.5,y:2,z:3.5,vx:3,vy:1,vz:0},{source:'rope swing'});
  for(let i=0;i<5;i++)t.step();
  assert(t.player.x/TILE>2.73,'flight does not discard rope tangent velocity without input');
  t.input.x=-1;
  for(let i=0;i<5;i++)t.step();
  assert(t.player.x/TILE>2.5,'steering is applied in addition to, not instead of, inherited momentum');
  assert(t.player._freeJump===f);
}
// An outdoor furniture rope is catchable *in the air*, not merely by walking near it.
{
  const t=world();
  const rope=t.window.HangingRopes.registerRope({
    id:'outdoor-swing',mapId:'zone-test',x:3.1,y:2.1,z:3.5,length:1.7,maxLength:2.1,yaw:0,
  });
  assert(rope && !rope.attached);
  for(let i=0;i<20;i++)t.step();
  assert(!rope.attached,'approaching a hanging rope on the ground cannot trigger an auto grab');
  t.input.x=1;
  assert(t.window.PlayerJump.start());
  for(let i=0;i<35&&t.player._freeJump?.phase!=='rope';i++)t.step();
  assert.equal(t.player._freeJump?.phase,'rope','jumping toward the rope catches it automatically');
  assert.equal(t.window.HangingRopes.debugSnapshot().activePlayerRope,'outdoor-swing');
  assert(Number.isFinite(t.player.physicalFeetY),'rope rider retains physical elevation');
  const before=t.player.physicalFeetY;
  for(let i=0;i<8;i++)t.step();
  assert(Number.isFinite(t.player.physicalFeetY)&&t.player._freeJump?.phase==='rope');
  assert(t.window.HangingRopes.releaseActiveRope(),'releasing a rope produces a normal ballistic jump');
  assert.equal(t.player._freeJump.phase,'air');
  assert(Number.isFinite(t.player._freeJump.vx)&&Number.isFinite(t.player._freeJump.vy));
  assert.equal(t.player._freeJump.ropeId,'outdoor-swing','release excludes the just-dismounted rope from immediate re-catching');
  t.input.x=0;
  t.step();
  assert(t.player._freeJump?.phase!=='rope','release cannot auto-catch the same rope in the next frame');
  assert(Number.isFinite(before));
}
// Dodge is a normal rope-release input in ruins; it must not cancel the
// resultant flight, and outdoors it should dismount instead of dropping the
// rider's physical elevation state with no landing.
{
  const t=world();
  t.window.HangingRopes.registerRope({
    id:'dodge-dismount',mapId:'zone-test',x:3.1,y:2.1,z:3.5,length:1.7,yaw:0,
  });
  t.input.x=1;
  assert(t.window.PlayerJump.start());
  for(let i=0;i<35&&t.player._freeJump?.phase!=='rope';i++)t.step();
  assert.equal(t.player._freeJump?.phase,'rope');
  t.player.dodging=true;
  t.step();
  assert.equal(t.player._freeJump?.phase,'air','Dodge must release an outdoor rider into free flight');
  t.step();
  assert.equal(t.player._freeJump?.phase,'air','Dodge input must not cancel the release flight');
  assert.equal(t.window.HangingRopes.debugSnapshot().activePlayerRope,null);
}
// A high-momentum launch can pass both sides of the grip within ONE frame.
// The swept mover must sample each substep, not just the next frame's origin.
{
  const t=world();
  t.window.HangingRopes.registerRope({
    id:'fast-catch',mapId:'zone-test',x:3.2,y:2.1,z:3.5,length:1.7,yaw:0,
  });
  t.window.PlayerJump.beginFlight({x:2.5,y:.4,z:3.5,vx:75,vy:0,vz:0},{source:'fast rope launch'});
  t.step();
  assert.equal(t.player._freeJump?.phase,'rope',
    'the horizontal sweep catches a rope crossed between two rendered frames');
  assert.equal(t.window.HangingRopes.debugSnapshot().activePlayerRope,'fast-catch');
}
// Ruin flight uses the same record but leaves integration to the special ruin collision owner.
{
  const t=world();
  const f=t.window.PlayerJump.beginFlight({x:2.5,y:2,z:3.5,vx:2,vy:1,vz:0},{external:true,source:'ruin rope swing'});
  t.player.dodging=true; // Ruin rope release uses the same Dodge input that normally cancels free jumps.
  assert.equal(t.window.PlayerJump.tick(0.1),true);
  assert.equal(t.player._freeJump,f,'Dodge must not erase a ruin-owned rope launch');
  assert.equal(f.x,2.5,'the normal mover does not double-integrate a ruin-owned flight');
  f.y=1.8;
  assert(t.window.PlayerJump.syncExternalFlight(f));
  assert.equal(t.player.physicalFeetY,1.8);
  t.window.PlayerJump.reset();
  assert.equal(t.player._freeJump,null,'leaving a ruin clears the shared record');
}
// A released ruin swing must also catch ordinary puzzle-room ropes, not only
// specially tagged rope-chain links. It must never recatch the released rope.
{
  const start=ruinSource.indexOf('  function catchAirborneRope(f) {');
  const end=ruinSource.indexOf('\n\n  function createLavaMaterial() {',start);
  assert(start>=0&&end>start,'the ruin shares one airborne catch routine');
  const rope={id:'another-ordinary-rope',attached:false,burden:null};
  let catches=0; // Confirms both owner-controlled releases and ordinary airborne approaches reach the real catch path.
  const state={activeRope:null,flight:null,ropes:[rope]};
  const catcher=new Function('state','inRuin','ropeCatchPoint','catchRopeInFlight',
    ruinSource.slice(start,end)+'\nreturn catchAirborneRope;')(
      state,()=>true,()=>true,()=>{catches++;return true});
  const released={x:1,y:2,z:3,ropeId:'previous-rope'};
  state.flight=released;
  assert.equal(catcher(released),true,'a released swing can catch an ordinary ruin rope');
  assert.equal(catches,1);
  assert.equal(catcher({...released}),false,'an unrelated flight cannot steal the current rope flight');
  released.ropeId=rope.id;
  assert.equal(catcher(released),false,'cannot immediately catch the same rope after releasing it');
  state.flight=null;
  released.ropeId='different-rope';
  assert.equal(catcher(released),true,'ordinary mid-jump entry may grab the same rope');
}
// Ruin ledge falls use the same entry point when directional movement is held.
{
  const interior=read('docs/js/dev-random-ruin-interior-map.js'); // Native ruin ledge/floor owner.
  new vm.Script(interior, {filename:'dev-random-ruin-interior-map.js'});
  const start=interior.indexOf('  function beginSteerableRuinFall(x,z) {');
  const end=interior.indexOf('\n  function reconcilePlayer(now){',start);
  assert(start>=0&&end>start,'the ruin has a fall adapter beside native reconciliation');
  assert(interior.split('if(beginSteerableRuinFall(x,z))return;').length===3,
    'both lower-level landings and ordinary nonfatal pit falls use the adapter');
  let move={x:1,y:0}; // Directional input controlling whether a scripted drop becomes a steerable fall.
  let calls=0; // Counts actual shared-airborne starts, rather than relying solely on a source-text assertion.
  const actor={x:3*TILE,y:4*TILE,inputX:0,inputY:0};
  const ruin={supportY:2,lastSafePx:{x:2*TILE,y:4*TILE},falling:{},lastAcceptedPx:null};
  const deps={player:actor,TILE,getMovementInput:()=>move};
  const window={PlayerJump:{beginFlight(f,opts) {
    calls++;
    assert.equal(f.y,2);
    assert.equal(f.safeX,2,'fall keeps the last safe ground X');
    assert.equal(f.safeZ,4,'fall keeps the last safe ground Z');
    assert.equal(opts.deliberate,false,'an unintentional step-off is not an intentional jump');
    return {feetY:f.y};
  }}};
  let presentationY=null;
  const sync=y=>{presentationY=y};
  const helper=new Function('deps','ruin','window','syncRuinPresentationHeight',
    interior.slice(start,end)+'\nreturn beginSteerableRuinFall;')(deps,ruin,window,sync);
  assert.equal(helper(3,4),true);
  assert.equal(calls,1);
  assert.equal(ruin.falling,null,'new airborne physics replaces, rather than overlaps, the timed fall');
  assert.equal(presentationY,2);
  move={x:0,y:0};
  assert.equal(helper(3,4),false,'idle step-offs retain their existing native scripted fall');
  assert.equal(calls,1);
}
console.log('shared airborne rope ok');
