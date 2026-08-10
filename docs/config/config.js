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
