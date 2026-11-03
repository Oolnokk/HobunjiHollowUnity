// RopeCore — the single source of truth for how a rope swings and how a rider leaves it.
//
// This is the arithmetic of the original Random Test Ruin rope traversal
// (js/dev-random-ruin-simple-puzzles.js), moved here verbatim so every rope in the game feels the
// same: the generator's ropes, furniture ropes, and ropes carrying burdens. Hosts keep everything
// that is theirs (the player, collision, meshes, input); this module owns the numbers.
//
// A rope is a plain object:
//   { anchor:{x,y,z}, yaw, length, maxLength, angle, omega, braking, bob, lastSafeBob, collisionStops }
// `yaw` is the horizontal direction of the swing plane; `angle` (radians, signed) is the displacement
// along it (0 = hanging straight down); `omega` its angular velocity.
//
// Collision is injected: `blocked(from, to)` returns truthy when the swept path from one bob
// position to the next is obstructed. When it is, the step is undone and the swing bounces back.
//
// Pure data/math; runs under node and in the browser.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RopeCore = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const C = Object.freeze({
    GRAVITY: 8.2,           // ROPE_GRAVITY
    PUMP: 0.45,             // ROPE_PUMP: pumping only adds swing in the direction of travel
    MAX_ANGLE: 1.28,        // ROPE_MAX_ANGLE
    MIN_LENGTH: 1.65,       // ROPE_MIN_LENGTH
    GRAB_RADIUS: 0.8,       // ROPE_GRAB_RADIUS
    BODY_RADIUS: 0.045,     // ROPE_BODY_RADIUS: visible rope thickness
    COLLISION_RADIUS: 0.24, // ROPE_COLLISION_RADIUS: rider-sized clearance for sweeps
    AIR_CATCH_RADIUS: 0.45, // ROPE_AIR_CATCH_RADIUS
    RELEASE_KICK: 0.55,     // upward kick added when a rider lets go
    IDLE_DAMPING: 0.28,     // unoccupied rope settles
    ATTACHED_DAMPING: 0.16, // occupied rope loses less
    BRAKE_DAMPING: 9,       // holding the brake bleeds the swing
    BRAKE_YAW_RATE: 1.6,    // side input rotates the swing plane while braking
    BRAKE_LENGTH_RATE: 0.9, // forward/back input shortens/lengthens while braking
    LIMIT_BOUNCE: 0.72,     // omega kept after reaching MAX_ANGLE
    BLOCK_BOUNCE: -0.18,    // omega kept (reversed) after hitting something
  });

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const clonePoint = p => ({ x: p.x, y: p.y, z: p.z });

  function bobAt(rope, angle = rope.angle) {
    const dirX = Math.cos(rope.yaw), dirZ = Math.sin(rope.yaw), horizontal = Math.sin(angle) * rope.length;
    return { x: rope.anchor.x + dirX * horizontal, z: rope.anchor.z + dirZ * horizontal, y: rope.anchor.y - Math.cos(angle) * rope.length };
  }

  // Movement intent relative to the swing plane. input: { strength, x, z } already camera-resolved
  // (x/z are the published movement vector); with `velocityFallback` ({ vx, vz }, world units/s) the
  // approach momentum is used on the one frame an auto-grab happens before input is published.
  function intent(rope, input = {}, velocityFallback = null) {
    const strength = clamp(Number(input.strength) || 0, 0, 1);
    const rawX = Number(input.x) || 0, rawZ = Number(input.z) || 0, rawLength = Math.hypot(rawX, rawZ);
    let ix = rawLength > 0.001 ? rawX / rawLength * strength : 0;
    let iz = rawLength > 0.001 ? rawZ / rawLength * strength : 0;
    if (velocityFallback && strength <= 0.001) {
      const vx = Number(velocityFallback.vx) || 0, vz = Number(velocityFallback.vz) || 0, speed = Math.hypot(vx, vz);
      if (speed > 0.001) { ix = vx / Math.max(3, speed); iz = vz / Math.max(3, speed); }
    }
    const dx = Math.cos(rope.yaw), dz = Math.sin(rope.yaw), sx = -dz, sz = dx;
    return { forward: clamp(ix * dx + iz * dz, -1, 1), side: clamp(ix * sx + iz * sz, -1, 1), strength: Math.min(1, Math.hypot(ix, iz)) };
  }

  // One step of an unoccupied rope. Returns the (safe) bob.
  function stepIdle(rope, dt, blocked) {
    const priorAngle = rope.angle;
    rope.omega += (-C.GRAVITY / Math.max(0.4, rope.length)) * Math.sin(rope.angle) * dt;
    rope.omega *= Math.exp(-C.IDLE_DAMPING * dt);
    rope.angle += rope.omega * dt;
    const candidate = bobAt(rope), from = rope.lastSafeBob || bobAt(rope, priorAngle);
    if (blocked?.(from, candidate)) { rope.angle = priorAngle; rope.omega *= C.BLOCK_BOUNCE; rope.collisionStops = (rope.collisionStops || 0) + 1; }
    return (rope.bob = bobAt(rope));
  }

  // One step of a rope someone is hanging on. `intent` from intent(). Returns { bob, blocked }.
  function stepAttached(rope, move, dt, blocked) {
    const priorAngle = rope.angle, priorYaw = rope.yaw, priorLength = rope.length;
    if (rope.braking) {
      rope.omega *= Math.exp(-C.BRAKE_DAMPING * dt);
      rope.yaw += move.side * C.BRAKE_YAW_RATE * dt;
      rope.length = Math.max(C.MIN_LENGTH, Math.min(rope.maxLength, rope.length - move.forward * C.BRAKE_LENGTH_RATE * dt));
    } else {
      if (move.forward * rope.omega > 0) rope.omega += move.forward * C.PUMP * dt; // Pump with the swing, not against it: height builds over several back-and-forth swings.
      rope.omega += (-C.GRAVITY / Math.max(0.4, rope.length)) * Math.sin(rope.angle) * dt;
      rope.omega *= Math.exp(-C.ATTACHED_DAMPING * dt);
      rope.angle += rope.omega * dt;
      if (Math.abs(rope.angle) > C.MAX_ANGLE) { rope.angle = Math.sign(rope.angle) * C.MAX_ANGLE; rope.omega *= C.LIMIT_BOUNCE; }
    }
    const candidate = bobAt(rope), from = rope.lastSafeBob || bobAt({ ...rope, angle: priorAngle, yaw: priorYaw, length: priorLength });
    const isBlocked = !!blocked?.(from, candidate);
    if (isBlocked) { rope.angle = priorAngle; rope.yaw = priorYaw; rope.length = priorLength; rope.omega *= C.BLOCK_BOUNCE; rope.collisionStops = (rope.collisionStops || 0) + 1; }
    return { bob: (rope.bob = bobAt(rope)), blocked: isBlocked };
  }

  // Where and how fast a rider leaves the rope: tangent velocity along the swing plane plus the release kick.
  function releaseFlight(rope, bob = bobAt(rope), kick = C.RELEASE_KICK) {
    const dirX = Math.cos(rope.yaw), dirZ = Math.sin(rope.yaw);
    const tangentSpeed = Math.cos(rope.angle) * rope.length * rope.omega;
    const verticalSpeed = Math.sin(rope.angle) * rope.length * rope.omega;
    return { x: bob.x, y: bob.y, z: bob.z, vx: dirX * tangentSpeed, vz: dirZ * tangentSpeed, vy: verticalSpeed + kick };
  }

  // A flyer at f ({x,y,z,vx,vy,vz}) takes hold of the rope where they are, their velocity turned into swing.
  function catchFromFlight(rope, f) {
    const dirX = Math.cos(rope.yaw), dirZ = Math.sin(rope.yaw);
    const horizontal = (f.x - rope.anchor.x) * dirX + (f.z - rope.anchor.z) * dirZ, drop = Math.max(0.05, rope.anchor.y - f.y);
    rope.length = Math.max(C.MIN_LENGTH, Math.min(rope.maxLength, Math.hypot(horizontal, drop)));
    rope.angle = Math.max(-C.MAX_ANGLE, Math.min(C.MAX_ANGLE, Math.atan2(horizontal, drop)));
    const along = f.vx * dirX + f.vz * dirZ;
    rope.omega = (along * Math.cos(rope.angle) + f.vy * Math.sin(rope.angle)) / rope.length;
    rope.braking = false;
    return rope;
  }

  // Smallest swing amplitude (radians) whose forward release reaches `reaches(point)`; used to validate layouts.
  // `simulateFlight(start)` is the host's own flight test (collision, landing), returning true on success.
  function reachAmplitude(rope, simulateFlight, { maxAmp = 1.2, minAmp = 0.6 } = {}) {
    const dirX = Math.cos(rope.yaw), dirZ = Math.sin(rope.yaw), L = rope.length;
    for (let amp = minAmp; amp <= maxAmp + 1e-6; amp += 0.05) {
      for (let i = 0; i <= 10; i++) {
        const theta = amp * (0.15 + 0.85 * i / 10);
        const omega = Math.sqrt(Math.max(0, 2 * (C.GRAVITY / L) * (Math.cos(theta) - Math.cos(amp))));
        const tangent = Math.cos(theta) * L * omega;
        const start = { x: rope.anchor.x + dirX * Math.sin(theta) * L, z: rope.anchor.z + dirZ * Math.sin(theta) * L, y: rope.anchor.y - Math.cos(theta) * L, vx: dirX * tangent, vz: dirZ * tangent, vy: Math.sin(theta) * L * omega + C.RELEASE_KICK };
        if (simulateFlight(start)) return +amp.toFixed(2);
      }
    }
    return null;
  }

  // A fresh rope object in the shared shape.
  function create({ anchor, yaw = 0, length = 3, maxLength = length, angle = 0 } = {}) {
    const L = Math.max(0.4, Number(length) || 3);
    return { anchor: { x: Number(anchor?.x) || 0, y: Number(anchor?.y) || 0, z: Number(anchor?.z) || 0 }, yaw: Number(yaw) || 0, length: L, maxLength: Math.max(L, Number(maxLength) || L),
      angle: Number(angle) || 0, omega: 0, braking: false, bob: null, lastSafeBob: null, collisionStops: 0 };
  }

  return Object.freeze({ C, ...C, bobAt, intent, stepIdle, stepAttached, releaseFlight, catchFromFlight, reachAmplitude, create, clonePoint });
});
