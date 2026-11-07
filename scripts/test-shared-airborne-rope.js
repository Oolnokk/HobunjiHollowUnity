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
// Ruin flight uses the same record but leaves integration to the special ruin collision owner.
{
  const t=world();
  const f=t.window.PlayerJump.beginFlight({x:2.5,y:2,z:3.5,vx:2,vy:1,vz:0},{external:true,source:'ruin rope swing'});
  assert.equal(t.window.PlayerJump.tick(0.1),true);
  assert.equal(f.x,2.5,'the normal mover does not double-integrate a ruin-owned flight');
  f.y=1.8;
  assert(t.window.PlayerJump.syncExternalFlight(f));
  assert.equal(t.player.physicalFeetY,1.8);
  t.window.PlayerJump.reset();
  assert.equal(t.player._freeJump,null,'leaving a ruin clears the shared record');
}
console.log('shared airborne rope ok');
