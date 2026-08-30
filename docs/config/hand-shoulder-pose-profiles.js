// Explicit shoulder-compass choices for the currently committed held-item actions.
// These are animation choices, not species/model choices. Neutral is the idle endpoint
// (Pitch + Roll); active motion endpoints use Roll only. The hand runtime interpolates
// the boolean endpoints as 0..1 weights with the same pose timeline.
(function (global) {
  'use strict';

  const idle = () => ({ pitch: true, yaw: false, roll: true });
  const active = () => ({ pitch: false, yaw: false, roll: true });
  const standard = () => ({
    neutral: { shoulderAim: idle() },
    windup: { shoulderAim: active() },
    strike: { shoulderAim: active() },
  });

  // Keep each action as its own entry even where values are intentionally equal;
  // future tuning can change one animation without silently changing the others.
  const profiles = {
    'melee:thrust': standard(),
    'melee:chop': standard(),
    'melee:sweep': standard(),
    'ranged:crossbow:load': standard(),
    'ranged:crossbow:fire': standard(),
    'ranged:scatterbow:load': standard(),
    'ranged:scatterbow:fire': standard(),
    'held:drink': standard(),
  };

  global.HOBUNJI_HAND_SHOULDER_POSE_PROFILES = Object.freeze(profiles);
  global.HobunjiHandShoulderPoseProfiles = Object.freeze({
    idle: Object.freeze(idle()),
    active: Object.freeze(active()),
    profiles: global.HOBUNJI_HAND_SHOULDER_POSE_PROFILES,
    forKey(key) { return profiles[String(key || '')] || null; },
  });
})(window);
