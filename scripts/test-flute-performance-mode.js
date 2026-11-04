#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Checks the real instrument handoff and PCM fallback without a browser.
const fs = require('node:fs'); // Loads the production sources under test.
const vm = require('node:vm'); // Runs player sessions and instrument hooks in isolated browser-like contexts.
const read = path => fs.readFileSync(path, 'utf8');
const noop = () => {};

function playerSession(instrument) {
  const messages = {}; // Captures live iframe notifications to verify per-instrument reactions.
  const calls = { begin:0, end:0, twitch:0, played:0 }; // Debuggable counters for pose/session and actual note events.
  const element = () => ({dataset:{},classList:{add:noop,remove:noop,toggle:noop},addEventListener:noop});
  const overlay = element(), frame = element();
  frame.contentWindow = {};
  const doc = {body:element(),getElementById:id => id === 'musicMinigameOverlay' ? overlay : id === 'musicMinigameFrame' ? frame : null};
  const win = {
    addEventListener:(type,listener) => (messages[type] ||= []).push(listener),
    KurrayaInstrument:{beginFlute:() => calls.begin++,endFlute:() => calls.end++},
    HobunjiActivityEvents:{emit:() => calls.played++},
  };
  vm.runInNewContext(read('docs/js/music-minigame.js'), {window:win,document:doc,setTimeout:noop,setInterval:noop,clearInterval:noop});
  win.MusicMinigame.init({
    getEquippedInstrument:() => instrument,getCurrentArea:() => 'farm',listInstrumentPerformers:() => [],
    beginMusicCamera:noop,endMusicCamera:noop,refreshActionBar:noop,showToast:noop,
    triggerPlayerKurrayaTwitch:() => calls.twitch++,
  });
  assert.equal(win.MusicMinigame.beginPlayerSession(),true);
  assert.equal(win.MusicMinigame.state.instrumentMode,'puzzle');
  assert.equal(win.MusicMinigame.switchInstrumentMode('performance'),true);
  const performanceUrl = frame.src; // The actual iframe URL decides whether the performance engine generates flute or Kurraya timbre.
  messages.message.forEach(listener => listener({source:frame.contentWindow,data:{source:'hobunji-music-minigame',type:'sounded-note',performer:'lead',midi:60}}));
  assert.equal(calls.played,1,'first sounded note still announces the player performing');
  assert.equal(win.MusicMinigame.switchInstrumentMode('puzzle'),true);
  win.MusicMinigame.close();
  return {performanceUrl,calls};
}

async function missingFluteSample() {
  const listeners = {}; // Captures the existing iframe load capture hook, not a duplicate audio router.
  const fetched = []; // Verifies that the flute never requests the Kurraya recording.
  const played = []; // Verifies sampled-note bridge calls are released after the optional file lookup.
  class Frame {}
  const frame = new Frame();
  frame.getAttribute = () => 'assets/minigames/lyre-performance.html?v=test&instrument=flute';
  frame.contentDocument = {getElementById:id => id === 'analysisReadout' ? {textContent:''} : id === 'audioFile' ? {} : null};
  frame.contentWindow = {HobunjiMusicControlBridge:{wakeAudio:async()=>{},noteDown:(index)=>played.push(index)}};
  const doc = {addEventListener:(type,handler) => listeners[type] = handler};
  const win = {__farmLog:noop};
  vm.runInNewContext(read('docs/js/kurraya-instrument.js'), {
    window:win,document:doc,HTMLIFrameElement:Frame,
    fetch:async path => { fetched.push(path); return {ok:false,status:404}; },
  });
  win.KurrayaInstrument.init({});
  listeners.load({target:frame});
  await frame.contentWindow.HobunjiMusicControlBridge.noteDown(2);
  assert.deepEqual(fetched,['assets/audio/music/instruments/sfx_flute_note.m4a']);
  assert.deepEqual(played,[2],'404 is an expected MIDI-flute fallback, not a blocked performance');
  win.KurrayaInstrument.beginFlute();
  assert.equal(win.KurrayaInstrument.fluteDiagnostics().active,true);
  win.KurrayaInstrument.endFlute();
  assert.equal(win.KurrayaInstrument.fluteDiagnostics().active,false);
}

function fallbackSound(flute) {
  const html = read('docs/assets/minigames/lyre-performance.html'); // Extracts the shipped sampler function, rather than reimplementing its synthesis in the test.
  const begin = html.indexOf('  function createFallbackBuffer() {');
  const end = html.indexOf('\n  function currentModeDefinitions()',begin);
  assert(begin >= 0 && end > begin);
  const createFallbackBuffer = html.slice(begin,end);
  const state = {
    audioContext:{
      sampleRate:4000,
      createBuffer:(_channels,length,rate) => {
        const pcm = new Float32Array(length); // Single synthesized C4 wave transposed into the existing polyphonic MIDI sampler.
        return {duration:length/rate,getChannelData:() => pcm,pcm};
      },
    },
    buffer:null,pitchCache:new Map(),sampleObjectUrl:null,
  };
  const sandbox = {
    state, HOSTED_FLUTE_PERFORMANCE:flute,URL:{revokeObjectURL:noop},
    invalidatePitchCache:noop,clearGestureMediaChannels:noop,
    syncMarkerSlidersFromState:noop,updateSampleUI:noop,drawWaveform:noop,
  };
  vm.runInNewContext(createFallbackBuffer+'\ncreateFallbackBuffer();',sandbox);
  assert(state.buffer && state.buffer.pcm.some(value=>Math.abs(value)>0.02),'fallback must actually output audio');
  return state;
}

(async () => {
  const flute = playerSession('flute'), kurraya = playerSession('kurraya');
  assert.match(flute.performanceUrl,/lyre-performance\.html\?v=[^&]+&instrument=flute$/);
  assert.doesNotMatch(kurraya.performanceUrl,/instrument=flute/);
  assert.equal(flute.calls.begin,1,'the existing blowgun-mouth-mounted flute stays equipped across both modes');
  assert.equal(flute.calls.end,1);
  assert.equal(flute.calls.twitch,0,'flute notes must not trigger the Kurraya string twitch');
  assert.equal(kurraya.calls.twitch,1,'Kurraya retains its original live note response');
  await missingFluteSample();
  const fluteAudio = fallbackSound(true), kurrayaAudio = fallbackSound(false);
  assert.equal(fluteAudio.sampleName,'MIDI flute fallback');
  assert.equal(kurrayaAudio.sampleName,'Fallback pluck');
  assert(fluteAudio.buffer.duration > kurrayaAudio.buffer.duration,'flute breath has a longer envelope');
  assert.notEqual(fluteAudio.buffer.pcm[600],kurrayaAudio.buffer.pcm[600],'flute should not use the Kurraya fallback sound');
  assert.equal(fluteAudio.sampleRootMidi,60,'the existing sampler pitches the synthesized C4 to MIDI notes');
  console.log('flute performance routing, mouth pose, sound isolation and chord-engine fallback tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
