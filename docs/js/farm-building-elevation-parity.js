(() => {
  'use strict';

  // Barns share the farmhouse's subtle-elevation controller instead of
  // maintaining a second terrain-height system. The existing controller is
  // created with a union of modular-house rectangles + barn rectangles, so
  // their radius/falloff, terrain deformation, grass grounding, and tile
  // refresh behavior stay mathematically identical and overlapping halos
  // cannot stack twice.
  if (typeof window === 'undefined' || window.FarmBuildingElevationParity) return;
  const elevationApi = window.PlayerHouseElevation;
  if (!elevationApi || typeof elevationApi.create !== 'function') return;

  const originalCreate = elevationApi.create;
  const BASE_Y_KEY = 'farmBuildingSubtleElevationBaseY';

  elevationApi.create = function (injectedDeps) {
    const deps = injectedDeps || {};
    const getHousePieces = typeof deps.getPieces === 'function' ? deps.getPieces : () => [];
    const getFarmBuildings = typeof deps.getFarmBuildings === 'function' ? deps.getFarmBuildings : () => [];

    // PlayerHouseElevation already knows how to turn arbitrary rectangles into
    // one sparse footprint shape. Feeding it both collections makes barns use
    // the exact same 0.6 logical rise + one-tile authoring falloff as the house.
    const combinedDeps = {
      ...deps,
      getPieces: () => []
        .concat(getHousePieces() || [])
        .concat(getFarmBuildings() || []),
    };
    const controller = originalCreate.call(this, combinedDeps);
    const scene = deps.scene || null;

    function barnLift(entry) {
      const col = Number(entry?.col);
      const row = Number(entry?.row);
      const w = Number(entry?.w);
      const h = Number(entry?.h);
      if (![col, row, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return 0;
      return Number(controller.sampleWorldY?.(col + w * 0.5, row + h * 0.5)) || 0;
    }

    function applyBarnMeshElevation(entry) {
      const mesh = entry?._mesh;
      if (!mesh?.position) return false;
      mesh.userData = mesh.userData || {};
      if (!Number.isFinite(mesh.userData[BASE_Y_KEY])) {
        mesh.userData[BASE_Y_KEY] = Number(mesh.position.y) || 0;
      }
      const lift = barnLift(entry);
      mesh.position.y = mesh.userData[BASE_Y_KEY] + lift;
      return Math.abs(lift) > 1e-7;
    }

    function refreshBarnMeshes() {
      let elevated = 0;
      for (const entry of getFarmBuildings() || []) {
        if (applyBarnMeshElevation(entry)) elevated++;
      }
      return elevated;
    }

    function restoreBarnMeshes() {
      for (const entry of getFarmBuildings() || []) {
        const mesh = entry?._mesh;
        const baseY = mesh?.userData?.[BASE_Y_KEY];
        if (!mesh?.position || !Number.isFinite(baseY)) continue;
        mesh.position.y = baseY;
        delete mesh.userData[BASE_Y_KEY];
      }
    }

    const originalSync = controller.sync?.bind(controller);
    if (originalSync) {
      controller.sync = function (force = false) {
        const result = originalSync(force);
        refreshBarnMeshes();
        return result;
      };
    }

    // The existing bootstrap calls refreshGrassSuppression after barn
    // place/move/demolish operations. Turn that existing hook into a full
    // footprint sync now that barns participate in the elevation footprint.
    const originalRefreshGrass = controller.refreshGrassSuppression?.bind(controller);
    if (originalRefreshGrass && originalSync) {
      controller.refreshGrassSuppression = function (...args) {
        originalSync(false);
        refreshBarnMeshes();
        return originalRefreshGrass(...args);
      };
    }

    // Built barn meshes arrive asynchronously after their piece JSON loads;
    // foundation slabs are also added before spawnEntry assigns entry._mesh.
    // A microtask after scene.add catches both cases without coupling the barn
    // renderer back to this controller.
    if (scene && typeof scene.add === 'function') {
      const addBeforeBarnParity = scene.add;
      scene.add = function (...objects) {
        const result = addBeforeBarnParity.apply(this, objects);
        queueMicrotask(refreshBarnMeshes);
        return result;
      };
    }

    const originalDebug = controller.debugSnapshot?.bind(controller);
    if (originalDebug) {
      controller.debugSnapshot = function () {
        const buildings = getFarmBuildings() || [];
        return {
          ...originalDebug(),
          farmBuildingCount: buildings.length,
          farmBuildingMeshesElevated: buildings.reduce((n, entry) => n + (Math.abs(barnLift(entry)) > 1e-7 && entry?._mesh ? 1 : 0), 0),
        };
      };
    }

    const originalDispose = controller.dispose?.bind(controller);
    if (originalDispose) {
      controller.dispose = function () {
        restoreBarnMeshes();
        return originalDispose();
      };
    }

    controller.refreshFarmBuildingMeshElevation = refreshBarnMeshes;
    return controller;
  };

  window.FarmBuildingElevationParity = { installed: true };
})();
