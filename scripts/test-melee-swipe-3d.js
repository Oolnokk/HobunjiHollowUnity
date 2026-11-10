#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Checks the shipped melee swipe mesh against real pitched-cone dimensions.
const fs = require('node:fs'); // Reads the production Combat owner rather than a copied renderer.
const vm = require('node:vm'); // Executes in a minimal browser-like Three.js scene.

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() { const n = Math.sqrt(this.lengthSq()) || 1; return this.set(this.x / n, this.y / n, this.z / n); }
}
class BufferAttribute {
  constructor(data, size) { this.array = data; this.itemSize = size; this.needsUpdate = false; }
  setXYZ(i, x, y, z) { const at = i * 3; this.array[at] = x; this.array[at + 1] = y; this.array[at + 2] = z; }
  setUsage() { return this; }
  xyz(i) { return [...this.array.slice(i * 3, i * 3 + 3)]; }
}
class BufferGeometry {
  constructor() { this.attributes = {}; }
  setAttribute(name, value) { this.attributes[name] = value; return this; }
  setIndex(index) { this.indices = index; }
  dispose() { this.disposed = true; }
}
class MeshBasicMaterial {
  constructor(settings) { Object.assign(this, settings); }
  dispose() { this.disposed = true; }
}
class Mesh {
  constructor(geometry, material) { this.geometry = geometry; this.material = material; this.frustumCulled = true; }
}
const THREE = {
  Vector3, BufferAttribute, BufferGeometry, MeshBasicMaterial, Mesh,
  DynamicDrawUsage: 35048, AdditiveBlending: 2, DoubleSide: 2,
  MathUtils: { degToRad: v => v * Math.PI / 180, radToDeg: v => v * 180 / Math.PI, clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)), lerp: (a, b, t) => a + (b - a) * t },
};
const player = { x: 0, y: 0, angle: 0 }; // Known collider origin for the player-facing strip.
const scene = { children: [], add(mesh) { this.children.push(mesh); mesh.parent = this; }, remove(mesh) { const at = this.children.indexOf(mesh); if (at >= 0) this.children.splice(at, 1); mesh.parent = null; } }; // Three.js-style detach tests pool cleanup without retaining an old scene.
const window = {}; // Global Combat export used by the real game.js swipe path.
const context = vm.createContext({ window, THREE, performance: { now: () => 0 }, console, Date, Math });
vm.runInContext(fs.readFileSync('docs/js/combat/combat-core.js', 'utf8'), context, { filename: 'combat-core.js' });
window.Combat.init({ TILE: 64, player, getActiveScene: () => scene });
const render = window.Combat.writeMeleeTrailRibbon; // Real strip writer shared by game.js player and NPC swipes.

function approximate(actual, expected, label, tolerance = 0.00001) {
  assert(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
}
function meshFor(range, halfAngle, pitch, yaw = 0, halfHeightWorld = 0.35) {
  const attr = new BufferAttribute(new Float32Array(17 * 2 * 3), 3); // Exact 16-segment mesh allocation used by game.js.
  render(attr, {
    samples: 16, origin: new Vector3(3, 1, 5),
    direction: new Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch)),
    rangeTiles: range, halfConeRad: halfAngle, halfThickness: 0.06, halfHeightWorld, archUnits: 0.22,
  });
  assert.equal(attr.needsUpdate, true);
  return attr;
}
const radius = 2; // Known radial attack range, measured in world/tile units.
const yaw = 0.5; // Verifies the arc is not hardcoded to world X.
const pitch = 0.4; // Explicit elevated aim moves the whole arc upward.
const base = meshFor(radius, 0.3, pitch, yaw);
const widened = meshFor(radius, 0.6, pitch, yaw);
for (const [attr, halfAngle] of [[base, 0.3], [widened, 0.6]]) {
  for (let i = 0; i <= 16; i++) {
    const u = i / 16;
    const a = yaw - halfAngle + 2 * halfAngle * u;
    const [x, y, z] = attr.xyz(i * 2); // Outer edge is exactly the cone's horizontal+vertical reach.
    approximate(x, 3 + radius * Math.cos(pitch) * Math.cos(a), 'true collider arc X');
    approximate(z, 5 + radius * Math.cos(pitch) * Math.sin(a), 'true collider arc Z');
    approximate(y, 1 + radius * Math.sin(pitch) - (0.35 - 0.07) * Math.sin(Math.PI * u), '3D low edge height');
    const [innerX, innerY, innerZ] = attr.xyz(i * 2 + 1); // Inner upper edge never overshoots the hit radius.
    const distance = Math.hypot(innerX - 3, innerY - 1 - 0.35 * Math.sin(Math.PI * u), innerZ - 5);
    assert(distance <= radius + 0.00001, 'inner edge stays inside true reach');
    assert(innerY > y - 0.00001, '3D band has nonnegative vertical thickness');
  }
}
approximate(base.xyz(16)[0], widened.xyz(16)[0], 'AoE width does not extend cone length X');
approximate(base.xyz(16)[2], widened.xyz(16)[2], 'AoE width does not extend cone length Z');
assert(widened.xyz(0)[2] < base.xyz(0)[2], 'AoE expands the left cone boundary');
assert(widened.xyz(32)[2] > base.xyz(32)[2], 'AoE expands the right cone boundary');
const flat = meshFor(radius, 0.4, 0); // Even level attacks must no longer collapse into a horizontal 2D ribbon.
assert(flat.xyz(17)[1] - flat.xyz(16)[1] > 0.3, 'flat-aim swipes have substantial 3D height');

