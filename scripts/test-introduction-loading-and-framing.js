'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const read = path => fs.readFileSync(path, 'utf8'); // Exercise shipped functions with deterministic clocks and scene fixtures.
const game = read('docs/game.js'), loader = read('docs/js/loading-screen-runtime.js'), audio = read('docs/js/audio-system.js');
const preset = JSON.parse(read('docs/config/loading-screens.json')).entries.find(e => e.id === 'world-introduction');
assert.equal(preset.mode, 'introduction');
assert.equal(preset.stages.length, 4, 'opening keeps four preload phases so rescue asset orchestration remains unchanged');
assert(preset.stages.every(s => s.minimumSeconds > 0));
const storyPages = preset.stages.flatMap(stage => stage.pages?.length ? stage.pages : [stage]);
assert.equal(storyPages.length, 9, 'authored opening narration is split into nine visible pages');
assert.equal(storyPages[0].text, 'You hear the grinding of wooden wheels and the shuffle of eight hairy legs. You feel the rough texture of wooden bars against your pelt, and a sharp pain in the back of your head.');
assert.equal(storyPages[1].text, 'You are far from home, and moving still. You know this much. And the bindings on your arms and over your eyes infer it was not of your own accord.');
assert.equal(storyPages[8].text, 'And after flying free for what feels like minutes, you finally land on the hard ground...');
assert.equal(storyPages[8].delayedReveals?.[0]?.text, '\nand find yourself asleep once again.');
const maximPage = storyPages.find(page => page.text === 'that the greatest things in this world of ours');
assert(maximPage, 'lost-may-find maxim page is authored');
assert.equal(maximPage.delayedReveals?.[0]?.afterSeconds, 8);
assert.equal(maximPage.afterPageSeconds, 10, 'the original ten-second pause is a black inter-slide hold after the proverb');
assert.equal(maximPage.bold, true, 'the whole proverb is bold');
assert.equal(maximPage.textColor, '#d6b76b', 'the proverb uses a distinct bronze-gold color');
assert.equal(maximPage.delayedReveals[0].text, '\n\nare those that only the lost may find', 'the second half of the proverb keeps its own delayed line');
assert.equal(storyPages[2].delayedReveals?.[0]?.text, '\nOh Breath...', 'Oh Breath keeps the authored ellipsis');
assert(storyPages[2].text.endsWith('...'), 'the home/name line keeps its authored ellipsis');
assert(storyPages[8].text.endsWith('...'), 'the hard-ground line keeps its authored ellipsis');
assert(storyPages.some(page => Number(page.minimumSeconds) < 8), 'eight seconds is not a blanket inter-slide/page minimum');
assert(loader.includes('const stagePages = stage =>'), 'introduction runtime must support several visible pages inside one preload phase');
assert(loader.includes('delayedReveals'), 'introduction runtime must preserve delayed line reveals');
assert(storyPages.flatMap(page => page.delayedReveals || []).every(reveal => Number(reveal.afterSeconds) >= 8), 'every intra-slide delayed reveal waits at least eight seconds');
assert(loader.includes('const MIN_INTRA_SLIDE_DELAY_SECONDS = 8'), 'runtime enforces the eight-second floor only for intra-slide delayed text');
assert(loader.includes('afterPageSeconds'), 'runtime supports the one authored inter-slide black pause');
assert(loader.includes('introAudio?.started'), 'first-page visibility is gated on the introduction wind actually starting');
assert(audio.includes("wind.addEventListener('playing', markWindStarted"), 'audio session resolves narration gating from the real playing event');
assert(loader.includes('transition:opacity ${INTRO_FADE_MS}ms ease'), 'narrative and delayed spans use opacity fades');
assert(loader.includes('Promise.all([fadeTo(continueButton, 0), fadeTo(stageText, 0)])'), 'Continue and page copy fade out before replacement');
assert(loader.includes("node.style.opacity = '1'"), 'delayed copy fades in from pre-laid-out hidden spans');
const ordinary={state:{lastEntryId:null},Math};
vm.runInNewContext(loader.slice(loader.indexOf('  function pickEntry('),loader.indexOf('  function pickEntry(')+loader.slice(loader.indexOf('  function pickEntry(')).indexOf('\n  function ',1))+'\npick=pickEntry;',ordinary);
assert.equal(ordinary.pick([preset,{id:'normal'}]).id,'normal');assert.equal(ordinary.pick([preset]),null);

