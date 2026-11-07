#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Verifies runtime note poses and exact editor action registration.
const fs = require('node:fs'); // Reads the shipped files rather than a mirrored test fixture.
const vm = require('node:vm'); // Runs the real instrument module without a browser or game loop.

const held = fs.readFileSync('docs/js/held-action-animations.js', 'utf8'); // Shared animation definitions used by the editor and game.
const instrumentSource = fs.readFileSync('docs/js/kurraya-instrument.js', 'utf8'); // Live per-note animation and two-plane assembly logic.
const editor = fs.readFileSync('docs/tools/attack-animation-editor/index.html', 'utf8'); // Real action and held-sprite selector source.
const music = fs.readFileSync('docs/js/music-minigame.js', 'utf8'); // Gameplay's postMessage and note routing source.
const grips = fs.readFileSync('docs/js/hand-tool-grips.js', 'utf8'); // Canonical authored flute grip values.
const sinkSource = fs.readFileSync('docs/js/weapon-stance-drop-runtime.js', 'utf8'); // Reuses the real body/leg stance runtime.
const handDriver = fs.readFileSync('docs/js/procedural-hand-frame-driver.js', 'utf8'); // Live hand-grip holder and tool-selection routing.
const equipment = fs.readFileSync('docs/js/equipment-panel.js', 'utf8'); // Registered instrument must point at its own animation.

const begin = held.indexOf('  const fluteNeutralNotePose ='); // Includes the authored pose factory and strike-only sink constant before flutePlayNote.
const end = held.indexOf('  window.HeldActionAnimations = Object.freeze', begin); // End of note definitions.
assert(begin >= 0 && end > begin, 'both authored instrument animations must be present');
const { flutePlayNote, kurrayaPlayNote } = vm.runInNewContext(held.slice(begin, end) + '\n({ flutePlayNote, kurrayaPlayNote });');
assert.notEqual(flutePlayNote, kurrayaPlayNote, 'independent actions cannot share animation objects');
for (const [key, action] of Object.entries({flutePlayNote,kurrayaPlayNote})) {
  assert.equal(action.sequence, 'attack', key + ' must animate a whole note with a return');
  assert.equal(action.kind, 'hobunji_held_action_animation', key + ' is not a damaging weapon');
  assert(action.durationS > 0 && action.strikeFrac < action.holdFrac, key + ' has useful note timing');
  assert(action.poses.neutral && action.poses.windup && action.poses.strike, key + ' has three editable poses');
}
assert.equal(flutePlayNote.headRelative, true, 'flute remains mouth anchored');
assert.equal(kurrayaPlayNote.headRelative, false, 'Kurraya stays in its normal held-tool space');
assert.equal(kurrayaPlayNote.poses.neutral.x,0.27,'supplied Kurraya Neutral X must survive');
assert.equal(kurrayaPlayNote.poses.neutral.y,0.08,'supplied Kurraya Neutral Y must survive');
assert.equal(kurrayaPlayNote.poses.neutral.z,0.02,'supplied Kurraya Neutral Z must survive');
assert.equal(kurrayaPlayNote.poses.neutral.shoulderAim.grip,true);
assert.equal(JSON.stringify(kurrayaPlayNote.poses.neutral.elbows.right),JSON.stringify({x:-0.08,y:-0.2,z:0.085}));
assert.equal(kurrayaPlayNote.poses.neutral.offhandIdle.enabled,false);
assert.equal(kurrayaPlayNote.gripMode,'palm-parallel');

const clock = { ms: 0 }; // Deterministic sounded-note frame clock for the sampled game animation.
const window = { HeldActionAnimations: {flutePlayNote,kurrayaPlayNote} }; // Runtime receives exactly the authored values.
vm.runInNewContext(instrumentSource, { window, document: {}, performance: {now: () => clock.ms} });
const api = window.KurrayaInstrument;
assert(api?.notePoseAt && api?.playFluteNote, 'game exposes separate note sampling and flute trigger');
assert.equal(api.notePoseAt(flutePlayNote, flutePlayNote.strikeFrac).bodySink, 10, 'flute strike sinks the body by ten percent');

