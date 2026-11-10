#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const script=fs.readFileSync('docs/js/audio-system.js','utf8'); // Executes production playback, preloading, cancellation, and diagnostics.
let timeMs=1000; // Simulates performance.now while preserving a fixed audio-clock origin.
const sources=[]; // Captures independent audio buffer voices and their hardware-clock deadlines.
class AudioContext {
  constructor(){this.state='running';this.currentTime=100;this.destination={};}
  resume(){this.state='running';return Promise.resolve();}
  decodeAudioData(_bytes,success){
    const data=new Float32Array(220);data[25]=0.8;data[27]=0.3;
    const buffer={sampleRate:1000,length:data.length,numberOfChannels:1,getChannelData:()=>data,duration:0.22};
    success?.(buffer);return Promise.resolve(buffer);
  }
  createBufferSource(){
    const source={playbackRate:{value:1},connect(){return this;},disconnect(){},start(at,offset){this.startedAt=at;this.offset=offset;},stop(){this.stopped=true;}};
    sources.push(source);return source;
  }
  createGain(){return{gain:{setValueAtTime(value,at){this.value=value;this.at=at;}},connect(){return this;},disconnect(){}};}
}
class FakeAudio {
  constructor(src){this.src=src;this.dataset={};this.events={};this.currentTime=0;this.paused=true;this.readyState=4;}
  load(){}
  cloneNode(){return new FakeAudio(this.src);}
  addEventListener(name,fn){this.events[name]=fn;}
  pause(){this.paused=true;}
  play(){this.paused=false;return Promise.resolve();}
}
const urls=Object.fromEntries([1,2,3,4].map(n=>['stoneBeat'+n,{url:'assets/audio/sfx/sfx_stonebeat-'+n+'.mp3',preload:true,volume:.8}]));
const window={SCRATCHBONES_CONFIG:{game:{audio:{objectSfx:urls}}},
  AudioContext,fetch:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(64)})};
vm.runInNewContext(script,{window,Audio:FakeAudio,performance:{now:()=>timeMs},setTimeout,clearTimeout,console});
window.AudioSystem.init({audioUrlFailed:()=>false,isRealMediaError:()=>false,markAudioUrlFailed:()=>{},TILE:32});
(async()=>{
  await new Promise(resolve=>setImmediate(resolve)); // Resolve all four decode jobs before the first timed note.
  const api=window.AudioSystem;
  assert.equal(api.stoneBeatDebugSnapshot().decoded,4,'all four recorded beats are independently decoded once');
  assert.equal(api.metronomeLookaheadMs,90,'same scheduling horizon as the instrument performance transport');
  assert.equal(api.playObjectSfxKeyMetronome(.72,0,1090),true);
  assert.equal(api.playObjectSfxKeyMetronome(.54,1,1600),true);
  assert.equal(api.playObjectSfxKeyMetronome(.54,2,2200),true);
  assert.equal(api.playObjectSfxKeyMetronome(.54,3,2800),true);
  assert.equal(sources.length,4,'each of the numbered sounds creates an independent AudioBufferSource');
  assert.equal(sources[0].startedAt,100.09,'first sound starts at precise future hardware-clock time');
  assert.equal(sources[1].startedAt,100.6);
  assert.equal(sources[0].stopped,undefined,'a new beat does not truncate its predecessor');
  assert(sources.every(source=>source.playbackRate.value===1),'authored sample pitch and duration remain unchanged');
  assert(sources.every(source=>source.offset>0.015&&source.offset<0.03),'MP3 leading silence is trimmed uniformly without shortening decay');
  assert.equal(api.objectSfxDebugSnapshot().last.key,'stoneBeat4');
  assert.equal(api.objectSfxDebugSnapshot().last.backend,'web-audio');
  api.playObjectSfxKeyMetronome(.72,0,995);
  api.cancelObjectSfxMetronome();
  assert.equal(sources[0].stopped,true,'a plate release cancels a future already-queued strike');
  assert.equal(sources.at(-1).stopped,undefined,'a strike already sounding keeps its natural tail');
  assert.equal(api.stoneBeatDebugSnapshot().fallbackQueued,0);
  console.log('stonebeat Web Audio: PASS (all four decoded, sample deadlines, natural overlapping tails, cancel future only)');
})().catch(error=>{console.error(error);process.exitCode=1;});
