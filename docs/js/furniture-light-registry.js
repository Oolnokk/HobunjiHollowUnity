(() => {
  'use strict';

  // Central registry for positional fake-light sources. Point/Spot lights stay
  // available as compact world-space data holders (position/distance/intensity/
  // color), but are moved to a layer gameplay cameras never render so they
  // cannot shade Three.js materials. Sources that deliberately set
  // userData.furnitureLightMask are then consumed by WeatherFX/CloudForestFog
  // as fake 2D light pools.
  const OVERLAY_ONLY_LIGHT_LAYER = 31; // Used by every constructed local light so local lighting stays out of WebGLRenderer's light list.
  const lights = []; // Registered local-light data sources scanned by list() instead of traversing the active scene.
  let routedToOverlay = 0; // Mobile/debug count of local lights removed from Three.js rendering by this registry.
  const bridgedConstructors = new Set(); // Debug set proving PointLight/SpotLight construction is routed away from WebGL lighting.

  function isLocalLight(light) {
    return !!(light?.isPointLight || light?.isSpotLight);
  }

  function makeOverlayOnly(light) {
    if (!isLocalLight(light)) return light;
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
    if (!isLocalLight(light)) return light;
    makeOverlayOnly(light);
    if (!lights.includes(light)) lights.push(light);
    return light;
  }

  function bridgeConstructor(name) {
    const THREE = window.THREE;
    const Original = THREE?.[name];
    if (!Original) return false;
    if (Original.__hobunjiOverlayOnlyBridge) {
      bridgedConstructors.add(name);
      return true;
    }
    function OverlayOnlyLocalLight(...args) {
      const light = new Original(...args);
      register(light); // Every local Three.js light is retained as data but removed from the renderer; creators opt into a visible fake pool with furnitureLightMask.
      return light;
    }
    Object.setPrototypeOf(OverlayOnlyLocalLight, Original);
    OverlayOnlyLocalLight.prototype = Original.prototype;
    OverlayOnlyLocalLight.__hobunjiOverlayOnlyBridge = true;
    OverlayOnlyLocalLight.__hobunjiOverlayOnlyOriginal = Original;
    THREE[name] = OverlayOnlyLocalLight;
    bridgedConstructors.add(name);
    return true;
  }

  function installLocalLightConstructorBridge() {
    const point = bridgeConstructor('PointLight');
    const spot = bridgeConstructor('SpotLight'); // GLTF punctual spot lights must obey the same fake-light-only rule even though current authored gameplay rarely uses them.
    return point || spot;
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

  installLocalLightConstructorBridge();

  window.FurnitureLightRegistry = {
    register,
    list,
    makeOverlayOnly,
    installLocalLightConstructorBridge,
    OVERLAY_ONLY_LIGHT_LAYER,
    debugSnapshot: () => ({ registered: lights.length, routedToOverlay, bridgedConstructors: [...bridgedConstructors] }),
  };
})();