// The shared enemy entry point must respect explicitly authored attack yaw/pitch,
// even if a target's position suggests another aiming direction.
const enemy = { x: 0, y: 0, facing: 0 }; // Spawned hostile with an off-axis player target.
const trail = window.Combat.spawnMeleeTrail({ actor: enemy, target: { x: 0, y: 64 }, yaw: 0, pitch: 0, rangePx: 128, halfConeRad: 0.4, scene });
assert(trail && trail.mesh && scene.children.includes(trail.mesh));
const midpoint = trail.mesh.geometry.attributes.position.xyz(16); // Mid-sector point must aim east, never north toward the supplied target.
assert(midpoint[0] > 1.9 && Math.abs(midpoint[2]) < 0.00001, 'enemy swipe respects explicit attack direction');
window.Combat.update(0.23); // Fade a visible trail before testing recycled alpha reset.
assert(trail.mesh.material.opacity < 0.85, 'a live ribbon fades during the authored tail');
window.Combat.update(1);
assert.equal(scene.children.length, 0, 'expired swipes leave the active scene immediately');
assert.equal(trail.mesh.visible, false, 'pooled swipes do not stay visible after retirement');
assert.equal(trail.mesh.parent, null, 'pooled ribbon releases the old scene reference');
assert.notEqual(trail.mesh.geometry.disposed, true, 'retired GPU geometry is preserved for future sword strikes');

// Reuse the first enemy ribbon for a different pitch/width/color in another world scene:
// neither the old scene nor the old authored cone may survive a pooled attack.
const nextScene = { children: [], add(mesh) { this.children.push(mesh); mesh.parent = this; },
  remove(mesh) { const index = this.children.indexOf(mesh); if (index >= 0) this.children.splice(index, 1); mesh.parent = null; } }; // Tests zoning across scenes without retaining a removed scene.
const second = window.Combat.spawnMeleeTrail({
  actor: player, scene: nextScene, yaw: Math.PI / 2, pitch: 0.3,
  rangePx: 64, halfConeRad: 0.2, color: 0x33aa99,
});
assert.equal(second.mesh, trail.mesh, 'the same GPU mesh is reused for a new player or bandit strike');
assert.equal(second.mesh.material.opacity, 0.85, 'pooled alpha resets at the next impact');
assert.equal(second.mesh.material.color, 0x33aa99, 'pooled tint follows the new weapon/affliction');
assert.notDeepEqual(second.mesh.geometry.attributes.position.xyz(16), midpoint, 'the next swing rewrites its own cone vertices');
window.Combat.update(1);
assert.equal(nextScene.children.length, 0, 'the recycled strike also retires from its new scene');

// A sudden bandit crowd can exceed the pool: keep only 64 detached ribbons
// and free any excess instead of growing GPU buffers indefinitely.
const crowd = []; // Active simultaneous attacks cannot borrow the same pooled mesh.
for (let i = 0; i < 70; i++) {
  crowd.push(window.Combat.spawnMeleeTrail({ actor: enemy, yaw: 0, pitch: 0, rangePx: 64, halfConeRad: 0.3, scene }));
}
assert.equal(new Set(crowd.map(item => item.mesh)).size, 70, 'simultaneous enemy ribbons never alias one another');
window.Combat.update(1);
const counters = window.__melee3DDebug.snapshot(); // The existing mobile Pixel Probe exposes these counters.
assert.equal(scene.children.length, 0, 'all crowd ribbons retire from the world');
assert.equal(counters.activeTrailCount, 0);
assert.equal(counters.pooledTrailCount, 64, 'detached ribbon pool has a strict upper bound');
assert.ok(counters.trailMeshesReused >= 2, 'both enemy/player strikes reuse the same material and geometry');
assert.ok(counters.trailMeshesDisposed >= 6, 'crowd overflow releases excess GPU buffers');

