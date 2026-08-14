// Presentation-only transform for authored garlink/ongyums crop billboards.
//
// crop-sprite-art.js converts the two generic crop cubes into PNG planes while
// game.js continues to own their growth scale and tile position. This wrapper
// applies the requested billboard-only presentation immediately around render:
// half visual size, with the PNG's vertical center sitting on the soil surface.
(() => {
  'use strict';

  if (window.HobunjiCropBillboardPresentation) return;

  const PRESENTATION_SCALE = 0.5; // Used to halve only the planted garlink/ongyums billboard sprites; held/icon art is unaffected.
  const SURFACE_EPSILON = 0.02; // Matches game.js's generic crop cube lift above the tile surface so the billboard center can be returned to ground level.

  function isCropBillboard(mesh) {
    const key = mesh?.userData?.hobunjiCropSpriteKey; // Used to affect only meshes already converted by crop-sprite-art.js.
    return mesh?.isMesh && (key === 'garlink' || key === 'ongyums');
  }

  function prepare(scene) {
    const restore = []; // Used to restore game.js-owned transforms after the synchronous render call completes.
    scene?.traverse?.(mesh => {
      if (!isCropBillboard(mesh)) return;
      const gameScale = Number(mesh.scale?.y); // Used as the current growth size authored by game.js before presentation scaling.
      if (!Number.isFinite(gameScale)) return;

      restore.push({
        mesh,
        x: mesh.scale.x,
        y: mesh.scale.y,
        z: mesh.scale.z,
        positionY: mesh.position.y,
      });

      // Generic crop cubes are positioned at surface + size/2 + 0.02 (+ ripe
      // bob). Removing size/2 + 0.02 puts the billboard's CENTER on the soil,
      // so half of the authored root/bulb image is visibly submerged.
      mesh.position.y -= gameScale * 0.5 + SURFACE_EPSILON;
      mesh.scale.set(
        mesh.scale.x * PRESENTATION_SCALE,
        mesh.scale.y * PRESENTATION_SCALE,
        mesh.scale.z * PRESENTATION_SCALE,
      );
    });
    return restore;
  }

  function restoreTransforms(states) {
    for (const state of states) {
      if (!state.mesh) continue;
      state.mesh.scale.set(state.x, state.y, state.z);
      state.mesh.position.y = state.positionY;
    }
  }

  function installRenderHook() {
    const prototype = window.THREE?.WebGLRenderer?.prototype; // Used as the shared synchronous render boundary already made hookable by combat-config-loader.
    if (!prototype || prototype.__hobunjiCropBillboardPresentationHooked || typeof prototype.render !== 'function') return;
    const previousRender = prototype.render; // Used to preserve crop-sprite-art's facing/color hook and every earlier renderer wrapper.
    prototype.render = function cropBillboardPresentationRender(scene, camera, ...rest) {
      const states = prepare(scene);
      try {
        return previousRender.call(this, scene, camera, ...rest);
      } finally {
        restoreTransforms(states);
      }
    };
    prototype.__hobunjiCropBillboardPresentationHooked = true;
  }

  installRenderHook();

  window.HobunjiCropBillboardPresentation = {
    getScale: () => PRESENTATION_SCALE,
    getDebug: () => ({ scale: PRESENTATION_SCALE, surfaceEpsilon: SURFACE_EPSILON }),
  };
})();
