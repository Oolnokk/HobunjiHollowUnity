#!/usr/bin/env node
'use strict';
// Cross-action integration fixture: exercises the shipped pose owners in ONE VM.
// Never substitutes copies of the animation modules. The small Three.js doubles
// only implement the quaternion, transform and renderer calls touched here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  lengthSq() { return this.x ** 2 + this.y ** 2 + this.z ** 2; }
  normalize() { const d = Math.sqrt(this.lengthSq()) || 1; this.x /= d; this.y /= d; this.z /= d; return this; }
  distanceToSquared(v) { return (this.x - v.x) ** 2 + (this.y - v.y) ** 2 + (this.z - v.z) ** 2; }
}
class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; this.isQuaternion = true; }
  copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
  clone() { return new Quaternion(this.x, this.y, this.z, this.w); }
  identity() { return this.copy(new Quaternion()); }
  dot(q) { return this.x*q.x + this.y*q.y + this.z*q.z + this.w*q.w; }
  equals(q) { return this.x===q.x && this.y===q.y && this.z===q.z && this.w===q.w; }
  multiply(q) {
    const { x, y, z, w } = this;
    this.x = x*q.w + w*q.x + y*q.z - z*q.y;
    this.y = y*q.w + w*q.y + z*q.x - x*q.z;
    this.z = z*q.w + w*q.z + x*q.y - y*q.x;
    this.w = w*q.w - x*q.x - y*q.y - z*q.z;
    return this;
  }
  invert() { const d = this.dot(this) || 1; this.x = -this.x/d; this.y = -this.y/d; this.z = -this.z/d; this.w /= d; return this; }
  setFromAxisAngle(axis, angle) { const s = Math.sin(angle/2); this.x = axis.x*s; this.y = axis.y*s; this.z = axis.z*s; this.w = Math.cos(angle/2); return this; }
  setFromEuler(e) {
    // Real quaternion composition, with Y-X-Z rotation order used by drunk gait.
    const qx = new Quaternion().setFromAxisAngle({x:1,y:0,z:0}, e.x || 0);
    const qy = new Quaternion().setFromAxisAngle({x:0,y:1,z:0}, e.y || 0);
    const qz = new Quaternion().setFromAxisAngle({x:0,y:0,z:1}, e.z || 0);
    return this.copy(qy.multiply(qx).multiply(qz));
  }
  slerp(q, t) {
    const a = this.clone(), b = q.clone();
    if (a.dot(b) < 0) { b.x *= -1; b.y *= -1; b.z *= -1; b.w *= -1; }
    this.x = a.x*(1-t)+b.x*t; this.y = a.y*(1-t)+b.y*t;
    this.z = a.z*(1-t)+b.z*t; this.w = a.w*(1-t)+b.w*t;
    const length = Math.sqrt(this.dot(this)) || 1;
    this.x /= length; this.y /= length; this.z /= length; this.w /= length;
    return this;
  }
}
class Euler {
  constructor(x=0,y=0,z=0,order='YXZ') { this.x=x; this.y=y; this.z=z; this.order=order; }
}
const THREE = { Vector3, Quaternion, Euler,
  Group: class {}, BufferGeometry: class { setAttribute() {} dispose() {} },
  Float32BufferAttribute: class {},
  MeshBasicMaterial: class { constructor() { this.colorWrite = true; } dispose() {} },
  Mesh: class { constructor(geometry, material) { this.geometry=geometry; this.material=material; } },
};
const nearly = (actual, expected, label, eps=1e-6) =>
  assert.ok(Math.abs(actual-expected)<eps, label+': '+actual+' should be '+expected);
const sameRotation = (a,b,label) =>
  assert.ok(Math.abs(Math.abs(a.dot(b))-1)<1e-6, label);

