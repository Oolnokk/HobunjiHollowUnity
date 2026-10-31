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
const heldOrderSource = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'held-object-render-order.js'), 'utf8'); // Used to guard the overlay renderer against reintroducing weapon-bound clipping.
assert(heldOrderSource.includes('mesh.userData?.hobunjiHeldOverlayVfxPadding') && heldOrderSource.includes('scissorBox.expandByScalar(vfxPadding'), 'held replay scissor must account for live enchantment particles beyond the metal geometry.');
const cullFunction = heldOrderSource.match(/  function isReplayCullable\(object\) \{[\s\S]*?\n  \}/)?.[0]; // Test the renderer's actual per-object cull decision without copying its implementation.
assert(cullFunction, 'replay cull decision remains available for the particle regression');
const isReplayCullable = vm.runInNewContext('(' + cullFunction.trim() + ')'); // Production function is pure; use real source for both positive/negative cases.
assert.strictEqual(isReplayCullable({ isSprite: true, userData: { hobunjiHeldOverlayParticle: true }, children: [], frustumCulled: true }), false, 'moving held enchantment motes bypass the second replay frustum cull');
assert.strictEqual(isReplayCullable({ isSprite: true, userData: {}, children: [], frustumCulled: true }), true, 'ordinary sprites continue using the performance cull');

const counts = { materials: 0, disposed: 0, adds: 0 };
class Obj {
  constructor() { this.children = []; this.parent = null; this.visible = true; this.userData = {}; this.position = vec(); this.scale = vec(); this.layers = { mask: 1, set(channel) { this.mask = (1 << channel) >>> 0; } }; }
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
  Vector3: class { // Just the column-major matrix helpers faceEmittersTowardCamera uses.
    constructor() { this.x = 0; this.y = 0; this.z = 0; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    setFromMatrixPosition(m) { const e = m.elements; return this.set(e[12], e[13], e[14]); }
    transformDirection(m) { const e = m.elements, { x, y, z } = this; this.set(e[0] * x + e[4] * y + e[8] * z, e[1] * x + e[5] * y + e[9] * z, e[2] * x + e[6] * y + e[10] * z); const l = Math.hypot(this.x, this.y, this.z) || 1; return this.set(this.x / l, this.y / l, this.z / l); }
    subVectors(a, b) { return this.set(a.x - b.x, a.y - b.y, a.z - b.z); }
    dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  },
};
const translation = (x, y, z) => ({ elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1] });
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
for (let frame = 0; frame < 600; frame++) {
  updateEmitters(0.05, snapshot, [emitter]);
  assert(emitter.particles.every(p => p.sprite.material.opacity >= 0.6 && p.sprite.material.opacity <= 1), 'live particles keep at least 60% opacity throughout their lifetime and reuse');
} // 30s of 20fps frames, many particle lifetimes.

const spawned = counts.adds - 1; // First add is the emitter group onto the plane.
assert.ok(spawned > 40, `emitter kept spawning over 30s of frames (spawned ${spawned})`);
assert.ok(counts.materials <= 24, `materials are pooled per slot, not per particle (created ${counts.materials} for ${spawned} spawns)`);
assert.ok(counts.materials < spawned / 2, 'most spawns reuse a retired sprite');
assert.strictEqual(counts.disposed, 0, 'retired particles are parked, not disposed, while the emitter lives');

assert.ok(plane.userData.hobunjiHeldOverlayVfxPadding > 0, 'a live billboard must extend the held overlay scissor envelope even when born inside metal bounds');
clearEmitter(emitter);
assert.strictEqual(plane.userData.hobunjiHeldOverlayVfxPadding, 0, 'clearing particles resets the additional replay coverage');
assert.strictEqual(emitter.particles.length, 0, 'clearing the emitter retires every live particle');
assert.ok(emitter.pool.every(sprite => sprite.visible === false), 'parked sprites are hidden');
disposeEmitter(emitter);
assert.strictEqual(counts.disposed, counts.materials, 'disposing the emitter releases every material it ever created');
assert.strictEqual(emitter.group.parent, null, 'the emitter group leaves the weapon plane');
assert.strictEqual(plane.userData.hobunjiHeldOverlayVfxPadding, undefined, 'disposing an aura leaves no stale replay padding');

