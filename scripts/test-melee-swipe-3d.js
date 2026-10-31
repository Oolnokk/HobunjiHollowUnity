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
const scene = { children: [], add(mesh) { this.children.push(mesh); mesh.parent = this; }, remove(mesh) { this.children.splice(this.children.indexOf(mesh), 1); } }; // Exposes geometry for render-free inspection.
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
    approximate(y, 1 + radius * Math.sin(pitch) - 0.35 * Math.sin(Math.PI * u), '3D low edge height');
    const [innerX, innerY, innerZ] = attr.xyz(i * 2 + 1); // Inner upper edge never overshoots the hit radius.
    const distance = Math.hypot(innerX - 3, innerY - 1 - 0.35 * Math.sin(Math.PI * u) + Math.min(0.22, 0.35 * 0.2) * Math.sin(Math.PI * u), innerZ - 5);
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
window.Combat.update(1);
assert.equal(scene.children.length, 0, 'swipe and its GPU buffers are cleaned up at end of lifetime');
console.log('3D swipe: correct radius, pitched arc, vertical depth, AoE width, authored yaw, and GPU cleanup: PASS');
