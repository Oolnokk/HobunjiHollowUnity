#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Verifies runtime note poses and exact editor action registration.
const fs = require('node:fs'); // Reads the shipped files rather than a mirrored test fixture.
const vm = require('node:vm'); // Runs the real instrument module without a browser or game loop.

const held = fs.readFileSync('docs/js/held-action-animations.js', 'utf8'); // Shared animation definitions used by the editor and game.
const instrumentSource = fs.readFileSync('docs/js/kurraya-instrument.js', 'utf8'); // Live per-note animation and two-plane assembly logic.
const editor = fs.readFileSync('docs/tools/attack-animation-editor/index.html', 'utf8'); // Real action and held-sprite selector source.
const music = fs.readFileSync('docs/js/music-minigame.js', 'utf8'); // Gameplay's postMessage and note routing source.

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
assert(api.notePoseAt(flutePlayNote, flutePlayNote.strikeFrac).y < 0, 'flute note motion differs from its idle');

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

console.log('Flute/Kurraya independent note actions, authoring previews, note re-entry and rest poses passed');
