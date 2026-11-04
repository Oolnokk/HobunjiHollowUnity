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

function testFluteSpriteMatte() {
  const createCanvas=()=>{ // Minimal alpha-preserving 2D canvas verifies the real shared PNG preprocessing instead of merely checking its source text.
    const canvas={width:0,height:0,data:null};
    canvas.getContext=()=>({
      drawImage(...args) {
        const [image]=args;
        const sw=image.width,sh=image.height;
        const [sx,sy,cropW,cropH,dx,dy]=args.length===3 ? [0,0,sw,sh,0,0] : args.slice(1,7);
        canvas.data=new Uint8ClampedArray(canvas.width*canvas.height*4);
        for(let y=0;y<cropH;y++)for(let x=0;x<cropW;x++){
          const target=((dy+y)*canvas.width+dx+x)*4;
          const source=((sy+y)*sw+sx+x)*4;
          canvas.data.set(image.data.slice(source,source+4),target);
        }
      },
      getImageData:()=>({data:canvas.data.slice()}),
      putImageData:image=>{canvas.data=image.data.slice();},
    });
    return canvas;
  };
  const image={width:10,height:12,data:new Uint8ClampedArray(10*12*4)}; // White perimeter, opaque black rectangle touching the left image edge.
  for(let y=0;y<12;y++)for(let x=0;x<10;x++){
    const at=(y*10+x)*4,black=y>=2&&y<=9&&x<8;
    image.data.set(black?[0,0,0,255]:[255,255,255,255],at);
  }
  for(let y=3;y<=8;y++)for(let x=4;x<=5;x++)image.data.set([155,141,72,255],(y*10+x)*4);
  const win={};
  vm.runInNewContext(read('docs/js/kurraya-instrument.js'),{window:win,document:{createElement:createCanvas}});
  const cropped=win.KurrayaInstrument.prepareFluteCanvas(image);
  assert(cropped.width<image.width && cropped.height<image.height,'flute must crop away opaque black/white margins');
  assert(cropped.data.some((a,i)=>i%4===3&&a===0),'cropped flute must have actual transparent pixels');
  assert(cropped.data.some((a,i)=>i%4===0&&a===155),'gold instrument pixels survive the matte flood');
  assert.equal(cropped.data[3],0,'the upper-left pixel must no longer be the original opaque matte');
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

async function testIframeEchoInput() {
  const html=read('docs/assets/minigames/kurraya-puzzle.html');
  const embedded=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]; // Execute the shipped eight-note iframe itself, not a simplified imitation.
  assert(embedded,'eight-note puzzle iframe must contain its playable script');
  const messages=[], timers=[]; // Captures completion events and advances playback delays without a browser or waiting for real seconds.
  const listeners={};
  const makeNode=()=>({
    textContent:'',value:'',disabled:false,hidden:false,children:[],style:{},
    classList:{add:noop,remove:noop},
    addEventListener(name,fn){(this.events ||= {})[name]=fn;},
    appendChild(child){this.children.push(child);this.lastElementChild=child;},
    replaceChildren(){this.children=[];},
    setAttribute:noop,
    querySelector:()=>({textContent:''}),
  });
  const ids=Object.fromEntries(['notes','result','songList','debug','echoReplay','bookToggle','bookHint','diagnostics'].map(name=>[name,makeNode()]));
  const music={
    SCALES:{'Pentatonic Major':[0,2,4,7,9]},NOTE_CODES:require('../docs/js/kurraya-puzzle.js').NOTE_CODES,
    createSampler:()=>({ready:()=>Promise.resolve(),play:()=>Promise.resolve(true),stop:noop,diagnostics:{ready:true}}),
    listSongs:()=>[],settings:()=>({scale:'Pentatonic Major',tonicMidi:60}),noteName:midi=>String(midi),
    pitchFor:index=>60+index,matchSuffix:()=>null,setSettings:noop,
  }; // A deterministic silent audio transport keeps this focused on the real Simon Says sequence/state machine.
  const sandbox={
    window:{KurrayaPuzzle:music,addEventListener:(name,fn)=>{listeners[name]=fn;}},
    document:{getElementById:id=>ids[id],createElement:()=>makeNode(),activeElement:{tagName:'BODY'}},
    parent:{postMessage:data=>messages.push(data)},
    location:{search:'?instrument=flute'},URLSearchParams,
    setTimeout:(fn,ms)=>{timers.push(fn);if(ms!==850&&ms!==1800)queueMicrotask(fn);return timers.length;}, // Watchdog timeouts must not fire before an immediately ready audio context in this test.
  };
  vm.runInNewContext(embedded,sandbox,{filename:'kurraya-puzzle.html inline'});
  const api=sandbox.window.HobunjiPuzzleInstrument;
  assert.equal(api.playNote(0),true);
  assert.equal(messages.filter(entry=>entry.type==='puzzle-note'&&entry.noteIndex===0).length,1,'ordinary instrument note is sent to the ruin regardless of audio loading');
  assert(api.startEchoChallenge('test-puzzle',[0,1,7]));
  const settle=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
  await settle();
  assert.equal(api.getState().echo.phase,'input','challenge example must finish before note input is accepted');
  assert.equal(api.playNote(0),true);
  assert.equal(api.playNote(3),true);
  assert.equal(api.getState().echo.phase,'retry');
  assert(messages.some(entry=>entry.type==='puzzle-echo-result'&&!entry.solved),'wrong notes must signal retry');
  assert.equal(api.playNote(2),true,'any note button restarts the sample for controller/keyboard users');
  await settle();
  assert.equal(api.getState().echo.phase,'input');
  for(const note of [0,1,7])assert.equal(api.playNote(note),true);
  assert.equal(api.getState().echo.phase,'solved');
  assert.equal(messages.filter(entry=>entry.type==='puzzle-echo-result'&&entry.solved).length,1,'the complete phrase unlocks exactly once');
  assert.equal(api.playNote(4),false,'solved challenge cannot send another unlock');
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
    dispatchEvent:event=>out.push(['event',event.type,event.detail.id ?? event.detail.noteIndex]),
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
  assert.equal(win.MusicMinigame.beginPlayerSession({echoChallenge:{id:'test-echo',notes:[7,0,2,1]}}),true);
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
  assert.equal(win.MusicMinigame.beginPlayerSession(),true,'ordinary instrument mode is independent of the ruin pressure plate');
  const sendNote=noteIndex=>fns.message.forEach(fn=>fn({source:frame.contentWindow,data:{source:'hobunji-music-minigame',type:'puzzle-note',noteIndex}}));
  sendNote(5);
  sendNote(99);
  assert.equal(out.filter(item=>Array.isArray(item)&&item[1]==='hobunji-kurraya-puzzle-note').length,1,'the bridge forwards only valid single-note events');
  assert(out.some(item=>Array.isArray(item)&&item[1]==='hobunji-kurraya-puzzle-note'&&item[2]===5));
  win.MusicMinigame.close();
}

