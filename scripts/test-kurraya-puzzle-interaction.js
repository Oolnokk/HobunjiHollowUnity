'use strict';
const assert = require('node:assert/strict'); // Verifies actual puzzle-mode input, NPC ownership and audio behavior.
const fs = require('node:fs'); // Reuses shipped game code, rather than a test replica.
const vm = require('node:vm'); // Isolates the host module with deterministic browser seams.
const read = file => fs.readFileSync(file,'utf8'); // Loads the code under review.
const noop = () => {};

function makeElement() {
  const handlers = new Map(); // Allows the simulated frame to signal load after changing its source.
  return {
    dataset:{},style:{},handlers,
    classList:{add:noop,remove:noop,toggle:noop},
    getAttribute:()=>null,setAttribute:noop,remove:noop,
    addEventListener:(type,callback)=>handlers.set(type,callback),
    removeEventListener:noop,
  };
}
function makeHost() {
  const notes = []; // Actual indices routed through the hosted instrument's public API.
  const listeners = new Map(); // Captures the host's capture-phase input events.
  const subscribers = new Map(); // Captures ControllerInput's music-priority subscriber.
  const overlay = makeElement(),frame = makeElement(),menu = makeElement(),mode = makeElement();
  const controls = {musicMinigameOverlay:overlay,musicMinigameFrame:frame,menuBtn:menu,musicMinigameModeBtn:mode};
  const window = {
    addEventListener(name,callback){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(callback);},
    removeEventListener(name,callback){listeners.get(name)?.delete(callback);},
    InputBindings:{getDefaultBindings:()=>({musicNote1:'B1',musicNote2:'B2',musicNote3:'B3',musicNote4:'B4',musicBank1:'LT',musicPause:'START'})},
    ControllerInput:{PRIORITY:{music:40},subscribe(name,callback){subscribers.set(name,callback);return()=>subscribers.delete(name);}},
  };
  let ambientCreated = 0,ambientRemoved = 0, cameraEnd = 0; // Assert the NPC source is released and restored exactly once.
  const document = {
    getElementById:id=>controls[id]||null,querySelectorAll:()=>[],activeElement:null,
    body:{classList:{toggle:noop},appendChild:noop},
    createElement() {
      const element = makeElement();
      element.contentWindow={HobunjiMusicControlBridge:{scaleAuditionState:()=>({arrangement:{
        introSteps:[0,0,0,0],bodySteps:Array(16).fill(0),melodyNotes:[{degree:0,durationQuarterBeats:1}]
      }})}};
      element.remove=()=>ambientRemoved++;
      ambientCreated++;
      return element;
    }
  };
  frame.contentWindow={HobunjiPuzzleInstrument:{playNote:index=>notes.push(index)}}; // Both keyboard and controller must reach this same note owner.
  vm.runInNewContext(read('docs/js/music-minigame.js'),{
    window,document,localStorage:{getItem:()=>null,setItem:noop},
    setTimeout:noop,clearTimeout:noop,setInterval:noop,clearInterval:noop
  });
  let performers = []; // Switches simulated NPC schedules while testing ambient resume.
  window.MusicMinigame.init({
    getEquippedInstrument:()=> 'kurraya',getCurrentArea:()=> 'town',
    listInstrumentPerformers:()=>performers,beginMusicCamera:noop,endMusicCamera:()=>cameraEnd++,
    refreshActionBar:noop,showToast:noop,getNpcFootstepSampleUrl:()=>null
  });
  const key=(code,{repeat=false,altKey=false}={})=>{
    const event={code,repeat,altKey,ctrlKey:false,metaKey:false,preventDefault:noop,stopImmediatePropagation:noop};
    [...(listeners.get('keydown')||[])].forEach(handler=>handler(event));
  };
  const controller=(...keys)=>subscribers.get('music-puzzle')?.({pad:{axes:[]},isDown:code=>keys.includes(code)});
  return {
    window,frame,mode,notes,key,controller,subscribers,
    setPerformers:value=>{performers=value;},ambientCounts:()=>({created:ambientCreated,removed:ambientRemoved}),getCameraEnds:()=>cameraEnd
  };
}

