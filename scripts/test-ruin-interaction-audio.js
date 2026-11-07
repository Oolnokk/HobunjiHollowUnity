#!/usr/bin/env node
'use strict';
// Regression: the four uploaded recordings share one pitch-scaled, edge-triggered audio adapter.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
let now=0; // Simulates successive render frames and idle intervals for deduplication.
const calls=[]; // Captures semantic SFX keys and playback-rate multipliers without needing a browser sound device.
class Vec3 {constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}}
class Bounds {
  setFromObject(object){this.size=object.worldSize;return this;}
  isEmpty(){return !this.size;}
  getSize(result){Object.assign(result,this.size);return result;}
}
const sandbox={console,Map,WeakMap,Date,Math,Number,performance:{now:()=>now},
  THREE:{Box3:Bounds,Vector3:Vec3},
  AudioSystem:{playObjectSfxKey:(key,volume,pitch)=>calls.push({key,volume,pitch})}};
sandbox.globalThis=sandbox;
sandbox.module={exports:{}};
vm.runInNewContext(read('docs/js/ruin-interaction-audio.js'),sandbox,
  {filename:'ruin-interaction-audio.js'});
const audio=sandbox.module.exports;
const stone=(span)=>({isObject3D:true,worldSize:{x:span,y:span,z:span},scale:{x:1,y:1,z:1}});
const near=(v,w)=>Math.abs(v-w)<1e-8;
const door=stone(4),smallDoor=stone(2),largeDoor=stone(8);
const block=stone(1.2),smallBlock=stone(.6),largeBlock=stone(2.4);
assert(near(audio.pitchFor('mechanism',door),1),'large ruin door keeps the original recording pitch');
assert(near(audio.pitchFor('activator',block),1),'standard push block keeps the original recording pitch');
assert(audio.pitchFor('mechanism',smallDoor)>1,'smaller stone mechanisms sound higher');
assert(audio.pitchFor('mechanism',largeDoor)<1,'larger stone mechanisms sound lower');
assert(audio.pitchFor('activator',smallBlock)>1,'small stone blocks sound higher');
assert(audio.pitchFor('activator',largeBlock)<1,'large stone blocks sound lower');
assert(audio.pitchFor('mechanism',stone(.01))<=1.6,'maximum playback pitch is bounded');
assert(audio.pitchFor('mechanism',stone(300))>=.67,'minimum playback pitch is bounded');
assert(near(audio.pitchFor('mechanism',null),1),'unknown size leaves the recording untouched');
assert.equal(audio.watchMovement(door,0),false,'initial closed pose should be silent');
now+=16;
assert(audio.watchMovement(door,.2),'initial stone movement starts the mechanism sound');
assert.equal(calls.at(-1).key,'stoneMechanism');
const afterStart=calls.length;
assert(!audio.watchMovement(door,.2),'a second frame reader at the same pose must stay silent');
now+=16;
assert(!audio.watchMovement(door,.5),'one continuous opening has one sound');
assert.equal(calls.length,afterStart);
now+=16;
assert(audio.watchMovement(door,.4),'reversing direction restarts the stone movement sound');
assert.equal(calls.length,afterStart+1);
now+=200;
audio.watchMovement(door,.4);
now+=16;
assert(audio.watchMovement(door,.6),'a later, distinct stone movement gets its own sound');
const plate=stone(1);
assert(!audio.watchPlate(plate,false),'initial unpressed plate is silent');
assert(audio.watchPlate(plate,true),'a plate press clicks once');
assert(!audio.watchPlate(plate,true),'held pressure plates do not spam sound');
assert(audio.watchPlate(plate,false),'stone plate release clicks');
assert(audio.activator(block),'a successful physical block push should sound');
assert(near(calls.at(-1).pitch,1),'standard block push uses original activator pitch');
audio.igniteTorch();audio.igniteAmmo();
assert.deepEqual(calls.slice(-2).map(c=>c.key),['igniteLarge','igniteSmall']);
const config=read('docs/config/scratchbones-config.js');
for(const filename of ['sfx_ignite_big.m4a','sfx_ignite_small.m4a','sfx_stone_activator.m4a','sfx_stone_mechanism.m4a']){
  assert(config.includes(filename),'game audio manifest should include '+filename);
  assert(fs.existsSync(path.join(__dirname,'..','docs','assets','audio','sfx',filename)),
    'referenced recording must exist: '+filename);
}
const index=read('docs/index.html');
assert(index.indexOf('js/ruin-interaction-audio.js')>0,'the shared audio adapter is loaded by the game');
assert(index.indexOf('js/ruin-interaction-audio.js')<index.indexOf('js/furniture-puzzle-runtime.js'),
  'puzzle scripts must be able to use the audio adapter before runtime mounting');
console.log('Ruin interaction audio: four recordings, neutral reference pitches, size scaling, press/movement edges and duplicate-frame safety PASS.');
