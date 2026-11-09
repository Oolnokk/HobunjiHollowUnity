#!/usr/bin/env node
'use strict';
// Pins RopeCore to the ORIGINAL rope arithmetic from js/dev-random-ruin-simple-puzzles.js (before it was moved
// into rope-core.js). The reference functions below are that original code, verbatim apart from taking their
// collision test and constants as parameters. Results must be bit-for-bit identical.
const assert = require('assert');
const RC = require('../docs/js/rope-core.js');

// ---- original constants
const ROPE_GRAVITY = 8.2, ROPE_PUMP = .45, ROPE_MAX_ANGLE = 1.28, ROPE_MIN_LENGTH = 1.65;
assert.equal(RC.GRAVITY, ROPE_GRAVITY); assert.equal(RC.PUMP, ROPE_PUMP); assert.equal(RC.MAX_ANGLE, ROPE_MAX_ANGLE); assert.equal(RC.MIN_LENGTH, ROPE_MIN_LENGTH);
assert.equal(RC.GRAB_RADIUS, 0.8); assert.equal(RC.BODY_RADIUS, 0.045); assert.equal(RC.COLLISION_RADIUS, 0.24); assert.equal(RC.AIR_CATCH_RADIUS, 0.45); assert.equal(RC.RELEASE_KICK, 0.55);

// ---- original functions (verbatim)
const ref = {
  ropeBobAt(rope, angle = rope.angle) {
    const dirX = Math.cos(rope.yaw), dirZ = Math.sin(rope.yaw), horizontal = Math.sin(angle) * rope.length;
    return { x: rope.anchor.x + dirX * horizontal, z: rope.anchor.z + dirZ * horizontal, y: rope.anchor.y - Math.cos(angle) * rope.length };
  },
  ropeIntent(rope, player, tile, allowVelocityFallback = false) {
    const strength = Math.max(0, Math.min(1, Number(player?.inputStrength) || 0));
    const rawX = Number(player?.inputX) || 0, rawZ = Number(player?.inputY) || 0;
    const rawLength = Math.hypot(rawX, rawZ);
    let ix = rawLength > .001 ? rawX / rawLength * strength : 0;
    let iz = rawLength > .001 ? rawZ / rawLength * strength : 0;
    if (allowVelocityFallback && strength <= .001) {
      const vx = (Number(player?.vx) || 0) / tile, vz = (Number(player?.vy) || 0) / tile;
      const speed = Math.hypot(vx, vz);
      if (speed > .001) { ix = vx / Math.max(3, speed); iz = vz / Math.max(3, speed); }
    }
    const dx = Math.cos(rope.yaw), dz = Math.sin(rope.yaw);
    const sx = -dz, sz = dx;
    return { forward: Math.max(-1, Math.min(1, ix * dx + iz * dz)), side: Math.max(-1, Math.min(1, ix * sx + iz * sz)), strength: Math.min(1, Math.hypot(ix, iz)) };
  },
  updateAttachedRope(rope, intent, dt, blocked) {
    const priorAngle = rope.angle, priorYaw = rope.yaw, priorLength = rope.length;
    if (rope.braking) {
      rope.omega *= Math.exp(-9 * dt);
      rope.yaw += intent.side * 1.6 * dt;
      rope.length = Math.max(ROPE_MIN_LENGTH, Math.min(rope.maxLength, rope.length - intent.forward * .9 * dt));
    } else {
      if (intent.forward * rope.omega > 0) rope.omega += intent.forward * ROPE_PUMP * dt;
      rope.omega += (-ROPE_GRAVITY / Math.max(.4, rope.length)) * Math.sin(rope.angle) * dt;
      rope.omega *= Math.exp(-.16 * dt);
      rope.angle += rope.omega * dt;
      if (Math.abs(rope.angle) > ROPE_MAX_ANGLE) { rope.angle = Math.sign(rope.angle) * ROPE_MAX_ANGLE; rope.omega *= .72; }
    }
    const candidate = ref.ropeBobAt(rope), from = rope.lastSafeBob || ref.ropeBobAt({ ...rope, angle: priorAngle, yaw: priorYaw, length: priorLength });
    if (blocked(from, candidate)) { rope.angle = priorAngle; rope.yaw = priorYaw; rope.length = priorLength; rope.omega *= -.18; rope.collisionStops++; }
    return ref.ropeBobAt(rope);
  },
  updateIdleRope(rope, dt, blocked) {
    const priorAngle = rope.angle;
    rope.omega += (-ROPE_GRAVITY / Math.max(.4, rope.length)) * Math.sin(rope.angle) * dt;
    rope.omega *= Math.exp(-.28 * dt);
    rope.angle += rope.omega * dt;
    const candidate = ref.ropeBobAt(rope), from = rope.lastSafeBob || ref.ropeBobAt(rope, priorAngle);
    if (blocked(from, candidate)) { rope.angle = priorAngle; rope.omega *= -.18; rope.collisionStops++; }
    return ref.ropeBobAt(rope);
  },
  releaseFlight(rope, bob) {
    const dirX = Math.cos(rope.yaw), dirZ = Math.sin(rope.yaw);
    const tangentSpeed = Math.cos(rope.angle) * rope.length * rope.omega;
    const verticalSpeed = Math.sin(rope.angle) * rope.length * rope.omega;
    return { x: bob.x, y: bob.y, z: bob.z, vx: dirX * tangentSpeed, vz: dirZ * tangentSpeed, vy: verticalSpeed + .55 };
  },
  catchRopeInFlight(rope, f) {
    const dirX = Math.cos(rope.yaw), dirZ = Math.sin(rope.yaw);
    const horizontal = (f.x - rope.anchor.x) * dirX + (f.z - rope.anchor.z) * dirZ, drop = Math.max(.05, rope.anchor.y - f.y);
    rope.length = Math.max(ROPE_MIN_LENGTH, Math.min(rope.maxLength, Math.hypot(horizontal, drop)));
    rope.angle = Math.max(-ROPE_MAX_ANGLE, Math.min(ROPE_MAX_ANGLE, Math.atan2(horizontal, drop)));
    const along = f.vx * dirX + f.vz * dirZ;
    rope.omega = (along * Math.cos(rope.angle) + f.vy * Math.sin(rope.angle)) / rope.length;
  },
  ropeReachAmplitude(rope, simulateRopeFlight, { maxAmp = 1.2, minAmp = .6 } = {}) {
    const dirX = Math.cos(rope.yaw), dirZ = Math.sin(rope.yaw), L = rope.length;
    for (let amp = minAmp; amp <= maxAmp + 1e-6; amp += .05) {
      for (let i = 0; i <= 10; i++) {
        const theta = amp * (.15 + .85 * i / 10);
        const omega = Math.sqrt(Math.max(0, 2 * (ROPE_GRAVITY / L) * (Math.cos(theta) - Math.cos(amp))));
        const tangent = Math.cos(theta) * L * omega;
        const start = { x: rope.anchor.x + dirX * Math.sin(theta) * L, z: rope.anchor.z + dirZ * Math.sin(theta) * L, y: rope.anchor.y - Math.cos(theta) * L, vx: dirX * tangent, vz: dirZ * tangent, vy: Math.sin(theta) * L * omega + .55 };
        if (simulateRopeFlight(start)) return +amp.toFixed(2);
      }
    }
    return null;
  },
};

