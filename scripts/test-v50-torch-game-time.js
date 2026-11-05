#!/usr/bin/env node
'use strict';
// Verify the shipped V50 torch never expires just because a browser/GPU frame
// stalls: 12 seconds must mean 12 seconds of active clamped gameplay.
const assert=require('node:assert/strict');
const fs=require('node:fs'); // Reads exactly the shipped hit-puzzle functions.
const vm=require('node:vm');
const source=fs.readFileSync('docs/js/dev-random-ruin-hit-puzzles.js','utf8');
const shipped=(start,end)=>{
  const begin=source.indexOf('  function '+start+'('),finish=source.indexOf('  function '+end+'(',begin+1);
  assert(begin>=0&&finish>begin,'Missing actual hit-puzzle function '+start);
  return source.slice(begin,finish);
};
let now=0,notifications=0; // Mock time and browser notices, used to prove GPU stalls do not burn torches.
const record={status:'held',lit:true,burnRemainingMs:12000};
const frame={
  TORCH_BURN_MS:12000,temporaryTorches:[record],carriedTorch:record,
  performance:{now:()=>now},devDeps:{showToast:()=>notifications++},
  updateFlameVisual:()=>{},hideUnderlyingWeaponVisual:()=>{},setTorchLit:null,
};
vm.createContext(frame);
vm.runInContext(shipped('setTorchLit','spawnSourceTorch')+
  '\n'+shipped('updateTorchTimers','updateCarrySwitchDetection'),frame);
frame.setTorchLit=frame.setTorchLit;
assert.equal(record.burnRemainingMs,12000);
now+=180000;frame.updateTorchTimers(0);
assert.equal(record.burnRemainingMs,12000,'three minutes stuck compiling WebGL must not consume game-time torch');
for(let i=0;i<60;i++)frame.updateTorchTimers(.05);
assert.equal(Math.round(record.burnRemainingMs),9000,'three seconds of real game frames burns three seconds');
frame.setTorchLit(record,true,true);
assert.equal(record.burnRemainingMs,12000,'relighting from a permanent source restores full burn window');
frame.updateTorchTimers(.05);
assert.equal(record.burnRemainingMs,11950);
for(let i=0;i<239;i++)frame.updateTorchTimers(.05);
assert.equal(record.lit,false,'twelve seconds of active gameplay extinguishes the torch');
assert.equal(record.burnRemainingMs,0);
assert.equal(notifications,1,'one burn-out notification, not once per frame');
for(let i=0;i<100;i++)frame.updateTorchTimers(.05);
assert.equal(notifications,1,'spent torches stay extinguished without repeatedly notifying');
console.log('ok V50 torch: GPU stalls ignored, 12 active seconds retained, relight resets, one expiry notice');
