#!/usr/bin/env node
'use strict';
// Test the shipped V50 torch contact functions, not a parallel puzzle implementation.
const assert = require('node:assert/strict');
const fs = require('node:fs'); // Reads the real browser runtime for collision regressions.
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/dev-random-ruin-hit-puzzles.js','utf8');
function shipped(first, next) {
  const a = source.indexOf('  function '+first+'(');
  const b = source.indexOf('  function '+next+'(', a + 1);
  assert(a >= 0 && b > a, 'missing shipped V50 contact function: '+first);
  return source.slice(a,b);
}
class Vec {
  constructor(x=0,y=0,z=0) { this.x=x;this.y=y;this.z=z; }
  clone() { return new Vec(this.x,this.y,this.z); }
  lerp(other,t) { this.x+=(other.x-this.x)*t;this.y+=(other.y-this.y)*t;this.z+=(other.z-this.z)*t;return this; }
}
function box(x,y,z,w=.2,h=.7,d=.3) {
  const min={x,y,z},max={x:x+w,y:y+h,z:z+d};
  return {min,max,clone(){return box(this.min.x,this.min.y,this.min.z,this.max.x-this.min.x,this.max.y-this.min.y,this.max.z-this.min.z);},
    expandByScalar(s){for(const axis of ['x','y','z']){this.min[axis]-=s;this.max[axis]+=s;}return this;}};
}
const lowSource={bounds:box(.7,.2,-.12)},highSource={bounds:box(.7,4.2,-.12)};
const lowTarget={id:'low',kind:'brazier',object:{bounds:box(1.5,.2,-.12)},mechanismId:'m1',lit:false};
const highTarget={id:'high',kind:'brazier',object:{bounds:box(1.5,4.2,-.12)},mechanismId:'m2',lit:false};
const signals=new Map([['m1',{target:0}],['m2',{target:0}]]);
let floorY=0,ignites=0; // Physical support Y and authoritative accepted ignitions.
const ctx={
  MAP_ID:'map_i_dev_random_ruin',CONTROL_RANGE:1.65,root:{},torchSources:[lowSource],
  ignitionTargets:[lowTarget,highTarget],mechanismSignals:signals,
  clamp:(n,a,b)=>Math.min(b,Math.max(a,n)),finite:(n,f=0)=>Number.isFinite(Number(n))?Number(n):f,
  currentArea:()=> 'map_i_dev_random_ruin',boxFor:o=>o.bounds,
  worldDistanceTo:o=>Math.max(0,o.bounds.min.y-(floorY+1.65),(floorY-.18)-o.bounds.max.y),
  window:{RuinInteractionAudio:{igniteTorch(){ignites++;},puzzleComplete(){}},__farmLog(){}},
  devDeps:{showToast(){}},
};
vm.createContext(ctx);
vm.runInContext(shipped('segmentBoxInterval','glyphProjectileHit')+
  shipped('igniteIgnitionTarget','transferFire'),ctx);
assert.equal(ctx.isIgnitionSourceAlongSegment(new Vec(0,.5,0),new Vec(2,.5,0)),true,'same-floor source lights a torch');
ctx.torchSources=[highSource];
assert.equal(ctx.isIgnitionSourceAlongSegment(new Vec(0,4.5,0),new Vec(2,4.5,0)),false,'upper-floor source cannot light torch through floor');
floorY=4;
assert.equal(ctx.isIgnitionSourceAlongSegment(new Vec(0,4.5,0),new Vec(2,4.5,0)),true,'upper source works when player is on that floor');
floorY=0;
assert.equal(ctx.contactAdventuringTorchSegment(new Vec(0,.5,0),new Vec(2,.5,0),.2,.1,true),false,'blocked melee segment cannot ignite beyond cover');
assert.equal(ctx.contactAdventuringTorchSegment(new Vec(0,.5,0),new Vec(2,.5,0),1,.1,true),true,'lit swing ignites near V50 target');
assert.equal(lowTarget.lit,true);
assert.equal(signals.get('m1').target,1,'V50 mechanism receives its real solve signal');
assert.equal(ctx.contactAdventuringTorchSegment(new Vec(0,.5,0),new Vec(2,.5,0),1,.1,true),false,'ignition is one-shot');
assert.equal(ctx.contactAdventuringTorchSegment(new Vec(0,4.5,0),new Vec(2,4.5,0),1,.1,true),false,'melee fire cannot pass through a different floor');
assert.equal(highTarget.lit,false);
assert.equal(ctx.contactAdventuringTorchSegment(new Vec(0,4.5,0),new Vec(2,4.5,0),.2,.1),false,'thrown torch cannot ignite behind prior collision');
assert.equal(ctx.contactAdventuringTorchSegment(new Vec(0,4.5,0),new Vec(2,4.5,0),1,.1),true,'physical projectile can strike a different height when unobstructed');
assert.equal(signals.get('m2').target,1);
assert.equal(ignites,2,'each distinct target triggers the ignition sound once');
console.log('ok V50 permanent torch: world-space sources, floor-aware melee, blocked and unblocked thrown contacts');