const channels = new Map(); // Tracks the actual composer channel publications and releases from crawl, drunk and ragdoll.
const playerRoot = { isObject3D:true, parent:{}, quaternion:new Quaternion(), scale:new Vector3(1,1,1) }; // Captive player visual root for the ownership handoff.
const player = { footing:100,maxFooting:100,health:100 }; // Live combat footing and capture state for the shared player.
let npcLoss = 0.85; // Simulates drunken NPC losing/regaining sobriety across walk/seat transitions.
const parts = new Map(); // The procedural leg solver exposes each existing named thigh and foot, never cloned in the test.
for (const side of ['left','right']) {
  parts.set(side+'_thigh', { position:new Vector3(), quaternion:new Quaternion() });
  parts.set(side+'_foot', { position:new Vector3(), quaternion:new Quaternion() });
}
const legGroup = { getObjectByName(name) { return parts.get(name) || null; } }; // The actual drunk wrapper looks up these four rig nodes.
let legDisposeCount = 0; // Asserts rebuild cleanup runs once per handle.
const legApi = { attach() { return {
  group: legGroup,
  update(_dt,_speed,_suppressed,seated) {
    for (const side of ['left','right']) {
      const thigh=parts.get(side+'_thigh');
      thigh.position.set(seated ? .27 : .11, seated ? -.07 : 0, seated ? .03 : 0);
    }
  }, dispose() { legDisposeCount++; }, applyRecordedLegPose() {}, pants:{update(){}},
}; } };
const legFrame = () => ({
  thighQuaternion:new Quaternion(), calfLocalQuaternion:new Quaternion(),
  upperLength:.2, lowerLength:.2,
}); // Minimal real impact-clip IK record used by ragdoll and crawl sampling.
const impactFrames = [
  {t:0,ragdoll:{body:{localQuaternion:new Quaternion(),localPosition:{y:0}},ik:{left:legFrame(),right:legFrame()}}},
  {t:.5,ragdoll:{body:{localQuaternion:new Quaternion().setFromAxisAngle({x:1,y:0,z:0},.7),localPosition:{y:-.3}},ik:{left:legFrame(),right:legFrame()}}},
]; // Existing impact playback expects two timestamped authored samples.
const clock = { now:0 }; // Advances only when the test intentionally drives a frame.
const timeouts = []; // Captures NPC dance bootstrap without a background timer.
const polls = []; // Existing NPC poll callback, invoked explicitly for hidden-character cancellation.
const w = {
  THREE, ProceduralLegAnimation:legApi, SCRATCHBONES_CONFIG:{},
  Combat:{deps:{player}}, ImpactBlendLibrary:{getClip:()=>({frames:impactFrames,durationSeconds:.5})},
  PlayerBodyTransformComposer:{
    setChannel:(name,data)=>channels.set(name,data),
    clearChannel:name=>channels.delete(name), getPlayerMesh:()=>playerRoot,
  },
  NpcActivityPlanner:{init(){}},
  SocialRhythmClock:{dancerBeatAt:()=>.5},
  setInterval:fn=>{ polls.push(fn); return 1; },
  setTimeout:fn=>{ timeouts.push(fn); return 1; },
};
const context = vm.createContext({window:w,THREE,performance:{now:()=>clock.now},console,Math,Date,Map,Set,WeakMap});
function load(path) { vm.runInContext(fs.readFileSync(path,'utf8'), context, {filename:path}); }
for (const modulePath of [
  'docs/js/rig-transform-layers.js',
  'docs/js/drunk-locomotion.js',
  'docs/js/player-crawl.js',
  'docs/js/combat/impact-ragdoll-playback.js',
  'docs/js/npc-dance-presentation-runtime.js',
  'docs/js/tzatzul-live-visuals.js',
]) load(modulePath);

const root = { isObject3D:true, quaternion:new Quaternion(), rotation:{x:0,y:0,z:0} }; // Live NPC body pivot, shared by drunken body and yawn layers.
const neck = { rotation:{x:0,y:0,z:0} }; // Independent head bone receiving actual named yawn ownership offsets.
const npcLegs = w.ProceduralLegAnimation.attach(THREE,root,{
  name:'test-npc',modelWidth:.9,modelHeight:.9,drunkBodyRoot:root,
  drunkLossProvider:()=>npcLoss,
});
const layers = w.RigTransformLayers;

