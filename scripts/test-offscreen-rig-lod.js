#!/usr/bin/env node
'use strict';
// Behind-camera actors stop their procedural rig work after a short delay and resume the instant they are in view again.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let THREE; try { THREE = require(process.env.THREE_CJS || 'three'); } catch { console.log('offscreen-rig-lod: skipped (no three package; set THREE_CJS)'); process.exit(0); }
const win = { THREE };
vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/js/offscreen-rig-lod.js'), 'utf8'), vm.createContext({ window: win }));
const lod = win.OffscreenRigLod;
const cam = new THREE.PerspectiveCamera(42, 1.6, 0.1, 200);
cam.position.set(0, 5, 0); cam.lookAt(0, 0, -10); cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
const actor = () => ({});
lod.beginFrame(cam);
const front = actor(), back = actor(), near = actor();
assert.equal(lod.shouldAnimate(front, 0, 0, -10, 0.016, 10), true, 'in view animates');
assert.equal(lod.shouldAnimate(back, 0, 0, 20, 0.1, 20), true, 'brief off-screen time keeps animating (camera swings)');
assert.equal(lod.shouldAnimate(back, 0, 0, 20, 0.2, 20), false, 'sustained off-screen time pauses');
assert.equal(lod.shouldAnimate(near, 0, 0, 2, 1, 2), true, 'close actors never pause');
cam.lookAt(0, 0, 20); cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert(); lod.beginFrame(cam);
assert.equal(lod.shouldAnimate(back, 0, 0, 20, 0.016, 20), true, 'resumes the same frame it re-enters view');
assert.equal(lod.getStats().skipped, 0);

const scene = new THREE.Scene(); // Match the scene-owned humanoid rigs in the hostile loop.
const rig = new THREE.Group(); // Reused for the cadence tests.
scene.add(rig);
const hunter = { isBandit: true, state: 'return', x: 0, y: -20, avatarRef: { group: rig } }; // Behind the current camera.
const step = () => lod.hostileAiDt(hunter, 20, 1, 1 / 60); // Fixed 60 Hz simulation input.
for (let frame = 0; frame < 11; frame++) assert.equal(step(), -1);
assert(Math.abs(step() - 0.2) < 1e-9, 'first coarse tick consumes twelve 60 Hz steps');
assert.equal(step(), -1);
assert.equal(lod.hostileAiDt(hunter, 6, 1, 1 / 60), 1 / 60, 'nearby actors use only the current frame delta');
assert.equal(step(), -1);
for (const [field, value] of Object.entries({
  state: 'chase', _chunkCombatTarget: {}, telegraphState: 'windup',
  hitFlashT: 0.1, _enemyDodge: {}, _cliffRouteTravel: {}, knockbackT: 0.1,
})) {
  assert.equal(lod.hostileAiDt({ ...hunter, [field]: value }, 20, 1, 1 / 60), 1 / 60, field + ' stays full rate');
}
win.EnemySearchAI = { enemyAttackBusy: c => !!c._banditAction }; // Stand-in for the shared attack-busy predicate.
assert.equal(lod.hostileAiDt({ ...hunter, _banditAction: {} }, 20, 1, 1 / 60), 1 / 60);
assert.equal(lod.wakeHostileAi(hunter, 20, 1), false, 'off-screen actors remain deferred');
cam.lookAt(0, 0, -20);
lod.refreshFrustum(cam);
assert.equal(lod.wakeHostileAi(hunter, 20, 1), true, 'the final camera pose wakes the actor before rendering');
assert.equal(hunter._offscreenHostileAiS, 0);
assert.equal(lod.aiSnapshot().cameraWakes, 1);
lod.setCoarseAiEnabled(false);
cam.lookAt(0, 0, 20);
lod.refreshFrustum(cam);
assert.equal(step(), 1 / 60, 'the A/B switch restores the full cadence off camera');
lod.setEnabled(false); lod.beginFrame(cam);
assert.equal(lod.shouldAnimate(actor(), 0, 0, -50, 5, 50), true, 'disabled means always animate');
console.log('offscreen-rig-lod: ok');
