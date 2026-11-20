// Low-poly faceted rocks (window.FacetedRocks).
//
// A loose rock is chiselled from a stone block: an irregular 5–7 sided prism
// whose upper corners and edges are sliced off by 3–5 planes, so it is a
// handful of large flat faces at clearly different angles. Every face carries
// the whole rock PNG stretched to fit, like the cliffs. The PNG
// (assets/textures/carved_smooth.png) has its ink border drawn in, so each
// hard edge reads as outlined without the generated shell outline: these
// meshes stay off SHELL_OUTLINE and get no terrain edge-ID, exactly like
// zone-plateau-mesa.js's cliff faces.
//
// Geometry is deterministic per tile (col,row) and computed without three.js
// (buildRockData) so it is testable; buildRockGeometry wraps it. UVs are
// explicit per face: each face fans from its centroid (the PNG centre) and
// its rim runs around the PNG border, with the vertices nearest the PNG
// corners pinned to them.
//
// Used by: game.js wilderness ore rocks and the town mine (buildOreRock), and
// farm loose rocks (vegetation-crop-rendering.js, buildNaturalRock). Multi-tile
// undiggable boulders still use ZoneTerrainFeatures' rounded shell, and the
// scenery backdrops keep TerrainGeometry.buildRockTileGeo.
(() => {
  'use strict';

  if (window.FacetedRocks) return;

  const STORAGE_KEY = 'hobunjiFacetedRocks'; // 'off' restores the older rounded mounds (newly built chunks).
  const SHELL_LAYER = globalThis.HobunjiRenderLayers?.SHELL_OUTLINE ?? 1;
  const TILE_HALF = 0.48; // Rocks stay inside their own tile.
  const SINK = 0.06; // Base ring sits this far below the ground so displaced terrain never shows a gap.
  const MIN_FACE_AREA = 0.012; // Square tiles: smallest cut face worth a whole PNG.
  const MERGE_EPS = 1e-4; // Points closer than this (tiles) are one vertex.
  const MIN_CORNER_TURN = 22 * Math.PI / 180; // Base outline corners turn at least this much.
  const stats = { built: 0, faces: 0, triangles: 0, legacy: 0 };
  let enabled = (() => {
    try { return localStorage.getItem(STORAGE_KEY) !== 'off'; } catch (_) { return true; }
  })();

  function seeded(col, row, salt = 0) {
    let seed = ((Math.imul(col | 0, 374761393) ^ Math.imul(row | 0, 668265263) ^ Math.imul(salt | 0, 2246822519)) >>> 0) || 1;
    return () => {
      seed = (seed + 0x6D2B79F5) >>> 0;
      let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

  // A face's rim -> PNG square border (points in the face's own 2D frame,
  // counter-clockwise, centroid at the origin). Four anchor vertices, in rim
  // order, each the best match for one PNG corner, map exactly onto the
  // corners; the vertices between two anchors are spaced along that PNG edge
  // by edge length. Every face therefore shows the whole PNG with its drawn
  // border following the face's outline, and the centroid fan never folds.
  const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]]; // Counter-clockwise, matching the rim.
  const CORNER_ANGLES = [-3, -1, 1, 3].map(k => k * Math.PI / 4);
  function rimUvs(points2d) {
    const n = points2d.length;
    const angles = points2d.map(([u, v]) => Math.atan2(v, u));
    const miss = (i, k) => { let d = Math.abs(angles[i] - CORNER_ANGLES[k]); return d > Math.PI ? 2 * Math.PI - d : d; };
    let best = null;
    // Try every start vertex for corner 0; greedily take the best vertex for
    // each following corner while leaving room for the rest.
    for (let first = 0; first < n; first++) {
      const anchors = [first];
      let cost = miss(first, 0), ok = true;
      for (let k = 1; k < 4; k++) {
        const prev = anchors[k - 1], room = n - (prev - first + n) % n - 1 - (3 - k); // Vertices still available after prev.
        if (room < 1) { ok = false; break; }
        let pick = -1, pickCost = Infinity;
        for (let step = 1; step <= room; step++) {
          const i = (prev + step) % n, c = miss(i, k);
          if (c < pickCost) { pickCost = c; pick = i; }
        }
        anchors.push(pick); cost += pickCost;
      }
      if (ok && (!best || cost < best.cost)) best = { anchors, cost };
    }
    const uv = new Array(n);
    const length = (i, j) => Math.hypot(points2d[j][0] - points2d[i][0], points2d[j][1] - points2d[i][1]);
    for (let k = 0; k < 4; k++) {
      const from = best.anchors[k], to = best.anchors[(k + 1) % 4];
      const span = ((to - from + n) % n) || n;
      let total = 0;
      for (let s = 0; s < span; s++) total += length((from + s) % n, (from + s + 1) % n);
      let walked = 0;
      for (let s = 0; s < span; s++) {
        const t = total > 0 ? walked / total : s / span, a = CORNERS[k], b = CORNERS[(k + 1) % 4];
        uv[(from + s) % n] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        walked += length((from + s) % n, (from + s + 1) % n);
      }
    }
    return uv;
  }

  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const centroidOf = points => scale(points.reduce(add, [0, 0, 0]), 1 / points.length);
  function polygonArea(points, normal) {
    let total = [0, 0, 0];
    for (let i = 0; i < points.length; i++) total = add(total, cross(points[i], points[(i + 1) % points.length]));
    return Math.abs(dot(total, normal)) / 2;
  }
  // Face frame: sides keep the PNG upright (u horizontal, v up the face); tops use world X.
  function faceFrame(normal) {
    let u = Math.abs(normal[1]) < 0.75 ? cross([0, 1, 0], normal) : sub([1, 0, 0], scale(normal, normal[0]));
    u = norm(u);
    return { u, v: cross(normal, u) };
  }
  // Convex polyhedron clip: keep the side where dot(n, p - origin) <= d.
  // Faces keep their counter-clockwise (outward) order; the cut adds one cap.
  function clipPolyhedron(faces, n, origin, d) {
    const side = p => dot(n, sub(p, origin)) - d;
    const next = [], cap = [];
    for (const face of faces) {
      const out = [], pts = face.points;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length], sa = side(a), sb = side(b);
        if (sa <= 0) out.push(a);
        if ((sa <= 0) !== (sb <= 0)) {
          const p = add(a, scale(sub(b, a), sa / (sa - sb)));
          out.push(p); cap.push(p);
        }
      }
      const clean = out.filter((p, i) => Math.hypot(...sub(p, out[(i + 1) % out.length])) > MERGE_EPS); // A cut grazing a corner leaves no microscopic edge.
      if (clean.length >= 3) next.push({ ...face, points: clean });
    }
    const unique = [];
    for (const p of cap) if (!unique.some(q => Math.hypot(...sub(p, q)) < MERGE_EPS)) unique.push(p);
    if (unique.length < 3) return null;
    const c = centroidOf(unique), frame = faceFrame(n);
    unique.sort((p, q) => Math.atan2(dot(sub(p, c), frame.v), dot(sub(p, c), frame.u)) - Math.atan2(dot(sub(q, c), frame.v), dot(sub(q, c), frame.u)));
    next.push({ kind: 'cut', points: unique, normal: n });
    return next;
  }

  // Convex hull of the base outline (2D, [x, z]) with near-straight corners
  // (turning < MIN_CORNER_TURN) removed, so every side is its own face.
  function convexOutline(points) {
    const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const turn = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const p of pts) { while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    for (const p of pts.slice().reverse()) { while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    let hull = lower.slice(0, -1).concat(upper.slice(0, -1));
    for (let changed = true; changed && hull.length > 4;) {
      changed = false;
      for (let i = 0; i < hull.length && hull.length > 4; i++) {
        const a = hull[(i - 1 + hull.length) % hull.length], b = hull[i], c = hull[(i + 1) % hull.length];
        const angle = Math.abs(Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]));
        if (Math.min(angle, 2 * Math.PI - angle) < MIN_CORNER_TURN) { hull.splice(i, 1); changed = true; break; }
      }
    }
    return hull;
  }

  // Pure data: { positions, uvs, faceIds (per vertex), faces: [{ kind, normal, points }], height, base }.
  // An irregular 5–7 sided prism with its upper corners and edges cut off by
  // 3–5 planes, like a chiselled stone: every face is one flat polygon.
  function buildRockData(col, row, options = {}) {
    const rng = seeded(col, row, options.salt || 0);
    const sides = options.sides ?? (5 + Math.floor(rng() * 3));
    const height = options.height ?? (0.36 + rng() * 0.34);
    const footprint = Math.max(0.18, Math.min(0.46, options.footprint ?? 0.44));
    const elongX = 0.84 + rng() * 0.3, elongZ = 0.84 + rng() * 0.3;
    const cx = (rng() - 0.5) * 0.06, cz = (rng() - 0.5) * 0.06;
    const phase = rng() * Math.PI * 2, step = Math.PI * 2 / sides;
    const ring = [];
    for (let i = 0; i < sides; i++) {
      const angle = phase + step * (i + (rng() - 0.5) * 0.5);
      const radius = footprint * (0.72 + rng() * 0.28);
      ring.push([Math.cos(angle) * elongX * radius, Math.sin(angle) * elongZ * radius]);
    }
    let fit = 1;
    const limit = (centre, offset) => offset > 0 ? (TILE_HALF - centre) / offset : offset < 0 ? (-TILE_HALF - centre) / offset : Infinity;
    for (const [dx, dz] of ring) fit = Math.min(fit, limit(cx, dx), limit(cz, dz));
    const base = convexOutline(ring.map(([dx, dz]) => [cx + dx * fit, cz + dz * fit])).map(([x, z]) => [x, -SINK, z]);
    const top = base.map(p => [p[0], height, p[2]]);
    const sideCount = base.length;
    // Ring order is counter-clockwise seen from above (+Y) when angles increase toward +Z? Fix by area sign.
    const ccwFromAbove = (() => { let a = 0; for (let i = 0; i < sideCount; i++) { const p = base[i], q = base[(i + 1) % sideCount]; a += p[2] * q[0] - p[0] * q[2]; } return a > 0; })();
    const ordered = ccwFromAbove ? [...Array(sideCount).keys()] : [...Array(sideCount).keys()].reverse();
    let faces = [];
    faces.push({ kind: 'top', normal: [0, 1, 0], points: ordered.map(i => top[i]) });
    faces.push({ kind: 'bottom', normal: [0, -1, 0], points: ordered.slice().reverse().map(i => base[i]) });
    for (let k = 0; k < sideCount; k++) {
      const i = ordered[k], j = ordered[(k + 1) % sideCount];
      const points = [base[j], base[i], top[i], top[j]];
      faces.push({ kind: 'side', normal: norm(cross(sub(points[1], points[0]), sub(points[3], points[0]))), points });
    }
    // Make every face's normal agree with its winding (and point outward).
    const inside = [cx, height * 0.5, cz];
    for (const face of faces) {
      const c = centroidOf(face.points);
      let n = [0, 0, 0];
      for (let i = 0; i < face.points.length; i++) {
        const a = face.points[i], b = face.points[(i + 1) % face.points.length];
        n = add(n, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
      }
      n = norm(n);
      if (dot(n, sub(c, inside)) < 0) { face.points.reverse(); n = scale(n, -1); }
      face.normal = n;
    }
    // Chisel cuts across the upper corners and edges.
    const cuts = options.cuts ?? (3 + Math.floor(rng() * 3));
    const origin = [cx, height * 0.4, cz];
    let made = 0;
    for (let attempt = 0; attempt < cuts * 6 && made < cuts; attempt++) {
      const azimuth = rng() * Math.PI * 2, elevation = (22 + rng() * 46) * Math.PI / 180;
      const n = [Math.cos(elevation) * Math.cos(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.sin(azimuth)];
      let support = -Infinity;
      for (const face of faces) for (const p of face.points) support = Math.max(support, dot(n, sub(p, origin)));
      const d = support * (0.6 + rng() * 0.25);
      if (faces.some(face => face.kind !== 'bottom' && dot(face.normal, n) > Math.cos(18 * Math.PI / 180))) continue; // Would leave two nearly parallel faces.
      const next = clipPolyhedron(faces, n, origin, d);
      if (!next) continue;
      const cap = next[next.length - 1];
      if (polygonArea(cap.points, n) < MIN_FACE_AREA) continue;
      if (next.some(face => face.kind !== 'bottom' && polygonArea(face.points, face.normal) < MIN_FACE_AREA * 0.5)) continue; // No slivers.
      let peak = -Infinity;
      for (const face of next) for (const p of face.points) peak = Math.max(peak, p[1]);
      if (peak < height * 0.62) continue; // Keep a real rock, not a pancake.
      faces = next;
      made++;
    }
    faces = faces.filter(face => face.kind !== 'bottom'); // Underground.
    // A triangular face cannot run its rim around the PNG square, so one edge
    // would lose the drawn border: split triangle edges at their midpoints,
    // in the neighbouring face too (same point, computed identically), so the
    // surface stays watertight with no T-junctions.
    const edgeKey = (a, b) => { const ka = a.map(v => Math.round(v * 1e6)).join(','), kb = b.map(v => Math.round(v * 1e6)).join(','); return ka < kb ? ka + '|' + kb : kb + '|' + ka; };
    const split = new Set();
    for (const face of faces) if (face.points.length === 3) for (let i = 0; i < 3; i++) split.add(edgeKey(face.points[i], face.points[(i + 1) % 3]));
    if (split.size) for (const face of faces) {
      const out = [];
      for (let i = 0; i < face.points.length; i++) {
        const a = face.points[i], b = face.points[(i + 1) % face.points.length];
        out.push(a);
        if (split.has(edgeKey(a, b))) out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
      }
      face.points = out;
    }

    const positions = [], uvs = [], faceIds = [];
    for (let f = 0; f < faces.length; f++) {
      const face = faces[f];
      const c = centroidOf(face.points), frame = faceFrame(face.normal);
      const rim = rimUvs(face.points.map(p => { const r = sub(p, c); return [dot(r, frame.u), dot(r, frame.v)]; }));
      for (let i = 0; i < face.points.length; i++) {
        const j = (i + 1) % face.points.length;
        positions.push(...c, ...face.points[i], ...face.points[j]);
        uvs.push(0.5, 0.5, ...rim[i], ...rim[j]);
        faceIds.push(f, f, f);
        stats.triangles++;
      }
    }
    let peak = -Infinity;
    for (const face of faces) for (const p of face.points) peak = Math.max(peak, p[1]);
    stats.faces += faces.length;
    return { positions, uvs, faceIds, faces, sides: sideCount, cuts: made, height: peak, base };
  }

  function buildRockGeometry(col, row, options = {}) {
    const THREE = window.THREE;
    const data = buildRockData(col, row, options);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
    geometry.computeVertexNormals(); // Non-indexed: one flat normal per face.
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.facetedRock = { faces: data.faces.length, sides: data.sides };
    return { geometry, data };
  }

  // Marks a faceted rock mesh: off the generated shell outline, and owner of
  // its own per-face UVs so no natural-surface/jigsaw pass remaps them.
  function styleMesh(mesh) {
    mesh.layers?.disable?.(SHELL_LAYER);
    Object.assign(mesh.userData, {
      facetedRock: true,
      noOutline: true,
      facetedSurfaceTextureOutline: true,
      shellOutlineDisabledReason: 'faceted-rock-png-outline',
      terrainJigsawIgnore: true,
      naturalSurfaceUvOwner: 'FacetedRocks',
      oreRockSurfaceMapped: true,
    });
    return mesh;
  }

  // One removable ore rock: a group holding a single faceted mesh.
  // displace(geometry) applies the zone's ground displacement to a geometry
  // (game.js displaceZoneGeometry); the whole rock is shifted by the lowest
  // displacement under its base so its faces stay flat.
  function buildOreRock({ col, row, material, displace = null, name = '' }) {
    const THREE = window.THREE;
    const { geometry, data } = buildRockGeometry(col, row);
    let lift = 0;
    if (typeof displace === 'function') {
      const probe = new THREE.BufferGeometry();
      probe.setAttribute('position', new THREE.Float32BufferAttribute(data.base.flatMap(p => [p[0], 0, p[2]]), 3));
      displace(probe);
      const ys = probe.getAttribute('position');
      lift = Infinity;
      for (let i = 0; i < ys.count; i++) lift = Math.min(lift, ys.getY(i));
      if (!Number.isFinite(lift)) lift = 0;
      probe.dispose();
      if (lift) geometry.translate(0, lift, 0);
    }
    const mesh = styleMesh(new THREE.Mesh(geometry, material));
    mesh.name = name || 'faceted_ore_rock';
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.wildernessChunkOwnsGeometry = true;
    const group = new THREE.Group();
    group.name = 'faceted_ore_rock_group';
    group.add(mesh);
    stats.built++;
    return { group, mesh, heightTiles: data.height + lift };
  }

  // A natural-surface rock (farm loose rocks): the grey unlit rock PNG
  // (NaturalSurfaceMaterials 'rocks', clamped) on each face. The owner flag is
  // set before naturalizing so the stretch mapper's naturalize hook and its
  // runtime repair leave the per-face UVs alone; the mapping override keeps
  // naturalizeMesh's own UV pass off.
  function buildNaturalRock({ col, row, material = null, surface = 'rocks', name = '' }) {
    const THREE = window.THREE;
    const { geometry, data } = buildRockGeometry(col, row);
    const mesh = styleMesh(new THREE.Mesh(geometry, material || new THREE.MeshBasicMaterial({ color: 0x808080 })));
    mesh.name = name || 'faceted_natural_rock';
    window.NaturalSurfaceMaterials?.naturalizeMesh?.(mesh, surface, 'faceted-rock-per-face');
    styleMesh(mesh); // Reassert after any naturalize wrapper (shell layer, UV owner).
    mesh.castShadow = mesh.receiveShadow = true;
    stats.built++;
    return { mesh, heightTiles: data.height };
  }

  window.FacetedRocks = Object.freeze({
    STORAGE_KEY,
    enabled: () => enabled,
    setEnabled(value) {
      enabled = value !== false;
      try { localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off'); } catch (_) {}
      return enabled;
    },
    noteLegacy() { stats.legacy++; },
    buildRockData,
    buildRockGeometry,
    styleMesh,
    buildOreRock,
    buildNaturalRock,
    snapshot: () => ({ enabled, ...stats }),
  });
})();
