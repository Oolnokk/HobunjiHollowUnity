(() => {
  'use strict';

  // Runtime adapter that applies the Map Editor/town-building subtle-height
  // contract to the farm's dynamic modular-house footprint. The actual
  // stamping rules stay owned by BuildingSubtleElevation; this file only
  // translates live house rectangles into that shared footprint format and
  // applies the resulting heightfield to the farm's already-existing meshes.
  function create(injectedDeps) {
    const deps = injectedDeps || {};
    const elevation = window.BuildingSubtleElevation;
    const terrain = window.TerrainPreview;
    if (!elevation || !terrain || typeof terrain.sampleVisualHeight !== 'function') {
      throw new Error('PlayerHouseElevation requires BuildingSubtleElevation and TerrainPreview.');
    }

    const cols = Math.max(1, Number(deps.cols) || 1);
    const rows = Math.max(1, Number(deps.rows) || 1);
    const getGrid = typeof deps.getGrid === 'function' ? deps.getGrid : () => [];
    const getPieces = typeof deps.getPieces === 'function' ? deps.getPieces : () => [];
    const markTileDirty = typeof deps.markTileDirty === 'function' ? deps.markTileDirty : () => {};
    const recomputeWater = typeof deps.recomputeWater === 'function' ? deps.recomputeWater : () => {};
    const debugLog = typeof deps.debugLog === 'function' ? deps.debugLog : () => {};
    const scene = deps.scene || null;

    let visualHeights = {}; // Current shared-algorithm center samples, used when deforming farm terrain meshes.
    let footprintFingerprint = ''; // Union-of-module footprint signature; skips terrain work for roof/feature-only rebuilds.
    let affectedKeys = new Set(); // Nonzero center cells currently owned by the house elevation stamp.
    let visualMeshKeys = new Set(); // A one-cell halo around affected centers, where bilinear interpolation can still move vertices.
    let baseElevTiers = new Map(); // Original per-tile elevTier values restored when the modular footprint moves away.
    let lastDebug = null; // Most recent recalculation summary, exposed for the in-game/mobile debug surface.

    const keyOf = (c, r) => `${c},${r}`;
    const parseKey = key => key.split(',').map(Number);
    const inBounds = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows;

    function _pieceFootprintKeys() {
      const keys = new Set();
      for (const piece of getPieces() || []) {
        const col = Math.trunc(Number(piece?.col));
        const row = Math.trunc(Number(piece?.row));
        const w = Math.max(0, Math.trunc(Number(piece?.w)));
        const h = Math.max(0, Math.trunc(Number(piece?.h)));
        if (!Number.isFinite(col) || !Number.isFinite(row) || !w || !h) continue;
        for (let r = row; r < row + h; r++) {
          for (let c = col; c < col + w; c++) if (inBounds(c, r)) keys.add(keyOf(c, r));
        }
      }
      return keys;
    }

    function _runtimeBuildingForFootprint(footprintKeys) {
      if (!footprintKeys.size) return null;
      const cells = [...footprintKeys].map(parseKey);
      const minC = Math.min(...cells.map(v => v[0]));
      const minR = Math.min(...cells.map(v => v[1]));
      const maxC = Math.max(...cells.map(v => v[0]));
      const maxR = Math.max(...cells.map(v => v[1]));
      const override = typeof elevation.normalizeOverride === 'function'
        ? elevation.normalizeOverride(null)
        : { enabled: true, value: elevation.DEFAULT_VALUE ?? 0.5, radius: elevation.DEFAULT_RADIUS ?? 1 };
      return {
        id: 'player_house_dynamic_footprint',
        gridX: minC,
        gridZ: minR,
        rotationDeg: 0,
        footprintShape: {
          bboxW: maxC - minC + 1,
          bboxD: maxR - minR + 1,
          cells: cells.map(([c, r]) => ({ x: c - minC, y: r - minR })),
        },
        subtleElevationOverride: override,
      };
    }

    function _buildVisualHeights(footprintKeys) {
      const building = _runtimeBuildingForFootprint(footprintKeys);
      if (!building) return {};
      const runtimeMap = {
        id: 'farm_player_house_runtime', cols, rows,
        buildings: [building],
        visualHeightBase: {}, visualHeights: {},
      };
      elevation.rebuildMapVisualHeights(runtimeMap);
      return { ...(runtimeMap.visualHeights || {}) };
    }

    function _expandOneCell(keys) {
      const out = new Set();
      for (const key of keys) {
        const [c, r] = parseKey(key);
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          if (inBounds(c + dc, r + dr)) out.add(keyOf(c + dc, r + dr));
        }
      }
      return out;
    }

    function sampleWorldY(worldX, worldZ) {
      return terrain.sampleVisualHeight(visualHeights, Number(worldX), Number(worldZ), cols, rows) || 0;
    }

    function worldY() {
      if (!affectedKeys.size) return 0;
      const first = affectedKeys.values().next().value;
      if (!first) return 0;
      const [c, r] = parseKey(first);
      return sampleWorldY(c + 0.5, r + 0.5);
    }

    function _restoreBaseElevTiers() {
      const grid = getGrid();
      for (const [key, base] of baseElevTiers) {
        const [c, r] = parseKey(key);
        const tile = grid?.[r]?.[c];
        if (tile) tile.elevTier = base;
      }
      baseElevTiers = new Map();
    }

    function _applyCenterElevTiers(nextKeys) {
      const grid = getGrid();
      const unit = Number(terrain.PLATEAU_UNIT) || 2.5;
      for (const key of nextKeys) {
        const [c, r] = parseKey(key);
        const tile = grid?.[r]?.[c];
        if (!tile) continue;
        const base = Number(tile.elevTier) || 0;
        baseElevTiers.set(key, base);
        // Farm grounding/billboard code already consumes elevTier. A
        // fractional tier lets those systems inherit the subtle lift without
        // pretending this is a real plateau tier; terrain vertices themselves
        // are still deformed continuously below with the exact bilinear sampler.
        tile.elevTier = base + sampleWorldY(c + 0.5, r + 0.5) / unit;
      }
    }

    function _isFarmTerrainMesh(obj, keySet) {
      if (!obj?.isMesh || obj.parent !== scene || !obj.geometry?.attributes?.position) return false;
      if (!obj.layers?.isEnabled?.(3)) return false;
      const c = Math.floor(Number(obj.position.x));
      const r = Math.floor(Number(obj.position.z));
      if (!inBounds(c, r) || !keySet.has(keyOf(c, r))) return false;
      return Math.abs(obj.position.x - (c + 0.5)) < 0.02 && Math.abs(obj.position.z - (r + 0.5)) < 0.02;
    }

    function _deformTerrainMeshes(keySet) {
      if (!scene || !keySet.size) return;
      for (const obj of [...scene.children]) {
        if (!_isFarmTerrainMesh(obj, keySet)) continue;
        // Some farm tile types reuse template geometry. Clone before writing
        // vertex Y so one elevated house tile cannot deform every instance of
        // that geometry elsewhere on the farm.
        obj.geometry = obj.geometry.clone();
        const pos = obj.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const wx = obj.position.x + pos.getX(i);
          const wz = obj.position.z + pos.getZ(i);
          pos.setY(i, pos.getY(i) + sampleWorldY(wx, wz));
        }
        pos.needsUpdate = true;
        if (obj.geometry.attributes.normal) obj.geometry.computeVertexNormals();
        obj.geometry.computeBoundingBox?.();
        obj.geometry.computeBoundingSphere?.();
      }
    }

    function sync(force = false) {
      const footprintKeys = _pieceFootprintKeys();
      const nextFingerprint = [...footprintKeys].sort().join('|');
      if (!force && nextFingerprint === footprintFingerprint) return false;

      const oldVisualKeys = new Set(visualMeshKeys);
      _restoreBaseElevTiers();
      visualHeights = _buildVisualHeights(footprintKeys);
      affectedKeys = new Set(Object.keys(visualHeights).filter(key => Number(visualHeights[key]) !== 0));
      visualMeshKeys = _expandOneCell(affectedKeys);
      _applyCenterElevTiers(affectedKeys);

      const rebuildKeys = new Set([...oldVisualKeys, ...visualMeshKeys]);
      for (const key of rebuildKeys) {
        const [c, r] = parseKey(key);
        markTileDirty(c, r);
      }
      _deformTerrainMeshes(visualMeshKeys);
      if (rebuildKeys.size) recomputeWater(false);

      footprintFingerprint = nextFingerprint;
      lastDebug = {
        footprintCells: footprintKeys.size,
        affectedCenters: affectedKeys.size,
        deformedTileCells: visualMeshKeys.size,
        worldY: worldY(),
        logicalValue: elevation.DEFAULT_VALUE ?? null,
        radius: elevation.DEFAULT_RADIUS ?? null,
      };
      debugLog(`Player house subtle elevation: ${lastDebug.footprintCells} footprint tile(s), ${lastDebug.affectedCenters} stamped center(s), Y +${lastDebug.worldY.toFixed(3)}.`);
      return true;
    }

    function dispose() {
      _restoreBaseElevTiers();
      const old = new Set(visualMeshKeys);
      visualHeights = {};
      affectedKeys = new Set();
      visualMeshKeys = new Set();
      footprintFingerprint = '';
      for (const key of old) {
        const [c, r] = parseKey(key);
        markTileDirty(c, r);
      }
      if (old.size) recomputeWater(false);
    }

    function debugSnapshot() {
      return {
        ...(lastDebug || { footprintCells: 0, affectedCenters: 0, deformedTileCells: 0, worldY: 0 }),
        fingerprint: footprintFingerprint,
        affectedKeys: [...affectedKeys],
      };
    }

    return { sync, dispose, sampleWorldY, worldY, debugSnapshot };
  }

  window.PlayerHouseElevation = { create };
})();
