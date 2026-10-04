// Re-grounds outdoor (farm-area) furniture onto the live farm surface after
// a nearby building is built/moved/demolished, plus the matching debug view.
// Extracted from game.js; wired back via FarmFurnitureSurfaceElevation.init(deps)
// and still exposed as window.HobunjiFurnitureSurfaceElevation, which
// farm-building-elevation-parity.js and animal-subtle-elevation-bridge.js call.
//
// Wall-mounted furniture (farmhouse windows, wall torches) is skipped: its
// height is solved against the wall by WallOrnamentPlacement /
// HouseWindowLinkage, and dropping it to the ground height here lifted
// exterior windows ~0.4 above their brick opening.
(() => {
  'use strict';

  if (window.FarmFurnitureSurfaceElevation) return;

  let deps = null; // { interiorFurnitureObjects, processingFurnitureObjects, DECORATIVE_FURNITURE_DEFS, decorativeFurnitureSize, farmSurfaceYAtWorld }

  function wallMountedIds() {
    const placements = window.WallOrnamentPlacement?.getAllPlayerPlacements?.() || {}; // Read once per refresh instead of per object.
    return new Set(Object.keys(placements));
  }

  function decorCenter(obj) {
    const { fw, fd } = deps.decorativeFurnitureSize(obj.key, obj.rotYDeg || 0); // Current rotated footprint locates the real rendered anchor.
    return { x: obj.col + fw * 0.5, z: obj.row + fd * 0.5 };
  }

  function refresh() {
    if (!deps) return { decorative: 0, processing: 0, wallMounted: 0 };
    const mounted = wallMountedIds();
    let decorative = 0; // Count returned to runtime/mobile diagnostics after re-grounding existing outdoor decor.
    let wallMounted = 0; // Wall-solved objects left exactly where their wall placement put them.
    for (const obj of deps.interiorFurnitureObjects) {
      if (obj?.area !== 'farm' || !obj.mesh?.position) continue;
      if (mounted.has(obj.id)) { wallMounted++; continue; }
      const def = deps.DECORATIVE_FURNITURE_DEFS[obj.key];
      const { x, z } = decorCenter(obj); // Existing decor center resampled whenever the house/barn footprint changes.
      const surfaceY = deps.farmSurfaceYAtWorld(x, z); // New live surface after a nearby building move/build/demolish.
      obj.mesh.position.y = surfaceY;
      if (obj.light?.position) obj.light.position.y = surfaceY + (def?.light?.height || 0.6);
      decorative++;
    }
    let processing = 0; // Count returned with decorative so diagnostics cover both outdoor furniture registries.
    for (const obj of deps.processingFurnitureObjects) {
      if (!obj?.mesh?.position) continue;
      obj.mesh.position.y = deps.farmSurfaceYAtWorld(obj.col + 0.5, obj.row + 0.5);
      processing++;
    }
    return { decorative, processing, wallMounted };
  }

  function getDebug() {
    if (!deps) return null;
    const mounted = wallMountedIds();
    const decorate = obj => {
      const { x, z } = decorCenter(obj); // Debug point for comparing actual mesh Y with the shared farm surface.
      return { id: obj.id, key: obj.key, col: obj.col, row: obj.row, actualY: obj.mesh?.position?.y ?? null, targetY: mounted.has(obj.id) ? null : deps.farmSurfaceYAtWorld(x, z), wallMounted: mounted.has(obj.id) };
    };
    return {
      samplerReady: typeof window.HobunjiFarmSubtleElevation?.sampleHeightAt === 'function',
      decorative: deps.interiorFurnitureObjects.filter(obj => obj?.area === 'farm').map(decorate),
      processing: [...deps.processingFurnitureObjects].map(obj => ({
        id: obj.id, key: obj.furnitureKey, col: obj.col, row: obj.row,
        actualY: obj.mesh?.position?.y ?? null,
        targetY: deps.farmSurfaceYAtWorld(obj.col + 0.5, obj.row + 0.5),
      })),
    };
  }

  function init(injected) {
    deps = injected;
    window.HobunjiFurnitureSurfaceElevation = Object.freeze({
      surfaceYAt: deps.farmSurfaceYAtWorld,
      refresh,
      getDebug,
    });
  }

  window.FarmFurnitureSurfaceElevation = Object.freeze({ init, refresh, getDebug });
})();
