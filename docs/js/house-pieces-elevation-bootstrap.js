(() => {
  'use strict';

  if (window.__hobunjiHouseElevationBootstrapInstalled) return;
  window.__hobunjiHouseElevationBootstrapInstalled = true;

  const housePieces = window.HousePieces;
  if (!housePieces) {
    console.warn('[PlayerHouseElevation] HousePieces core was not loaded before the elevation bootstrap.');
    return;
  }

  let deps = null; // Captured HousePieces.init dependencies; used to sync live farm terrain and locate generated house meshes.
  let controller = null; // PlayerHouseElevation controller for the active farm/world.

  function _applyMeshElevation(mesh, y) {
    if (!mesh?.position) return;
    mesh.userData = mesh.userData || {};
    if (!Number.isFinite(mesh.userData.playerHouseElevationBaseY)) {
      mesh.userData.playerHouseElevationBaseY = Number(mesh.position.y) || 0;
    }
    mesh.position.y = mesh.userData.playerHouseElevationBaseY + y;
  }

  function _refreshHouseMeshElevation(extraGroups = []) {
    if (!deps || !controller) return;
    const y = controller.worldY();
    for (const entry of deps.getHousePieces?.() || []) _applyMeshElevation(entry?._mesh, y);
    for (const mesh of extraGroups) _applyMeshElevation(mesh, y);
  }

  function _newSceneGroups(before) {
    if (!deps?.scene || !before) return [];
    return deps.scene.children.filter(obj => !before.has(obj) && obj?.isGroup);
  }

  function _syncAfterMutation(before, force = false) {
    if (!controller) return;
    const newGroups = _newSceneGroups(before);
    controller.sync(force);
    _refreshHouseMeshElevation(newGroups);
  }

  const originalInit = housePieces.init;
  housePieces.init = function (injectedDeps) {
    deps = injectedDeps;
    const result = originalInit.call(this, injectedDeps);
    try {
      controller?.dispose?.();
      controller = window.PlayerHouseElevation.create({
        cols: deps.COLS,
        rows: deps.ROWS,
        scene: deps.scene,
        getGrid: deps.getGrid,
        getPieces: deps.getHousePieces,
        markTileDirty: deps.markTileDirty,
        recomputeWater: deps.recomputeWater,
        debugLog: deps.debugLog,
      });
      controller.sync(true);
      _refreshHouseMeshElevation();
    } catch (error) {
      controller = null;
      deps.debugLog?.(`Player house subtle elevation unavailable: ${error?.message || error}`, 'warn');
    }
    return result;
  };

  // HousePieces' internal mutation methods call private rebuild helpers, so
  // wrapping the public operation boundary is the least-coupled place to
  // recalculate the modular footprint and lift whatever meshes that rebuild
  // created. Roof/feature-only rebuilds hit controller.sync() too, but its
  // footprint fingerprint makes those terrain passes no-ops.
  const wrappedOperations = [
    'spawnEntry', 'seedStarter', 'placeDeed', 'build', 'demolish',
    'moveHouse', 'movePiece', 'rotatePiece', 'rotateRoofAxis',
    'placeFeature', 'removeFeatureAt', 'rebuildStructureMeshes', 'clearAll',
  ];
  for (const name of wrappedOperations) {
    const original = housePieces[name];
    if (typeof original !== 'function') continue;
    housePieces[name] = function (...args) {
      const before = deps?.scene ? new Set(deps.scene.children) : null;
      const result = original.apply(this, args);
      _syncAfterMutation(before);
      return result;
    };
  }

  function debugHouseElevation() {
    return controller?.debugSnapshot?.() || {
      footprintCells: 0,
      affectedCenters: 0,
      deformedTileCells: 0,
      worldY: 0,
      status: controller ? 'ready' : 'not-initialized',
    };
  }

  housePieces.debugHouseElevation = debugHouseElevation;
  window.__hobunjiHouseElevationDebug = debugHouseElevation;
})();
