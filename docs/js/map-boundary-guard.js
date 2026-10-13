(() => {
  'use strict';

  // Map-boundary escarpments: the raised cliff ring a generated wilderness
  // zone gets around its edge (wilderness-map-generator.js's
  // generateBorderEscarpments / paintDistantBoundaryLandscapeTile) is
  // scenery that frames the playable area, never a place to stand. The
  // generator exports those tiles with borderEscarpment /
  // distantBoundaryLandscape on the root map record, but the plateau fold
  // (TerrainPreview.buildMergedZoneGrid, game.js mergeZoneTiles) rebuilds
  // every tile from scratch and used to drop the flag. markMergedTiles
  // copies it onto the merged tiles as `mapBoundary`, which is what the
  // runtime checks:
  //   - ClimbSystem refuses any cliff climb (or mount leap) whose wall or
  //     landing touches a boundary tile;
  //   - player movement (tileSpeedAt) and creature movement
  //     (creatureCanEnterTile) treat boundary tiles as solid, so nothing can
  //     walk, roll, or get knocked up onto one;
  //   - creature spawns (makeCreatureEntity) and camp/den/locale placement
  //     are pushed off them.
  // The entry-gate cut (borderEntryGate) is already cleared of
  // borderEscarpment by the generator, and clearAround() reopens a small
  // radius around every transition so an authored exit placed at the map
  // edge can never be sealed.

  function isBoundaryTile(tile) {
    return !!(tile && (tile.mapBoundary || tile.borderEscarpment || tile.distantBoundaryLandscape));
  }

  // rootMap: the generator's root map record ({ tiles: { "c,r": {...} } }).
  // mergedTiles: Map("c,r" -> merged tile) or an array of merged tiles.
  function markMergedTiles(rootMap, mergedTiles) {
    const source = rootMap?.tiles;
    if (!source || !mergedTiles) return 0;
    const lookup = typeof mergedTiles.get === 'function'
      ? mergedTiles
      : new Map((mergedTiles || []).map(t => [`${t.c},${t.r}`, t]));
    let marked = 0;
    for (const key of Object.keys(source)) {
      const src = source[key];
      if (!src || src.borderEntryGate) continue;
      if (!(src.borderEscarpment || src.generatedBorderEscarpment || src.distantBoundaryLandscape)) continue;
      const tile = lookup.get(key);
      if (!tile || tile.type === 'ramp') continue;
      tile.mapBoundary = true;
      marked++;
    }
    return marked;
  }

  // Reopens every boundary tile within `radius` tiles of (col,row) — used
  // around zone transitions/exits so an exit authored at the map edge stays
  // reachable even if the generator painted escarpment right up to it.
  function clearAround(grid, cols, rows, col, row, radius = 3) {
    if (!grid || !Number.isFinite(col) || !Number.isFinite(row)) return 0;
    let cleared = 0;
    for (let r = Math.max(0, row - radius); r <= Math.min(rows - 1, row + radius); r++) {
      for (let c = Math.max(0, col - radius); c <= Math.min(cols - 1, col + radius); c++) {
        const tile = grid[r]?.[c];
        if (tile?.mapBoundary) { tile.mapBoundary = false; cleared++; }
      }
    }
    return cleared;
  }

  // A tile a creature/actor may be placed on: inside the grid, not boundary,
  // not a cliff face, not solid.
  function isPlaceableTile(tile, isSolid) {
    if (!tile || isBoundaryTile(tile) || tile.incline) return false;
    return !(typeof isSolid === 'function' && isSolid(tile.type));
  }

  // Nearest placeable tile center (world px) to (x,y) when (x,y) sits on a
  // boundary tile; null when (x,y) is already fine or nothing is in range.
  function relocateOffBoundary(grid, cols, rows, x, y, tileSize, options = {}) {
    if (!grid || !(tileSize > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    const col = Math.floor(x / tileSize), row = Math.floor(y / tileSize);
    const here = grid[row]?.[col];
    if (here && !isBoundaryTile(here)) return null;
    const maxRadius = Math.max(1, Number(options.maxRadius) || 24);
    for (let radius = 1; radius <= maxRadius; radius++) {
      let best = null, bestD = Infinity;
      for (let r = row - radius; r <= row + radius; r++) {
        for (let c = col - radius; c <= col + radius; c++) {
          if (Math.max(Math.abs(r - row), Math.abs(c - col)) !== radius) continue;
          if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
          if (!isPlaceableTile(grid[r]?.[c], options.isSolid)) continue;
          const d = (r - row) * (r - row) + (c - col) * (c - col);
          if (d < bestD) { bestD = d; best = { x: (c + 0.5) * tileSize, y: (r + 0.5) * tileSize, col: c, row: r }; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  // Creature movement gate: never step from ordinary ground onto boundary
  // terrain. A creature already standing on one (an old save) may still walk
  // off it, so it can never be welded in place.
  function blocksCreatureStep(grid, tileSize, fromX, fromY, toX, toY) {
    if (!grid || !(tileSize > 0)) return false;
    const target = grid[Math.floor(toY / tileSize)]?.[Math.floor(toX / tileSize)];
    if (!isBoundaryTile(target)) return false;
    if (!Number.isFinite(fromX) || !Number.isFinite(fromY)) return true;
    const from = grid[Math.floor(fromY / tileSize)]?.[Math.floor(fromX / tileSize)];
    return !isBoundaryTile(from);
  }

  window.MapBoundaryGuard = {
    isBoundaryTile,
    markMergedTiles,
    clearAround,
    isPlaceableTile,
    relocateOffBoundary,
    blocksCreatureStep,
  };
})();
