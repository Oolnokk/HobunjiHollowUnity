#!/usr/bin/env node
'use strict';
// Ground-motion ownership, recovery timing, and descending-cliff regression:
// sample the actual game functions rather than duplicating their logic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const game = fs.readFileSync('docs/game.js','utf8');
const cliff = fs.readFileSync('docs/js/creature-cliff-climb.js','utf8');

function extract(source,startMarker,endMarker,bindings,values,name){
  const start=source.indexOf(startMarker);
  const end=source.indexOf(endMarker,start);
  assert(start>=0 && end>start,'source boundaries found for '+name);
  return new Function(...bindings,source.slice(start,end)+'\nreturn '+name+';')(...values);
}
const hits=[];
const window = {
  ImpactRagdollPlayback:{
    triggerCreature:()=>hits.push('creature ragdoll'),
    trigger:()=>hits.push('player ragdoll'),
  },
  Combat:{cancelAllStaged:()=>{}},
  KnockbackCollisionImpact:{cancel:()=>hits.push('cancel stale impact')},
  ResourceSystem:{hasTimedDebuff:()=>false},
};
const player={prone:false,health:100,vx:100,vy:100};
const pose=extract(game,'function enterPronePose(entity, isPlayer, direction, temporary)',
  '// Normal 0-Footing hits',['window','player','beginProneAirFall'],
  [window,player,()=>true],'enterPronePose');

const creature={prone:false,health:100,knockbackT:0.4,knockbackVX:325,knockbackVY:-100,
  proneThrowT:0.34,proneThrowVX:580,proneThrowVY:130};
assert.equal(pose(creature,false,'front',false),true);
for(const key of ['knockbackT','knockbackVX','knockbackVY','proneThrowT','proneThrowVX','proneThrowVY'])
  assert.equal(creature[key],0,key+' must not survive the free-fall handoff');
assert(hits.includes('cancel stale impact'), 'pending ground impact must be cleared');
assert(hits.includes('creature ragdoll'), 'creature still gets the knockdown animation');
player.knockbackT=0.2;player.knockbackVX=100;player.knockbackVY=200;
assert.equal(pose(player,true,'front',true),true);
assert.equal(player.knockbackT,0);
assert.equal(player.knockbackVX,0);
assert(hits.includes('player ragdoll'));

const recovery=extract(game,'function proneRecoveryReady(entity)',
  '// Called from updateHostiles',['window','proneRecoveryFootingTarget'],
  [window,e=>e.maxFooting],'proneRecoveryReady');
const target={prone:true,footing:100,maxFooting:100};
assert(recovery(target), 'ordinary grounded actor can recover');
for(const [field,value] of [
  ['_knockbackLedgeAir',{elapsed:0.1}],['_knockbackLedgeFall',{elapsed:0.1}],
  ['_cliffClimb',{phase:'fall'}],['_climbFall',{dropWorld:2}],
  ['_freeJump',{phase:'air',vy:-3}],
]){
  target[field]=value;
  assert.equal(recovery(target),false,field+' must prohibit recovery until touchdown');
  delete target[field];
}
target._cliffClimb={phase:'climb'};
assert(recovery(target), 'a non-falling climbing actor still uses ordinary Footing policy');
delete target._cliffClimb;

const debug={knockedOff:0,lastEvent:null};
const knockOff=extract(cliff,'function knockOff(',
  'function update(c, dt, target)', ['window','debug'], [{__farmLog:()=>{}},debug], 'knockOff');
const descending={id:'descent',creatureKey:'nelk',x:150,y:160,
  _cliffClimb:{phase:'climb',descending:true,t:0.3,originX:100,originY:100,originSurfaceY:5,
  startX:100,startY:100,endX:250,endY:250,surfaceY:3.7,surfaceEndY:1}};
assert(knockOff(descending,'knocked prone',true));
assert.equal(descending._cliffClimb.popupCredit,true,'credited interruption retains ownership until landing');
assert.equal(descending._cliffClimb.phase,'fall');
assert.equal(descending._cliffClimb.surfaceStartY,3.7);
assert.equal(descending._cliffClimb.surfaceEndY,1,'descending interrupted climb keeps its lower target');
assert.equal(descending._cliffClimb.endX,250,'descending fall never rewinds to original upper rim');
assert.equal(descending._cliffClimb.startX,150);
const ascending={id:'ascent',creatureKey:'nelk',x:150,y:160,
  _cliffClimb:{phase:'climb',descending:false,originX:100,originY:100,originSurfaceY:1,
  endX:250,endY:250,surfaceY:3.7,surfaceEndY:5}};
assert(knockOff(ascending,'knocked prone'));
assert.equal(ascending._cliffClimb.popupCredit,false,'uncredited interruption cannot inherit player credit');
assert.equal(knockOff(descending,'later unrelated hit',false),false,'an already falling actor cannot restart its fall');
assert.equal(descending._cliffClimb.popupCredit,true,'later interruption cannot steal original fall credit');
assert.equal(ascending._cliffClimb.surfaceStartY,3.7);
assert.equal(ascending._cliffClimb.surfaceEndY,1,'ascending interruption drops toward its lower base');
assert.equal(ascending._cliffClimb.endX,100);
assert.equal(debug.knockedOff,2);

const nativePlayer={x:4*64,y:4*64,health:100,prone:false};
const jumpWorld={
  FallSystem:{dropTiers:h=>h/2.5,land:()=>{}},KnockbackCollisionImpact:{cancel:()=>{}},
};
vm.runInNewContext(fs.readFileSync('docs/js/player-jump.js','utf8'),{window:jumpWorld,Math});
jumpWorld.PlayerJump.init({
  player:nativePlayer,TILE:64,getCurrentArea:()=> 'test',
  getActiveGrid:()=>Array.from({length:10},()=>Array(10).fill({type:'floor'})),
  getActiveCols:()=>10,getActiveRows:()=>10,worldSurfaceY:()=>0,isSolid:()=>false,
  getMovementInput:()=>({x:1,y:0}),getBaseMoveSpeedTiles:()=>3,
  getMountRideState:()=> 'none',
});
const flight=jumpWorld.PlayerJump.beginFlight({x:4,z:4,y:3,vy:2,vx:1,vz:0},{external:true,source:'ruin rope swing'});
nativePlayer.prone=true;
assert(jumpWorld.PlayerJump.knockProne());
assert.equal(flight.vy,0,'ascending external flight should begin falling from the hit height');
assert.equal(flight.noGrab,true);
assert.equal(jumpWorld.PlayerJump.airControl(.6).x,0,'prone external flight disables directional steering');
jumpWorld.PlayerJump.receiveKnockback(1,0,128);
assert.equal(flight.vx,3,'knockback adds to external integrator momentum in world units per second');
assert.equal(flight.knockbackVX,undefined,'must not write native-only velocity to externally owned flight');
flight.vy=-4;
jumpWorld.PlayerJump.knockProne();
assert.equal(flight.vy,-4,'subsequent hits must not restart the descent');

// The external ruin rope runtime is a distinct integrator; it must honour
// shared no-grab and cliff-impact behavior instead of ordinary land().
const ruin=fs.readFileSync('docs/js/dev-random-ruin-simple-puzzles.js','utf8');
assert(ruin.includes('!deps?.player?.prone&&catchAirborneRope(f,previous)'));
assert(ruin.includes('f.proneFall?window.HobunjiCliffFallImpact?.resolve?.'));
console.log('Airborne knockdown ownership, creature recovery, descending cliffs and external rope gravity: OK');
