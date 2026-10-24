// Camera-less Sprite raycast guard.
//
// three.js r128's Sprite.raycast needs raycaster.camera (only set by
// Raycaster.setFromCamera) to orient the camera-facing quad. Ray-based casts
// built with Raycaster.set()/the constructor (camera boom occlusion, auto-
// target sight lines, den/shattercask probes) recurse into obstacle groups
// that can contain Sprite children (glows, smoke, labels). r128 then logs
// '"Raycaster.camera" needs to be set' and throws a TypeError on
// raycaster.camera.matrixWorld - every ray, every frame, which tanked FPS.
// A camera-facing billboard has no meaningful hit for a world-space ray, so
// those casts now skip sprites; screen-picking casts (setFromCamera) are
// unchanged. Wraps the library method because three.min.js is vendored from
// a CDN and can't be edited.
(() => {
  'use strict';
  const proto = window.THREE?.Sprite?.prototype;
  if (!proto || proto.raycast?.__hobunjiCameraGuard) return;
  const original = proto.raycast;
  const guarded = function raycast(raycaster, intersects) {
    if (!raycaster?.camera) return;
    return original.call(this, raycaster, intersects);
  };
  guarded.__hobunjiCameraGuard = true;
  proto.raycast = guarded;
})();
