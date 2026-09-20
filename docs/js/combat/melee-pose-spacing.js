// Shared melee windup/strike spacing calibration.
//
// The user-authored Forehand comparison contains two independent changes:
//   1) vertical authored Y: 0.00 -> +0.17;
//   2) horizontal reach: its character-local ground-plane point moved farther
//      from the player.  Runtime Three.js uses X/Z for that horizontal plane
//      (the game's logical world X/Y).
//
// Every offensive melee endpoint therefore keeps its own ORIGINAL horizontal
// ray from the character, adds the Forehand-derived horizontal range delta,
// and then receives the exact +0.17 vertical Y lift.  BodyYaw may rotate the
// whole ray later, but rotation cannot change its radius, so calibration is
// performed in the pre-bodyYaw character-local frame.
(function (global) {
  'use strict';

  const MAO_AO_TOOL_BASE = Object.freeze({
    x: -0.2426,
  }); // Canonical Mao'ao/male scanned right-hand attach X used by the Forehand authoring session.

  const Y_LIFT = 0.17; // Uploaded Forehand windup/strike authored Y minus the original authored Y.

  const FOREHAND_BEFORE = Object.freeze({
    windup: Object.freeze({ x: 0, y: 0, z: 0.16, bodyYaw: -126.05 }),
    strike: Object.freeze({ x: 0, y: 0, z: 0.16, bodyYaw: 121.49 }),
  });
  const FOREHAND_AFTER = Object.freeze({
    windup: Object.freeze({ x: -0.48, y: 0.17, z: 0.16, bodyYaw: -126.05 }),
    strike: Object.freeze({ x: -0.48, y: 0.17, z: 0.16, bodyYaw: 121.49 }),
  });

  function numberOrZero(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function preYawHorizontalPoint(raw = {}) {
    return {
      x: MAO_AO_TOOL_BASE.x + numberOrZero(raw.x),
      z: numberOrZero(raw.z),
    };
  }

  function characterLocalPoint(raw = {}) {
    const p = preYawHorizontalPoint(raw);
    const bodyYaw = numberOrZero(raw.bodyYaw) * Math.PI / 180;
    const c = Math.cos(bodyYaw);
    const s = Math.sin(bodyYaw);
    return {
      x: c * p.x + s * p.z,
      y: numberOrZero(raw.y),
      z: -s * p.x + c * p.z,
    };
  }

  function metrics(raw = {}) {
    const pre = preYawHorizontalPoint(raw);
    const point = characterLocalPoint(raw);
    return {
      ...point,
      rangeXZ: Math.hypot(pre.x, pre.z),
      directionDeg: Math.atan2(pre.z, pre.x) * 180 / Math.PI,
      authoredY: numberOrZero(raw.y),
    };
  }

  const beforeMetrics = Object.freeze({
    windup: Object.freeze(metrics(FOREHAND_BEFORE.windup)),
    strike: Object.freeze(metrics(FOREHAND_BEFORE.strike)),
  });
  const afterMetrics = Object.freeze({
    windup: Object.freeze(metrics(FOREHAND_AFTER.windup)),
    strike: Object.freeze(metrics(FOREHAND_AFTER.strike)),
  });
  const RANGE_DELTA = Object.freeze({
    windup: afterMetrics.windup.rangeXZ - beforeMetrics.windup.rangeXZ,
    strike: afterMetrics.strike.rangeXZ - beforeMetrics.strike.rangeXZ,
  });

  function adjustEndpoint(raw = {}, phase = 'windup') {
    const delta = phase === 'strike' ? RANGE_DELTA.strike : RANGE_DELTA.windup;
    const original = preYawHorizontalPoint(raw);
    const originalRange = Math.hypot(original.x, original.z);
    const targetRange = Math.max(0, originalRange + delta);

    let targetX;
    let targetZ;
    if (originalRange > 1e-12) {
      const factor = targetRange / originalRange;
      targetX = original.x * factor;
      targetZ = original.z * factor;
    } else {
      // A truly centered weapon has no horizontal ray to preserve; use the
      // canonical hand side rather than inventing a Forehand-specific direction.
      targetX = MAO_AO_TOOL_BASE.x < 0 ? -targetRange : targetRange;
      targetZ = 0;
    }

    return {
      ...raw,
      x: targetX - MAO_AO_TOOL_BASE.x,
      y: numberOrZero(raw.y) + Y_LIFT,
      z: targetZ,
    };
  }

  function adjustPoseSet(pose = {}) {
    if (!pose || typeof pose !== 'object') return pose;
    return {
      ...pose,
      windup: adjustEndpoint(pose.windup || {}, 'windup'),
      strike: adjustEndpoint(pose.strike || {}, 'strike'),
    };
  }

  const calibration = Object.freeze({
    maoAoToolBase: MAO_AO_TOOL_BASE,
    yLift: Y_LIFT,
    forehandBefore: FOREHAND_BEFORE,
    forehandAfter: FOREHAND_AFTER,
    beforeMetrics,
    afterMetrics,
    rangeDelta: RANGE_DELTA,
  });

  global.MeleePoseSpacing = Object.freeze({
    calibration,
    preYawHorizontalPoint,
    characterLocalPoint,
    metrics,
    adjustEndpoint,
    adjustPoseSet,
  });
})(window);
