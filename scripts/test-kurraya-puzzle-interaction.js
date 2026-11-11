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
  let equippedInstrument = 'kurraya'; // Lets regression cases pair an NPC Kurraya with the player's flute.
  let instrumentLockCount = 0; // Tests that gameplay action suppression spans Puzzle and Performance modes.
  let instrumentLockReleases = 0; // Ensures closing leaves ordinary combat/held-item input available again.
  let abortedPresses = 0; // Opening an instrument disarms an in-progress weapon hold.
  let playerNotes = 0; // Tracks player-only sounded notes during a two-instrument jam.
  let npcNotes = 0; // Tracks notes from the still-independent NPC frame.
  const jamSyncSnapshots = []; // Records compact NPC tempo/tonic/arrangement handoffs to the real player host.
  let jamStopCount = 0; // Confirms leaving Performance restores the solo transport.
  let initialKeys = []; // Simulate an input already held when the iframe finishes loading.
  let pointerReleases = 0; // The HUD needs mouse input even when opened from a locked camera.
  let bookToggles = 0; // Count real keyboard and controller shortcut dispatches.
  const notes = []; // Actual indices routed through the hosted instrument's public API.
  const judgedNotes = []; // Host events reach the timed puzzle judge before the iframe's audio UI.
  const listeners = new Map(); // Captures the host's capture-phase input events.
  const subscribers = new Map(); // Captures ControllerInput's music-priority subscriber.
  const overlay = makeElement(),frame = makeElement(),menu = makeElement(),mode = makeElement();
  const controls = {musicMinigameOverlay:overlay,musicMinigameFrame:frame,menuBtn:menu,musicMinigameModeBtn:mode};
  const window = {
    KurrayaPuzzle:require('../docs/js/kurraya-puzzle.js'),
    ShoulderCamPointerLock:{release:()=>pointerReleases++},
    Combat:{input:{abortAllPresses:()=>abortedPresses++}},
    KurrayaInstrument:{playFluteNote:()=>playerNotes++,playPlayerKurrayaNote:()=>playerNotes++},
    CharacterActionLocks:{acquire:()=>{instrumentLockCount++;let released=false;return {release:()=>{if(!released){released=true;instrumentLockReleases++;}}};}},
    addEventListener(name,callback){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(callback);},
    dispatchEvent(event){if(event.type==='hobunji-kurraya-puzzle-note')judgedNotes.push(event.detail.noteIndex);},
    removeEventListener(name,callback){listeners.get(name)?.delete(callback);},
    InputBindings:{getCurrentBindings:()=>({controller:controllerBindings}),getDefaultBindings:()=>({musicNote1:'X',musicNote2:'A',musicNote3:'B',musicNote4:'Y',musicBank1:'LT',musicBank3:'LB',musicPause:'START',musicModeToggle:'RS'})},
    ControllerInput:{owner:'gameplay',PRIORITY:{music:40},frame:()=>({pad:{},isDown:code=>initialKeys.includes(code)}),
      setOwner(next){this.owner=next;return next;},gameplaySuspended(){return this.owner!=='gameplay';},
      subscribe(name,callback){subscribers.set(name,callback);return()=>subscribers.delete(name);}},
  };
  let ambientCreated = 0,ambientRemoved = 0, cameraEnd = 0; // Assert the NPC source is released and restored exactly once.
  const ambientElements = []; // Permits independent NPC-to-player sounded-note relay assertions.
  const document = {
    getElementById:id=>controls[id]||null,querySelectorAll:()=>[],activeElement:null,
    body:{classList:{toggle:noop},appendChild:noop},
    createElement() {
      const element = makeElement();
      element.contentWindow={HobunjiMusicControlBridge:{scaleAuditionState:()=>({arrangement:{
        introSteps:[0,0,0,0],bodySteps:Array(16).fill(0),melodyNotes:[{degree:0,durationQuarterBeats:1}]
      }}),
      jamLeaderSnapshot:()=>({playing:true,songId:'when-the-kininjis-bloom',sampledEpochMs:Date.now(),
        elapsedMs:5500,bpm:108,tonicMidi:48,scaleName:'Pentatonic Minor',countInMs:1600,countInBeats:6,
        introSteps:[0,1,2,3],bodySteps:Array(16).fill(4)}),
      startAmbientLead:noop}};
      element.remove=()=>ambientRemoved++;
      ambientCreated++;
      ambientElements.push(element);
      return element;
    }
  };
  frame.contentWindow={
    HobunjiPuzzleInstrument:{playNote:index=>notes.push(index),setInputDevice:(...args)=>hints.push(args),toggleSongbook:()=>bookToggles++},
    HobunjiMusicControlBridge:{enterJamMode:noop,followJamLeader:snapshot=>{jamSyncSnapshots.push(snapshot);return true;},
      stopJamFollow:()=>{jamStopCount++;return true;},jamFollowState:()=>({active:jamSyncSnapshots.length>0})}
  }; // The visible frame owns its playable instrument and receives audio-free NPC transport updates.
  class CustomEvent {constructor(type,options){this.type=type;this.detail=options.detail;}} // Browser event constructor used by the new synchronous host score path.
  vm.runInNewContext(read('docs/js/music-minigame.js'),{
    window,document,CustomEvent,localStorage:{getItem:()=>null,setItem:noop},
    setTimeout:noop,clearTimeout:noop,setInterval:noop,clearInterval:noop
  });
  let performers = []; // Switches simulated NPC schedules while testing ambient resume.
  window.MusicMinigame.init({
    getEquippedInstrument:()=>equippedInstrument,getCurrentArea:()=> 'town',
    listInstrumentPerformers:()=>performers,beginMusicCamera:noop,endMusicCamera:()=>cameraEnd++,
    refreshActionBar:noop,showToast:noop,getNpcFootstepSampleUrl:()=>null,
    triggerNpcKurrayaTwitch:()=>npcNotes++
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
    window,frame,mode,notes,judgedNotes,key,controller,subscribers,hints,setInitialKeys:keys=>{initialKeys=keys;},setControllerBindings:bindings=>{controllerBindings=bindings;},getBookToggles:()=>bookToggles,getPointerReleases:()=>pointerReleases,
    setInstrument:value=>{equippedInstrument=value;},setPerformers:value=>{performers=value;},
    ambientCounts:()=>({created:ambientCreated,removed:ambientRemoved}),ambientFrames:()=>ambientElements,
    sendNote:(source,performer='lead')=>{for(const handler of listeners.get('message')||[])handler({source,data:{source:'hobunji-music-minigame',type:'sounded-note',performer}});},
    announceNpcTransport:source=>{for(const handler of listeners.get('message')||[])handler({source,data:{source:'hobunji-music-minigame',type:'ambient-transport-changed'}});},
    sync:()=>({count:jamSyncSnapshots.length,last:jamSyncSnapshots.at(-1),jamStopCount}),
    actions:()=>({instrumentLockCount,instrumentLockReleases,abortedPresses,playerNotes,npcNotes}),getCameraEnds:()=>cameraEnd
  };
}

