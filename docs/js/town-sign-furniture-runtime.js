// Places editable authored business-sign furniture in Hobunji town from a small repo config.
(() => {
  'use strict';

  const THREE = window.THREE; // Used for sign yaw and optional runtime diagnostics.
  const namespace = window.TownZoneBuildings; // Wrapped at init/spawn so signs rebuild with the town scene.
  const config = window.HOBUNJI_TOWN_SIGN_FURNITURE_CONFIG; // Editable placement source in docs/config/town-sign-furniture-config.js.
  if (!THREE || !namespace?.init || !namespace?.spawnTownBuildings || !config) {
    window.TownSignFurnitureRuntime = { installed: false, reason: 'missing THREE/TownZoneBuildings/config' };
    return;
  }

  const DEG = Math.PI / 180;
  let deps = null; // TownZoneBuildings init dependencies used to build/place the same furniture visuals as normal world furniture.
  let liveGroups = []; // Sign groups currently attached to the active town scene.
  let postSubdivisionFrame = 0; // Pending next-frame rebuild; guarantees synchronous tile subdivision finishes before sign placement.

  function subtleVisualHeight(col, row) {
    const exact = window.HobunjiTownSubtleElevation?.sampleHeightAt; // Preferred live sampler after town terrain subdivision/displacement is established.
    if (typeof exact === 'function') return Number(exact(Number(col) + 0.5, Number(row) + 0.5)) || 0;
    const map = deps?.getTownZone?.(); // Fallback authored town map supplying sparse subtle visual-height data.
    const terrain = window.TerrainPreview; // Shared terrain height sampler used by town buildings.
    if (!map || !terrain?.sampleVisualHeight) return 0;
    const cols = Math.max(1, Number(map.cols) || 1); // Used to normalize the sample coordinate.
    const rows = Math.max(1, Number(map.rows) || 1); // Used to normalize the sample coordinate.
    return terrain.sampleVisualHeight(map.visualHeights || {}, Number(col) + 0.5, Number(row) + 0.5, cols, rows) || 0;
  }

  function floorSubdivisionDisplacement(col, row) {
    // Exact center-vertex hash from TerrainGeometry.makeFloorGeo's 2x2 top subdivision.
    // At a tile center local X/Z are zero, so the shared displacement keys are 2*tile+1.
    const kx = Math.round((Number(col) + 0.5) * 2) | 0;
    const kz = Math.round((Number(row) + 0.5) * 2) | 0;
    let h = (2166136261 ^ (kx * 374761393) ^ (kz * 668265263)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return (h / 4294967296 - 0.5) * 0.03;
  }

  function clear() {
    for (const group of liveGroups) {
      group.parent?.remove(group);
      group.traverse?.(object => {
        object.geometry?.dispose?.();
        for (const material of (Array.isArray(object.material) ? object.material : [object.material]).filter(Boolean)) material.dispose?.();
      });
    }
    liveGroups = [];
  }

  function markAfterAuthoredUpgrade(group, key) {
    const promise = window.AuthoredFurniture?.load?.(key); // Used to re-run outline/edge tagging after an async fallback upgrades to authored geometry.
    Promise.resolve(promise).then(() => {
      if (!group?.parent) return;
      deps?.markOutline?.(group);
      deps?.markFurnitureEdgeId?.(group);
    }).catch(() => {});
  }

  function buildPlacement(record) {
    const scene = deps?.getTownScene?.(); // Active town scene receiving this static furniture group.
    if (!scene || !record?.key || !Number.isFinite(Number(record.col)) || !Number.isFinite(Number(record.row))) return null;
    const group = deps.buildFurnitureVisual(record.key, 0x8b6540); // Uses normal procedural->authored live-upgrade path.
    const subdivisionY = floorSubdivisionDisplacement(record.col, record.row); // Exact subdivided tile-center lift applied before the furniture is attached.
    const y = Number(deps.NORMAL_TOP || 0) + subtleVisualHeight(record.col, record.row) + subdivisionY;
    group.position.set(Number(record.col) + 0.5, y, Number(record.row) + 0.5);
    group.rotation.y = (Number(record.rotYDeg) || 0) * DEG;
    group.name = `town_static_${record.key}_${record.id || 'sign'}`;
    group.userData = {
      ...(group.userData || {}),
      townStaticFurniture: true,
      townSignPlacementId: record.id || null,
      furnitureKey: record.key,
      buildingId: record.buildingId || null,
      placementConfig: 'docs/config/town-sign-furniture-config.js',
      postAim: record.postAim || null,
      tileSubdivisionApplied: true,
      tileSubdivisionCenterDisplacement: subdivisionY,
    };
    deps.markOutline?.(group);
    deps.markFurnitureEdgeId?.(group);
    scene.add(group);
    markAfterAuthoredUpgrade(group, record.key);
    return group;
  }

  function rebuild() {
    if (!deps) return [];
    clear();
    for (const record of config.placements || []) {
      const group = buildPlacement(record);
      if (group) liveGroups.push(group);
    }
    deps.debugLog?.(`[town signs] built ${liveGroups.length} editable authored sign placements after tile subdivision`);
    return liveGroups;
  }

  function rebuildAfterTileSubdivision() {
    const run = () => {
      postSubdivisionFrame = 0;
      rebuild();
    };
    if (typeof requestAnimationFrame === 'function') {
      if (postSubdivisionFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(postSubdivisionFrame);
      postSubdivisionFrame = requestAnimationFrame(run);
      return;
    }
    // Non-rendering test/tool environments still run after the current synchronous terrain-build stack.
    Promise.resolve().then(run);
  }

  const originalInit = namespace.init; // Preserved so dependency injection remains unchanged after capturing it for sign placement.
  namespace.init = function townSignFurnitureInit(injectedDeps) {
    deps = injectedDeps;
    return originalInit.call(this, injectedDeps);
  };

  const originalSpawnTownBuildings = namespace.spawnTownBuildings; // Preserved so normal buildings/terrain setup runs before static sign furniture is queued.
  namespace.spawnTownBuildings = function spawnTownBuildingsWithSigns(...args) {
    const result = originalSpawnTownBuildings.apply(this, args);
    rebuildAfterTileSubdivision();
    return result;
  };

  window.TownSignFurnitureRuntime = {
    installed: true,
    rebuild,
    rebuildAfterTileSubdivision,
    clear,
    floorSubdivisionDisplacement,
    get placements() { return JSON.parse(JSON.stringify(config.placements || [])); },
    get liveGroups() { return [...liveGroups]; },
  };
})();
