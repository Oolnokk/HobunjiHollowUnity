// Sub-stepped, per-axis sliding move shared by the player (dodge/lunge),
// creature forced movement and knockback. Extracted from game.js; game.js
// calls SweptMove.init({ stepPx }) once with its tile-derived step size.
(() => {
  'use strict';

  let stepPx = 55 * 0.25; // Overwritten by init() with game.js's TILE * 0.25.

  // A fast forced move (combat lunge, knockback, dodge) recomputes its
  // target position from total elapsed progress every frame rather than
  // stepping a small fixed distance, so a single frame's jump can easily
  // exceed one tile — e.g. Charged Breaker's ~7-tile lunge covers most of
  // its distance in its very first frames (ease-out is fastest at t=0).
  // Testing occupancy only at that frame's endpoint lets it tunnel clean
  // through a one-tile-thick solid wall (a plateau's incline face)
  // instead of stopping at it. Subdividing the straight line from the
  // current position to the desired one into small steps and testing
  // each one — same per-axis sliding behavior as a single check, just
  // repeated — closes that gap for any of these forced moves.
  // blockedX/blockedY report whether that axis was ever rejected during
  // the sweep, so a caller (e.g. knockback) can zero out that axis's
  // velocity exactly like the old single-check version did.
  function sweptMove(curX, curY, desiredX, desiredY, canOccupyFn, stopOnBlock = false) {
    const dx = desiredX - curX, dy = desiredY - curY;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.001) return { x: curX, y: curY, blockedX: false, blockedY: false, blockedAt: null };
    const steps = Math.max(1, Math.ceil(dist / stepPx));
    const stepX = dx / steps, stepY = dy / steps;
    let x = curX, y = curY, blockedX = false, blockedY = false;
    let blockedAt = null; // First rejected center position; forced-movement collision uses it to classify the actual obstacle.
    for (let i = 0; i < steps; i++) {
      const nx = x + stepX, ny = y + stepY;
      if (canOccupyFn(nx, y)) x = nx;
      else {
        blockedX = true;
        if (!blockedAt) blockedAt = { x: nx, y };
        if (stopOnBlock) break;
      }
      if (canOccupyFn(x, ny)) y = ny;
      else {
        blockedY = true;
        if (!blockedAt) blockedAt = { x, y: ny };
        if (stopOnBlock) break;
      }
    }
    return { x, y, blockedX, blockedY, blockedAt };
  }

  window.SweptMove = Object.freeze({
    init(deps = {}) {
      if (Number(deps.stepPx) > 0) stepPx = Number(deps.stepPx);
    },
    sweptMove,
  });
})();