(async()=>{
  const loadingGame=makeHost(); // Note judging must not block on the iframe completing its first load.
  assert.equal(loadingGame.window.MusicMinigame.beginPlayerSession(),true);
  delete loadingGame.frame.contentWindow.HobunjiPuzzleInstrument.playNote;
  loadingGame.key('KeyA');
  assert.deepEqual(loadingGame.judgedNotes,[0],'host judges a physical note before the audio iframe loads');
  assert.deepEqual(loadingGame.notes,[],'the missing iframe audio function must not manufacture a played sample');
  loadingGame.window.MusicMinigame.close();

  const game=makeHost();
  assert.equal(game.window.MusicMinigame.beginPlayerSession(),true);
  assert.equal(game.window.MusicMinigame.state.instrumentMode,'puzzle');
  assert.equal(game.window.ControllerInput.owner,'music-puzzle','puzzle claims gameplay action inputs before the iframe loads');
  assert.equal(game.actions().instrumentLockCount,1,'music takes a shared action lock');
  assert.equal(game.actions().abortedPresses,1,'opening disarms any pending attack');
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
  assert.deepEqual(game.judgedNotes,[0,4],'each keyboard press reaches the host judge as soon as it occurs');
  game.key('KeyK');game.key('KeyB');
  game.controller('LT');game.controller('LT','A');game.controller('LT','A');game.controller('A');
  game.controller();game.controller('Y');game.controller();game.controller('LT','Y');game.controller('LB');
  assert.deepEqual(game.notes,[0,4,7,5,3,7],'LT changes new face presses only and supports the upper octave');
  assert.deepEqual(game.judgedNotes,game.notes,'controller note edges dispatch the same physical inputs exactly once');
  assert.deepEqual(Array.from(game.hints.at(-1)[1]),['X','A','B','Y','LT + X','LT + A','LT + B','LT + Y']);
  assert.equal(game.getBookToggles(),2,'keyboard and controller can each toggle the songbook');
  game.controller('START');
  assert.equal(game.window.MusicMinigame.state,null,'Start exits the puzzle');
  assert.equal(game.subscribers.size,0,'closing unregisters the controller subscriber');
  assert.equal(game.getCameraEnds(),1,'closing restores the gameplay camera');
  assert.equal(game.window.ControllerInput.owner,'gameplay','closing Puzzle restores gameplay input');
  assert.equal(game.actions().instrumentLockReleases,1,'closing Puzzle releases the action lock');
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
  game.setInstrument('flute'); // The NPC's Kurraya must remain audible when the player plays the other sampler.
  game.window.MusicMinigame.beginPlayerSession();
  assert.equal(game.ambientCounts().removed,1,'puzzle mode silences the ambient chord backing');
  game.window.MusicMinigame.tick(1.1);
  assert.equal(game.ambientCounts().created,1,'ambient backing cannot restart until the puzzle closes');
  game.window.MusicMinigame.switchInstrumentMode('performance');
  assert.equal(game.window.MusicMinigame.state.mode,'jam','joining an NPC does not make the player a fake backup voice');
  assert.equal(game.window.MusicMinigame.state.instrumentKey,'flute');
  assert.match(game.frame.src,/instrument=flute/);
  assert.equal(game.window.ControllerInput.owner,'music-performance','Performance owns LT and other remapped gameplay actions');
  assert.equal(game.window.ControllerInput.gameplaySuspended(),true);
  assert.equal(game.ambientCounts().created,2,'switching to Performance resumes the NPC immediately in a separate iframe');
  assert.equal(game.ambientCounts().removed,1,'Performance never removes the NPC audio again');
  game.frame.handlers.get('load')(); // Real host binds the newly created Performance iframe and copies only NPC timing/chord data.
  assert.equal(game.sync().count,1,'initial Performance load reads the leader clock immediately');
  assert.equal(game.sync().last.bpm,108,'player receives the NPC quarter-note tempo');
  assert.equal(game.sync().last.tonicMidi,48,'player receives the NPC tonic');
  assert.deepEqual(Array.from(game.sync().last.introSteps),[0,1,2,3],'player receives the NPC six-eight intro bars');
  assert.equal(game.sync().last.bodySteps.length,16,'player receives the NPC three-four melody harmony');
  game.announceNpcTransport(game.ambientFrames()[1].contentWindow); // NPC song resets must sync without waiting for the ambient scheduler.
  assert.equal(game.sync().count,2,'the NPC announces each new procedural song transport');
  game.window.MusicMinigame.tick(1.1);
  assert.equal(game.ambientCounts().created,2,'the scheduled tick does not duplicate the resumed NPC voice');
  assert.equal(game.sync().count,3,'existing NPC tick corrects drift using one compact snapshot');
  game.sendNote(game.frame.contentWindow); // A flute note is the player's event.
  game.sendNote(game.ambientFrames()[1].contentWindow); // The independent Kurraya frame still owns NPC notes.
  assert.equal(game.actions().playerNotes,1,"flute playback animates only the player's instrument");
  assert.equal(game.actions().npcNotes,1,'the ambient Kurraya continues animating its NPC');
  assert.equal(game.actions().instrumentLockReleases,2,'switching modes does not release the action lock early');
  game.window.MusicMinigame.switchInstrumentMode('puzzle');
  assert.equal(game.ambientCounts().removed,2,'returning to Puzzle suspends the NPC again');
  assert.equal(game.window.ControllerInput.owner,'music-puzzle','Puzzle retakes controller ownership from Performance');
  assert.equal(game.sync().jamStopCount,1,'leaving Performance releases the NPC transport');
  game.window.MusicMinigame.switchInstrumentMode('performance');
  assert.equal(game.ambientCounts().created,3,'the NPC resumes independently on repeated mode switches');
  game.window.MusicMinigame.close();
  assert.equal(game.window.ControllerInput.owner,'gameplay','closing Performance gives L2 and combat actions back');
  assert.equal(game.actions().instrumentLockReleases,3,'closing Performance releases the action lock once');
  game.window.MusicMinigame.tick(1.1);
  assert.equal(game.ambientCounts().created,3,'closing the player UI does not restart the still-playing NPC');

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
  assert.equal(modeGame.window.ControllerInput.owner,'gameplay');
  modeGame.window.MusicMinigame.beginPlayerSession({echoChallenge:{id:'echo',notes:[0,1,7]}});
  modeGame.controller('RS');
  assert.equal(modeGame.window.MusicMinigame.state.instrumentMode,'puzzle','RS cannot bypass a ruin echo');

  const joiningNpc = makeHost(); // NPCs starting after the player should also be allowed to sound independently.
  joiningNpc.window.MusicMinigame.beginPlayerSession();
  joiningNpc.window.MusicMinigame.switchInstrumentMode('performance');
  joiningNpc.setPerformers([{npcId:'foroji',name:'Foroji',area:'town',songId:'when-the-kininjis-bloom'}]);
  joiningNpc.window.MusicMinigame.tick(1.1);
  assert.equal(joiningNpc.ambientCounts().created,1,'NPCs can join an already-running player performance');
  assert.equal(joiningNpc.window.MusicMinigame.state.mode,'jam','the late NPC becomes the live tempo/harmony leader');
  assert.equal(joiningNpc.sync().count,1,'late arrival receives immediate NPC clock state');
  joiningNpc.setPerformers([]);
  joiningNpc.window.MusicMinigame.tick(1.1);
  assert.equal(joiningNpc.window.MusicMinigame.state.mode,'lead','leaving NPC restores independent solo performance');
  assert.equal(joiningNpc.sync().jamStopCount,1,'the player releases the missing NPC clock');
  joiningNpc.window.MusicMinigame.close();

  const swappingNpc = makeHost(); // Discard an old clock before the replacement NPC frame is ready.
  swappingNpc.setPerformers([{npcId:'foroji',name:'Foroji',area:'town',songId:'when-the-kininjis-bloom'}]);
  swappingNpc.window.MusicMinigame.beginPlayerSession();
  swappingNpc.window.MusicMinigame.switchInstrumentMode('performance');
  swappingNpc.frame.handlers.get('load')();
  assert.equal(swappingNpc.sync().count,1,'the original leader syncs before the musician changes');
  swappingNpc.setPerformers([{npcId:'leaf',name:'Leaf',area:'town',songId:'when-the-kininjis-bloom'}]);
  swappingNpc.window.MusicMinigame.tick(1.1);
  assert.equal(swappingNpc.sync().jamStopCount,1,'the departed musician clock is discarded immediately');
  assert.equal(swappingNpc.window.MusicMinigame.state.npcId,'leaf','the jam targets the replacement NPC');
  assert.equal(swappingNpc.sync().count,2,'the replacement NPC provides a fresh clock');
  swappingNpc.window.MusicMinigame.close();

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
  console.log('Kurraya puzzle input, independent NPC/flute jams, action isolation and monophonic audio passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
