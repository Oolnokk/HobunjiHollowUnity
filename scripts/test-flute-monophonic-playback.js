'use strict';
// Regression: flute and Kurraya use the same patterns, but flute has one long-lived audio voice.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const engine = fs.readFileSync(path.join(__dirname,'../docs/assets/minigames/lyre-performance.html'),'utf8'); // Real player and NPC performance engine.
const puzzle = fs.readFileSync(path.join(__dirname,'../docs/js/kurraya-puzzle.js'),'utf8'); // Shared puzzle sampler used for both instruments.
const echo = fs.readFileSync(path.join(__dirname,'../docs/assets/minigames/kurraya-puzzle.html'),'utf8'); // Real melody-echo sequence loop.
const host = fs.readFileSync(path.join(__dirname,'../docs/js/music-minigame.js'),'utf8'); // Checks the iframe cache bust and equipped-instrument routing.

function extractFunction(source,name,isAsync) {
  const begin = source.indexOf('  ' + (isAsync ? 'async ' : '') + 'function ' + name + '(');
  assert.ok(begin >= 0,'Missing function ' + name);
  const end = source.indexOf('\n  }\n',begin);
  assert.ok(end > begin,'Missing function end for ' + name);
  return source.slice(begin,end + 4);
}

function audioParam() {
  return {value:0.7,events:[],
    setValueAtTime(v,t){this.value=v;this.events.push(['set',v,t]);},
    exponentialRampToValueAtTime(v,t){this.events.push(['exp',v,t]);},
    linearRampToValueAtTime(v,t){this.events.push(['linear',v,t]);},
    setTargetAtTime(v,t,c){this.events.push(['target',v,t,c]);},
    cancelScheduledValues(t){this.events.push(['cancel',t]);}
  };
}

function makePerformanceVoice(midi,at) {
  const source = {buffer:{duration:5},playbackRate:{value:1},starts:[],stops:[],loop:false,
    start(...args){this.starts.push(args);},stop(at){this.stops.push(at);},disconnect(){}};
  return {midi,source,gain:{gain:audioParam()},markers:{trimStart:0,loopIn:0.45,loopOut:1.6,trimEnd:4.5},startedAt:at,released:false};
}

function performanceHarness(flute) {
  const state = {audioContext:{currentTime:10},paused:false,fluteVoice:null,voiceSequence:0}; // Mutable playback state isolated per instrument.
  const removed = []; // Captures registry cleanup when the next flute note displaces the previous note.
  const factories = extractFunction(engine,'interruptFluteVoice') + '\n' + extractFunction(engine,'startSamplerVoice',true);
  const make = new Function('state','HOSTED_FLUTE_PERFORMANCE','FLUTE_NOTE_DURATION_S','ensureAudio','audioStartTimeFor',
    'createVoiceNodes','removeVoiceFromGroup','log','refs','toast',factories + '\nreturn {startSamplerVoice};');
  const api = make(state,flute,4.5,async()=>{},(_,when)=>when ?? 10,
    (midi,amount,at)=>makePerformanceVoice(midi,at),(key)=>removed.push(key),
    ()=>{},{analysisReadout:{}},()=>{});
  return {state,removed,play:api.startSamplerVoice};
}

function puzzleHarness(recordedSample) {
  const sources = []; // Fake browser audio sources record their starts, cutoffs and loop flags.
  function fakeSource(type) {
    const source = {type,frequency:{value:0},playbackRate:{value:1},stops:[],loop:false,
      connect(){return this;},disconnect(){},start(){},stop(at){this.stops.push(at);}};
    sources.push(source);
    return source;
  }
  class AudioContext {
    constructor(){this.currentTime=0;this.state='running';this.destination={};}
    async resume(){}
    createOscillator(){return fakeSource('oscillator');}
    createBufferSource(){return fakeSource('sample');}
    createGain(){return {gain:audioParam(),connect(){return this;},disconnect(){}};}
    async decodeAudioData(){return {duration:1.2};}
  }
  const root = {AudioContext,
    fetch:async()=>recordedSample
      ? {ok:true,arrayBuffer:async()=>new ArrayBuffer(12)}
      : {ok:false,status:404}
  }; // The 404 exercises the exact synth fallback used without the optional flute recording.
  const start = puzzle.indexOf('  function createSampler(');
  const end = puzzle.indexOf('  const api =',start);
  assert.ok(start >= 0 && end > start,'Missing puzzle sampler');
  const createSampler = new Function('root','storage',puzzle.slice(start,end) + '\nreturn createSampler;')(root,()=>null);
  return {sources,sampler:createSampler('flute.m4a',{fallback:'midi',useCustomSample:false})};
}

