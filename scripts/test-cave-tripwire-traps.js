'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

// Minimal Three scene harness: exercises physical Shattercask/HangingRopes
// integration and the cave save lifecycle without requiring WebGL.
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  multiplyScalar(n) { this.x *= n; this.y *= n; this.z *= n; return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  normalize() { return this.multiplyScalar(1 / this.length()); }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
}
class Mesh {
  constructor() {
    this.position = new Vector3();
    this.quaternion = { setFromUnitVectors() {} };
    this.scale = { set() {} };
    this.userData = {};
    this.parent = null;
  }
}
const THREE = { Vector3, Mesh, CylinderGeometry: class {}, MeshLambertMaterial: class {} };
const scene = {
  add(mesh) { mesh.parent = this; },
  remove(mesh) { mesh.parent = null; },
};
const calls = { created: 0, struck: 0, discarded: 0, persisted: 0 };
const activeRopes = new Map(); // Exposes actual mock rope state so manual disarm can be verified.
let nextBurden = null; // Delays one authored Shattercask load to reproduce the real network/asset race.
const context = { console, Promise, THREE };
context.window = context;
context.__farmLog = () => {};
context.Shattercasks = {
  createHangingShattercask: async options => {
    calls.created++;
    if (nextBurden) {
      const pending = nextBurden; // Author-controlled deferred completion for the async-crossing regression.
      nextBurden = null;
      return pending;
    }
    return { id: options.id, group: new Mesh(), exploded: false, carried: false };
  },
  discardBurden: burden => { burden.exploded = true; calls.discarded++; },
};
context.HangingRopes = {
  registerRope(options) {
    const rope = { ...options, burden: null, armed: false };
    activeRopes.set(options.id, rope);
    return rope;
  },
  attach(rope, burden) { rope.burden = burden; return true; },
  applyStrike(rope, dx, dz, speed) {
    rope.armed = true;
    rope.lastDirection = { dx, dz, speed };
    calls.struck++;
  },
  removeRope(rope) { activeRopes.delete(rope.id); rope.burden = null; },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/js/cave-tripwire-traps.js'), 'utf8'),
  context, { filename: 'cave-tripwire-traps.js' });
const Traps = context.CaveTripwireTraps;
assert(Traps, 'physical trap module installed');

const footprint = new Set(); // Wide room fixture has real solid walls at its endpoints.
for (let row = 0; row < 5; row++) for (let col = 0; col < 5; col++)
  footprint.add(col + ',' + row);
const span = Traps.spanFor({ col: 2, row: 2 }, footprint);
assert(span, 'floor tile found two real cavern walls');
assert.equal(span.length, 5, 'the string terminates at the two wall/floor boundaries');
const px = (span.x1 + span.x2) / 2, pz = (span.z1 + span.z2) / 2;
const approach = { x: px, z: pz - 3 };
const beyond = { x: px, z: pz + 3 };
assert(Traps.crossed(span, approach, beyond), 'a long movement step still intersects the string');
assert(!Traps.crossed(span, approach, approach), 'no invisible approach-radius hit');
assert(!Traps.crossed(span, { x: 50, z: pz - 3 }, { x: 50, z: pz + 3 }),
  'passing outside both wall endpoints is safe');

// Rock-wall eligibility: anchors must survive a broken mineable separator.
const mineable = new Set(['2,-1']);
assert(!Traps.spanFor({ col: 2, row: 2 }, footprint, new Set(['2,-1', '-1,2'])),
  'strings cannot anchor to breakable walls at both ends');
assert(Traps.spanFor({ col: 2, row: 2 }, footprint, mineable)?.axis === 'x',
  'string can choose the perpendicular direction when one axis ends at mineable rock');
const narrow = new Set(['2,2']);
assert.equal(Traps.spanFor({ col: 2, row: 2 }, narrow)?.length, 1,
  'one-tile corridors are not incorrectly excluded');

// A triangle pair at y=4.2 forms an actual overhead rocky ceiling.
const caveMesh = {
  positions: [0,4.2,0, 5,4.2,0, 0,4.2,5, 5,4.2,0, 5,4.2,5, 0,4.2,5],
  indices: [0,1,2, 3,4,5],
};
assert(Math.abs(Traps.ceilingAt(caveMesh, 2.5, 2.5, .2) - 4.2) < 1e-6,
  'ceiling attachment samples the actual cavern roof surface');

const trap = { id: 'hidden_cache_1_trap_1', col: 2, row: 2, span };
const map = { caveTraps: [trap], floorSurfaceByTile: { '2,2': .2 }, floorSurfaceY: 0,
  mesh: caveMesh };
