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
      neutral: { x: 0, y: 0, z: -0.05, pitch: 10.31, yaw: 0, roll: 0, bodyYaw: 0 },
      windup: { x: 0.32, y: 0.21, z: 0.1, pitch: -114, yaw: 18, roll: -8, bodyYaw: 0 },
      strike: { x: 0.4, y: 0.4, z: 0.22, pitch: -180, yaw: 21, roll: 4, bodyYaw: 0 },
    },
  };

  window.HeldActionAnimations = Object.freeze({ drink });
})();
