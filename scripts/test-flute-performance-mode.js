#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Checks the real instrument handoff and PCM fallback without a browser.
const fs = require('node:fs'); // Loads the production sources under test.
const vm = require('node:vm'); // Runs player sessions and instrument hooks in isolated browser-like contexts.
const read = path => fs.readFileSync(path, 'utf8');
const noop = () => {};

function playerSession(instrument) {
  const messages = {}; // Captures live iframe notifications to verify per-instrument reactions.
  const calls = { begin:0, end:0, twitch:0, played:0, note:0 }; // Debuggable counters for pose/session and actual note events.
  const element = () => ({dataset:{},classList:{add:noop,remove:noop,toggle:noop},addEventListener:noop});
  const overlay = element(), frame = element();
  frame.contentWindow = {};
  const doc = {body:element(),getElementById:id => id === 'musicMinigameOverlay' ? overlay : id === 'musicMinigameFrame' ? frame : null};
  const win = {
    addEventListener:(type,listener) => (messages[type] ||= []).push(listener),
    KurrayaInstrument:{beginFlute:() => calls.begin++,endFlute:() => calls.end++,playFluteNote:() => calls.note++,playPlayerKurrayaNote:() => calls.note++},
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
  let audioWakeCalls = 0; // A missing optional sound must not await AudioContext.resume() in an untrusted iframe load.
  class Frame {}
  const frame = new Frame();
  frame.getAttribute = () => 'assets/minigames/lyre-performance.html?instrument=flute';
  frame.contentDocument = {getElementById:id => id === 'analysisReadout' ? {textContent:''} : id === 'audioFile' ? {} : null};
  frame.contentWindow = {HobunjiMusicControlBridge:{
    wakeAudio:() => {audioWakeCalls++;return new Promise(()=>{});}, // Simulates a mobile browser waiting indefinitely for a user gesture.
    noteDown:(index)=>played.push(index),
  }};
  const doc = {addEventListener:(type,handler) => listeners[type] = handler};
  const win = {__farmLog:noop};
  vm.runInNewContext(read('docs/js/kurraya-instrument.js'), {
    window:win,document:doc,HTMLIFrameElement:Frame,
    fetch:async path => { fetched.push(path); return {ok:false,status:404}; },
  });
  win.KurrayaInstrument.init({});
  listeners.load({target:frame});
  await Promise.race([
    frame.contentWindow.HobunjiMusicControlBridge.noteDown(2),
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('flute fallback was blocked by autoplay audio wake')),150)),
  ]);
  assert.equal(audioWakeCalls,0,'404 path must not attempt audio activation before a trusted input');
  assert.deepEqual(fetched,['assets/audio/music/instruments/sfx_flute_note.m4a']);
  assert.deepEqual(played,[2],'404 is an expected MIDI-flute fallback, not a blocked performance');
  win.KurrayaInstrument.beginFlute();
  assert.equal(win.KurrayaInstrument.fluteDiagnostics().active,true);
  win.KurrayaInstrument.endFlute();
  assert.equal(win.KurrayaInstrument.fluteDiagnostics().active,false);
}


