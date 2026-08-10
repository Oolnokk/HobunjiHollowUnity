// Shared gameplay, HUD, and editor tuning. Loaded before dependent scripts.
(function (root) {
  'use strict';
  const plateauVerticalUnit = 2.5;
  root.HOBUNJI_CONFIG = Object.freeze({
    terrain: Object.freeze({
      plateauVerticalUnit,
      // visualHeights stores normalized values. Keep its full displacement
      // strictly below one gameplay cliff tier.
      subtleHeightMaxDisplacement: plateauVerticalUnit * 0.24,
      subtleHeightMin: -1,
      subtleHeightMax: 1,
      subtleHeightDefault: 0,
      subtleHeightMaxNeighborDelta: 1.99
    }),
    editor: Object.freeze({
      visualHeightBrushStrength: 0.1,
      visualHeightBrushRadius: 1,
      visualHeightBrushMode: 'literal',
      visualHeightColorStops: Object.freeze([
        Object.freeze({ value: -1, color: '#2563eb' }),
        Object.freeze({ value: 0, color: '#f8fafc' }),
        Object.freeze({ value: 1, color: '#ef4444' })
      ])
    }),
    resourceRings: Object.freeze({
      arcs: Object.freeze({
        health: Object.freeze({ start: 292, end: 186 }),
        stamina: Object.freeze({ start: 174, end: 68 }),
        footing: Object.freeze({ start: 56, end: -56 })
      }),
      colors: Object.freeze({
        health: '#55d76f',
        stamina: '#67b7ff',
        footing: '#d9a441',
        exhausted: '#050608',
        outline: '#000000',
        target: '#ff2020'
      }),
      afflictionColors: Object.freeze({
        woundedStamina: '#ff9b2f',
        bleedingHealth: '#cf1e2e',
        congealedHealth: '#c98d41',
        infectedStamina: '#284f2a',
        windedStamina: '#90949c',
        bruisedHealth: '#4c42a9',
        shatteredStamina: '#8c4ad9',
        poisonedHealth: '#37651c'
      }),
      neon: Object.freeze({
        minSourceSaturation: 0.12,
        minSourceLightness: 0.08,
        saturation: 1,
        minLightness: 0.42,
        maxLightness: 0.6,
        glowHaloPadFraction: 0.34,
        glowHaloOpacityMultiplier: 0.75
      }),
      afflictionPulse: Object.freeze({ durationSeconds: 1, scale: 0.22, shakeUnits: 0.035 })
    })
  });

  // Current authored-map preset: every building without an explicit override
  // starts at subtle elevation level 1 with a one-tile radius. Normalize map
  // JSON before terrain construction so gameplay gets the same raised surface
  // the Map Editor previews, rather than only lifting the rigid building mesh.
  // Explicit future per-building overrides still win, so this is a default/
  // migration behavior rather than a permanent forced setting.
  if (typeof document !== 'undefined' && typeof root.fetch === 'function' && !root.fetch.hobunjiBuildingElevationDefaults) {
    const priorFetch = root.fetch.bind(root); // Includes any earlier fetch wrappers (notably the authored Inn override).
    const configScriptUrl = document.currentScript?.src || location.href;
    const docsRootUrl = new URL('../', configScriptUrl);
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

    function requestUrl(input) {
      return String(typeof input === 'string' ? input : input?.url || '');
    }

    function isMapJsonRequest(input) {
      const url = requestUrl(input);
      return /(?:^|\/)config\/maps\/[^/?#]+\.json(?:[?#]|$)/i.test(url);
    }

    function normalizeOverride(raw) {
      const source = raw && typeof raw === 'object' ? raw : null;
      const value = Number(source?.value);
      const radius = Number(source?.radius);
      return {
        enabled: source && hasOwn(source, 'enabled') ? !!source.enabled : true,
        value: clamp(Number.isFinite(value) ? value : 1, -1, 1),
        radius: clamp(Number.isFinite(radius) ? Math.round(radius) : 1, 0, 64),
      };
    }

    function fallbackShape(building) {
      const bboxW = Math.max(1, Math.round(Number(building?.footprintW) || 1));
      const bboxD = Math.max(1, Math.round(Number(building?.footprintD) || 1));
      const cells = [];
      for (let y = 0; y < bboxD; y++) for (let x = 0; x < bboxW; x++) cells.push({ x, y });
      return { bboxW, bboxD, cells };
    }

    function normalizeStoredShape(building) {
      const raw = building?.footprintShape;
      if (!Array.isArray(raw?.cells) || !raw.cells.length) return null;
      const bboxW = Math.max(1, Math.round(Number(raw.bboxW) || Number(building?.footprintW) || 1));
      const bboxD = Math.max(1, Math.round(Number(raw.bboxD) || Number(building?.footprintD) || 1));
      const seen = new Set();
      const cells = [];
      for (const cell of raw.cells) {
        const x = Math.round(Number(cell?.x));
        const y = Math.round(Number(cell?.y));
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const key = `${x},${y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        cells.push({ x, y });
      }
      return cells.length ? { bboxW, bboxD, cells } : null;
    }

    function shapeFromPiece(pieceData, building) {
      const cells = root.BuildingDoor?.footprintCells?.(pieceData) || [];
      const usable = cells.filter(cell => Number.isFinite(cell?.x) && Number.isFinite(cell?.y));
      if (!usable.length) return fallbackShape(building);
      const minX = Math.min(...usable.map(cell => cell.x));
      const minY = Math.min(...usable.map(cell => cell.y));
      const maxX = Math.max(...usable.map(cell => cell.x));
      const maxY = Math.max(...usable.map(cell => cell.y));
      const seen = new Set();
      const normalized = [];
      for (const cell of usable) {
        const x = cell.x - minX;
        const y = cell.y - minY;
        const key = `${x},${y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        normalized.push({ x, y });
      }
      return { bboxW: maxX - minX + 1, bboxD: maxY - minY + 1, cells: normalized };
    }

    async function resolveShape(building) {
      const stored = normalizeStoredShape(building);
      if (stored) return stored;
      if (!building?.pieceFile) return fallbackShape(building);
      try {
        const pieceUrl = new URL(String(building.pieceFile).replace(/^\/+/, ''), docsRootUrl).href;
        const response = await priorFetch(pieceUrl, { cache: 'no-store' });
        if (!response.ok) return fallbackShape(building);
        return shapeFromPiece(await response.json(), building);
      } catch (_) {
        return fallbackShape(building);
      }
    }

    function rotateCell(localX, localY, width, depth, rotationDeg) {
      if (root.BuildingDoor?.rotateCell) return root.BuildingDoor.rotateCell(localX, localY, width, depth, rotationDeg);
      const rot = ((Math.round((Number(rotationDeg) || 0) / 90) * 90) % 360 + 360) % 360;
      if (rot === 90) return { x: localY, y: width - 1 - localX };
      if (rot === 180) return { x: width - 1 - localX, y: depth - 1 - localY };
      if (rot === 270) return { x: depth - 1 - localY, y: localX };
      return { x: localX, y: localY };
    }

    function cloneHeights(values) {
      const out = {};
      if (!values || typeof values !== 'object' || Array.isArray(values)) return out;
      for (const [key, raw] of Object.entries(values)) {
        const value = Number(raw);
        if (!/^-?\d+,-?\d+$/.test(key) || !Number.isFinite(value)) continue;
        out[key] = clamp(value, -1, 1);
      }
      return out;
    }

    async function applyBuildingDefaults(mapData) {
      const buildings = Array.isArray(mapData?.buildings) ? mapData.buildings : [];
      if (!buildings.length) return mapData;
      const cols = Math.max(1, Number(mapData.cols) || 1);
      const rows = Math.max(1, Number(mapData.rows) || 1);
      const base = mapData.visualHeightBase && typeof mapData.visualHeightBase === 'object'
        ? cloneHeights(mapData.visualHeightBase)
        : cloneHeights(mapData.visualHeights);
      const effective = { ...base };

      const shapes = await Promise.all(buildings.map(resolveShape));
      for (let i = 0; i < buildings.length; i++) {
        const building = buildings[i];
        const override = normalizeOverride(building.subtleElevationOverride);
        building.subtleElevationOverride = override;
        if (!override.enabled) continue;
        const shape = shapes[i] || fallbackShape(building);
        const gridX = Math.round(Number(building.gridX) || 0);
        const gridZ = Math.round(Number(building.gridZ) || 0);
        const rotationDeg = Number(building.rotationDeg ?? building.rotation) || 0;
        const footprint = [];
        const footprintSeen = new Set();
        for (const cell of shape.cells) {
          const rotated = rotateCell(cell.x, cell.y, shape.bboxW, shape.bboxD, rotationDeg);
          const c = gridX + rotated.x;
          const r = gridZ + rotated.y;
          const key = `${c},${r}`;
          if (footprintSeen.has(key)) continue;
          footprintSeen.add(key);
          footprint.push({ c, r });
        }
        for (const cell of footprint) {
          for (let dr = -override.radius; dr <= override.radius; dr++) {
            for (let dc = -override.radius; dc <= override.radius; dc++) {
              const c = cell.c + dc;
              const r = cell.r + dr;
              if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
              effective[`${c},${r}`] = override.value;
            }
          }
        }
      }
      mapData.visualHeights = effective;
      delete mapData.visualHeightBase;
      return mapData;
    }

    const wrappedFetch = async function (input, init) {
      const response = await priorFetch(input, init);
      if (!response?.ok || !isMapJsonRequest(input)) return response;
      try {
        const data = await response.clone().json();
        if (!Array.isArray(data?.buildings) || !data.buildings.length) return response;
        await applyBuildingDefaults(data);
        // The live game's town loader predates visualHeights and can discard
        // that field while copying map data into its private _townZone record.
        // Keep the normalized source map available to the town-ground hook
        // below so the actual rendered floor still receives the same stamp.
        if (data.id === 'map_hobunji_town') root.__hobunjiTownElevationMap = data;
        const headers = new Headers(response.headers);
        headers.set('content-type', 'application/json; charset=utf-8');
        headers.delete('content-length');
        headers.delete('content-encoding');
        return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers });
      } catch (error) {
        console.warn('Building elevation defaults: map migration failed; using source map unchanged.', error);
        return response;
      }
    };
    wrappedFetch.hobunjiBuildingElevationDefaults = true;
    wrappedFetch.originalFetch = priorFetch;
    wrappedFetch.applyBuildingDefaults = applyBuildingDefaults;
    root.fetch = wrappedFetch;
  }
})(typeof self !== 'undefined' ? self : globalThis);

