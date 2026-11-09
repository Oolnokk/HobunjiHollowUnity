// ClimbWallTiles — climbable wall pieces authored as ordinary furniture.
//
// A wall tile is a 1-cell-wide, full-cell-tall furniture piece whose art is made to
// look continuous beside copies of itself, plus end-closing variants for the outermost
// tiles of a run. The piece carries a `climbWall` block; the mid piece lists its siblings:
//
//   climbWall: {
//     version: 1, enabled: true, style: 'ivy',
//     face: { side: '+z', offset: 0.5 },   // local face normal, and the face plane's signed
//                                          // distance from the tile centre along it (cells)
//     role: 'mid' | 'endLeft' | 'endRight' | 'single',
//     variants: { endLeft: 'key', endRight: 'key', single: 'key' }   // on the mid piece
//   }
//
// "Left"/"right" are as seen facing the wall from its open side. endLeft closes the
// run's left end, endRight its right end, single closes both (a run of one tile).
//
// This module is placement-agnostic: give it the cells where tiles go and it resolves
// which variant each cell needs, where/how to place each piece, and the merged climbable
// surface rectangles for ClimbSurfaces. Pure data/math; runs under node.
(function (root, factory) {
  const isCjs = typeof module === 'object' && module.exports;
  const api = factory(isCjs ? require('./cell-grid-3d.js') : root.CellGrid3D);
  if (isCjs) module.exports = api;
  else root.ClimbWallTiles = api;
})(typeof self !== 'undefined' ? self : globalThis, function (G) {
  'use strict';

  const VERSION = 1;
  const ROLES = Object.freeze(['mid', 'endLeft', 'endRight', 'single']);
  const SIDES = Object.freeze({ '+z': { x: 0, z: 1 }, '-z': { x: 0, z: -1 }, '+x': { x: 1, z: 0 }, '-x': { x: -1, z: 0 } });
  const DEG = 180 / Math.PI;
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || raw.enabled === false) return null;
    const side = SIDES[raw.face?.side] ? raw.face.side : '+z';
    const variants = {};
    for (const k of ['endLeft', 'endRight', 'single']) if (typeof raw.variants?.[k] === 'string' && raw.variants[k].trim()) variants[k] = raw.variants[k].trim();
    return {
      version: VERSION, enabled: true, style: String(raw.style || 'default'),
      face: { side, offset: num(raw.face?.offset, 0.5) },
      role: ROLES.includes(raw.role) ? raw.role : 'mid', variants,
    };
  }

  const dirOfNormal = n => (n.z < 0 ? G.DIR.N : n.x > 0 ? G.DIR.E : n.z > 0 ? G.DIR.S : G.DIR.W); // Same bits as CellGrid3D (N = -row).
  // Facing the wall from its open side, world "right" is (nz, -nx): +x for a +z wall, -x for a -z wall.
  const rightOf = n => ({ x: n.z === 0 ? 0 : n.z, z: n.x === 0 ? 0 : -n.x });
  // Yaw (degrees, +Z-based like the rest of the game) that turns a piece authored with its face on `side` so the face points along `normal`.
  const yawDegFor = (normal, side = '+z') => {
    const s = SIDES[side] || SIDES['+z'];
    const d = (Math.atan2(normal.x, normal.z) - Math.atan2(s.x, s.z)) * DEG;
    return ((Math.round(d * 1e6) / 1e6) % 360 + 360) % 360;
  };

  // tiles: [{ id, col, row, level, normal: {x,z}, style }]. Returns { variants: Map(id -> role),
  // runs: [[ids left->right]], duplicates: [id] }. Tiles join a run when they share wall plane,
  // facing, level and style and are neighbours along the wall.
  function resolveRuns(tiles) {
    const groups = new Map(), duplicates = [], variants = new Map(), runs = [];
    for (const t of tiles) {
      const n = t.normal, right = rightOf(n), p = t.col * right.x + t.row * right.z;
      const line = n.x !== 0 ? t.col : t.row; // the wall's plane: col for E/W walls, row for N/S
      const key = `${dirOfNormal(n)}|${line}|${t.level}|${t.style ?? ''}`;
      if (!groups.has(key)) groups.set(key, new Map());
      if (groups.get(key).has(p)) { duplicates.push(t.id); continue; }
      groups.get(key).set(p, t.id);
    }
    for (const byPos of groups.values()) {
      const sorted = [...byPos.keys()].sort((a, b) => a - b);
      let run = [];
      const flush = () => {
        if (!run.length) return;
        const ids = run.map(p => byPos.get(p));
        runs.push(ids);
        ids.forEach((id, i) => variants.set(id, ids.length === 1 ? 'single' : i === 0 ? 'endLeft' : i === ids.length - 1 ? 'endRight' : 'mid'));
        run = [];
      };
      for (const p of sorted) { if (run.length && p !== run[run.length - 1] + 1) flush(); run.push(p); }
      flush();
    }
    return { variants, runs, duplicates };
  }

  // Which authored piece to place for `role`, given the mid piece's key and block. Missing variants fall back to mid.
  function variantKey(midKey, midBlock, role) {
    const b = normalize(midBlock);
    return role === 'mid' || !b ? midKey : (b.variants[role] || midKey);
  }

  // World placement of one tile's piece. geom = { originX, originZ, baseY, cellSize, cellHeight }.
  function placementFor(tile, geom = {}, block = null) {
    const cs = num(geom.cellSize, G.UNITS.CELL_SIZE), ch = num(geom.cellHeight, G.UNITS.CELL_HEIGHT);
    const b = normalize(block);
    return {
      x: num(geom.originX, 0) + (tile.col + 0.5) * cs, z: num(geom.originZ, 0) + (tile.row + 0.5) * cs, y: num(geom.baseY, 0) + tile.level * ch,
      yawDeg: yawDegFor(tile.normal, b?.face.side || '+z'),
    };
  }

  // Climb faces for tiles; `block` supplies the face plane (offset from centre, in cells).
  function toFaces(tiles, block) {
    const b = normalize(block);
    if (!b) return [];
    const inset = 0.5 - b.face.offset; // distance from the cell edge back toward the centre
    return tiles.map(t => ({ c: t.col, r: t.row, l: t.level, dir: dirOfNormal(t.normal), style: t.style ?? b.style, inset }));
  }
  const toSurfaces = (tiles, block, geom) => G.mergeClimbFaces(toFaces(tiles, block), geom);

  // Registers the tiles' merged surfaces with ClimbSurfaces. Returns the count.
  function register(climbSurfaces, tiles, block, geom, options = {}) {
    const scope = options.scope ?? 'climb-wall-tiles', prefix = options.idPrefix ?? 'cwt';
    let n = 0;
    for (const raw of toSurfaces(tiles, block, geom)) {
      climbSurfaces.register({ ...raw, id: `${prefix}-${raw.facing}-${raw.plane}-${raw.u0}-${raw.y0}`, scope });
      n++;
    }
    return n;
  }

  // Authoring sanity checks for a set: returns strings. getBlock(key) -> climbWall block of that piece (or null).
  function validateSet(midKey, getBlock) {
    const problems = [], mid = normalize(getBlock(midKey));
    if (!mid) return [`${midKey}: no enabled climbWall block`];
    if (mid.role !== 'mid') problems.push(`${midKey}: the set root must have role "mid" (is "${mid.role}")`);
    for (const role of ['endLeft', 'endRight', 'single']) {
      const key = mid.variants[role];
      if (!key) { problems.push(`${midKey}: no ${role} variant (the mid piece will be used instead)`); continue; }
      const b = normalize(getBlock(key));
      if (!b) problems.push(`${key}: ${role} variant has no enabled climbWall block`);
      else {
        if (b.role !== role) problems.push(`${key}: should have role "${role}" (is "${b.role}")`);
        if (b.style !== mid.style) problems.push(`${key}: style "${b.style}" differs from the mid piece's "${mid.style}"`);
        if (b.face.side !== mid.face.side || Math.abs(b.face.offset - mid.face.offset) > 1e-6) problems.push(`${key}: face plane differs from the mid piece, so the climb surface would not line up`);
      }
    }
    return problems;
  }

  return Object.freeze({ VERSION, ROLES, SIDES, normalize, dirOfNormal, rightOf, yawDegFor, resolveRuns, variantKey, placementFor, toFaces, toSurfaces, register, validateSet });
});
