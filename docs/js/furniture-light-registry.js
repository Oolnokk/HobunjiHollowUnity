(() => {
  'use strict';

  // Central registry for positional fake-light sources. PointLights remain as
  // compact world-space data holders (position/distance/intensity/color), but
  // register() moves them to a layer gameplay cameras never render so they
  // cannot shade Three.js materials. WeatherFX/CloudForestFog then consumes
  // that same data for the shared 2D darkness/light compositor.
  //
  // Pruning is lazy and lifecycle-agnostic: an entry is dropped only once
  // its light is no longer attached to any THREE.Scene at all (its root
  // has no .parent and isn't itself a Scene). A light in another persistent
  // area scene stays registered until that scene/object is actually removed.
  const OVERLAY_ONLY_LIGHT_LAYER = 31; // Used by register() to retain light-source metadata without allowing real WebGL lighting.
  const lights = []; // Registered point-light data sources scanned by list() instead of traversing the active scene.
  let routedToOverlay = 0; // Mobile/debug count of point lights removed from Three.js rendering by this registry.

  function makeOverlayOnly(light) {
    if (!light?.isPointLight) return light;
    light.layers?.set?.(OVERLAY_ONLY_LIGHT_LAYER);
    light.castShadow = false;
    light.userData = light.userData || {};
    if (!light.userData.overlayOnlyLightSource) {
      light.userData.overlayOnlyLightSource = true;
      routedToOverlay += 1;
    }
    return light;
  }

  function register(light) {
    if (!light?.isPointLight) return light;
    makeOverlayOnly(light);
    if (!lights.includes(light)) lights.push(light);
    return light;
  }

  function list(activeScene) {
    let writeIdx = 0;
    const alive = [];
    for (let i = 0; i < lights.length; i++) {
      const light = lights[i];
      let root = light;
      while (root.parent) root = root.parent;
      if (!root.isScene) continue; // Despawned -- drop from the registry for good.
      lights[writeIdx++] = light;
      if (root === activeScene && light.userData?.furnitureLightMask) alive.push(light);
    }
    lights.length = writeIdx;
    return alive;
  }

  window.FurnitureLightRegistry = {
    register,
    list,
    makeOverlayOnly,
    OVERLAY_ONLY_LIGHT_LAYER,
    debugSnapshot: () => ({ registered: lights.length, routedToOverlay }),
  };
})();
