(() => {
  'use strict';

  if (window.FarmPathBricks?.installed) return;

  const FALLBACK_PATH_TILES = Object.freeze([
    [16,0],[17,0],[18,0],
    [16,1],[17,1],[18,1],
    [16,2],[17,2],[18,2],
    [16,3],[17,3],[18,3],
    [16,4],[17,4],[18,4],
  ]); // Used only as a visual paving mask when neither painted PATH tiles nor an authored farm route can provide one.
  const ENTRANCE_CENTER_X = 17.5; // Used to continue the farm road through the matching north-border cliff gap.
  const ENTRANCE_ROAD_HALF_WIDTH = 1.625; // Used to match TerrainGeometry's established 3.25-unit paved corridor width.
  const ENTRANCE_BORDER_DEPTH = 18; // Used to carry the road across the complete procedural farm border.
  const RETRY_DELAYS_MS = Object.freeze([0, 80, 220, 600, 1400, 3000]); // Used to bridge parser/init/layout ordering without adding a frame-loop task.
  const patchedApis = new WeakSet(); // Used to avoid wrapping the same module API twice.
  const grassSuppressionTiles = new Set(); // Used by VegetationCropRendering to omit grass blades beneath the current paved farm corridor.

  let terrainDeps = null; // Captured from TerrainGeometry.init; provides the existing path WallBuilder and exact tile enum.
  let vegetationDeps = null; // Captured from VegetationCropRendering.init; provides the current farm grid, scene, and dimensions.
  let farmEditorDeps = null; // Captured from FarmEditor.init; provides the live worldRoutes getter after layout import.
  let cachedLayoutRoutes = []; // Filled directly from loadFarmLayout so paving does not depend on worldRoutes assignment timing.
  let readyPromise = null; // Shared one-time recipe/GLB readiness promise for every farm paving rebuild.
  let buildToken = 0; // Invalidates finite delayed retries when a newer rebuild request supersedes them.

  const stats = {
    buildRequests: 0,
    successfulBuilds: 0,
    failedBuilds: 0,
    routeMaskBuilds: 0,
    fixedFallbackBuilds: 0,
    paintedPathBuilds: 0,
    visibleChunks: 0,
    visibleInstances: 0,
    grassSuppressedTiles: 0,
    lastMode: 'not-built',
    lastReason: '',
    lastRouteId: null,
    lastError: null,
  }; // Exposed through snapshot() for mobile-friendly diagnosis.

  function log(message, level = 'render') {
    const text = `[farm-path-bricks] ${message}`; // Shared prefix makes the built-in farm log searchable on mobile.
    if (typeof window.__farmLog === 'function') window.__farmLog(text, level);
    else (level === 'warn' ? console.warn : console.debug)(text);
  }

  function farmRoutes() {
    const live = farmEditorDeps?.getWorldRoutes?.(); // Preferred source because map-editor/world-load code may replace the array after initialization.
    const candidates = Array.isArray(live) && live.length ? live : cachedLayoutRoutes; // Saved-layout copy is the timing-safe fallback.
    return (Array.isArray(candidates) ? candidates : []).filter(route => (route?.area || 'farm') === 'farm' && Array.isArray(route?.nodes) && route.nodes.length >= 2);
  }

  function routeId(route) {
    return String(route?.id || route?.label || route?.name || 'farm-route'); // Used only in debug state/logging.
  }

  function selectEntranceRoute(routes) {
    const centerX = 17.5; // Historical farm entrance center (cols 16-18), used only to distinguish the town connector from unrelated patrol routes.
    let best = null; // Stores the lowest-scoring north-edge route candidate.
    for (const route of routes) {
      let northDistance = Infinity; // Measures how closely this route approaches the known north farm entrance.
      for (const node of route.nodes || []) {
        const x = Number(node?.[0]), z = Number(node?.[1]); // Converted once for finite checks and distance scoring.
        if (!Number.isFinite(x) || !Number.isFinite(z) || z > 5) continue;
        northDistance = Math.min(northDistance, Math.hypot((x + 0.5) - centerX, z));
      }
      if (!Number.isFinite(northDistance)) continue;
      const name = `${routeId(route)} ${route?.label || ''}`.toLowerCase(); // Adds a small tie-break preference for explicitly named travel connectors.
      const score = northDistance + (/town|entrance|entry|exit|connector/.test(name) ? -2 : 0); // Used only for selecting one route to pave when no PATH mask exists.
      if (!best || score < best.score) best = { route, score, northDistance };
    }
    if (best?.northDistance <= 6) return best.route;
    return routes.length === 1 ? routes[0] : null;
  }

  function cloneGridRows(grid) {
    return grid.map(row => Array.isArray(row) ? row.slice() : []); // Individual tile objects are cloned lazily only where the temporary paving mask touches them.
  }

  function markMaskTile(sourceGrid, maskedGrid, touched, col, row, cols, rows, pathType) {
    if (col < 0 || col >= cols || row < 0 || row >= rows) return;
    const key = `${col},${row}`; // Prevents cloning a masked tile more than once.
    if (touched.has(key)) return;
    touched.add(key);
    maskedGrid[row][col] = Object.assign({}, sourceGrid[row]?.[col] || {}, { type: pathType });
  }

  function routeMaskedGrid(grid, cols, rows, route) {
    const pathType = terrainDeps?.TileType?.PATH || 'path'; // Uses the production enum value without mutating the real farm grid.
    const masked = cloneGridRows(grid); // Temporary grid passed only to TerrainGeometry.preparePathSplineData.
    const touched = new Set(); // Tracks which temporary tiles have already been cloned.
    const nodes = (route?.nodes || []).map(node => [Number(node?.[0]), Number(node?.[1])]).filter(([x,z]) => Number.isFinite(x) && Number.isFinite(z)); // Normalized route polyline.
    if (nodes.length < 2) return null;
    for (let segment = 0; segment < nodes.length - 1; segment++) {
      const [ax, az] = nodes[segment], [bx, bz] = nodes[segment + 1]; // Current authored route segment used to rasterize the temporary 3-tile-wide mask.
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) * 4)); // Quarter-tile samples prevent gaps on diagonal segments.
      for (let step = 0; step <= steps; step++) {
        const t = step / steps; // Interpolates one sample along the route segment.
        const col = Math.floor(ax + (bx - ax) * t), row = Math.floor(az + (bz - az) * t); // Tile containing the current route sample.
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) markMaskTile(grid, masked, touched, col + dc, row + dr, cols, rows, pathType);
      }
    }
    return masked;
  }

  function fixedFallbackGrid(grid, cols, rows) {
    const pathType = terrainDeps?.TileType?.PATH || 'path'; // Same enum as production PATH tiles, but used only on this temporary clone.
    const masked = cloneGridRows(grid); // Temporary copy preserves save/gameplay terrain exactly.
    const touched = new Set(); // Reuses the same clone-on-touch helper as route mode.
    for (const [col, row] of FALLBACK_PATH_TILES) markMaskTile(grid, masked, touched, col, row, cols, rows, pathType);
    return masked;
  }

  function extendThroughNorthGap(splineData) {
    if (!splineData?.containsPoint || !splineData?.bounds) return splineData;
    const originalContainsPoint = splineData.containsPoint; // Preserves the authored or tile-locked road inside the playable farm.
    const originalBounds = splineData.bounds; // Preserves every existing road bound while adding the north-border continuation.
    return Object.assign({}, splineData, {
      containsPoint(x, z) {
        const insideEntranceRoad = z >= -ENTRANCE_BORDER_DEPTH && z <= 1
          && Math.abs(x - ENTRANCE_CENTER_X) <= ENTRANCE_ROAD_HALF_WIDTH;
        return insideEntranceRoad || originalContainsPoint(x, z);
      },
      bounds: Object.assign({}, originalBounds, {
        minX: Math.min(originalBounds.minX, ENTRANCE_CENTER_X - ENTRANCE_ROAD_HALF_WIDTH),
        maxX: Math.max(originalBounds.maxX, ENTRANCE_CENTER_X + ENTRANCE_ROAD_HALF_WIDTH),
        minZ: Math.min(originalBounds.minZ, -ENTRANCE_BORDER_DEPTH),
      }),
    });
  }

  function updateGrassSuppression(splineData, cols, rows) {
    grassSuppressionTiles.clear();
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      if (splineData.containsPoint(col + 0.5, row + 0.5)) grassSuppressionTiles.add(`${col},${row}`);
    }
    stats.grassSuppressedTiles = grassSuppressionTiles.size;
    window.VegetationCropRendering?.rebuildFarmBillboards?.();
  }

  function ensureReady() {
    if (readyPromise) return readyPromise;
    const builder = terrainDeps?.pathWallBuilder; // Existing TerrainGeometry-owned WallBuilder; no second paving renderer/cache is created.
    const recipeId = terrainDeps?.PATH_SURFACE_RECIPE_ID; // Exact production recipe registration key used by registerPathBrickChunks.
    if (!builder || !recipeId) return Promise.reject(new Error('TerrainGeometry path WallBuilder dependencies are not initialized'));
    readyPromise = Promise.all([
      builder.loadDefaultGlb(),
      fetch('assets/models/recipes/walls/wallrecipe2.json').then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status} fetching wallrecipe2.json`);
        return response.json();
      }),
    ]).then(([, recipe]) => {
      builder.addRecipe(recipeId, recipe);
      builder.tintDefaultGlb?.('assets/textures/carved_smooth.png', '#545039');
      return true;
    }).catch(error => {
      readyPromise = null;
      throw error;
    });
    return readyPromise;
  }

  function countAndShowFarmChunks(scene) {
    let chunks = 0, instances = 0; // Returned in the mobile snapshot to distinguish "built but hidden" from "not built".
    for (const child of scene?.children || []) {
      if (child?.name !== 'PathBrickSurfaceChunk') continue;
      child.visible = true;
      chunks++;
      child.traverse?.(object => { if (object?.isInstancedMesh) instances += Number(object.count) || 0; });
    }
    stats.visibleChunks = chunks;
    stats.visibleInstances = instances;
    return { chunks, instances };
  }

  async function tryBuild(reason, token) {
    if (token !== buildToken) return true;
    const terrain = window.TerrainGeometry; // Resolved at execution time so later wrappers still participate.
    const grid = vegetationDeps?.getGrid?.() || terrainDeps?.getGrid?.(); // Current farm tile objects; never mutated by this module.
    const scene = vegetationDeps?.scene; // Authoritative farm THREE.Scene receiving the registered chunks.
    const cols = Number(vegetationDeps?.COLS), rows = Number(vegetationDeps?.ROWS); // Farm dimensions used by the temporary path mask.
    if (!terrain?.preparePathSplineData || !terrain?.registerPathBrickChunks || !Array.isArray(grid) || !scene || !Number.isFinite(cols) || !Number.isFinite(rows)) return false;

    await ensureReady();
    if (token !== buildToken) return true;

    const routes = farmRoutes(); // Re-read immediately before building so a just-loaded layout wins over an earlier retry.
    let splineData = terrain.preparePathSplineData(grid, cols, rows, routes, 'farm'); // Normal production path is always attempted first.
    let mode = 'painted-path'; // Updated below only when production had no PATH mask to work from.
    let selectedRoute = null; // Stored for diagnostics when route-only fallback is required.

    if (!splineData) {
      selectedRoute = selectEntranceRoute(routes);
      if (selectedRoute) {
        const masked = routeMaskedGrid(grid, cols, rows, selectedRoute); // Temporary route-derived PATH mask; real tiles/save remain untouched.
        if (masked) splineData = terrain.preparePathSplineData(masked, cols, rows, [selectedRoute], 'farm');
        mode = 'authored-route-mask';
      }
    }
    if (!splineData) {
      const masked = fixedFallbackGrid(grid, cols, rows); // Guaranteed visual fallback for the established north entrance when route data is absent/late.
      splineData = terrain.preparePathSplineData(masked, cols, rows, [], 'farm');
      mode = 'fixed-entrance-fallback';
    }
    if (!splineData) throw new Error('Farm paving produced no spline/tile corridor even after the fixed entrance fallback');
    splineData = extendThroughNorthGap(splineData);
    updateGrassSuppression(splineData, cols, rows);

    terrain.registerPathBrickChunks('farm', scene, splineData);
    terrain.updatePathBrickCulling?.('farm', true);
    const visible = countAndShowFarmChunks(scene); // Farm road is short; keep all chunks visible even if the historical culling caller is absent.

    stats.successfulBuilds++;
    stats.lastMode = mode;
    stats.lastReason = reason;
    stats.lastRouteId = selectedRoute ? routeId(selectedRoute) : null;
    stats.lastError = null;
    if (mode === 'painted-path') stats.paintedPathBuilds++;
    else if (mode === 'authored-route-mask') stats.routeMaskBuilds++;
    else stats.fixedFallbackBuilds++;
    log(`${mode}: ${visible.chunks} chunk(s), ${visible.instances} brick instance(s)${stats.lastRouteId ? `, route=${stats.lastRouteId}` : ''}`);
    return true;
  }

  function requestBuild(reason = 'manual') {
    const token = ++buildToken; // Cancels stale retries from an earlier layout/build event.
    stats.buildRequests++;
    stats.lastReason = reason;
    let finished = false; // Prevents later finite retries after one attempt succeeds.
    for (const delay of RETRY_DELAYS_MS) {
      setTimeout(async () => {
        if (finished || token !== buildToken) return;
        try {
          finished = await tryBuild(reason, token);
        } catch (error) {
          stats.failedBuilds++;
          stats.lastError = String(error?.message || error);
          if (delay === RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]) log(`build failed after finite retries: ${stats.lastError}`, 'warn');
        }
      }, delay);
    }
  }

  function patchTerrain(api) {
    if (!api || patchedApis.has(api)) return api;
    if (typeof api.init === 'function') {
      const originalInit = api.init; // Preserved while capturing the existing dependency bag for paving reuse.
      api.init = function (injectedDeps, ...rest) {
        terrainDeps = injectedDeps;
        const result = originalInit.call(this, injectedDeps, ...rest); // Keeps TerrainGeometry initialization behavior unchanged.
        requestBuild('terrain-init');
        return result;
      };
    }
    patchedApis.add(api);
    return api;
  }

  function patchVegetation(api) {
    if (!api || patchedApis.has(api)) return api;
    if (typeof api.init === 'function') {
      const originalInit = api.init; // Captures scene/grid/dimensions before the first full farm tile build.
      api.init = function (injectedDeps, ...rest) {
        vegetationDeps = injectedDeps;
        const result = originalInit.call(this, injectedDeps, ...rest); // Preserves the normal vegetation renderer setup.
        requestBuild('vegetation-init');
        return result;
      };
    }
    if (typeof api.buildTileMeshes === 'function') {
      const originalBuild = api.buildTileMeshes; // Historical farm paving registration ran at this same full-build boundary.
      api.buildTileMeshes = function (...args) {
        const result = originalBuild.apply(this, args);
        requestBuild('farm-tile-build');
        return result;
      };
    }
    patchedApis.add(api);
    return api;
  }

  function patchFarmEditor(api) {
    if (!api || patchedApis.has(api)) return api;
    if (typeof api.init === 'function') {
      const originalInit = api.init; // Captures live route getter while preserving FarmEditor setup/listeners.
      api.init = function (injectedDeps, ...rest) {
        farmEditorDeps = injectedDeps;
        return originalInit.call(this, injectedDeps, ...rest);
      };
    }
    if (typeof api.loadFarmLayout === 'function') {
      const originalLoad = api.loadFarmLayout; // Captures serialized routes directly before game.js copies them into worldRoutes.
      api.loadFarmLayout = function (...args) {
        const layout = originalLoad.apply(this, args);
        cachedLayoutRoutes = Array.isArray(layout?.routes) ? layout.routes.map(route => ({ ...route, nodes: Array.isArray(route.nodes) ? route.nodes.map(node => Array.isArray(node) ? node.slice() : node) : [] })) : [];
        requestBuild('farm-layout-load');
        return layout;
      };
    }
    if (typeof api.applyFarmLayoutToGrid === 'function') {
      const originalApply = api.applyFarmLayoutToGrid; // Schedules another build after saved terrain has replaced the day-one grid state.
      api.applyFarmLayoutToGrid = function (...args) {
        const result = originalApply.apply(this, args);
        requestBuild('farm-layout-grid-apply');
        return result;
      };
    }
    patchedApis.add(api);
    return api;
  }

  function patchExisting() {
    patchTerrain(window.TerrainGeometry);
    patchVegetation(window.VegetationCropRendering);
    patchFarmEditor(window.FarmEditor);
  }

  window.FarmPathBricks = {
    installed: true,
    rebuild: () => requestBuild('manual-debug-rebuild'),
    suppressesGrassAt: (col, row) => grassSuppressionTiles.has(`${col},${row}`),
    snapshot: () => ({ ...stats, cachedLayoutRouteCount: cachedLayoutRoutes.length, liveFarmRouteCount: farmRoutes().length }),
  };

  patchExisting();
})();
