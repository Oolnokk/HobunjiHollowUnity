(() => {
  'use strict';

  // Central registry for positional fake-light sources. PointLights remain as
  // compact world-space data holders (position/distance/intensity/color), but
  // are moved to a layer gameplay cameras never render so they cannot shade
  // Three.js materials. WeatherFX/CloudForestFog consumes that same data for
  // the shared 2D darkness/light compositor.
  const OVERLAY_ONLY_LIGHT_LAYER = 31; // Used by every registered/constructed PointLight so local lighting stays out of WebGLRenderer's light list.
  const lights = []; // Registered point-light data sources scanned by list() instead of traversing the active scene.
  let routedToOverlay = 0; // Mobile/debug count of point lights removed from Three.js rendering by this registry.
  let constructorBridgeInstalled = false; // Debug flag proving future PointLights are automatically converted to fake-overlay sources.

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
    if (light.userData?.furnitureLightMask == null) light.userData.furnitureLightMask = true; // Legacy point lights become fake local-light masks unless a creator explicitly opts out after construction.
    if (!lights.includes(light)) lights.push(light);
    return light;
  }

  function installPointLightConstructorBridge() {
    const THREE = window.THREE;
    const OriginalPointLight = THREE?.PointLight;
    if (!OriginalPointLight) return false;
    if (OriginalPointLight.__hobunjiOverlayOnlyBridge) {
      constructorBridgeInstalled = true;
      return true;
    }
    function OverlayOnlyPointLight(...args) {
      const light = new OriginalPointLight(...args);
      register(light); // Constructor-level registration covers camps, cave clouds, color pools, wall torches, ruin effects, and GLTF punctual point lights without per-feature branches.
      return light;
    }
    Object.setPrototypeOf(OverlayOnlyPointLight, OriginalPointLight);
    OverlayOnlyPointLight.prototype = OriginalPointLight.prototype;
    OverlayOnlyPointLight.__hobunjiOverlayOnlyBridge = true;
    OverlayOnlyPointLight.__hobunjiOverlayOnlyOriginal = OriginalPointLight;
    THREE.PointLight = OverlayOnlyPointLight;
    constructorBridgeInstalled = true;
    return true;
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

  installPointLightConstructorBridge();

  window.FurnitureLightRegistry = {
    register,
    list,
    makeOverlayOnly,
    installPointLightConstructorBridge,
    OVERLAY_ONLY_LIGHT_LAYER,
    debugSnapshot: () => ({ registered: lights.length, routedToOverlay, constructorBridgeInstalled }),
  };
})();
