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


  const PLANNED_ZONES = new Set([...CARAVAN_ZONES, 'map_western_slope']); // All caravan destinations get cosmetic living roadside rows; existing Slope dead shrubs remain untouched.
  const planCache = new WeakMap(); // Grid identity owns one deterministic cosmetic plan across streamed chunk builds.
  const LONG_RUN_MIN = 6; // A Koma hedge is an actual road-parallel row, not a few randomly scattered plants.
  const MAX_PLANNED_BUSHES = 300; // Caps per-zone object count; all shapes/materials are shared by FoliageGenerator.
  let lastPlan = null; // Mobile debug readout for how many hedges were planned and why none appeared.

  function hedgePlan(grid, mapId) {
    if (!Array.isArray(grid) || !PLANNED_ZONES.has(mapId)) return new Set();
    const cached = planCache.get(grid);
    if (cached?.mapId === mapId) return cached.sites;
    const candidates = { vertical: new Map(), horizontal: new Map() }; // One list of road-adjacent grass coordinates per straight roadway.
    const rows = grid.length, cols = grid[0]?.length || 0; // Used by the one-time grid scan to avoid off-map hedges.
    const isRoad = (c, r) => String(tile(grid, c, r)?.type || '').toLowerCase() === 'path'; // Existing walkable road topology is never modified.
    const isOpen = (c, r, source) => {
      const dest = tile(grid, c, r);
      if (!dest || String(dest.type).toLowerCase() !== 'grass') return false;
      if (dest.mapBoundary || dest.incline || dest.mesaCliffFace) return false;
      const a = Number(dest.elevTier || 0), b = Number(source.elevTier || 0);
      return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.1; // No bushes hanging across elevation breaks.
    };
    function offer(axis, c, r) {
      const key = axis === 'vertical' ? c : r; // Coordinates on the row's fixed axis group eligible contiguous neighbors.
      const variable = axis === 'vertical' ? r : c; // Sort this coordinate later to reject isolated patches.
      if (!candidates[axis].has(key)) candidates[axis].set(key, new Set());
      candidates[axis].get(key).add(variable);
    }
    for (let r = 2; r < rows - 2; r++) for (let c = 2; c < cols - 2; c++) {
      if (!isRoad(c, r)) continue;
      const alongVertical = isRoad(c, r - 1) && isRoad(c, r + 1);
      const alongHorizontal = isRoad(c - 1, r) && isRoad(c + 1, r);
      if (alongVertical === alongHorizontal) continue; // Avoid ambiguous intersections and sharp junctions.
      const axis = alongVertical ? 'vertical' : 'horizontal';
      const source = tile(grid, c, r);
      if ((axis === 'vertical' ? r : c) % 2 !== 0) continue; // Every other cell reduces mobile geometry and leaves small natural gaps.
      for (const side of [-1, 1]) {
        for (let d = 1; d <= 4; d++) {
          const hc = c + (axis === 'vertical' ? side * d : 0);
          const hr = r + (axis === 'horizontal' ? side * d : 0);
          if (isRoad(hc, hr)) continue; // Move past wide-road asphalt to the exterior grass shoulder.
          if (isOpen(hc, hr, source)) offer(axis, hc, hr);
          break; // Only the first shoulder tile, not a second offset line farther into the forest.
        }
      }
    }
    const sites = new Set(); // Exact grass cells that will receive non-colliding Koma bushes in streamed chunks.
    let runs = 0; // Diagnostic count of road-parallel stretches long enough to qualify as hedges.
    for (const [axis, lanes] of Object.entries(candidates)) for (const [constant, values] of lanes) {
      const sorted = [...values].sort((a, b) => a - b);
      let segment = []; // Used to discard disconnected small groups; candidates are two tiles apart.
      function flush() {
        if (segment.length >= Math.ceil(LONG_RUN_MIN / 2)) {
          runs++;
          for (const v of segment) {
            if (sites.size >= MAX_PLANNED_BUSHES) break;
            sites.add(axis === 'vertical' ? constant + ',' + v : v + ',' + constant);
          }
        }
        segment = [];
      }
      for (const v of sorted) {
        if (segment.length && v - segment[segment.length - 1] > 2) flush();
        segment.push(v);
      }
      flush();
    }
    lastPlan = { mapId, rows, cols, runs, bushes: sites.size, mode: 'visual-only; no tile or collision changes' };
    planCache.set(grid, { mapId, sites });
    window.__farmLog?.('[koma-hedges] ' + mapId + ': ' + sites.size + ' cosmetic bushes in ' + runs + ' parallel road rows', 'world');
    return sites;
  }

  window.RoadsideKomaHedges = Object.freeze({
    isHedgeBush, hedgePlan,
    getDebug: () => ({ ...stats, zones: [...PLANNED_ZONES], nearRoadTiles: NEAR_ROAD, lastPlan }),
  });
})();