async function main() {
  const flute = performanceHarness(true);
  const first = await flute.play(60,'flute-1',0.8,10);
  const second = await flute.play(64,'flute-2',0.8,10.3);
  assert.equal(first.source.loop,true,'flute must loop the center of a note for its sustained breath');
  assert.equal(first.released,true,'new flute pitch must release the previous pitch');
  assert.equal(first.source.stops.at(-1),10.3,'interruption must align with the next scheduled audio attack');
  assert.equal(flute.state.fluteVoice,second,'flute must own exactly the newest note');
  assert.deepEqual(flute.removed,['flute-1'],'old flute must leave the voice registry immediately');
  assert.ok(second.source.stops[0] - second.startedAt > 4.4,'flute must ring for several seconds without an interrupt');

  const kurraya = performanceHarness(false);
  const kurrayaFirst = await kurraya.play(60,'kurraya-1',0.8,10);
  await kurraya.play(64,'kurraya-2',0.8,10.3);
  assert.equal(kurrayaFirst.released,false,'Kurraya chords must remain polyphonic');
  assert.equal(kurrayaFirst.source.loop,false,'Kurraya must preserve its normal pluck sample');

  const registry = {voices:new Map(),voiceSequence:0,game:{backupAccompaniment:false}}; // Checks an interrupted flute's delayed async callback cannot re-add its silent voice.
  const sounded = []; // Mocked host relay confirms only the surviving flute note announces itself.
  const register = new Function('state','activeVoiceCount','stopVoice','log','parent','performance',
    extractFunction(engine,'registerVoice') + '\nreturn registerVoice;')(
      registry,()=>Array.from(registry.voices.values()).reduce((sum,group)=>sum+group.length,0),
      ()=>{},()=>{},{postMessage:message=>sounded.push(message)},{now:()=>100});
  register('late-flute',{released:true,midi:60});
  assert.equal(registry.voices.size,0,'superseded flute notes must not reappear after an asynchronous audio wake');
  register('current-flute',{released:false,midi:64});
  assert.equal(registry.voices.size,1,'a live note still registers normally');
  assert.deepEqual(sounded.map(message=>message.midi),[64],'only the current flute note reaches the live sounded-note relay');
  assert.match(engine,/if \(!HOSTED_FLUTE_PERFORMANCE && state\.playMode === 'pluck'\)/,
    'saved pluck settings must never bypass the flute single-voice interrupter');
  assert.match(engine,/if \(HOSTED_FLUTE_PERFORMANCE && state\.fluteVoice\) stopVoice\(state\.fluteVoice,0\.025\)/,
    'Clear Notes must also silence a flute that has not reached the voice registry yet');

  const synthetic = puzzleHarness(false);
  assert.equal(await synthetic.sampler.play(60),true);
  assert.equal(await synthetic.sampler.play(62),true);
  assert.ok(synthetic.sources[0].stops[0] > 4.4,'puzzle synth flute must have a multi-second envelope');
  assert.equal(synthetic.sources[0].stops.length,2,'next puzzle note must call stop on the previous voice');
  assert.equal(synthetic.sources[0].stops[1],undefined,'a subsequent puzzle note must stop the prior oscillator immediately');

  const recorded = puzzleHarness(true);
  assert.equal(await recorded.sampler.play(60),true);
  assert.equal(recorded.sources[0].loop,true,'recorded flute should sustain through an interior sample loop');
  assert.ok(recorded.sources[0].stops[0] > 4.4,'recorded flute must not end after the source sample duration');

  assert.match(engine,/const STRUM_NOTE_DELAY_MS = 9/,'manual strum must use the fast brush spacing');
  assert.match(engine,/const stringDelay = stringIndex \* STRUM_NOTE_DELAY_MS/,'automatic strums must use the same spacing');
  assert.match(engine,/scheduledAt \+ stringIndex \* STRUM_NOTE_DELAY_MS/,'preview strums must use the same spacing');
  assert.match(engine,/!HOSTED_FLUTE_PERFORMANCE && voice && Number\(step\?\.gate\)/,'flute must not inherit short Kurraya pluck gates');
  assert.match(echo,/if \(!isFlute\) sampler\.stop\(\)/,'echo examples must hand each flute note to the next');
  assert.match(host,/lyre-performance\.html\?v=[A-Za-z0-9_-]+/,'gameplay must load a cache-versioned performance engine');
  assert.match(host,/kurraya-puzzle\.html\?v=[A-Za-z0-9_-]+/,'gameplay must load a cache-versioned puzzle');
  console.log('Flute monophonic and micro-strum regression checks passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
