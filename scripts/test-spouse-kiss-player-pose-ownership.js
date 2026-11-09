// Gameplay regression for kiss/festival ownership over normal weapon/tool and camera pose writers.
// Run: node scripts/test-spouse-kiss-player-pose-ownership.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = file => fs.readFileSync('docs/js/' + file + '.js', 'utf8');
const files = {
  kiss: read('spouse-kiss-motion'),
  weapon: read('weapon-stance-drop-runtime'),
  yaw: read('weapon-idle-body-yaw-runtime'),
  composer: read('player-body-transform-composer'),
  festival: read('festival-wheel-dance-runtime'),
}; // Inspect real shared source, not a duplicated game-pose implementation.

let locked = false; // Simulates the exclusive 'pose' token held by a festival dance or spouse kiss.
const writes = { knee: [], yaw: [], set: [], cleared: [] }; // Records actual per-frame leg and composer writes.
const callbacks = new Map(); // Scheduler register captures each game's real pre-render subscriber.
const player = {}; // Stable player root for the fake composer.
const legs = {
  modelHeight: 1,
  setStanceYawDeg(deg) { writes.yaw.push(deg); },
  setStanceDrop(units) { writes.knee.push(units); },
  getStanceDrop() { return writes.knee.at(-1) || 0; },
}; // Existing procedural-leg API; no test-only alternate pose system.
const composer = {
  getPlayerMesh() { return player; },
  getPlayerLegHandle() { return legs; },
  setChannel(name, channel) { writes.set.push({ name, channel }); },
  clearChannel(name) { writes.cleared.push(name); },
}; // Real composer contract used by the two weapon pose owners.
const window = {
  RuntimeFrameScheduler: { register(name, callback, options) {
    assert.equal(options.phase, 'pre-render');
    callbacks.set(name, callback);
  } },
  CharacterActionLocks: { isLocked(id, channel) {
    assert.equal(id, 'player'); assert.equal(channel, 'pose'); return locked;
  } },
  PlayerBodyTransformComposer: composer,
  WeaponToolStances: {
    stanceEngaged() { return true; },
    idleBodyYawSnapshot(out) {
      Object.assign(out, { active: true, yawDeg: 34, reason: 'held-tool-stance' });
      return out;
    },
  },
  SharedAttackPose: { idleBodySinkPct() { return 12; } },
  SCRATCHBONES_CONFIG: { game: { assets: { pngPlaneAvatar: { proceduralFeet: { stanceDrop: { enabled: true } } } } } },
}; // Minimal real external systems. Tool/body stance is nonzero to expose accidental ownership leakage.
const ctx = vm.createContext({ window, console, performance: { now: () => 1000 } });
vm.runInContext(files.weapon, ctx, { filename: 'weapon-stance-drop-runtime.js' });
vm.runInContext(files.yaw, ctx, { filename: 'weapon-idle-body-yaw-runtime.js' });
const runWriters = () => {
  callbacks.get('weapon-stance-drop-sync')();
  callbacks.get('weapon-idle-body-yaw-sync')();
};
runWriters();
assert(writes.knee.length > 0 && writes.yaw.length > 0, 'weapon stance writes normal idle knees and yaw before a kiss');
assert(writes.set.some(entry => entry.name === 'weapon-stance-drop'));
assert(writes.set.some(entry => entry.name === 'weapon-idle-stance-body-yaw'));
const kneeCount = writes.knee.length, yawCount = writes.yaw.length; // Counts before the paired animation locks the pose.
locked = true;
runWriters();
assert.equal(writes.knee.length, kneeCount, 'equipped tool must NOT rewrite a paired animation knee pose');
assert.equal(writes.yaw.length, yawCount, 'equipped tool must NOT rewrite a paired animation leg twist');
assert(writes.cleared.includes('weapon-stance-drop') && writes.cleared.includes('weapon-idle-stance-body-yaw'),
  'both stale stance composer channels are cleared on paired-pose acquisition');
assert.equal(window.WeaponStanceDropRuntime.getDebug().reason, 'paired-pose-owned');
assert.equal(window.WeaponIdleBodyYawRuntime.getDebug().reason, 'paired-pose-owned');
const oldSet = writes.set.length; // Ensure a weapon/tool pose repopulates after the clip releases the lock.
locked = false;
runWriters();
assert(writes.set.length > oldSet && writes.knee.length > kneeCount, 'normal weapon animation resumes on kiss exit');

class Vec {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;}
  sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this;}
}
const partnerWorld = {x: 1, y: 1.2, z: 2}; // Partner's eye/head pivot, independent of camera position and held-tool yaw.
const view = {x: 6, y: 8, z: 2}; // A deliberately unrelated camera used to prove the gaze ignores it.
const neck = {
  parent: {worldToLocal(v){return v;},updateWorldMatrix(){}},
  getWorldPosition(out){return out.copy({x:0,y:1,z:0});},
  rotation: {set(x,y,z,order){Object.assign(this,{x,y,z,order});}},
};
const partnerNeck = {getWorldPosition(out){return out.copy(partnerWorld);}};
const motionWindow = {THREE:{Vector3:Vec},camera:view};
vm.runInNewContext(files.kiss, {window:motionWindow,console});
const kiss = motionWindow.SpouseKissMotion;
assert(kiss.FACE_GAP_FRACTION > 0 && kiss.FACE_GAP_FRACTION < .05,
  'the authored face gap must be small but nonzero relative to the smaller portrait');
assert(kiss.aimPairedHead(neck,partnerNeck,1,{}));
const yawAtCameraA = neck.rotation.y, pitchAtCameraA = neck.rotation.x; // Paired head aim, not player camera aim.
view.x=-20;view.y=-4;view.z=-13;
assert(kiss.aimPairedHead(neck,partnerNeck,1,{}));
assert.equal(neck.rotation.y,yawAtCameraA,'camera orbit cannot move an authored kiss head');
assert.equal(neck.rotation.x,pitchAtCameraA,'camera pitch cannot move an authored kiss head');
assert(Math.abs(yawAtCameraA-Math.atan2(1,2))<1e-8,'head turns toward partner, not toward camera');
assert(files.kiss.includes("composer.addPostHeadAimHook") &&
       files.kiss.includes('releasePlayerRenderPose') &&
       files.kiss.includes('poseLivePlayer(session, pose.drop'),
  'spouse kiss must control the real rendered player root after the camera/weapon update, and release its hook');
assert(files.composer.includes("if(window.CharacterActionLocks?.isLocked?.('player','head'))return"),
  'render-time head clamp must respect player head ownership');
assert(files.festival.includes("channels:['movement','tools','pose','facing','head','camera']"),
  'kiss and festival dance must use the same full-body action lock contract');
console.log('Spouse kiss gameplay pose ownership PASS: tool yaw/sink suppressed, restored on exit; partner head gaze is camera-invariant; late render hook installed.');
