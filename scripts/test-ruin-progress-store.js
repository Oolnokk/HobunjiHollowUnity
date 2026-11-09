'use strict';
// Checkpoint/wing progress is world metadata, not a browser-only sidecar;
// folder/cloud world snapshots keep it and never mix player worlds.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('docs/js/world-meta-store.js','utf8');
const saved=new Map([['hobunjiSaveMeta',JSON.stringify({worlds:[{id:'A'},{id:'B'}]})]]);
const localStorage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)};
const window={};
const context={window,localStorage,performance:{now:()=>0},structuredClone,console};
vm.runInNewContext(source,context);
const store=window.WorldMetaStore;
const progress={version:1,cycle:3,sites:{'entry-1':{
  version:1,seed:351,layer:{'wing-east':{solved:2,lit:true}},
  native:{},travel:{shaftLit:true,activeCheckpoint:'wing:east'},
}}};
assert.equal(store.saveRuinProgress('A',progress),true,'write in the real world metadata succeeds');
assert.equal(store.loadRuinProgress('B'),null,'a second world never sees a first world ruin');
const read=store.loadRuinProgress('A');
assert.equal(read.sites['entry-1'].travel.activeCheckpoint,'wing:east');
read.sites['entry-1'].travel.activeCheckpoint='shaft';
assert.equal(store.loadRuinProgress('A').sites['entry-1'].travel.activeCheckpoint,'wing:east',
  'readers cannot mutate the cached metadata object without saving');
const filePayload=JSON.parse(saved.get('hobunjiSaveMeta'));
assert.equal(filePayload.worlds.find(w=>w.id==='A').ruinProgress.cycle,3,
  'the single canonical save snapshot carries ruin progress');
vm.runInNewContext(source,{window:{},localStorage,performance:{now:()=>0},structuredClone,console});
assert.equal(store.saveRuinProgress('not-a-world',progress),false,'never silently create progress in another world');
console.log('World-scoped ruin progress save and copy isolation: PASS');