class Quaternion {
  constructor(yaw = 0) { this.yaw = yaw; }
  identity() { this.yaw = 0; return this; }
  premultiply(q) { this.yaw += q.yaw; return this; }
}
class Vector {
  set(x,y,z) { Object.assign(this,{x,y,z}); return this; }
  applyQuaternion(q) { const x=this.x,z=this.z; this.x=x*Math.cos(q.yaw)+z*Math.sin(q.yaw); this.z=-x*Math.sin(q.yaw)+z*Math.cos(q.yaw); return this; }
}
const rotation = { window: {}, THREE: { Quaternion, Vector3: Vector, MathUtils:{degToRad:d=>d*Math.PI/180} }, performance:{now:()=>0} };
vm.runInNewContext(read('docs/js/perp-rotation.js'),rotation);
const angleDiff = (a,b) => Math.atan2(Math.sin(a-b),Math.cos(a-b));
rotation.window.PerpRotation.init({angleDiff});
const neck = {parent:{quaternion:new Quaternion(.1),parent:{quaternion:new Quaternion(-.1)}},userData:{}};
const clampNeck = rotation.window.PerpRotation.clampedNeckYaw;
const pos={x:0,z:0}, cam={x:0,z:5};
const first=clampNeck(neck,pos,Math.PI/2-.01,Math.PI,cam);
assert(Math.abs(first-(Math.PI/2-40*Math.PI/180))<1e-8);
for(const jitter of [-.01,.01,-.02,.02]) assert.equal(clampNeck(neck,pos,Math.PI/2+jitter,Math.PI,cam),first);
const otherNeck={parent:neck.parent,userData:{}};
assert(clampNeck(otherNeck,pos,Math.PI/2+.1,Math.PI,cam)>Math.PI/2, 'independent heads may choose opposite edges');
const limited=clampNeck(neck,pos,Math.PI/2,1.15,cam);
assert(Math.abs(limited)<=1.15);
assert.equal(neck.parent.quaternion.yaw,.1,'neck solve never rotates the body');

let rect={top:0,height:600}, panelRect={top:420};
const framing={window:{addEventListener(){}},performance:{now:()=>0},document:{}};
vm.runInNewContext(read('docs/js/dialogue-camera-framing.js'),framing);
const api=framing.window.DialogueCameraFraming;
api.init({getStagingConfig:()=>({}),viewport:{getBoundingClientRect:()=>rect},panel:{classList:{contains:()=>true},getBoundingClientRect:()=>panelRect}});
let pitch=0;
const camera={fov:55,rotateX:a=>{pitch=a;}};
api.apply(camera);
assert(Math.abs(Math.tan(-pitch)/Math.tan(camera.fov*Math.PI/360)-.3)<1e-8,'head projects halfway between viewport top and panel top');
rect={top:80,height:800}; panelRect={top:480}; api.invalidate();api.apply(camera);
assert(Math.abs(Math.tan(-pitch)/Math.tan(camera.fov*Math.PI/360)-.5)<1e-8,'mobile viewport offsets and wrapped dialogue panels are respected');
api.begin(0);assert.equal(api.isActive(),true);api.end();assert.equal(api.isActive(),false,'normal dialogue orbit remains intact');

const faceContext={cutscenePreviewActive:true,cutscenePreviewDialogueSpeaker:{creature:{}},window:{CreatureHeadCache:{getHeadWorld:()=>({x:400,z:600,worldY:1.2})}},TILE:32,cutscenePreviewSpeakerCenterY:()=>null};
vm.runInNewContext(game.slice(game.indexOf('      function dialoguePortraitCameraAim('),game.indexOf('      // Every mesh',game.indexOf('      function dialoguePortraitCameraAim(')))+'\naim=dialoguePortraitCameraAim({alignToDialoguePortraitCenters:true},0,0,4,.1);',faceContext);
assert.equal(faceContext.aim.targetX,12.5);assert.equal(faceContext.aim.targetZ,18.75);assert.equal(faceContext.aim.lookY,1.2);

