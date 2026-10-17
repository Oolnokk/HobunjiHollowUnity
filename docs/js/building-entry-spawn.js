// Default building entry tile, extracted out of game.js (buildingSpawnFromExit).
// Pure function of a loaded building scene's transitions; used by the player's
// enterBuilding and, through game.js's NpcPathfinding deps, by NPC area links.
// Explicit spawn coordinates (an exit's spawnCol/spawnRow) win over this at both
// call sites; this only guesses "one tile north of the town door".
(() => {
  'use strict';

  function clamp(value, lo, hi) {
    return window.FormatUtils?.clamp ? window.FormatUtils.clamp(value, lo, hi) : Math.max(lo, Math.min(hi, value));
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
    const northRow = Math.min(...mainCluster.map(t => t.row)) - 1;
    return {
      col: clamp(Math.round(avgCol), 0, fallbackCols - 1),
      row: clamp(northRow, 0, fallbackRows - 1),
    };
  }

  window.BuildingEntrySpawn = Object.freeze({ fromExit });
})();