const twitch = api.newTwitchState(); // Single live Kurraya note animation state.
const group = {
  userData: { kurrayaAssembly: true },
  position: { x: 0.1, y: 0.2, z: 0.3 },
  rotation: { x: 0, y: 0.2, z: -1.25 },
};
api.triggerTwitch(twitch, group);
clock.ms = kurrayaPlayNote.durationS * 1000 * kurrayaPlayNote.strikeFrac;
api.updateTwitch(twitch, group);
assert(Math.abs(group.position.x - (0.1 + kurrayaPlayNote.poses.strike.x - kurrayaPlayNote.poses.neutral.x)) < 1e-9,
  'Kurraya note samples the newly authored Neutral→Strike delta, rather than the old uncalibrated rest');
assert(group.rotation.z > -1.25, 'authored Kurraya roll affects its held assembly');
api.triggerTwitch(twitch, group);
assert.equal(group.position.x, 0.1, 'rapid retriggers restore its held position before starting a new note');
assert.equal(group.rotation.z, -1.25, 'rapid retriggers do not accumulate rotation');
clock.ms += kurrayaPlayNote.durationS * 1000 + 1;
api.updateTwitch(twitch, group);
assert.equal(group.position.y, 0.2, 'Kurraya returns to the original held height');
assert.equal(group.rotation.z, -1.25, 'Kurraya returns to its original held angle');
assert.equal(twitch.active, false);

api.beginFlute();
assert.equal(api.playFluteNote(), true, 'an equipped flute can animate one sounded note');
assert.equal(api.fluteDiagnostics().noteCount, 1, 'flute diagnostics expose actual note triggers');
api.endFlute();
assert.equal(api.playFluteNote(), false, 'an unequipped flute cannot animate an off-screen note');

class Group {
  constructor() { this.children=[]; this.rotation={set:(x,y,z)=>Object.assign(this.rotation,{x,y,z})}; this.position={x:0,y:0,z:0}; this.userData={}; this.name=''; }
  add(node) { this.children.push(node); }
}
class Mesh {
  constructor(geo,mat) { this.geometry=geo; this.material=mat; this.rotation={set:(x,y,z)=>Object.assign(this.rotation,{x,y,z})}; this.position={set:(x,y,z)=>Object.assign(this.position,{x,y,z})}; }
}
const THREE = {Group,Mesh,PlaneGeometry:class{constructor(width,height){this.width=width;this.height=height;}},MeshBasicMaterial:class{constructor(v){Object.assign(this,v);}},DoubleSide:2,MathUtils:{degToRad:deg=>deg*Math.PI/180}};
const assembly = api.buildAssembly({THREE,frontTexture:{image:{width:320,height:663}},topTexture:{},toolModelWidth:0.5});
assert.equal(assembly.children.length, 2, 'editor preview uses the actual two-plane Kurraya');
assert(assembly.userData.kurrayaAssembly, 'preview and game both recognize the Kurraya assembly');

