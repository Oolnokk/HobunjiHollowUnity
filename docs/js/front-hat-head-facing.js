// Front headwear now follows the normal portrait plane visibility only.
//
// Older builds replaced front portrait pixels with a hatless texture according
// to camera/head yaw. That made hats, hood trim, and the same cosmetics on NPCs
// appear to fade/pop in as the camera rotated toward them. The renderer already
// owns front/back plane visibility, so this adapter deliberately does not add a
// second camera-facing visibility system.
(function (global) {
  'use strict';

  global.HobunjiFrontHatHeadFacing = Object.freeze({
    getDebug() {
      return {
        enabled: false,
        cameraFacingVisibility: false,
        transition: 'disabled',
        visibilityOwner: 'normal portrait front/back renderer',
      };
    },
  });
})(window);
