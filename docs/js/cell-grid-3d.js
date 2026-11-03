// CellGrid3D — the ordinary (col, row) tile grid with a third axis, "level".
//
// A cell is one world unit wide and one world unit tall (true cubes), so every
// authored piece can be measured in whole cells: a pillar is 1x1x4, a door is
// 1x1x2, a balcony is Nx1xM. The legacy 2D grid is exactly one slice of this:
// sliceToTileGrid(level, clearance, ...) returns a grid[row][col] in the shape
// movement, AI and projectile code already consume, as seen by an entity that
// stands at `level`. Nothing that reads the 2D grid has to learn about height;
// the one that owns an entity just asks for the slice at that entity's level.
//
// Conventions
//   level l spans world y in [baseY + l*cellHeight, baseY + (l+1)*cellHeight).
//   A SOLID cell at level l has its top face at levelToY(l + 1).
//   An entity "stands at level L" when its feet are in the AIR cell at level L
//   and the cell below (L-1) is solid, so its feet are at levelToY(L).
//   Out of bounds: sideways and below level 0 count as solid (bedrock/walls);
//   above the top level counts as air.
//
// Climbable faces are a per-cell side flag (N/E/S/W) on a SOLID cell whose
// neighbour in that direction is AIR. collectClimbSurfaces() greedy-merges
// them into rectangles for the ClimbSurfaces runtime.
//
// This module is pure data + math (no THREE, no DOM) so it runs under node.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CellGrid3D = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const EPS = 1e-6;

  // The single place these numbers live. 0.42 is the existing step limit
  // (MAX_STEP_HEIGHT in dev-random-ruin-interior-map.js, plateau stepHeight):
  // a full cube is deliberately NOT steppable; use stairs, a ledge, or a climb.
  const UNITS = Object.freeze({
    CELL_SIZE: 1,
    CELL_HEIGHT: 1,
    MAX_STEP_HEIGHT: 0.42,
    CLEARANCE_CELLS: 2, // Cells of headroom an upright player needs.
  });

  const KIND = Object.freeze({ AIR: 0, SOLID: 1 });
  const DIR = Object.freeze({ N: 1, E: 2, S: 4, W: 8 }); // N = -row, E = +col, S = +row, W = -col.
  const DIR_VEC = Object.freeze({ 1: [0, -1], 2: [1, 0], 4: [0, 1], 8: [-1, 0] });
  const DIR_NAMES = Object.freeze({ 1: 'N', 2: 'E', 4: 'S', 8: 'W' });

  // ---------------------------------------------------------------- units

  // Whole cells needed to contain `height` world units (a 3.2-tall ladder is 4).
  function heightToCells(height, cellHeight = UNITS.CELL_HEIGHT) {
    const h = Number(height);
    return Number.isFinite(h) && h > 0 ? Math.max(1, Math.ceil(h / cellHeight - EPS)) : 0;
  }

  // Cell-aligned extent of an axis-aligned world box, for measuring pieces.
  // box = { minX, maxX, minY, maxY, minZ, maxZ } relative to the grid origin.
  function measureBox(box, cellSize = UNITS.CELL_SIZE, cellHeight = UNITS.CELL_HEIGHT) {
    const lo = (v, s) => Math.floor(v / s + EPS), hi = (v, s) => Math.ceil(v / s - EPS) - 1;
    const c0 = lo(box.minX, cellSize), c1 = Math.max(c0, hi(box.maxX, cellSize));
    const r0 = lo(box.minZ, cellSize), r1 = Math.max(r0, hi(box.maxZ, cellSize));
    const l0 = lo(box.minY, cellHeight), l1 = Math.max(l0, hi(box.maxY, cellHeight));
    return { c0, c1, r0, r1, l0, l1, cellsW: c1 - c0 + 1, cellsD: r1 - r0 + 1, cellsH: l1 - l0 + 1 };
  }

  // ---------------------------------------------------------------- grid

  function create(options = {}) {
    const cols = Math.max(1, options.cols | 0), rows = Math.max(1, options.rows | 0), levels = Math.max(1, options.levels | 0);
    const cellSize = Number(options.cellSize) || UNITS.CELL_SIZE;
    const cellHeight = Number(options.cellHeight) || UNITS.CELL_HEIGHT;
    const originX = Number(options.originX) || 0, originZ = Number(options.originZ) || 0, baseY = Number(options.baseY) || 0;
    const cells = new Uint8Array(cols * rows * levels);
    const climb = new Map(); // cell index -> { mask, styles: { [dirBit]: styleId } }

    const index = (c, r, l) => (l * rows + r) * cols + c;
    const inBounds = (c, r, l) => c >= 0 && r >= 0 && l >= 0 && c < cols && r < rows && l < levels;

    const levelToY = l => baseY + l * cellHeight;
    const yToLevel = y => Math.floor((y - baseY) / cellHeight + EPS);
    const colToX = c => originX + c * cellSize;
    const rowToZ = r => originZ + r * cellSize;
    const xToCol = x => Math.floor((x - originX) / cellSize + EPS);
    const zToRow = z => Math.floor((z - originZ) / cellSize + EPS);

    function get(c, r, l) {
      if (l < 0) return KIND.SOLID;
      if (c < 0 || r < 0 || c >= cols || r >= rows) return KIND.SOLID;
      if (l >= levels) return KIND.AIR;
      return cells[index(c, r, l)];
    }
    const isSolid = (c, r, l) => get(c, r, l) === KIND.SOLID;

    function set(c, r, l, kind) {
      if (!inBounds(c, r, l)) return false;
      cells[index(c, r, l)] = kind;
      if (kind !== KIND.SOLID) climb.delete(index(c, r, l)); // Faces only exist on solids.
      return true;
    }

    function fillBox(c0, r0, l0, c1, r1, l1, kind) {
      let n = 0;
      for (let l = Math.min(l0, l1); l <= Math.max(l0, l1); l++)
        for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++)
          for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) if (set(c, r, l, kind)) n++;
      return n;
    }

    // ------------------------------------------------------- standing

    function hasHeadroom(c, r, l, clearance = UNITS.CLEARANCE_CELLS) {
      for (let k = 0; k < clearance; k++) if (isSolid(c, r, l + k)) return false;
      return true;
    }
    // Feet in the air cell at `l`, solid directly below, room above.
    function canStand(c, r, l, clearance = UNITS.CLEARANCE_CELLS) {
      return isSolid(c, r, l - 1) && hasHeadroom(c, r, l, clearance);
    }
    // First standable level at or below `fromLevel`, no more than maxDrop cells down; -1 if none.
    function floorLevelAt(c, r, fromLevel, options = {}) {
      const clearance = options.clearance ?? UNITS.CLEARANCE_CELLS, maxDrop = options.maxDrop ?? Infinity;
      for (let l = fromLevel, drop = 0; drop <= maxDrop && l >= 0; l--, drop++) {
        if (!hasHeadroom(c, r, l, clearance)) return -1; // Something solid at body height above this air: nothing to stand on here.
        if (isSolid(c, r, l - 1)) return l;
      }
      return -1;
    }
    // Level an entity at (fromLevel) ends up on after walking onto column (c, r):
    // same level if it can stand there, otherwise it may drop up to maxDrop cells.
    // Never climbs: a full cube is taller than the step limit. -1 = blocked.
    function walkDestinationLevel(c, r, fromLevel, options = {}) {
      const clearance = options.clearance ?? UNITS.CLEARANCE_CELLS, maxDrop = options.maxDrop ?? 1;
      if (!hasHeadroom(c, r, fromLevel, clearance)) return -1;
      return floorLevelAt(c, r, fromLevel, { clearance, maxDrop });
    }

    // 2D view of the grid for an entity standing at `level`: 1 = blocked.
    function projectSlice(level, clearance = UNITS.CLEARANCE_CELLS) {
      const out = new Uint8Array(cols * rows);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out[r * cols + c] = hasHeadroom(c, r, level, clearance) ? 0 : 1;
      return out;
    }
    // Same slice in the legacy grid[row][col] tile shape. The caller supplies the
    // tile factories so existing tile types (ROCK etc.) stay owned by their module.
    function sliceToTileGrid(level, clearance, solidTile, openTile) {
      const slice = projectSlice(level, clearance), grid = [];
      for (let r = 0; r < rows; r++) {
        const row = new Array(cols);
        for (let c = 0; c < cols; c++) row[c] = slice[r * cols + c] ? solidTile(c, r, level) : openTile(c, r, level);
        grid.push(row);
      }
      return grid;
    }

    // Every walkable top face as a world-space rectangle, for DynamicSurfaces.
    function standingSurfaces(options = {}) {
      const clearance = options.clearance ?? 1, out = [];
      for (let l = 0; l <= levels; l++) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (!isSolid(c, r, l - 1) || !hasHeadroom(c, r, l, clearance)) continue; // l = 0 stands on implicit bedrock.
        out.push({ col: c, row: r, level: l, minX: colToX(c), maxX: colToX(c + 1), minZ: rowToZ(r), maxZ: rowToZ(r + 1), topY: levelToY(l) });
      }
      return out;
    }
    // Registers those faces with DynamicSurfaces. NOTE: sampleSupport returns the HIGHEST
    // surface in its y band, so callers must pass minY/maxY relative to the entity's
    // current support (e.g. maxY = supportY + MAX_STEP_HEIGHT), never a fixed band, or an
    // overhead balcony is mistaken for the floor.
    function registerWith(DS, options = {}) {
      const scope = options.scope ?? 'cell-grid-3d', prefix = options.idPrefix ?? 'cg3d', list = standingSurfaces(options);
      for (const s of list) DS.registerSurface({ id: `${prefix}-${s.col},${s.row},${s.level}`, scope, bounds: { minX: s.minX, maxX: s.maxX, minZ: s.minZ, maxZ: s.maxZ }, topY: s.topY, priority: options.priority ?? 1 });
      return list.length;
    }

    // ------------------------------------------------------- climbing

    function setClimbFace(c, r, l, dir, style = 'default') {
      if (!DIR_VEC[dir] || !isSolid(c, r, l) || !inBounds(c, r, l)) return false;
      const [dc, dr] = DIR_VEC[dir];
      if (isSolid(c + dc, r + dr, l)) return false; // A face is only reachable if the neighbour is open.
      const key = index(c, r, l), entry = climb.get(key) || { mask: 0, styles: {} };
      entry.mask |= dir; entry.styles[dir] = String(style);
      climb.set(key, entry);
      return true;
    }
    function clearClimbFace(c, r, l, dir) {
      const entry = climb.get(index(c, r, l));
      if (!entry) return false;
      entry.mask &= ~dir; delete entry.styles[dir];
      if (!entry.mask) climb.delete(index(c, r, l));
      return true;
    }
    function climbFaceAt(c, r, l, dir) {
      const entry = inBounds(c, r, l) ? climb.get(index(c, r, l)) : null;
      return entry && (entry.mask & dir) && isSolid(c, r, l) ? entry.styles[dir] : null;
    }
    // Marks a whole wall rectangle: the faces of solid cells in [c0..c1] x [r0..r1] x [l0..l1] looking `dir`.
    function paintClimbFaces(c0, r0, l0, c1, r1, l1, dir, style) {
      let n = 0;
      for (let l = Math.min(l0, l1); l <= Math.max(l0, l1); l++)
        for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++)
          for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) if (setClimbFace(c, r, l, dir, style)) n++;
      return n;
    }

    // Greedy-merged rectangles of coplanar, same-style faces. `u` runs along the
    // wall (col for N/S faces, row for E/W), `v` is up. Consumed by ClimbSurfaces.
    function collectClimbSurfaces() {
      const byGroup = new Map(); // `${dir}|${style}|${plane}` -> Map(`${u},${l}`)
      for (const [key, entry] of climb) {
        const c = key % cols, r = Math.floor(key / cols) % rows, l = Math.floor(key / (cols * rows));
        for (const dir of [DIR.N, DIR.E, DIR.S, DIR.W]) {
          if (!(entry.mask & dir) || !isSolid(c, r, l)) continue;
          const alongZ = dir === DIR.E || dir === DIR.W; // E/W faces are walls running along z.
          const plane = alongZ ? c : r, u = alongZ ? r : c;
          const gk = `${dir}|${entry.styles[dir]}|${plane}`;
          if (!byGroup.has(gk)) byGroup.set(gk, new Set());
          byGroup.get(gk).add(`${u},${l}`);
        }
      }
      const surfaces = [];
      for (const [gk, set_] of byGroup) {
        const [dirStr, style, planeStr] = gk.split('|'), dir = Number(dirStr), plane = Number(planeStr);
        const alongZ = dir === DIR.E || dir === DIR.W;
        const has = (u, l) => set_.has(`${u},${l}`);
        const used = new Set(), sorted = [...set_].map(s => s.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
        for (const [u, l] of sorted) {
          if (used.has(`${u},${l}`)) continue;
          let u1 = u; while (has(u1 + 1, l) && !used.has(`${u1 + 1},${l}`)) u1++;
          let l1 = l;
          for (;;) { let full = true; for (let k = u; k <= u1; k++) if (!has(k, l1 + 1) || used.has(`${k},${l1 + 1}`)) { full = false; break; } if (!full) break; l1++; }
          for (let ll = l; ll <= l1; ll++) for (let k = u; k <= u1; k++) used.add(`${k},${ll}`);
          // World placement: the face lies on the +/- side of the solid cell along its normal.
          const planeCoord = alongZ ? colToX(plane + (dir === DIR.E ? 1 : 0)) : rowToZ(plane + (dir === DIR.S ? 1 : 0));
          const [nx, nz] = DIR_VEC[dir];
          surfaces.push({
            dir, facing: DIR_NAMES[dir], style, normal: { x: nx, z: nz },
            plane: planeCoord, // x for E/W faces, z for N/S faces
            axis: alongZ ? 'z' : 'x', // the world axis that `u0..u1` runs along
            u0: alongZ ? rowToZ(u) : colToX(u), u1: alongZ ? rowToZ(u1 + 1) : colToX(u1 + 1),
            y0: levelToY(l), y1: levelToY(l1 + 1),
            levels: [l, l1], span: [u, u1],
          });
        }
      }
      return surfaces.sort((a, b) => a.y0 - b.y0 || a.dir - b.dir || a.plane - b.plane || a.u0 - b.u0);
    }

    function stats() {
      let solid = 0; for (let i = 0; i < cells.length; i++) if (cells[i] === KIND.SOLID) solid++;
      return { cols, rows, levels, solid, climbCells: climb.size, cellSize, cellHeight };
    }

    return Object.freeze({
      cols, rows, levels, cellSize, cellHeight, originX, originZ, baseY, cells,
      inBounds, get, set, isSolid, fillBox,
      levelToY, yToLevel, colToX, rowToZ, xToCol, zToRow,
      hasHeadroom, canStand, floorLevelAt, walkDestinationLevel,
      projectSlice, sliceToTileGrid, standingSurfaces, registerWith,
      setClimbFace, clearClimbFace, climbFaceAt, paintClimbFaces, collectClimbSurfaces, stats,
    });
  }

  // Lifts a legacy 2D floor into 3D. heightAt(c, r) returns the floor's world y
  // for that cell, or null/undefined for a void. Heights quantise DOWN to whole
  // cells (a 0.84 plateau becomes level 0 + one 0.0 cell), reported in
  // `maxQuantizationError` so callers can see what the cubic grid cannot express.
  function fromHeightfield(options = {}) {
    const grid = create(options);
    let maxError = 0;
    for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
      const h = options.heightAt?.(c, r);
      if (h == null || !Number.isFinite(Number(h))) continue;
      const solidTop = Math.max(0, Math.floor((Number(h) - grid.baseY) / grid.cellHeight + EPS)); // Solids fill levels [0, solidTop).
      maxError = Math.max(maxError, Number(h) - grid.levelToY(solidTop));
      if (solidTop > 0) grid.fillBox(c, r, 0, c, r, Math.min(solidTop, grid.levels) - 1, KIND.SOLID); // fillBox normalises reversed bounds, so an empty range must not reach it.
    }
    return { grid, maxQuantizationError: maxError };
  }

  return Object.freeze({ UNITS, KIND, DIR, DIR_NAMES, create, fromHeightfield, heightToCells, measureBox });
});
