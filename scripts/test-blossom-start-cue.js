'use strict';
// Exercise the shipped Blossom Hunt start-cue runtime with a minimal scene/audio facade.
const assert = require('node:assert/strict'); // Detects incorrectly retained cues across tiles, quests and scene swaps.
const fs = require('node:fs'); // Loads the actual browser source rather than a test recreation.
const vm = require('node:vm'); // Gives the browser-only module a disposable environment.

class Group {
  constructor() {
    this.children = []; this.parent = null; this.userData = {}; this.visible = true;
    this.position = { set(x,y,z) { Object.assign(this,{x,y,z}); } };
  }
  add(child) { child.parent = this; this.children.push(child); }
  remove(child) { this.children = this.children.filter(other => other !== child); child.parent = null; }
  traverse(visit) { visit(this); for (const child of this.children) child.traverse?.(visit); }
}
class RingGeometry { constructor(inside,outside) { this.inside=inside;this.outside=outside; } dispose() {} }
class Material { constructor(props) { Object.assign(this,props); } clone() { return new Material(this); } dispose() {} }
class Mesh extends Group {
  constructor(geometry,material) { super(); this.geometry=geometry;this.material=material;this.rotation={x:0}; }
}
class Param {
  constructor() { this.value=0; }
  setValueAtTime(v) { this.value=v; }
  setTargetAtTime(v) { this.value=v; }
}
class FakeAudio {
  constructor() { this.currentTime=1;this.destination={};this.state='running'; }
  createGain() { return { gain:new Param(),connect(to){return to;},disconnect(){} }; }
  createStereoPanner() { return {pan:new Param(),connect(to){return to;},disconnect(){}}; }
  createBiquadFilter() { return {frequency:{value:0},connect(to){return to;}}; }
  createOscillator() { return {frequency:{value:0},connect(to){return to;},start(){},stop(){}}; }
  close() { return Promise.resolve(); }
}
const scene = new Group(); // Attached scene used for area-decal add/remove and object borrowing.
let perception = false; // Mimics real Sense Mode toggles without adding an independent rendering loop.
let muted = false; // Exercises the game's canonical AudioSystem SFX switch.
const existing = new Group(); // The scenery owner's real painted stone, never created by this cue.
scene.add(existing);
const world = {
  THREE: {Group,RingGeometry,MeshBasicMaterial:Material,Mesh,DoubleSide:2},
  AudioContext:FakeAudio,
  PerceptionMode:{isActive:()=>perception},
  AudioSystem:{gameAudioConfig:()=>({enabled:!muted,sfxVolume:1})},
  WildernessChunks:{constants:{CHUNK_TILES:16}},
  WildernessLandmarkScenery:{objectAt(zone,requestedScene,point){
    return zone==='map_northern_cliffs' && requestedScene===scene && point.col===14 && point.row===10 ? existing : null;
  }},
  ClimbSystem:{groundYAt:()=>2.25},
  Combat:{deps:{player:{x:13.5*64,y:10.5*64},getActiveCamera:()=>null}},
};
const context = {window:world,globalThis:{},setTimeout:fn=>fn(),console,Math};
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/festival-blossom-start-cue.js','utf8'),context);
const cue = world.FestivalBlossomStartCue; // Public provider called by both quest and PerceptionMode.
const blossom = {id:'cyan',zoneId:'map_northern_cliffs',color:'#00ffff'};
const objectAnchor = {kind:'witnessStone',coordinate:{col:14,row:10},unique:true,dyeId:'color-one'};
const base = {active:true,blossom,anchor:objectAnchor,tile:{area:blossom.zoneId,col:13,row:10},
  scene,color:'#00ffff',shift:12,tilePixels:64};
assert.equal(cue.__test.sameChunk(base.tile,objectAnchor.coordinate,16),true);
assert.equal(cue.__test.sameChunk({...base.tile,col:16},objectAnchor.coordinate,16),false);

