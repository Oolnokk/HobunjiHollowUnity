// Farmhouse interior: overlay-only lighting.
//
// The farmhouse renders its Lambert walls/floor/furniture at flat full albedo
// (white ambient 1.0, no directional/fill shading) so the room never reads as
// Three.js lighting. All darkness and light comes from the 2D compositor in
// cloud-forest-fog.js: the enclosed darkness overlay, then positional lantern,
// furniture-light and daylight-window reveals.
//
// Furniture/hearth PointLights stay in the scene -- FurnitureLightRegistry and
// the overlay read their position/distance/intensity -- but are moved to a
// layer the camera never renders, so they no longer shade surfaces.
//
// game.js calls install(interiorScene, { ambient, key, fill }) once.
(() => {
  'use strict';

  if (window.FarmhouseFlatLighting) return;

  const OVERLAY_ONLY_LIGHT_LAYER = 31; // Unused by every camera/pass; keeps a light out of WebGLRenderer's light list.
  const stats = { installed: false, overlayOnlyLights: 0 };

  function makeOverlayOnly(object) {
    object?.traverse?.(node => {
      if (!node?.isPointLight || node.userData?.farmhouseOverlayOnlyLight) return;
      node.layers.set(OVERLAY_ONLY_LIGHT_LAYER);
      node.userData.farmhouseOverlayOnlyLight = true;
      stats.overlayOnlyLights += 1;
    });
  }

  function install(scene, lights = {}) {
    if (!scene || scene.userData?.farmhouseFlatLighting) return false;
    scene.userData.farmhouseFlatLighting = true;
    if (lights.ambient) { lights.ambient.color.set(0xffffff); lights.ambient.intensity = 1; }
    if (lights.key) lights.key.intensity = 0;
    if (lights.fill) lights.fill.intensity = 0;
    makeOverlayOnly(scene);
    const originalAdd = scene.add.bind(scene); // Every later furniture/hearth light enters through scene.add.
    scene.add = function farmhouseFlatLightingAdd(...objects) {
      const result = originalAdd(...objects);
      objects.forEach(makeOverlayOnly);
      return result;
    };
    stats.installed = true;
    return true;
  }

  window.FarmhouseFlatLighting = {
    install,
    OVERLAY_ONLY_LIGHT_LAYER,
    debugSnapshot: () => ({ ...stats }),
  };
})();