for (const [id,key,tool] of [['flute_play_note','flutePlayNote','flute'],['kurraya_play_note','kurrayaPlayNote','kurraya']]) {
  assert(editor.includes("id: '" + id + "'") && editor.includes("heldAnimationKey: '" + key + "'"), id + ' missing from action picker');
  assert(editor.includes("toolKey: '" + tool + "'"), id + ' missing instrument sprite');
}
assert(editor.includes('prepareFluteCanvas(tex.image)'), 'editor flute must trim the same art as gameplay');
assert(editor.includes("buildAssembly?.({"), 'editor Kurraya must use the real shared assembly');
assert(music.includes("window.KurrayaInstrument?.playFluteNote?.()"), 'sounded flute notes must call the instrument animation');
assert(music.includes("deps?.triggerPlayerKurrayaTwitch?.()"), 'sounded Kurraya notes must animate the held assembly');
assert(!/dispatchEvent\(new CustomEvent\('hobunji-kurraya-puzzle-note',[^\n]*\n\s*animatePlayerNote\(/.test(music), 'puzzle note input must not double-trigger the sounded-note animation');


const authoredNeutral = {
  headRelative:true, x:0.01, y:0, z:0, pitch:-108, yaw:0, bodyYaw:0, roll:4,
  scale:1.3, bodySink:0, shoulderAim:{grip:true,palmNormal:false},
  secondaryGrip:{enabled:false,percent:50,primaryPercent:50},dualWield:{enabled:false},
  elbows:{right:{x:0,y:-0.15,z:0.1}},
}; // User-provided Neutral calibration, checked channel for channel.
assert.equal(JSON.stringify(flutePlayNote.poses.neutral),JSON.stringify(authoredNeutral),'Flute Neutral differs from supplied data');
assert.equal(JSON.stringify(flutePlayNote.poses.windup),JSON.stringify(authoredNeutral),'Windup must exactly match Neutral');
assert.equal(JSON.stringify({...flutePlayNote.poses.strike,bodySink:0}),JSON.stringify(authoredNeutral),'Strike must change only body sink');
assert.notEqual(flutePlayNote.poses.neutral,flutePlayNote.poses.windup,'editable pose objects may not alias');
assert.notEqual(flutePlayNote.poses.neutral.elbows,flutePlayNote.poses.strike.elbows,'elbows must be independent');
assert.equal(flutePlayNote.gripMode,'palm-parallel');

// Parse the live grip default (including its ranged variant) and check the one-time saved-draft migration.
const fluteStart=grips.indexOf('      flute: {');
const fluteEnd=grips.indexOf('      },',fluteStart);
assert(fluteStart>=0&&fluteEnd>fluteStart,'missing flute grip default');
const grip=vm.runInNewContext('({' + grips.slice(fluteStart,fluteEnd+8) + '})').flute;
assert.equal(grip.toolScale,0.6);
assert.equal(grip.heightMultiplier,0.5);
assert.equal(JSON.stringify(grip.primaryGrip),JSON.stringify({position:{x:0,y:0,z:0},rotationDeg:{pitch:0,yaw:0,roll:0}}));
assert.equal(JSON.stringify(grip.rangedPrimaryGrip),JSON.stringify({position:{x:-0.05,y:0.04,z:-0.1913},rotationDeg:{pitch:0,yaw:-90,roll:0}}));
for(const key of ['primaryGripSpan','secondaryGripSpan','rangedSecondaryGripSpan'])assert.equal(grip[key].enabled,false);
assert(grips.includes('if (resetFluteGrip) next.tools.flute = clone(DEFAULT_DATA.tools.flute)'),'saved grip migration must affect flute only');

// The same pose must drive the physical player body and procedural leg handle in gameplay.
let sinkCall=null; // The actual registered pre-render callback.
let sinkUnits=0; // Fake leg handle's most recent physical sink amount.
let stanceActive=false; // A carried weapon idle must not override the active flute note.
const composed=new Map(); // Shows actual character-body translation channel writes.
const leg={
  modelHeight:1,
  setStanceYawDeg:()=>{},
  setStanceDrop:v=>{sinkUnits=v;},
  getStanceDrop:()=>sinkUnits,
};
const musician={
  HeldActionAnimations:{flutePlayNote},KurrayaInstrument:api,
  SCRATCHBONES_CONFIG:{game:{assets:{pngPlaneAvatar:{proceduralFeet:{stanceDrop:{enabled:true}}}}}},
  PlayerBodyTransformComposer:{
    setChannel:(key,v)=>composed.set(key,v),clearChannel:key=>composed.delete(key),
    getPlayerLegHandle:()=>leg,getPlayerMesh:()=>({}),
  },
  WeaponToolStances:{stanceEngaged:()=>stanceActive,idleBodyYawSnapshot:()=>({yawDeg:0})},
  SharedAttackPose:{idleBodySinkPct:()=>6},
  RuntimeFrameScheduler:{register:(key,cb)=>{if(key==='weapon-stance-drop-sync')sinkCall=cb;}},
};
vm.runInNewContext(sinkSource,{window:musician,performance:{now:()=>clock.ms}});
assert.equal(musician.WeaponStanceDropRuntime.beginInstrumentNote('flute'),true);
const noteStart=clock.ms; // Shared monotonic clock makes the strike sample deterministic.
clock.ms=noteStart+flutePlayNote.durationS*1000*flutePlayNote.strikeFrac;
sinkCall();
assert.equal(sinkUnits,0.1,'physical leg handle must sink by 10% of body height');
assert.equal(composed.get('weapon-stance-drop').translation.y,-0.1,'player body composer must lower the rendered avatar');
assert.equal(musician.WeaponStanceDropRuntime.getDebug().reason,'instrument-note');
stanceActive=true;
sinkCall();
assert.equal(sinkUnits,0.1,'a held weapon idle must not hide the flute note');
musician.WeaponStanceDropRuntime.noteSwingSink(5);
sinkCall();
assert.equal(sinkUnits,0.05,'a real combat swing must win');
stanceActive=false;
musician.WeaponStanceDropRuntime.endInstrumentNote();
sinkCall();
assert.equal(sinkUnits,0,'closing flute mode must release leg sink');
assert.equal(composed.has('weapon-stance-drop'),false,'closing flute mode must clear body translation');


// The runtime must use the actual mouth-mounted flute and its Ranged grip rather than the last equipped weapon.
assert(equipment.includes("isInstrument:true, heldAnimationKey:'flutePlayNote'"), 'flute item still references the blowgun animation');
assert.equal(typeof api.fluteHandTarget,'function','live flute mount must expose a hand target');
const bridgeStart=handDriver.indexOf('  function playerFluteTarget(record)');
const bridgeEnd=handDriver.indexOf('  // Bag items',bridgeStart);
assert(bridgeStart>=0&&bridgeEnd>bridgeStart,'live flute hand bridge absent');
const avatarRoot={}; // Only the local player should route to the mouth-mounted flute.
const liveHolder={parent:{},visible:true}; // Same scene object consumed by the hand driver, not an editor-only proxy.
let fluteActive=true; // Simulates the same instrument closing without replacing the player's hand driver.
let kurrayaActive=false; // Tests that the next instrument takes over the player without affecting an NPC.
const kurrayaHolder={parent:{},visible:true}; // Real held-assembly parent consumed by the runtime hand driver.
const fakeWindow={
  KurrayaInstrument:{
    fluteHandTarget:()=>fluteActive?{holder:liveHolder,toolKey:'flute',gripContext:'ranged'}:null,
    fluteDiagnostics:()=>({active:fluteActive}),
    kurrayaHandDiagnostics:()=>({active:kurrayaActive}),
    playerKurrayaHandTarget:()=>kurrayaActive?{holder:kurrayaHolder,toolKey:'kurraya',gripContext:'melee'}:null,
    playerRightHandPose:()=>kurrayaActive?{influence:1,x:0.5,y:0.25,z:0.1,pitch:0,yaw:0,roll:0}:null,
  },
  WeaponToolStances:{getRuntimeState:()=>({itemKey:'hatchet',activeSlot:'weapon'})},
};
const handBridge=vm.runInNewContext(
  handDriver.slice(bridgeStart,bridgeEnd) +
    '\n({ currentToolKey, currentGripContext, currentToolHolder });',
  {
    toolGrips:{toolKeyFor:key=>key,currentGripContext:()=> 'melee'},
    gameDeps:{playerMesh:avatarRoot,toolHolder:{parent:{},visible:true}},
    global:fakeWindow,document:{},inAttackEditor:()=>false,
  });
const local={rig:{parent:avatarRoot},avatarRoot:{userData:{}}};
assert.equal(handBridge.currentToolKey(local),'flute','player hands must select flute instead of weapon-slot hatchet');
assert.equal(handBridge.currentGripContext(local),'ranged','flute hands must use the supplied Ranged primary grip');
assert.equal(handBridge.currentToolHolder(local),liveHolder,'hand rig must read the actual mouth-mounted flute transform');
const hostile={rig:{parent:{}},avatarRoot:{userData:{}}};
assert.equal(handBridge.currentToolKey(hostile),'hatchet','player flute must not leak into NPC hand selection');
fluteActive=false; // Closing the music session returns the hands to the standard weapon path.
assert.equal(handBridge.currentToolKey(local),'hatchet','normal weapon grip must return after the flute session closes');
assert.equal(handBridge.currentGripContext(local),'melee','ordinary grip context must return after the flute session closes');
kurrayaActive=true;
assert.equal(handBridge.currentToolKey(local),'kurraya','Kurraya player session must own the equipped tool key');
assert.equal(handBridge.currentGripContext(local),'melee','Kurraya custom axis uses the 2H/melee grip frame');
assert.equal(handBridge.currentToolHolder(local),kurrayaHolder,'the actual player Kurraya assembly parent owns the hand mount');
assert.equal(handBridge.currentToolKey(hostile),'hatchet','player Kurraya hand selection cannot leak into NPC grips');
kurrayaActive=false;
assert.equal(handBridge.currentToolKey(local),'hatchet','closing Kurraya restores the previous equipment hand state');


// Integration tests for the optional custom 3D virtual Z and the detachable plucking hand.
// Instantiate the real grip module with a no-op frame scheduler (there is no browser DOM here).
const gripWindow = { RuntimeFrameScheduler: {register:()=>{}}, location:{pathname:'/game'} };
vm.runInNewContext(grips,{window:gripWindow,document:{getElementById:()=>null}});
const gripsApi=gripWindow.HobunjiHandToolGrips;
assert(gripsApi?.customGripAxisForTool && gripsApi?.sampleFreeRightHand,'real runtime must export both custom-axis and independent-hand samplers');
assert.equal(gripsApi.defaultData.tools.kurraya.customGripAxis.enabled,false,'Kurraya axis is opt-in until Nut and Bridge have been measured');
const length=Math.sqrt(0.32); // Distance from (0.1,0.2,0) Nut to (0.5,0.6,0) Bridge in tool units.
gripsApi.mutate(data=>{
  const k=data.tools.kurraya; // This is the actual game-editor shared grip profile, not a second fixture.
  k.customGripAxis={enabled:true,start:{x:0.1,y:0.2,z:0},end:{x:0.5,y:0.6,z:0}};
  k.primaryGripSpan={enabled:true,startZ:0,endZ:length};
  k.secondaryGripSpan={enabled:true,startZ:0,endZ:length};
});
const activeGrip={animationGripState:{influence:1,primaryPercent:50,percent:100}};
const primary=gripsApi.primaryGripForTool('kurraya','melee',activeGrip);
const secondary=gripsApi.secondaryGripForTool('kurraya','melee',activeGrip);
for (const [actual,expected] of [['x',0.3],['y',0.4],['z',0]].map(([key,value])=>[primary.position[key],value]))
  assert(Math.abs(actual-expected)<1e-8,'primary hand must lie halfway along tilted 3D axis');
for (const key of ['x','y','z'])
  assert(Math.abs(secondary.position[key] - ({x:0.5,y:0.6,z:0})[key])<1e-8,'offhand must reach the bridge endpoint in 3D');
gripsApi.mutate(data=>{ data.tools.kurraya.customGripAxis.enabled=false; });
assert.equal(gripsApi.primaryGripForTool('kurraya','melee',activeGrip).position.x,0,'unchecked axis falls back to legacy Z-only coordinates');
gripsApi.mutate(data=>{data.tools.kurraya.customGripAxis={enabled:true,start:{x:0,y:0,z:0},end:{x:0,y:0,z:0}};});
assert.equal(gripsApi.customGripAxisForTool('kurraya').enabled,false,'degenerate 3D axes must fail safely without NaNs');

const freePhases={
  neutral:{rightHand:{enabled:false,x:0,y:0,z:0}},
  windup:{rightHand:{enabled:true,x:0.2,y:0.3,z:0.1,pitch:12}},
  strike:{rightHand:{enabled:true,x:0.4,y:0.2,z:0.3,pitch:24}},
};
const freeStart=gripsApi.sampleFreeRightHand(freePhases,kurrayaPlayNote,0);
const freeWindup=gripsApi.sampleFreeRightHand(freePhases,kurrayaPlayNote,kurrayaPlayNote.windupFrac);
const freeStrike=gripsApi.sampleFreeRightHand(freePhases,kurrayaPlayNote,kurrayaPlayNote.strikeFrac);
assert.equal(freeStart.influence,0,'hand starts on instrument before detaching');
assert.equal(freeWindup.influence,1);
assert.equal(freeWindup.y,0.3);
assert.equal(freeStrike.x,0.4);
assert.equal(freeStrike.pitch,24);
const strikeOnly={neutral:{rightHand:{enabled:false}},windup:{rightHand:{enabled:false}},strike:{rightHand:{enabled:true,x:0.65,y:0.2,z:0.1}}};
const midway=gripsApi.sampleFreeRightHand(strikeOnly,kurrayaPlayNote,(kurrayaPlayNote.windupFrac+kurrayaPlayNote.strikeFrac)/2);
assert.equal(midway.x,0.65,'detaching into Strike must keep the target coordinate rather than lerping from avatar origin');
assert(Math.abs(midway.influence-0.5)<1e-9,'detaching into Strike must smoothly blend from the live grip');
assert.equal(gripsApi.sampleFreeRightHand({neutral:{},windup:{},strike:{}},kurrayaPlayNote,0.4),null,'old attacks must preserve bound-hand behavior');

window.HobunjiHandToolGrips=gripsApi;
api.beginPlayerKurraya();
assert.equal(api.playPlayerKurrayaNote(),true,'sounded player note starts the free-hand clock');
const noteParent={visible:true}; // The real group's immediate held holder is returned as the grip frame.
const playerAssembly={userData:{kurrayaAssembly:true},position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},parent:noteParent};
api.triggerTwitch(api.newTwitchState(),playerAssembly);
assert.equal(api.playerKurrayaHandTarget().holder,noteParent,'player hand follows the actual Kurraya holder');
assert.equal(api.kurrayaHandDiagnostics().noteCount,1);
const savedFreePhases=kurrayaPlayNote.poses;
kurrayaPlayNote.poses=freePhases;
clock.ms += 30;
assert(api.playerRightHandPose().influence>0,'a genuine note must interpolate the free hand');
kurrayaPlayNote.poses=savedFreePhases;
api.endPlayerKurraya();
assert.equal(api.playerRightHandPose(),null,'closing player music releases the free hand');
assert.equal(api.playerKurrayaHandTarget(),null,'closing player music releases the captured holder');
assert.equal(api.playPlayerKurrayaNote(),false,'no player hand notes outside a session');

assert(grips.includes('handCustomGripAxisPickStart') && editor.includes('gripAxisMarkers'),'editor exposes moveable Nut marker');
assert(grips.includes('handCustomGripAxisPickEnd') && editor.includes('gripAxisMarkers'),'editor exposes moveable Bridge marker');
assert(editor.includes('poseFreeRightHandEnabled'),'editor offers a per-pose free-right-hand switch');
assert(editor.includes("setGizmoMode('translate', 'rightHand')"),'free hand can be dragged in avatar space');
assert(editor.includes("setGizmoMode('rotate', 'rightHand')"),'free hand can be rotated in avatar space');
assert(editor.includes('function enableFreeRightHandForPhase(phase)'), 'gizmo and checkbox must both initialize from the actual grip');
assert(editor.includes('const holderQ = toolHolder.getWorldQuaternion(new THREE.Quaternion())'), 'capturing free hand must keep its wrist orientation as well as position');
assert(editor.includes('syncGripAxisMarkers(); // Keep Nut/Bridge markers visible'), 'nut and bridge preview markers must update during ordinary playback');
assert(music.includes('playPlayerKurrayaNote?.()'),'game relays sounded notes to the free hand');
assert(handDriver.includes('freeRightHandFor(record, toolKey)'),'live procedural hand driver consumes independent hand poses');

console.log('Flute/Kurraya authored poses, 3D grip axis, right-hand mode, note routing and body sink passed');
