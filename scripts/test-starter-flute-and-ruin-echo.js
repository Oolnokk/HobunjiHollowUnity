#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Assertions cover one-time equipment grants, flute fallback audio, and the actual challenge event bridge.
const fs = require('node:fs'); // Reads shipped game modules rather than duplicating their logic.
const vm = require('node:vm'); // Provides isolated browser globals for fast headless gameplay tests.
const read = path => fs.readFileSync(path,'utf8');
const noop = () => {};

function testStarterGrant() {
  const doc = {addEventListener:noop,getElementById:()=>null};
  const makePanel = (gear,slots) => {
    const saves = {gear:0,slots:0}; // Counts persisted changes to ensure migrations cannot reissue instruments.
    const win = {InventoryUI:{init:noop},Combat:{deps:{}}};
    vm.runInNewContext(read('docs/js/equipment-panel.js'),{window:win,document:doc});
    win.EquipmentPanel.init({
      TOOL_ITEM_DEFS:{kurraya:{label:'Kurraya',slots:['instrument']}},
      equipmentSlots:slots,getGearInventory:()=>gear,
      saveGearInventory:()=>saves.gear++,
      saveEquipmentSlots:()=>saves.slots++,
      rebuildToolMeshes:noop,
    });
    return {api:win.EquipmentPanel,saves};
  };
  const freshGear = {tools:{}},freshSlots = {instrument:null};
  const fresh = makePanel(freshGear,freshSlots);
  assert.equal(fresh.api.ensureStarterFlute(),true);
  assert.equal(freshGear.tools.flute,true);
  assert.equal(freshSlots.instrument,'flute');
  assert.equal(fresh.saves.gear,1);
  assert.equal(fresh.saves.slots,1);
  freshSlots.instrument=null;
  assert.equal(fresh.api.ensureStarterFlute(),false,'deliberate unequip must be respected');
  assert.equal(freshSlots.instrument,null);
  assert.equal(fresh.saves.slots,1);
  const existingGear={tools:{kurraya:true}},existingSlots={instrument:'kurraya'};
  const old=makePanel(existingGear,existingSlots);
  assert.equal(old.api.ensureStarterFlute(),true,'older characters still own the new flute');
  assert.equal(existingGear.tools.flute,true);
  assert.equal(existingSlots.instrument,'kurraya','migration never overrides the chosen instrument');
  assert.equal(old.saves.slots,0);
  assert.match(read('docs/onboarding-core.js'),/equipmentSlots:\s*\{ instrument: 'flute' \}/,'new characters start assigned');
}

async function testMidiFallback() {
  const played=[]; // Captures oscillator frequencies for MIDI-pitch verification.
  class MockAudioContext {
    constructor(){this.destination={};this.currentTime=0;this.state='running';}
    createGain(){return {gain:{setValueAtTime:noop,exponentialRampToValueAtTime:noop},connect:noop,disconnect:noop};}
    createOscillator(){const voice={frequency:{value:0},connect:noop,disconnect:noop,stop:noop};voice.start=()=>played.push(voice.frequency.value);return voice;}
  }
  const win={AudioContext:MockAudioContext,fetch:async()=>({ok:false,status:404}),localStorage:{getItem:()=>null,setItem:noop}};
  vm.runInNewContext(read('docs/js/kurraya-puzzle.js'),{window:win});
  const sampler=win.KurrayaPuzzle.createSampler('../audio/music/instruments/sfx_flute_note.m4a',{useCustomSample:false,fallback:'midi'});
  assert.equal(await sampler.play(60),true);
  assert.equal(await sampler.play(72),true);
  assert.equal(sampler.diagnostics.midiFallback,true);
  assert.equal(sampler.diagnostics.ready,true);
  assert.equal(played.length,2);
  assert(Math.abs(played[1]/played[0]-2)<1e-8,'an octave must double the oscillator frequency');
}

function testChallengeHandoff() {
  const fns={},timers=[],out=[],loads={}; // Browser-like callbacks verify actual iframe-to-game result routing.
  const element=()=>({dataset:{},classList:{add:noop,remove:noop,toggle:noop},addEventListener:noop});
  const overlay=element(),body=element();
  const frame=element();
  frame.contentWindow={HobunjiPuzzleInstrument:{startEchoChallenge:(id,notes)=>{out.push(['begin',id,...notes]);return true;}}};
  frame.addEventListener=(name,callback)=>{loads[name]=callback;};
  const win={
    addEventListener:(name,callback)=>{(fns[name]||=[]).push(callback);},
    dispatchEvent:event=>out.push(['event',event.type,event.detail.id]),
    KurrayaInstrument:{beginFlute:()=>out.push('flute-begin'),endFlute:()=>out.push('flute-end')},
  };
  class CustomEvent {constructor(type,options){this.type=type;this.detail=options.detail;}}
  const doc={body,getElementById:id=>id==='musicMinigameOverlay'?overlay:id==='musicMinigameFrame'?frame:null};
  vm.runInNewContext(read('docs/js/music-minigame.js'),{
    window:win,document:doc,CustomEvent,setTimeout:fn=>timers.push(fn),setInterval:noop,clearInterval:noop,
  });
  win.MusicMinigame.init({
    getEquippedInstrument:()=> 'flute',getCurrentArea:()=> 'ruin',
    listInstrumentPerformers:()=>[],beginMusicCamera:noop,endMusicCamera:noop,
    refreshActionBar:noop,showToast:noop,
  });
  assert.equal(win.MusicMinigame.beginPlayerSession({echoChallenge:{id:'test-echo',notes:[4,0,2,1]}}),true);
  assert.match(frame.src,/instrument=flute/);
  assert.equal(win.MusicMinigame.switchInstrumentMode('performance'),false,'challenge cannot switch to performance mode');
  loads.load();
  assert.equal(out.some(item=>Array.isArray(item)&&item[0]==='begin'&&item[1]==='test-echo'),true);
  const send=(id,solved)=>fns.message.forEach(fn=>fn({source:frame.contentWindow,data:{source:'hobunji-music-minigame',type:'puzzle-echo-result',id,solved}}));
  send('unrelated',true);
  assert.equal(win.MusicMinigame.state.active,true,'a different challenge cannot unlock this one');
  send('test-echo',false);
  assert.equal(win.MusicMinigame.state.active,true,'mistakes do not end the attempt');
  send('test-echo',true);
  assert.equal(out.some(item=>Array.isArray(item)&&item[0]==='event'&&item[1]==='hobunji-ruin-melody-result'),true);
  timers.forEach(fn=>fn());
  assert.equal(win.MusicMinigame.state,null);
  assert(out.includes('flute-end'));
}

(async()=>{
  testStarterGrant();
  await testMidiFallback();
  testChallengeHandoff();
  const ruin=read('docs/js/dev-random-ruin-simple-puzzles.js');
  assert.match(ruin,/melodyEchoTrigger/);
  assert.match(ruin,/window\.addEventListener\('hobunji-ruin-melody-result'/);
  assert.match(ruin,/beginPlayerSession\?\.\(\{echoChallenge:challenge\}\)/);
  assert.match(ruin,/if \(!set \|\| set\.solved\) return/,'success should be idempotent');
  console.log('starter flute + echo melody tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
