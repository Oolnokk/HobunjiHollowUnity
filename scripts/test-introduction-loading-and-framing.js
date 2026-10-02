'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const read = path => fs.readFileSync(path, 'utf8'); // Exercise shipped functions with deterministic clocks and scene fixtures.
const game = read('docs/game.js'), loader = read('docs/js/loading-screen-runtime.js');
const preset = JSON.parse(read('docs/config/loading-screens.json')).entries.find(e => e.id === 'world-introduction');
assert.equal(preset.mode, 'introduction');
assert.equal(preset.stages.length, 4);
assert.deepEqual(preset.stages.map(s => s.text), ['stage 1: Something something something something', 'stage 2: something something something something something.', 'stage 3: something something something something.', 'stage 4: something something something.']);
assert(preset.stages.every(s => s.minimumSeconds > 0));
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
const controller={mapId:'forest',maxCx:20,maxCz:20,prime(c,r){this.focus={c,r};},load(cx,cz){loads.push([cx,cz]);},updateActive(c,r){this.focus={c,r};}};
const chunkContext={zones:new Map([['forest',controller]]),tileToChunk:n=>Math.floor(n/16),deps:{getCurrentArea:()=> 'forest',isZoneArea:()=>true,player:{x:900,y:900},TILE:1},refreshDebugText(){}};
const pinStart=chunks.indexOf('  const cinematicRegions'),pinEnd=chunks.indexOf('  function rebuildZone',pinStart);
vm.runInNewContext(chunks.slice(pinStart,pinEnd)+chunks.slice(chunks.indexOf('  function update(dt)'),chunks.indexOf('  function snapshot()'))+'\nrelease=pinCinematicRegion("forest",{minCol:32,minRow:48,maxCol:49,maxRow:66}); update(0);',chunkContext);
assert.equal(controller.focus.c,40.5);assert.equal(controller.focus.r,57);
assert.equal(loads.length,16,'whole scene footprint and its surrounding trees are built before reveal');
vm.runInNewContext('release();update(0);',chunkContext);
assert.equal(controller.focus.c,900,'cleanup returns streaming to gameplay coordinates');

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

async function main() {
  await verifyAssetReadiness();
  let clock=0, subscriber=null, removed=false, unlocked=false;
  const timers=[], listeners=new Map(), rootListeners=new Map();
  const root={style:{},setAttribute(){},addEventListener:(name,fn)=>rootListeners.set(name,fn),remove:()=>{removed=true;},focus(){}};
  const state={generation:1};
  const context={state,document:{createElement:()=>root,body:{appendChild(){}},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)},window:{CharacterActionLocks:{acquire:()=>({release:()=>{unlocked=true;}})},ControllerInput:{subscribe:(name,fn)=>{subscriber=fn;return()=>{subscriber=null;};},setOwner(){}}},nowMs:()=>clock,setTimeout:(fn,delay)=>{timers.push({fn,at:clock+delay});},ensureConfigLoaded:async()=>({entries:[preset]}),ensureFontsLoaded:async()=>true,finalizeHide(){} };
  vm.runInNewContext(loader.slice(loader.indexOf('  async function beginIntroduction('),loader.indexOf('  function callbackSource('))+'\napi=beginIntroduction;',context);
  const session=await context.api();
  for(let i=0;i<4;i++) {
    if(i)session.start(i);
    assert.equal(root.textContent,preset.stages[i].text);
    let continued=false;
    const done=session.complete().then(()=>{continued=true;});
    rootListeners.get('click')();await Promise.resolve();assert.equal(continued,false,'early input cannot skip loading or minimum duration');
    clock+=2999;assert.equal(timers[0].at,clock+1);
    clock++;timers.shift().fn();await Promise.resolve();
    assert.equal(session.getDebug().ready,true);
    if(i===1) subscriber({pressed:new Set(['Button0'])});
    else rootListeners.get('click')();
    await done;assert.equal(continued,true);
  }
  session.finish();assert(removed && unlocked);assert.equal(subscriber,null);assert.equal(listeners.size,0);assert.equal(state.introduction,null);

  // Execute real opening orchestration: all readiness hooks finish before scene one reveals.
  const order=[], records=['jubmir','father_hunundi_hodu','spearhead_unumanuk','khannibarri_agent'].map(id=>({id}));
  const story={window:{__hobunjiGameStarted:true,LoadingScreenRuntime:{beginIntroduction:async()=>({complete:async()=>order.push('continue'),start:i=>order.push('stage'+i),finish:()=>order.push('reveal'),cancel(){}})},LocalDBOverrides:{loadDatabase:async()=>({npcs:records})},AuthoredCutsceneRuntime:{preloadOpeningMeeting:async()=>order.push('meeting-assets'),run:async(payload,options)=>{if(payload.title==='Rescue'){order.push('terrain');await options.onEnvironmentReady();order.push('actors');await options.onActorsReady();order.push('textures-shaders');await options.onReady();order.push('rescue');}else options.onDialogueContinue({id:'meeting_hunundi_final'});},placeOutsideTemple:async()=>{}}},document:{addEventListener(){}},performance:{now:()=>0},localStorage:{setItem(){},getItem(){return null;}}};
  vm.runInNewContext(read('docs/js/opening-story-cutscene.js'),story);
  assert.equal(await story.window.OpeningStoryCutscene.play({characterId:'c',worldId:'w'}),true);
  assert.deepEqual(order,['continue','stage1','terrain','continue','stage2','actors','meeting-assets','continue','stage3','textures-shaders','continue','reveal','rescue']);
  console.log('Independent neck deadzones, panel-safe projection, pinned terrain and four fresh-input introduction gates passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
