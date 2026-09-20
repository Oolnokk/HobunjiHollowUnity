// Shared melee windup/strike spacing calibration.
//
// The calibration comes from the user-authored Forehand Swing comparison:
// old editor Forehand endpoint -> uploaded endpoint.  Authored attack positions
// are Mao'ao-relative; species/gender reach scaling still happens later around
// each avatar centroid, so this module must stay in canonical Mao'ao space.
//
// Two requirements are combined deliberately:
//   1) lift every offensive melee endpoint by the uploaded +0.17 local Y;
//   2) add the Forehand's measured character-local XY range increase while
//      keeping each attack on its own original ray from the character.
//
// Those constraints cannot all be satisfied by only adding +0.17 to the final
// Y coordinate: extending range along a ray also changes Y.  We therefore first
// apply the +0.17 lift (the intentional direction change), then extend along
// that lifted ray until the requested phase-specific total range is reached.
// X/Z are adjusted together so character-local depth is preserved.
(function (global) {
  'use strict';

  const MAO_AO_TOOL_BASE = Object.freeze({
    x: -0.2426,
    y: 0.4085,
  }); // Mao'ao/male scanned tool base from the editor/runtime transform dump used to author this calibration.

  const Y_LIFT = 0.17; // Uploaded Forehand windup/strike y (0.17) minus the original 0.00.

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

  // Convert an authored endpoint into the character-local horizontal/vertical
  // point the weapon holder reaches.  bodyYaw rotates the authored right/forward
  // plane; local Y is independent of that turn for ordinary melee attacks.
  function characterLocalPoint(raw = {}) {
    const bodyYaw = numberOrZero(raw.bodyYaw) * Math.PI / 180;
    const c = Math.cos(bodyYaw);
    const s = Math.sin(bodyYaw);
    const handX = MAO_AO_TOOL_BASE.x + numberOrZero(raw.x);
    const z = numberOrZero(raw.z);
    return {
      x: c * handX + s * z,
      y: MAO_AO_TOOL_BASE.y + numberOrZero(raw.y),
      z: -s * handX + c * z,
    };
  }

  function metrics(raw = {}) {
    const point = characterLocalPoint(raw);
    return {
      ...point,
      rangeXY: Math.hypot(point.x, point.y),
      directionDeg: Math.atan2(point.y, point.x) * 180 / Math.PI,
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
    windup: afterMetrics.windup.rangeXY - beforeMetrics.windup.rangeXY,
    strike: afterMetrics.strike.rangeXY - beforeMetrics.strike.rangeXY,
  });

  function adjustEndpoint(raw = {}, phase = 'windup') {
    const delta = phase === 'strike' ? RANGE_DELTA.strike : RANGE_DELTA.windup;
    const original = metrics(raw);
    const liftedY = original.y + Y_LIFT;
    const liftedRange = Math.hypot(original.x, liftedY);
    const targetRange = Math.max(0, original.rangeXY + delta);

    // Degenerate endpoint: if the lifted vector is exactly zero, choose +Y.
    const factor = liftedRange > 1e-12 ? targetRange / liftedRange : 0;
    const targetX = liftedRange > 1e-12 ? original.x * factor : 0;
    const targetY = liftedRange > 1e-12 ? liftedY * factor : targetRange;
    const projectedXDelta = targetX - original.x;

    // Changing authored x by c*d and z by s*d moves the projected character-
    // local X by exactly d while leaving projected local Z unchanged.
    const bodyYaw = numberOrZero(raw.bodyYaw) * Math.PI / 180;
    const c = Math.cos(bodyYaw);
    const s = Math.sin(bodyYaw);
    const adjusted = {
      ...raw,
      x: numberOrZero(raw.x) + c * projectedXDelta,
      y: targetY - MAO_AO_TOOL_BASE.y,
      z: numberOrZero(raw.z) + s * projectedXDelta,
    };
    return adjusted;
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
    characterLocalPoint,
    metrics,
    adjustEndpoint,
    adjustPoseSet,
  });
})(window);
