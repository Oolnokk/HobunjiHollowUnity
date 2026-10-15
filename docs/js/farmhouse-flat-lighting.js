// Farmhouse + authored building interiors: overlay-only lighting.
//
// Ordinary building interiors render their Lambert walls/floor/furniture at a
// flat neutral baseline. Darkness, time-of-day color, window daylight, lanterns,
// and furniture/fire light all come from the shared 2D compositor instead of
// Three.js directional/local lighting.
//
// Existing PointLights stay in the scene as data for FurnitureLightRegistry and
// the overlay (position/distance/intensity/color), but all non-baseline Three.js
// lights are moved to a layer gameplay cameras never render.
(() => {
  'use strict';

  if (window.FarmhouseFlatLighting) return;

  const OVERLAY_ONLY_LIGHT_LAYER = 31; // Used below to keep legacy/local Three.js lights available as overlay data while excluding them from WebGL lighting.
  const BASELINE_LIGHT_NAME = 'hobunji_overlay_flat_baseline'; // Used below to identify the one neutral render-only ambient baseline that must remain visible to Lambert materials.
  const stats = { installed: false, installs: 0, authoredBuildingInstalls: 0, overlayOnlyLights: 0, lastMapId: null, lastError: null }; // Exposed below for mobile-friendly lighting diagnostics.
  let buildingSceneMap = null; // Captured from GridTileAccessors.init so authored building scene creation can be routed through the same flat-lighting path as the farmhouse.
  let isBuildingArea = () => false; // Captured from GridTileAccessors.init and used below to exclude dens/mines/caverns from ordinary-building routing.

  function protectBaselineIntensity(light) {
    try {
      Object.defineProperty(light, 'intensity', {
        configurable: true,
        enumerable: true,
        get: () => 1,
        set: () => {},
      });
    } catch {
      light.intensity = 1;
    }
  }

  function makeOverlayOnly(object) {
    object?.traverse?.(node => {
      if (!node?.isLight || node.userData?.overlayFlatBaseline || node.userData?.farmhouseOverlayOnlyLight) return;
      node.layers?.set?.(OVERLAY_ONLY_LIGHT_LAYER);
      node.castShadow = false;
      node.userData = node.userData || {};
      node.userData.farmhouseOverlayOnlyLight = true;
      stats.overlayOnlyLights += 1;
    });
  }

  function addNeutralBaseline(scene) {
    const THREE = window.THREE;
    if (!THREE?.AmbientLight || !scene?.add) return null;
    const existing = scene.getObjectByName?.(BASELINE_LIGHT_NAME);
    if (existing) return existing;
    const baseline = new THREE.AmbientLight(0xffffff, 1); // Used only to make lit materials display their authored albedo; all visible lighting/mood comes from the 2D overlay.
    baseline.name = BASELINE_LIGHT_NAME;
    baseline.userData = baseline.userData || {};
    baseline.userData.overlayFlatBaseline = true;
    protectBaselineIntensity(baseline); // Prevent legacy authored-lighting timers from turning the neutral baseline back into gameplay lighting.
    scene.add(baseline);
    return baseline;
  }

  function install(scene, _legacyLights = {}) {
    if (!scene || scene.userData?.farmhouseFlatLighting) return false;
    scene.userData = scene.userData || {};
    scene.userData.farmhouseFlatLighting = true;
    makeOverlayOnly(scene);
    addNeutralBaseline(scene);
    const originalAdd = scene.add.bind(scene); // Used below so furniture/hearth/GLTF lights added after initial scene construction are also excluded from WebGL lighting.
    scene.add = function farmhouseFlatLightingAdd(...objects) {
      const result = originalAdd(...objects);
      objects.forEach(makeOverlayOnly);
      return result;
    };
    stats.installed = true;
    stats.installs += 1;
    return true;
  }

  function installAuthoredBuilding(mapId, sceneRecord) {
    if (!sceneRecord?.scene || !isBuildingArea(mapId)) return Promise.resolve(false);
    const applyEnvironment = window.InteriorEnvironmentRuntime?.applyEnvironmentToScene; // Used below so legacy wall/environment metadata finishes before its lights are removed from the renderer.
    const environmentPass = typeof applyEnvironment === 'function'
      ? Promise.resolve(applyEnvironment(mapId, sceneRecord))
      : Promise.resolve(null);
    return environmentPass
      .catch(error => { stats.lastError = `${mapId}: ${String(error?.message || error)}`; })
      .then(() => {
        const changed = install(sceneRecord.scene);
        if (changed) stats.authoredBuildingInstalls += 1;
        stats.lastMapId = mapId;
        window.CloudForestFog?.refreshLightingOverlay?.(); // Makes the shared darkness/window/time-of-day compositor reflect the newly active flat building immediately.
        return changed;
      });
  }

  function hookBuildingSceneMap(map, buildingPredicate) {
    if (!map?.set || map.__hobunjiFlatBuildingLightingSetHook) return false;
    buildingSceneMap = map;
    if (typeof buildingPredicate === 'function') isBuildingArea = buildingPredicate;
    const originalSet = map.set.bind(map); // Preserves the environment/floor-style wrappers already installed on the same Map.
    map.set = function setBuildingSceneWithFlatLighting(mapId, sceneRecord) {
      const result = originalSet(mapId, sceneRecord);
      installAuthoredBuilding(mapId, sceneRecord);
      return result;
    };
    Object.defineProperty(map, '__hobunjiFlatBuildingLightingSetHook', { value: true, configurable: true });
    for (const [mapId, sceneRecord] of map.entries()) installAuthoredBuilding(mapId, sceneRecord);
    return true;
  }

  function wrapGridTileAccessorsInit() {
    const namespace = window.GridTileAccessors;
    if (!namespace?.init || namespace.__hobunjiFlatBuildingLightingInitHook) return false;
    const originalInit = namespace.init;
    namespace.init = function initWithFlatBuildingLighting(injectedDeps) {
      hookBuildingSceneMap(injectedDeps?._buildingScenes, injectedDeps?._isBuildingArea);
      return originalInit.call(this, injectedDeps);
    };
    namespace.__hobunjiFlatBuildingLightingInitHook = true;
    return true;
  }

  wrapGridTileAccessorsInit();
  const startedAt = performance.now(); // Used below for a bounded retry because dev/tool pages can load GridTileAccessors after this small module.
  const installTimer = setInterval(() => {
    if (wrapGridTileAccessorsInit() || performance.now() - startedAt > 5000) clearInterval(installTimer);
  }, 25);

  window.FarmhouseFlatLighting = {
    install,
    installAuthoredBuilding,
    makeOverlayOnly,
    OVERLAY_ONLY_LIGHT_LAYER,
    debugSnapshot: () => ({
      ...stats,
      buildingSceneMapHooked: !!buildingSceneMap?.__hobunjiFlatBuildingLightingSetHook,
      windowLightingAuthority: window.DaylightWindowRuntime?.version || null,
      overlayLightingAuthority: window.WeatherFX?.__singleFullDayLightingAuthority ? 'shared-2d' : 'legacy',
    }),
  };
})();
