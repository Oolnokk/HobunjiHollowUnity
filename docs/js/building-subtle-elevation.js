// Shared building-level subtle elevation authoring math.
//
// The Map Editor stores a building override as authoring metadata, but the
// live game already understands ordinary map.visualHeights. This module keeps
// those two concepts in sync without leaving stale terrain behind when a
// building moves, rotates, changes radius, or is removed.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BuildingSubtleElevation = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const MIN_VALUE = -1;
  const MAX_VALUE = 1;
  const MAX_RADIUS = 64;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const keyOf = (c, r) => `${c},${r}`;

  function normalizePieceData(pieceData) {
    return pieceData?.currentPiece && typeof pieceData.currentPiece === 'object'
      ? pieceData.currentPiece
      : pieceData;
  }

  function pieceFootprintCells(pieceData) {
    const piece = normalizePieceData(pieceData) || {};
    return []
      .concat(piece?.footprint?.cells || [])
      .concat(piece?.footprint?.extensions?.entryTunnels || [])
      .concat(piece?.footprint?.extensions?.chimneys || [])
      .concat(piece?.footprint?.extensions?.porches || [])
      .concat(piece?.footprint?.extensions?.porchStairs || [])
      .concat(piece?.footprint?.extensions?.railings || []);
  }

  function deriveFootprintShape(pieceData) {
    const source = pieceFootprintCells(pieceData)
      .filter(cell => Number.isFinite(cell?.x) && Number.isFinite(cell?.y));
    if (!source.length) return null;

    const minX = Math.min(...source.map(cell => cell.x));
    const minY = Math.min(...source.map(cell => cell.y));
    const maxX = Math.max(...source.map(cell => cell.x));
    const maxY = Math.max(...source.map(cell => cell.y));
    const seen = new Set();
    const cells = [];
    for (const cell of source) {
      const x = cell.x - minX;
      const y = cell.y - minY;
      const key = keyOf(x, y);
      if (seen.has(key)) continue;
      seen.add(key);
      cells.push({ x, y });
    }
    return { bboxW: maxX - minX + 1, bboxD: maxY - minY + 1, cells };
  }

  function fallbackFootprintShape(building) {
    const width = Math.max(1, Math.round(Number(building?.footprintW) || 1));
    const depth = Math.max(1, Math.round(Number(building?.footprintD) || 1));
    const cells = [];
    for (let y = 0; y < depth; y++) for (let x = 0; x < width; x++) cells.push({ x, y });
    return { bboxW: width, bboxD: depth, cells };
  }

  function normalizeFootprintShape(raw, building) {
    const width = Math.max(1, Math.round(Number(raw?.bboxW) || Number(building?.footprintW) || 1));
    const depth = Math.max(1, Math.round(Number(raw?.bboxD) || Number(building?.footprintD) || 1));
    const seen = new Set();
    const cells = [];
    for (const cell of (Array.isArray(raw?.cells) ? raw.cells : [])) {
      const x = Math.round(Number(cell?.x));
      const y = Math.round(Number(cell?.y));
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const key = keyOf(x, y);
      if (seen.has(key)) continue;
      seen.add(key);
      cells.push({ x, y });
    }
    return cells.length ? { bboxW: width, bboxD: depth, cells } : fallbackFootprintShape(building);
  }

  function rotateCell(localX, localY, width, depth, rotationDeg) {
    const rot = ((Math.round((Number(rotationDeg) || 0) / 90) * 90) % 360 + 360) % 360;
    if (rot === 90) return { x: localY, y: width - 1 - localX };
    if (rot === 180) return { x: width - 1 - localX, y: depth - 1 - localY };
    if (rot === 270) return { x: depth - 1 - localY, y: localX };
    return { x: localX, y: localY };
  }

  function worldFootprintCells(building) {
    const shape = normalizeFootprintShape(building?.footprintShape, building);
    const gridX = Math.round(Number(building?.gridX) || 0);
    const gridZ = Math.round(Number(building?.gridZ) || 0);
    const rotationDeg = Number(building?.rotationDeg ?? building?.rotation) || 0;
    const seen = new Set();
    const out = [];
    for (const cell of shape.cells) {
      const rotated = rotateCell(cell.x, cell.y, shape.bboxW, shape.bboxD, rotationDeg);
      const c = gridX + rotated.x;
      const r = gridZ + rotated.y;
      const key = keyOf(c, r);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ c, r });
    }
    return out;
  }

  function normalizeOverride(raw) {
    const numberValue = Number(raw?.value);
    const numberRadius = Number(raw?.radius);
    return {
      enabled: !!raw?.enabled,
      value: clamp(Number.isFinite(numberValue) ? numberValue : 0, MIN_VALUE, MAX_VALUE),
      radius: clamp(Number.isFinite(numberRadius) ? Math.round(numberRadius) : 0, 0, MAX_RADIUS),
    };
  }

  function affectedCells(building, map) {
    const override = normalizeOverride(building?.subtleElevationOverride);
    const radius = override.radius;
    const cols = Number.isFinite(Number(map?.cols)) ? Number(map.cols) : Infinity;
    const rows = Number.isFinite(Number(map?.rows)) ? Number(map.rows) : Infinity;
    const seen = new Set();
    const out = [];
    for (const cell of worldFootprintCells(building)) {
      // Radius is a morphological one-tile-at-a-time expansion around the
      // exact footprint; r1 includes diagonals as well as cardinal neighbors.
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          const c = cell.c + dc;
          const r = cell.r + dr;
          if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
          const key = keyOf(c, r);
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ c, r });
        }
      }
    }
    return out;
  }

  function cloneHeights(values) {
    const out = {};
    if (!values || typeof values !== 'object' || Array.isArray(values)) return out;
    for (const [key, raw] of Object.entries(values)) {
      const value = Number(raw);
      if (!/^-?\d+,-?\d+$/.test(key) || !Number.isFinite(value)) continue;
      out[key] = clamp(value, MIN_VALUE, MAX_VALUE);
    }
    return out;
  }

  function enabledBuildings(map) {
    return (Array.isArray(map?.buildings) ? map.buildings : [])
      .filter(building => normalizeOverride(building?.subtleElevationOverride).enabled);
  }

  function ensureBuildingDefaults(map) {
    let changed = false;
    for (const building of (Array.isArray(map?.buildings) ? map.buildings : [])) {
      const normalized = normalizeOverride(building.subtleElevationOverride);
      if (JSON.stringify(building.subtleElevationOverride) !== JSON.stringify(normalized)) {
        building.subtleElevationOverride = normalized;
        changed = true;
      }
    }
    return changed;
  }

  function rebuildMapVisualHeights(map) {
    if (!map || typeof map !== 'object') return { activeOverrides: 0, affectedCells: 0 };
    ensureBuildingDefaults(map);
    const active = enabledBuildings(map);

    if (!active.length) {
      if (map.visualHeightBase && typeof map.visualHeightBase === 'object') {
        map.visualHeights = cloneHeights(map.visualHeightBase);
        delete map.visualHeightBase;
      } else {
        map.visualHeights = cloneHeights(map.visualHeights);
      }
      return { activeOverrides: 0, affectedCells: 0 };
    }

    // visualHeightBase preserves the user's hand-painted surface while one or
    // more building overrides temporarily own cells in visualHeights.
    if (!map.visualHeightBase || typeof map.visualHeightBase !== 'object' || Array.isArray(map.visualHeightBase)) {
      map.visualHeightBase = cloneHeights(map.visualHeights);
    } else {
      map.visualHeightBase = cloneHeights(map.visualHeightBase);
    }

    const effective = cloneHeights(map.visualHeightBase);
    const affected = new Set();
    for (const building of active) {
      const override = normalizeOverride(building.subtleElevationOverride);
      building.subtleElevationOverride = override;
      for (const cell of affectedCells(building, map)) {
        const key = keyOf(cell.c, cell.r);
        // Keep explicit zeroes: on plateau submaps zero intentionally cancels
        // an inherited parent-map visual height at this world cell.
        effective[key] = override.value;
        affected.add(key);
      }
    }
    map.visualHeights = effective;
    return { activeOverrides: active.length, affectedCells: affected.size };
  }

  function beginBaseEdit(map) {
    if (!enabledBuildings(map).length) return false;
    if (!map.visualHeightBase || typeof map.visualHeightBase !== 'object') {
      map.visualHeightBase = cloneHeights(map.visualHeights);
    }
    map.visualHeights = cloneHeights(map.visualHeightBase);
    return true;
  }

  function endBaseEdit(map) {
    if (!map || !enabledBuildings(map).length) return rebuildMapVisualHeights(map);
    map.visualHeightBase = cloneHeights(map.visualHeights);
    return rebuildMapVisualHeights(map);
  }

  function materializeMapForRuntime(map) {
    const clone = JSON.parse(JSON.stringify(map || {}));
    rebuildMapVisualHeights(clone);
    delete clone.visualHeightBase;
    return clone;
  }

  function debugSnapshot(map) {
    const buildings = (Array.isArray(map?.buildings) ? map.buildings : []).map(building => {
      const override = normalizeOverride(building?.subtleElevationOverride);
      return {
        id: building?.id || '',
        label: building?.label || '',
        override,
        footprintCells: worldFootprintCells(building).length,
        affectedCells: override.enabled ? affectedCells(building, map).length : 0,
      };
    });
    return {
      mapId: map?.id || '',
      visualHeightBaseCount: Object.keys(map?.visualHeightBase || {}).length,
      effectiveVisualHeightCount: Object.keys(map?.visualHeights || {}).length,
      buildings,
    };
  }

  return {
    MIN_VALUE, MAX_VALUE, MAX_RADIUS,
    normalizePieceData, pieceFootprintCells, deriveFootprintShape,
    rotateCell, worldFootprintCells, normalizeOverride, affectedCells,
    cloneHeights, ensureBuildingDefaults, rebuildMapVisualHeights,
    beginBaseEdit, endBaseEdit, materializeMapForRuntime, debugSnapshot,
  };
});