// The sampled metal determines the origin only: a crosswind streak can leave
// the blade in local XY and expand its billboard independently of that mask.
const edgePlane = new THREE.Group(); // Used to test a thin blade that cannot contain the entire animated effect.
edgePlane.geometry = { parameters: { width: 0.2, height: 0.6 } };
const edgeEmitter = makeEmitter(edgePlane); // Used to verify free motion and growing replay coverage on the same live sprite.
const edgeSnapshot = { ...snapshot, mask: { indices: [0], width: 2, height: 2 } }; // Forces the metal origin to the upper-left source pixel.
updateEmitters(0.15, edgeSnapshot, [edgeEmitter]);
const freeParticle = edgeEmitter.particles[0]; // Used to drive a deterministic crosswind across the blade's left edge.
assert.ok(freeParticle, 'the metal source pixel still emits a particle');
assert.strictEqual(freeParticle.baseX, -0.05, 'the particle starts on the selected source-metal pixel');
freeParticle.motion = 'crosswind'; freeParticle.speed = 0.45; freeParticle.vx = -0.45; freeParticle.life = 2;
updateEmitters(0.45, edgeSnapshot, [edgeEmitter]);
assert.ok(freeParticle.sprite.position.x < -0.1, 'a particle may move outside the blade instead of being constrained to metal pixels');
assert.ok(freeParticle.sprite.scale.x > freeParticle.baseSize, 'growth is not limited to the originating metal pixel');
assert.ok(edgePlane.userData.hobunjiHeldOverlayVfxPadding > 0.1, 'screen-space replay coverage tracks the complete out-of-blade streak');
disposeEmitter(edgeEmitter);

// HeldObjectRenderOrder redraws held planes in its own overlay pass (layer 29);
// particles on such a plane must render in that pass, or the blade covers them.
context.window.HeldObjectRenderOrder = { HELD_OVERLAY_LAYER: 29 };
const heldPlane = new THREE.Group();
heldPlane.geometry = { parameters: { width: 0.4, height: 1.2 } };
heldPlane.layers.mask = (1 | (1 << 29)) >>> 0;
const heldEmitter = makeEmitter(heldPlane, true); // Gameplay marks only the player's actively held weapon as immune to replay sprite-culling.
updateEmitters(0.5, snapshot, [heldEmitter]);
assert.ok(heldEmitter.particles.length > 0, 'held-plane emitter spawns');
const heldMask = (1 | (1 << 29)) >>> 0; // Kept on base for maps with no selective ground replay, and on overlay when the held plane is replayed.
assert.ok(heldEmitter.particles.every(p => p.sprite.layers.mask === heldMask), 'particles share the held overlay without disappearing when replay is skipped');
assert.ok(heldEmitter.particles.every(p => p.sprite.userData.hobunjiHeldOverlayParticle === true), 'only overlay-bound enchantment motes are exempt from the replay object cull');
heldPlane.layers.mask = 1; // A scene transition temporarily returns the held weapon to the ordinary world pass.
updateEmitters(0.016, snapshot, [heldEmitter]);
assert.ok(heldEmitter.particles.every(p => p.sprite.layers.mask === 1), 'existing live particles revert to the ordinary world layer when overlay is unavailable');
assert.ok(heldEmitter.particles.every(p => p.sprite.userData.hobunjiHeldOverlayParticle === false), 'particles outside the replay have normal culling behavior');
heldPlane.layers.mask = heldMask; // The replay renderer can register/repair the weapon after particles already exist.
updateEmitters(0.016, snapshot, [heldEmitter]);
assert.ok(heldEmitter.particles.every(p => p.sprite.layers.mask === heldMask), 'existing particles rejoin the held overlay after a late layer repair');
const enemyOverlayPlane = Object.assign(new THREE.Group(), { geometry: { parameters: { width: 0.4, height: 1.2 } } }); // NPCs may be drawn in the held overlay, but must retain the performance cull.
enemyOverlayPlane.layers.mask = heldMask;
const enemyEmitter = makeEmitter(enemyOverlayPlane); // createFixedEmitter uses the default non-player mode.
updateEmitters(0.5, snapshot, [enemyEmitter]);
assert.ok(enemyEmitter.particles.length > 0 && enemyEmitter.particles.every(p => p.sprite.userData.hobunjiHeldOverlayParticle === false), 'NPC enchantment motes remain eligible for replay culling');
const plainEmitter = makeEmitter(Object.assign(new THREE.Group(), { geometry: { parameters: { width: 0.4, height: 1.2 } } }));
updateEmitters(0.5, snapshot, [plainEmitter]);
assert.ok(plainEmitter.particles.every(p => p.sprite.layers.mask === 1), 'particles on an ordinary plane stay on the default layer');

// The camera may see either face of the blade; particles must sit on the visible one.
const facing = makeEmitter(new THREE.Group());
facing.plane.matrixWorld = translation(0, 0, 0); // Blade +Z face points toward +Z.
context.window.Combat.deps.camera = { matrixWorld: translation(0, 1, 5) };
api._test.faceEmittersTowardCamera([facing]);
assert.strictEqual(facing.group.scale.z, 1, 'front view keeps particles on the +Z face');
assert.ok(facing.group.position.z > 0);
context.window.Combat.deps.camera.matrixWorld = translation(0, 1, -5);
api._test.faceEmittersTowardCamera([facing]);
assert.strictEqual(facing.group.scale.z, -1, 'back view mirrors particles onto the -Z face');
assert.ok(facing.group.position.z < 0, 'mirrored emitter sits in front of the back face');

console.log('weapon enchantment VFX pooling tests passed');