cue.update({...base,active:false});
assert.equal(cue.debugSnapshot().voiceActive,false,'inactive quests never create a humming voice');
cue.update(base);
assert.equal(cue.debugSnapshot().voiceActive,true,"the starting object's chunk starts the ruin-style hum");
assert.equal(cue.debugSnapshot().visualKind,'existing-object','object landmarks use their actual authored/scenery geometry');
assert.equal(cue.senseTargets(scene).length,0,'ordinary vision does not reveal a special highlight');
perception=true;
cue.update(base);
assert.equal(cue.senseTargets(scene)[0].root,existing,'perception glows the actual existing stone');
assert.equal(cue.senseTargets(scene)[0].color,'#00ffff','perception uses the current blossom color');
assert.ok(cue.debugSnapshot().audioGain>0);

cue.update({...base,tile:{area:blossom.zoneId,col:16,row:10}});
assert.equal(cue.debugSnapshot().voiceActive,false,'adjacent chunks must go silent, even if physically near');
assert.equal(cue.senseTargets(scene).length,0,'an adjacent chunk cannot highlight the starting point');
assert.equal(existing.parent,scene,'retiring a borrowed stone never removes the actual scenery');

const river = {kind:'riverConfluence',coordinate:{col:6,row:8},waterCenter:{col:8,row:9},unique:true};
const riverOptions={...base,anchor:river,tile:{area:blossom.zoneId,col:5,row:8}};
cue.update(riverOptions);
const ring = cue.senseTargets(scene)[0].root;
assert.equal(ring.children.length,3,'a large ground decal is made from multiple concentric rings');
assert.ok(ring.children[2].geometry.outside>2,'outer ring spans multiple map tiles');
assert.equal(ring.position.y,2.25,'decal follows the actual floor, not flat sea-level');
assert.equal(cue.debugSnapshot().waterCenter.col,8,'river hum uses the verified central water tile');
const edgeRiver={kind:'riverConfluence',coordinate:{col:15,row:9},waterCenter:{col:16,row:9},unique:true};
cue.update({...riverOptions,anchor:edgeRiver,tile:{area:blossom.zoneId,col:15,row:9}});
assert.equal(cue.debugSnapshot().voiceActive,false,'a river bank across a chunk seam cannot trigger sound in the wrong chunk');
cue.update({...riverOptions,anchor:edgeRiver,tile:{area:blossom.zoneId,col:16,row:9}});
assert.equal(cue.debugSnapshot().voiceActive,true,'the verified central water tile owns the audible chunk even when the bank differs');
cue.update(riverOptions); // Restore the original ring and voice for the normal Perception and Shift lifecycle checks.
assert.equal(ring.visible,true,'area decal appears only in Perception Mode');
perception=false;
cue.update(riverOptions);
assert.equal(ring.visible,false,'area marker is invisible without Perception Mode');
assert.equal(cue.senseTargets(scene).length,0);
perception=true;
cue.update(riverOptions);
muted=true;
cue.update(riverOptions);
assert.equal(cue.debugSnapshot().voiceActive,false,'muted SFX immediately stop synthesizer voices');
assert.equal(cue.senseTargets(scene)[0].root,ring,'muting audio does not suppress the visual clue');
muted=false;
cue.update({...riverOptions,shift:13});
assert.equal(ring.parent,null,'a new Shift releases the previous area decal');
assert.equal(cue.debugSnapshot().voiceActive,true);
cue.update({...riverOptions,active:false});
assert.equal(cue.senseTargets(scene).length,0,'quest expiry removes current perception target');
assert.equal(cue.debugSnapshot().voiceActive,false,'quest expiry mutes the hum');
cue.reset();
assert.equal(cue.debugSnapshot().inChunk,false,'world reinit clears any retained landmark ownership');
console.log('ok - Blossom Hunt sound, object glow, river decals and lifecycle');