function testFluteMouthMount() {
  const pixels = new Uint8ClampedArray(4 * 8 * 4); // A narrow opaque flute silhouette exercises the real PNG trim path.
  for (let y = 1; y < 7; y++) pixels.set([165, 119, 45, 255], (y * 4 + 2) * 4);
  const canvas = () => ({
    width:0,height:0,
    getContext:() => ({drawImage:noop,getImageData:() => ({data:pixels.slice()}),putImageData:noop}),
  }); // Mimics the origin-clean canvas already tested in the starter-flute sprite test.
  const mounted = []; // Records each actual call into the shared head-relative blowgun pose helper.
  const renderHooks = []; // Captures the pose hook that runs after the composer moves the head.
  const loadedAssets = []; // Guards against refetching and rebuilding the flute between modes.
  class Group {
    constructor(){this.children=[];this.visible=true;this.parent=null;}
    add(child) {
      if(child.parent)child.parent.children=child.parent.children.filter(item=>item!==child);
      this.children.push(child);child.parent=this;
    }
  }
  class Mesh {
    constructor(geometry,material){this.geometry=geometry;this.material=material;this.rotation={x:0};this.position={z:0};}
  }
  class PlaneGeometry {constructor(width,height){this.width=width;this.height=height;}}
  const THREE = {Group,Mesh,PlaneGeometry,DoubleSide:2};
  const playerRoot = new Group(); // The gameplay root has no neck rig and can change scenes.
  new Group().add(playerRoot);
  let avatar = {userData:{neckRig:{available:true}}}; // Only the skinned portrait owns the mouth.
  playerRoot.add(avatar);
  const loadedPose = {headRelative:true,pitch:-180,yaw:0,roll:4,scale:1.3}; // The actual runtime resolves this from HeldActionAnimations.
  let now = 0; // Advances the authored note clock independently of the render pass.
  const win = {
    Combat:{deps:{playerMesh:playerRoot}},
    WorldPortraitLife:{getPlayerAvatar:() => ({group:avatar})},
    PlayerBodyTransformComposer:{addPostHeadAimHook:fn => renderHooks.push(fn)},
    HeldActionAnimations:{blowgunReady:{poses:{strike:loadedPose}}},
    DynamicSurfaces:{addBeforeRenderClient:fn => renderHooks.push(fn)},
    SharedAttackPose:{
      createHeadFrame:() => ({}),
      headFrame:(frame,actor) => actor === avatar,
      placeAtMouth:(root,frame,pose,scale,aperture) => mounted.push({root,pose,scale,aperture,cameraPosition:frame.cameraPosition}),
    },
    HobunjiSpritePngSurface:{makeCanvasTexture:() => ({}),makeMaterial:() => ({})},
    __farmLog:noop,
  };
  const doc = {addEventListener:noop,createElement:canvas};
  vm.runInNewContext(read('docs/js/kurraya-instrument.js'),{window:win,document:doc,performance:{now:() => now}});
  win.KurrayaInstrument.init({
    THREE,toolTexLoader:{
      setCrossOrigin:noop,
      load:(path,onLoaded) => {loadedAssets.push(path);onLoaded({image:{width:4,height:8},dispose:noop});},
    },
    heldObjectRenderOrder:1.5,
  });
  assert.equal(renderHooks.length,1,'one world-render updater must own the flute');
  win.KurrayaInstrument.beginFlute();
  assert.equal(loadedAssets[0],'assets/toolsprites/flute.png');
  assert.equal(loadedAssets.length,1);
  assert.equal(mounted.length,1,'start attaches the flute through shared mouth placement');
  assert.equal(mounted[0].pose,loadedPose,'the actual B’shuakauitl loaded strike pose drives the flute');
  assert.equal(mounted[0].scale,1.3);
  assert.equal(mounted[0].root.parent,playerRoot.parent,'the flute belongs to the player’s current scene');
  assert.equal(win.KurrayaInstrument.fluteHandTarget()?.holder,mounted[0].root,'the hand rig can grip the visible flute');
  const mesh=mounted[0].root.children[0];
  assert(mesh.geometry.width>0 && mesh.geometry.height>0,'the flute silhouette must form a visible plane');
  assert(Math.abs(mesh.rotation.x-Math.PI/2)<1e-8,'the flute mouthpiece aligns with the blowgun’s local aperture');
  assert(mesh.position.z<0,'the flute barrel extends away from its mouth anchor');
  vm.runInNewContext(read('docs/js/held-action-animations.js'),{
    window:win,URL,
    location:{href:'http://localhost/tools/attack-animation-editor/index.html',pathname:'/tools/attack-animation-editor/index.html'},
    document:{readyState:'loading',currentScript:{src:'http://localhost/js/held-action-animations.js'},write:noop},
  }); // The same flute pose asset loaded by the game and editor.
  const action = win.HeldActionAnimations.flutePlayNote; // Supplies the authored note's peak and recovery times.
  assert.equal(win.KurrayaInstrument.playFluteNote(),true);
  now = action.durationS * action.strikeFrac * 1000;
  win.KurrayaInstrument.advanceFluteNote(now);
  renderHooks[0]([],{},null);
  assert(Math.abs(mounted.at(-1).pose.bodySink-action.poses.strike.bodySink)<1e-9,'the mounted flute samples the authored strike');
  assert.equal(win.KurrayaInstrument.fluteHandTarget()?.holder,mounted[0].root,'the grip stays on the flute during the note');
  now = action.durationS * 1000 + 1;
  win.KurrayaInstrument.advanceFluteNote(now);
  renderHooks[0]([],{},null);
  assert.equal(mounted.at(-1).pose,action.poses.neutral,'the mouth-held flute returns to Neutral after the note');
  const nextScene=new Group();
  nextScene.add(playerRoot);
  avatar = {userData:{neckRig:{available:true}}}; // An equipment/species refresh replaces the portrait within the same outer root.
  playerRoot.add(avatar);
  const camera = {position:{x:1,y:2,z:3}}; // The final render camera drives the shared sprite edge-on correction.
  const placementsBeforeRender = mounted.length;
  renderHooks[0]([],{},camera);
  assert.equal(mounted.length,placementsBeforeRender+1,'rendering resolves the rebuilt portrait’s current mouth');
  assert.equal(mounted.at(-1).cameraPosition,camera.position);
  assert.equal(mounted[0].root.parent,nextScene,'zone transitions must reparent the active flute');
  avatar = null;
  renderHooks[0]([],{},camera);
  assert.equal(win.KurrayaInstrument.fluteHandTarget(),null,'a missing portrait hides the prop and releases the grip');
  assert.equal(win.KurrayaInstrument.fluteDiagnostics().anchorStatus,'waiting-for-portrait');
  avatar = {userData:{neckRig:{available:true}}};
  playerRoot.add(avatar);
  renderHooks[0]([],{},camera);
  assert.equal(win.KurrayaInstrument.fluteHandTarget()?.holder,mounted[0].root,'the grip returns once the replacement portrait is ready');
  win.KurrayaInstrument.endFlute();
  assert.equal(mounted[0].root.visible,false,'closing the performance hides the mouth prop');
  const count=mounted.length;
  renderHooks[0]();
  assert.equal(mounted.length,count,'closed sessions must stop touching the avatar');
  win.KurrayaInstrument.beginFlute();
  assert.equal(loadedAssets.length,1,'returning to performance reuses the loaded flute sprite');
  assert.equal(win.KurrayaInstrument.fluteDiagnostics().ready,true);
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
    state, HOSTED_FLUTE_PERFORMANCE:flute,FLUTE_NOTE_DURATION_S:4.5,URL:{revokeObjectURL:noop}, // Isolated fallback evaluation includes the production flute duration constant.
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
  assert.equal(flute.calls.note,1,'flute still plays one authored note from the real sounded-note relay');
  assert.equal(kurraya.calls.note,1,'Kurraya sounds one editor-authored note per input');
  assert.equal(kurraya.calls.twitch,0,'Kurraya does not double-animate its decorative planes after the holder is posed');
  await missingFluteSample();
  testFluteMouthMount();
  const fluteAudio = fallbackSound(true), kurrayaAudio = fallbackSound(false);
  assert.equal(fluteAudio.sampleName,'MIDI flute fallback');
  assert.equal(kurrayaAudio.sampleName,'Fallback pluck');
  assert(fluteAudio.buffer.duration > kurrayaAudio.buffer.duration,'flute breath has a longer envelope');
  assert.notEqual(fluteAudio.buffer.pcm[600],kurrayaAudio.buffer.pcm[600],'flute should not use the Kurraya fallback sound');
  assert.equal(fluteAudio.sampleRootMidi,60,'the existing sampler pitches the synthesized C4 to MIDI notes');
  console.log('flute performance routing, mouth pose, sound isolation and chord-engine fallback tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
