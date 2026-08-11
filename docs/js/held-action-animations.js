// Shared authored poses for held-item actions. The game runtime and the
// Tool / Attack Animation Editor both read this object so their defaults do
// not drift; an editor export can be copied back here after visual tuning.
(() => {
  'use strict';

  // Used by the runtime's drink playback and the editor's Drink preset.
  const drink = {
    version: 1,
    kind: 'hobunji_held_action_animation',
    name: 'Drink',
    style: 'drink',
    durationS: 0.95,
    windupFrac: 0.38,
    strikeFrac: 0.62,
    holdFrac: 0.78,
    poses: {
      neutral: { x: 0, y: 0, z: 0, pitch: 10.31, yaw: 0, roll: 0, bodyYaw: 0 },
      windup: { x: 0.10, y: 0.18, z: 0.02, pitch: -38, yaw: -12, roll: -8, bodyYaw: -6 },
      strike: { x: 0.12, y: 0.32, z: 0.04, pitch: -78, yaw: -15, roll: -10, bodyYaw: -8 },
    },
  };

  window.HeldActionAnimations = Object.freeze({ drink });
})();