// Walking -> drunk -> sitting -> seated/standing changes -> yawn, repeatedly.
// This catches thigh accumulation when seated/external IK has no normal gait reset.
for (let i=0;i<300;i++) {
  const seated=i%5===0;
  npcLegs.update(.016,seated ? 0 : 2,false,seated);
  layers.setAxis(neck,'npc-yawn-neck','rotation','x',Math.sin(i/9)*.12);
  layers.setAxis(root,'npc-yawn-body','rotation','x',Math.sin(i/12)*.05);
  assert.ok(layers.getDebug().activeLayers<=8,'named thigh+yawn offsets never multiply on each frame');
}
layers.clear(neck,'npc-yawn-neck');
layers.clear(root,'npc-yawn-body');
nearly(neck.rotation.x,0,'yawn neck returns to authored rest');
nearly(root.rotation.x,0,'yawn torso returns to authored rest');

// Recompose a fresh walking frame, then make a new IK/knockdown owner claim the
// foot and body before the drunken decorator releases its previous contribution.
npcLegs.update(.17,3,false,false);
const externalFoot = new Quaternion().setFromAxisAngle({x:1,y:0,z:0},1.24); // New combat/seat absolute foot rotation.
const externalBody = new Quaternion().setFromAxisAngle({x:0,y:0,z:1},-.88); // New carrier/impact absolute torso orientation.
parts.get('left_foot').quaternion.copy(externalFoot);
root.quaternion.copy(externalBody);
npcLegs.dispose();
sameRotation(parts.get('left_foot').quaternion,externalFoot,'new foot pose survives drunken disposal');
sameRotation(root.quaternion,externalBody,'new body pose survives drunken disposal');
sameRotation(parts.get('right_foot').quaternion,new Quaternion(),'still-owned other foot restores its original quaternion');
assert.ok(w.HobunjiDrunkWalk.getDebug().poseHandoffs.foot>0,'offscreen diagnostics count superseded foot poses');
assert.ok(w.HobunjiDrunkWalk.getDebug().poseHandoffs.body>0,'offscreen diagnostics count superseded body poses');
assert.equal(layers.getDebug().activeLayers,0,'all procedural thigh and yawn offsets released on disposal');
assert.equal(legDisposeCount,1,'one independent NPC leg handle disposed');

// Downed crawl -> impact ragdoll -> recovery/standing. These real modules
// publish independently named composer channels on the same player.
const crawl = w.PlayerCrawl;
crawl.init({TILE:64,getBaseYaw:()=>.25,getPlayerMesh:()=>playerRoot});
crawl.setActive(true);
for(let i=0;i<35;i++)crawl.update(.016);
assert.ok(channels.has('crawl') && channels.has('crawl-weapon'),'crawl publishes body and held-tool presentation');
const impact = w.ImpactRagdollPlayback;
impact.attach(playerRoot,legApi.attach());
assert.ok(impact.trigger('breakThrow','front')>.1,'actual ragdoll playback triggers while crawl is posed');
impact.update(.5);
assert.ok(impact.isHolding(),'recorded knockdown holds while player is prone');
assert.ok(channels.has('ragdoll') && channels.has('crawl'),'different pose owners publish distinct channels');
impact.stop();
assert.ok(!channels.has('ragdoll'),'impact cleanup cannot remove the separate crawl pose');
crawl.setActive(false);
for(let i=0;i<45;i++)crawl.update(.016);
assert.ok(!channels.has('crawl') && !channels.has('crawl-weapon'),'standing clears both crawl channels');
assert.equal(w.HobunjiFreeHandPose.providers.get('crawl')(playerRoot,'left',.9),null,'standing hands are not owned by crawl');