function testDemonstrationTimerLifecycle() {
  const source=read('docs/js/dev-random-ruin-simple-puzzles.js'); // Exercise the shipped playback functions, not a reimplementation.
  const begin=source.indexOf('  function cancelEchoPlayback(set) {');
  const end=source.indexOf('  function completeEchoSet(set) {',begin);
  assert(begin>=0&&end>begin,'the ruin retains cancellable physical pressure-plate playback');
  const jobs=new Map(),played=[]; // A deterministic clock tracks both audio and genuinely pending note callbacks.
  let nextId=0; // Allocates unique timer IDs for repeated presses in this isolated harness.
  const schedule=(callback,delay)=>{const id=++nextId;jobs.set(id,{callback,delay});return id;};
  const cancel=id=>jobs.delete(id);
  const state={chordPlateSets:[]}; // The active ruin holds the single test trigger.
  const set={notes:[0,3,7],solved:false,playbackTimers:[]}; // Tests immediate plus two delayed notes.
  state.chordPlateSets.push(set);
  const win={KurrayaPuzzle:{settings:()=>({scale:'Pentatonic Minor',tonicMidi:60})}};
  const actual=new Function('window','setTimeout','clearTimeout','playKurrayaPlateNote','inRuin','state',
    source.slice(begin,end)+'\\nreturn {cancelEchoPlayback,replayEchoSet};')(
    win,schedule,cancel,note=>played.push(note),()=>true,state);
  const advance=()=>{
    const entry=[...jobs].sort((a,b)=>a[1].delay-b[1].delay)[0]; // Executes the next scheduled note at its authored offset.
    assert(entry,'a queued demonstration note must exist');
    jobs.delete(entry[0]);entry[1].callback();
  };
  actual.replayEchoSet(set);
  assert.deepEqual(played,[0],'stepping on the plate sounds the first note immediately');
  assert.equal(set.playbackTimers.length,2);
  advance();
  assert.deepEqual(played,[0,3]);
  assert.equal(set.playbackTimers.length,1,'played callbacks are removed from pending diagnostics');
  advance();
  assert.deepEqual(played,[0,3,7]);
  assert.equal(set.playbackTimers.length,0,'finished phrase leaves no phantom pending notes');
  actual.replayEchoSet(set);
  assert.equal(jobs.size,2);
  actual.cancelEchoPlayback(set);
  assert.equal(jobs.size,0,'leaving or rebuilding the ruin can cancel every remaining note');
  assert.equal(set.playbackTimers.length,0);
}

