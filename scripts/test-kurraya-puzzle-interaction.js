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
  const hints = []; // Device updates from the host to the visible HUD.
  let controllerBindings = {}; // Settings overrides in effect when the next instrument session starts.
  let initialKeys = []; // Simulate an input already held when the iframe finishes loading.
  let pointerReleases = 0; // The HUD needs mouse input even when opened from a locked camera.
  let bookToggles = 0; // Count real keyboard and controller shortcut dispatches.
  const notes = []; // Actual indices routed through the hosted instrument's public API.
  const listeners = new Map(); // Captures the host's capture-phase input events.
  const subscribers = new Map(); // Captures ControllerInput's music-priority subscriber.
  const overlay = makeElement(),frame = makeElement(),menu = makeElement(),mode = makeElement();
  const controls = {musicMinigameOverlay:overlay,musicMinigameFrame:frame,menuBtn:menu,musicMinigameModeBtn:mode};
  const window = {
    KurrayaPuzzle:require('../docs/js/kurraya-puzzle.js'),
    ShoulderCamPointerLock:{release:()=>pointerReleases++},
    addEventListener(name,callback){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(callback);},
    removeEventListener(name,callback){listeners.get(name)?.delete(callback);},
    InputBindings:{getCurrentBindings:()=>({controller:controllerBindings}),getDefaultBindings:()=>({musicNote1:'X',musicNote2:'A',musicNote3:'B',musicNote4:'Y',musicBank1:'LT',musicBank3:'LB',musicPause:'START',musicModeToggle:'RS'})},
    ControllerInput:{PRIORITY:{music:40},frame:()=>({pad:{},isDown:code=>initialKeys.includes(code)}),subscribe(name,callback){subscribers.set(name,callback);return()=>subscribers.delete(name);}},
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
  frame.contentWindow={HobunjiPuzzleInstrument:{playNote:index=>notes.push(index),setInputDevice:(...args)=>hints.push(args),toggleSongbook:()=>bookToggles++}}; // Both keyboard and controller must reach this same note owner.
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
  const controller=(...keys)=>{
    const frame = {pad:{axes:[]},isDown:code=>keys.includes(code)}; // The mode toggle runs before note dispatch.
    subscribers.get('music-mode-toggle')?.(frame);
    subscribers.get('music-puzzle')?.(frame);
  };
  return {
    window,frame,mode,notes,key,controller,subscribers,hints,setInitialKeys:keys=>{initialKeys=keys;},setControllerBindings:bindings=>{controllerBindings=bindings;},getBookToggles:()=>bookToggles,getPointerReleases:()=>pointerReleases,
    setPerformers:value=>{performers=value;},ambientCounts:()=>({created:ambientCreated,removed:ambientRemoved}),getCameraEnds:()=>cameraEnd
  };
}

