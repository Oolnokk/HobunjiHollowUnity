#!/usr/bin/env node
'use strict';
// Executes js/game-feel.js and js/ruin-objective-tracker.js in a VM:
//  * hit-stop time-scales gameLoop dt and then releases it,
//  * shake offsets the camera only between pre-render and post-game,
//  * a ruin solve opens the reveal window for the next mechanism, once,
//  * the tracker turns ruin read-models into checklist rows.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
// Minimal THREE stand-ins (the fast suite has no three.js install).
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  clone() { return new Vector3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  applyQuaternion() { return this; } // Identity camera orientation in this test.
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  project() { return this.set(0, 0, this.z > 6 ? 2 : 0.5); } // Anything behind the test camera (z > 6) is off-screen.
}
class Box3 {
  constructor() { this.min = new Vector3(); this.max = new Vector3(); this.empty = true; }
  setFromObject(o) { const b = o.bounds; this.min.copy(b.min); this.max.copy(b.max); this.empty = false; return this; }
  isEmpty() { return this.empty; }
  getCenter(t) { return t.set((this.min.x + this.max.x) / 2, (this.min.y + this.max.y) / 2, (this.min.z + this.max.z) / 2); }
  getSize(t) { return t.set(this.max.x - this.min.x, this.max.y - this.min.y, this.max.z - this.min.z); }
}
const THREE = { Vector3, Box3 };
const makeObject = (min, max) => ({ isObject3D: true, bounds: { min: new Vector3(...min), max: new Vector3(...max) }, updateWorldMatrix() {} });

let now = 1000;
const scheduler = new Map();
const store = new Map();
const activations = [];
const ctx = {
  THREE, console, Math, Number, String, Object, Array, Map, Set, JSON,
  performance: { now: () => now },
  setTimeout: () => 0, clearTimeout: () => {},
  localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) },
  RuntimeFrameScheduler: { register: (id, fn, opts) => scheduler.set(id, { fn, opts }) },
  CombatAttackEvents: { on: (kind, fn) => { ctx.__hit = fn; } },
  WorldEvents: { on: () => () => {} },
  CinematicCameraRuntime: {
    isActive: () => false,
    activate: (area, shot, opts) => { activations.push({ area, shot, opts }); return { reason: opts.reason }; },
    activeRecord: () => null, deactivate: () => {},
  },
  CharacterActionLocks: { acquire: () => 'tok', release: () => true },
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(read('docs/js/game-feel.js'), ctx);
const GF = ctx.GameFeel;
assert(GF, 'GameFeel loads');

const camera = { position: new Vector3(0, 3, 6), rotation: { z: 0 }, quaternion: {}, updateMatrixWorld() {} };
const player = { x: 0, y: 0, maxHealth: 100 };
GF.init({ getCamera: () => camera, getPlayer: () => player, TILE: 1, getCurrentArea: () => 'map_i_dev_random_ruin', getPlayerWorldY: () => 0, isPlayerInCombat: () => false });
assert(scheduler.get('game-feel:shake-apply')?.opts.phase === 'pre-render');
assert(scheduler.get('game-feel:shake-restore')?.opts.phase === 'post-game');

// Hit-stop: a melee hit scales dt down, then it returns to normal.
ctx.__hit({ actualDamage: 10, abilityId: 'combo' });
assert(GF.frameDt(0.016) < 0.005, 'hit-stop slows the simulation');
now += 200;
assert.equal(GF.frameDt(0.016), 0.016, 'hit-stop releases');

// Shake is applied and fully removed again.
GF.addTrauma(0.8);
const before = camera.position.clone();
const rollBefore = camera.rotation.z;
GF.frameDt(0.016);
scheduler.get('game-feel:shake-apply').fn();
assert(camera.position.distanceTo(before) > 1e-4, 'shake moves the camera during render');
scheduler.get('game-feel:shake-restore').fn();
assert(camera.position.distanceTo(before) < 1e-9 && camera.rotation.z === rollBefore, 'shake is removed after render');

// Disabling shake in settings stops it.
GF.setShakeEnabled(false);
GF.addTrauma(1);
scheduler.get('game-feel:shake-apply').fn();
assert(camera.position.distanceTo(before) < 1e-9, 'shake respects the setting');
GF.setShakeEnabled(true);

// Solve -> the next mechanism (off-screen, same floor) earns exactly one reveal shot.
const door = makeObject([-1, 0, 17.75], [1, 3, 18.25]); // Behind the camera, same floor.
GF.puzzleSolved();
GF.mechanismMoved(door);
assert.equal(activations.length, 1, 'reveal shot activates for the solved mechanism');
assert.equal(activations[0].opts.reason, 'ruin-reveal');
assert(GF.isRevealing());
GF.endReveal();
GF.mechanismMoved(door);
assert.equal(activations.length, 1, 'only the first mechanism after a solve is revealed');
now += 5000;
GF.puzzleSolved();
now += 2500; // Outside the reveal window.
GF.mechanismMoved(door);
assert.equal(activations.length, 1, 'a late mechanism is not attributed to the solve');

// Tracker rows.
const trackerCtx = { console, performance: { now: () => now }, localStorage: ctx.localStorage, addEventListener: () => {} };
trackerCtx.window = trackerCtx;
vm.createContext(trackerCtx);
vm.runInContext(read('docs/js/ruin-objective-tracker.js'), trackerCtx);
const rows = trackerCtx.RuinObjectiveTracker.buildRows({
  shaft: { braziers: 12, lit: 3, challengesSolved: 4, challengesTotal: 9 },
  sanctum: { braziers: [{ lit: true }, { lit: false }], door: { state: 'sealed' } },
});
assert.equal(rows.map(r => r.key).join(','), 'wing,trials,seals,door');
assert.equal(rows[0].have, 3); assert.equal(rows[0].need, 12);
assert.equal(rows[2].have, 1);
assert.equal(rows[3].text, 'sealed');
assert.equal(trackerCtx.RuinObjectiveTracker.buildRows({}).length, 0, 'no ruin data, no rows');

console.log('game feel + ruin tracker: ok');
