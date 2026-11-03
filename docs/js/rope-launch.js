// RopeLaunch — predicts what a struck rope does to a burden hanging on it: whether it is dropped or
// launched, and where it lands. It is the same sequence the game runs, in the same arithmetic:
//   1. the strike sets the rope swinging (HangingRopes.applyStrike),
//   2. the rope is stepped by RopeCore.stepIdle at the original rope's frame granularity,
//   3. the burden is released at the forward apex (drop) or past the detach angle (launch)
//      with RopeCore.releaseFlight (HangingRopes.advance / release),
//   4. it flies on Shattercasks' shared fall arc (gravity 13, ground re-resolved each step).
// Layout solvers use it to decide, before anything is placed, whether a rope can put a bomb where a
// goal needs it, and how forgiving that is. test-rope-launch.js checks it against the real modules.
//
// Pure math; runs under node and in the browser.
(function (root, factory) {
  const rc = typeof module === 'object' && module.exports ? require('./rope-core.js') : root.RopeCore;
  const api = factory(rc);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RopeLaunch = api;
})(typeof self !== 'undefined' ? self : globalThis, function (RC) {
  'use strict';

  const DEFAULTS = Object.freeze({
    detachAngleRad: 0.85,  // HangingRopes.CONFIG.detachAngleRad
    releaseKick: RC.RELEASE_KICK,
    maxStep: 0.05,         // HangingRopes.CONFIG.maxStep
    flightGravity: 13,     // Shattercasks.updateBurdenFalls
    flightStep: 0.05,      // Shattercasks.tick frame step used by its tests; the arc is insensitive to it
    restHeight: 0.30,      // height above the ground a landed burden rests at (a witch bomb uses 0.45)
    maxSwingSeconds: 12,
    maxFlightSeconds: 12,
  });

  // The strike speed -> lunge fraction mapping lives in HangingRopes.strikeSpeed; these mirror its config.
  const STRIKE = Object.freeze({ referenceLungeWorld: 1.6, minSpeed: 0.9, maxSpeed: 9.5 });
  const strikeSpeedForFraction = (fraction, strike = STRIKE) => strike.minSpeed + (strike.maxSpeed - strike.minSpeed) * Math.max(0, Math.min(1, fraction));
  const fractionForSpeed = (speed, strike = STRIKE) => (speed - strike.minSpeed) / (strike.maxSpeed - strike.minSpeed);

  const groundFn = g => (typeof g === 'function' ? g : () => (Number.isFinite(Number(g)) ? Number(g) : 0));

  // options: { anchor:{x,y,z}, length, dirX, dirZ (strike direction, away from the attacker), speed (units/s),
  //            groundAt: number | (x,z)=>y, blocked?:(from,to)=>bool, ...DEFAULTS overrides }
  function predict(options) {
    const o = { ...DEFAULTS, ...options }, ground = groundFn(o.groundAt);
    const rope = RC.create({ anchor: o.anchor, yaw: Math.atan2(o.dirZ, o.dirX), length: o.length });
    rope.bob = RC.bobAt(rope); rope.lastSafeBob = RC.clonePoint(rope.bob);
    rope.omega = o.speed / rope.length; // a rope at rest takes the strike direction as its plane (HangingRopes.applyStrike)
    let prevOut = rope.omega, release = null, mode = null;
    for (let t = 0; t < o.maxSwingSeconds && !release; t += o.maxStep) {
      RC.stepIdle(rope, o.maxStep, o.blocked); rope.lastSafeBob = RC.clonePoint(rope.bob);
      const out = rope.omega; // outSign is +1: the plane points along the strike
      if (out > 0 && Math.abs(rope.angle) >= o.detachAngleRad) mode = 'launch';
      else if (prevOut > 0 && out <= 0) mode = 'drop';
      else { prevOut = out; continue; }
      const f = RC.releaseFlight(rope, rope.bob, o.releaseKick);
      release = { ...f, angle: rope.angle, omega: rope.omega, swingSeconds: +t.toFixed(3) };
    }
    if (!release) return { mode: null, release: null, landing: null };
    // ballistic flight on the shared fall arc
    let { x, y, z, vx, vy, vz } = release, landing = null;
    for (let t = 0; t < o.maxFlightSeconds; t += o.flightStep) {
      const dt = o.flightStep; vy -= o.flightGravity * dt;
      const endX = x + vx * dt, endZ = z + vz * dt, groundY = ground(endX, endZ) + o.restHeight, nextY = y + vy * dt;
      x = endX; z = endZ; y = Math.max(groundY, nextY);
      if (nextY <= groundY + 0.002) { landing = { x, y, z, t: +(t + dt).toFixed(3) }; break; }
    }
    const horizontal = landing ? Math.hypot(landing.x - o.anchor.x, landing.z - o.anchor.z) : null;
    return { mode, release, landing, distanceFromAnchor: horizontal === null ? null : +horizontal.toFixed(3) };
  }

  // Landing points for lunge fractions 0..1 along one strike direction: the range a rope can reach.
  function sweep(options, { steps = 24, strike = STRIKE } = {}) {
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const fraction = i / steps, speed = strikeSpeedForFraction(fraction, strike), r = predict({ ...options, speed });
      out.push({ fraction, speed: +speed.toFixed(3), mode: r.mode, landing: r.landing });
    }
    return out;
  }

  // How forgiving it is to land within `radius` of `target`: the widest contiguous range of lunge fractions whose
  // landing is within it (a skill window; 0 = impossible, 1 = any strike works), plus the best single miss distance.
  function window(options, target, radius, { steps = 48, strike = STRIKE } = {}) {
    const pts = sweep(options, { steps, strike });
    let best = 0, run = 0, runStart = null, bestRange = null, bestMiss = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], miss = p.landing ? Math.hypot(p.landing.x - target.x, p.landing.z - target.z) : Infinity;
      bestMiss = Math.min(bestMiss, miss);
      if (miss <= radius) { if (run === 0) runStart = pts[i].fraction; run++; const width = (pts[i].fraction - runStart) + 1 / steps; if (width > best) { best = width; bestRange = [runStart, pts[i].fraction]; } }
      else run = 0;
    }
    return { width: +Math.min(1, best).toFixed(3), range: bestRange, bestMiss: Number.isFinite(bestMiss) ? +bestMiss.toFixed(3) : null };
  }

  return Object.freeze({ DEFAULTS, STRIKE, strikeSpeedForFraction, fractionForSpeed, predict, sweep, window });
});