const playerAt = (position, elevation = 0) => ({
  x: position.x * 32, y: position.z * 32, heightAboveGround: elevation,
});
const save = () => { calls.persisted++; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

async function run() {
  // Normal crossing: one physical Burden strike, then permanent disarm.
  const state = { triggeredTraps: [] };
  Traps.build('caveA', map, scene, state);
  Traps.tick('caveA', state, playerAt(approach), 32, .12, save);
  assert.equal(calls.created, 1, 'one real Shattercask factory call');
  await flush();
  const armed = Traps.debugSnapshot('caveA').wires[0];
  assert(armed.cask && armed.drawn, 'the rope and hanging bomb were registered');
  assert(Math.abs(armed.anchorY - 4.2) < 1e-6 && Math.abs(armed.floorY - .2) < 1e-6,
    'cave floor and actual roof are both used for physical geometry');
  assert(Math.abs(armed.anchorY - activeRopes.get(trap.id + '_rope').length - .85) < 1e-6,
    'hanging burden sits 0.65 above the sampled cave floor, not an arbitrary y');
  Traps.tick('caveA', state, playerAt(beyond), 32, .12, save);
  assert.equal(calls.struck, 1, 'one crossing applies one genuine HangingRopes strike');
  assert.equal(calls.persisted, 1, 'trap is saved exactly once when released');
  assert.deepEqual(Array.from(state.triggeredTraps), [trap.id], 'existing cave save identifies the spent trap');
  Traps.tick('caveA', state, playerAt(approach), 32, .12, save);
  assert.equal(calls.struck, 1, 'walking backwards after triggering cannot re-arm a trap');
  assert(!Traps.debugSnapshot('caveA').wires[0].drawn, 'the visible string disappears after a swing');

  // Delayed asset load: walking across BEFORE attachment must still trip the
  // actual pendulum immediately after the new cask becomes ready.
  const lateState = { triggeredTraps: [] };
  let finishLoad; // Deferred Burden factory used only by this load-race test.
  nextBurden = new Promise(resolve => { finishLoad = resolve; });
  Traps.build('lateCave', map, scene, lateState);
  Traps.tick('lateCave', lateState, playerAt(approach), 32, .12, save);
  Traps.tick('lateCave', lateState, playerAt(beyond), 32, .12, save);
  assert(Traps.debugSnapshot('lateCave').wires[0].queued,
    'a fast crossing during pending furniture load is queued');
  assert.equal(lateState.triggeredTraps.length, 0, 'save is not spent before a physical payload exists');
  finishLoad({ id: 'lateBurden', group: new Mesh(), exploded: false, carried: false });
  await flush();
  const previousStrikes = calls.struck; // Verifies one extra strike rather than relying on prior scenario counts.
  Traps.tick('lateCave', lateState, playerAt(beyond), 32, .12, save);
  assert.equal(calls.struck, previousStrikes + 1, 'queued crossing launches the actual cask');
  assert.deepEqual(Array.from(lateState.triggeredTraps), [trap.id], 'late release persists once');

  // Real feet clearance allows jumping over a rope without touching it.
  const jumpState = { triggeredTraps: [] };
  Traps.build('jumpCave', map, scene, jumpState);
  Traps.tick('jumpCave', jumpState, playerAt(approach), 32, .12, save);
  await flush();
  const jumpStrikes = calls.struck;
  Traps.tick('jumpCave', jumpState, playerAt(beyond, .8), 32, .12, save);
  assert.equal(calls.struck, jumpStrikes, 'airborne feet over the string do not trip it');
  assert.equal(jumpState.triggeredTraps.length, 0, 'a cleared string stays armed for later ground contact');
  Traps.tick('jumpCave', jumpState, playerAt(approach), 32, .12, save);
  assert.equal(calls.struck, jumpStrikes + 1, 'a later grounded traversal still triggers the visible string');

  // Manual hit or pickup disarms rather than double-launching a cask.
  const manualState = { triggeredTraps: [] };
  Traps.build('manualCave', map, scene, manualState);
  Traps.tick('manualCave', manualState, playerAt(approach), 32, .12, save);
  await flush();
  const rope = activeRopes.get(trap.id + '_rope');
  rope.armed = true; // Simulated real hanging burden struck by player attack.
  const manuallyStruck = calls.struck;
  Traps.tick('manualCave', manualState, playerAt(beyond), 32, .12, save);
  assert.equal(calls.struck, manuallyStruck, 'player attack does not cause a second trap swing');
  assert.deepEqual(Array.from(manualState.triggeredTraps), [trap.id], 'manual detachment disarms persistently');

  // Re-entering the same cave must not invent a crossing from the old exit.
  const reentryState = { triggeredTraps: [] };
  Traps.build('reentryCave', map, scene, reentryState);
  Traps.tick('reentryCave', reentryState, playerAt(beyond), 32, .12, save);
  await flush();
  Traps.suspend(); // Wilderness visit between two entries to the same cave.
  const beforeReentry = calls.struck;
  Traps.tick('reentryCave', reentryState, playerAt(approach), 32, .12, save);
  assert.equal(calls.struck, beforeReentry, 'no fake tripwire crossing on same-map re-entry');
  Traps.tick('reentryCave', reentryState, playerAt(beyond), 32, .12, save);
  assert.equal(calls.struck, beforeReentry + 1, 'genuine movement after re-entry still triggers');

  Traps.dispose('reentryCave');
  assert.equal(Traps.debugSnapshot('reentryCave').wires.length, 0,
    'retiring a cave removes trap registrations and associated hanging Burdens');
  console.log('PASS cave-tripwire-traps: rock anchors, real roof, high-speed crossing, async load, jumps, manual disarm, re-entry, persistence');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
