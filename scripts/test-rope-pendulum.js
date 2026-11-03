#!/usr/bin/env node
'use strict';
const assert = require('assert');
const RP = require('../docs/js/rope-pendulum.js');
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} +/- ${tol}, got ${a}`);

// rest: hangs straight down and stays there
let s = RP.create({ anchor: { x: 5, y: 4, z: 6 }, length: 2 });
assert.deepEqual([s.px, s.py, s.pz], [5, 2, 6]);
for (let i = 0; i < 100; i++) RP.step(s, 1 / 60);
near(s.py, 2, 1e-9, 'a bob at rest stays at rest'); near(RP.angle(s), 0, 1e-9);

// the rope never stretches, whatever happens to it
s = RP.create({ anchor: { x: 0, y: 5, z: 0 }, length: 2.4 });
RP.applyVelocity(s, { x: 3.1, y: 0.4, z: -2.2 });
for (let i = 0; i < 600; i++) { RP.step(s, 1 / 60); near(Math.hypot(s.px - s.ax, s.py - s.ay, s.pz - s.az), 2.4, 1e-6, 'rope length is constant'); }

// a velocity along the rope is removed (a real rope cannot be pushed along its length)
s = RP.create({ anchor: { x: 0, y: 5, z: 0 }, length: 2 });
RP.applyVelocity(s, { x: 0, y: -9, z: 0 });
near(RP.speed(s), 0, 1e-9, 'pushing straight down the rope does nothing');
RP.applyVelocity(s, { x: 3, y: 0, z: 0 }); near(RP.horizontalSpeed(s), 3, 1e-9, 'a sideways push at rest is fully tangential');

// energy: swing amplitude from a launch speed matches the pendulum result  cos(theta) = 1 - v^2 / (2 g L)
for (const v of [1.2, 2.5, 4.0]) {
  s = RP.create({ anchor: { x: 0, y: 5, z: 0 }, length: 2.4, damping: 0 });
  RP.applyVelocity(s, { x: v, y: 0, z: 0 });
  let max = 0; for (let i = 0; i < 400; i++) { RP.step(s, 1 / 120); max = Math.max(max, RP.angle(s)); }
  near(max, Math.acos(1 - v * v / (2 * s.gravity * 2.4)), 0.01, `apex angle for launch speed ${v}`);
}
// and without damping energy is conserved
s = RP.create({ anchor: { x: 0, y: 5, z: 0 }, length: 2, damping: 0 }); RP.applyVelocity(s, { x: 3, y: 0, z: 0 });
const e0 = RP.energy(s); for (let i = 0; i < 1200; i++) RP.step(s, 1 / 60); near(RP.energy(s), e0, e0 * 0.02, 'energy is conserved with no drag');

// period of a small swing: T = 2 pi sqrt(L / g)
s = RP.create({ anchor: { x: 0, y: 5, z: 0 }, length: 2, damping: 0 }); RP.applyVelocity(s, { x: 0.6, y: 0, z: 0 });
let crossings = [], prev = s.px; for (let i = 1; i <= 2400; i++) { RP.step(s, 1 / 240); if (prev < 0 && s.px >= 0) crossings.push(i / 240); prev = s.px; }
near(crossings[1] - crossings[0], 2 * Math.PI * Math.sqrt(2 / s.gravity), 0.02, 'small-swing period');

// drag makes it settle
s = RP.create({ anchor: { x: 0, y: 5, z: 0 }, length: 2 }); RP.applyVelocity(s, { x: 3, y: 0, z: 0 });
for (let i = 0; i < 60 * 40; i++) RP.step(s, 1 / 60); assert(RP.speed(s) < 0.05 && RP.angle(s) < 0.02, 'comes to rest');

// a strike in any direction moves it that way; sustained swinging is planar-ish then conical, never NaN
s = RP.create({ anchor: { x: 0, y: 5, z: 0 }, length: 2 }); RP.applyVelocity(s, { x: 0, y: 0, z: -3 });
RP.step(s, 0.1); assert(s.pz < 0 && Math.abs(s.px) < 1e-6, 'a -z strike swings toward -z');
RP.applyVelocity(s, { x: 2, y: 0, z: 0 }); for (let i = 0; i < 300; i++) RP.step(s, 1 / 60);
assert([s.px, s.py, s.pz, s.vx, s.vy, s.vz].every(Number.isFinite), 'stays finite');

// along(): the apex of a swing is where velocity along the out direction changes sign
s = RP.create({ anchor: { x: 0, y: 5, z: 0 }, length: 2.4 }); RP.applyVelocity(s, { x: 2.5, y: 0, z: 0 });
let seenPositive = false, apex = null;
for (let i = 0; i < 600 && !apex; i++) { RP.step(s, 1 / 120); const a = RP.along(s, 1, 0); if (a.velocity > 0) seenPositive = true; else if (seenPositive) apex = a; }
assert(apex && apex.displacement > 0.5, 'the bob swings out then reaches an apex with positive displacement');

// step is defensive about its inputs
assert.doesNotThrow(() => { RP.step(s, NaN); RP.step(s, -1); RP.step(s, 99); }); assert(Number.isFinite(s.px));

// lunge -> speed: close hit = little, full lunge = lots, monotonic and clamped
assert.equal(RP.strikeSpeed(0), RP.STRIKE_DEFAULTS.minSpeed);
assert.equal(RP.strikeSpeed(10), RP.STRIKE_DEFAULTS.maxSpeed, 'beyond a full lunge is clamped');
let last = -1; for (const d of [0, 0.2, 0.5, 0.8, 1.2, 1.6]) { const v = RP.strikeSpeed(d); assert(v >= last, 'monotonic'); last = v; }
assert.equal(RP.strikeSpeed(undefined), RP.STRIKE_DEFAULTS.minSpeed); assert.equal(RP.strikeSpeed(-3), RP.STRIKE_DEFAULTS.minSpeed);
assert.equal(RP.strikeSpeed(0.8, { referenceLungeWorld: 0.8, minSpeed: 1, maxSpeed: 3 }), 3, 'configurable');
console.log('rope-pendulum: ok');