const chunks=read('docs/js/wilderness-chunks.js'), loads=[];
const controller={mapId:'forest',maxCx:20,maxCz:20,queue:new Map([['neighbor',{}]]),loaded:new Map([['old',{cx:0,cz:0}]]),cancelStaged(){this.cancelled=true;},unload(key){this.loaded.delete(key);},prime(c,r){this.focus={c,r};},load(cx,cz){loads.push([cx,cz]);},updateActive(c,r){this.focus={c,r};}};
const chunkContext={zones:new Map([['forest',controller]]),tileToChunk:n=>Math.floor(n/16),deps:{getCurrentArea:()=> 'forest',isZoneArea:()=>true,player:{x:900,y:900},TILE:1},clamp:(n,min,max)=>Math.max(min,Math.min(max,n)),refreshDebugText(){}};
const pinStart=chunks.indexOf('  const cinematicRegions'),pinEnd=chunks.indexOf('  function rebuildZone',pinStart);
vm.runInNewContext(chunks.slice(pinStart,pinEnd)+chunks.slice(chunks.indexOf('  function update(dt)'),chunks.indexOf('  function snapshot()'))+'\nrelease=pinCinematicRegion("forest",{minCol:32,minRow:48,maxCol:49,maxRow:66}); update(0);',chunkContext);
assert.equal(controller.centerCx,2);assert.equal(controller.centerCz,3);
assert.equal(loads.length,1,'only the current chunk is built before reveal');
assert.equal(controller.queue.size,0);assert.equal(controller.loaded.size,0);assert(controller.cancelled);
vm.runInNewContext('release();update(0);',chunkContext);
assert.equal(controller.focus.c,900,'cleanup returns streaming to gameplay coordinates');
loads.length=0;
vm.runInNewContext('release=pinCinematicRegion("forest",{minCol:0,minRow:0,maxCol:64,maxRow:64,loadWholeMap:true});update(0);',chunkContext);
assert.equal(loads.length,(controller.maxCx+1)*(controller.maxCz+1),'isolated miniature preloads every chunk exactly once');
vm.runInNewContext('release();update(0);',chunkContext);
assert.equal(controller.focus.c,900,'mini-map cleanup returns streaming to gameplay');

async function verifyAssetReadiness() {
  const calls = [], texture = {isTexture:true,image:{complete:true,decode:async()=>calls.push('decode')}}; // A decoded scene texture must reach the GPU before readiness completes.
  const context={window:{CreatureGenetics:{SPECIES_ALIAS:{}},CreatureGeneticsRender:{SPECIES:{wolf:{}},genotypeSignature:()=> 'g',composeFrame:async(kind,frame,g,blink)=>({width:4,height:4,frame,blink})}},THREE:{CanvasTexture:class {constructor(canvas){this.image=canvas;this.repeat={set(){}};this.offset={set(){}};}},SRGBColorSpace:'srgb',RepeatWrapping:1},_genotypeTexCache:{front:new Map(),back:new Map()},_genotypeTexPending:new Map(),_genotypeUnsupportedKinds:new Set(),_genotypeTexFailedAt:new Map(),_genotypeTexLogged:new Set(),performance:{now:()=>0},renderer:{initTexture:tex=>{assert.equal(tex,texture);calls.push('upload');},compileAsync:async()=>calls.push('compile')},camera:{},updateCameraPosition(){},updateCreatureAnimFrame:()=>calls.push('idle'),setTimeout};
  const start=game.indexOf('      function _getGenotypeTextures('),end=game.indexOf('      // Returns true when a real composited texture',start);
  const readyStart=game.indexOf('      async function prepareCutsceneAssets('),readyEnd=game.indexOf('      async function runCutscenePreview(',readyStart);
  vm.runInNewContext(game.slice(start,end)+game.slice(readyStart,readyEnd)+'\nprepare=prepareCutsceneAssets;',context);
  const entities=new Map([['wolf',{creature:{creatureKey:'wolf',genotype:{},def:{sprites:{run:['run1','run2']}}}}]]);
  await context.prepare(entities,{traverse:fn=>fn({material:{map:texture}})});
  assert.equal(context._genotypeTexCache.front.size,6,'all idle/run frames with open and shut eyes finish composing');
  assert.equal(context._genotypeTexPending.size,0,'normal compositing promises are drained without a second asset cache');
  assert.deepEqual(calls,['idle','decode','upload','compile']);
  context.window.CreatureGeneticsRender.composeFrame=async()=>null;context._genotypeTexCache.front.clear();context._genotypeTexCache.back.clear();
  await assert.rejects(context.prepare(entities,{traverse(){}}),/Introduction animal texture failed/,'failed required character assets stop reveal');
}

