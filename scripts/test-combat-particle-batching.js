#!/usr/bin/env node
'use strict';

// Render-path regression: real animal attack modules against a tiny instancing-capable
// THREE stand-in. Checks draw count, first-frame visibility, cleanup and hit timing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = process.env.HOBUNJI_TEST_ROOT || process.cwd(); // All attack source files come from the active checkout.
const live = { geometryCopies: 0, disposedGeometries: 0 }; // Tracks ownership of cloned instance buffers.

class Scene {
  constructor() { this.children = []; }
  add(object) { object.parent = this; this.children.push(object); }
  remove(object) { this.children = this.children.filter(child => child !== object); object.parent = null; }
}
class Geometry {
  clone() { live.geometryCopies++; return new Geometry(); }
  dispose() { live.disposedGeometries++; }
}
class Material {
  constructor(options) { Object.assign(this, options); }
}
class Transform {
  constructor() {
    const vec = () => ({
      x: 0, y: 0, z: 0,
      set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; },
      setScalar(s) { this.x = s; this.y = s; this.z = s; return this; },
      multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; },
    }); // One small vector-like mock supports both the instanced and fallback paths.
    this.position = vec(); this.rotation = vec(); this.scale = vec();
  }
  updateMatrix() {
    this.matrix = { x: this.position.x, y: this.position.y, z: this.position.z, scale: this.scale.x };
  }
}
class Mesh extends Transform {
  constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; }
}
class InstancedMesh {
  constructor(geometry, material, capacity) {
    this.geometry = geometry; this.material = material; this.capacity = capacity;
    this.count = 0; this.matrices = [];
    this.instanceMatrix = { needsUpdate: false, setUsage() {} };
  }
  setMatrixAt(index, matrix) { this.matrices[index] = { ...matrix }; }
}
const THREE = { TetrahedronGeometry: Geometry, MeshBasicMaterial: Material,
  Object3D: Transform, Mesh, InstancedMesh, DynamicDrawUsage: 35048 }; // Same API paths used by the actual Three.js r128 client.
const windowStub = {
  Combat: { deps: {}, init() {} },
  THREE,
  addEventListener() {},
  __farmLog() {},
}; // Existing combat registry owns the particle batch utility, not a second render loop.
const sandbox = vm.createContext({
  window: windowStub, THREE, console,
  performance: { now: () => 1000 },
  document: { getElementById: () => null },
});
function load(file) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs/js/combat', file), 'utf8'), sandbox, { filename: file });
}

load('combat-animal-attacks.js');
const attackDefs = new Map(); // Capture the real named handlers without replacing the shared registration contract.
const attacks = windowStub.Combat.animalAttacks;
const register = attacks.register;
attacks.register = (id, definition) => { attackDefs.set(id, definition); register(id, definition); };
attacks.beginConeLunge = (_creature, state, _context, _deps, options) => {
  state.lungeAngle = 0; state.lungeMaxDistancePx = options.maxDistancePx;
  state.lungeTraveledPx = 0; state.lungeSpeedPxS = options.speedPxS;
};
attacks.advanceConeLunge = () => 'range';

load('combat-grehlr-stink.js');
load('combat-voorg-ass-rear-kick.js');

const scene = new Scene(); // Counts submitted draws while a burst is active and catches leaked nodes.
const deps = { TILE: 100, player: null, players: [], hostileObjects: [], companionObjects: [],
  inCone: () => false, damagePlayer() {}, damageCreature() {}, setCreatureFrame() {} };
windowStub.Combat.deps = deps;

const original = new Geometry(); // Only burst-owned geometry clones may be disposed.
const unit = attacks.createParticleBatch(THREE, scene, original, [new Material({}), new Material({})], 18);
assert.ok(unit, 'shared batch creates when the GPU supports instancing');
assert.equal(scene.children.length, 2, 'one batch draw per color');
unit.sync([{ x: 1, materialIndex: 0 }, { x: 7, materialIndex: 0 }, { x: 3, materialIndex: 1 }],
  (transform, mote) => { transform.position.set(mote.x, 2, 3); transform.scale.setScalar(0.5); });
assert.equal(scene.children[0].count, 2);
assert.equal(scene.children[1].count, 1);
assert.equal(scene.children[0].matrices[1].x, 7);
unit.sync([], () => {});
assert.equal(scene.children[0].count, 0, 'expired particles retire the active instance count');
unit.dispose(); unit.dispose();
assert.equal(scene.children.length, 0, 'dispose removes both draw nodes exactly once');

const grehlr = {
  x: 0, y: 0, vx: 0, vy: 0, facing: 0, creatureKey: 'grehlr',
  avatarRef: { group: { parent: scene, position: { y: 2 } } }, halfHeight: 0.6,
};
const stink = attackDefs.get('grehlrStink');
const spray = {}; // Live state holds the instanced batch and the original attack timing.
stink.start(grehlr, spray, { target: null }, deps);
stink.update(grehlr, spray, 0.016, deps);
stink.update(grehlr, spray, 0.15, deps);
stink.update(grehlr, spray, 0.08, deps);
assert.ok(spray.particles.length > 0, 'the spray still emits on its authored timeline');
assert.equal(scene.children.length, 1, 'many Grehlr droplets cost one scene draw');
assert.equal(scene.children[0].count, spray.particles.length, 'the first spray frame is visible');
assert.equal(scene.children[0].material.color, windowStub.HobunjiGrehlrStink.STINK_OIL_COLOR, 'stink-oil color is unchanged');
stink.cancel(grehlr, spray);
assert.equal(scene.children.length, 0, 'interruption removes the Grehlr GPU batch');

const kick = attackDefs.get('rearKick');
const voorg = {
  x: 0, y: 0, vx: 0, vy: 0, facing: 0, creatureKey: 'voorg-ass', areaId: 'test',
  def: { attackRangePx: 120 }, avatarRef: { group: { parent: scene, position: { y: 2 } } }, halfHeight: 0.6,
};
const dust = {}; // A missed hoof strike still emits its full eighteen colored dust motes.
kick.start(voorg, dust, { target: { x: 10, y: 0, health: 0 } }, deps);
dust.frame = 'render-ready';
kick.update(voorg, dust, 0.02, deps);
kick.update(voorg, dust, 0.35, deps);
kick.update(voorg, dust, 0.14, deps);
assert.equal(dust.kickParticles.length, 18);
assert.equal(scene.children.length, 2, 'two colors cost two draw calls, not eighteen');
assert.ok(scene.children.every(draw => draw.count === 9), 'both dirt colors have nine particles');
kick.update(voorg, dust, 0.5, deps);
assert.ok(scene.children.every(draw => draw.count === 0), 'expired kick particles stop rendering');
voorg._animalAttack = { id: 'rearKick', state: dust };
kick.cancel(voorg);
assert.equal(scene.children.length, 0, 'cancelled/finished rear kick owns no lingering draws');
assert.equal(live.geometryCopies, live.disposedGeometries, 'every temporary instanced geometry is released');
console.log('combat particle instancing tests passed');
