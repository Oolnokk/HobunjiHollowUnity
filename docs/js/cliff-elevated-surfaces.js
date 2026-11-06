// Wilderness stacked mini-cliff supports. Reuses the same CellGrid3D / DynamicSurfaces
// contract as the merged dungeon shaft, without quantizing the existing outdoor heightfield.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CliffElevatedSurfaces = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const mounts = new Map(); // areaId -> owned support scope, spatial cells and network revision.
  const debug = { mounts: 0, clears: 0, lastError: null }; // Mobile-readable lifecycle/registration checks.
  const scopeFor = area => 'wilderness-cliff-balconies:' + String(area);
  const cellKey = (c, r) => c + ',' + r;
  const STEP_HEIGHT = 0.42; // Match CellGrid3D.UNITS.MAX_STEP_HEIGHT when no grid is injected.
  const BODY_CLEARANCE = 8; // Eight 0.25-unit air cells: two world units of headroom.

  // Taken from ShaftHub.registerGroupedSupport: merge adjacent footprint cells
  // into horizontal runs and identical runs across rows before registering them.
  function groupedRectangles(cells) {
    const byRow = new Map(); // Integer row -> unique sorted columns owned by one balcony.
    for (const cell of cells || []) {
      const c = Number(cell?.c), r = Number(cell?.r);
      if (!Number.isInteger(c) || !Number.isInteger(r)) continue;
      if (!byRow.has(r)) byRow.set(r, new Set());
      byRow.get(r).add(c);
    }
    const rectangles = [], rows = [...byRow.keys()].sort((a, b) => a - b);
    let active = new Map(), lastRow = null;
    const flush = rect => rectangles.push({ ...rect });
    for (const row of rows) {
      if (lastRow !== null && row !== lastRow + 1) {
        for (const rect of active.values()) flush(rect);
        active.clear();
      }
      const columns = [...byRow.get(row)].sort((a, b) => a - b), spans = [];
      for (const c of columns) {
        const last = spans[spans.length - 1];
        if (last && last.maxC + 1 === c) last.maxC = c;
        else spans.push({ minC: c, maxC: c, minR: row, maxR: row });
      }
      const next = new Map();
      for (const span of spans) {
        const key = cellKey(span.minC, span.maxC), old = active.get(key);
        if (old && old.maxR === row - 1) {
          old.maxR = row;
          next.set(key, old);
        } else next.set(key, span);
      }
      for (const [key, rect] of active) if (!next.has(key)) flush(rect);
      active = next;
      lastRow = row;
    }
    for (const rect of active.values()) flush(rect);
    return rectangles;
  }

  function insideShelf(s, x, z, pad = 0) {
    const dx = x - s.x, dz = z - s.z;
    const along = dx * s.tangent.x + dz * s.tangent.z;
    const across = dx * s.normal.x + dz * s.normal.z;
    const profile = s.overhangDepths; // Dynamic supports follow the actual cap outline, not its maximum-depth bounding box.
    const u = Math.max(-1, Math.min(1, along / (s.width / 2))), i = u < 0 ? 0 : 1, t = u < 0 ? u + 1 : u;
    const depth = Array.isArray(profile) && profile.length === 3
      ? profile[i] + (profile[i + 1] - profile[i]) * t : s.depth;
    return Math.abs(along) <= s.width / 2 + pad &&
      across >= -s.depth / 2 - pad && across <= -s.depth / 2 + depth + pad;
  }

  function clear(area) {
    const id = String(area), state = mounts.get(id);
    if (!state) return false;
    state.DS.clearScope(state.scope); // Never dispose an unrelated dungeon or wilderness support.
    mounts.delete(id);
    debug.clears++;
    return true;
  }

  function mount(network, options = {}) {
    const area = String(options.area ?? network?.area ?? '');
    const DS = options.DynamicSurfaces || root.DynamicSurfaces;
    const CG = options.CellGrid3D || root.CellGrid3D;
    if (!network || !area || !DS?.registerSurface || !DS?.sampleSupport || !DS?.clearScope || !CG?.create) {
      debug.lastError = 'CliffElevatedSurfaces requires network, CellGrid3D and DynamicSurfaces';
      return { ok: false, reason: debug.lastError };
    }
    const existing = mounts.get(area);
    if (existing?.network === network && existing.DS === DS) return { ok: true, scope: existing.scope, supportCount: existing.supportCount };
    clear(area); // Rebuild from the current terrain. No stale collision records survive rerolls.

    const scope = scopeFor(area);
    const state = {
      area, scope, network, DS,
      byId: new Map(), // balcony ID -> its local 3D footprint grid, preserving exact float Y.
      supportCount: 0,
    };
    const isActive = options.isActive || (() => true); // Caller supplies its current-area check to exclude overlapping offscreen zones.
    state.isActive = isActive; // Movement queries share the support registry's area-enabled policy.
    try {
      for (const shelf of (network.balconies || [])) {
        if (!Number.isFinite(shelf?.y) || !Array.isArray(shelf.footprint) || !shelf.footprint.length) continue;
        const columns = shelf.footprint.map(c => c.c), rows = shelf.footprint.map(c => c.r);
        const minC = Math.min(...columns), maxC = Math.max(...columns);
        const minR = Math.min(...rows), maxR = Math.max(...rows);
        // Each independently mounted balcony has a small voxel footprint. Its
        // baseY follows the REAL unquantized terrain elevation, not 1-unit dungeon story levels.
        const grid = CG.create({
          cols: maxC - minC + 1, rows: maxR - minR + 1,
          levels: BODY_CLEARANCE + 2, cellSize: 1, cellHeight: 0.25,
          originX: minC, originZ: minR, baseY: shelf.y - 0.25,
        });
        for (const tile of shelf.footprint) grid.set(tile.c - minC, tile.r - minR, 0, CG.KIND.SOLID);
        const records = groupedRectangles(shelf.footprint);
        const contains = (x, z) => {
          if (!insideShelf(shelf, x, z, 0)) return false;
          const c = grid.xToCol(x), r = grid.zToRow(z);
          return grid.inBounds(c, r, 1) && grid.canStand(c, r, 1, BODY_CLEARANCE);
        };
        state.byId.set(shelf.id, { shelf, grid, records, contains });
        for (let i = 0; i < records.length; i++) {
          const rect = records[i];
          DS.registerSurface({
            id: scope + ':' + shelf.id + ':' + i,
            scope, shelfId: shelf.id,
            priority: 2, topY: shelf.y,
            bounds: { minX: rect.minC, maxX: rect.maxC + 1, minZ: rect.minR, maxZ: rect.maxR + 1 },
            supports: (x, z) => contains(x, z),
            enabled: () => !!isActive(),
          });
          state.supportCount++;
        }
      }
      mounts.set(area, state);
      debug.mounts++;
      debug.lastError = null;
      return { ok: true, scope, supportCount: state.supportCount };
    } catch (error) {
      DS.clearScope(scope); // Registration is atomic even if a bad shelf fails halfway through.
      debug.lastError = String(error?.message || error);
      return { ok: false, reason: debug.lastError };
    }
  }

  function ownsArea(area) {
    return mounts.has(String(area)); // Distinguishes 'no raised landing' from 'adapter not registered'.
  }
  function stateFor(network) {
    const state = mounts.get(String(network?.area ?? ''));
    return state?.network === network ? state : null; // Refuse stale topology after terrain edits.
  }

  // Shaft-style local-height sampling. A balcony overhead must never be chosen
  // as support while walking beneath it; only already-reachable heights count.
  function supportAt(network, x, z, referenceY, maxDrop = 8) {
    const state = stateFor(network);
    if (!state || ![x, z, referenceY].every(Number.isFinite)) return null;
    const step = root.CellGrid3D?.UNITS?.MAX_STEP_HEIGHT ?? STEP_HEIGHT;
    const support = state.DS.sampleSupport(x, z, {
      minY: referenceY - Math.max(0, maxDrop),
      maxY: referenceY + step + 0.01,
      scope: state.scope,
    });
    return support ? { shelf: state.byId.get(support.record.shelfId)?.shelf || null, id: support.id, y: support.y } : null;
  }

  function highestBelow(network, x, z, fromY, baseY = -Infinity) {
    const state = stateFor(network);
    if (!state || ![x, z, fromY].every(Number.isFinite)) return null;
    const support = state.DS.sampleSupport(x, z, {
      minY: Number.isFinite(baseY) ? baseY + 0.08 : -Infinity,
      maxY: fromY - 0.08,
      scope: state.scope,
    });
    return support ? state.byId.get(support.record.shelfId)?.shelf || null : null;
  }

  function canStandOn(network, shelfId, x, z, pad = -0.10) {
    const state = stateFor(network), record = state?.byId.get(shelfId);
    if (!record || !state.isActive() || ![x, z].every(Number.isFinite)) return false;
    const shelf = record.shelf, grid = record.grid;
    const c = grid.xToCol(x), r = grid.zToRow(z);
    if (!insideShelf(shelf, x, z, pad) || !grid.inBounds(c, r, 1) ||
        grid.walkDestinationLevel(c, r, 1, { maxDrop: 0, clearance: BODY_CLEARANCE }) !== 1) return false;
    // An upper deck can overlap horizontally; it still blocks standing if
    // its bottom is too close overhead. Never test an unbounded Y column.
    const overhead = state.DS.sampleSupport(x, z, {
      minY: shelf.y + 0.08, maxY: shelf.y + 1.8, scope: state.scope,
    });
    return !overhead;
  }

  function debugSnapshot() {
    return { ...debug, areas: [...mounts.values()].map(s => ({
      area: s.area, balconies: s.byId.size, supportRectangles: s.supportCount, scope: s.scope,
    })) };
  }
  return Object.freeze({ groupedRectangles, mount, clear, ownsArea, supportAt, highestBelow, canStandOn, debugSnapshot });
});