// Temporary player doubles must clamp against their own live camera bearing, not gameplay azimuth.
const facingStart=game.indexOf('          applyFacingDeadzone(rawRot'),facingEnd=game.indexOf('          resetRouteState()',facingStart);
const facingContext={window:rotation.window,root:{position:{x:0,z:0},rotation:{y:0}},camera:{position:{x:5,z:0}},cameraRelativePerps:()=>[Math.PI/2,-Math.PI/2]};
vm.runInNewContext('walker={rot:0,perpState:{},'+game.slice(facingStart,facingEnd)+'};walker.applyFacingDeadzone(0,1);',facingContext);
assert(Math.abs(facingContext.walker.rot)>=40*Math.PI/180-1e-8,'the temporary player avoids the actual view deadzone');

async function main() {
  await verifyAssetReadiness();
  let clock=0, subscriber=null, removed=false, unlocked=false;
  const timers=[], listeners=new Map(), elements=[]; // Distinct DOM nodes exercise button and status transitions rather than a whole-screen click surrogate.
  const createElement=()=>{ const events=new Map(); let html=''; const el={style:{},children:[],events,textContent:'',offsetWidth:1,setAttribute(){},addEventListener:(name,fn)=>events.set(name,fn),append(...children){this.children.push(...children);},appendChild(child){this.children.push(child);return child;},remove:()=>{removed=true;},focus(){}}; Object.defineProperty(el,'innerHTML',{get(){return html;},set(value){html=String(value);if(value==='')this.children=[];}}); elements.push(el); return el; };
  const state={generation:1};
  const runtimePreset={...preset,stages:preset.stages.map(stage=>({text:stage.text,minimumSeconds:3}))}; // Keep this deterministic clock test focused on one fresh-input gate per preload phase; authored multi-page structure is asserted above.
  let releaseWind; const windStarted=new Promise(resolve=>{releaseWind=resolve;});
  const context={state,document:{createElement,body:{appendChild(){}},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)},window:{AudioSystem:{beginIntroductionMix:()=>({started:windStarted,retry(){},finish(){},debug:()=>({})})},CharacterActionLocks:{acquire:()=>({release:()=>{unlocked=true;}})},ControllerInput:{subscribe:(name,fn)=>{subscriber=fn;return()=>{subscriber=null;};},setOwner(){}}},nowMs:()=>clock,setTimeout:(fn,delay)=>{timers.push({fn,at:clock+delay});},ensureConfigLoaded:async()=>({entries:[runtimePreset]}),ensureFontsLoaded:async()=>true,finalizeHide(){} };
  vm.runInNewContext(loader.slice(loader.indexOf('  async function beginIntroduction('),loader.indexOf('  function callbackSource('))+'\napi=beginIntroduction;',context);
  const session=await context.api();
  const [root,stageText,percentText,continueButton]=elements;
  let releaseAssets;const pendingAssets=new Promise(resolve=>{releaseAssets=resolve;});
  for(let i=0;i<4;i++) {
    if(i)session.start(i);
    assert.equal(stageText.children.at(-1)?.textContent,runtimePreset.stages[i].text);
    assert.equal(continueButton.disabled,true);
    assert.equal(continueButton.style.opacity,'0');
    let continued=false;
    const done=session.complete(i===3?pendingAssets:undefined).then(()=>{continued=true;});
    const flushMicrotasks=async(count=12)=>{for(let tick=0;tick<count;tick++)await Promise.resolve();};
    if(i===0){
      assert.equal(stageText.style.opacity,'0','first words stay hidden before wind playback');
      clock+=9000;await flushMicrotasks();
      assert.equal(session.getDebug().ready,false,'page timer cannot finish before the wind begins');
      assert.equal(timers.length,0,'no page-duration timer starts while waiting for audible wind');
      releaseWind();await flushMicrotasks();
      assert.equal(stageText.style.opacity,'1','first words fade in only after wind starts');
    } else await flushMicrotasks();
    continueButton.events.get('click')();await flushMicrotasks(2);assert.equal(continued,false,'early input cannot skip loading or minimum duration');
    await flushMicrotasks();
    const minimumAt=clock+3000;
    const minimumTimerIndex=timers.findIndex(timer=>timer.at===minimumAt);
    assert(minimumTimerIndex>=0,'authored three-second page timer is scheduled after the page becomes visible');
    clock+=2999;await flushMicrotasks(2);assert.equal(session.getDebug().ready,false,'page stays gated until its authored duration elapses');
    clock++;
    const [minimumTimer]=timers.splice(minimumTimerIndex,1);minimumTimer.fn();await flushMicrotasks();
    if(i===3){assert.equal(session.getDebug().ready,false,'the final page alone still waits for required assets');releaseAssets();for(let tick=0;tick<8;tick++)await Promise.resolve();}
    assert.equal(session.getDebug().ready,true);
    assert.equal(continueButton.disabled,false);
    assert.equal(continueButton.style.opacity,'1');
    assert(continueButton.textContent.includes('Enter / Space'));
    session.setProgress((i+1)*25);assert.equal(percentText.textContent,`${(i+1)*25}%`);
    if(i===1) subscriber({pressed:new Set(['Button0'])});
    else continueButton.events.get('click')();
    await Promise.resolve();assert.equal(continued,false,'page replacement waits for the fade-out');
    clock+=900;for(const timer of timers.splice(0).filter(timer=>timer.at<=clock))timer.fn();for(let tick=0;tick<5;tick++)await Promise.resolve();
    await done;assert.equal(continued,true);assert.equal(continueButton.disabled,true);assert.equal(stageText.style.opacity,'0');
  }
  session.finish();assert(removed && unlocked);assert.equal(subscriber,null);assert.equal(listeners.size,0);assert.equal(state.introduction,null);

  // Execute real opening orchestration: all readiness hooks finish before scene one reveals.
  const order=[], records=['jubmir','father_hunundi_hodu','spearhead_unumanuk','khannibarri_agent'].map(id=>({id}));
  const story={window:{__hobunjiGameStarted:true,LoadingScreenRuntime:{beginIntroduction:async()=>({setProgress(){},complete:async work=>{await work;order.push('continue');},start:i=>order.push('stage'+i),finish:()=>order.push('reveal'),cancel(){}})},LocalDBOverrides:{loadDatabase:async()=>({npcs:records})},AuthoredCutsceneRuntime:{preloadOpeningMeeting:async()=>order.push('meeting-assets'),run:async(payload,options)=>{if(payload.title==='Rescue'){order.push('terrain');await options.onEnvironmentReady();order.push('actors');await options.onActorsReady();order.push('textures-shaders');await options.onReady();order.push('rescue');}else options.onDialogueContinue({id:'meeting_hunundi_final'});},placeOutsideTemple:async()=>{}}},document:{addEventListener(){},getElementById(){return null;}},performance:{now:()=>0},localStorage:{setItem(){},getItem(){return null;}}};
  vm.runInNewContext(read('docs/js/opening-story-cutscene.js'),story);
  assert.equal(await story.window.OpeningStoryCutscene.play({characterId:'c',worldId:'w'}),true);
  assert(order.indexOf('terrain') < order.indexOf('reveal'));
  assert(order.indexOf('textures-shaders') < order.indexOf('reveal'));
  assert.equal(order.filter(step=>step==='continue').length,4);
  assert.deepEqual(order.filter(step=>step.startsWith('stage')),['stage1','stage2','stage3']);
  console.log('Nine-page authored opening copy, independent neck deadzones, panel-safe projection, pinned terrain and four preload-phase gates passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