// Tzatzul capture after standing: if another action already took over rotation,
// the actual release owner must not replace it with an old saved idle quaternion.
w.TzatzulLiveVisuals.init({player,hostileObjects:new Set(),getCurrentArea:()=> 'map_northern_cliffs'});
assert.ok(w.TzatzulLiveVisuals.rememberCaptive(player));
const revived = new Quaternion().setFromAxisAngle({x:0,y:1,z:0},.7); // Fresh locomotion/attack orientation.
playerRoot.quaternion.copy(revived);
assert.ok(w.TzatzulLiveVisuals.restoreCaptive(player));
sameRotation(playerRoot.quaternion,revived,'unowned capture cannot overwrite resumed attack pose');
w.TzatzulLiveVisuals.tick(.016,'map_northern_cliffs');
sameRotation(playerRoot.quaternion,revived,'release guard cannot replay a previous idle pose');

// Dance -> invisible/offscreen cancellation while yawn owns the NPC's neck.
// These use the same NPC root but distinct hand, neck and body nodes.
function hand(side) {
  const s = { name:side+'_hand_socket', parent:true, position:new Vector3(side==='left'?-.18:.18,.31,0),
    quaternion:new Quaternion(), updateMatrix(){}, updateMatrixWorld(){},
    rotateX(a){this.quaternion.multiply(new Quaternion().setFromAxisAngle({x:1,y:0,z:0},a));},
    rotateZ(a){this.quaternion.multiply(new Quaternion().setFromAxisAngle({x:0,y:0,z:1},a));} };
  return s;
}
const left=hand('left'), right=hand('right'); // Existing hand sockets whose exact rest pose is checked after cancellation.
const danceRoot = {children:[],add(node){node.parent=this;this.children.push(node);},
  remove(node){this.children=this.children.filter(child=>child!==node);node.parent=null;},
  traverse(fn){fn(this);fn(left);fn(right);} }; // Existing NPC avatar root exposed by the dance runtime.
const walker = {rec:{id:'pose-transition-npc'},root:danceRoot,state:'idle',
  avatarHeight:.72,avatarWidth:.6,
  avatarGroup:{userData:{proceduralHandRig:{armLengthForSide:()=>.33}}},
  currentScheduleTarget:{socialDance:{stimulusId:'cross',style:'loose-sway',armStyle:'overhead-punch'}}};
w.NpcActivityPlanner.init({listNpcWalkersInArea:()=>[walker],getCurrentArea:()=> 'map_northern_cliffs'});
timeouts.forEach(fn=>fn());
const sentinel = danceRoot.children.find(child=>child.onBeforeRender);
assert.ok(sentinel,'actual NPC dance runtime installs its post-hand render sentinel');
layers.setAxis(neck,'npc-yawn-neck','rotation','x',-.15);
sentinel.onBeforeRender();
assert.ok(left.position.y>.5,'NPC dance owns a lifted hand while yawn owns the neck');
walker.currentScheduleTarget={}; // NPC is hidden and receives no further render callback.
polls.forEach(fn=>fn());
nearly(left.position.y,.31,'offscreen dance cancellation restores hand');
nearly(right.position.y,.31,'offscreen dance cancellation restores other hand');
nearly(neck.rotation.x,-.15,'hand cleanup preserves simultaneous yawn');
layers.clear(neck,'npc-yawn-neck');
nearly(neck.rotation.x,0,'yawn cleanup does not revive dance');

// Repeated rig replacements cannot inherit active named offsets.
for(let i=0;i<60;i++) {
  const next = {position:new Vector3(),rotation:{x:0,y:0,z:0}};
  layers.setPosition(next,'drunk-thigh-left',{x:.2,y:.1,z:.05});
  layers.clearAll(next);
  nearly(next.position.x,0,'replaced rig reclaims baseline');
}
assert.equal(layers.getDebug().activeLayers,0,'no active named offsets after interrupted lifetime stress');

// The normal scripts/run-tests.js runner independently executes the full
// NPC-yawn and Tzatzul flight/visual suites; do not nest child processes here.
console.log('Cross-action pose ownership: walking/sitting/drunk/yawn/dance/crawl/ragdoll/capture/rebuild PASS');
