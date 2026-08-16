(() => {
  'use strict';

  // Generic adaptive-octree signed-distance-field carving + dual-contour
  // mesh extraction engine, ported from docs/references/(HA)TunnelSculptorV1.html
  // ("Low-Poly Tunnel Sculptor V7" — see that file's maze mode, carveHook/
  // carveSphere, and rebuildMesh). Framework-agnostic on purpose (plain
  // {x,y,z} math, no THREE.js, no DOM) so it can sit next to
  // cavern-generator.js's own "pure data generation" module and stay
  // runnable outside the browser — see that file's docblock.
  //
  // Public entry point: carveMazeCavern(opts, rng) grows a branching maze
  // of tunnels from a fixed 3-wide entrance, SDF-carves it with the tool's
  // wall-detection-sphere technique (swept at several heights so a full
  // floor-to-ceiling corridor opens, not just a thin slab), snaps the
  // carved shape onto a 1-unit tile grid (the tool's "Snap Walls to Grid"
  // pass — this *is* how the floor tile set is decided, replacing a
  // separate blob-growth algorithm), and extracts the final mesh with the
  // tool's exact-clip-to-grid + stitched-boundary-cap pass so the shell's
  // edges land cleanly on tile boundaries outside the organic tunnel core.
  //
  // Coordinates are in the same "1 world unit = 1 tile" space building
  // interior scenes already use (see interior-scene-builder.js) — no
  // TILE=55 px scaling here. carveMazeCavern's sculpt volume is centered
  // on its own bounding box for simplicity; callers that need the result
  // in a shared/shifted tile-grid space (see cavern-generator.js) should
  // shift the returned claimed-tile keys and mesh.positions' x/z by the
  // same integer offset.

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clampNum(v, a, b) { return Math.max(a, Math.min(b, v)); }

  const V = {
    add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
    sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
    scale: (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
    addScaled: (a, b, s) => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s }),
    len: a => Math.hypot(a.x, a.y, a.z),
    normalize: a => { const l = V.len(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; },
    cross: (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }),
    lerp: (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }),
    dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
  };

  // ── Octree ───────────────────────────────────────────────────────────
  function makeNode(x, y, z, size) { return { x, y, z, size, children: null, id: -1 }; }
  function splitNode(node) {
    if (node.size <= 1 || node.children) return false;
    const h = node.size / 2;
    node.children = [];
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++)
      node.children.push(makeNode(node.x + dx * h, node.y + dy * h, node.z + dz * h, h));
    return true;
  }
  function uniformRefine(node, targetSize) {
    if (node.size <= targetSize) return;
    splitNode(node);
    for (const c of node.children) uniformRefine(c, targetSize);
  }
  function collectLeaves(node, out) {
    if (node.children) for (const c of node.children) collectLeaves(c, out);
    else out.push(node);
  }

  // ── Sculpt state (the SDF sample lattice + its adaptive octree) ────────
  function idxP(st, i, j, k) { return i + st.pointN * (j + st.pointN * k); }
  function idxC(st, i, j, k) { return i + st.N * (j + st.N * k); }

  function gridToWorld(st, i, j, k) {
    return {
      x: lerp(-st.domainHalf.x, st.domainHalf.x, i / st.N),
      y: lerp(-st.domainHalf.y, st.domainHalf.y, j / st.N),
      z: lerp(-st.domainHalf.z, st.domainHalf.z, k / st.N),
    };
  }
  function worldToGrid(st, p) {
    return {
      x: (p.x / st.domainHalf.x * .5 + .5) * st.N,
      y: (p.y / st.domainHalf.y * .5 + .5) * st.N,
      z: (p.z / st.domainHalf.z * .5 + .5) * st.N,
    };
  }
  function cellWorldBounds(st, node) {
    return { min: gridToWorld(st, node.x, node.y, node.z), max: gridToWorld(st, node.x + node.size, node.y + node.size, node.z + node.size) };
  }

  function rebuildLeafData(st) {
    st.leaves = [];
    collectLeaves(st.root, st.leaves);
    st.leafIdMap = new Int32Array(st.N * st.N * st.N).fill(-1);
    st.leaves.forEach((leaf, id) => {
      leaf.id = id;
      for (let k = leaf.z; k < leaf.z + leaf.size; k++)
        for (let j = leaf.y; j < leaf.y + leaf.size; j++)
          for (let i = leaf.x; i < leaf.x + leaf.size; i++)
            st.leafIdMap[idxC(st, i, j, k)] = id;
    });
  }

  function createSculptState(dims, gridN, baseCell) {
    const N = gridN, pointN = N + 1;
    // 8% sample-lattice padding beyond the nominal block, same purpose as
    // the tool's domainHalf inflation: guarantees the dual-contour mesher
    // has clean air margin to close off the outer faces.
    const domainHalf = { x: dims.x * .5 * 1.08, y: dims.y * .5 * 1.08, z: dims.z * .5 * 1.08 };
    const st = { N, pointN, dims, domainHalf, field: new Float32Array(pointN * pointN * pointN), root: null, leaves: [], leafIdMap: null };
    const hx = dims.x * .5, hy = dims.y * .5, hz = dims.z * .5;
    for (let k = 0; k <= N; k++) {
      const z = lerp(-domainHalf.z, domainHalf.z, k / N);
      for (let j = 0; j <= N; j++) {
        const y = lerp(-domainHalf.y, domainHalf.y, j / N);
        for (let i = 0; i <= N; i++) {
          const x = lerp(-domainHalf.x, domainHalf.x, i / N);
          st.field[idxP(st, i, j, k)] = Math.min(hx - Math.abs(x), hy - Math.abs(y), hz - Math.abs(z));
        }
      }
    }
    st.root = makeNode(0, 0, 0, N);
    let bc = Math.max(1, Math.min(N, baseCell | 0));
    while (N % bc !== 0 && bc > 1) bc >>= 1;
    uniformRefine(st.root, bc);
    rebuildLeafData(st);
    return st;
  }

  function sphereIntersectsNode(st, center, r, node) {
    const { min, max } = cellWorldBounds(st, node);
    let d2 = 0;
    for (const axis of ['x', 'y', 'z']) {
      const q = center[axis];
      if (q < min[axis]) d2 += (min[axis] - q) ** 2;
      else if (q > max[axis]) d2 += (q - max[axis]) ** 2;
    }
    return d2 <= r * r;
  }

  function refineNear(st, center, r, targetSize, oneLevelOnly) {
    const stack = [st.root];
    let changed = false;
    while (stack.length) {
      const n = stack.pop();
      if (!sphereIntersectsNode(st, center, r, n)) continue;
      if (n.children) { for (const c of n.children) stack.push(c); continue; }
      if (n.size > targetSize) {
        const did = splitNode(n);
        changed = changed || did;
        if (did && !oneLevelOnly) for (const c of n.children) stack.push(c);
      }
    }
    if (changed) rebuildLeafData(st);
    return changed;
  }

  const CUBE_CORNERS = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ];
  const CUBE_EDGES = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];

  function leafSurfaceVertex(st, node) {
    const x = node.x, y = node.y, z = node.z, s = node.size;
    const vals = CUBE_CORNERS.map(([dx, dy, dz]) => st.field[idxP(st, x + dx * s, y + dy * s, z + dz * s)]);
    let pos = 0, neg = 0;
    for (const v of vals) { if (v >= 0) pos++; else neg++; }
    if (pos === 0 || neg === 0) return null;
    const pts = [];
    for (const [a, b] of CUBE_EDGES) {
      const va = vals[a], vb = vals[b];
      if ((va >= 0) === (vb >= 0)) continue;
      const t = va / (va - vb);
      const [ax, ay, az] = CUBE_CORNERS[a], [bx, by, bz] = CUBE_CORNERS[b];
      const A = gridToWorld(st, x + ax * s, y + ay * s, z + az * s), B = gridToWorld(st, x + bx * s, y + by * s, z + bz * s);
      pts.push(V.lerp(A, B, t));
    }
    if (!pts.length) return null;
    let avg = { x: 0, y: 0, z: 0 };
    for (const p of pts) avg = V.add(avg, p);
    return V.scale(avg, 1 / pts.length);
  }

  function countSurfaceLeavesNear(st, center, r) {
    let count = 0;
    for (const leaf of st.leaves) {
      if (!sphereIntersectsNode(st, center, r, leaf)) continue;
      if (leafSurfaceVertex(st, leaf)) count++;
    }
    return count;
  }

  function ensureLocalResolution(st, center, r, opts) {
    const threshold = opts.faceThreshold;
    if (threshold <= 0) return;
    let guard = 0;
    while (guard++ < 5) {
      const count = countSurfaceLeavesNear(st, center, r * opts.refineRadius);
      if (count >= threshold) break;
      const changed = refineNear(st, center, r * opts.refineRadius, opts.minCell, true);
      if (!changed) break;
    }
  }

  // ── Carve primitives ────────────────────────────────────────────────
  function carveSphere(st, center, r, opts) {
    if (opts.adaptive !== false) ensureLocalResolution(st, center, r, opts);
    const g = worldToGrid(st, center);
    const sx = 2 * st.domainHalf.x / st.N, sy = 2 * st.domainHalf.y / st.N, sz = 2 * st.domainHalf.z / st.N;
    const ir = Math.ceil(r / sx) + 2, jr = Math.ceil(r / sy) + 2, kr = Math.ceil(r / sz) + 2;
    const i0 = Math.max(0, Math.floor(g.x) - ir), i1 = Math.min(st.N, Math.ceil(g.x) + ir);
    const j0 = Math.max(0, Math.floor(g.y) - jr), j1 = Math.min(st.N, Math.ceil(g.y) + jr);
    const k0 = Math.max(0, Math.floor(g.z) - kr), k1 = Math.min(st.N, Math.ceil(g.z) + kr);
    for (let k = k0; k <= k1; k++) {
      const z = lerp(-st.domainHalf.z, st.domainHalf.z, k / st.N);
      for (let j = j0; j <= j1; j++) {
        const y = lerp(-st.domainHalf.y, st.domainHalf.y, j / st.N);
        // Floor/ceiling protection keeps a solid walkable floor and roof
        // even while the walls carve chaotically — mirrors the tool's
        // top-down floor-leveling, simplified to a flat pair of bounds.
        if (opts.floorY != null && y < opts.floorY) continue;
        if (opts.ceilingY != null && y > opts.ceilingY) continue;
        for (let i = i0; i <= i1; i++) {
          const x = lerp(-st.domainHalf.x, st.domainHalf.x, i / st.N);
          const d = Math.hypot(x - center.x, y - center.y, z - center.z) - r;
          const id = idxP(st, i, j, k);
          if (d < st.field[id]) st.field[id] = d;
        }
      }
    }
  }

  function carveHook(st, center, dir, baseRadius, chamberScale, opts, rng) {
    const hits = opts.hitsPerStep || 3;
    let sideA = V.cross(dir, { x: 0, y: 1, z: 0 });
    sideA = V.len(sideA) < 1e-5 ? { x: 1, y: 0, z: 0 } : V.normalize(sideA);
    const sideB = V.normalize(V.cross(dir, sideA));
    for (let h = 0; h < hits; h++) {
      const t = (h / Math.max(1, hits - 1)) - .5;
      const jitterScale = (opts.pickJitter ?? .48) * baseRadius;
      let c = V.addScaled(center, dir, t * (opts.hookLength ?? .24));
      c = V.addScaled(c, sideA, (rng() * 2 - 1) * jitterScale);
      // Vertical jitter kept small — carveAlongSpline2D's stacked height
      // levels already give the corridor its full floor-to-ceiling reach.
      c = V.addScaled(c, sideB, (rng() * 2 - 1) * jitterScale * .4);
      const rr = baseRadius * (1 + (rng() * 2 - 1) * (opts.radiusChaos ?? .38) * .55) * chamberScale;
      carveSphere(st, c, Math.max(.07, rr), opts);
    }
  }

  // ── Maze spline network (flat XZ control-point paths) ──────────────────
  function rotateXZ(v, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return { x: v.x * c - v.z * s, y: 0, z: v.x * s + v.z * c };
  }

  // Minimal centripetal-ish Catmull-Rom sampler — replaces
  // THREE.CatmullRomCurve3 so this module stays THREE-free.
  function catmullRomPoint(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    const b0 = -.5 * t3 + t2 - .5 * t, b1 = 1.5 * t3 - 2.5 * t2 + 1, b2 = -1.5 * t3 + 2 * t2 + .5 * t, b3 = .5 * t3 - .5 * t2;
    return {
      x: p0.x * b0 + p1.x * b1 + p2.x * b2 + p3.x * b3,
      y: p0.y * b0 + p1.y * b1 + p2.y * b2 + p3.y * b3,
      z: p0.z * b0 + p1.z * b1 + p2.z * b2 + p3.z * b3,
    };
  }
  function sampleSpline(points, samplesPerSeg) {
    if (points.length < 2) return points.slice();
    const pad = [points[0], ...points, points[points.length - 1]];
    const out = [];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = pad[i], p1 = pad[i + 1], p2 = pad[i + 2], p3 = pad[i + 3];
      const n = i === points.length - 2 ? samplesPerSeg + 1 : samplesPerSeg;
      for (let s = 0; s < n; s++) out.push(catmullRomPoint(p0, p1, p2, p3, s / samplesPerSeg));
    }
    return out;
  }

  // Root through-route + branches attached to existing routes with a
  // chance to loop back into another route — same shape as the tool's
  // buildMazePaths (see (HA)TunnelSculptorV1.html lines 717-801).
  function buildMazePaths(rootPath, opts, rng) {
    const paths = [rootPath];
    for (let b = 0; b < opts.branchCount; b++) {
      const curves = paths.map(p => sampleSpline(p, 8));
      const parentIndex = Math.floor(rng() * curves.length);
      const parentPts = curves[parentIndex];
      const parentT = Math.min(parentPts.length - 1, Math.floor((.12 + rng() * .76) * (parentPts.length - 1)));
      const start = parentPts[parentT];
      let tangent = V.normalize(V.sub(parentPts[Math.min(parentPts.length - 1, parentT + 1)], parentPts[Math.max(0, parentT - 1)]));
      if (!Number.isFinite(tangent.x) || (tangent.x === 0 && tangent.z === 0)) tangent = { x: 1, y: 0, z: 0 };
      const side = rng() < .5 ? -1 : 1;
      const branchAngle = side * (Math.PI * (.28 + rng() * .30));
      let dir = rotateXZ(tangent, branchAngle);
      const pointCount = 3 + Math.floor(rng() * 3);
      const totalLength = opts.branchLength * (.68 + rng() * .72);
      const segLength = totalLength / (pointCount - 1);
      const path = [{ ...start }];
      for (let n = 1; n < pointCount; n++) {
        const turn = (rng() * 2 - 1) * opts.turnChaos * .72;
        dir = rotateXZ(dir, turn);
        path.push(V.addScaled(path[path.length - 1], dir, segLength * (.78 + rng() * .42)));
      }
      if (rng() < opts.loopChance && paths.length > 1) {
        let nearest = null, nearestD = Infinity;
        for (let pi = 0; pi < curves.length; pi++) {
          if (pi === parentIndex) continue;
          for (const cand of curves[pi]) {
            const d = V.dist(cand, path[path.length - 1]);
            if (d < nearestD) { nearestD = d; nearest = cand; }
          }
        }
        if (nearest && nearestD < opts.branchLength * 1.65 && nearestD > opts.probeRadius * .8) path.push({ ...nearest });
      }
      paths.push(path);
    }
    return paths;
  }

  // ── Wall-detection-sphere carve along a spline ─────────────────────────
  function findProbeIntrusions(st, center, radius, opts, limit) {
    limit = limit || 160;
    const g = worldToGrid(st, center);
    const sx = 2 * st.domainHalf.x / st.N, sy = 2 * st.domainHalf.y / st.N, sz = 2 * st.domainHalf.z / st.N;
    const cellPad = Math.hypot(sx, sy, sz) * .52;
    const scanR = radius + cellPad;
    const ir = Math.ceil(scanR / sx) + 1, jr = Math.ceil(scanR / sy) + 1, kr = Math.ceil(scanR / sz) + 1;
    const i0 = Math.max(0, Math.floor(g.x) - ir), i1 = Math.min(st.N, Math.ceil(g.x) + ir);
    const j0 = Math.max(0, Math.floor(g.y) - jr), j1 = Math.min(st.N, Math.ceil(g.y) + jr);
    const k0 = Math.max(0, Math.floor(g.z) - kr), k1 = Math.min(st.N, Math.ceil(g.z) + kr);
    const hits = [];
    for (let k = k0; k <= k1; k++) {
      const z = lerp(-st.domainHalf.z, st.domainHalf.z, k / st.N);
      for (let j = j0; j <= j1; j++) {
        const y = lerp(-st.domainHalf.y, st.domainHalf.y, j / st.N);
        // Rock below floorY is permanently protected (see carveSphere/
        // carveTileColumn) — never report it as an intrusion, or
        // clearProbeAt would spin forever trying to clear rock that can
        // never actually be carved. There's deliberately no ceilingY guard
        // at all (see carveMazeCavern's docblock).
        if (opts?.floorY != null && y < opts.floorY) continue;
        if (opts?.ceilingY != null && y > opts.ceilingY) continue;
        for (let i = i0; i <= i1; i++) {
          const v = st.field[idxP(st, i, j, k)];
          if (v <= 0) continue;
          const x = lerp(-st.domainHalf.x, st.domainHalf.x, i / st.N);
          const d = Math.hypot(x - center.x, y - center.y, z - center.z);
          if (d > scanR) continue;
          hits.push({ p: { x, y, z }, d, solid: v });
        }
      }
    }
    hits.sort((a, b) => a.d - b.d || b.solid - a.solid);
    if (hits.length > limit) hits.length = limit;
    return hits;
  }

  function clearProbeAt(st, center, tangent, opts, rng) {
    let passes = 0;
    let intrusions = findProbeIntrusions(st, center, opts.probeRadius, opts);
    while (intrusions.length && passes < opts.probeMaxPasses) {
      passes++;
      const burstCount = Math.min(opts.probeDigBursts, intrusions.length);
      for (let b = 0; b < burstCount; b++) {
        const pick = intrusions[Math.min(intrusions.length - 1, Math.floor((b / burstCount) * intrusions.length))];
        const target = V.lerp(pick.p, center, .12);
        const jitter = (opts.pickJitter ?? .48) * opts.brushRadius * .35;
        target.x += (rng() * 2 - 1) * jitter;
        target.z += (rng() * 2 - 1) * jitter;
        let digDir = { x: tangent.x, y: 0, z: tangent.z };
        if (V.len(digDir) < 1e-6) digDir = { x: 1, y: 0, z: 0 };
        digDir = V.normalize(V.add(digDir, { x: (rng() * 2 - 1) * opts.dirChaos * .2, y: 0, z: (rng() * 2 - 1) * opts.dirChaos * .2 }));
        const radius = opts.brushRadius * (.78 + rng() * .42);
        carveHook(st, target, digDir, radius, 1, opts, rng);
      }
      intrusions = findProbeIntrusions(st, center, opts.probeRadius, opts);
    }
    return { clear: intrusions.length === 0, passes };
  }

  // Sweeps the probe at several fixed heights along one path so the
  // resulting corridor opens full floor-to-ceiling, not just a thin slab
  // (a single spline pass at one height, like the tool's own top-down
  // mode, is enough for a slab but not a walkable room).
  function carveAlongSpline2D(st, pathPts2D, opts, rng) {
    for (const y of opts.levels) {
      for (let i = 0; i < pathPts2D.length; i++) {
        const p2 = pathPts2D[i];
        const p = { x: p2.x, y, z: p2.z };
        const next = pathPts2D[Math.min(pathPts2D.length - 1, i + 1)];
        const prev = pathPts2D[Math.max(0, i - 1)];
        let tangent = V.normalize({ x: next.x - prev.x, y: 0, z: next.z - prev.z });
        if (!Number.isFinite(tangent.x)) tangent = { x: 1, y: 0, z: 0 };
        const probe = findProbeIntrusions(st, p, opts.probeRadius, opts, 1);
        if (!probe.length) continue;
        clearProbeAt(st, p, tangent, opts, rng);
      }
    }
  }

  // ── Snap-to-grid: decides the floor tile set and squares up the walls ──
  function sampleFieldNearestWorld(st, x, y, z) {
    const g = worldToGrid(st, { x, y, z });
    const i = clampNum(Math.round(g.x), 0, st.N), j = clampNum(Math.round(g.y), 0, st.N), k = clampNum(Math.round(g.z), 0, st.N);
    return st.field[idxP(st, i, j, k)];
  }

  // The organic spline carve doesn't know or care about tile boundaries —
  // a hook stamp near a claimed tile's edge can bleed into an unclaimed
  // neighbor and thin (or erase) the wall that should separate them, even
  // though that neighbor never got carved enough of its own 9-point
  // coverage sample to become floor itself (see snapClaimTiles). Confirmed
  // via headless verification: ~35-65% of a maze's boundary edges were
  // missing their wall entirely before this ran. Restores a guaranteed-
  // solid strip just inside every unclaimed tile that borders a claimed
  // one — skipCapEdges (the entrance's doorway/vestibule) is excluded, or
  // this would silently re-seal the one opening that's supposed to exist.
  function solidifyBoundaryWalls(st, claimed, depth, skipCapEdges) {
    const hx = st.dims.x * .5, hy = st.dims.y * .5, hz = st.dims.z * .5;
    const pristineAt = (x, y, z) => Math.min(hx - Math.abs(x), hy - Math.abs(y), hz - Math.abs(z));
    for (const key of claimed) {
      const [c, r] = key.split(',').map(Number);
      const edges = [
        { dir: 'W', nc: c - 1, nr: r, x0: c - depth, x1: c, z0: r, z1: r + 1 },
        { dir: 'E', nc: c + 1, nr: r, x0: c + 1, x1: c + 1 + depth, z0: r, z1: r + 1 },
        { dir: 'N', nc: c, nr: r - 1, x0: c, x1: c + 1, z0: r - depth, z1: r },
        { dir: 'S', nc: c, nr: r + 1, x0: c, x1: c + 1, z0: r + 1, z1: r + 1 + depth },
      ];
      for (const e of edges) {
        if (claimed.has(`${e.nc},${e.nr}`)) continue; // shared wall between two claimed tiles stays open
        if (skipCapEdges?.has(`${c},${r},${e.dir}`)) continue; // the doorway/vestibule — never re-seal it
        const g0 = worldToGrid(st, { x: e.x0, y: -st.domainHalf.y, z: e.z0 });
        const g1 = worldToGrid(st, { x: e.x1, y: st.domainHalf.y, z: e.z1 });
        const i0 = Math.max(0, Math.floor(Math.min(g0.x, g1.x))), i1 = Math.min(st.N, Math.ceil(Math.max(g0.x, g1.x)));
        const k0 = Math.max(0, Math.floor(Math.min(g0.z, g1.z))), k1 = Math.min(st.N, Math.ceil(Math.max(g0.z, g1.z)));
        for (let k = k0; k <= k1; k++) {
          const z = lerp(-st.domainHalf.z, st.domainHalf.z, k / st.N);
          for (let j = 0; j <= st.N; j++) {
            const y = lerp(-st.domainHalf.y, st.domainHalf.y, j / st.N);
            for (let i = i0; i <= i1; i++) {
              const x = lerp(-st.domainHalf.x, st.domainHalf.x, i / st.N);
              const id = idxP(st, i, j, k);
              const pristine = pristineAt(x, y, z);
              if (pristine > st.field[id]) st.field[id] = pristine; // only ever restore, never carve
            }
          }
        }
      }
    }
  }

  // Pushes the wall out to exactly this tile's edges (plus a small
  // margin), floor to ceiling — same idea as the tool's carveGridRect.
  function carveTileColumn(st, c, r, opts) {
    const margin = opts.wallGridMargin ?? .05;
    const x0 = c - margin, x1 = c + 1 + margin, z0 = r - margin, z1 = r + 1 + margin;
    const cx = (x0 + x1) * .5, cz = (z0 + z1) * .5, hx = (x1 - x0) * .5, hz = (z1 - z0) * .5;
    const g0 = worldToGrid(st, { x: x0, y: -st.domainHalf.y, z: z0 });
    const g1 = worldToGrid(st, { x: x1, y: st.domainHalf.y, z: z1 });
    const i0 = Math.max(0, Math.floor(Math.min(g0.x, g1.x)) - 2), i1 = Math.min(st.N, Math.ceil(Math.max(g0.x, g1.x)) + 2);
    const k0 = Math.max(0, Math.floor(Math.min(g0.z, g1.z)) - 2), k1 = Math.min(st.N, Math.ceil(Math.max(g0.z, g1.z)) + 2);
    for (let k = k0; k <= k1; k++) {
      const z = lerp(-st.domainHalf.z, st.domainHalf.z, k / st.N);
      for (let j = 0; j <= st.N; j++) {
        const y = lerp(-st.domainHalf.y, st.domainHalf.y, j / st.N);
        if (opts.floorY != null && y < opts.floorY) continue;
        if (opts.ceilingY != null && y > opts.ceilingY) continue;
        for (let i = i0; i <= i1; i++) {
          const x = lerp(-st.domainHalf.x, st.domainHalf.x, i / st.N);
          const dXZ = Math.max(Math.abs(x - cx) - hx, Math.abs(z - cz) - hz);
          const id = idxP(st, i, j, k);
          if (dXZ < st.field[id]) st.field[id] = dXZ;
        }
      }
    }
  }

  // Claims every tile in boundsRect whose floor is open enough (nine-point
  // coverage sample, same threshold idea as the tool's snapWallsToFloorGrid),
  // then squares up each claimed tile's walls. The claimed set *is* the
  // room's floor tile set — replaces a separate blob-growth algorithm.
  function snapClaimTiles(st, boundsRect, opts) {
    const fractions = [.2, .5, .8];
    const required = Math.max(1, Math.ceil(9 * (opts.wallGridClaim ?? .35)));
    const sampleY = opts.floorY + Math.max(.06, Math.min(.16, opts.probeRadius * .28));
    const claimed = new Set();
    for (let r = boundsRect.minR; r <= boundsRect.maxR; r++) {
      for (let c = boundsRect.minC; c <= boundsRect.maxC; c++) {
        let open = 0;
        for (const fz of fractions) {
          const z = lerp(r, r + 1, fz);
          for (const fx of fractions) {
            const x = lerp(c, c + 1, fx);
            if (sampleFieldNearestWorld(st, x, sampleY, z) <= 0) open++;
          }
        }
        if (open >= required) claimed.add(`${c},${r}`);
      }
    }
    for (const key of claimed) { const [c, r] = key.split(',').map(Number); carveTileColumn(st, c, r, opts); }
    return claimed;
  }

  // ── Dual-contour mesh extraction ────────────────────────────────────
  function leafForCell(st, i, j, k) {
    if (i < 0 || j < 0 || k < 0 || i >= st.N || j >= st.N || k >= st.N) return -1;
    return st.leafIdMap[idxC(st, i, j, k)];
  }

  function clipPolyAxis(poly, axis, bound, keepGreater) {
    if (!poly.length) return poly;
    const eps = 1e-8;
    const inside = v => keepGreater ? v[axis] >= bound - eps : v[axis] <= bound + eps;
    const intersect = (a, b) => {
      const av = a[axis], bv = b[axis];
      const denom = bv - av;
      const t = Math.abs(denom) > 1e-12 ? (bound - av) / denom : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    };
    const out = [];
    let prev = poly[poly.length - 1], prevIn = inside(prev);
    for (const cur of poly) {
      const curIn = inside(cur);
      if (curIn !== prevIn) out.push(intersect(prev, cur));
      if (curIn) out.push(cur);
      prev = cur; prevIn = curIn;
    }
    return out;
  }
  function clipPolyToXZRect(poly, x0, x1, z0, z1) {
    let p = clipPolyAxis(poly, 'x', x0, true);
    p = clipPolyAxis(p, 'x', x1, false);
    p = clipPolyAxis(p, 'z', z0, true);
    p = clipPolyAxis(p, 'z', z1, false);
    return p;
  }

  function sampleFieldTrilinear(st, x, y, z) {
    const g = worldToGrid(st, { x, y, z });
    const gx = clampNum(g.x, 0, st.N), gy = clampNum(g.y, 0, st.N), gz = clampNum(g.z, 0, st.N);
    const i0 = Math.min(st.N - 1, Math.floor(gx)), j0 = Math.min(st.N - 1, Math.floor(gy)), k0 = Math.min(st.N - 1, Math.floor(gz));
    const tx = gx - i0, ty = gy - j0, tz = gz - k0;
    const f = (i, j, k) => st.field[idxP(st, i, j, k)];
    const c00 = lerp(f(i0, j0, k0), f(i0 + 1, j0, k0), tx), c10 = lerp(f(i0, j0 + 1, k0), f(i0 + 1, j0 + 1, k0), tx);
    const c01 = lerp(f(i0, j0, k0 + 1), f(i0 + 1, j0, k0 + 1), tx), c11 = lerp(f(i0, j0 + 1, k0 + 1), f(i0 + 1, j0 + 1, k0 + 1), tx);
    return lerp(lerp(c00, c10, ty), lerp(c01, c11, ty), tz);
  }

  function solidTopAtXZ(st, x, z) {
    const hy = st.domainHalf.y;
    const eps = Math.max(.001, (hy * 2 / st.N) * .03);
    let prevY = hy - eps, prevF = sampleFieldTrilinear(st, x, prevY, z);
    if (prevF >= 0) return hy;
    const samples = Math.max(24, st.N);
    for (let s = 1; s <= samples; s++) {
      const y = lerp(hy - eps, -hy + eps, s / samples);
      const f = sampleFieldTrilinear(st, x, y, z);
      if (f >= 0) {
        const denom = prevF - f;
        const t = Math.abs(denom) > 1e-9 ? prevF / denom : .5;
        return lerp(prevY, y, clampNum(t, 0, 1));
      }
      prevY = y; prevF = f;
    }
    return null;
  }

  // skipCapEdges: an optional Set of "c,r,DIR" keys (DIR one of N/S/E/W)
  // marking boundary edges that must stay open — e.g. the entrance's mouth,
  // which borders unclaimed (exterior) tiles just like any other cavern
  // wall would, but must NOT get a wall face stitched across it or the
  // room reads as sealed shut with no way in or out.
  function stitchBoundaryCaps(st, keepTiles, addTri, skipCapEdges) {
    const hy = st.domainHalf.y;
    const cellSpan = (2 * st.domainHalf.x / st.N + 2 * st.domainHalf.z / st.N) * .5;
    const addEdge = (x0, z0, x1, z1, flip) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const stepTarget = Math.max(.04, cellSpan * .65);
      const steps = Math.max(1, Math.ceil(len / stepTarget));
      let prev = null;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = lerp(x0, x1, t), z = lerp(z0, z1, t);
        const top = solidTopAtXZ(st, x, z);
        const cur = top === null ? null : { bottom: { x, y: -hy, z }, top: { x, y: clampNum(top, -hy, hy), z } };
        if (prev && cur) {
          if (flip) { addTri(prev.bottom, cur.top, cur.bottom); addTri(prev.bottom, prev.top, cur.top); }
          else { addTri(prev.bottom, cur.bottom, cur.top); addTri(prev.bottom, cur.top, prev.top); }
        }
        prev = cur;
      }
    };
    const skip = (c, r, dir) => skipCapEdges?.has(`${c},${r},${dir}`);
    for (const key of keepTiles) {
      const [c, r] = key.split(',').map(Number);
      if (!keepTiles.has(`${c - 1},${r}`) && !skip(c, r, 'W')) addEdge(c, r, c, r + 1, false);
      if (!keepTiles.has(`${c + 1},${r}`) && !skip(c, r, 'E')) addEdge(c + 1, r, c + 1, r + 1, true);
      if (!keepTiles.has(`${c},${r - 1}`) && !skip(c, r, 'N')) addEdge(c, r, c + 1, r, true);
      if (!keepTiles.has(`${c},${r + 1}`) && !skip(c, r, 'S')) addEdge(c, r + 1, c + 1, r + 1, false);
    }
  }

  function clipAndStitch(st, positions, indices, keepTiles, skipCapEdges) {
    const outPositions = []; const outIndices = []; const vmap = new Map();
    const addVertex = v => {
      // Quantized key shares clipped/stitched vertices along the same tile
      // edge so the mesh has no microscopic cracks there.
      const key = `${Math.round(v.x * 1e6)},${Math.round(v.y * 1e6)},${Math.round(v.z * 1e6)}`;
      let id = vmap.get(key);
      if (id === undefined) { id = outPositions.length / 3; outPositions.push(v.x, v.y, v.z); vmap.set(key, id); }
      return id;
    };
    const addTri = (a, b, c) => {
      const ia = addVertex(a), ib = addVertex(b), ic = addVertex(c);
      if (ia === ib || ib === ic || ic === ia) return;
      outIndices.push(ia, ib, ic);
    };

    for (let q = 0; q < indices.length; q += 3) {
      const ia = indices[q] * 3, ib = indices[q + 1] * 3, ic = indices[q + 2] * 3;
      const tri = [
        { x: positions[ia], y: positions[ia + 1], z: positions[ia + 2] },
        { x: positions[ib], y: positions[ib + 1], z: positions[ib + 2] },
        { x: positions[ic], y: positions[ic + 1], z: positions[ic + 2] },
      ];
      const areaXZ = Math.abs((tri[1].x - tri[0].x) * (tri[2].z - tri[0].z) - (tri[2].x - tri[0].x) * (tri[1].z - tri[0].z));
      if (areaXZ < 1e-10) {
        const cx = (tri[0].x + tri[1].x + tri[2].x) / 3, cz = (tri[0].z + tri[1].z + tri[2].z) / 3;
        if (keepTiles.has(`${Math.floor(cx)},${Math.floor(cz)}`)) addTri(tri[0], tri[1], tri[2]);
        continue;
      }
      const minX = Math.min(tri[0].x, tri[1].x, tri[2].x), maxX = Math.max(tri[0].x, tri[1].x, tri[2].x);
      const minZ = Math.min(tri[0].z, tri[1].z, tri[2].z), maxZ = Math.max(tri[0].z, tri[1].z, tri[2].z);
      const ix0 = Math.floor(minX), ix1 = Math.floor(maxX - 1e-7);
      const iz0 = Math.floor(minZ), iz1 = Math.floor(maxZ - 1e-7);
      for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
        if (!keepTiles.has(`${ix},${iz}`)) continue;
        const poly = clipPolyToXZRect(tri, ix, ix + 1, iz, iz + 1);
        if (poly.length < 3) continue;
        for (let p = 1; p < poly.length - 1; p++) addTri(poly[0], poly[p], poly[p + 1]);
      }
    }

    stitchBoundaryCaps(st, keepTiles, addTri, skipCapEdges);
    return { positions: new Float32Array(outPositions), indices: outIndices };
  }

  function extractMesh(st, keepTiles, skipCapEdges) {
    const leafVertexIndex = new Map();
    const positions = [];
    for (const leaf of st.leaves) {
      const v = leafSurfaceVertex(st, leaf);
      if (v) { leafVertexIndex.set(leaf.id, positions.length / 3); positions.push(v.x, v.y, v.z); }
    }
    const indices = [];
    const faceKeys = new Set();
    function addFace(ids, flip) {
      const unique = [];
      for (const id of ids) {
        if (id < 0) continue;
        const vi = leafVertexIndex.get(id);
        if (vi === undefined) continue;
        if (!unique.includes(vi)) unique.push(vi);
      }
      if (unique.length < 3) return;
      const key = [...unique].sort((a, b) => a - b).join(',');
      if (faceKeys.has(key)) return;
      faceKeys.add(key);
      if (flip) unique.reverse();
      for (let q = 1; q < unique.length - 1; q++) indices.push(unique[0], unique[q], unique[q + 1]);
    }
    // Face emission is driven off the finest-resolution grid edges (not the
    // octree's own leaf boundaries) — that's what lets leaves of different
    // sizes stitch together crack-free without any T-junction special
    // casing; see cavern-sculptor's docblock / the ported tool's rebuildMesh.
    const N = st.N;
    for (let k = 1; k < N; k++) for (let j = 1; j < N; j++) for (let i = 0; i < N; i++) {
      const a = st.field[idxP(st, i, j, k)], b = st.field[idxP(st, i + 1, j, k)];
      if ((a >= 0) === (b >= 0)) continue;
      addFace([leafForCell(st, i, j - 1, k - 1), leafForCell(st, i, j, k - 1), leafForCell(st, i, j, k), leafForCell(st, i, j - 1, k)], a < 0);
    }
    for (let k = 1; k < N; k++) for (let j = 0; j < N; j++) for (let i = 1; i < N; i++) {
      const a = st.field[idxP(st, i, j, k)], b = st.field[idxP(st, i, j + 1, k)];
      if ((a >= 0) === (b >= 0)) continue;
      addFace([leafForCell(st, i - 1, j, k - 1), leafForCell(st, i, j, k - 1), leafForCell(st, i, j, k), leafForCell(st, i - 1, j, k)], a >= 0);
    }
    for (let k = 0; k < N; k++) for (let j = 1; j < N; j++) for (let i = 1; i < N; i++) {
      const a = st.field[idxP(st, i, j, k)], b = st.field[idxP(st, i, j, k + 1)];
      if ((a >= 0) === (b >= 0)) continue;
      addFace([leafForCell(st, i - 1, j - 1, k), leafForCell(st, i, j - 1, k), leafForCell(st, i, j, k), leafForCell(st, i - 1, j, k)], a < 0);
    }

    if (!keepTiles) return { positions: new Float32Array(positions), indices };
    return clipAndStitch(st, positions, indices, keepTiles, skipCapEdges);
  }

  // ── Top-level orchestration ─────────────────────────────────────────
  // Every value below matches (HA)TunnelSculptorV1.html's own V5-baseline
  // defaults (see its applyModeDefaults) exactly — including sizeY/
  // pathYOffset/floorOffset, the thin-slab top-down setup itself. That's
  // deliberate: earlier attempts reinterpreted this as a tall walkable
  // room (a fixed room-height constant, a multi-level probe sweep to
  // reach it, an artificial solid margin so dual contouring had a ceiling
  // to cap against, then a post-process to strip that cap back out) and
  // each layer of reinterpretation introduced its own new bug — a sealed
  // ceiling and a walled-shut doorway among them. The tool's own approach
  // avoids the ceiling problem entirely, by construction: pathYOffset
  // (.55) + probeRadius (.5) already reaches past sizeY's own half-height
  // (.75), so the single carve naturally punches through the slab's
  // nominal top with nothing left to cap — there is no ceiling to strip
  // because there's no protected rock left up there to form one from. Only
  // floorOffset is protected (via floorY below), same as the tool's own
  // floorHeightAt with floorVariation forced to 0 (flat, no undulation —
  // the one deliberate v1 simplification kept from the earlier attempt).
  //   - branchCount is computed per-den from the target tile count (see
  //     cavern-generator.js) rather than fixed, so dens actually vary in
  //     size — the tool's own default (16) is kept here only as the
  //     fallback for a direct/standalone call.
  //   - entranceLength has no tool equivalent (the tool's maze root spans
  //     the whole board corner-to-corner; a den instead grows from one
  //     fixed dead-end mouth, which is also why carveMazeCavern forces a
  //     3-wide entrance and a shallow vestibule beyond it below — the
  //     tool has no "entrance" concept to begin with).
  const DEFAULT_OPTS = {
    branchCount: 16, branchLength: 3.75, turnChaos: .42, loopChance: .18,
    probeRadius: .5, brushRadius: .34, radiusChaos: .38, dirChaos: .58,
    pickJitter: .48, hookLength: .24, hitsPerStep: 3,
    probeDigBursts: 4, probeMaxPasses: 120,
    faceThreshold: 10, refineRadius: 2.1, minCell: 1, baseCell: 4, gridN: 64,
    wallGridMargin: .05, wallGridClaim: .35,
    sizeY: 1.5, pathYOffset: .55, floorOffset: 0, entranceLength: 3,
  };

  // Grows a branching maze from a fixed 3-wide entrance (tiles [-1,0],
  // [0,0], [1,0], growing toward -z / "into the rock" — same convention
  // the tile-grid generator this replaces used), carves it, snaps it to
  // the tile grid, and returns the claimed floor tiles plus the final mesh.
  // All coordinates are in this call's own centered local space — see this
  // file's docblock for how a caller sharing a wider tile-grid space (like
  // cavern-generator.js) should shift the result.
  function carveMazeCavern(opts, rng) {
    opts = Object.assign({}, DEFAULT_OPTS, opts);

    // The tool's own board (sizeX/sizeZ) is a fixed size the user sets
    // independently of branchCount — branches that happen to reach past its
    // edges just carve nothing there (every carve/probe function clamps its
    // grid indices to [0,N]), so a bigger branchCount only makes the same
    // fixed board denser, never bigger. This module used to derive dims from
    // the generated path's own bounding box instead, so the maze would never
    // "waste" carve work outside the mesh — but branches routinely attach to
    // other branches, not just the root (see buildMazePaths — parentIndex is
    // uniform over every curve so far), so that footprint has no real upper
    // bound and grows quietly with branchCount. That's what was inflating
    // domain size well past the tool's own ~18x12 reference board (confirmed:
    // a 130-tile target den reached ~24x36 units), which starves the
    // gridN=64 base SDF lattice's resolution down to ~0.55-unit cells — more
    // than half a tile wide — and that, not any bleed/erosion the carve
    // passes cause, is why walls between corridors were coming out as
    // scattered fragments with gaps: the base grid was too coarse to even
    // hold a tile-wide solid strip. (Bumping gridN to compensate was tried
    // and confirmed *not* viable: matching the tool's own resolution density
    // over a domain that large needs gridN>150, and this engine's carve cost
    // scales far worse than the O(N^3) field size alone — a single den took
    // minutes to generate at gridN=128.) Sizing the domain analytically from
    // branchCount instead — the same way the tool's own fixed board is
    // independent of its branch count — keeps physical scale (and therefore
    // gridN=64's resolution) matched to the tool's reference density
    // regardless of how big/branchy a den's target tile count asks for.
    // The 1.5x factor compensates for the area boundsRect/rootLen actually
    // get to use once they're kept clear of the domain's open-air padding
    // margin below, so cavern-generator.js's target tile counts still land
    // where intended — confirmed against headless generation runs.
    const refArea = 18 * 12 * 1.5, refAspect = 18 / 12, refBranchCount = 16;
    const area = refArea * (Math.max(1, opts.branchCount) / refBranchCount);
    const domPad = opts.probeRadius * 3 + opts.brushRadius * 3 + 4;
    const baseZ = Math.sqrt(area / refAspect), baseX = refAspect * baseZ;
    const dims = { x: baseX + domPad, y: opts.sizeY, z: baseZ + domPad };

    const st = createSculptState(dims, opts.gridN, opts.baseCell);

    // The root and its branches are generated directly in this final local
    // (domain-centered) space — dims no longer depends on where the path
    // ends up, so there's no separate raw-space-then-reproject step needed.
    // The entrance sits a fixed margin in from the domain's south edge
    // (matching the vestibule/doorway logic below — open room south of the
    // entrance, maze room north of it), centered in X (root/branches fan out
    // roughly evenly either side). rootLen has to fit the domain's own north
    // margin now that the domain is fixed-size instead of grown to fit
    // whatever the root produced — a root spec'd to run past the domain edge
    // would just waste most of its own length carving nothing (branches
    // still fan out from wherever it actually lands, same as the tool's own
    // board-independent branchCount), so it's derived from the available
    // room instead of straight from entranceLength.
    const entranceMarginZ = Math.max(5, domPad * .6);
    const entranceZ = dims.z / 2 - entranceMarginZ;
    const availableRootZ = Math.max(opts.branchLength * 3, dims.z - entranceMarginZ - domPad * .5);
    const rootLen = Math.max(4, Math.min(opts.entranceLength, Math.floor(availableRootZ / opts.branchLength) + 1));
    const rootPts = [{ x: 0, y: 0, z: entranceZ }];
    for (let i = 1; i < rootLen; i++) rootPts.push({ x: (rng() * 2 - 1) * 1.5, y: 0, z: entranceZ - i * opts.branchLength });

    const paths = buildMazePaths(rootPts, opts, rng);

    // Branches routinely chain onto other branches (not just the root — see
    // buildMazePaths), so the network's total reach has no real bound and
    // can land right at (or past) the domain's own edge. That's fatal here:
    // pristineAt/createSculptState's initial fill both go negative (open)
    // for any point beyond dims/2 — the outer domainHalf padding is
    // deliberately open air so dual-contouring can close the mesh's outer
    // shell cleanly, not a solid buffer — so a claimed tile whose boundary
    // lands out there can never grow a wall no matter what solidifyBoundaryWalls
    // does: pristineAt itself reports "open" there, before any carve ever
    // ran (confirmed directly — a tile's healed edge sampled bit-for-bit
    // identical before and after the heal pass, because both readings were
    // already past dims/2). Clamp every carve point safely inside dims/2
    // instead of trusting the network to stay in bounds on its own.
    const clipMargin = Math.max(2.5, domPad * .5);
    const boundX = dims.x / 2 - clipMargin, boundZ = dims.z / 2 - clipMargin;
    const clampPt = p => ({ x: clampNum(p.x, -boundX, boundX), y: p.y, z: clampNum(p.z, -boundZ, boundZ) });
    const denseLocal = paths.map(p => sampleSpline(p, 10).map(clampPt));

    // Matches the tool's own floorHeightAt exactly, with floorVariation
    // forced to 0 (flat floor, no undulation). No ceilingY at all — see
    // this function's docblock for why that's deliberate, not an oversight.
    const floorY = opts.pathYOffset - opts.probeRadius + opts.floorOffset;
    const carveOpts = Object.assign({}, opts, {
      floorY, ceilingY: null,
      levels: [opts.pathYOffset],
    });

    for (const path of denseLocal) carveAlongSpline2D(st, path, carveOpts, rng);

    // Constrained to boundX/boundZ (dims/2 minus clipMargin), NOT out to
    // dims/2 itself — the old "+1 past dims/2" version reached straight into
    // the domain's always-open padding margin (see the clampPt comment
    // above), so every tile along the outermost ring of this rect sampled as
    // "open" unconditionally, before any carve ever ran, and got claimed
    // with no solid rock possible beyond it for a wall to form against.
    // Confirmed directly: with the old bounds, 100% of the maze's missing
    // walls sat exactly on this rect's own perimeter (row/col 1 and the
    // opposite edge), none in the interior — the corridor-separating walls
    // this whole heal pass was built for were already fine.
    const boundsRect = {
      minC: Math.floor(-boundX), maxC: Math.ceil(boundX),
      minR: Math.floor(-boundZ), maxR: Math.ceil(boundZ),
    };
    const claimed = snapClaimTiles(st, boundsRect, carveOpts);

    // Guarantee the 3-wide entrance regardless of how the organic carve
    // landed on the tile grid.
    const entranceTiles = [-1, 0, 1].map(dx => [Math.floor(dx), Math.floor(entranceZ)]);
    for (const [c, r] of entranceTiles) { claimed.add(`${c},${r}`); carveTileColumn(st, c, r, carveOpts); }

    // Reserve a 2x2 nest chamber at the tile farthest (by walk distance)
    // from the entrance, and carve it in so it's real volume, not just a
    // floor-tile flag with nothing behind it.
    const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const startKey = entranceTiles[1].join(',');
    const dist = new Map([[startKey, 0]]);
    const queue = [startKey];
    let farKey = startKey, farDist = 0;
    while (queue.length) {
      const key = queue.shift();
      const d = dist.get(key);
      const [x, y] = key.split(',').map(Number);
      for (const [dx, dy] of DIRS4) {
        const nk = `${x + dx},${y + dy}`;
        if (claimed.has(nk) && !dist.has(nk)) {
          dist.set(nk, d + 1);
          queue.push(nk);
          if (d + 1 > farDist) { farDist = d + 1; farKey = nk; }
        }
      }
    }
    const [nfx, nfy] = farKey.split(',').map(Number);
    const nestTiles = [[nfx, nfy], [nfx + 1, nfy], [nfx, nfy + 1], [nfx + 1, nfy + 1]];
    for (const [c, r] of nestTiles) { claimed.add(`${c},${r}`); carveTileColumn(st, c, r, carveOpts); }

    // Carving the entrance tiles themselves (above) only opens their own
    // column — nothing south of the entrance row was ever carved by the
    // maze, so without this the doorway is an isolated pocket walled shut
    // on every side, including the threshold itself: the real solid/open
    // SDF surface sits right at the visible boundary. Carve a shallow
    // vestibule beyond it too (never added to `claimed`, so it's never
    // rendered) purely to push that real surface out past the clipped
    // region, so the doorway reads as a genuine opening.
    const VESTIBULE_DEPTH = 2;
    for (const [c, r] of entranceTiles) {
      for (let dr = 1; dr <= VESTIBULE_DEPTH; dr++) carveTileColumn(st, c, r + dr, carveOpts);
    }

    // The entrance tiles border unclaimed (exterior/vestibule) tiles on
    // their south side (+r, growth heads toward -z which maps to -r)
    // exactly like any other cavern boundary would — without this
    // exclusion, stitchBoundaryCaps walls that edge shut too.
    const skipCapEdges = new Set(entranceTiles.map(([c, r]) => `${c},${r},S`));

    // Heal any wall the organic carve thinned or erased where it bled past
    // a claimed tile's edge into an unclaimed neighbor (see this
    // function's docblock) — run once, after every carve/claim/force step
    // above has finished, right before meshing.
    solidifyBoundaryWalls(st, claimed, Math.max(opts.brushRadius, opts.probeRadius) + opts.wallGridMargin, skipCapEdges);

    const mesh = extractMesh(st, claimed, skipCapEdges);

    // Shift Y so the floor sits at y=0 — the game's floor-referenced
    // convention (see interior-scene-builder.js's panelCornersFor).
    for (let i = 1; i < mesh.positions.length; i += 3) mesh.positions[i] += -floorY;

    return { claimed, entranceTiles, nestTile: [nfx, nfy], mesh };
  }

  window.CavernSculptor = {
    createSculptState, carveHook, carveSphere, buildMazePaths, sampleSpline,
    carveAlongSpline2D, snapClaimTiles, carveTileColumn, solidifyBoundaryWalls,
    extractMesh, carveMazeCavern,
  };
})();
