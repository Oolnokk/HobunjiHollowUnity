// FurnitureElevation — the `elevation` block on authored furniture: how many whole
// cubic cells (CellGrid3D units) a piece occupies, measured from its geometry with
// optional manual overrides. Generators (e.g. the shaft-hub composer) read this to
// snap pieces to the 3D grid instead of guessing heights.
//
//   elevation: {
//     version: 1,
//     mode: 'auto' | 'manual',          // manual lets `manual.*` win field by field
//     measured: { sizeX, sizeY, sizeZ, minY, maxY, cellsW, cellsD, cellsH } | null,
//     manual:   { cellsW?, cellsD?, cellsH? }
//   }
//
// The Furniture Author fills `measured` from the preview scene's bounding box
// (measureBounds takes any { min, max } box, so THREE.Box3 works directly). Pure
// data/math; runs under node.
(function (root, factory) {
  const grid = typeof module === 'object' && module.exports ? require('./cell-grid-3d.js') : root.CellGrid3D;
  const api = factory(grid);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FurnitureElevation = api;
})(typeof self !== 'undefined' ? self : globalThis, function (G) {
  'use strict';

  const VERSION = 1;
  const MEASURE_TOLERANCE = 1e-3; // A piece authored at exactly 1.0 must not measure as 2 cells because of float fuzz.
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const cellsOf = (size, unit, tol) => (size > tol ? Math.max(1, Math.ceil(size / unit - tol)) : 0);
  const posInt = v => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 1 ? n : undefined; };

  // box = { min: {x,y,z}, max: {x,y,z} } in furniture-local units (origin at the footprint centre, y up).
  function measureBounds(box, options = {}) {
    if (!box?.min || !box?.max) return null;
    const unit = G.UNITS.CELL_SIZE, unitY = G.UNITS.CELL_HEIGHT, tol = options.tolerance ?? MEASURE_TOLERANCE;
    const sizeX = num(box.max.x) - num(box.min.x), sizeY = num(box.max.y) - num(box.min.y), sizeZ = num(box.max.z) - num(box.min.z);
    if (!(sizeX >= 0 && sizeY >= 0 && sizeZ >= 0) || (sizeX === 0 && sizeY === 0 && sizeZ === 0)) return null;
    const r = v => Math.round(v * 1000) / 1000;
    return {
      sizeX: r(sizeX), sizeY: r(sizeY), sizeZ: r(sizeZ), minY: r(num(box.min.y)), maxY: r(num(box.max.y)),
      cellsW: cellsOf(sizeX, unit, tol), cellsD: cellsOf(sizeZ, unit, tol), cellsH: cellsOf(sizeY, unitY, tol),
    };
  }

  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const m = raw.measured && typeof raw.measured === 'object' ? raw.measured : null;
    const measured = m ? {
      sizeX: num(m.sizeX), sizeY: num(m.sizeY), sizeZ: num(m.sizeZ), minY: num(m.minY), maxY: num(m.maxY),
      cellsW: posInt(m.cellsW) ?? 0, cellsD: posInt(m.cellsD) ?? 0, cellsH: posInt(m.cellsH) ?? 0,
    } : null;
    const manual = {};
    for (const k of ['cellsW', 'cellsD', 'cellsH']) { const v = posInt(raw.manual?.[k]); if (v !== undefined) manual[k] = v; }
    return { version: VERSION, mode: raw.mode === 'manual' ? 'manual' : 'auto', measured, manual };
  }

  // What generators should use: measured cells, with manual fields overriding when mode is 'manual'.
  function effective(block) {
    const b = normalize(block);
    if (!b) return { cellsW: 0, cellsD: 0, cellsH: 0, heightWorld: 0, source: 'none' };
    const pick = k => (b.mode === 'manual' && b.manual[k] !== undefined ? b.manual[k] : (b.measured?.[k] ?? 0));
    const anyManual = b.mode === 'manual' && Object.keys(b.manual).length > 0;
    const cellsW = pick('cellsW'), cellsD = pick('cellsD'), cellsH = pick('cellsH');
    return { cellsW, cellsD, cellsH, heightWorld: cellsH * G.UNITS.CELL_HEIGHT, source: anyManual ? 'manual' : (b.measured ? 'measured' : 'none') };
  }

  // Problems (strings) if the piece isn't the required size in cells. Empty array = fits.
  function checkCells(block, want) {
    const e = effective(block), problems = [];
    if (e.source === 'none') return ['not measured yet'];
    for (const [k, label] of [['cellsW', 'width'], ['cellsD', 'depth'], ['cellsH', 'height']]) {
      if (want?.[k] !== undefined && e[k] !== want[k]) problems.push(`${label} is ${e[k]} cell${e[k] === 1 ? '' : 's'}, expected ${want[k]}`);
    }
    return problems;
  }

  return Object.freeze({ VERSION, MEASURE_TOLERANCE, measureBounds, normalize, effective, checkCells });
});
