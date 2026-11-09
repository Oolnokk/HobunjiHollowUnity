// RoomPlan — the room as a whole.
//
// Generation that places things one at a time has no memory of what the room already holds. A RoomPlan is that
// memory: a ledger of *claims* every module must make before it places anything, so each decision is made with
// the whole room in view.
//
//   claim(owner, shape, { kind, group? })  kind 'footprint' : floor the piece physically occupies (nothing else may overlap it,
//                                                     and it blocks walking)
//                                  kind 'clear'     : floor that must stay open for the owner to work (a rope's swing and
//                                                     the player's stand, a toppling pillar's path, a spawner's approach);
//                                                     other pieces' footprints may not cover it
//                                  kind 'zone'      : floor reserved as a gathering/arena area; footprints may not cover its
//                                                     centre but may sit inside it
//   solidFn()                      room.solid + every footprint: hand this to the solver so later decisions steer around
//                                  earlier ones
//   circulation()                  the zones that could reach each other before any claim must still reach each other after
//   budget                         caps on how much a room is allowed to hold (pieces, live enemies), so it stays readable
//
// Shapes: { type:'circle', x, z, r } or { type:'rect', minX, maxX, minZ, maxZ }.
// Pure logic; runs under node and in the browser.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RoomPlan = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const circle = (x, z, r) => ({ type: 'circle', x, z, r });
  const rect = (minX, maxX, minZ, maxZ) => ({ type: 'rect', minX, maxX, minZ, maxZ });
  const segment = (a, b, halfWidth) => ({ type: 'capsule', ax: a.x, az: a.z, bx: b.x, bz: b.z, r: halfWidth });

  function contains(shape, x, z) {
    if (shape.type === 'circle') return Math.hypot(x - shape.x, z - shape.z) <= shape.r;
    if (shape.type === 'rect') return x >= shape.minX && x <= shape.maxX && z >= shape.minZ && z <= shape.maxZ;
    if (shape.type === 'capsule') {
      const dx = shape.bx - shape.ax, dz = shape.bz - shape.az, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - shape.ax) * dx + (z - shape.az) * dz) / l2));
      return Math.hypot(x - (shape.ax + dx * t), z - (shape.az + dz * t)) <= shape.r;
    }
    return false;
  }
  function bounds(shape) {
    if (shape.type === 'circle') return { minX: shape.x - shape.r, maxX: shape.x + shape.r, minZ: shape.z - shape.r, maxZ: shape.z + shape.r };
    if (shape.type === 'capsule') return { minX: Math.min(shape.ax, shape.bx) - shape.r, maxX: Math.max(shape.ax, shape.bx) + shape.r, minZ: Math.min(shape.az, shape.bz) - shape.r, maxZ: Math.max(shape.az, shape.bz) + shape.r };
    return shape;
  }
  // Two shapes overlap if any sample of one lies in the other (sampling is plenty at floor-plan resolution).
  function samples(shape, step = 0.25) {
    const b = bounds(shape), out = [];
    for (let x = b.minX; x <= b.maxX + 1e-9; x += step) for (let z = b.minZ; z <= b.maxZ + 1e-9; z += step) if (contains(shape, x, z)) out.push({ x, z });
    if (!out.length) out.push({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 });
    return out;
  }
  function overlaps(a, b) {
    const ba = bounds(a), bb = bounds(b);
    if (ba.maxX < bb.minX || bb.maxX < ba.minX || ba.maxZ < bb.minZ || bb.maxZ < ba.minZ) return false;
    return samples(a).some(p => contains(b, p.x, p.z)) || samples(b).some(p => contains(a, p.x, p.z));
  }

  const DEFAULT_BUDGET = Object.freeze({ maxPieces: 18, maxEnemiesAlive: 8 });

  // room: { bounds:{minX,maxX,minZ,maxZ}, zones:{name:{x,z,r}}, gaps?:[{axis,start,end,crossMin,crossMax}], solid?(x,z) }
  function create(room, options = {}) {
    const claims = [];
    const budget = { ...DEFAULT_BUDGET, ...(options.budget || {}) };
    const cell = options.cell || 0.5;
    const roomSolid = (x, z) => (typeof room.solid === 'function' ? !!room.solid(x, z) : false);
    const inGap = (x, z) => (room.gaps || []).some(g => (g.axis === 'x' ? x > g.start && x < g.end && z >= g.crossMin && z <= g.crossMax : z > g.start && z < g.end && x >= g.crossMin && x <= g.crossMax));
    const nearGap = (p, margin = 0.8) => (room.gaps || []).some(g => (g.axis === 'x' ? p.x > g.start - margin && p.x < g.end + margin && p.z >= g.crossMin - margin && p.z <= g.crossMax + margin : p.z > g.start - margin && p.z < g.end + margin && p.x >= g.crossMin - margin && p.x <= g.crossMax + margin));
    const outOfBounds = (x, z) => x < room.bounds.minX || x > room.bounds.maxX || z < room.bounds.minZ || z > room.bounds.maxZ;

    const centre = shape => { const b = bounds(shape); return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 }; };
    // footprint x footprint, footprint x clear, and footprint x a zone's centre conflict; clear x clear and anything inside a zone's body do not.
    function conflicts(owner, shape, kind, group = owner) {
      const hits = [];
      for (const c of claims) {
        if (c.group === group) continue;
        let clash = false;
        if (kind === 'footprint') clash = c.kind === 'zone' ? contains(shape, centre(c.shape).x, centre(c.shape).z) : overlaps(shape, c.shape);
        else if (kind === 'clear') clash = c.kind === 'footprint' && overlaps(shape, c.shape);
        else if (kind === 'zone') clash = c.kind === 'footprint' && contains(c.shape, centre(shape).x, centre(shape).z);
        if (clash) hits.push(c);
      }
      return hits;
    }
    function canClaim(owner, shape, kind = 'footprint') { return conflicts(owner, shape, kind, owner).length === 0; }
    function claim(owner, shape, opts = {}) {
      const kind = opts.kind || 'footprint';
      const group = opts.group || owner, hits = conflicts(owner, shape, kind, group);
      if (hits.length) return { ok: false, conflicts: hits.map(h => ({ owner: h.owner, kind: h.kind, label: h.label })) };
      claims.push({ owner, group, shape, kind, label: opts.label || null });
      return { ok: true };
    }
    function release(owner) { let n = 0; for (let i = claims.length - 1; i >= 0; i--) if (claims[i].owner === owner) { claims.splice(i, 1); n++; } return n; }

    const footprintAt = (x, z) => claims.some(c => c.kind === 'footprint' && contains(c.shape, x, z));
    const solidFn = () => (x, z) => roomSolid(x, z) || footprintAt(x, z);

    // Connected components of the zone centres on a coarse grid; gaps and solids are walls.
    function components(blockFootprints) {
      const b = room.bounds, cols = Math.ceil((b.maxX - b.minX) / cell) + 1, rows = Math.ceil((b.maxZ - b.minZ) / cell) + 1;
      const blocked = new Uint8Array(cols * rows);
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { const x = b.minX + i * cell, z = b.minZ + j * cell; if (roomSolid(x, z) || inGap(x, z) || (blockFootprints && footprintAt(x, z))) blocked[i * rows + j] = 1; }
      const label = new Int32Array(cols * rows).fill(-1);
      const at = (x, z) => ({ i: Math.round((x - b.minX) / cell), j: Math.round((z - b.minZ) / cell) });
      const names = Object.keys(room.zones || {}), result = {};
      let next = 0;
      const fill = (i0, j0, id) => {
        const stack = [[i0, j0]]; label[i0 * rows + j0] = id;
        while (stack.length) {
          const [i, j] = stack.pop();
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue; const k = ni * rows + nj; if (blocked[k] || label[k] >= 0) continue; label[k] = id; stack.push([ni, nj]); }
        }
      };
      for (const name of names) {
        const z = room.zones[name], { i, j } = at(z.x, z.z);
        let ci = i, cj = j;
        if (ci >= 0 && cj >= 0 && ci < cols && cj < rows && blocked[ci * rows + cj] && !roomSolid(z.x, z.z) && !inGap(z.x, z.z)) { // something stands on the zone centre: use the nearest open cell inside the zone
          let best = Infinity;
          for (let a = 0; a < cols; a++) for (let c = 0; c < rows; c++) { if (blocked[a * rows + c]) continue; const d = Math.hypot(b.minX + a * cell - z.x, b.minZ + c * cell - z.z); if (d <= (z.r || 2) && d < best) { best = d; ci = a; cj = c; } }
        }
        if (ci < 0 || cj < 0 || ci >= cols || cj >= rows || blocked[ci * rows + cj]) { result[name] = -2; continue; } // the zone is walled in
        const i2 = ci, j2 = cj;
        if (label[i2 * rows + j2] < 0) fill(i2, j2, next++);
        result[name] = label[i2 * rows + j2];
      }
      return result;
    }
    // Can a walker get from point a to point b (gaps and solids are walls; footprints too unless `ignoreFootprints`)?
    function reaches(a, b, { ignoreFootprints = true } = {}) {
      const bb = room.bounds, cols = Math.ceil((bb.maxX - bb.minX) / cell) + 1, rows = Math.ceil((bb.maxZ - bb.minZ) / cell) + 1;
      const blockedAt = (x, z) => roomSolid(x, z) || inGap(x, z) || (!ignoreFootprints && footprintAt(x, z));
      const idx = p => ({ i: Math.round((p.x - bb.minX) / cell), j: Math.round((p.z - bb.minZ) / cell) });
      const A = idx(a), B = idx(b), seen = new Uint8Array(cols * rows), stack = [[A.i, A.j]];
      if (A.i < 0 || A.j < 0 || A.i >= cols || A.j >= rows || B.i < 0 || B.j < 0 || B.i >= cols || B.j >= rows) return false;
      seen[A.i * rows + A.j] = 1;
      while (stack.length) {
        const [i, j] = stack.pop();
        if (i === B.i && j === B.j) return true;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= cols || nj >= rows || seen[ni * rows + nj]) continue; if (blockedAt(bb.minX + ni * cell, bb.minZ + nj * cell) && !(ni === B.i && nj === B.j)) continue; seen[ni * rows + nj] = 1; stack.push([ni, nj]); }
      }
      return false;
    }
    // Which zones could reach which before any claim, and does every such pair still connect with the claims in place?
    function circulation() {
      const before = components(false), after = components(true), broken = [];
      const names = Object.keys(before);
      for (let a = 0; a < names.length; a++) for (let b = a + 1; b < names.length; b++) {
        const x = names[a], y = names[b];
        if (before[x] >= 0 && before[x] === before[y] && (after[x] < 0 || after[x] !== after[y])) broken.push([x, y]);
      }
      const walledIn = names.filter(n => before[n] >= 0 && after[n] === -2);
      return { ok: broken.length === 0 && walledIn.length === 0, broken, walledIn };
    }

    function pieceCount() { return new Set(claims.filter(c => c.kind === 'footprint').map(c => c.owner)).size; }
    const snapshot = () => ({ claims: claims.map(c => ({ owner: c.owner, kind: c.kind, label: c.label, shape: c.shape })), budget: { ...budget, pieces: pieceCount() } });

    return { room, budget, claim, canClaim, release, solidFn, circulation, reaches, snapshot, pieceCount, get claims() { return claims.slice(); }, inGap, nearGap, outOfBounds };
  }

  return Object.freeze({ create, circle, rect, segment, contains, overlaps, DEFAULT_BUDGET });
});
