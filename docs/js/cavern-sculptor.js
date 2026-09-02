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
    // The detection region is an oval, not a sphere: X/Z stay at `radius`,
    // but Y reaches all the way to opts.probeYRadius — an absolute value
    // (half the sculpt volume's own height, see carveMazeCavern) rather
    // than a multiple of `radius`, so a narrow connector's oval still
    // reaches full floor-to-ceiling height even though it's carved
    // shoulder-narrow. yScale is the standard cheap ellipsoid-SDF trick:
    // divide the Y delta by (probeYRadius/radius) before the hypot check,
    // then compare against `radius` like any other axis.
    const probeYRadius = opts?.probeYRadius || radius;
    const yScale = probeYRadius / radius;
    const g = worldToGrid(st, center);
    const sx = 2 * st.domainHalf.x / st.N, sy = 2 * st.domainHalf.y / st.N, sz = 2 * st.domainHalf.z / st.N;
    const cellPad = Math.hypot(sx, sy, sz) * .52;
    const scanR = radius + cellPad;
    const scanRY = probeYRadius + cellPad;
    const ir = Math.ceil(scanR / sx) + 1, jr = Math.ceil(scanRY / sy) + 1, kr = Math.ceil(scanR / sz) + 1;
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
          const d = Math.hypot(x - center.x, (y - center.y) / yScale, z - center.z);
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
  // one — protectedUnclaimed (the entrance's doorway/vestibule tiles) is
  // excluded by TARGET tile identity, checked the same way regardless of
  // which claimed tile is doing the healing, or this would silently
  // re-seal the one opening that's supposed to exist from whichever side
  // of it a claimed tile happens to approach from — confirmed directly:
  // an ordinary maze tile with no special role, sitting beside a
  // vestibule tile from the side, re-solidified it even after the
  // entrance tile's own straight-ahead edge was correctly left alone.
  function solidifyBoundaryWalls(st, claimed, depth, protectedUnclaimed, tileSize, refineOpts) {
    const ts = tileSize || 1;
    const hx = st.dims.x * .5, hy = st.dims.y * .5, hz = st.dims.z * .5;
    const pristineAt = (x, y, z) => Math.min(hx - Math.abs(x), hy - Math.abs(y), hz - Math.abs(z));
    // The heal itself must never reach past the immediate unclaimed
    // neighbor's own far edge — depth (a physical margin derived from
    // brush/probe radius, independent of tileSize) can be, and often is,
    // wider than a single tile once tileSize gets small (confirmed: at
    // tileSize .5 with the default probe/brush radii, depth ≈ .7 > ts).
    // Since the "is this edge even unclaimed" check below only looks at
    // the ONE immediate neighbor, an unclamped heal region can overshoot
    // straight through that neighbor and silently re-solidify a tile two
    // steps away that IS claimed and was already correctly carved open —
    // confirmed directly via a before/after field snapshot around this
    // call: a claimed tile's own center flipped from open to solid purely
    // from a distant neighbor's heal pass, producing a real hole in the
    // floor mesh with no wall/bump to show for it (no clipping artifact —
    // the geometry was just gone). Clamping to at most one tile width
    // keeps every heal inside the single neighbor tile it was actually
    // verified unclaimed for.
    const healDepth = Math.min(depth, ts);
    // Heals one rectangle [x0,x1]x[z0,z1] (already clamped to at most one
    // tile wide/deep by the caller) — shared by both the 4 orthogonal edge
    // heals and the 4 diagonal corner heals below, since the actual
    // restore-toward-pristine logic and its precision fix are identical
    // either way.
    function healRect(x0, x1, z0, z1) {
      const g0 = worldToGrid(st, { x: x0, y: -st.domainHalf.y, z: z0 });
      const g1 = worldToGrid(st, { x: x1, y: st.domainHalf.y, z: z1 });
      // floor(min)/ceil(max) is a fast bounding-box PRE-filter, not the
      // actual heal boundary — it over-includes grid points near the edge
      // on purpose for carving (see carveTileColumn, where over-inclusion
      // only ever opens MORE space, which is harmless). Healing does the
      // opposite — it restores toward solid — so any grid point swept up
      // by this coarse pre-filter but genuinely outside [x0,x1]x[z0,z1]
      // must be explicitly excluded below, or a single grid cell wider
      // than one tile (confirmed: happens at tileSize .5 with this
      // engine's usual domain sizes) lets the heal quietly reach past the
      // one neighbor tile it was verified unclaimed for and re-solidify a
      // claimed tile beyond it — confirmed directly via a before/after
      // field snapshot around this call showing exactly that on a real
      // den.
      const eps = 1e-6;
      const i0 = Math.max(0, Math.floor(Math.min(g0.x, g1.x))), i1 = Math.min(st.N, Math.ceil(Math.max(g0.x, g1.x)));
      const k0 = Math.max(0, Math.floor(Math.min(g0.z, g1.z))), k1 = Math.min(st.N, Math.ceil(Math.max(g0.z, g1.z)));
      for (let k = k0; k <= k1; k++) {
        const z = lerp(-st.domainHalf.z, st.domainHalf.z, k / st.N);
        if (z < z0 - eps || z > z1 + eps) continue;
        for (let j = 0; j <= st.N; j++) {
          const y = lerp(-st.domainHalf.y, st.domainHalf.y, j / st.N);
          for (let i = i0; i <= i1; i++) {
            const x = lerp(-st.domainHalf.x, st.domainHalf.x, i / st.N);
            if (x < x0 - eps || x > x1 + eps) continue;
            const id = idxP(st, i, j, k);
            const pristine = pristineAt(x, y, z);
            if (pristine > st.field[id]) st.field[id] = pristine; // only ever restore, never carve
          }
        }
      }
      // The heal above is unconditionally correct at the finest grid
      // resolution, same as carveTileColumn's own field write — but, same
      // as there, it doesn't refine the octree structure. A coarse leaf
      // straddling this edge has to blend the tile-column's sharp, blocky
      // "wall pushed to exactly here" cut against the organic spline
      // carve's own much softer, jittery gradient just past it — the
      // mismatch is what actually produces a wall surface that
      // wobbles/bumps across the true boundary instead of hugging it,
      // reading as rock poking into the floor's own walkable space (or
      // receding into it) rather than a clean flush wall. Refining along
      // the edge at every height the sweep uses — the same mechanism
      // carveTileColumn already relies on for its own tile — closes that
      // gap here too.
      if (refineOpts && refineOpts.adaptive !== false && refineOpts.levels) {
        const ecx = (x0 + x1) * .5, ecz = (z0 + z1) * .5;
        const rr = Math.max(depth, ts * .6);
        for (const y of refineOpts.levels) ensureLocalResolution(st, { x: ecx, y, z: ecz }, rr, refineOpts);
        // Same floorY gap as carveTileColumn's own refine call, and the
        // same fix — refineNear unconditionally, not gated behind
        // faceThreshold (see carveTileColumn's own comment on why the
        // gate isn't reliable specifically at floor height).
        if (refineOpts.floorY != null) refineNear(st, { x: ecx, y: refineOpts.floorY, z: ecz }, rr, refineOpts.minCell, false);
      }
    }
    for (const key of claimed) {
      const [c, r] = key.split(',').map(Number);
      // c/r are tile indices; depth is a physical-world margin (independent
      // of tile size — it's derived from brush/probe radius), so only the
      // tile edges themselves convert through tileSize, not depth.
      const wx0 = c * ts, wx1 = (c + 1) * ts, wz0 = r * ts, wz1 = (r + 1) * ts;
      const edges = [
        { nc: c - 1, nr: r, x0: wx0 - healDepth, x1: wx0, z0: wz0, z1: wz1 },
        { nc: c + 1, nr: r, x0: wx1, x1: wx1 + healDepth, z0: wz0, z1: wz1 },
        { nc: c, nr: r - 1, x0: wx0, x1: wx1, z0: wz0 - healDepth, z1: wz0 },
        { nc: c, nr: r + 1, x0: wx0, x1: wx1, z0: wz1, z1: wz1 + healDepth },
      ];
      for (const e of edges) {
        const nKey = `${e.nc},${e.nr}`;
        if (claimed.has(nKey)) continue; // shared wall between two claimed tiles stays open
        // protectedUnclaimed (the doorway/vestibule) is checked by the
        // TARGET tile's own identity, not by which claimed tile happens
        // to be doing the healing — a vestibule tile can legitimately
        // border several different claimed tiles (the entrance tile
        // directly north of it, but also whatever the maze's own network
        // grew next to it on another side), and every one of those
        // borders needs the same protection, not just the one edge the
        // entrance tile itself owns. Confirmed directly: an ordinary
        // claimed maze tile with no special role at all, sitting beside a
        // vestibule tile, was silently re-solidifying it from the side
        // even after the doorway's own straight-ahead edge was correctly
        // protected.
        if (protectedUnclaimed?.has(nKey)) continue;
        healRect(e.x0, e.x1, e.z0, e.z1);
      }
      // The 4 orthogonal edges above only ever heal a strip directly
      // ahead of one of this tile's own edges — a diagonal neighbor
      // (e.g. NW) that's unclaimed but sits tucked into a concave inside
      // corner (sandwiched between two OTHER claimed tiles, so neither of
      // ITS OWN orthogonal edges ever gets flagged unclaimed from this
      // tile's perspective either) can fall through untouched by every
      // edge heal in the whole pass. Confirmed directly: on real dens,
      // 100% of the remaining post-fix boundary failures were exactly
      // this — a diagonal-adjacent unclaimed tile never reached by any
      // orthogonal heal. Healing the diagonal neighbor's own square
      // (same footprint an orthogonal heal would cover, just offset
      // corner-to-corner) closes it.
      const diagonals = [
        { nc: c - 1, nr: r - 1, x0: wx0 - healDepth, x1: wx0, z0: wz0 - healDepth, z1: wz0 },
        { nc: c + 1, nr: r - 1, x0: wx1, x1: wx1 + healDepth, z0: wz0 - healDepth, z1: wz0 },
        { nc: c - 1, nr: r + 1, x0: wx0 - healDepth, x1: wx0, z0: wz1, z1: wz1 + healDepth },
        { nc: c + 1, nr: r + 1, x0: wx1, x1: wx1 + healDepth, z0: wz1, z1: wz1 + healDepth },
      ];
      for (const d of diagonals) {
        const nKey = `${d.nc},${d.nr}`;
        if (claimed.has(nKey)) continue; // a claimed diagonal tile is real floor — never heal it
        if (protectedUnclaimed?.has(nKey)) continue; // same doorway/vestibule protection as the edges above
        healRect(d.x0, d.x1, d.z0, d.z1);
      }
    }
  }

  // Pushes the wall out to exactly this tile's edges (plus a small
  // margin), floor to ceiling — same idea as the tool's carveGridRect.
  function carveTileColumn(st, c, r, opts) {
    const ts = opts.tileSize || 1;
    const margin = opts.wallGridMargin ?? .05; // physical margin, independent of tile size
    const x0 = c * ts - margin, x1 = (c + 1) * ts + margin, z0 = r * ts - margin, z1 = (r + 1) * ts + margin;
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
    // The field write above is unconditionally correct at the finest grid
    // resolution, but it doesn't refine the octree structure itself —
    // adaptive refinement only ever fires from an actual carve stamp (see
    // ensureLocalResolution inside carveSphere), so a coarse, un-refined
    // leaf far from any stamp's own centerline can still span several
    // tiles at once. If one of those tiles is a legitimate wall while
    // this one is now open, that single coarse leaf straddles both and
    // produces one large, imprecise dual-contour facet instead of a clean
    // flat boundary — confirmed directly (mesh + top-down visual
    // inspection) to be what actually produced "holes in the ceiling, but
    // not full line of sight" inside wide cluster rooms: narrow
    // connectors, carved via a dense single-file stamp sweep, never had
    // the problem, only room interiors away from any stamp's own path
    // did. Explicitly refining here — the same mechanism an actual stamp
    // already relies on — at this tile's own center, at every height the
    // maze's sweep uses, closes that gap for every claimed tile, not just
    // ones lucky enough to sit directly under a stamp.
    //   floorY itself also needs its own explicit refine call, not just
    // opts.levels — the lowest sweep level sits a full probeYRadius above
    // floorY (see carveMazeCavern's own floorY formula), well outside a
    // sweep-centered refine sphere's own reach (confirmed directly: a
    // claimed tile along a sparsely-stamped single-file corridor — where
    // no organic hook stamp happened to refine near the floor on its
    // own — left an octree leaf 2+ cells wide straddling the actual floor
    // crossing, so the mesh's own vertex there landed nowhere near
    // floorY, reading as a real gap in the rendered floor even though the
    // field itself was correctly open). This one can't use
    // ensureLocalResolution's own faceThreshold gate like the sweep
    // levels do — confirmed directly that gate can read "enough nearby
    // surface leaves" from unrelated wall geometry elsewhere in the same
    // sparse corridor and stop early, leaving the floor's own leaf coarse
    // regardless. refineNear(..., oneLevelOnly:false) refines straight
    // down to minCell unconditionally, which is what floor precision
    // actually needs — every claimed tile's own floor, not most of them.
    if (opts.adaptive !== false && opts.levels) {
      const rr = Math.max(opts.probeRadius || 0, ts * .75);
      for (const y of opts.levels) ensureLocalResolution(st, { x: cx, y, z: cz }, rr, opts);
      if (opts.floorY != null) refineNear(st, { x: cx, y: opts.floorY, z: cz }, rr, opts.minCell, false);
    }
  }

  // Claims every tile in boundsRect whose floor is open enough (nine-point
  // coverage sample, same threshold idea as the tool's snapWallsToFloorGrid),
  // then squares up each claimed tile's walls. The claimed set *is* the
  // room's floor tile set — replaces a separate blob-growth algorithm.
  function snapClaimTiles(st, boundsRect, opts) {
    const ts = opts.tileSize || 1;
    const fractions = [.2, .5, .8];
    const required = Math.max(1, Math.ceil(9 * (opts.wallGridClaim ?? .35)));
    const sampleY = opts.floorY + Math.max(.06, Math.min(.16, opts.probeRadius * .28));
    const claimed = new Set();
    for (let r = boundsRect.minR; r <= boundsRect.maxR; r++) {
      for (let c = boundsRect.minC; c <= boundsRect.maxC; c++) {
        let open = 0;
        for (const fz of fractions) {
          const z = lerp(r * ts, (r + 1) * ts, fz);
          for (const fx of fractions) {
            const x = lerp(c * ts, (c + 1) * ts, fx);
            if (sampleFieldNearestWorld(st, x, sampleY, z) <= 0) open++;
          }
        }
        if (open >= required) claimed.add(`${c},${r}`);
      }
    }
    for (const key of claimed) { const [c, r] = key.split(',').map(Number); carveTileColumn(st, c, r, opts); }
    return claimed;
  }

  // Which tiles any carve stamp actually reached, as opposed to which
  // tiles are walkable (claimed) — a much broader set, since a corridor's
  // own wall/ceiling curve genuinely occupies plenty of tiles never dense
  // enough underfoot to be claimed. Mirrors the reference tool's own
  // buildUntouchedCullMask exactly: scan every finest-grid column, compare
  // its field against pristineAt (the field's own pre-carve, uncarved
  // value — see solidifyBoundaryWalls), and mark every tile a changed
  // sample could have influenced (the `influence` padding — a changed
  // sample can move the zero-crossing surface roughly one lattice spacing
  // in either direction, so a ragged wall whose controlling sample sits
  // right on a tile line must not silently fall on the wrong side of it).
  // extractMesh's cull is keyed off this set (not `claimed`) so the final
  // mesh keeps every genuinely-carved surface — the tunnel's real wall and
  // ceiling — right up to where carving actually stopped, only discarding
  // rock nothing ever touched.
  function computeTouchedTiles(st, tileSize, tolerance) {
    const ts = tileSize || 1;
    const hx = st.dims.x * .5, hy = st.dims.y * .5, hz = st.dims.z * .5;
    const pristineAt = (x, y, z) => Math.min(hx - Math.abs(x), hy - Math.abs(y), hz - Math.abs(z));
    const tol = tolerance ?? .01;
    const dx = 2 * st.domainHalf.x / st.N, dz = 2 * st.domainHalf.z / st.N;
    const influenceX = dx * .8, influenceZ = dz * .8;
    const touched = new Set();
    for (let k = 0; k <= st.N; k++) {
      const z = lerp(-st.domainHalf.z, st.domainHalf.z, k / st.N);
      for (let i = 0; i <= st.N; i++) {
        const x = lerp(-st.domainHalf.x, st.domainHalf.x, i / st.N);
        let columnTouched = false;
        for (let j = 0; j <= st.N; j++) {
          const y = lerp(-st.domainHalf.y, st.domainHalf.y, j / st.N);
          if (st.field[idxP(st, i, j, k)] < pristineAt(x, y, z) - tol) { columnTouched = true; break; }
        }
        if (!columnTouched) continue;
        const ix0 = Math.floor((x - influenceX) / ts), ix1 = Math.floor((x + influenceX) / ts);
        const iz0 = Math.floor((z - influenceZ) / ts), iz1 = Math.floor((z + influenceZ) / ts);
        for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) touched.add(`${ix},${iz}`);
      }
    }
    return touched;
  }

  // A near-spherical probe swept along a path carves a continuously
  // rounded tube by construction — floor curves into wall curves into
  // ceiling with no flat plane anywhere. carveTileColumn guarantees every
  // claimed tile's own column is genuinely open (so there's never a real
  // collision mismatch), but the mesh clip still clips ANY triangle —
  // including a neighboring wall/ceiling curve's — into any tile rect its
  // XZ footprint overlaps, so a claimed tile right at the maze's outer
  // edge can end up visually cluttered with spillover wall geometry
  // layered over its own floor. Rather than chase that geometry around
  // (tried: an expensive boundary-refine buffer; tried: filtering
  // fragments by height, which just as easily deletes the tile's own
  // genuine ceiling) — measure it directly from the raw, unclipped mesh:
  // for each claimed tile that borders unclaimed rock, clip only that
  // tile's own rect and compare how much of the result actually sits near
  // the real floor (`floorY`) against how much doesn't. A tile dominated
  // by non-floor clutter gets handed back for removal from `claimed` — see
  // carveMazeCavern's connectivity-safe removal loop, which actually drops
  // it (same effect as "make it collide": bGrid defaults every non-floor
  // tile to solid rock already).
  function classifyDeformedBoundaryTiles(rawMesh, claimed, floorY, probeYRadius, tileSize, minFloorCoverage) {
    const ts = tileSize || 1;
    const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const boundary = new Set();
    for (const key of claimed) {
      const [c, r] = key.split(',').map(Number);
      if (DIRS4.some(([dx, dy]) => !claimed.has(`${c + dx},${r + dy}`))) boundary.add(key);
    }
    if (!boundary.size) return new Set();
    const floorArea = new Map(), totalArea = new Map();
    for (const key of boundary) { floorArea.set(key, 0); totalArea.set(key, 0); }
    const floorBand = probeYRadius * .35;
    const pos = rawMesh.positions, idx = rawMesh.indices;
    for (let q = 0; q < idx.length; q += 3) {
      const ia = idx[q] * 3, ib = idx[q + 1] * 3, ic = idx[q + 2] * 3;
      const tri = [
        { x: pos[ia], y: pos[ia + 1], z: pos[ia + 2] },
        { x: pos[ib], y: pos[ib + 1], z: pos[ib + 2] },
        { x: pos[ic], y: pos[ic + 1], z: pos[ic + 2] },
      ];
      const minX = Math.min(tri[0].x, tri[1].x, tri[2].x), maxX = Math.max(tri[0].x, tri[1].x, tri[2].x);
      const minZ = Math.min(tri[0].z, tri[1].z, tri[2].z), maxZ = Math.max(tri[0].z, tri[1].z, tri[2].z);
      const ix0 = Math.floor(minX / ts), ix1 = Math.floor((maxX - 1e-7) / ts);
      const iz0 = Math.floor(minZ / ts), iz1 = Math.floor((maxZ - 1e-7) / ts);
      const avgY = (tri[0].y + tri[1].y + tri[2].y) / 3;
      const isFloor = Math.abs(avgY - floorY) <= floorBand;
      for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
        const key = `${ix},${iz}`;
        if (!boundary.has(key)) continue;
        const poly = clipPolyToXZRect(tri, ix * ts, (ix + 1) * ts, iz * ts, (iz + 1) * ts);
        if (poly.length < 3) continue;
        let area = 0;
        for (let p = 1; p < poly.length - 1; p++) {
          const a = poly[0], b = poly[p], c2 = poly[p + 1];
          area += Math.abs((b.x - a.x) * (c2.z - a.z) - (c2.x - a.x) * (b.z - a.z)) * .5;
        }
        totalArea.set(key, totalArea.get(key) + area);
        if (isFloor) floorArea.set(key, floorArea.get(key) + area);
      }
    }
    const deformed = new Set();
    for (const key of boundary) {
      const total = totalArea.get(key);
      if (total <= 1e-9) continue; // nothing rendered here at all — not this pass's concern
      if (floorArea.get(key) / total < minFloorCoverage) deformed.add(key);
    }
    return deformed;
  }

  // True iff every tile in claimedSet is reachable from startKey through
  // orthogonal claimed neighbors — used to veto a deformed-tile removal
  // that would sever the maze into disconnected pockets (see
  // carveMazeCavern's removal loop).
  function isClaimedSetConnected(claimedSet, startKey) {
    if (!claimedSet.has(startKey)) return false;
    const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const seen = new Set([startKey]);
    const queue = [startKey];
    while (queue.length) {
      const key = queue.shift();
      const [x, y] = key.split(',').map(Number);
      for (const [dx, dy] of DIRS4) {
        const nk = `${x + dx},${y + dy}`;
        if (claimedSet.has(nk) && !seen.has(nk)) { seen.add(nk); queue.push(nk); }
      }
    }
    return seen.size === claimedSet.size;
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
  function stitchBoundaryCaps(st, keepTiles, addTri, skipCapEdges, tileSize) {
    const ts = tileSize || 1;
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
      const x0 = c * ts, x1 = (c + 1) * ts, z0 = r * ts, z1 = (r + 1) * ts;
      if (!keepTiles.has(`${c - 1},${r}`) && !skip(c, r, 'W')) addEdge(x0, z0, x0, z1, false);
      if (!keepTiles.has(`${c + 1},${r}`) && !skip(c, r, 'E')) addEdge(x1, z0, x1, z1, true);
      if (!keepTiles.has(`${c},${r - 1}`) && !skip(c, r, 'N')) addEdge(x0, z0, x1, z0, true);
      if (!keepTiles.has(`${c},${r + 1}`) && !skip(c, r, 'S')) addEdge(x0, z1, x1, z1, false);
    }
  }

  // keepTiles is the set of tile keys ("c,r") whose XZ rect the final mesh
  // is allowed to occupy — every triangle gets clipped exactly to which
  // rect(s) it overlaps, and any edge where a kept tile borders a
  // non-kept one gets sealed with a stitched cap (see stitchBoundaryCaps).
  // carveMazeCavern passes the *touched* tile set here (every tile any
  // carve stamp actually reached), not just the walkable/claimed set — so
  // organic wall/ceiling geometry stays fully visible right up to the
  // edge of what was actually carved, the same way the reference tool's
  // own "Snap Walls to Grid" + auto-cull only removes genuinely untouched
  // slab, not merely-unwalkable-but-carved rock. An earlier version keyed
  // this off the walkable set alone, which meant a wall/ceiling triangle
  // from just outside a walkable tile could still get clipped INTO that
  // tile's own rect whenever its XZ footprint happened to overlap —
  // reading as a solid bump poking into the floor even though the tile
  // was always genuinely open underneath (carveTileColumn guarantees
  // that). Keying the clip off "touched" instead of "claimed" sidesteps
  // the whole problem: geometry belonging to a neighboring wall just
  // renders in that wall's own tiles, not layered onto the floor.
  // A triangle whose 3 vertices span more than this much Y reads as
  // "wall-like" (steep/vertical), as opposed to a near-flat floor
  // triangle — same heuristic the tuner's own computeMissingWallPct
  // already relies on to find wall geometry by shape alone.
  const WALL_YRANGE_THRESHOLD = 0.15;

  // Surface height used to distinguish a real floor from wall/overhang
  // geometry intruding into a claimed tile during the smooth-sculpt pass.
  const WALKABLE_SURFACE_MAX_ABOVE_FLOOR = 0.18;
  const WALKABLE_SMOOTH_SCULPT_STRENGTH = 0.96; // Used to pull intrusive geometry back toward its wall while retaining a soft bevel.

  function clipAndStitch(st, positions, indices, keepTiles, skipCapEdges, tileSize, claimed, floorY, enforceWalkableClearance) {
    const ts = tileSize || 1;
    const outPositions = []; const outIndices = []; const vmap = new Map();
    const sculptFragmentsByTile = new Map(); // Groups welded intrusion triangles into per-tile wall patches below.
    const sculptVertexUsage = new Map(); // Pins vertices also used by untouched wall triangles outside the brush.
    let walkableSculptFragmentsSmoothed = 0; // Exposed in generation diagnostics and the cavern tuner.
    let walkableSculptSharedTargets = 0; // Counts welded vertices whose adjacent fragments reinforced the same target.
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
      if (ia === ib || ib === ic || ic === ia) return null;
      outIndices.push(ia, ib, ic);
      return [ia, ib, ic];
    };
    // A claimed tile's field is genuinely open, but dual-contour triangles
    // from a neighboring wall can cross its tile boundary. Do not delete
    // those fragments: that makes the route clear by cutting visible holes
    // out of the cave wall. Instead, after clipping the triangle into this
    // tile, queue a high-strength smooth-sculpt-like target. All triangles
    // are first assembled with their ORIGINAL clipped positions so addVertex
    // welds shared edges exactly once. Only after the complete mesh exists do
    // we resolve connected wall patches within each tile, assign one wall
    // edge to the whole patch, and move every welded vertex exactly once.
    // A per-vertex nearest-edge target keeps endpoints shallow but can still
    // stretch the edge between them across the middle of a tile; patch-level
    // targeting prevents that while preserving shared topology.
    // The previous per-triangle deformation could send two copies of
    // what began as the same edge toward slightly different walls, producing
    // the visible cuts this shared pass is designed to prevent.
    const queueWalkableSculpt = (key, poly, vertexIds, yRange) => {
      if (!poly?.length || !vertexIds) return;
      const isWall = yRange > WALL_YRANGE_THRESHOLD;
      const isOverhang = floorY != null && poly.every(v => v.y > floorY + WALKABLE_SURFACE_MAX_ABOVE_FLOOR);
      const shouldSculpt = floorY != null && claimed?.has(key) && (isWall || isOverhang);
      for (const id of vertexIds) {
        let usage = sculptVertexUsage.get(id);
        if (!usage) { usage = { sculpted: false, anchored: false }; sculptVertexUsage.set(id, usage); }
        if (shouldSculpt) usage.sculpted = true;
        else usage.anchored = true;
      }
      if (!shouldSculpt) return;
      walkableSculptFragmentsSmoothed++;
      let fragments = sculptFragmentsByTile.get(key);
      if (!fragments) { fragments = []; sculptFragmentsByTile.set(key, fragments); }
      fragments.push({ vertexIds: vertexIds.slice(), poly });
    };

    for (let q = 0; q < indices.length; q += 3) {
      const ia = indices[q] * 3, ib = indices[q + 1] * 3, ic = indices[q + 2] * 3;
      const tri = [
        { x: positions[ia], y: positions[ia + 1], z: positions[ia + 2] },
        { x: positions[ib], y: positions[ib + 1], z: positions[ib + 2] },
        { x: positions[ic], y: positions[ic + 1], z: positions[ic + 2] },
      ];
      const yRange = Math.max(tri[0].y, tri[1].y, tri[2].y) - Math.min(tri[0].y, tri[1].y, tri[2].y);
      // Even a vertical triangle with zero projected XZ area must go
      // through per-tile clipping. The old centroid-only shortcut let one
      // long wall triangle cross a tile boundary unsmoothed, leaving a
      // single sharp fin after every ordinary fragment was sculpted.
      const minX = Math.min(tri[0].x, tri[1].x, tri[2].x), maxX = Math.max(tri[0].x, tri[1].x, tri[2].x);
      const minZ = Math.min(tri[0].z, tri[1].z, tri[2].z), maxZ = Math.max(tri[0].z, tri[1].z, tri[2].z);
      const ix0 = Math.floor(minX / ts), ix1 = Math.floor((maxX - 1e-7) / ts);
      const iz0 = Math.floor(minZ / ts), iz1 = Math.floor((maxZ - 1e-7) / ts);
      for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
        const key = `${ix},${iz}`;
        if (!keepTiles.has(key)) continue;
        const poly = clipPolyToXZRect(tri, ix * ts, (ix + 1) * ts, iz * ts, (iz + 1) * ts);
        if (poly.length < 3) continue;
        // Smooth each triangulated fragment independently. A clipped quad
        // can straddle a tile corner; choosing one target wall for the whole
        // polygon leaves the fan triangle nearest another edge untouched.
        for (let p = 1; p < poly.length - 1; p++) {
          const fragment = [poly[0], poly[p], poly[p + 1]];
          const vertexIds = addTri(fragment[0], fragment[1], fragment[2]);
          queueWalkableSculpt(key, fragment, vertexIds, yRange);
        }
      }
    }

    // Boundary caps are synthesized after the ordinary triangle loop, so
    // route them through the same sculpt brush as raw wall fragments. A cap
    // can legitimately land inside a claimed tile when the broader touched-
    // geometry cull ends there; leaving it unsmoothed recreates one isolated
    // square intrusion after every organic fragment has already been fixed.
    const addSmoothedBoundaryTri = (a, b, c) => {
      const cx = (a.x + b.x + c.x) / 3, cz = (a.z + b.z + c.z) / 3;
      const key = `${Math.floor(cx / ts)},${Math.floor(cz / ts)}`;
      const yRange = Math.max(a.y, b.y, c.y) - Math.min(a.y, b.y, c.y);
      const fragment = [a, b, c];
      const vertexIds = addTri(a, b, c);
      queueWalkableSculpt(key, fragment, vertexIds, yRange);
    };
    stitchBoundaryCaps(st, keepTiles, addSmoothedBoundaryTri, skipCapEdges, ts);
    const sculptTargets = new Map(); // Stores the single resolved target ultimately applied to each welded vertex.
    for (const [key, fragments] of sculptFragmentsByTile) {
      const [c, r] = key.split(',').map(Number);
      const x0 = c * ts, x1 = (c + 1) * ts, z0 = r * ts, z1 = (r + 1) * ts;
      const parent = new Map(); // Union-find joins candidate triangles that share a welded vertex in this tile.
      const find = id => {
        let root = id;
        while (parent.get(root) !== root) root = parent.get(root);
        while (parent.get(id) !== id) { const next = parent.get(id); parent.set(id, root); id = next; }
        return root;
      };
      const union = (a, b) => {
        const ra = find(a), rb = find(b);
        if (ra !== rb) parent.set(rb, ra);
      };
      for (const fragment of fragments) {
        for (const id of fragment.vertexIds) if (!parent.has(id)) parent.set(id, id);
        union(fragment.vertexIds[0], fragment.vertexIds[1]);
        union(fragment.vertexIds[0], fragment.vertexIds[2]);
      }
      const components = new Map();
      for (const id of parent.keys()) {
        const root = find(id);
        let ids = components.get(root);
        if (!ids) { ids = []; components.set(root, ids); }
        ids.push(id);
      }
      for (const ids of components.values()) {
        let cx = 0, cz = 0;
        for (const id of ids) { cx += outPositions[id * 3]; cz += outPositions[id * 3 + 2]; }
        cx /= ids.length; cz /= ids.length;
        const edges = [
          { axis: 'x', edge: x0, distance: Math.abs(cx - x0) },
          { axis: 'x', edge: x1, distance: Math.abs(x1 - cx) },
          { axis: 'z', edge: z0, distance: Math.abs(cz - z0) },
          { axis: 'z', edge: z1, distance: Math.abs(z1 - cz) },
        ];
        const target = edges.reduce((best, edge) => edge.distance < best.distance ? edge : best);
        for (const id of ids) {
          const x = outPositions[id * 3], z = outPositions[id * 3 + 2];
          const normalCoord = target.axis === 'x' ? x : z;
          const depth = Math.min(ts * .5, Math.abs(normalCoord - target.edge));
          const t = Math.max(0, Math.min(1, depth / Math.max(1e-6, ts * .5)));
          const smoothFalloff = t * (2 - t); // High-intensity Smooth brush: decisive inward pull with a pinned edge.
          const blend = WALKABLE_SMOOTH_SCULPT_STRENGTH * smoothFalloff;
          const proposal = {
            x: target.axis === 'x' ? lerp(x, target.edge, blend) : x,
            z: target.axis === 'z' ? lerp(z, target.edge, blend) : z,
          };
          proposal.moveSq = (proposal.x - x) ** 2 + (proposal.z - z) ** 2;
          proposal.boundaryDepth = Math.min(
            Math.abs(proposal.x - Math.round(proposal.x / ts) * ts),
            Math.abs(proposal.z - Math.round(proposal.z / ts) * ts),
          );
          const existing = sculptTargets.get(id);
          if (existing) {
            walkableSculptSharedTargets++;
            // Resolve a shared vertex to the proposal that leaves the
            // shallowest final wall bevel; displacement only breaks ties.
            // The vertex is still moved once, so continuity is preserved.
            if (proposal.boundaryDepth < existing.boundaryDepth - 1e-9 ||
                (Math.abs(proposal.boundaryDepth - existing.boundaryDepth) <= 1e-9 && proposal.moveSq < existing.moveSq)) {
              sculptTargets.set(id, proposal);
            }
          } else sculptTargets.set(id, proposal);
        }
      }
    }
    for (const [id, target] of sculptTargets) {
      if (sculptVertexUsage.get(id)?.anchored) continue;
      outPositions[id * 3] = target.x;
      outPositions[id * 3 + 2] = target.z;
    }
    let walkableSculptVerticesMoved = 0;
    let walkableSculptMaxBevelDepth = 0; // Maximum final depth of an actually moved brush vertex, in tile fractions.
    for (const id of sculptTargets.keys()) if (!sculptVertexUsage.get(id)?.anchored) {
      walkableSculptVerticesMoved++;
      const x = outPositions[id * 3], z = outPositions[id * 3 + 2];
      const depth = Math.min(
        Math.abs(x - Math.round(x / ts) * ts),
        Math.abs(z - Math.round(z / ts) * ts),
      ) / ts;
      walkableSculptMaxBevelDepth = Math.max(walkableSculptMaxBevelDepth, depth);
    }
    // Close small, fully-looped wall cuts left by the source dual-contour
    // mesh. These are not the cavern's intentional outer/entrance borders:
    // every vertex has boundary degree 2, the loop is compact, and at least
    // one edge sits visibly inside a claimed tile above the floor. Filling
    // the complete loop with one welded fan produces a continuous rock patch
    // instead of trying to hide its individual open edges with overlapping
    // fragments. The renderer now culls reverse faces, so orient the fan
    // opposite its surviving boundary triangle instead of relying on DoubleSide.
    const edgeUse = new Map(); // Counts final triangle uses per welded edge to locate actual open wall loops.
    for (let q = 0; q < outIndices.length; q += 3) {
      const tri = [outIndices[q], outIndices[q + 1], outIndices[q + 2]];
      for (const [a, b] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]]) {
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        let edge = edgeUse.get(key);
        if (!edge) { edge = { a: Math.min(a, b), b: Math.max(a, b), directedA: a, directedB: b, count: 0 }; edgeUse.set(key, edge); }
        edge.count++;
      }
    }
    const openAdj = new Map();
    const connectOpen = (a, b) => {
      let list = openAdj.get(a);
      if (!list) { list = []; openAdj.set(a, list); }
      list.push(b);
    };
    for (const edge of edgeUse.values()) if (edge.count === 1) {
      connectOpen(edge.a, edge.b); connectOpen(edge.b, edge.a);
    }
    const seenOpen = new Set();
    let walkableSculptCutsSealed = 0; // Exposed in diagnostics so visual hole repair is testable without DevTools.
    for (const start of openAdj.keys()) {
      if (seenOpen.has(start)) continue;
      const stack = [start], component = [];
      while (stack.length) {
        const id = stack.pop();
        if (seenOpen.has(id)) continue;
        seenOpen.add(id); component.push(id);
        for (const next of openAdj.get(id) || []) if (!seenOpen.has(next)) stack.push(next);
      }
      if (component.length < 3 || component.length > 64 || component.some(id => (openAdj.get(id) || []).length !== 2)) continue;
      let containsVisibleCut = false;
      for (const id of component) {
        for (const next of openAdj.get(id)) {
          if (id > next) continue;
          const x = (outPositions[id * 3] + outPositions[next * 3]) * .5;
          const y = (outPositions[id * 3 + 1] + outPositions[next * 3 + 1]) * .5;
          const z = (outPositions[id * 3 + 2] + outPositions[next * 3 + 2]) * .5;
          const tileKey = `${Math.floor(x / ts)},${Math.floor(z / ts)}`;
          const localX = x - Math.floor(x / ts) * ts, localZ = z - Math.floor(z / ts) * ts;
          const boundaryDepth = Math.min(localX, ts - localX, localZ, ts - localZ);
          if (claimed?.has(tileKey) && y > floorY + WALKABLE_SURFACE_MAX_ABOVE_FLOOR && boundaryDepth > ts * .085) {
            containsVisibleCut = true; break;
          }
        }
        if (containsVisibleCut) break;
      }
      if (!containsVisibleCut) continue;
      const ordered = [component[0]];
      let previous = -1, current = component[0];
      while (ordered.length < component.length) {
        const next = (openAdj.get(current) || []).find(id => id !== previous && id !== ordered[0]);
        if (next === undefined || ordered.includes(next)) break;
        ordered.push(next); previous = current; current = next;
      }
      if (ordered.length !== component.length || !(openAdj.get(current) || []).includes(ordered[0])) continue;
      const firstEdgeKey = ordered[0] < ordered[1] ? `${ordered[0]},${ordered[1]}` : `${ordered[1]},${ordered[0]}`;
      const firstBoundaryEdge = edgeUse.get(firstEdgeKey); // Used to orient the new fan opposite the surviving triangle's boundary edge for FrontSide rendering.
      if (firstBoundaryEdge?.directedA === ordered[0] && firstBoundaryEdge?.directedB === ordered[1]) ordered.reverse();
      const center = { x: 0, y: 0, z: 0 };
      for (const id of ordered) {
        center.x += outPositions[id * 3]; center.y += outPositions[id * 3 + 1]; center.z += outPositions[id * 3 + 2];
      }
      center.x /= ordered.length; center.y /= ordered.length; center.z /= ordered.length;
      const centerId = addVertex(center);
      for (let i = 0; i < ordered.length; i++) outIndices.push(ordered[i], ordered[(i + 1) % ordered.length], centerId);
      walkableSculptCutsSealed++;
    }
    // Coarse fields can leave an anchored wall vertex leaning over a floor
    // tile. Clipping has already split the triangle at tile borders, so a
    // final snap to the nearest edge clears the route without opening the
    // surrounding wall.
    let walkableClearanceVerticesMoved = 0;
    if (enforceWalkableClearance && claimed && floorY != null) {
      for (let id = 0; id < outPositions.length / 3; id++) {
        const x = outPositions[id * 3], y = outPositions[id * 3 + 1], z = outPositions[id * 3 + 2];
        if (y <= floorY + WALKABLE_SURFACE_MAX_ABOVE_FLOOR) continue;
        const c = Math.floor((x + 1e-8) / ts), r = Math.floor((z + 1e-8) / ts);
        if (!claimed.has(`${c},${r}`)) continue;
        const edges = [
          { offset: 0, value: c * ts, distance: Math.abs(x - c * ts) },
          { offset: 0, value: (c + 1) * ts, distance: Math.abs((c + 1) * ts - x) },
          { offset: 2, value: r * ts, distance: Math.abs(z - r * ts) },
          { offset: 2, value: (r + 1) * ts, distance: Math.abs((r + 1) * ts - z) },
        ];
        const nearest = edges.reduce((best, edge) => edge.distance < best.distance ? edge : best);
        if (nearest.distance <= 1e-6) continue;
        outPositions[id * 3 + nearest.offset] = nearest.value;
        walkableClearanceVerticesMoved++;
      }
    }
    return {
      positions: new Float32Array(outPositions), indices: outIndices,
      walkableSculptFragmentsSmoothed,
      walkableSculptVerticesMoved,
      walkableSculptSharedTargets,
      walkableSculptCutsSealed,
      walkableSculptMaxBevelDepth,
      walkableClearanceVerticesMoved,
    };
  }

  function extractMesh(st, keepTiles, skipCapEdges, tileSize, claimed, floorY, enforceWalkableClearance) {
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
    return clipAndStitch(st, positions, indices, keepTiles, skipCapEdges, tileSize, claimed, floorY, enforceWalkableClearance);
  }

  // ── Top-level orchestration ─────────────────────────────────────────
  // The thin-slab top-down setup itself matches (HA)TunnelSculptorV1.html's
  // own V5-baseline (see its applyModeDefaults). An early attempt at a tall
  // walkable room bolted on a fixed room-height constant, an artificial
  // solid margin so dual contouring had a ceiling to cap against, and a
  // post-process to strip that cap back out — each layer introduced its
  // own new bug, a sealed ceiling and a walled-shut doorway among them.
  // The current approach avoids the ceiling problem entirely, by
  // construction, without any of that machinery: carveAlongSpline2D sweeps
  // the (near-spherical, see probeYRadius below) detection probe at
  // several overlapping heights (opts.levels) that as a group reach past
  // sizeY's own half-height, so the carve naturally punches through the
  // slab's nominal top with nothing left to cap — there is no ceiling to
  // strip because there's no protected rock left up there to form one
  // from. Only floorOffset is protected (via floorY below), same as the
  // tool's own floorHeightAt with floorVariation forced to 0 (flat, no
  // undulation — the one deliberate v1 simplification kept from the
  // earlier attempt).
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
    // Direct request: detector sphere's xz scale +30% (was .5).
    probeRadius: .5 * 1.3, brushRadius: .34, radiusChaos: .38, dirChaos: .58,
    pickJitter: .48, hookLength: .24, hitsPerStep: 3,
    probeDigBursts: 4, probeMaxPasses: 120,
    faceThreshold: 10, refineRadius: 2.1, minCell: 1, baseCell: 4, gridN: 64,
    wallGridMargin: .05, wallGridClaim: .35,
    // sizeY is the sculpt volume's total height. The wall-detection probe's
    // Y-reach and the multi-level sweep that covers it are not independent
    // constants here — carveMazeCavern derives both directly from sizeY
    // (see its own docblock for the exact formulas), so there's nothing to
    // default for either.
    sizeY: 3.0, floorOffset: 0, entranceLength: 3,
    tileSize: 1,
    // Near-spherical probe's Y semi-axis, as a multiplier of probeRadius
    // (not an absolute value like the old sizeY/2 oval) — 1.8 still reads
    // as much closer to a sphere than the old 3:1 oval, while giving the
    // sweep enough per-pass reach to resolve a cleanly open ceiling (see
    // carveMazeCavern's own comment on the top level's overshoot). Divided
    // by the same 1.3 probeRadius (xz scale) just grew by above, so the Y
    // semi-axis itself (probeRadius * probeYStretch) holds steady at its
    // prior absolute value — the xz-scale request was scoped to xz only.
    probeYStretch: 1.8 / 1.3,
    // Shifts the whole multi-level sweep range (and therefore floorY,
    // which tracks the sweep's own lowest point) up by this fraction of
    // sizeY — direct requests to move the path higher in the volume,
    // .2 then another .1 on top.
    pathYShiftFrac: .3,
    // Fraction of a boundary claimed tile's own footprint that must read as
    // genuine floor (see classifyDeformedBoundaryTiles) before that tile is
    // trusted as walkable — anything under this gets dropped from the
    // returned claimed set (and therefore collides, same as any other rock
    // tile) rather than trying to carve it clean. Defaults to 0 (never
    // triggers): headless calibration showed floorArea/totalArea reads low
    // for the *majority* of ordinary boundary tiles too, not just visibly
    // bad ones — a boundary tile sits exactly where the tube's own wall
    // curves down toward the floor, so a lot of genuinely-belongs-there
    // wall/ceiling area is normal, not a defect, and the metric doesn't
    // yet separate the two. Left wired up (see the tuner) so a real
    // threshold can be picked by eye against live results instead of
    // guessed blind.
    deformedFloorMinCoverage: 0,
    // How far a column's field has to drift from its pristine (never
    // carved) value before computeTouchedTiles counts it as touched — see
    // that function's own docblock. Matches the reference tool's own
    // default.
    cullTouchTolerance: .01,
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
    // where intended — confirmed against headless generation runs. Aspect
    // matches the tool's own 18:12 board — the root spans the domain's
    // full width (X) the same way the tool's own maze root does (see the
    // root-point construction below), so a wider-than-deep board gives it
    // real room to spread before branches take over exploring depth (Z).
    // 2x on top of the 1.5x compensation — doubles the starter volume's own
    // XZ area (dens read noticeably bigger), still sized off branchCount
    // the same tool-density-matching way.
    const refArea = 18 * 12 * 1.5 * 2, refAspect = 18 / 12, refBranchCount = 16;
    const area = refArea * (Math.max(1, opts.branchCount) / refBranchCount);
    const domPad = opts.probeRadius * 3 + opts.brushRadius * 3 + 4;
    const baseZ = Math.sqrt(area / refAspect), baseX = refAspect * baseZ;
    const dims = { x: baseX + domPad, y: opts.sizeY, z: baseZ + domPad };

    const st = createSculptState(dims, opts.gridN, opts.baseCell);

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
    // already past dims/2). Clamp every carve point (and bound the root's
    // own width below) safely inside dims/2 instead of trusting the network
    // to stay in bounds on its own.
    const clipMargin = Math.max(2.5, domPad * .5);
    const boundX = dims.x / 2 - clipMargin, boundZ = dims.z / 2 - clipMargin;

    // The root and its branches are generated directly in this final local
    // (domain-centered) space — dims no longer depends on where the path
    // ends up, so there's no separate raw-space-then-reproject step needed.
    // The entrance sits a fixed margin in from the domain's south edge
    // (matching the vestibule/doorway logic below — open room south of the
    // entrance, maze room north of it).
    //
    // The root itself spans the domain's full WIDTH (X), not depth (Z) —
    // matching the tool's own buildMazePaths exactly ((HA)TunnelSculptorV1.
    // html lines 736-745: rootCount points lerp from -hx-margin to hx+margin,
    // i.e. corner-to-corner across the board's width, with only a small
    // sine-enveloped Z wiggle). A root built that way is self-bounded by
    // construction — it's automatically exactly as long as the domain is
    // wide, for any domain size, with no length to separately derive or fit.
    // Branches (not the root) carry exploration into the other axis via
    // their own wide (50-104°) attachment angles off the root's tangent —
    // since the root runs along X here, that tangent is +X, so branches
    // naturally shoot off roughly north/south (Z) into the den's depth,
    // exactly the exploration this needs, for free, the same way the tool
    // gets it on its own free-floating board. (Reverted from an interim
    // "neuron-shaped" chaotic-cluster-chain topology — its own narrower
    // twin-rail connectors and per-cluster clamping added real geometric
    // complexity right at tile boundaries without a matching payoff: side
    // by side with the reference tool's own plain defaults + Snap Walls to
    // Grid, the plain maze reads just as good and is both simpler and
    // cheaper to carve.)
    const entranceMarginZ = Math.max(5, domPad * .6);
    const entranceZ = dims.z / 2 - entranceMarginZ;
    const rootCount = Math.max(4, opts.pathPointCount || 7);
    const rootMargin = Math.max(opts.probeRadius * 1.35, .35);
    const rootHalfX = Math.max(1, boundX - rootMargin);
    const rootPts = [];
    for (let i = 0; i < rootCount; i++) {
      const t = i / (rootCount - 1);
      const x = lerp(-rootHalfX, rootHalfX, t);
      const envelope = Math.sin(Math.PI * t);
      // Wiggles north only (never back toward the entrance's south-facing
      // vestibule) — the tool's own root wiggles both ways since its board
      // has no fixed entrance side to respect.
      const z = (i === 0 || i === rootCount - 1) ? entranceZ : entranceZ - rng() * (opts.pathWiggle ?? .62) * envelope * opts.branchLength * 1.2;
      rootPts.push({ x, y: 0, z });
    }
    const paths = buildMazePaths(rootPts, opts, rng);
    const clampPt = p => ({ x: clampNum(p.x, -boundX, boundX), y: p.y, z: clampNum(p.z, -boundZ, boundZ) });
    const denseLocal = paths.map(path => sampleSpline(path, opts.splineSamples ?? 10).map(clampPt));

    // No ceilingY at all — see this function's docblock for why that's
    // deliberate, not an oversight. Earlier versions reached this by
    // stretching the detection shape into a tall oval (probeYRadius up to
    // sizeY/2, a 3:1 ratio against probeRadius) — visually that reads as a
    // stretched oval, not a room, which is exactly the feedback that
    // motivated this rework. probeYRadius is now a modest multiplier of
    // probeRadius (near-spherical, same shape family as the tool's own
    // probe) and floor-to-open-ceiling coverage instead comes from
    // sweeping that near-sphere at several overlapping heights — see
    // carveAlongSpline2D's opts.levels loop, which already existed for
    // exactly this but had only ever been given one entry. levelSpacing is
    // kept under 2*probeYRadius so consecutive passes overlap and no thin
    // unswept gap survives between them. floorY is derived directly from
    // the lowest level's own actual bottom rather than a separate formula
    // that could drift out of sync with wherever the probe really sits.
    //   The top level's own overshoot past sizeY/2 has to be generous, not
    // just technically sufficient — confirmed directly (in-game report):
    // a modest overshoot left a patchy, partly-solid ceiling ("holes...
    // but not full line of sight") rather than a genuinely open one, even
    // though the field values right at the domain edge already tested as
    // open. The likely cause is resolution, not field value: adaptive
    // octree refinement (ensureLocalResolution) only fires from actual
    // carve calls, so it only sharpens the mesh near where a probe center
    // actually sat — a shallow top level barely reaching the domain edge
    // refines a thin shell right at the boundary, and wide room interiors
    // away from the exact path centerline can fall back to coarse,
    // blocky corner sampling there. Reaching well past the edge (and
    // using a taller probe generally) both widen that refined margin.
    const probeYRadius = opts.probeRadius * (opts.probeYStretch ?? 1.8);
    const halfY = opts.sizeY / 2;
    // Direct request: move the path up — shifts the whole sweep range
    // (and floorY along with it, since floorY tracks the sweep's own
    // lowest point) by a fraction of sizeY rather than a flat constant,
    // so it stays proportional if sizeY ever changes.
    const pathYShift = opts.sizeY * (opts.pathYShiftFrac ?? .2);
    const lowLevel = -halfY + probeYRadius * 1.05 + pathYShift;
    const highLevel = halfY + probeYRadius * 1.3 + pathYShift;
    const levelSpacing = probeYRadius * 1.6;
    const levelCount = Math.max(1, Math.ceil((highLevel - lowLevel) / levelSpacing) + 1);
    const levels = Array.from({ length: levelCount }, (_, i) =>
      levelCount > 1 ? lerp(lowLevel, highLevel, i / (levelCount - 1)) : lowLevel);
    const floorY = lowLevel - probeYRadius + opts.floorOffset;
    const carveOpts = Object.assign({}, opts, {
      floorY, ceilingY: null, probeYRadius,
      levels,
    });
    for (const points of denseLocal) carveAlongSpline2D(st, points, carveOpts, rng);

    // Constrained to boundX/boundZ (dims/2 minus clipMargin), NOT out to
    // dims/2 itself — the old "+1 past dims/2" version reached straight into
    // the domain's always-open padding margin (see the clampPt comment
    // above), so every tile along the outermost ring of this rect sampled as
    // "open" unconditionally, before any carve ever ran, and got claimed
    // with no solid rock possible beyond it for a wall to form against.
    // Confirmed directly: with the old bounds, 100% of the maze's missing
    // walls sat exactly on this rect's own perimeter (row/col 1 and the
    // opposite edge), none in the interior — the corridor-separating walls
    // this whole heal pass was built for were already fine. minC/maxC/minR/
    // maxR are tile indices (/ts converts the physical safe bound into how
    // many tileSize-wide tiles fit inside it).
    const ts = opts.tileSize || 1;
    const boundsRect = {
      minC: Math.floor(-boundX / ts), maxC: Math.ceil(boundX / ts),
      minR: Math.floor(-boundZ / ts), maxR: Math.ceil(boundZ / ts),
    };
    const claimed = snapClaimTiles(st, boundsRect, carveOpts);

    // Small pockets of un-carved rock can in principle survive fully
    // enclosed by claimed floor — where two nearby branch curves' probe
    // circles within a chaotic cluster didn't quite overlap, a tile can
    // fall just under the 35% open-floor claim threshold and never get
    // its own carveTileColumn pass. (This turned out not to be the cause
    // of the "holes in the ceiling, not full line of sight" report — see
    // carveTileColumn's own comment for the actual mechanism and fix —
    // but it's still a real, if rarer, possible defect worth guarding
    // against on its own merits.) A tile with every orthogonal neighbor
    // already claimed can only be a pocket like this, never a real
    // separating wall — a wall that actually separates two areas always
    // borders unclaimed space on at least one side by definition — so
    // absorbing it is safe. Iterate so a multi-tile pocket gets eaten from
    // its (now-enclosed) edge inward each round.
    const NBR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let pass = 0; pass < 6; pass++) {
      const fillKeys = [];
      for (let r = boundsRect.minR; r <= boundsRect.maxR; r++) {
        for (let c = boundsRect.minC; c <= boundsRect.maxC; c++) {
          const key = `${c},${r}`;
          if (claimed.has(key)) continue;
          if (NBR4.every(([dx, dy]) => claimed.has(`${c + dx},${r + dy}`))) fillKeys.push(key);
        }
      }
      if (!fillKeys.length) break;
      for (const key of fillKeys) {
        claimed.add(key);
        const [c, r] = key.split(',').map(Number);
        carveTileColumn(st, c, r, carveOpts);
      }
    }

    // Guarantee the entrance regardless of how the organic carve landed on
    // the tile grid — 3 physical units wide at ts=1 (the original fixed
    // 3-tile entrance), scaled to as many tiles as it takes to cover the
    // same physical width at a finer tileSize, so the doorway's real-world
    // size doesn't shrink just because the grid got finer.
    const entranceTileCount = Math.max(3, Math.round(3 / ts));
    const entranceColLo = -Math.floor(entranceTileCount / 2);
    const entranceRow = Math.floor(entranceZ / ts);
    const entranceTiles = Array.from({ length: entranceTileCount }, (_, i) => [entranceColLo + i, entranceRow]);
    for (const [c, r] of entranceTiles) { claimed.add(`${c},${r}`); carveTileColumn(st, c, r, carveOpts); }

    // Reserve a nest chamber (2x2 physical units at ts=1, scaled the same
    // way as the entrance) at the tile farthest (by walk distance) from the
    // entrance, and carve it in so it's real volume, not just a floor-tile
    // flag with nothing behind it.
    const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const startKey = entranceTiles[Math.floor(entranceTiles.length / 2)].join(',');
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
    const nestSpan = Math.max(2, Math.round(2 / ts));
    const nestTiles = [];
    for (let dr = 0; dr < nestSpan; dr++) for (let dc = 0; dc < nestSpan; dc++) nestTiles.push([nfx + dc, nfy + dr]);
    for (const [c, r] of nestTiles) { claimed.add(`${c},${r}`); carveTileColumn(st, c, r, carveOpts); }

    // Carving the entrance tiles themselves (above) only opens their own
    // column — nothing south of the entrance row was ever carved by the
    // maze, so without this the doorway is an isolated pocket walled shut
    // on every side, including the threshold itself: the real solid/open
    // SDF surface sits right at the visible boundary. Carve a shallow
    // vestibule beyond it too (never added to `claimed`, so it's never
    // rendered) purely to push that real surface out past the clipped
    // region, so the doorway reads as a genuine opening. 2 physical units
    // deep at ts=1, scaled like the entrance/nest above.
    const VESTIBULE_DEPTH = Math.max(2, Math.round(2 / ts));
    const vestibuleTiles = new Set();
    for (const [c, r] of entranceTiles) {
      for (let dr = 1; dr <= VESTIBULE_DEPTH; dr++) { carveTileColumn(st, c, r + dr, carveOpts); vestibuleTiles.add(`${c},${r + dr}`); }
    }

    // The entrance tiles border unclaimed (exterior/vestibule) tiles on
    // their south side (+r, growth heads toward -z which maps to -r)
    // exactly like any other cavern boundary would — without this
    // exclusion, stitchBoundaryCaps walls that edge shut too.
    const skipCapEdges = new Set(entranceTiles.map(([c, r]) => `${c},${r},S`));

    // Heal any wall the organic carve thinned or erased where it bled past
    // a claimed tile's edge into an unclaimed neighbor (see this
    // function's docblock) — run once, after every carve/claim/force step
    // above has finished, right before meshing. vestibuleTiles (not
    // skipCapEdges — that's a per-tile-per-direction set the MESH capping
    // pass below needs, a different shape of exclusion) protects every
    // vestibule tile from every direction a claimed tile might approach
    // it from, not just the entrance tile's own straight-ahead edge.
    solidifyBoundaryWalls(st, claimed, Math.max(opts.brushRadius, opts.probeRadius) + opts.wallGridMargin, vestibuleTiles, ts, carveOpts);

    // Drop any boundary claimed tile whose own footprint reads as mostly
    // non-floor clutter (see classifyDeformedBoundaryTiles) instead of
    // trying to carve it clean — same effect as marking it collide, since
    // bGrid already defaults every non-floor tile to solid rock. Only
    // entrance/nest tiles are exempt (forced elsewhere, never optional),
    // and a candidate is only actually dropped if doing so doesn't cut the
    // maze into disconnected pockets.
    const minFloorCoverage = opts.deformedFloorMinCoverage ?? 0;
    let deformedTilesDropped = 0;
    if (minFloorCoverage > 0) {
      const protectedTiles = new Set([...entranceTiles, ...nestTiles].map(([c, r]) => `${c},${r}`));
      const rawMesh = extractMesh(st, null);
      const deformedCandidates = classifyDeformedBoundaryTiles(rawMesh, claimed, floorY, probeYRadius, ts, minFloorCoverage);
      for (const key of deformedCandidates) {
        if (protectedTiles.has(key)) continue;
        claimed.delete(key);
        if (isClaimedSetConnected(claimed, startKey)) deformedTilesDropped++;
        else claimed.add(key); // would have split the maze — keep it walkable instead
      }
    }

    // The final mesh keeps every genuinely-carved tile (see
    // computeTouchedTiles), not just the walkable ones, so the organic
    // wall/ceiling detail immediately outside the floor stays visible
    // instead of being clipped down to a flat stitched cap.
    const touched = computeTouchedTiles(st, ts, opts.cullTouchTolerance);
    for (const key of claimed) touched.add(key); // claimed tiles are always touched by construction; union defensively
    const mesh = extractMesh(st, touched, skipCapEdges, ts, claimed, floorY, opts.enforceWalkableClearance);

    // Shift Y so the floor sits at y=0 — the game's floor-referenced
    // convention (see interior-scene-builder.js's panelCornersFor). X/Z
    // divide by ts to convert the mesh from physical carve-space (where a
    // tile is ts units wide) into tile-index space (where every tile is
    // exactly 1 unit wide, position == tile index + fraction) — the
    // convention every consumer downstream (cavern-generator.js's shift,
    // interior-scene-builder.js, game.js's col+0.5 placement) already
    // assumes.
    for (let i = 0; i < mesh.positions.length; i += 3) {
      mesh.positions[i] /= ts;
      mesh.positions[i + 1] += -floorY;
      mesh.positions[i + 2] /= ts;
    }

    // levels/probeYRadius/dims/domainTopY are exposed for introspection —
    // e.g. docs/tools/cavern-sculptor-tuner, which renders this same
    // function's real output and needs to show what the sweep actually
    // computed — not internal debug state (no raw field/octree data is
    // returned). Shifted into the same Y frame as mesh above (floor at
    // y=0) so the numbers read directly against whatever the caller
    // renders. domainTopY is the sculpt grid's own hard boundary (see
    // createSculptState's domainHalf) — rock above it can never be solid
    // by construction (see this function's docblock), so comparing the
    // top of `levels` (plus probeYRadius) against domainTopY is how you
    // tell whether the sweep actually reaches genuinely open air.
    return {
      claimed, entranceTiles, nestTile: [nfx, nfy], mesh,
      levels: levels.map(l => l - floorY), probeYRadius, dims,
      domainTopY: dims.y * .5 * 1.08 - floorY,
      deformedTilesDropped,
      walkableSculptFragmentsSmoothed: mesh.walkableSculptFragmentsSmoothed || 0,
      walkableSculptVerticesMoved: mesh.walkableSculptVerticesMoved || 0,
      walkableSculptSharedTargets: mesh.walkableSculptSharedTargets || 0,
      walkableSculptCutsSealed: mesh.walkableSculptCutsSealed || 0,
      walkableSculptMaxBevelDepth: mesh.walkableSculptMaxBevelDepth || 0,
      walkableClearanceVerticesMoved: mesh.walkableClearanceVerticesMoved || 0,
    };
  }

  window.CavernSculptor = {
    createSculptState, carveHook, carveSphere, buildMazePaths, sampleSpline,
    carveAlongSpline2D, snapClaimTiles, carveTileColumn, solidifyBoundaryWalls,
    computeTouchedTiles, classifyDeformedBoundaryTiles,
    extractMesh, carveMazeCavern,
  };
})();
