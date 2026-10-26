// Default building entry tile, extracted out of game.js (buildingSpawnFromExit).
// Pure function of a loaded building scene's transitions; used by the player's
// enterBuilding and, through game.js's NpcPathfinding deps, by NPC area links.
// Explicit spawn coordinates (an exit's spawnCol/spawnRow) win over this at both
// call sites; otherwise step inward using the authored direction (north for legacy exits).
(() => {
  'use strict';

  function clamp(value, lo, hi) {
    return window.FormatUtils?.clamp ? window.FormatUtils.clamp(value, lo, hi) : Math.max(lo, Math.min(hi, value));
  }

  const DIRECTIONS = Object.freeze({ north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] }); // Inward vectors drive entry placement and facing.

  function arrivalAngle(bi, col, row, fromArea) {
    const candidates = (bi?.transitions || []).filter(t => Object.hasOwn(DIRECTIONS, t.direction)); // Nearest reciprocal doorway identifies which entrance was used.
    const reciprocal = candidates.filter(t => t.targetMapId === fromArea || (t.target === 'exit_building' && !String(fromArea).startsWith('map_i_')));
    const nearest = (reciprocal.length ? reciprocal : candidates).reduce((best, t) => {
      const distance = Math.hypot(t.col - col, t.row - row); // Compare destination-side doors with the actual spawn, including multi-tile exits.
      return !best || distance < best.distance ? { t, distance } : best;
    }, null);
    if (!nearest) return null;
    const vector = DIRECTIONS[nearest.t.direction]; // atan2 uses the game's x/z facing convention.
    return Math.atan2(vector[1], vector[0]);
  }

  function fromExit(bi, fallbackCols, fallbackRows) {
    const exitTiles = (bi?.transitions || []).filter(t => t.target === 'exit_building');
    if (!exitTiles.length) return { col: Math.floor(fallbackCols / 2), row: Math.max(0, fallbackRows - 2) };
    // Multiple unrelated exit_building tiles can exist on one map (e.g. a real
    // exterior door plus an unwired stairwell stub). Cluster tiles that share the
    // same exitId/door, then use the largest cluster so a stray single-tile stub
    // can't drag the computed spawn point away from the actual entrance.
    const clusters = new Map();
    for (const t of exitTiles) {
      const key = t.exitId != null ? t.exitId : `${t.col},${t.row}`;
      if (!clusters.has(key)) clusters.set(key, []);
      clusters.get(key).push(t);
    }
    let mainCluster = exitTiles;
    if (clusters.size > 1) {
      mainCluster = [...clusters.values()].reduce((a, b) => (b.length > a.length ? b : a));
    }
    const avgCol = mainCluster.reduce((sum, t) => sum + t.col, 0) / mainCluster.length;
    const avgRow = mainCluster.reduce((sum, t) => sum + t.row, 0) / mainCluster.length; // Centre vertical doorway clusters as well as horizontal ones.
    const directed = mainCluster.find(t => Object.hasOwn(DIRECTIONS, t.direction)); // Authored doors can sit on any edge, rather than only the south edge.
    if (directed) {
      const [dc, dr] = DIRECTIONS[directed.direction]; // Step one tile inward from the central door tile.
      const centre = mainCluster.reduce((best, t) => Math.hypot(t.col - avgCol, t.row - avgRow) < Math.hypot(best.col - avgCol, best.row - avgRow) ? t : best);
      return { col: clamp(centre.col + dc, 0, fallbackCols - 1), row: clamp(centre.row + dr, 0, fallbackRows - 1) };
    }
    const northRow = Math.min(...mainCluster.map(t => t.row)) - 1;
    return {
      col: clamp(Math.round(avgCol), 0, fallbackCols - 1),
      row: clamp(northRow, 0, fallbackRows - 1),
    };
  }

  window.BuildingEntrySpawn = Object.freeze({ fromExit, arrivalAngle });
})();