(async()=>{
  const game=makeHost();
  assert.equal(game.window.MusicMinigame.beginPlayerSession(),true);
  assert.equal(game.window.MusicMinigame.state.instrumentMode,'puzzle');
  assert.match(game.frame.src,/kurraya-puzzle\.html/);
  game.frame.handlers.get('load')(); // Attaches the shipped host input handlers after the puzzle iframe is ready.
  game.key('KeyA');game.key('KeyG');game.key('KeyG',{repeat:true});
  game.key('KeyA',{altKey:true});
  assert.deepEqual(game.notes,[0,4],'keyboard notes are single edges with repeats/modifiers ignored');
  game.controller('LT');game.controller('LT');game.controller();game.controller('LT');
  assert.deepEqual(game.notes,[0,4,4,4],'LT is note five, and a held controller button is not retriggered');
  game.controller('START');
  assert.equal(game.window.MusicMinigame.state,null,'Start exits the puzzle');
  assert.equal(game.subscribers.size,0,'closing unregisters the controller subscriber');
  assert.equal(game.getCameraEnds(),1,'closing restores the gameplay camera');
  game.window.MusicMinigame.beginPlayerSession();
  game.frame.handlers.get('load')();
  game.key('Escape');
  assert.equal(game.window.MusicMinigame.state,null,'Escape also closes the puzzle');
  assert.equal(game.getCameraEnds(),2);

  game.setPerformers([{npcId:'foroji',name:'Foroji',area:'town',songId:'when-the-kininjis-bloom'}]);
  game.window.MusicMinigame.tick(1.1);
  assert.equal(game.ambientCounts().created,1,'scheduled ambient NPC audio is initially present');
  game.window.MusicMinigame.beginPlayerSession();
  assert.equal(game.ambientCounts().removed,1,'puzzle mode silences the ambient chord backing');
  game.window.MusicMinigame.tick(1.1);
  assert.equal(game.ambientCounts().created,1,'ambient backing cannot restart until the puzzle closes');
  game.window.MusicMinigame.switchInstrumentMode('performance');
  assert.equal(game.window.MusicMinigame.state.mode,'backup');
  assert.ok(game.window.MusicMinigame.state.songSnapshot?.melodyNotes?.length,'NPC song survives transition into Performance');
  game.window.MusicMinigame.close();
  game.window.MusicMinigame.tick(1.1);
  assert.equal(game.ambientCounts().created,2,'the NPC resumes normal ambient music after the player exits');

  const sounds = []; // Fake voice creation and stop events for validating monophonic playback.
  class AudioContext {
    constructor(){this.state='running';this.destination={};}
    createBufferSource(){
      const voice={playbackRate:{value:1},connect:noop,disconnect:noop,start(){this.started=true},stop(){this.stopped=true}};
      sounds.push(voice);return voice;
    }
    createGain(){return {gain:{value:0},connect:noop,disconnect:noop};}
    async decodeAudioData(){return {duration:1,sampleRate:44100};}
  }
  let releaseFetch = null; // Holds the first sample decode until two overlapping note requests have arrived.
  const deferred = new Promise(resolve=>{releaseFetch=resolve;});
  const sampleWindow={AudioContext,fetch:async()=>({ok:true,arrayBuffer:()=>deferred}),localStorage:{getItem:()=>null}};
  const mod={exports:{}};
  vm.runInNewContext(read('docs/js/kurraya-puzzle.js'),{window:sampleWindow,module:mod});
  const sampler=mod.exports.createSampler('bundle.m4a');
  const first=sampler.play(60),second=sampler.play(64);
  releaseFetch(new ArrayBuffer(10));
  assert.deepEqual(await Promise.all([first,second]),[false,true],'older pending note may not sound after a later one');
  assert.equal(sounds.length,1);
  assert.equal(sounds[0].playbackRate.value,Math.pow(2,4/12));
  assert.equal(await sampler.play(65),true);
  assert.equal(sounds[0].stopped,true,'each new note stops the preceding voice, so chords cannot form');
  sampler.stop();
  assert.equal(sounds[1].stopped,true,'stop explicitly releases the last voice');
  console.log('Kurraya puzzle instrument input, NPC suspension and monophonic audio passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