function testUnrestrictedMelodySuffix() {
  const {matchSuffix}=require('../docs/js/kurraya-puzzle.js');
  const target={notes:[0,1,0,7]}; // The production song matcher handles overlapping partial starts.
  const recent=[]; // Tracks the latest notes irrespective of time, plate position, or prior wrong notes.
  const matches=[];
  [2,3,0,1,0,1,0,7,4,0,1,0,7].forEach((note,index)=>{
    recent.push(note);
    if(recent.length>target.notes.length)recent.shift();
    if(matchSuffix(recent,[target]))matches.push(index);
  });
  assert.deepEqual(matches,[7,12],'wrong notes must not require a retry or suppress subsequent matches');
}

(async()=>{
  testStarterGrant();
  testFluteSpriteMatte();
  await testMidiFallback();
  await testIframeEchoInput();
  testChallengeHandoff();
  testDemonstrationTimerLifecycle();
  testUnrestrictedMelodySuffix();
  const ruin=read('docs/js/dev-random-ruin-simple-puzzles.js');
  assert.match(ruin,/melodyEchoTrigger/);
  assert.match(ruin,/window\.addEventListener\('hobunji-kurraya-puzzle-note'/);
  assert.match(ruin,/replayEchoSet\(set\)/,'stepping onto the pressure plate replays the phrase');
  assert.match(ruin,/KurrayaPuzzle\?\.matchSuffix\?\.\(set\.heardNotes/,'notes are matched as an uninterrupted sliding suffix');
  assert.doesNotMatch(ruin,/beginPlayerSession\?\.\(\{echoChallenge:challenge\}\)/,'a plate no longer forcibly opens the instrument overlay');
  const complete=ruin.slice(ruin.indexOf('  function completeEchoSet('),ruin.indexOf("  window.addEventListener('hobunji-kurraya-puzzle-note'"));
  assert.match(complete,/if \(!set \|\| set\.solved\) return/,'a complete melody activates the mechanism once');
  assert.match(complete,/playStoneUnlockKchunk\(\)/);
  assert.doesNotMatch(complete,/showToast|retry/i,'the mechanism communicates success without text');
  console.log('starter flute + passive ocarina melody tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
