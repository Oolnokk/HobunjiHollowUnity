#!/usr/bin/env node
'use strict';
// Executable regressions for the combat allocation and player/enemy visual-parity patch.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const coreSource = fs.readFileSync('docs/js/combat/combat-core.js', 'utf8');
const banditSource = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8');

let allocations = 0;
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; allocations++; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(p) { return this.set(p.x, p.y, p.z); }
  clone() { return new Vector3(this.x, this.y, this.z); }
  sub(p) { return this.set(this.x - p.x, this.y - p.y, this.z - p.z); }
  lengthSq() { return this.x ** 2 + this.y ** 2 + this.z ** 2; }
  normalize() { const length = Math.sqrt(this.lengthSq()) || 1; return this.set(this.x / length, this.y / length, this.z / length); }
  distanceTo(p) { return Math.hypot(this.x - p.x, this.y - p.y, this.z - p.z); }
}
class Ray {
  constructor() { this.origin = new Vector3(); this.direction = new Vector3(1, 0, 0); }
  // The real Box3 center-ray optimization is intentionally bypassed to cover the full volume-grid fallback.
  intersectBox() { return null; }
}
const MathUtils = {
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  radToDeg: rad => rad * 180 / Math.PI,
  degToRad: deg => deg * Math.PI / 180,
  lerp: (a, b, t) => a + (b - a) * t,
};
let millis = 1000;
const DateMock = class extends Date { static now() { return millis; } };
const attacker = { id: 'player', x: 0, y: 0, angle: 0 };
const target = { id: 'target', x: 64, y: 0 };
const makeBox = (minX, maxX, minY = 0, maxY = 1, minZ = -0.2, maxZ = 0.2) => ({
  min: new Vector3(minX, minY, minZ), max: new Vector3(maxX, maxY, maxZ),
  clampPoint(p, out) {
    return out.set(
      MathUtils.clamp(p.x, this.min.x, this.max.x),
      MathUtils.clamp(p.y, this.min.y, this.max.y),
      MathUtils.clamp(p.z, this.min.z, this.max.z),
    );
  },
});
const near = { center: new Vector3(1, 0.5, 0), box: makeBox(0.9, 1.1) };
const far = { center: new Vector3(3, 0.5, 0), box: makeBox(2.9, 3.1) };
const runtime = {
  THREE: { Vector3, Ray, MathUtils },
  Date: DateMock, performance: { now: () => millis },
  window: { RangedWeapons: { actorHitbox: actor => actor === attacker
    ? { center: new Vector3(0, 0.5, 0), box: makeBox(-0.2, 0.2) }
    : actor === target ? near : null } },
};
vm.runInNewContext(coreSource, runtime, { filename: 'combat-core.js' });
const combat = runtime.window.Combat;
combat.init({ player: attacker, TILE: 64 });
const attack = { yaw: 0, pitch: 0, rangePx: 100, halfConeRad: 0.25 };
assert.equal(combat.meleeHit(attacker, target, { ...attack, debug: false }), true, 'near volume-grid target is hittable');
runtime.window.RangedWeapons.actorHitbox = actor => actor === attacker
  ? { center: new Vector3(0, 0.5, 0), box: makeBox(-0.2, 0.2) }
  : actor === target ? far : null;
assert.equal(combat.meleeHit(attacker, target, { ...attack, debug: false }), false, 'far volume-grid target misses');
runtime.window.RangedWeapons.actorHitbox = actor => actor === attacker
  ? { center: new Vector3(0, 0.5, 0), box: makeBox(-0.2, 0.2) }
  : actor === target ? near : null;
