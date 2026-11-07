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

const begin = held.indexOf('  const flutePlayNote ='); // Authoritative definition start; no repeated pose data in this test.
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
assert(group.position.x > 0.1, 'Kurraya note visibly plucks, rather than remaining idle');
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

console.log('Flute and Kurraya note animations: authored flute grip/pose, strike-only body sink and regression checks passed');