// ---- deterministic randomness
let seed = 123456789; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const between = (a, b) => a + (b - a) * rnd();
function randomRope() {
  const length = between(1.65, 4.5);
  return { anchor: { x: between(-8, 8), y: between(3, 5), z: between(-8, 8) }, yaw: between(-Math.PI, Math.PI), length, maxLength: length + between(0, 1),
    angle: between(-1.2, 1.2), omega: between(-3.5, 3.5), braking: rnd() < 0.25, bob: null, lastSafeBob: rnd() < 0.5 ? { x: 0, y: 0, z: 0 } : null, collisionStops: 0 };
}
const copy = r => JSON.parse(JSON.stringify(r));
const same = (a, b, msg) => assert.deepStrictEqual(a, b, msg);
const sameState = (core, orig, msg) => { for (const k of ['angle', 'omega', 'yaw', 'length', 'collisionStops']) assert.strictEqual(core[k], orig[k], `${msg}: ${k} ${core[k]} vs ${orig[k]}`); };

// ---- bob, intent
for (let i = 0; i < 2000; i++) {
  const r = randomRope(), a = between(-1.28, 1.28);
  same(RC.bobAt(r), ref.ropeBobAt(r), 'bobAt'); same(RC.bobAt(r, a), ref.ropeBobAt(r, a), 'bobAt(angle)');
}
for (let i = 0; i < 3000; i++) {
  const r = randomRope(), tile = 32 + Math.floor(rnd() * 64);
  const player = { inputStrength: rnd() < 0.2 ? 0 : between(0, 1.4), inputX: rnd() < 0.15 ? 0 : between(-1, 1), inputY: between(-1, 1), vx: between(-300, 300), vy: between(-300, 300) };
  const fallback = rnd() < 0.5;
  same(RC.intent(r, { strength: player.inputStrength, x: player.inputX, z: player.inputY }, fallback ? { vx: player.vx / tile, vz: player.vy / tile } : null), ref.ropeIntent(r, player, tile, fallback), 'intent');
}

