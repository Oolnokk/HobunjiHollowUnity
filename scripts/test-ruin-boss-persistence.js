'use strict';
// The real sanctum composer must restore a killed boss by world/site/seed,
// rather than respawning a guardian when the ruin is regenerated.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
let registered=null,wasSaved=false,seed=44;
const savedSeed=44; // The persisted ruin identity remains fixed while the active candidate seed changes.
const window={
  THREE:{},
  DynamicSurfaces:{},
  DevRandomRuinConfig:{get:(_key,fallback)=>fallback},
  DevRandomRuin:{getSeed:()=>seed},
  RuinSites:{isActiveRuinBossDefeated:key=>key===savedSeed&&wasSaved},
  DevRandomRuinSimplePuzzles:{registerComposer:composer=>{registered=composer;}},
};
const document={createElement:()=>({})};
vm.runInNewContext(fs.readFileSync('docs/js/dev-random-ruin-sanctum.js','utf8'),{
  window,THREE:window.THREE,console,document,
});
assert(registered&&typeof registered.buildRooms==='function','the actual sanctum composer registers');
const context={hachutu:false,specialBoss:true,
  sanctumPlan:{arena:{minX:10,maxX:24,minZ:10,maxZ:24},vault:{minX:26,maxX:33,minZ:14,maxZ:20}}};
function load(){registered.buildRooms({deps:{}},context,()=>.5,[],{});return registered.snapshot();}
let state=load();
assert.equal(state.bossDefeated,false,'a new ruin starts with its guardian alive');
wasSaved=true;
state=load();
assert.equal(state.bossDefeated,true,'a saved defeated boss remains defeated after generation');
assert.equal(state.boss,null,'restoring a victory does not spawn another guardian');
seed=45;
state=load();
assert.equal(state.bossDefeated,false,'a differently seeded site never inherits a defeated guardian');
console.log('Sanctum boss completion restore and site identity: PASS');