// Town visualHeights compatibility hook.
//
// The original runtime visual-height pass was only wired into wilderness/zone
// geometry. Town uses its own merged ground meshes, so building overrides could
// lift a house while leaving the lawn beneath it flat. TownZoneBuildings is
// loaded after this config file but is called only after buildTownScene has
// finished creating those floor meshes; capture its injected live scene/map
// dependencies and deform the existing ground in place immediately before the
// house meshes are spawned. No second surface is created, so this cannot add a
// new coplanar layer or z-fighting surface.
(function installTownVisualHeightCompatibility(root) {
  'use strict';
  if (typeof document === 'undefined') return;

  let capturedDeps = null;

  function visualHeightMap() {
    const live = capturedDeps?.getTownZone?.();
    const cached = root.__hobunjiTownElevationMap;
    if (cached?.visualHeights && Object.keys(cached.visualHeights).length) return cached;
    return live;
  }

  function sampleHeight(map, x, z) {
    if (!map || !root.TerrainPreview?.sampleVisualHeight) return 0;
    const cols = Math.max(1, Number(map.cols) || 1);
    const rows = Math.max(1, Number(map.rows) || 1);
    return root.TerrainPreview.sampleVisualHeight(map.visualHeights || {}, x, z, cols, rows) || 0;
  }

  function isLikelyMergedTownFloor(mesh, map) {
    if (!mesh?.isMesh || mesh.isInstancedMesh || !mesh.visible) return false;
    if (mesh.userData?.hobunjiTownVisualHeightApplied) return false;
    const pos = mesh.geometry?.getAttribute?.('position');
    if (!pos || pos.count < 12) return false;

    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(Boolean);
    if (!materials.length) return false;
    // Grass is deliberately MeshBasicMaterial in the current renderer. Other
    // opaque floor buckets may still be Lambert; ShaderMaterial meshes in the
    // town are primarily grass billboards/weather and must not be reshaped.
    if (materials.some(mat => mat.isShaderMaterial || mat.transparent || mat.opacity < 1)) return false;
    if (!materials.every(mat => mat.isMeshBasicMaterial || mat.isMeshLambertMaterial)) return false;

    // Merged floor geometry bakes world X/Z into its vertices and sits at the
    // scene origin. Transition rings, sprites, props, etc. use local geometry
    // translated to their tile and are rejected here.
    if (Math.abs(Number(mesh.position?.x) || 0) > 1e-4 || Math.abs(Number(mesh.position?.z) || 0) > 1e-4) return false;
    mesh.geometry.computeBoundingBox?.();
    const bb = mesh.geometry.boundingBox;
    if (!bb) return false;
    const spanX = bb.max.x - bb.min.x;
    const spanZ = bb.max.z - bb.min.z;
    if (spanX < 4 && spanZ < 4) return false;
    const cols = Math.max(1, Number(map?.cols) || 1);
    const rows = Math.max(1, Number(map?.rows) || 1);
    if (bb.max.x < -1 || bb.min.x > cols + 1 || bb.max.z < -1 || bb.min.z > rows + 1) return false;
    return true;
  }

  function deformTownFloor() {
    const scene = capturedDeps?.getTownScene?.();
    const map = visualHeightMap();
    if (!scene || !map?.visualHeights || !root.TerrainPreview?.sampleVisualHeight) return 0;

    let changedMeshes = 0;
    let changedVertices = 0;
    // Only inspect direct scene children. The merged terrain buckets are direct
    // children; grass billboard blades and authored buildings live inside
    // groups, which keeps this pass from ever touching avatar/building meshes.
    for (const mesh of scene.children || []) {
      if (!isLikelyMergedTownFloor(mesh, map)) continue;
      const pos = mesh.geometry.getAttribute('position');
      let touched = 0;
      for (let i = 0; i < pos.count; i++) {
        const lift = sampleHeight(map, pos.getX(i), pos.getZ(i));
        if (Math.abs(lift) < 1e-7) continue;
        pos.setY(i, pos.getY(i) + lift);
        touched++;
      }
      if (!touched) continue;
      pos.needsUpdate = true;
      mesh.geometry.computeVertexNormals?.();
      mesh.geometry.computeBoundingBox?.();
      mesh.geometry.computeBoundingSphere?.();
      mesh.userData.hobunjiTownVisualHeightApplied = true;
      changedMeshes++;
      changedVertices += touched;
    }

    if (changedMeshes) {
      capturedDeps?.debugLog?.(`Town subtle elevation: displaced ${changedVertices} vertices across ${changedMeshes} existing ground mesh(es)`);
    }
    return changedMeshes;
  }

  function patchTownZoneBuildings(api) {
    if (!api || api.__hobunjiTownVisualHeightCompatibility) return api;
    const originalInit = api.init;
    const originalSpawnTownBuildings = api.spawnTownBuildings;
    if (typeof originalInit !== 'function' || typeof originalSpawnTownBuildings !== 'function') return api;

    api.init = function (injectedDeps) {
      capturedDeps = injectedDeps;
      return originalInit.call(this, injectedDeps);
    };
    api.spawnTownBuildings = function (...args) {
      deformTownFloor();
      return originalSpawnTownBuildings.apply(this, args);
    };
    api.deformTownFloorForVisualHeights = deformTownFloor; // Pixel-probe/debug-console escape hatch.
    api.__hobunjiTownVisualHeightCompatibility = true;
    return api;
  }

  if (root.TownZoneBuildings) {
    patchTownZoneBuildings(root.TownZoneBuildings);
    return;
  }

  // config.js loads before town-zone-buildings.js. Intercept that single
  // global assignment so the module is patched synchronously the moment its
  // script finishes, long before game.js calls .init().
  let assignedApi;
  Object.defineProperty(root, 'TownZoneBuildings', {
    configurable: true,
    enumerable: true,
    get() { return assignedApi; },
    set(value) {
      assignedApi = patchTownZoneBuildings(value);
    },
  });
})(typeof self !== 'undefined' ? self : globalThis);
