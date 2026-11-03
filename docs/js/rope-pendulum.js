// RopePendulum — pure physics for a weight on a rope, plus the mapping from a melee
// lunge to a swing speed. No THREE, no DOM: runs under node and in the browser.
//
// A spherical pendulum (the bob can swing in any direction, so a strike from any side
// works and a second strike simply adds to the motion). The rope is a rigid length:
// each substep integrates gravity and drag, then projects the bob back onto the sphere
// around the anchor and removes the radial velocity.
//
//   const s = RopePendulum.create({ anchor: {x, y, z}, length: 2.4 });
//   RopePendulum.applyVelocity(s, { x: 3, y: 0, z: 0 });
//   RopePendulum.step(s, dt);          // s.px/py/pz is the bob, s.vx/vy/vz its velocity
//
// Units are world units (tiles) and seconds. Default gravity 8.2 matches the ruin rope
// traversal (js/dev-random-ruin-simple-puzzles.js ROPE_GRAVITY), so ropes feel the same.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RopePendulum = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const DEFAULTS = Object.freeze({ gravity: 8.2, damping: 0.25, maxSubstep: 1 / 120 });
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

  // The bob starts at rest straight below the anchor.
  function create(options = {}) {
    const a = options.anchor || {};
    const ax = num(a.x, 0), ay = num(a.y, 0), az = num(a.z, 0), length = Math.max(0.2, num(options.length, 2));
    return {
      ax, ay, az, length,
      gravity: num(options.gravity, DEFAULTS.gravity), damping: Math.max(0, num(options.damping, DEFAULTS.damping)),
      px: ax, py: ay - length, pz: az, vx: 0, vy: 0, vz: 0,
    };
  }

  function reset(s) { s.px = s.ax; s.py = s.ay - s.length; s.pz = s.az; s.vx = s.vy = s.vz = 0; return s; }

  // Re-seats the bob on the sphere and removes the velocity component along the rope (the rope cannot
  // stretch). `keepTangentialSpeed`, used by integration steps, then rescales the remaining tangential
  // velocity to that magnitude. Without it the projection bleeds a little speed every step (the bob moves
  // along a tangent, leaves the sphere, and the rotated radial part is discarded), and that drift grows
  // with speed. A velocity applied from outside (a strike) simply loses its radial part, like a real rope.
  function constrain(s, keepTangentialSpeed = 0) {
    let dx = s.px - s.ax, dy = s.py - s.ay, dz = s.pz - s.az;
    const d = Math.hypot(dx, dy, dz) || 1e-9, k = s.length / d;
    dx *= k; dy *= k; dz *= k;
    s.px = s.ax + dx; s.py = s.ay + dy; s.pz = s.az + dz;
    const nx = dx / s.length, ny = dy / s.length, nz = dz / s.length, radial = s.vx * nx + s.vy * ny + s.vz * nz;
    s.vx -= radial * nx; s.vy -= radial * ny; s.vz -= radial * nz;
    if (keepTangentialSpeed > 0) {
      const after = Math.hypot(s.vx, s.vy, s.vz);
      if (after > 1e-9) { const k2 = keepTangentialSpeed / after; s.vx *= k2; s.vy *= k2; s.vz *= k2; }
    }
  }

  // Speed of the part of the velocity that is tangent to the sphere at the bob's current position.
  function tangentialSpeed(s) {
    const nx = (s.px - s.ax) / s.length, ny = (s.py - s.ay) / s.length, nz = (s.pz - s.az) / s.length, radial = s.vx * nx + s.vy * ny + s.vz * nz;
    return Math.hypot(s.vx - radial * nx, s.vy - radial * ny, s.vz - radial * nz);
  }

  function step(s, dt, maxSubstep = DEFAULTS.maxSubstep) {
    const total = Math.max(0, Math.min(0.25, num(dt, 0)));
    if (total <= 0) return s;
    const n = Math.max(1, Math.ceil(total / maxSubstep)), h = total / n, drag = Math.max(0, 1 - s.damping * h);
    for (let i = 0; i < n; i++) {
      s.vy -= s.gravity * h;
      s.vx *= drag; s.vy *= drag; s.vz *= drag;
      const tangential = tangentialSpeed(s); // measured before the move: gravity's radial part is held by the rope, not converted to swing
      s.px += s.vx * h; s.py += s.vy * h; s.pz += s.vz * h;
      constrain(s, tangential);
    }
    return s;
  }

  // Adds a velocity to the bob (a strike). Only the part along the sphere survives, as with a real rope.
  function applyVelocity(s, v) {
    s.vx += num(v.x, 0); s.vy += num(v.y, 0); s.vz += num(v.z, 0);
    constrain(s);
    return s;
  }

  // Angle between the rope and straight down, in radians (0 = hanging, PI/2 = level with the anchor).
  const angle = s => Math.acos(Math.max(-1, Math.min(1, (s.ay - s.py) / s.length)));
  const speed = s => Math.hypot(s.vx, s.vy, s.vz);
  const horizontalSpeed = s => Math.hypot(s.vx, s.vz);
  // Displacement and velocity of the bob along a horizontal unit direction (dirX, dirZ), measured from the anchor.
  const along = (s, dirX, dirZ) => ({ displacement: (s.px - s.ax) * dirX + (s.pz - s.az) * dirZ, velocity: s.vx * dirX + s.vz * dirZ });
  // Total mechanical energy per unit mass relative to the rest position (for tests/diagnostics).
  const energy = s => 0.5 * speed(s) ** 2 + s.gravity * (s.py - (s.ay - s.length));

  // How fast a strike sets the bob moving, from how far the attacker lunged. A close hit stops the
  // lunge early (the target is already inside the attack cone), so little distance is spent and the
  // swing is small; a full lunge spends all of it and swings hard.
  const STRIKE_DEFAULTS = Object.freeze({ referenceLungeWorld: 1.6, minSpeed: 0.9, maxSpeed: 9.5, maxFraction: 1 });
  function strikeSpeed(lungeTraveledWorld, options = {}) {
    const o = { ...STRIKE_DEFAULTS, ...options };
    const fraction = Math.max(0, Math.min(o.maxFraction, num(lungeTraveledWorld, 0) / Math.max(0.01, o.referenceLungeWorld)));
    return o.minSpeed + (o.maxSpeed - o.minSpeed) * fraction;
  }

  return Object.freeze({ DEFAULTS, STRIKE_DEFAULTS, create, reset, step, applyVelocity, angle, speed, horizontalSpeed, along, energy, strikeSpeed });
});