for (let n = 0; n < 3; n++) combat.meleeHit(attacker, target, { ...attack, debug: false });
const before = allocations;
for (let n = 0; n < 5; n++) combat.meleeHit(attacker, target, { ...attack, debug: false });
const perHit = (allocations - before) / 5;
// The old 3×3×3 grid alone made 27 Vector3 instances per probe.
assert(perHit < 8, 'melee grid and center ray must reuse THREE scratch vectors');
combat.meleeHit(attacker, target, attack);
assert.equal(runtime.window.__melee3DDebug.retainedColliderCount, 1, 'real swings keep a bounded debug snapshot');
millis += 900;
combat.update(0);
assert.equal(runtime.window.__melee3DDebug.retainedColliderCount, 0, 'normal update prunes stale actor references without reading the overlay');

// Exercise the actual spatial helper with a wide scene: the second lookup within
// the same frame should touch the handful of local actors, not every hostile.
const spaceStart = banditSource.indexOf('  const banditSpacingBuckets = new Map();');
const spaceEnd = banditSource.indexOf('  // A bandit\'s own rough body radius', spaceStart);
assert(spaceStart > 0 && spaceEnd > spaceStart, 'spatial avoidance implementation is found');
let farPositionReads = 0;
const farHostiles = Array.from({ length: 200 }, (_, i) => ({
  isBandit: true, health: 100,
  get x() { farPositionReads++; return 10000 + i * 100; },
  get y() { farPositionReads++; return 10000; },
}));
const self = { isBandit: true, health: 100, x: 0, y: 0 };
const neighbor = { isBandit: true, health: 100, x: 20, y: 0 };
const spaceContext = {
  deps: { TILE: 64, hostileObjects: [self, neighbor, ...farHostiles] },
  performance: { now: () => millis },
  banditPersonalSpacePx: () => 64 * .85,
};
vm.createContext(spaceContext);
vm.runInContext(banditSource.slice(spaceStart, spaceEnd) + '\nthis.adjust = banditPersonalSpaceAdjust;', spaceContext);
let pushed = spaceContext.adjust(self, { x: 0, y: 0 });
assert(pushed.x < 0, 'nearby bandit pushes the movement target away');
farPositionReads = 0;
pushed = spaceContext.adjust(self, { x: 0, y: 0 });
assert(pushed.x < 0);
assert.equal(farPositionReads, 0, 'within-frame avoidance does not rescan distant hostiles');
millis += 20;
spaceContext.adjust(self, { x: 0, y: 0 });
assert(farPositionReads > 0, 'index refreshes for the next simulation window');

// Exercise the enemy's real trail owner. Color derives from ResourceRings,
// while the shared Combat renderer keeps ownership of transient meshes.
const trailStart = banditSource.indexOf('  const BANDIT_TRAIL_HALF_THICKNESS_TILES =');
const trailEnd = banditSource.indexOf('  // A dual-wield weapon rests', trailStart);
assert(trailStart > 0 && trailEnd > trailStart, 'enemy trail implementation is found');
const calls = [];
const trailContext = { window: {
  ResourceSystem: { afflictionBonusesForTag: () => ({ bleedingHealth: .4, poisonedHealth: .2 }) },
  ResourceRings: { AFFLICTION_COLORS: { bleedingHealth: 0xdd3333, poisonedHealth: 0x44dd33 }, neonizeColor: n => n },
  Combat: { spawnMeleeTrail: opts => { calls.push(opts); } },
}};
vm.createContext(trailContext);
vm.runInContext(banditSource.slice(trailStart, trailEnd) + '\nthis.draw = spawnBanditTrailArc;', trailContext);
trailContext.draw({ def: { attackTag: 'sharp' }, scene: {} }, 64, .6, 1.1);
assert.equal(calls.length, 2, 'a multi-affliction attack draws two visual color lanes');
assert.deepEqual(calls.map(c => c.color), [0xdd3333, 0x44dd33]);
assert(Math.abs(calls[0].yaw - .8) < 1e-9 && Math.abs(calls[1].yaw - 1.4) < 1e-9, 'lanes span the original cone');
assert(calls[0].debug && !calls[1].debug, 'visual-only additional lanes do not duplicate debug colliders');
console.log('combat performance/parity: scratch reuse, expiration, spatial neighbors and affliction trails passed');
