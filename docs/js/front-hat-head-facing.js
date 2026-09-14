// Legacy compatibility shim for the retired front-hat angle-facing adapter.
//
// Hats are authored portrait art and must not change visibility with camera yaw,
// head rotation, attack tilt, or body tilt. Keep this global only because older
// bootstraps probe it after loading this filename; it intentionally installs no
// renderer, shader, material, canvas, or avatar-build hooks.
(function (global) {
  'use strict';

  global.HobunjiFrontHatHeadFacing = Object.freeze({
    getDebug() {
      return {
        enabled: false,
        angleVisibility: 'disabled',
        mode: 'authored-portrait-only',
      };
    },
  });
})(window);
