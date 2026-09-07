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

  function visualHeight(col, row) {
    const map = deps?.getTownZone?.(); // Current town map supplying optional subtle visual-height data.
    const terrain = window.TerrainPreview; // Shared terrain height sampler used by town buildings.
    if (!map || !terrain?.sampleVisualHeight) return 0;
    const cols = Math.max(1, Number(map.cols) || 1); // Used to normalize the sample coordinate.
    const rows = Math.max(1, Number(map.rows) || 1); // Used to normalize the sample coordinate.
    return terrain.sampleVisualHeight(map.visualHeights || {}, Number(col) + 0.5, Number(row) + 0.5, cols, rows) || 0;
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
    const y = Number(deps.NORMAL_TOP || 0) + visualHeight(record.col, record.row); // Matches town terrain's subtle visual height at the sign tile.
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
    deps.debugLog?.(`[town signs] built ${liveGroups.length} editable authored sign placements`);
    return liveGroups;
  }

  const originalInit = namespace.init; // Preserved so dependency injection remains unchanged after capturing it for sign placement.
  namespace.init = function townSignFurnitureInit(injectedDeps) {
    deps = injectedDeps;
    return originalInit.call(this, injectedDeps);
  };

  const originalSpawnTownBuildings = namespace.spawnTownBuildings; // Preserved so normal buildings spawn first, then static signs are refreshed.
  namespace.spawnTownBuildings = function spawnTownBuildingsWithSigns(...args) {
    const result = originalSpawnTownBuildings.apply(this, args);
    rebuild();
    return result;
  };

  window.TownSignFurnitureRuntime = {
    installed: true,
    rebuild,
    clear,
    get placements() { return JSON.parse(JSON.stringify(config.placements || [])); },
    get liveGroups() { return [...liveGroups]; },
  };
})();
