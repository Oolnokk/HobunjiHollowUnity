'use strict';

// Per-frame readiness probes (Quick Attack opportunity cue, melee HUD reticle,
// bandit halt checks) call Combat.meleeHit with debug:false. They must not
// overwrite window.__melee3DDebug.lastResult, which is the readout of the
// latest real swing used by Pixel Probe and mobile diagnostics.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() { const length = Math.sqrt(this.lengthSq()) || 1; this.x /= length; this.y /= length; this.z /= length; return this; }
}
const MathUtils = {
  clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
  radToDeg: value => value * 180 / Math.PI,
  degToRad: value => value * Math.PI / 180,
  lerp: (from, to, amount) => from + (to - from) * amount,
};
const runtime = { window: {}, performance: { now: () => 1000 }, THREE: { Vector3, MathUtils } };
vm.runInNewContext(fs.readFileSync('docs/js/combat/combat-core.js', 'utf8'), runtime);
const Combat = runtime.window.Combat;
const player = { id: 'player', x: 0, y: 0, angle: 0 };
Combat.init({ player, TILE: 64 });

const target = { id: 'wolf', x: 40, y: 0 }; // No portrait hitbox: exercises the 2D sector fallback.
const swing = { rangePx: 64, halfConeRad: 0.4, yaw: 0, pitch: 0 };

assert.equal(Combat.meleeHit(player, target, swing), true);
const recorded = runtime.window.__melee3DDebug.lastResult;
assert.equal(recorded.target, 'wolf', 'a real swing records its readout');

const decoy = { id: 'decoy', x: -40, y: 0 };
assert.equal(Combat.meleeHit(player, decoy, { ...swing, debug: false }), false, 'probe still returns its own hit decision');
assert.equal(runtime.window.__melee3DDebug.lastResult, recorded, 'a debug:false probe leaves the last real swing readout untouched');

assert.equal(Combat.meleeHit(player, decoy, swing), false);
assert.equal(runtime.window.__melee3DDebug.lastResult.target, 'decoy', 'the next real swing replaces it');

console.log('melee probe debug readout: debug:false probes keep the last real swing readout');
