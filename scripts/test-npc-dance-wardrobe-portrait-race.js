#!/usr/bin/env node
'use strict';
// An in-flight social-dance smile must not repaint a new NPC outfit.
// Run the shipped processSmile state machine with deferred portrait renders.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/npc-dance-presentation-runtime.js','utf8');
const start = source.indexOf('  async function processSmile(record) {');
const end = source.indexOf('\n  function requestSmile(',start);
assert(start>=0 && end>start, 'canonical dance smile renderer is present');
const calls=[]; // Controlled async completions simulate slow pattern/cosmetic loads.
const commits=[]; // Only a smile made from the current profile may reach the avatar texture.
const state={smileErrors:0,smileApplications:0,smileRestores:0};
const context=vm.createContext({
  nowMs:()=>0, state,
  renderExpressionScratch(walker,desired) {
    const profile=walker?.profile;
    return new Promise(resolve=>calls.push({profile,desired,resolve}));
  },
  commitExpressionCanvas(walker,scratch) { commits.push({ profile:walker.profile, ink:scratch.ink }); return true; },
});
vm.runInContext(source.slice(start,end),context);
const originalProfile={outfit:'old'};
const walker={profile:originalProfile};
const record={id:'test-npc',walker,desired:true,applied:false,generation:0,busy:false,nextRetryAt:0,lastError:null};
(async()=>{
  const run=context.processSmile(record);
  assert.equal(calls.length,1);
  const newProfile={outfit:'new'};
  walker.profile=newProfile; // A wardrobe refresh completes while the old smile is still drawing.
  calls[0].resolve({ink:'old-smile'});
  for(let i=0;i<5&&calls.length<2;i++)await Promise.resolve();
  assert.equal(calls.length,2,'stale smile must retry on the new committed outfit');
  assert.deepEqual(commits,[],'old expression did not overwrite live avatar');
  assert.equal(calls[1].profile,newProfile,'retry uses current outfit');
  calls[1].resolve({ink:'new-smile'});
  await run;
  assert.deepEqual(commits.map(item=>item.ink),['new-smile'],'only the new outfit receives a smile');
  assert.equal(record.applied,true,'smile state still completes normally');
  assert.equal(record.busy,false,'pending state is released after a successful rerender');
  console.log('PASS dance/wardrobe async portrait race');
})().catch(error=>{console.error(error);process.exitCode=1;});
