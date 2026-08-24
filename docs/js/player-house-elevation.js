(() => {
  'use strict';

  // Runtime adapter that applies the Map Editor/town-building subtle-height
  // contract to the farm's dynamic modular-house footprint.  The actual
  // stamping rules stay owned by BuildingSubtleElevation; this file only
  // translates live house rectangles into that shared footprint format and
  // applies the resulting heightfield to the farm's already-existing meshes.
  function create(injectedDeps) {
    const deps = injectedDeps || {};
    const elevation = window.BuildingSubtleElevation;
    const terrain = window.TerrainPreview;
    const grassSuppression = window.BuildingGrassSuppression; // Shared footprint filter used for house + barn grass removal.
    if (!elevation || !terrain || typeof terrain.sampleVisualHeight !== 'function') {
      throw new Error('PlayerHouseElevation requires BuildingSubtleElevation and TerrainPreview.');
    }

    const cols = Math.max(1, Number(deps.cols) || 1);
    const rows = Math.max(1, Number(deps.rows) || 1);
    const getGrid = typeof deps.getGrid === 'function' ? deps.getGrid : () => [];
    const getPieces = typeof deps.getPieces === 'function' ? deps.getPieces : () => [];
    const getFarmBuildings = typeof deps.getFarmBuildings === 'function' ? deps.getFarmBuildings : () => []; // Barn rectangles joined with house pieces for grass suppression only.
    const markTileDirty = typeof deps.markTileDirty === 'function' ? deps.markTileDirty : () => {};
    const recomputeWater = typeof deps.recomputeWater === 'function' ? deps.recomputeWater : () => {};
    const debugLog = typeof deps.debugLog === 'function' ? deps.debugLog : () => {};
    const scene = deps.scene || null;
    const PLAYER_HOUSE_LOGICAL_HEIGHT = 0.6; // Used when building the runtime subtle-elevation override and reporting debug state.

    let visualHeights = {}; // Current shared-algorithm center samples, used when deforming farm terrain meshes.
    let footprintFingerprint = ''; // Union-of-module footprint signature; skips terrain work for roof/feature-only rebuilds.
    let affectedKeys = new Set(); // Nonzero center cells currently owned by the house elevation stamp.
    let visualMeshKeys = new Set(); // A one-cell halo around affected centers, where bilinear interpolation can still move vertices.
    let baseElevTiers = new Map(); // Original per-tile elevTier values restored when the modular footprint moves away.
    let lastDebug = null; // Most recent recalculation summary, exposed for the in-game/mobile debug surface.
    let sceneAddOriginal = null; // Scene.add hook keeps later shovel/tile refreshes deformed and footprint-filtered while active.
    let currentGrassBlockedKeys = new Set(); // Exact house + barn cells currently excluded from grass billboard instances.
    let lastGrassStats = { meshes: 0, source: 0, visible: 0, suppressed: 0 }; // Latest grass compaction counts for debug output.
    let lastDeformedTerrainMeshes = 0; // Number of terrain meshes touched by the most recent elevation sync.

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

    function _grassFootprintKeys(houseKeys = _pieceFootprintKeys()) {
      const keys = new Set(houseKeys); // House module cells plus barn rectangles form the farm's no-grass footprint mask.
      const barnKeys = typeof grassSuppression?.rectFootprintKeys === 'function'
        ? grassSuppression.rectFootprintKeys(getFarmBuildings() || [])
        : new Set();
      for (const key of barnKeys) keys.add(key);
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
        ? elevation.normalizeOverride({ value: PLAYER_HOUSE_LOGICAL_HEIGHT })
        : { enabled: true, value: PLAYER_HOUSE_LOGICAL_HEIGHT, radius: elevation.DEFAULT_RADIUS ?? 1 };
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
        // Farm grounding/billboard code already consumes elevTier.  A
        // fractional tier lets those systems inherit the subtle lift without
        // pretending this is a real plateau tier; terrain vertices themselves
        // are still deformed continuously below with the exact bilinear sampler.
        tile.elevTier = base + sampleWorldY(c + 0.5, r + 0.5) / unit;
      }
    }

    function _terrainMeshWorldAnchor(obj) {
      if (!obj?.isMesh || obj.isInstancedMesh || !obj.geometry?.attributes?.position) return null;
      if (!obj.layers?.isEnabled?.(3)) return null;
      if (obj.userData?.isBillboard || obj.userData?.terrainRenderChunkSource) return null;
      obj.updateMatrixWorld?.(true);
      const anchor = new THREE.Vector3(); // World-space tile center allows terrain nested under renderer groups to match the footprint.
      obj.getWorldPosition(anchor);
      const c = Math.floor(anchor.x);
      const r = Math.floor(anchor.z);
      if (!inBounds(c, r) || !visualMeshKeys.has(keyOf(c, r))) return null;
      // Ordinary farm tile meshes are centered at n+0.5. The old direct-parent
      // check broke as soon as terrain wrappers/groups were introduced; world
      // coordinates preserve the same narrow identification without assuming
      // the mesh is a direct scene child.
      if (Math.abs(anchor.x - (c + 0.5)) > 0.08 || Math.abs(anchor.z - (r + 0.5)) > 0.08) return null;
      return { c, r };
    }

    function _isFarmTerrainMesh(obj) {
      return !!_terrainMeshWorldAnchor(obj);
    }

    function _deformTerrainMesh(obj) {
      if (!_isFarmTerrainMesh(obj)) return false;
      const stamp = footprintFingerprint || '__pending__';
      if (obj.userData?.playerHouseElevationStamp === stamp) return false;
      // Some farm tile types reuse template geometry. Clone before writing
      // vertex Y so one elevated house tile cannot deform every instance of
      // that geometry elsewhere on the farm.
      obj.geometry = obj.geometry.clone();
      obj.updateMatrixWorld?.(true);
      const meshWorld = obj.matrixWorld.clone(); // Converts local terrain vertices into the same world coordinates sampled by the heightfield.
      const worldToLocal = meshWorld.clone().invert(); // Converts the lifted world vertex back into this mesh's local geometry space.
      const localPoint = new THREE.Vector3(); // Reused local vertex while applying the subtle-height field.
      const worldPoint = new THREE.Vector3(); // Reused world vertex where the bilinear heightfield is sampled.
      const pos = obj.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        localPoint.set(pos.getX(i), pos.getY(i), pos.getZ(i));
        worldPoint.copy(localPoint).applyMatrix4(meshWorld);
        worldPoint.y += sampleWorldY(worldPoint.x, worldPoint.z);
        localPoint.copy(worldPoint).applyMatrix4(worldToLocal);
        pos.setXYZ(i, localPoint.x, localPoint.y, localPoint.z);
      }
      pos.needsUpdate = true;
      if (obj.geometry.attributes.normal) obj.geometry.computeVertexNormals();
      obj.geometry.computeBoundingBox?.();
      obj.geometry.computeBoundingSphere?.();
      obj.userData = obj.userData || {};
      obj.userData.playerHouseElevationStamp = stamp;
      return true;
    }

    function _deformTerrainMeshes() {
      if (!scene || !visualMeshKeys.size) return 0;
      let moved = 0; // Count of nested/direct terrain meshes deformed by this pass for the debug snapshot.
      scene.updateMatrixWorld?.(true);
      scene.traverse?.(obj => { if (_deformTerrainMesh(obj)) moved++; });
      return moved;
    }

    function refreshGrassSuppression(houseKeys = _pieceFootprintKeys()) {
      currentGrassBlockedKeys = _grassFootprintKeys(houseKeys);
      if (!scene || typeof grassSuppression?.filterScene !== 'function') {
        lastGrassStats = { meshes: 0, source: 0, visible: 0, suppressed: 0 };
        return lastGrassStats;
      }
      lastGrassStats = grassSuppression.filterScene(scene, currentGrassBlockedKeys, 'hobunjiFarmBuildingGrass');
      return lastGrassStats;
    }

    function _installSceneAddHook() {
      if (!scene || sceneAddOriginal) return;
      sceneAddOriginal = scene.add;
      scene.add = function (...objects) {
        const result = sceneAddOriginal.apply(this, objects);
        // _markTerrainEdgeId runs immediately after scene.add in game.js, so
        // defer one microtask before checking layer 3. Traverse each added root
        // because terrain may now be nested under renderer wrapper groups.
        queueMicrotask(() => {
          for (const root of objects) {
            if (typeof root?.traverse === 'function') root.traverse(obj => _deformTerrainMesh(obj));
            else _deformTerrainMesh(root);
            if (typeof grassSuppression?.filterObject === 'function') {
              grassSuppression.filterObject(root, currentGrassBlockedKeys, 'hobunjiFarmBuildingGrass');
            }
          }
        });
        return result;
      };
    }

    _installSceneAddHook();

    function sync(force = false) {
      const footprintKeys = _pieceFootprintKeys();
      const nextFingerprint = [...footprintKeys].sort().join('|');
      if (!force && nextFingerprint === footprintFingerprint) {
        refreshGrassSuppression(footprintKeys);
        return false;
      }

      const oldVisualKeys = new Set(visualMeshKeys);
      _restoreBaseElevTiers();
      visualHeights = _buildVisualHeights(footprintKeys);
      affectedKeys = new Set(Object.keys(visualHeights).filter(key => Number(visualHeights[key]) !== 0));
      visualMeshKeys = _expandOneCell(affectedKeys);
      _applyCenterElevTiers(affectedKeys);
      // Publish the new stamp before markTileDirty() starts adding replacement
      // meshes. The scene.add microtasks then see the same stamp as the eager
      // deformation pass below and cannot apply the lift twice.
      footprintFingerprint = nextFingerprint;

      const rebuildKeys = new Set([...oldVisualKeys, ...visualMeshKeys]);
      for (const key of rebuildKeys) {
        const [c, r] = parseKey(key);
        markTileDirty(c, r);
      }
      lastDeformedTerrainMeshes = _deformTerrainMeshes();
      refreshGrassSuppression(footprintKeys);
      if (rebuildKeys.size) recomputeWater(false);

      lastDebug = {
        footprintCells: footprintKeys.size,
        affectedCenters: affectedKeys.size,
        deformedTileCells: visualMeshKeys.size,
        deformedTerrainMeshes: lastDeformedTerrainMeshes,
        grassBlockedCells: currentGrassBlockedKeys.size,
        suppressedGrassInstances: lastGrassStats.suppressed,
        worldY: worldY(),
        logicalValue: PLAYER_HOUSE_LOGICAL_HEIGHT,
        radius: elevation.DEFAULT_RADIUS ?? null,
      };
      debugLog(`Player house subtle elevation: ${lastDebug.footprintCells} footprint tile(s), ${lastDebug.affectedCenters} stamped center(s), ${lastDebug.deformedTerrainMeshes} terrain mesh(es), Y +${lastDebug.worldY.toFixed(3)}; grass suppressed in ${lastDebug.grassBlockedCells} building tile(s).`);
      return true;
    }

    function dispose() {
      _restoreBaseElevTiers();
      const old = new Set(visualMeshKeys);
      visualHeights = {};
      affectedKeys = new Set();
      visualMeshKeys = new Set();
      footprintFingerprint = '';
      currentGrassBlockedKeys = new Set();
      refreshGrassSuppression(new Set());
      for (const key of old) {
        const [c, r] = parseKey(key);
        markTileDirty(c, r);
      }
      if (old.size) recomputeWater(false);
      if (scene && sceneAddOriginal) {
        scene.add = sceneAddOriginal;
        sceneAddOriginal = null;
      }
    }

    function debugSnapshot() {
      return {
        ...(lastDebug || {
          footprintCells: 0,
          affectedCenters: 0,
          deformedTileCells: 0,
          deformedTerrainMeshes: lastDeformedTerrainMeshes,
          grassBlockedCells: currentGrassBlockedKeys.size,
          suppressedGrassInstances: lastGrassStats.suppressed,
          worldY: 0,
        }),
        fingerprint: footprintFingerprint,
        affectedKeys: [...affectedKeys],
      };
    }

    return { sync, dispose, sampleWorldY, worldY, refreshGrassSuppression, debugSnapshot };
  }

  window.PlayerHouseElevation = { create };
})();