(() => {
  'use strict';

  // Shared distance-based LOD primitives.
  //
  // Three independent systems each reimplemented the same two small pieces
  // of math: js/wilderness-simulation-lod.js (bandit sleep/wake), js/
  // wildlife-visual-lod.js (wildlife avatar/shadow hide/show), and now
  // game.js's updateNpcWalkers (off-screen NPC leg/wander suppression).
  // Pulling the shared math out here means a future LOD tier reuses tested
  // code instead of a fourth copy-pasted hysteresis check.

  // Two-threshold hysteresis: once far, stays far until distance drops to
  // nearThreshold or below; once near, stays near until distance reaches
  // farThreshold or beyond. nearThreshold should be strictly less than
  // farThreshold, or the entity will flicker every frame at one exact
  // distance instead of having a stable dead zone between the two.
  function isFar(currentlyFar, distanceTiles, nearThreshold, farThreshold) {
    return currentlyFar ? distanceTiles > nearThreshold : distanceTiles >= farThreshold;
  }

  // Reduced-tick-rate accumulator: advances an AI state machine at
  // 1/intervalS Hz instead of every render frame, by skipping frames until
  // enough real time has accumulated, then ticking once with that whole
  // elapsed span (capped at maxCatchUpS so a long stall/background-tab pause
  // can't hand the state machine an enormous single step). previousAccum is
  // read from and remainingAccum written back to whatever field the caller
  // is using to persist it between frames (no shared/mutated state here, so
  // this has no per-entity bookkeeping of its own).
  function accumulateTick(previousAccum, dt, intervalS, maxCatchUpS = 0.6) {
    const accum = (previousAccum || 0) + Math.max(0, Number(dt) || 0);
    if (accum < intervalS) return { shouldTick: false, remainingAccum: accum, elapsedS: 0 };
    return { shouldTick: true, remainingAccum: 0, elapsedS: Math.min(maxCatchUpS, accum) };
  }

  window.EntityDistanceLod = Object.freeze({ isFar, accumulateTick });
})();
