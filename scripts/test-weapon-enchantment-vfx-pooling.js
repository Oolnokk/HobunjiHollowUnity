'use strict';

// Runs the enchantment particle emitter against a minimal fake THREE and
// checks that expired particles are reused rather than re-allocated: a
// weapon emitting for many particle lifetimes must create at most one
// sprite material per pooled slot, and disposal must release all of them.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'combat', 'weapon-enchantment-vfx.js'), 'utf8');

const counts = { materials: 0, disposed: 0, adds: 0 };
class Obj {
  constructor() { this.children = []; this.parent = null; this.visible = true; this.userData = {}; this.position = vec(); this.scale = vec(); }
  add(child) { counts.adds++; child.parent?.remove(child); child.parent = this; this.children.push(child); return this; }
  remove(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); child.parent = null; return this; }
}
function vec() { return { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }; }
const THREE = {
  AdditiveBlending: 2,
  NormalBlending: 1,
  Group: class extends Obj {},
  Sprite: class extends Obj { constructor(material) { super(); this.material = material; } },
  SpriteMaterial: class {
    constructor(opts) { counts.materials++; Object.assign(this, opts); const hex = opts.color; this.color = { value: hex, set(v) { this.value = v; } }; this.rotation = 0; }
    dispose() { counts.disposed++; }
  },
  CanvasTexture: class { constructor(canvas) { this.image = canvas; } },
};
const noopContext = new Proxy({}, { get: () => () => ({ addColorStop() {} }), set: () => true });
const context = {
  window: {
    Combat: { deps: { getGearInventory: () => ({}), saveGearInventory() {}, currentWeaponKey: () => 'dagger_copper' } },
    EnchantmentSystem: { PLANES: ['Tothal', 'Hronal', 'Kanthic', 'Ohthic'], planarCounts: () => ({ Tothal: 0, Hronal: 0, Kanthic: 0, Ohthic: 1 }) },
    RuntimeFrameScheduler: { register() {} },
  },
  document: { readyState: 'loading', createElement: () => ({ width: 0, height: 0, getContext: () => noopContext }) },
  THREE,
  performance: { now: () => 1000 },
  requestAnimationFrame: () => 0,
  setInterval: () => 1,
  clearInterval: () => {},
  URL, Uint32Array, Map, Set, Object, Math, Number, Promise, console,
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'weapon-enchantment-vfx.js' });

const api = context.window.WeaponEnchantmentVFX;
const { makeEmitter, updateEmitters, clearEmitter, disposeEmitter } = api._test;
const plane = new THREE.Group();
plane.geometry = { parameters: { width: 0.4, height: 1.2 } };
const emitter = makeEmitter(plane);
assert.ok(emitter, 'emitter attaches to the weapon plane');

const visual = api.stateFor('dagger_copper');
const snapshot = { mask: { indices: [0, 1, 2, 3, 4, 5, 6, 7], width: 4, height: 2 }, visual, counts: { Ohthic: 1 } };
for (let frame = 0; frame < 600; frame++) updateEmitters(0.05, snapshot, [emitter]); // 30s of 20fps frames, many particle lifetimes.

const spawned = counts.adds - 1; // First add is the emitter group onto the plane.
assert.ok(spawned > 40, `emitter kept spawning over 30s of frames (spawned ${spawned})`);
assert.ok(counts.materials <= 24, `materials are pooled per slot, not per particle (created ${counts.materials} for ${spawned} spawns)`);
assert.ok(counts.materials < spawned / 2, 'most spawns reuse a retired sprite');
assert.strictEqual(counts.disposed, 0, 'retired particles are parked, not disposed, while the emitter lives');

clearEmitter(emitter);
assert.strictEqual(emitter.particles.length, 0, 'clearing the emitter retires every live particle');
assert.ok(emitter.pool.every(sprite => sprite.visible === false), 'parked sprites are hidden');
disposeEmitter(emitter);
assert.strictEqual(counts.disposed, counts.materials, 'disposing the emitter releases every material it ever created');
assert.strictEqual(emitter.group.parent, null, 'the emitter group leaves the weapon plane');

console.log('weapon enchantment VFX pooling tests passed');
