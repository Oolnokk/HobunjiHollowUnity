'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

// Integration test uses the ACTUAL RopeCore and HangingRopes pendulum runtime.
// Only the authored furniture/visuals and the Shattercasks impact receiver
// are mocked; no substitute swing or projectile physics.
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  sub(v) { return this.set(this.x-v.x, this.y-v.y, this.z-v.z); }
  add(v) { return this.set(this.x+v.x, this.y+v.y, this.z+v.z); }
  multiplyScalar(n) { return this.set(this.x*n, this.y*n, this.z*n); }
  length() { return Math.hypot(this.x, this.y, this.z); }
  normalize() { return this.multiplyScalar(1 / this.length()); }
  copy(v) { return this.set(v.x, v.y, v.z); }
}
class Mesh {
  constructor() {
    this.position = new V3();
    this.scale = { set() {}, setScalar() {} };
    this.quaternion = { setFromUnitVectors() {}, identity() {} };
    this.userData = {};
    this.parent = null;
    this.isObject3D = true;
  }
}
const scene = {
  add(mesh) { mesh.parent = this; },
  remove(mesh) { mesh.parent = null; },
};
const THREE = { Vector3: V3, Mesh, CylinderGeometry: class {},
  MeshLambertMaterial: class {}, MeshBasicMaterial: class {} };
const mapId = 'map_i_physical_trap_test';
const impactFlights = []; // Captures the real HangingRopes.releaseBurdenWithVelocity call for assertions.
let actualBurden = null; // Last registered physical Burden, whose position the genuine pendulum updates.
const context = { THREE, console, Promise, performance };
context.window = context;
context.GridTileAccessors = { getCurrentArea: () => mapId, getActiveScene: () => scene };
context.Combat = { deps: { TILE: 32, getCurrentArea: () => mapId,
  getActiveScene: () => scene } };
context.__farmLog = () => {};
context.Shattercasks = {
  createHangingShattercask: async options => {
    actualBurden = { id: options.id, mapId, group: new Mesh(), exploded: false,
      carried: false, flying: false };
    scene.add(actualBurden.group);
    actualBurden.group.position.set(options.x, options.y, options.z);
    return actualBurden;
  },
  releaseBurdenWithVelocity(burden, velocity, cause) {
    impactFlights.push({ burden, velocity, cause, x: burden.group.position.x,
      y: burden.group.position.y, z: burden.group.position.z });
    burden.flying = true;
    return true;
  },
  discardBurden(burden) { burden.exploded = true; burden.group.parent?.remove(burden.group); },
  refreshBurdenBounds() {},
};
vm.createContext(context);
const runScript = name => vm.runInContext(
  fs.readFileSync(path.join(__dirname, '../docs/js', name), 'utf8'),
  context, { filename: name });
runScript('rope-core.js');
runScript('hanging-ropes.js');
runScript('cave-tripwire-traps.js');
assert(context.RopeCore && context.HangingRopes && context.CaveTripwireTraps,
  'real pendulum and trap module loaded');

const trap = { id: 'pendulum_collision', col: 2, row: 2,
  span: { axis: 'x', x1: 0, x2: 5, z1: 2.5, z2: 2.5, length: 5 } };
const cave = { caveTraps: [trap], floorSurfaceByTile: { '2,2': .2 },
  mesh: { vaultCeiling: { startY: 3.8 } } };
const state = { triggeredTraps: [] };
const enter = { x: 2.5*32, y: 1*32 };
const crossed = { x: 2.5*32, y: 4*32 };
const T = context.CaveTripwireTraps;
const save = () => {};

(async () => {
  T.build(mapId, cave, scene, state);
  T.tick(mapId, state, enter, 32, .12, save);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert(actualBurden, 'real swinging burden is present');
  const rope = context.HangingRopes.ropes.find(r => r.id === trap.id + '_rope');
  assert(rope?.burden === actualBurden, 'real HangingRopes registry owns the burden');
  assert(Math.abs(rope.anchor.y - 4) < 1e-6, 'actual sampled floor and cave-vault heights determine anchor');
  T.tick(mapId, state, crossed, 32, .12, save);
  assert.deepEqual(state.triggeredTraps, [trap.id], 'true crossing persisted');
  assert(rope.armed, 'the full pendulum integrator is now active');

  for (let frame = 0; frame < 200 && impactFlights.length === 0; frame++)
    context.HangingRopes.tick(1 / 60);
  assert.equal(impactFlights.length, 1, 'real pendulum releases the Shattercask exactly once');
  assert(/^rope-(launch|drop)$/.test(impactFlights[0].cause),
    'Shattercask receives its own real launch/drop impact, not synthetic damage');
  const velocity = impactFlights[0].velocity;
  assert(Number.isFinite(velocity.x) && Number.isFinite(velocity.y)
    && Number.isFinite(velocity.z), 'shared rope supplies a valid ballistic release velocity');
  assert(impactFlights[0].burden === actualBurden, 'the original physical Burden reaches impact owner');
  console.log('PASS cave-tripwire-pendulum-physics: real RopeCore and HangingRopes launch actual Shattercask');
})().catch(error => { console.error(error); process.exitCode = 1; });
