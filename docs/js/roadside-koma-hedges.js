// Recolors only coherent shrub lines beside the wilderness roads used by Slagothim caravans.
// Kept independent of FoliageGenerator so other bushes never inherit the Koma leaf preset.
(() => {
  'use strict';
  if (window.RoadsideKomaHedges) return;

  const CARAVAN_ZONES = new Set([
    'map_southern_cloud_forest', 'map_northern_cliffs', 'map_eastern_mire',
  ]); // Western Slope is intentionally excluded: its roadside plants are leafless.
  const NEAR_ROAD = 3; // Within three tiles of the carved path (a road may have one-tile grass shoulders).
  const HEDGE_SPAN = 4; // Bush rows can have occasional gaps without losing their hedgerow character.
  const stats = { checks: 0, hits: 0, last: null }; // Mobile diagnostics for map/roadside classification.

  function tile(grid, col, row) {
    return grid?.[row]?.[col] || null; // Read-only runtime grid: no saved terrain or collision changes.
  }

  function bushAt(grid, col, row) {
    const here = tile(grid, col, row);
    if (String(here?.type || '').toLowerCase() !== 'shrub') return false;
    return here.floraKind === 'bush'; // Only ordinary decorative bushes; fruit/mushroom resources, trees and hive stumps keep their identifying art.
  }

  function nearRoad(grid, col, row) {
    for (let dz = -NEAR_ROAD; dz <= NEAR_ROAD; dz++) {
      for (let dx = -NEAR_ROAD; dx <= NEAR_ROAD; dx++) {
        if (Math.abs(dx) + Math.abs(dz) > NEAR_ROAD + 1) continue;
        if (String(tile(grid, col + dx, row + dz)?.type || '').toLowerCase() === 'path') return true;
      }
    }
    return false;
  }

  function hedgeAxis(grid, col, row) {
    for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      let sides = 0; // Counts actual other bushes along one coherent line, allowing a small gap.
      for (const sign of [-1, 1]) {
        for (let offset = 1; offset <= HEDGE_SPAN; offset++) {
          const c = col + dc * offset * sign, r = row + dr * offset * sign;
          if (!bushAt(grid, c, r)) continue;
          if (!nearRoad(grid, c, r)) continue;
          sides++;
          break;
        }
      }
      if (sides === 2 || (sides === 1 && countAxisBushes(grid, col, row, dc, dr) >= 3)) return true; // Three or more related roadside bushes, not isolated scrub.
    }
    return false;
  }

  function countAxisBushes(grid, col, row, dc, dr) {
    let count = 1; // Center plant already passed bushAt() before this helper is called.
    for (const sign of [-1, 1]) for (let step = 1; step <= HEDGE_SPAN; step++) {
      if (bushAt(grid, col + dc * step * sign, row + dr * step * sign)
          && nearRoad(grid, col + dc * step * sign, row + dr * step * sign)) count++;
    }
    return count;
  }

  function isHedgeBush(grid, col, row, mapId) {
    if (!CARAVAN_ZONES.has(mapId) || !bushAt(grid, col, row)) return false;
    stats.checks++;
    if (!nearRoad(grid, col, row) || !hedgeAxis(grid, col, row)) return false;
    stats.hits++;
    stats.last = { mapId, col, row };
    return true;
  }

  window.RoadsideKomaHedges = Object.freeze({
    isHedgeBush,
    getDebug: () => ({ ...stats, zones: [...CARAVAN_ZONES], nearRoadTiles: NEAR_ROAD }),
  });
})();
