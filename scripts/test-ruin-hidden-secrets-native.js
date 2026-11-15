'use strict';
const assert=require('node:assert/strict');
const oldWindow=global.window, oldPuzzle=global.DevRandomRuinSimplePuzzles;
let composer=null,created=[],disposed=[];
global.window=global;
global.DevRandomRuinSimplePuzzles={registerComposer:c=>{composer=c;return true;}};
global.RuinHiddenSecrets={
 planForRoom:room=>room.id.endsWith('2')||room.id.endsWith('3')||room.id.endsWith('4')||room.id.endsWith('5'),
 create:opts=>{
  created.push(opts);
  return {x:opts.room.x+1,y:opts.room.y,z:opts.room.z+1,roomId:opts.room.id,
   tick(){this.ticks=(this.ticks||0)+1;},
   snapshot(){return{id:this.roomId,ticks:this.ticks||0}},
   dispose(){disposed.push(this.roomId);}};
 }};
require('../docs/js/ruin-hidden-secrets-native.js');
assert(composer&&composer.id==='ruinHiddenSecrets');
const rooms=Array.from({length:8},(_,i)=>({id:'r'+i,x:i*20+30,z:40,w:16,d:15}));
const kit={THREE:{},roomBounds:(_m,r)=>({minX:r.x,maxX:r.x+r.w,minZ:r.z,maxZ:r.z+r.d}),
 sampleSupport:()=>({y:4}),group:()=>({}),
 playerWorld:()=>({x:72,y:4,z:43}),deps:{showToast(){}}};
const used=new Set(['r2']);
composer.buildLate(kit,{seed:44,theme:'tothal',tier:2,meta:{rooms}},()=>{throw Error('should not consume gameplay RNG');},used);
assert.equal(created.length,3,'cap three optional native room placements');
assert(!created.some(x=>x.room.id==='r2'),'already-claimed room cannot get a secret');
assert(created.every(x=>x.theme==='tothal'));
assert.equal(composer.snapshot().placed,3);
composer.update(kit,1000,0.05);
assert(created.every(x=>x.parent!==undefined));
composer.clear();
assert.equal(disposed.length,3);
assert.equal(composer.snapshot().placed,0);
global.window=oldWindow;global.DevRandomRuinSimplePuzzles=oldPuzzle;
console.log('Native V50 adapter: unclaimed rooms, stable cap, lifecycle and no gameplay RNG PASS');