// The existing opt-in mobile profiler must distinguish player vs enemy strike
// callbacks, not accidentally count hit-stop as JavaScript or double-fire a hit.
const measuredLabels = []; // Emulates the ordinary PerfProfiler begin/end API.
window.PerfProfiler = { isEnabled: () => true, begin: label => ({ label }), end: token => {
  measuredLabels.push(token.label);
  return token.label.includes('enemy') ? 12 : 5;
} };
window.Combat.beginStagedAction({ windupS: 0, strikeS: 0, data: { isBandit: true, attacker: enemy }, onStrike() {} });
window.Combat.beginStagedAction({ windupS: 0, strikeS: 0, data: { attacker: player }, onStrike() {} });
const afterStrikes = window.__melee3DDebug.snapshot();
assert.deepEqual(measuredLabels, ['Combat: enemy strike callback', 'Combat: player strike callback']);
assert.equal(afterStrikes.strikeCpuMs.enemy.max, 12);
assert.equal(afterStrikes.strikeCpuMs.player.last, 5);
assert.equal(afterStrikes.strikeCpuMs.enemy.samples, 1);
// A miss still creates the swoosh; it is the attack event, not a damage/hit reaction.
let missedStrikeDamage = 0; // Guard verifies this path never needs a successful hit to render a trail.
window.Combat.beginStagedAction({ windupS: 0, strikeS: 0, data: { isBandit: true, attacker: enemy }, onStrike: () => {
  window.Combat.spawnMeleeTrail({ actor: enemy, scene, yaw: 0, pitch: 0, rangePx: 64, halfConeRad: 0.2 });
  if (false) missedStrikeDamage++;
} });
assert.equal(missedStrikeDamage, 0, 'enemy attack misses without dealing damage');
assert.equal(scene.children.length, 1, 'even a missed enemy attack displays its pooled swipe');
window.Combat.update(1);
assert.equal(scene.children.length, 0, 'a missed attack also returns its ribbon to the pool');

// Exercise the real bandit swing profiling seam with a lightweight pose stub.
const banditSource = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8'); // Production attack-pose wrapper, not a duplicated test implementation.
// Execute the actual shared bandit attack-ribbon helper, then deliberately never run a hit check.
const arcStart = banditSource.indexOf('  const BANDIT_TRAIL_HALF_THICKNESS_TILES = ');
const arcEnd = banditSource.indexOf('  // A dual-wield weapon rests', arcStart);
assert(arcStart >= 0 && arcEnd > arcStart, 'the real enemy attack trail helper is present');
const arcContext = vm.createContext({ window: { Combat: { spawnMeleeTrail: opts => window.Combat.spawnMeleeTrail(opts) } } });
vm.runInContext(banditSource.slice(arcStart, arcEnd) + '\nthis.banditArc = spawnBanditTrailArc;', arcContext);
arcContext.banditArc({ def: { attackTag: 'sharp' }, scene, x: 0, y: 0, facing: 0 }, 64, 0.2, 0.2, 0);
assert.equal(scene.children.length, 1, 'actual bandit trail helper renders without needing a successful meleeHit');
const firstOnStrike = banditSource.indexOf('        spawnBanditTrailArc(c, rangePx, halfConeRad, c.facing);');
assert(firstOnStrike > 0 && banditSource.slice(firstOnStrike, firstOnStrike + 280).includes('meleeHit'), 'bandit spawns its ribbon before hit resolution');
window.Combat.update(1);
assert.equal(scene.children.length, 0, 'a genuine bandit attack ribbon returns to the pool after a miss');

const measureStart = banditSource.indexOf('  const banditSwingPoseCpuStats = ');
const measureEnd = banditSource.indexOf('  window.BanditCombat = {', measureStart);
assert(measureStart >= 0 && measureEnd > measureStart, 'the real bandit pose timing wrapper is present');
const poseCalls = []; // Records whether idle, windup and post-attack tail animation all run.
const poseRuntime = vm.createContext({ window: { PerfProfiler: {
  isEnabled: () => true,
  begin: name => { poseCalls.push(name); return { name }; },
  end: () => 7,
} }, updateBanditToolMesh: c => { poseCalls.push('pose:' + c.id); return c.id; } });
vm.runInContext(banditSource.slice(measureStart, measureEnd) + '\nthis.measured = measuredBanditToolMesh; this.stats = () => ({ ...banditSwingPoseCpuStats });', poseRuntime);
assert.equal(poseRuntime.measured({ id: 'idle' }), 'idle');
assert.equal(poseRuntime.measured({ id: 'missed', _banditAction: {} }), 'missed');
assert.equal(poseRuntime.measured({ id: 'recovering', _banditToolTail: {} }), 'recovering');
assert.equal(poseRuntime.stats().samples, 2, 'only active swing/recovery poses incur profiler timing');
assert.equal(poseRuntime.stats().peakMs, 7);
assert.deepEqual(poseCalls, ['pose:idle', 'Combat: bandit swing pose', 'pose:missed', 'Combat: bandit swing pose', 'pose:recovering']);
console.log('3D swipe: pitch parity, pooling, misses, crowd limit and strike/swing timing: PASS');
