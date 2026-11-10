'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

// Minimal Three scene test: no WebGL is needed to verify actual rope/burden
// handoff, one-shot persistence, or wall-span geometry.
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
const context = { console, Promise, THREE };
context.window = context;
context.__farmLog = () => {};
context.Shattercasks = {
  createHangingShattercask: async options => {
    calls.created++;
    return { id: options.id, group: new Mesh(), exploded: false, carried: false };
  },
  discardBurden: burden => { burden.exploded = true; calls.discarded++; },
};
context.HangingRopes = {
  registerRope: options => ({ ...options, burden: null, armed: false }),
  attach(rope, burden) { rope.burden = burden; return true; },
  applyStrike(rope) { rope.armed = true; calls.struck++; },
  removeRope(rope) { rope.burden = null; },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/js/cave-tripwire-traps.js'), 'utf8'),
  context, { filename: 'cave-tripwire-traps.js' });
const Traps = context.CaveTripwireTraps;
assert(Traps, 'physical trap module installed');

const footprint = new Set();
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

const trap = { id: 'hidden_cache_1_trap_1', col: 2, row: 2, span };
const map = { caveTraps: [trap] };
const state = { triggeredTraps: [] };
const toPlayer = position => ({ x: position.x * 32, y: position.z * 32 });
const save = () => { calls.persisted++; };
Traps.build('caveA', map, scene, state);
Traps.tick('caveA', state, toPlayer(approach), 32, .12, save);
assert.equal(calls.created, 1, 'one real Shattercask factory call');

// One completed asynchronous furniture load and rope attachment.
(async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  const armed = Traps.debugSnapshot('caveA').wires[0];
  assert(armed.cask && armed.drawn, 'the rope and hanging bomb were registered');
  Traps.tick('caveA', state, toPlayer(beyond), 32, .12, save);
  assert.equal(calls.struck, 1, 'one crossing applies one genuine HangingRopes strike');
  assert.equal(calls.persisted, 1, 'trap is saved once when released');
  assert.equal(state.triggeredTraps.length, 1, 'existing cave save identifies the spent trap');
  Traps.tick('caveA', state, toPlayer(approach), 32, .12, save);
  assert.equal(calls.struck, 1, 'revisiting the same rope segment cannot arm twice');
  assert(!Traps.debugSnapshot('caveA').wires[0].drawn, 'the string disappears after a swing');

  const untouched = { triggeredTraps: [] };
  Traps.build('caveA', map, scene, untouched);
  Traps.tick('caveA', untouched, toPlayer(approach), 32, .12, save);
  for (let i = 0; i < 4; i++) await Promise.resolve();
  const record = context.HangingRopes;
  // A manual strike arms the hanging rope: the trip string must then become
  // harmless rather than double-activating the pendulum.
  const ropes = [];
  const oldApply = record.applyStrike;
  record.applyStrike = rope => { ropes.push(rope); oldApply(rope); };
  Traps.tick('caveA', untouched, toPlayer(beyond), 32, .12, save);
  assert.equal(ropes.length, 1);
  Traps.dispose('caveA');
  assert.equal(Traps.debugSnapshot('caveA').wires.length, 0, 'reset removes all trap registrations');
  console.log('PASS cave-tripwire-traps: walls, fast crossing, shared pendulum, one-shot save, cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });
