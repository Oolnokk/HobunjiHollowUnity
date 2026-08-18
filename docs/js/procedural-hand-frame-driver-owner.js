// Ensures the shared ProceduralHandFrameDriver is the sole owner of attaching
// procedural hand rigs for newly built avatars.
//
// ProceduralArmAnimation predates the frame driver and leaves a
// `proceduralHandPending` marker that its renderer hook may consume first. If
// that happens, the frame driver sees an existing rig and (correctly for the old
// compatibility path) drops its private pending record without managing it.
// Model scale still works through ProceduralArmAnimation's profile subscriber,
// but inverse handFromTool X/Y/Z/rotation does not because only the frame driver
// applies that transform. Clear only the legacy marker after the frame driver's
// wrapped builder has recorded its own private pending entry; the legacy Set will
// discard the now-markerless avatar on its next pass without creating a rig.
(function (global) {
  'use strict';

  const avatarApi = global.PNGPlaneAvatar;
  if (!avatarApi?.buildSinglePlaneAvatarModel) return;
  if (avatarApi.buildSinglePlaneAvatarModel.__hobunjiFrameDriverSoleOwnerWrapped) return;

  const originalBuild = avatarApi.buildSinglePlaneAvatarModel;
  const wrappedBuild = function frameDriverSoleOwnerBuild(THREE, sourceCanvas, options = {}) {
    const avatarRoot = originalBuild.call(this, THREE, sourceCanvas, options);
    if (avatarRoot?.userData?.proceduralHandPending) {
      delete avatarRoot.userData.proceduralHandPending;
    }
    return avatarRoot;
  };
  wrappedBuild.__hobunjiFrameDriverSoleOwnerWrapped = true;
  avatarApi.buildSinglePlaneAvatarModel = wrappedBuild;

  global.ProceduralHandRigOwnership = Object.freeze({ owner: 'ProceduralHandFrameDriver' });
})(window);