// ---- steps, single and long sequences, with and without collisions
const wall = threshold => (from, to) => to.x > threshold || (to.z < -threshold);
for (const blockedAt of [Infinity, 6, 3, 0.5]) {
  for (let trial = 0; trial < 400; trial++) {
    const a = randomRope(), b = copy(a); let hold = false;
    for (let step = 0; step < 120; step++) {
      const dt = [1 / 60, 1 / 30, 0.05, 0.016][step % 4];
      const move = { forward: between(-1, 1), side: between(-1, 1), strength: 1 };
      if (rnd() < 0.05) { hold = !hold; a.braking = b.braking = hold; }
      const blocked = wall(blockedAt);
      const mode = trial % 2 === 0;
      let bobCore, bobRef;
      if (mode) { bobCore = RC.stepAttached(a, move, dt, blocked).bob; bobRef = ref.updateAttachedRope(b, move, dt, blocked); }
      else { bobCore = RC.stepIdle(a, dt, blocked); bobRef = ref.updateIdleRope(b, dt, blocked); }
      sameState(a, b, `${mode ? 'attached' : 'idle'} trial ${trial} step ${step} wall ${blockedAt}`);
      same(bobCore, bobRef, 'bob after step');
      // the host-side effect: lastSafeBob tracks the bob, as both runtimes do
      a.lastSafeBob = RC.clonePoint(bobCore); b.lastSafeBob = RC.clonePoint(bobRef);
    }
  }
}

// ---- release, catch, reach
for (let i = 0; i < 2000; i++) {
  const r = randomRope(), bob = ref.ropeBobAt(r);
  same(RC.releaseFlight(r, bob), ref.releaseFlight(r, bob), 'releaseFlight');
  const f = { x: r.anchor.x + between(-3, 3), y: r.anchor.y - between(0.1, 4), z: r.anchor.z + between(-3, 3), vx: between(-6, 6), vy: between(-6, 6), vz: between(-6, 6) };
  const a = copy(r), b = copy(r); RC.catchFromFlight(a, f); ref.catchRopeInFlight(b, f);
  sameState(a, b, 'catchFromFlight');
}
for (let i = 0; i < 200; i++) {
  const r = randomRope(), threshold = between(0, 6), sim = start => Math.hypot(start.vx, start.vz) > threshold && start.y > 0;
  assert.strictEqual(RC.reachAmplitude(r, sim), ref.ropeReachAmplitude(r, sim), 'reachAmplitude');
  const opts = { maxAmp: 1.1, minAmp: 0.7 }; assert.strictEqual(RC.reachAmplitude(r, sim, opts), ref.ropeReachAmplitude(r, sim, opts));
}

// ---- behaviours the original rope is loved for, as sanity checks on the core itself
const gentle = () => false;
let rope = RC.create({ anchor: { x: 0, y: 4, z: 0 }, length: 3 }); rope.omega = 1.5;
for (let i = 0; i < 60 * 60; i++) RC.stepIdle(rope, 1 / 60, gentle);
assert(Math.abs(rope.angle) < 0.02 && Math.abs(rope.omega) < 0.05, 'an unoccupied rope settles');
rope = RC.create({ anchor: { x: 0, y: 4, z: 0 }, length: 3 }); rope.omega = 0.4; let peak = 0;
for (let i = 0; i < 60 * 25; i++) { const m = { forward: Math.sign(rope.omega) || 1, side: 0, strength: 1 }; RC.stepAttached(rope, m, 1 / 60, gentle); peak = Math.max(peak, Math.abs(rope.angle)); }
assert(peak > 0.9, 'pumping in time with the swing builds height: peak ' + peak);
assert(peak <= RC.MAX_ANGLE + 1e-9, 'and never exceeds the max swing angle');
rope = RC.create({ anchor: { x: 0, y: 4, z: 0 }, length: 3 }); rope.angle = 0.8; rope.omega = 2; rope.braking = true;
for (let i = 0; i < 90; i++) RC.stepAttached(rope, { forward: 0, side: 0 }, 1 / 60, gentle);
assert(Math.abs(rope.omega) < 0.01, 'holding the brake stops the swing');
const r2 = RC.create({ anchor: { x: 0, y: 4, z: 0 }, length: 3, maxLength: 3.5 }); r2.braking = true;
RC.stepAttached(r2, { forward: -1, side: 0 }, 1, gentle); assert.equal(r2.length, 3.5, 'braking and pulling back lengthens up to maxLength');
RC.stepAttached(r2, { forward: 1, side: 0 }, 10, gentle); assert.equal(r2.length, RC.MIN_LENGTH, 'and shortens down to the minimum');
const blocked = RC.create({ anchor: { x: 0, y: 4, z: 0 }, length: 3 }); blocked.omega = 2;
RC.stepIdle(blocked, 1 / 60, () => true); assert.equal(blocked.angle, 0, 'a blocked step is undone'); assert(blocked.omega < 0, 'and bounces back'); assert.equal(blocked.collisionStops, 1);
console.log('rope-core: ok (' + 'parity with the original rope arithmetic across randomized states and long sequences' + ')');
