// RuinWallFaces — the exposed faces of a voxel grid (or a set of thin edge walls) as large flat quads.
//
// The shaft hub and the puzzle wings used to draw every wall as a field of one-unit instanced boxes, so the
// stone texture repeated once per world unit and no face was ever a surface: nothing could stretch a texture
// across a wall or engrave it the way the older V50 rooms are. This builds the faces themselves. Neighbouring
// faces in one plane merge into maximal rectangles (greedy meshing); each rectangle is then cut into patches no
// bigger than `patch` world units, and every patch gets UVs 0..1, so a patch is one texture stretched to fit.
// Walls keep the texture upright (v = world y). One mesh with these quads is made of real flat face regions, so
// FurniturePatternSurfaces.decorateRuin can find and engrave the broad vertical ones.
//
// Pure over plain data (indices in, typed arrays out); runs under node and in the browser. Collision is not
// touched: the voxel grid stays the authority and this is the visual only.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RuinWallFaces = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // For each face axis, which cell indices its two tangent directions run along: [first, second].
  // x faces tangent along z (rows) and y (levels); y faces along x (cols) and z (rows); z faces along x and y.
  const TANGENTS = { x: ['r', 'l'], y: ['c', 'r'], z: ['c', 'l'] };

  // Maximal rectangles of true cells in a w*h mask (greedy). Returns { i0, j0, i1, j1 } with exclusive ends.
  function mergeMask(mask, w, h) {
    const used = new Uint8Array(w * h), rects = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      if (!mask[j * w + i] || used[j * w + i]) continue;
      let i1 = i;
      while (i1 + 1 < w && mask[j * w + i1 + 1] && !used[j * w + i1 + 1]) i1++;
      let j1 = j;
      grow: while (j1 + 1 < h) {
        for (let k = i; k <= i1; k++) if (!mask[(j1 + 1) * w + k] || used[(j1 + 1) * w + k]) break grow;
        j1++;
      }
      for (let y = j; y <= j1; y++) for (let x = i; x <= i1; x++) used[y * w + x] = 1;
      rects.push({ i0:i, j0:j, i1:i1 + 1, j1:j1 + 1 });
    }
    return rects;
  }

  // Every exposed face between a solid cell and an in-bounds non-solid neighbour, merged per plane.
  // Cells outside the grid are unknown, never solid: no face is made against them, so a doorway that
  // opens through the edge of the grid stays open. Returns [{ axis, side, plane, a0, a1, b0, b1 }]; the
  // plane is the face's index along its axis, and a/b are exclusive-end ranges along TANGENTS[axis].
  function voxelFaces({ cols, rows, levels, isSolid }) {
    const dims = { c:cols, r:rows, l:levels }, rects = [];
    const inside = (c, r, l) => c >= 0 && r >= 0 && l >= 0 && c < cols && r < rows && l < levels;
    const solid = (c, r, l) => inside(c, r, l) && !!isSolid(c, r, l);
    const air = (c, r, l) => inside(c, r, l) && !isSolid(c, r, l);
    const axisIndex = { x:'c', y:'l', z:'r' };
    for (const axis of ['x', 'y', 'z']) {
      const [ta, tb] = TANGENTS[axis], along = axisIndex[axis];
      const wa = dims[ta], wb = dims[tb];
      for (let plane = 0; plane <= dims[along]; plane++) for (const side of [1, -1]) {
        const mask = new Uint8Array(wa * wb);
        let any = false;
        for (let b = 0; b < wb; b++) for (let a = 0; a < wa; a++) {
          const at = p => { const idx = { c:0, r:0, l:0 }; idx[along] = p; idx[ta] = a; idx[tb] = b; return [idx.c, idx.r, idx.l]; };
          const inner = at(side > 0 ? plane - 1 : plane), outer = at(side > 0 ? plane : plane - 1);
          if (solid(...inner) && air(...outer)) { mask[b * wa + a] = 1; any = true; }
        }
        if (!any) continue;
        for (const rect of mergeMask(mask, wa, wb)) rects.push({ axis, side, plane, a0:rect.i0, a1:rect.i1, b0:rect.j0, b1:rect.j1 });
      }
    }
    return rects;
  }

  // Splits [lo, hi) into near-equal integer parts no longer than `max` cells.
  function parts(lo, hi, max) {
    const length = hi - lo, count = Math.max(1, Math.ceil(length / Math.max(1, max)));
    const out = [];
    for (let i = 0; i < count; i++) out.push([lo + Math.round(length * i / count), lo + Math.round(length * (i + 1) / count)]);
    return out.filter(([a, b]) => b > a);
  }

  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  // Turns rectangles into quad geometry in world units.
  //   origin / size  world position of index 0 and the world length of one cell, per x / y / z
  //   patch          { h, v }: the largest a patch may be, in world units, horizontally and vertically
  // Each patch is its own quad with UVs 0..1 (stretch to fit). Quads wind counter-clockwise seen from outside.
  function buildQuads(rects, { origin, size, patch = { h:6, v:6 } }) {
    const positions = [], normals = [], uvs = [], indices = [];
    const world = (axis, plane, a, b) => { // plane, a, b are world coordinates
      if (axis === 'x') return [plane, b, a];
      if (axis === 'y') return [a, plane, b];
      return [a, b, plane];
    };
    const unitOf = { x:'x', y:'y', z:'z' };
    for (const rect of rects) {
      const [ta, tb] = TANGENTS[rect.axis];
      const sizeA = size[{ c:'x', r:'z', l:'y' }[ta]], sizeB = size[{ c:'x', r:'z', l:'y' }[tb]];
      const originA = origin[{ c:'x', r:'z', l:'y' }[ta]], originB = origin[{ c:'x', r:'z', l:'y' }[tb]];
      const planeWorld = origin[unitOf[rect.axis]] + rect.plane * size[unitOf[rect.axis]];
      // Horizontal and vertical patch limits follow the walls' own orientation: upright for x/z faces, flat for y faces.
      const limitA = Math.max(1, Math.floor(patch.h / sizeA)), limitB = Math.max(1, Math.floor((rect.axis === 'y' ? patch.h : patch.v) / sizeB));
      const outward = { x:[0, 0, 0], y:[0, 0, 0], z:[0, 0, 0] }[rect.axis]; outward[{ x:0, y:1, z:2 }[rect.axis]] = rect.side;
      for (const [a0, a1] of parts(rect.a0, rect.a1, limitA)) for (const [b0, b1] of parts(rect.b0, rect.b1, limitB)) {
        const A0 = originA + a0 * sizeA, A1 = originA + a1 * sizeA, B0 = originB + b0 * sizeB, B1 = originB + b1 * sizeB;
        let corners = [[A0, B0, 0, 0], [A1, B0, 1, 0], [A1, B1, 1, 1], [A0, B1, 0, 1]].map(([A, B, u, v]) => ({ p:world(rect.axis, planeWorld, A, B), u, v }));
        if (dot(cross(sub(corners[1].p, corners[0].p), sub(corners[3].p, corners[0].p)), outward) < 0) corners = [corners[0], corners[3], corners[2], corners[1]];
        const base = positions.length / 3;
        for (const corner of corners) { positions.push(...corner.p); normals.push(...outward); uvs.push(corner.u, corner.v); }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    return { positions:new Float32Array(positions), normals:new Float32Array(normals), uvs:new Float32Array(uvs), indices:positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices) };
  }

  // Thin walls given as unit edges: [{ along:'x'|'z', line, from, to, side? }] in world units, each a run on the line
  // z = `line` (along x) or x = `line` (along z). `side` (+1 or -1) is the way the wall faces, i.e. where the walkable
  // floor is; left out, the wall is seen from both ways. Edges on one line and side merge when they touch.
  // Returns the merged runs, sorted, in the same shape.
  function mergeEdges(edges) {
    const byLine = new Map();
    for (const edge of edges) {
      const key = edge.along + ':' + Math.round(edge.line * 1000) + ':' + (edge.side || 0);
      if (!byLine.has(key)) byLine.set(key, []);
      byLine.get(key).push(edge);
    }
    const runs = [];
    for (const group of byLine.values()) {
      group.sort((p, q) => p.from - q.from);
      let current = null;
      for (const edge of group) {
        if (current && edge.from <= current.to + 1e-6) current.to = Math.max(current.to, edge.to);
        else {
          if (current) runs.push(current);
          current = { along:edge.along, line:edge.line, from:edge.from, to:edge.to };
          if (edge.side) current.side = edge.side;
        }
      }
      if (current) runs.push(current);
    }
    return runs.sort((p, q) => (p.along < q.along ? -1 : p.along > q.along ? 1 : p.line - q.line || (p.side || 0) - (q.side || 0) || p.from - q.from));
  }

  // Quads for thin walls, set `thickness / 2` off the line so the face keeps the old slab's silhouette. A run with a
  // `side` gets one face, the one you can see; without, two (one each way) so it reads and engraves from both sides.
  // y0..y1 is its vertical extent in world units. One face per wall also keeps the pattern decorator's unwrapping
  // sane: two opposed faces collapse its atlas to a sliver.
  function buildEdgeWallQuads(runs, { y0, y1, thickness = .14, patch = { h:6, v:6 } }) {
    const positions = [], normals = [], uvs = [], indices = [];
    for (const run of runs) {
      const length = run.to - run.from, height = y1 - y0;
      const across = Math.max(1, Math.ceil(length / patch.h - 1e-9)), up = Math.max(1, Math.ceil(height / patch.v - 1e-9));
      for (const side of run.side ? [run.side] : [1, -1]) {
        const offset = side * thickness / 2;
        for (let i = 0; i < across; i++) for (let j = 0; j < up; j++) {
          const f0 = run.from + length * i / across, f1 = run.from + length * (i + 1) / across;
          const h0 = y0 + height * j / up, h1 = y0 + height * (j + 1) / up;
          const at = (f, h) => run.along === 'x' ? [f, h, run.line + offset] : [run.line + offset, h, f];
          const normal = run.along === 'x' ? [0, 0, side] : [side, 0, 0];
          let corners = [[f0, h0, 0, 0], [f1, h0, 1, 0], [f1, h1, 1, 1], [f0, h1, 0, 1]].map(([f, h, u, v]) => ({ p:at(f, h), u, v }));
          if (dot(cross(sub(corners[1].p, corners[0].p), sub(corners[3].p, corners[0].p)), normal) < 0) corners = [corners[0], corners[3], corners[2], corners[1]];
          const base = positions.length / 3;
          for (const corner of corners) { positions.push(...corner.p); normals.push(...normal); uvs.push(corner.u, corner.v); }
          indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
    return { positions:new Float32Array(positions), normals:new Float32Array(normals), uvs:new Float32Array(uvs), indices:positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices) };
  }

  function toGeometry(THREE, data) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    return geometry;
  }

  return Object.freeze({ mergeMask, voxelFaces, buildQuads, mergeEdges, buildEdgeWallQuads, toGeometry, TANGENTS });
});