(async()=>{
  const game=makeHost();
  assert.equal(game.window.MusicMinigame.beginPlayerSession(),true);
  assert.equal(game.window.MusicMinigame.state.instrumentMode,'puzzle');
  assert.equal(game.getPointerReleases(),1,'opening Puzzle releases the gameplay pointer lock');
  assert.match(game.frame.src,/kurraya-puzzle\.html/);
  game.setInitialKeys(['X']);
  game.frame.handlers.get('load')(); // Attaches the shipped host input handlers after the puzzle iframe is ready.
  game.controller('X');
  assert.deepEqual(game.notes,[],'a button held before opening cannot play until pressed again');
  game.controller();
  game.setInitialKeys([]);
  game.key('KeyA');game.key('KeyG');game.key('KeyG',{repeat:true});
  game.key('KeyA',{altKey:true});
  assert.deepEqual(game.notes,[0,4],'keyboard notes are single edges with repeats/modifiers ignored');
  game.key('KeyK');game.key('KeyB');
  game.controller('LT');game.controller('LT','A');game.controller('LT','A');game.controller('A');
  game.controller();game.controller('Y');game.controller();game.controller('LT','Y');game.controller('LB');
  assert.deepEqual(game.notes,[0,4,7,5,3,7],'LT changes new face presses only and supports the upper octave');
  assert.deepEqual(Array.from(game.hints.at(-1)[1]),['X','A','B','Y','LT + X','LT + A','LT + B','LT + Y']);
  assert.equal(game.getBookToggles(),2,'keyboard and controller can each toggle the songbook');
  game.controller('START');
  assert.equal(game.window.MusicMinigame.state,null,'Start exits the puzzle');
  assert.equal(game.subscribers.size,0,'closing unregisters the controller subscriber');
  assert.equal(game.getCameraEnds(),1,'closing restores the gameplay camera');
  game.setControllerBindings({musicNote1:'LB',musicBank3:'RB'});
  game.window.MusicMinigame.beginPlayerSession();
  game.frame.handlers.get('load')();
  game.controller('LB');
  assert.equal(game.notes.at(-1),0);
  assert.equal(game.getBookToggles(),2,'remapping a note onto LB does not also toggle the songbook');
  game.controller('RB');
  assert.equal(game.getBookToggles(),3,'the book follows its remapped controller binding');
  assert.equal(game.hints.at(-1)[2],'RB');
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

  const modeGame = makeHost(); // Exercise one controller press across an iframe replacement.
  modeGame.window.MusicMinigame.beginPlayerSession();
  modeGame.controller('RS');
  assert.equal(modeGame.window.MusicMinigame.state.instrumentMode,'performance');
  modeGame.controller('RS');
  assert.equal(modeGame.window.MusicMinigame.state.instrumentMode,'performance','a held RS click cannot switch twice');
  modeGame.controller();
  modeGame.controller('RS');
  assert.equal(modeGame.window.MusicMinigame.state.instrumentMode,'puzzle');
  modeGame.window.MusicMinigame.close();
  modeGame.window.MusicMinigame.beginPlayerSession({echoChallenge:{id:'echo',notes:[0,1,7]}});
  modeGame.controller('RS');
  assert.equal(modeGame.window.MusicMinigame.state.instrumentMode,'puzzle','RS cannot bypass a ruin echo');

  const sounds = []; // Fake voice creation and stop events for validating monophonic playback.
  const gains = []; // Records instrument output levels without decoding actual media in Node.
  class AudioContext {
    constructor(){this.state='running';this.destination={};}
    createBufferSource(){
      const voice={playbackRate:{value:1},connect:noop,disconnect:noop,start(){this.started=true},stop(){this.stopped=true}};
      sounds.push(voice);return voice;
    }
    createGain(){const node={gain:{value:0},connect:noop,disconnect:noop};gains.push(node);return node;}
    async decodeAudioData(){return {duration:1,sampleRate:44100};}
  }
  let releaseFetch = null; // Holds the first sample decode until two overlapping note requests have arrived.
  const deferred = new Promise(resolve=>{releaseFetch=resolve;});
  const sampleWindow={AudioContext,fetch:async()=>({ok:true,arrayBuffer:()=>deferred}),
    localStorage:{getItem:key=>key==='musicSystemDemoSettingsV13' ? JSON.stringify({masterVolume:0.8,kurrayaMixLevel:0.5}) : null}};
  const mod={exports:{}};
  vm.runInNewContext(read('docs/js/kurraya-puzzle.js'),{window:sampleWindow,module:mod});
  const sampler=mod.exports.createSampler('bundle.m4a');
  const first=sampler.play(60),second=sampler.play(64);
  releaseFetch(new ArrayBuffer(10));
  assert.deepEqual(await Promise.all([first,second]),[false,true],'older pending note may not sound after a later one');
  assert.equal(sounds.length,1);
  assert.equal(sounds[0].playbackRate.value,Math.pow(2,4/12));
  assert.equal(gains[0].gain.value,0.7*0.8*0.5,'puzzle volume follows saved Music Lab Kurraya/master levels');
  assert.equal(await sampler.play(65),true);
  assert.equal(sounds[0].stopped,true,'each new note stops the preceding voice, so chords cannot form');
  sampler.stop();
  assert.equal(sounds[1].stopped,true,'stop explicitly releases the last voice');
  console.log('Kurraya puzzle instrument input, NPC suspension and monophonic audio passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
