(() => {
  'use strict';

  // Active-area grid/scene/dimension accessors (getActiveCols/Rows/Grid/
  // Scene/TileAt) and building/den footprint collision checks
  // (isHouseFootprint/isFarmBuildingCollisionTile/isTownBuildingCollisionTile/
  // isAnimalDenCollisionTile + their shared rotateBuildingCollisionCell/
  // _buildingFootprintBbox/_buildingFootprintBlocks helpers), extracted out
  // of game.js following the same window.<Namespace> + init(deps) pattern
  // as its siblings. Pure read-only lookups (getActiveGrid/getActiveScene
  // can trigger deps.buildZoneScene as a lazy-build side effect, same as
  // before extraction, but never reassign outer state themselves) — the
  // wide dependency list below is entirely getters/consts, no setters.
  let deps = null;
  const buildingFootprintCache = new WeakMap(); // Reused by collision queries so authored footprint arrays are rotated/indexed only when a building definition changes.
  const EMPTY_FOOTPRINT_CELLS = Object.freeze([]); // Stable fallback reference keeps absent optional extension lists from invalidating the collision cache.
  let buildingFootprintCacheBuilds = 0; // Reported through debugSnapshot for the mobile Pixel Probe/performance diagnostics.
  let buildingFootprintCacheHits = 0; // Reported through debugSnapshot to verify repeated movement queries stay allocation-free.
  function init(injectedDeps) { deps = injectedDeps; }

  function getCurrentArea() {
    return deps?.getCurrentArea?.() ?? null;
  }

  function isBuildingArea(area = getCurrentArea()) {
    return !!deps?._isBuildingArea?.(area);
  }

  function getActiveCols() {
    const currentArea = deps.getCurrentArea();
    return currentArea === 'interior' ? deps.INTERIOR_COLS
      : currentArea === 'town' ? (deps.getTownZone()?.cols || 60)
      : deps._isBuildingArea(currentArea) ? (deps._buildingScenes.get(currentArea)?.cols || 20)
      : deps._isZoneArea(currentArea) ? (deps._zoneScenes.get(currentArea)?.cols || deps.EXTERIOR_ZONES[currentArea]?.cols || deps._zoneLayouts.get(currentArea)?.cols)
      : deps.COLS;
  }
  function getActiveRows() {
    const currentArea = deps.getCurrentArea();
    return currentArea === 'interior' ? deps.INTERIOR_ROWS
      : currentArea === 'town' ? (deps.getTownZone()?.rows || 50)
      : deps._isBuildingArea(currentArea) ? (deps._buildingScenes.get(currentArea)?.rows || 20)
      : deps._isZoneArea(currentArea) ? (deps._zoneScenes.get(currentArea)?.rows || deps.EXTERIOR_ZONES[currentArea]?.rows || deps._zoneLayouts.get(currentArea)?.rows)
      : deps.ROWS;
  }
  function getActiveGrid() {
    const currentArea = deps.getCurrentArea();
    return currentArea === 'interior' ? deps.getInteriorGrid()
      : currentArea === 'town' ? deps.getTownGrid()
      : deps._isBuildingArea(currentArea) ? (deps._buildingScenes.get(currentArea)?.grid || deps.getGrid())
      : deps._isZoneArea(currentArea) ? (deps._zoneScenes.get(currentArea)?.grid || deps.buildZoneScene(currentArea).grid)
      : deps.getGrid();
  }
  function getActiveScene() {
    const currentArea = deps.getCurrentArea();
    return deps._isBuildingArea(currentArea) ? (deps._buildingScenes.get(currentArea)?.scene || deps.getScene())
      : deps._isZoneArea(currentArea) ? (deps._zoneScenes.get(currentArea)?.scene || deps.buildZoneScene(currentArea).scene)
      : currentArea === 'interior' ? deps.getInteriorScene()
      : currentArea === 'town' ? (deps.getTownScene() || deps.getScene())
      : deps.getScene();
  }
  function getActiveTileAt(col, row) {
    const g = getActiveGrid();
    return g[row]?.[col] || { type: deps.TileType.ROCK, water: 0, crop: deps.CropType.NONE, cropAge: 0, cropReady: false, stress: '', variation: 0 };
  }

  // Whether a farm-grid tile falls inside the house footprint
  function isHouseFootprint(col, row) {
    return deps.getHousePieces().some(p => col >= p.col && col < p.col + p.w && row >= p.row && row < p.row + p.h);
  }
  // Barns (any tier, foundation or built) block movement over their
  // whole registered footprint — stable.json's own footprint.cells is
  // already a solid rectangle matching w×h, so the piece-less bbox
  // fallback in _buildingFootprintBlocks (below) gives the identical
  // result without needing the async-loaded piece JSON on hand here.
  function isFarmBuildingCollisionTile(col, row) {
    return deps.getFarmBuildings().some(b => _buildingFootprintBlocks(b, null, col, row));
  }
  // Rotation math lives once in js/building-door.js (shared with the Map
  // Editor and House Piece Author's door tooling) — this is just the
  // local name collision detection already used before that file existed.
  function rotateBuildingCollisionCell(localX, localY, width, depth, rotationDeg) {
    return window.BuildingDoor.rotateCell(localX, localY, width, depth, rotationDeg);
  }
  // Axis-aligned bbox check using the building's own footprintW/D (or
  // legacy w/h) — used both when no piece is loaded yet at all, and as
  // a defensive fallback if a piece IS loaded but its footprint.cells
  // came back empty (e.g. exported before the House Piece Author's
  // footprint tool was used). Either way, a real placed/rendered
  // building should never end up with silently zero collision.
  function _buildingFootprintBbox(bldg, originX, originZ, col, row) {
    const fbRot = ((Math.round((bldg.rotationDeg || bldg.rotation || 0) / 90) * 90) % 360 + 360) % 360;
    const fbSwap = fbRot === 90 || fbRot === 270;
    const width = fbSwap ? (bldg.footprintD ?? bldg.h ?? 1) : (bldg.footprintW ?? bldg.w ?? 1);
    const depth = fbSwap ? (bldg.footprintW ?? bldg.w ?? 1) : (bldg.footprintD ?? bldg.h ?? 1);
    return col >= originX && row >= originZ && col < originX + width && row < originZ + depth;
  }
  function _buildingFootprintBlocks(bldg, piece, col, row) {
    const originX = bldg.gridX ?? bldg.col ?? 0;
    const originZ = bldg.gridZ ?? bldg.row ?? 0;

    if (!piece?.footprint) return _buildingFootprintBbox(bldg, originX, originZ, col, row);

    const structuralCells = piece.footprint.cells || EMPTY_FOOTPRINT_CELLS;
    const fencePostCells = piece.footprint.extensions?.railings || EMPTY_FOOTPRINT_CELLS;
    if (!structuralCells.length && !fencePostCells.length) return _buildingFootprintBbox(bldg, originX, originZ, col, row);

    const extensions = piece.footprint.extensions || {};
    const entryTunnelCells = extensions.entryTunnels || EMPTY_FOOTPRINT_CELLS; // Included in authored bounds but intentionally excluded from collision.
    const chimneyCells = extensions.chimneys || EMPTY_FOOTPRINT_CELLS; // Included in authored bounds so rotation retains the authoring origin.
    const porchCells = extensions.porches || EMPTY_FOOTPRINT_CELLS; // Included in authored bounds so structural cells rotate around the full piece.
    const porchStairCells = extensions.porchStairs || EMPTY_FOOTPRINT_CELLS; // Included in authored bounds while remaining walkable.
    const rotation = bldg.rotationDeg || bldg.rotation || 0;
    const previous = buildingFootprintCache.get(bldg);
    const cacheValid = previous
      && previous.piece === piece
      && previous.originX === originX
      && previous.originZ === originZ
      && previous.rotation === rotation
      && previous.structuralCells === structuralCells && previous.structuralLength === structuralCells.length
      && previous.entryTunnelCells === entryTunnelCells && previous.entryTunnelLength === entryTunnelCells.length
      && previous.chimneyCells === chimneyCells && previous.chimneyLength === chimneyCells.length
      && previous.porchCells === porchCells && previous.porchLength === porchCells.length
      && previous.porchStairCells === porchStairCells && previous.porchStairLength === porchStairCells.length
      && previous.fencePostCells === fencePostCells && previous.fencePostLength === fencePostCells.length;
    if (cacheValid) {
      buildingFootprintCacheHits++;
      return previous.blocked.has(col * 65536 + row);
    }

    const collisionCells = structuralCells.concat(fencePostCells);
    const allBuildingCells = structuralCells.concat(entryTunnelCells, chimneyCells, porchCells, porchStairCells, fencePostCells);
    if (!allBuildingCells.length) return _buildingFootprintBbox(bldg, originX, originZ, col, row);
    const minX = Math.min(...allBuildingCells.map(cell => cell.x));
    const minY = Math.min(...allBuildingCells.map(cell => cell.y));
    const maxX = Math.max(...allBuildingCells.map(cell => cell.x));
    const maxY = Math.max(...allBuildingCells.map(cell => cell.y));
    const width = maxX - minX + 1;
    const depth = maxY - minY + 1;
    const blocked = new Set(); // Queried by every subsequent collision check for this unchanged building footprint.
    for (const cell of collisionCells) {
      const rotated = rotateBuildingCollisionCell(cell.x - minX, cell.y - minY, width, depth, rotation);
      blocked.add((originX + rotated.x) * 65536 + originZ + rotated.y);
    }
    buildingFootprintCache.set(bldg, {
      piece,
      originX,
      originZ,
      rotation,
      structuralCells,
      structuralLength: structuralCells.length,
      entryTunnelCells,
      entryTunnelLength: entryTunnelCells.length,
      chimneyCells,
      chimneyLength: chimneyCells.length,
      porchCells,
      porchLength: porchCells.length,
      porchStairCells,
      porchStairLength: porchStairCells.length,
      fencePostCells,
      fencePostLength: fencePostCells.length,
      blocked,
    });
    buildingFootprintCacheBuilds++;
    return blocked.has(col * 65536 + row);
  }
  // `area` defaults to 'town'; any zone mapId with its own merged buildings
  // (see _spawnZoneBuildings / _zoneBuildingGroups) is also accepted, so the
  // same collision rules apply to a building placed on a plateau zone map.
  function isTownBuildingCollisionTile(col, row, area) {
    area = area || 'town';
    if (area === 'town') {
      // Building-entrance transition tiles are always walkable (they ARE the door approach)
      if (deps.getWorldTownTransitions().some(t => t.target === 'building' && t.col === col && t.row === row)) return false;
      // Every building must be checked regardless of whether ITS OWN piece
      // has finished loading — _buildingFootprintBlocks already falls back
      // to a bbox check per-entry when `piece` is null. Previously this
      // filtered down to only piece-loaded entries once ANY building had
      // loaded, which silently dropped collision entirely (not even the
      // bbox fallback) for any building still fetching, whose fetch
      // failed, or that the GLB-upgrade pass (town-zone-buildings.js)
      // dropped for not having a piece — see that file's own upgrade loop.
      const townBuildingGroups = deps.getTownBuildingGroups();
      const buildingSources = townBuildingGroups.length
        ? townBuildingGroups
        : deps.getTownBuildingDefs().map(bldg => ({ bldg, piece: null }));
      return buildingSources.some(({ bldg, piece }) => _buildingFootprintBlocks(bldg, piece, col, row));
    }

    const zoneGroups = deps._zoneBuildingGroups.get(area) || [];
    const zoneBuildingSources = zoneGroups.length
      ? zoneGroups
      : (deps._zoneLayouts.get(area)?.buildings || []).map(bldg => ({ bldg, piece: null }));
    if (zoneBuildingSources.some(({ bldg, piece }) => _buildingFootprintBlocks(bldg, piece, col, row))) return true;
    if (isLocaleObjectCollisionTile(col, row, area)) return true;
    return isAnimalDenCollisionTile(col, row, area);
  }

  // Locale object collision is authored independently from visuals. Objects
  // without an explicit collision field retain their old runtime behavior.
  function isLocaleObjectCollisionTile(col, row, area) {
    const instances = deps._zoneLayouts.get(area)?.localeInstances || [];
    for (const instance of instances) {
      for (const object of (instance?.objects || [])) {
        const collision = object?.collision;
        if (!collision || collision.mode === 'auto' || collision.mode === 'none') continue;
        const x = collision.mode === 'custom' && Number.isFinite(Number(collision.x)) ? Number(collision.x) : Number(object.x);
        const y = collision.mode === 'custom' && Number.isFinite(Number(collision.y)) ? Number(collision.y) : Number(object.y);
        const w = collision.mode === 'custom' ? Math.max(.1, Number(collision.w) || Number(object.w) || 1) : Math.max(.1, Number(object.w) || 1);
        const h = collision.mode === 'custom' ? Math.max(.1, Number(collision.h) || Number(object.h) || 1) : Math.max(.1, Number(object.h) || 1);
        if (col >= x && col < x + w && row >= y && row < y + h) return true;
      }
    }
    return false;
  }

  // Animal dens are a solid rock volume (see buildAnimalDenMeshes) except
  // their south-facing mouth tile, which stays walkable — it's both the
  // doorway gap in the mesh and the cavern-entrance transition tile.
  function isAnimalDenCollisionTile(col, row, area) {
    for (const den of (deps._zoneLayouts.get(area)?.dens || [])) {
      const authoredState = window.ZoneDenTotemFeatures?.denEntranceCollisionState?.(den) || null; // Full den-template collision state includes furniture/custom colliders plus whether to retain the legacy cave shell.
      if (authoredState) {
        for (const rect of (authoredState.rects || [])) {
          if (col >= rect.x && col < rect.x + rect.w && row >= rect.y && row < rect.y + rect.h) return true;
        }
        if (!authoredState.useLegacyCave) continue;
      }
      if (den.mouthAnchor && den.mouthAnchor.x === col && den.mouthAnchor.y === row) continue; // Mouth exception applies only to the legacy cave shell, never to an explicitly authored furniture/custom collider.
      const w = den.w || 1, h = den.h || 1;
      if (col < den.x || col >= den.x + w || row < den.y || row >= den.y + h) continue;
      // Doorway gap carved into the south wall (30%-70% of the footprint's
      // width, on its last row) so the footprint box isn't fully solid with
      // no way through it at all — mouthAnchor alone never punched a hole
      // here since it's defined as the tile just OUTSIDE the footprint, not
      // a tile inside it.
      const mouthColStart = den.x + Math.floor(w * 0.3);
      const mouthColEnd = den.x + Math.ceil(w * 0.7) - 1;
      if (row === den.y + h - 1 && col >= mouthColStart && col <= mouthColEnd) continue;
      return true;
    }
    return false;
  }

  window.GridTileAccessors = {
    init,
    getCurrentArea,
    isBuildingArea,
    getActiveCols,
    getActiveRows,
    getActiveGrid,
    getActiveScene,
    getActiveTileAt,
    isHouseFootprint,
    isFarmBuildingCollisionTile,
    rotateBuildingCollisionCell,
    isTownBuildingCollisionTile,
    isLocaleObjectCollisionTile,
    isAnimalDenCollisionTile,
    debugSnapshot() {
      return {
        buildingFootprintCacheBuilds,
        buildingFootprintCacheHits,
      };
    },
  };
})();
