// Exterior cliff route network: discrete directional handhold hops plus stacked miniature ledges.
// Data/math is Node-testable; THREE is only used by render(). Ruin and tree climbers are untouched.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CliffRouteNetwork = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DIRS = Object.freeze([{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }]);
  const cache = new WeakMap(); // Grid identity -> the immutable-in-practice climb/navigation network.
  const activeByArea = new Map(); // Area -> latest network, used for mobile debug and landing queries.
  const debug = { builds: 0, lastArea: null, lastError: null };
  const rewardStateByArea = new Map(); // Save-restorable per-balcony dig, mining and chest-claim progress.
  const rewardMeshesByArea = new Map(); // Scene-only reward meshes toggled as stages change, never serialized.
  const key = (c, r) => c + ',' + r;
  const hash = (c, r, salt = 0) => {
    let h = Math.imul((c | 0) + 4177, 73856093) ^ Math.imul((r | 0) + 331, 19349663) ^ Math.imul((salt | 0) + 19, 83492791);
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    return (h ^ (h >>> 13)) >>> 0;
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const MIN_MINI_CLIFF_HEIGHT = 2.70; // Minimum vertical clearance above the neighboring plateau for a standalone intermediate tier.
  const surface = (t, opts) => Number(opts.tileY?.(t) ?? ((t.elevTier || 0) * (opts.plateauUnit || 2.5)));
  const defaultBlocked = t => !t || t.incline || t.borderEscarpment || t.distantBoundaryLandscape || t.type === 'rock' || t.type === 'wall';

  // Test the swept XZ segment against buffered footprints, including thin
  // colliders that can sit between two individually clear handholds.
  function crossesObstacle(from, to, obstacles, pad = 0.35) {
    return obstacles.some(rect => {
      let enter = 0, leave = 1;
      for (const [axis, lo, hi] of [
        ['x', rect.x - pad, rect.x + rect.w + pad],
        ['z', rect.y - pad, rect.y + rect.h + pad],
      ]) {
        const start = from[axis], delta = to[axis] - start;
        if (Math.abs(delta) < 1e-6) {
          if (start < lo || start > hi) return false;
          continue;
        }
        const a = (lo - start) / delta, b = (hi - start) / delta;
        enter = Math.max(enter, Math.min(a, b));
        leave = Math.min(leave, Math.max(a, b));
        if (enter > leave) return false;
      }
      return true;
    });
  }

  function overlapsClimb(network, rect) {
    if (!network) return false;
    const obstacles = [rect]; // Den turnover uses the same clearance as initial route selection.
    return network.routes.some(route => route.nodes.some(from => from.links.some(id =>
      id > from.id && crossesObstacle(from, route.nodes[id], obstacles)))) ||
      network.balconies.some(shelf => shelf.footprint.some(cell =>
        cell.c < rect.x + rect.w && cell.c + 1 > rect.x && cell.r < rect.y + rect.h && cell.r + 1 > rect.y));
  }

  // Construct the original, unshifted miniature plateau *inside* its parent.
  // Its cap is then translated 1-3 tiles out across the cliff face; the
  // unshifted footprint is a visual ground-rooted rock body, NOT extra ground.
  function embeddedMiniCliffBase(candidate, shelf, grid, components, cols, rows, opts, groundY) {
    if (shelf.y <= candidate.y0 + MIN_MINI_CLIFF_HEIGHT - 0.001 ||
        shelf.y >= candidate.y1 - 0.01 || !Number.isFinite(groundY)) return null;
    const priority = 1 + hash(candidate.a.c, candidate.a.r, 117 + shelf.nodeId) % 3; // First-choice cap translation, varied by generation seed.
    const projections = [...new Set([priority, 1, 2, 3])]; // Fallbacks find a shape really embedded behind irregular parent edges.
    const failures = []; // Mobile debug: retain the measured coverage of rejected miniature-plateau footprints.
    const ring = [[-1,-1],[0,-1],[1,-1],[1,1],[0,1],[-1,1]]; // Exact same top outline, before translation.
    for (const projection of projections) {
      const original = { ...shelf,
        x: shelf.x - shelf.normal.x * projection,
        z: shelf.z - shelf.normal.z * projection }; // Where the miniature plateau was grown before moving its lid.
      const outline = ring.map(([u,v]) => miniCliffTopPoint(original,u,v));
      const minC = Math.floor(Math.min(...outline.map(p => p[0])));
      const maxC = Math.floor(Math.max(...outline.map(p => p[0])));
      const minR = Math.floor(Math.min(...outline.map(p => p[2])));
      const maxR = Math.floor(Math.max(...outline.map(p => p[2])));
      if (minC < 0 || minR < 0 || maxC >= cols || maxR >= rows) { failures.push({ projection, reason:'outside-map' }); continue; }
      const footprint = []; // Parent-owned body tiles; used for validation, never registered as walkable.
      const boundaryCells = []; // Overlapped unwalkable stone cells, where the parent face is painted.
      const sharedBoundaryTiles = []; // Parent-side tile edges actually facing lower ground or stone, not incidental interior rock.
      let samples = 0, inParent = 0, inRock = 0; // Fraction of *area*, not merely intersecting tile count.
      for (let r = minR; r <= maxR; r++) for (let col = minC; col <= maxC; col++) {
        if (!miniCliffTouchesCell(original, outline, col, r)) continue;
        const tile = grid[r]?.[col];
        const parent = components[r * cols + col] === candidate.bComp &&
          !!tile && Number.isFinite(surface(tile, opts)) && surface(tile, opts) > shelf.y + 0.2;
        const boundary = !!tile && (tile.incline || tile.type === 'rock' || tile.type === 'wall') &&
          !opts.isBoundary?.(tile);
        if (parent) {
          footprint.push({ c: col, r, elevation: groundY, parentElevation: surface(tile, opts) }); // Validate against the original parent's real height.
          const onParentCliff = DIRS.some(dir => {
            const nc = col + dir.x, nr = r + dir.z;
            if (nc < 0 || nr < 0 || nc >= cols || nr >= rows ||
                components[nr * cols + nc] === candidate.bComp) return false;
            const neighbor = grid[nr]?.[nc];
            if (!neighbor || opts.isBoundary?.(neighbor)) return false;
            return neighbor.incline || neighbor.type === 'rock' || neighbor.type === 'wall' ||
              (Number.isFinite(surface(neighbor, opts)) && surface(neighbor, opts) <= candidate.y0 + 0.5);
          });
          if (onParentCliff && shelfContains(original, col + 0.5, r + 0.5))
            sharedBoundaryTiles.push({ c: col, r }); // A shared parent face, not a barely touched polygon corner.
        }
        if (boundary) boundaryCells.push({ c: col, r, elevation: groundY });
        for (const dx of [0.25, 0.5, 0.75]) for (const dz of [0.25, 0.5, 0.75]) {
          if (!shelfContains(original, col + dx, r + dz)) continue;
          samples++;
          if (parent) inParent++;
          if (boundary) inRock++;
        }
      }
      // Prevent a floating cap whose "original plateau" actually lay out in
      // open air. A parent boundary may be solid rock rather than a walkable tile.
      if (!samples || !footprint.length || inParent / samples < 0.54 ||
          (inParent + inRock) / samples < 0.72) {
        failures.push({ projection, reason:'parent-coverage', parent:inParent / Math.max(1,samples),
          embedded:(inParent+inRock) / Math.max(1,samples) });
        continue;
      }
      const requiredBoundary = Math.max(1, Math.ceil(shelf.width * 0.30)); // Short pillars need one shared face; a long noodle needs several.
      if (sharedBoundaryTiles.length < requiredBoundary) {
        failures.push({ projection, reason:'insufficient-shared-boundary', shared:sharedBoundaryTiles.length,
          required:requiredBoundary });
        continue;
      }
      if (candidate.walls > 0 && !boundaryCells.length) {
        failures.push({ projection, reason:'missing-wall-seam', parent:inParent / samples });
        continue; // Share actual unwalkable face tiles when painted.
      }
      debug.miniBasesFitted = (debug.miniBasesFitted||0)+1; // Body passed geometry checks, but its climbing transfer still needs validation.
      return {
        x: original.x, z: original.z, y: groundY, elevation: groundY,
        footprint, boundaryCells, sharedBoundaryTiles, parentComponent: candidate.bComp,
        hasPaintedBoundary: candidate.walls > 0, // Direct tier jumps have no unwalkable rock tiles to share.
        projectionTiles: projection, parentCoverage: inParent / samples,
        embeddedCoverage: (inParent + inRock) / samples,
        neighborY: candidate.y0, // Rock starts at zone ground even beside an elevated neighboring plateau.
      };
    }
    debug.miniBasesRejected = (debug.miniBasesRejected||0)+1;
    debug.lastMiniBaseFailure = { a:candidate.a, b:candidate.b, shelf:shelf.id, failures }; // Most recent reason a miniature plateau could not grow.
    return null;
  }

  function build(grid, opts = {}) {
    if (!Array.isArray(grid)) throw new TypeError('CliffRouteNetwork.build requires a row-major grid');
    const rows = grid.length, cols = Math.max(0, ...grid.map(r => r?.length || 0));
    const get = (c, r) => (c >= 0 && c < cols && r >= 0 && r < rows ? grid[r]?.[c] : null);
    const blocked = opts.blocked || defaultBlocked;
    const walkable = (c, r) => {
      const t = get(c, r);
      // A caller can add exclusions but cannot accidentally override the
      // graph's baseline solid-wall/boundary exclusions.
      return !!t && !defaultBlocked(t) && !blocked(t) && !opts.isBoundary?.(t);
    };
    const component = new Int32Array(cols * rows).fill(-1); // Walkable ground component for route-graph flood fill.
    const components = [];
    const tileId = (c, r) => r * cols + c;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!walkable(c, r) || component[tileId(c, r)] !== -1) continue;
      const id = components.length, cells = [], todo = [[c, r]];
      component[tileId(c, r)] = id;
      for (let i = 0; i < todo.length; i++) {
        const [x, z] = todo[i], t = get(x, z);
        cells.push([x, z]);
        for (const d of DIRS) {
          const nx = x + d.x, nz = z + d.z, nt = get(nx, nz);
          if (!walkable(nx, nz) || component[tileId(nx, nz)] !== -1) continue;
          // A height discontinuity is not a walking edge. Authored ramps are already real walkable tiles.
          if (Math.abs(surface(t, opts) - surface(nt, opts)) > 0.55 && !(t.type === 'ramp' || nt.type === 'ramp')) continue;
          component[tileId(nx, nz)] = id;
          todo.push([nx, nz]);
        }
      }
      components.push({ id, cells, tier: Number(get(c, r)?.elevTier) || 0 });
    }
    const groundY = components.reduce((lo, group) => Math.min(lo, surface(get(group.cells[0][0], group.cells[0][1]), opts)), Infinity); // Zone's real ground level, shared by every mini-plateau root.
    const candidates = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!walkable(c, r)) continue;
      const lower = get(c, r), fromComp = component[tileId(c, r)];
      for (const dir of DIRS) {
        let x = c, z = r, walls = 0;
        for (let i = 0; i < (opts.maxWallTiles || 4); i++) {
          x += dir.x; z += dir.z;
          const t = get(x, z);
          if (!t || opts.isBoundary?.(t)) break;
          if (t.incline) { walls++; continue; }
          // Some authored cliffs are direct tier discontinuities without a
          // painted incline strip. The shaft-style reachability proof found
          // that ignoring these could strand an entire upper plateau.
          if (walkable(x, z) && surface(t, opts) > surface(lower, opts) + 0.5) {
            const toComp = component[tileId(x, z)];
            if (toComp !== fromComp) {
              const edgeDistance = Math.min(c, r, x, z, cols - 1 - c, rows - 1 - r, cols - 1 - x, rows - 1 - z);
              const boundaryPenalty = Math.max(0, 4 - edgeDistance) * 25; // Prefer interior routes with room for real balcony footprints.
              candidates.push({ a: { c, r }, b: { c: x, r: z }, aComp: fromComp, bComp: toComp, dir, walls,
                y0: surface(lower, opts), y1: surface(t, opts),
                weight: walls * 12 + hash(c, r, x * 71 + z) % 12 + boundaryPenalty });
            }
          }
          break;
        }
      }
    }
    candidates.sort((a, b) => a.weight - b.weight);
    const parent = components.map((_, i) => i); // Spanning forest: every component with a possible connection receives at least one route.
    const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const routes = [], selected = [], busy = [];
    const obstacles = opts.obstacles || []; // Static cave and prop footprints in zone coordinates.
    let rejectedRoutes = 0; // Pixel Probe count of candidate faces with missing geometry or blocked hops.
    for (const candidate of candidates) {
      const a = find(candidate.aComp), b = find(candidate.bComp);
      const required = a !== b;
      const midx = (candidate.a.c + candidate.b.c + 1) / 2, midz = (candidate.a.r + candidate.b.r + 1) / 2;
      const spaced = busy.every(p => Math.hypot(p.x - midx, p.z - midz) >= 7);
      const optional = spaced && hash(candidate.a.c, candidate.a.r, candidate.b.c + candidate.b.r) % 100 < 12;
      if (!required && !optional) continue;
      const route = planRoute(candidate, routes.length, opts.sampleFace, obstacles);
      if (!route) { rejectedRoutes++; continue; }
      selected.push(candidate);
      routes.push(route);
      busy.push({ x: midx, z: midz });
      if (required) parent[b] = a;
    }
    debug.miniBasesAccepted = 0; debug.miniBasesFitted = 0; debug.miniBasesRejected = 0; debug.lastMiniBaseFailure = null; // Per-build placement diagnostics.
    const shelfRejections = {}; // Track post-embedding route clearance failures per reason for mobile debugging.
    const balconies = [];
    for (const route of routes) {
      const c = selected[route.id], id = route.id, h = c.y1 - c.y0;
      const { nodes, upperNode: spans, tangent: tan, normal } = route;
      if (h >= MIN_MINI_CLIFF_HEIGHT + 0.12 && hash(c.a.c, c.a.r, 83) % 100 < 38) {
        const count = h >= 8 ? 2 : 1;
        const oldSpans = clamp(Math.ceil(Math.max(h / 0.54, (c.walls + 1) / 0.56)), 3, 95); // Preserve existing reward save keys.
        for (let j = 0; j < count; j++) {
          const minIndex = Math.ceil((MIN_MINI_CLIFF_HEIGHT + 0.12) * (spans - 1) / h); // A higher hold lets a mid-height ledge fit its doubled embedded rock height.
          const idx = clamp(Math.max(Math.round(spans * (j + 1) / (count + 1)), minIndex), 1, spans - 2), anchor = nodes[idx];
          if (anchor.y - c.y0 < MIN_MINI_CLIFF_HEIGHT + 0.12) continue; // No usable place below this cliff's lip.
          const shapeRoll = hash(c.a.c, c.a.r, 60 + j) % 100; // Usually a narrow pillar; occasionally a long, winding contour strip.
          const narrowWidth = 1.7 + (hash(c.a.c, c.a.r, 64 + j) % 7) * 0.16; // Default narrow, pillar-like footprint.
          const longWidth = 4.2 + (hash(c.a.c, c.a.r, 63 + j) % 7) * 0.55; // Occasional noodle following more cliff boundary.
          const widthOptions = shapeRoll < 22 ? [longWidth, narrowWidth] : [narrowWidth]; // Retry compact form when a long body blocks other routes.
          const baseDepth = 1.0 + (hash(c.a.c, c.a.r, 67 + j) % 5) * 0.13; // Old cap depth, retained on the shortest portion of this overhang.
          const profiles = [[0, 0.5, 1], [1, 0.5, 0], [0.5, 1, 0], [0, 1, 0.5]]; // Three different overhang lengths along each cap.
          const overhangDepths = profiles[hash(c.a.c, c.a.r, 97 + j) % profiles.length].map(extra => baseDepth + extra);
          const depth = baseDepth + 1; // Maximum profile depth: one extra tile, used for bounds/obstacle broadphase.
          const preferredSide = j % 2 ? -1 : 1; // Alternate sides on tall routes.
          placement: for (const width of widthOptions) {
            for (const side of [preferredSide, -preferredSide]) {
              const along = side * (width / 2 + 0.65); // Center offset leaves space for the climber at the side edge.
              const face = opts.sampleFace?.(c, anchor.x + tan.x * along, anchor.y, anchor.z + tan.z * along);
              if (opts.sampleFace && !face) continue;
              const faceX = face?.x ?? anchor.x + tan.x * along; // Intersect the cliff at the shelf's own lateral position.
              const faceZ = face?.z ?? anchor.z + tan.z * along;
              const oldIndex = clamp(Math.round(oldSpans * (j + 1) / (count + 1)), 2, oldSpans - 2);
              const savedHeight = Math.round((c.y0 + h * oldIndex / oldSpans) * 100); // Keep existing reward state for surviving shelves.
              const shelf = {
                id: 'cliff-balcony-' + [c.a.c, c.a.r, c.b.c, c.b.r, savedHeight, j].join('-'),
                routeId: id, nodeId: nodes.length,
                x: faceX + normal.x * (depth / 2 - 0.32),
                z: faceZ + normal.z * (depth / 2 - 0.32),
                y: anchor.y,
                width, depth, overhangDepths, // Left, center, right front-edge depths drive geometry and walkable support.
                contourOffsets: width > 4 ? [0, ((hash(c.a.c, c.a.r, 69 + j) % 7) - 3) * 0.085, 0] : [0, 0, 0], // Only longer bodies bend around a contour.
                tangent: tan, normal, footprint: [], // Tile/elevation cells never overwrite the ordinary ground grid.
                reward: hash(c.a.c, c.a.r, 94 + j) % 2 ? 'buriedTreasure' : 'oreRock',
              };
              const capOutline = [[-1,-1],[0,-1],[1,-1],[1,1],[0,1],[-1,1]]
                .map(([u,v]) => miniCliffTopPoint(shelf, u, v)); // Used for exact cap/tile overlap rather than sampled misses.
              const minCol = Math.max(0, Math.floor(Math.min(...capOutline.map(p => p[0]))));
              const maxCol = Math.min(cols - 1, Math.floor(Math.max(...capOutline.map(p => p[0]))));
              const minRow = Math.max(0, Math.floor(Math.min(...capOutline.map(p => p[2]))));
              const maxRow = Math.min(rows - 1, Math.floor(Math.max(...capOutline.map(p => p[2]))));
              for (let rr = minRow; rr <= maxRow; rr++) for (let cc = minCol; cc <= maxCol; cc++) {
                // Include all touched floor cells, even slivers narrower than a
                // probe grid. The final support still uses exact shelfContains.
                if (miniCliffTouchesCell(shelf, capOutline, cc, rr))
                  shelf.footprint.push({ c: cc, r: rr, elevation: shelf.y });
              }
              // Projecting ledges may overhang lower terrain, but not the entire
              // playable map. Skip the optional shelf rather than create a half-
              // supported floor outside the world's collision bounds.
              const fitsMap = [-1, 0, 1].every(u => [-1, 1].every(v => {
                const point = miniCliffTopPoint(shelf, u, v); // Exact stepped perimeter, not the bounding rectangle.
                return point[0] >= 0.05 && point[2] >= 0.05 && point[0] <= cols - 0.05 && point[2] <= rows - 0.05;
              }));
              if (!fitsMap || !shelf.footprint.length) continue;
              // The unshifted ground-rooted body must remain embedded in
              // the upper plateau and must never act as a second walkable surface.
              shelf.base = embeddedMiniCliffBase(c, shelf, grid, component, cols, rows, opts, groundY);
              if (!shelf.base) continue;
              shelf.projectionTiles = shelf.base.projectionTiles; // Exact normal displacement of its original top.
              const landing = {
                id: shelf.nodeId, y: shelf.y, links: [idx], balconyId: shelf.id,
                x: shelf.x - tan.x * side * (width / 2 - 0.06),
                z: shelf.z - tan.z * side * (width / 2 - 0.06),
              }; // A lateral hop lands just inside the cap, clear of its center reward.
              const halfX = (Math.abs(tan.x) * width + Math.abs(normal.x) * depth) / 2; // Cardinal cap bounds.
              const halfZ = (Math.abs(tan.z) * width + Math.abs(normal.z) * depth) / 2;
              const capBlocked = obstacles.some(rect => rect.x < shelf.x + halfX + 0.35 && rect.x + rect.w > shelf.x - halfX - 0.35 &&
                rect.y < shelf.z + halfZ + 0.35 && rect.y + rect.h > shelf.z - halfZ - 0.35);
              const capBounds = [{ x: shelf.x - halfX, y: shelf.z - halfZ, w: halfX * 2, h: halfZ * 2 }];
              const shelfBlocksRoute = routes.some(other => {
                if (other.id === route.id) return false; // A ledge must not reject its own connecting handholds.
                if (Math.abs(other.a.c + 0.5 - shelf.x) >= 9 || Math.abs(other.a.r + 0.5 - shelf.z) >= 9) return false;
                return other.nodes.some(from => from.links.some(index => {
                  if (index <= from.id) return false;
                  const to = other.nodes[index];
                  if (Math.min(from.y, to.y) > shelf.y + 0.2 || Math.max(from.y, to.y) < shelf.y - 0.85) return false; // Lower climbing routes may pass underneath the overhanging lid.
                  return crossesObstacle(from, to, capBounds, 0.25);
                }));
              });
              const landingFace = opts.sampleFace?.(c, landing.x, landing.y, landing.z);
              if (opts.sampleFace && (!landingFace ||
                  (landing.x - landingFace.x) * normal.x + (landing.z - landingFace.z) * normal.z < 0.08)) continue;
              const hopClear = legalHop(anchor, landing, obstacles); // A landing 0.06 tile inside the edge remains within one climb hop.
              const faceClear = clearOfFace(anchor, landing, c, normal, opts.sampleFace); // Avoid wall penetration when using the actual sampled rock mesh.
              if (capBlocked || shelfBlocksRoute || !hopClear || !faceClear) {
                for (const [reason, fails] of Object.entries({ capBlocked, shelfBlocksRoute, hopTooFar: !hopClear, faceBlocked: !faceClear }))
                  if (fails) shelfRejections[reason] = (shelfRejections[reason] || 0) + 1; // Quality inspector reports the actual obstacle reason.
                continue;
              }
              nodes.push(landing);
              nodes[idx].links.push(shelf.nodeId);
              balconies.push(shelf);
              debug.miniBasesAccepted++; // Only successful climbing-connected ledges count as accepted.
              break placement; // One successful ledge per height; first try the longer body, then a slim fallback.
            }
          }
        }
      }
    }
    const adjacency = components.map(() => []); // Component graph used by creatures to find a real path instead of popping up a wall.
    for (const route of routes) {
      adjacency[route.aComp].push({ next: route.bComp, route, entry: 0 });
      adjacency[route.bComp].push({ next: route.aComp, route, entry: route.upperNode });
    }
    const connectedRoots = new Set(components.map((_, i) => find(i)));
    const network = { area: opts.area || null, grid, cols, rows, components, component, routes, balconies, adjacency,
      miniBaseStats: { accepted:debug.miniBasesAccepted, fitted:debug.miniBasesFitted,
        rejected:debug.miniBasesRejected, lastFailure:debug.lastMiniBaseFailure, shelfRejections }, // In-game generator debug export.
      unconnectedComponents: Math.max(0, connectedRoots.size - 1), candidateCount: candidates.length, rejectedRoutes };
    // Adapt ShaftHub.reachable(): walking components, legal climbing links,
    // and every balcony node must be reachable from some ground entrance.
    network.verification = verifyReachability(network);
    debug.builds++; debug.lastArea = network.area;
    return network;
  }

  function legalHop(from, to, obstacles) {
    const distance = Math.hypot(to.x - from.x, to.z - from.z, to.y - from.y); // Shared with reachability's hop limits.
    return distance >= 0.02 && distance <= 1.20 && !crossesObstacle(from, to, obstacles);
  }

  function clearOfFace(from, to, candidate, normal, sampleFace) {
    if (!sampleFace) return true;
    for (const t of [0.25, 0.5, 0.75]) {
      const x = from.x + (to.x - from.x) * t, z = from.z + (to.z - from.z) * t;
      const y = from.y + (to.y - from.y) * t; // Check the movement chord, not just the endpoints.
      if (y >= candidate.y1) continue;
      const face = sampleFace(candidate, x, y, z);
      if (face && (x - face.x) * normal.x + (z - face.z) * normal.z < 0.07) return false;
    }
    return true;
  }

  function planRoute(c, id, sampleFace, obstacles) {
    const height = c.y1 - c.y0; // Used to space holds from the foot to just below the lip.
    const spans = clamp(Math.ceil(Math.max(height / 0.48, (c.walls + 1) / 0.56)), 5, 95);
    const tangent = { x: -c.dir.z, z: c.dir.x }, normal = { x: -c.dir.x, z: -c.dir.z };
    const start = { x: c.a.c + 0.5, z: c.a.r + 0.5, y: c.y0 };
    const end = { x: c.b.c + 0.5, z: c.b.r + 0.5, y: c.y1 };
    const nodes = [{ ...start, id: 0, links: [] }];
    const facePoint = (x, y, z) => {
      if (!sampleFace) return { x, y, z }; // Nominal grid profile for headless graph callers.
      const face = sampleFace(c, x, y, z);
      return face && { x: face.x + normal.x * 0.24, y, z: face.z + normal.z * 0.24 };
    };
    const append = (point, links) => {
      if (!point || !links.every(index => legalHop(nodes[index], point, obstacles) && clearOfFace(nodes[index], point, c, normal, sampleFace))) return false;
      const next = nodes.length; // IDs index the route array for player, wildlife and NPC traversal.
      nodes.push({ ...point, id: next, links });
      for (const index of links) nodes[index].links.push(next);
      return true;
    };
    for (let i = 1; i < spans - 1; i++) {
      const t = i / (spans - 1), wiggle = Math.sin(t * Math.PI * (2 + hash(c.a.c, c.a.r, 5) % 3)) * 0.28;
      const y = c.y0 + height * t; // Sample the existing displaced rock at this hold's height.
      const x = start.x + (end.x - start.x) * t + tangent.x * wiggle;
      const z = start.z + (end.z - start.z) * t + tangent.z * wiggle;
      const point = facePoint(x, y, z);
      if (!append(point, [i - 1]) &&
          !append(facePoint(x - tangent.x * wiggle, y, z - tangent.z * wiggle), [i - 1])) return null;
    }
    const last = nodes[nodes.length - 1]; // Rise outside the lip, then hop horizontally onto the top.
    const rimY = c.y1 - Math.min(0.12, height / spans); // Sample below the lip where steep geometry still exists.
    const rim = facePoint(end.x + normal.x * 0.35, rimY, end.z + normal.z * 0.35);
    if (!rim || !append({ ...rim, y: c.y1 + 0.08, transfer: true }, [last.id]) ||
        !append(end, [spans - 1])) return null;
    for (let i = 2; i < spans - 2; i += 5) {
      const sign = hash(c.a.c, c.a.r, i) & 1 ? 1 : -1;
      const at = nodes[i];
      append(facePoint(at.x + tangent.x * sign * 0.58, at.y + 0.02, at.z + tangent.z * sign * 0.58), [i, i + 1]);
    }
    return { id, a: c.a, b: c.b, aComp: c.aComp, bComp: c.bComp, dir: c.dir, tangent, normal, nodes, upperNode: spans,
      project: sampleFace && ((x, y, z) => sampleFace(c, x, y, z)) };
  }

  // Dungeon ShaftHub.reachable checks (col,row,level). Outdoors, ordinary
  // walkability is still the precise heightfield; each component stores its
  // exact tier and climb edges join components without rounding surface Y.
  function verifyReachability(network) {
    if (!network?.components?.length) return {
      ok: true, groundComponents: 0, checkedComponents: 0,
      unreachablePlateaus: [], unreachableBalconies: [], invalidHops: [], invalidEmbeddedBases: [],
    };
    const tiers = network.components.map(c => Number(c.tier) || 0);
    const groundTier = Math.min(...tiers);
    const groundSources = network.components.filter(c => c.tier === groundTier).map(c => c.id);
    const queue = groundSources.slice(); // Only valid lowest-level ground regions are traversal origins.
    const reached = new Set(queue); // Multi-source walkable ground; isolated landmasses need not be joined by cliffs.
    for (let i = 0; i < queue.length; i++) {
      for (const edge of network.adjacency[queue[i]] || []) {
        if (!reached.has(edge.next)) {
          reached.add(edge.next);
          queue.push(edge.next);
        }
      }
    }
    const invalidHops = []; // Broken, nonreciprocal or overlong handhold connections.
    const disconnectedNodes = new Map(); // Route ID -> nodes disconnected from the lower entrance.
    for (const route of network.routes) {
      const seen = new Set([0]), pending = [0];
      for (let i = 0; i < pending.length; i++) {
        const node = route.nodes[pending[i]];
        for (const id of node.links) {
          const to = route.nodes[id];
          const distance = to ? Math.hypot(to.x - node.x, to.z - node.z, to.y - node.y) : Infinity;
          if (!to || !to.links.includes(node.id) || distance > 1.20 || distance < 0.02) {
            invalidHops.push({ routeId: route.id, from: node.id, to: id });
            continue;
          }
          if (!seen.has(id)) { seen.add(id); pending.push(id); }
        }
      }
      disconnectedNodes.set(route.id, seen);
      if (!seen.has(route.upperNode)) invalidHops.push({ routeId: route.id, from: 0, to: route.upperNode });
    }
    const unreachablePlateaus = network.components
      .filter(c => c.tier > groundTier && !reached.has(c.id))
      .map(c => c.id);
    const unreachableBalconies = network.balconies
      .filter(s => {
        const route = network.routes[s.routeId];
        return !route || !reached.has(route.aComp) || !disconnectedNodes.get(s.routeId)?.has(s.nodeId);
      }).map(s => s.id);
    const invalidEmbeddedBases = network.balconies
      .filter(s => !s.base?.footprint?.length || s.base.footprint.some(cell =>
        componentAt(network, cell.c, cell.r) !== s.base.parentComponent ||
        !(s.y - s.base.neighborY >= MIN_MINI_CLIFF_HEIGHT - 0.001) ||
        !(s.y < cell.parentElevation) ||
        !(cell.elevation <= s.base.y + 0.001)) ||
        !Number.isInteger(s.base?.projectionTiles) || s.base.projectionTiles < 1 || s.base.projectionTiles > 3 ||
        s.base.parentCoverage < 0.54 || s.base.embeddedCoverage < 0.72 ||
        (s.base.sharedBoundaryTiles?.length || 0) < Math.max(1, Math.ceil(s.width * 0.30))) // The original body must remain mostly buried in its parent.
      .map(s => s.id);
    return {
      ok: !unreachablePlateaus.length && !unreachableBalconies.length && !invalidHops.length && !invalidEmbeddedBases.length,
      groundComponents: groundSources.length,
      checkedComponents: network.components.length,
      unreachablePlateaus, unreachableBalconies, invalidHops, invalidEmbeddedBases,
    };
  }

  function forGrid(grid, opts = {}) {
    if (!grid) return null;
    if (opts.rebuild) cache.delete(grid); // Terrain edits rebuild the authoritative climb topology.
    let network = cache.get(grid);
    if (!network) {
      network = build(grid, opts);
      cache.set(grid, network);
    }
    if (opts.area) activeByArea.set(opts.area, network);
    return network;
  }
  function componentAt(network, c, r) {
    return network && c >= 0 && r >= 0 && c < network.cols && r < network.rows ? network.component[r * network.cols + c] : -1;
  }
  function crossing(network, fromCol, fromRow, toCol, toRow) {
    if (!network) return null;
    for (const route of network.routes) {
      if (route.a.c === fromCol && route.a.r === fromRow && route.b.c === toCol && route.b.r === toRow) return { route, entry: 0 };
      if (route.b.c === fromCol && route.b.r === fromRow && route.a.c === toCol && route.a.r === toRow) return { route, entry: route.upperNode };
    }
    return null;
  }
  function toward(network, fromCol, fromRow, toCol, toRow) {
    const a = componentAt(network, fromCol, fromRow), b = componentAt(network, toCol, toRow);
    if (a < 0 || b < 0 || a === b) return null;
    const queue = [a], seen = new Set([a]), first = new Map();
    for (let i = 0; i < queue.length; i++) {
      for (const edge of network.adjacency[queue[i]]) {
        if (seen.has(edge.next)) continue;
        seen.add(edge.next);
        first.set(edge.next, queue[i] === a ? edge : first.get(queue[i]));
        if (edge.next === b) return first.get(b);
        queue.push(edge.next);
      }
    }
    return null;
  }
  function nextHop(route, nodeId, input) {
    const node = route?.nodes[nodeId];
    if (!node) return null;
    const norm = Math.hypot(input.x || 0, input.z || 0);
    if (norm < 0.32) return null;
    let choice = null, best = 0.31;
    for (const id of node.links) {
      const to = route.nodes[id];
      const du = (to.x - node.x) * route.tangent.x + (to.z - node.z) * route.tangent.z;
      const normalTravel = (to.x - node.x) * route.normal.x + (to.z - node.z) * route.normal.z;
      const dv = node.transfer && id === route.upperNode || to.transfer && nodeId === route.upperNode
        ? -normalTravel : (to.y - node.y) / 1.15; // The rim-to-top hop follows horizontal inward/outward input.
      const length = Math.hypot(du, dv);
      if (length < 0.02) continue;
      const wantU = ((input.x || 0) * route.tangent.x + (input.z || 0) * route.tangent.z) / norm;
      const wantV = -((input.x || 0) * route.normal.x + (input.z || 0) * route.normal.z) / norm;
      const dot = (du * wantU + dv * wantV) / length;
      if (dot > best) { best = dot; choice = to; }
    }
    return choice;
  }
  function overhangDepthAt(shelf, u) {
    const profile = shelf.overhangDepths; // Three-point front edge also used by the rock cap mesh.
    if (!Array.isArray(profile) || profile.length !== 3) return shelf.depth; // Legacy rectangular supports stay valid.
    const at = clamp(u, -1, 1), i = at < 0 ? 0 : 1, t = at < 0 ? at + 1 : at;
    return profile[i] + (profile[i + 1] - profile[i]) * t;
  }
  function contourOffsetAt(shelf, u) {
    const offsets = shelf.contourOffsets; // Noodle-shaped mini-plateaus bend in XZ while keeping their exact collision outline.
    if (!Array.isArray(offsets) || offsets.length !== 3) return 0;
    const at = clamp(u, -1, 1), i = at < 0 ? 0 : 1, t = at < 0 ? at + 1 : at;
    return offsets[i] + (offsets[i+1] - offsets[i]) * t;
  }
  function miniCliffTopPoint(shelf, u, v) {
    const across = -shelf.depth / 2 + contourOffsetAt(shelf, u) + overhangDepthAt(shelf, u) * (v + 1) / 2; // Shifted original plateau outline.
    return [shelf.x + shelf.tangent.x * u * shelf.width / 2 + shelf.normal.x * across,
      shelf.y, shelf.z + shelf.tangent.z * u * shelf.width / 2 + shelf.normal.z * across];
  }
  function shelfContains(shelf, x, z, pad = 0) {
    const dx = x - shelf.x, dz = z - shelf.z;
    const along = dx * shelf.tangent.x + dz * shelf.tangent.z;
    const across = dx * shelf.normal.x + dz * shelf.normal.z;
    const u = along / (shelf.width / 2), rear = -shelf.depth / 2 + contourOffsetAt(shelf, u); // Same bent edges as the rock and grass mesh.
    return Math.abs(along) <= shelf.width / 2 + pad &&
      across >= rear - pad && across <= rear + overhangDepthAt(shelf, u) + pad;
  }
  function miniCliffTouchesCell(shelf, outline, col, row) {
    // A cap can touch a cell only at a thin triangular corner; five-point
    // sampling missed these cells and made real rendered ledges non-walkable.
    if ([0, 1].some(dx => [0, 1].some(dz => shelfContains(shelf, col + dx, row + dz)))) return true;
    if (outline.some(p => p[0] >= col && p[0] <= col + 1 && p[2] >= row && p[2] <= row + 1)) return true;
    const edgeTouchesCell = (a, b) => {
      let enter = 0, exit = 1;
      for (const [start, delta, lo, hi] of [[a[0], b[0] - a[0], col, col + 1],
        [a[2], b[2] - a[2], row, row + 1]]) {
        if (Math.abs(delta) < 1e-9) { if (start < lo || start > hi) return false; continue; }
        const t0 = (lo - start) / delta, t1 = (hi - start) / delta;
        enter = Math.max(enter, Math.min(t0, t1));
        exit = Math.min(exit, Math.max(t0, t1));
        if (enter > exit) return false;
      }
      return true;
    };
    return outline.some((p, i) => edgeTouchesCell(p, outline[(i + 1) % outline.length]));
  }
  function shelfAt(network, id) { return network?.balconies.find(s => s.id === id) || null; }
  function getRewardState(area, id) {
    let areaStates = rewardStateByArea.get(area);
    if (!areaStates) { areaStates = new Map(); rewardStateByArea.set(area, areaStates); }
    if (!areaStates.has(id)) areaStates.set(id, { revealed: false, claimed: false });
    return areaStates.get(id);
  }
  function syncRewardMeshes(area, id, state) {
    // The scene's instanced reward bodies are owned by render(), but both
    // interactive changes and save restores must update them immediately.
    for (const handle of rewardMeshesByArea.get(area)?.get(id) || []) {
      const visible = !state.claimed && (handle.kind === 'oreRock' || state.revealed);
      handle.mesh.setMatrixAt(handle.index, visible ? handle.matrix : handle.hidden);
      handle.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  function setRewardStage(area, id, stage) {
    const state = getRewardState(area, id);
    if (stage === 'revealed') state.revealed = true;
    else if (stage === 'claimed') { state.revealed = true; state.claimed = true; }
    else return false;
    syncRewardMeshes(area, id, state);
    return true;
  }
  function serializeRewards() {
    const saved = {};
    for (const [area, entries] of rewardStateByArea) {
      saved[area] = {};
      for (const [id, state] of entries) saved[area][id] = { revealed: !!state.revealed, claimed: !!state.claimed };
    }
    return saved;
  }
  function restoreRewards(saved) {
    rewardStateByArea.clear();
    for (const [area, entries] of Object.entries(saved || {})) {
      const states = new Map();
      for (const [id, value] of Object.entries(entries || {})) states.set(id, { revealed: !!value.revealed, claimed: !!value.claimed });
      rewardStateByArea.set(area, states);
    }
    // Saves may restore while the current wilderness scene is already built.
    // Synchronize its visible ore/chest instances without rebuilding terrain.
    for (const [area, meshes] of rewardMeshesByArea)
      for (const id of meshes.keys())
        syncRewardMeshes(area, id, rewardStateByArea.get(area)?.get(id) || { revealed: false, claimed: false });
  }
  function releaseArea(area) {
    const id = String(area), network = activeByArea.get(id);
    // Retire scene-bound cliff doorway/locale meshes at the same authoritative
    // lifecycle boundary as the terrain graph; do not retain inactive zone
    // THREE objects in either of the small mounting registries.
    if(typeof globalThis==='object'){
      globalThis.PuzzleCaveEntrances?.clear?.(id);
      globalThis.LocaleCliffWallMounts?.clear?.(id);
    }
    if (network) cache.delete(network.grid); // Unload retires this area's topology, not persistent reward state.
    activeByArea.delete(id);
    rewardMeshesByArea.delete(id); // No retained references to disposed THREE instances.
  }
  function highestBelow(network, x, z, fromY, baseY = -Infinity) {
    // Prefer the exact height-bounded DynamicSurfaces support query, as in
    // the multi-story shaft. The pure graph fallback keeps headless tests
    // and early unmounted-world generation independent of renderer state.
    const bridge = typeof globalThis === 'object' ? globalThis.CliffElevatedSurfaces : null;
    // Once the area has an authoritative mounted registry, its null result
    // is definitive: a disabled/offscreen or removed shelf must NOT be
    // resurrected by the legacy geometry fallback.
    if (bridge?.ownsArea?.(network?.area)) return bridge.highestBelow(network, x, z, fromY, baseY);
    let found = null;
    for (const s of (network?.balconies || [])) {
      if (s.y < fromY - 0.08 && s.y > baseY + 0.08 && shelfContains(s, x, z) && (!found || s.y > found.y)) found = s;
    }
    return found;
  }

  // Batch authentic small plateau bodies: the parent-facing original outline
  // is rooted at the zone floor, while its SAME grass lid is translated
  // outward by 1-3 tiles at an intermediate elevation. The rocky sides
  // connect the two outlines; only the translated lid registers support.
  function makeMiniCliffRockMesh(THREE, scene, network, stoneMaterial, topMaterial) {
    const shelves = network.balconies.filter(s => s.base?.footprint?.length);
    if (!shelves.length) return null;
    const topPositions = [], topUvs = [], rockPositions = [], rockUvs = []; // Batch grass-like caps and rocky skirts into two material groups.
    const ringCorners = [
      [-1, -1], [0, -1], [1, -1], [1, 0],
      [1, 1], [0, 1], [-1, 1], [-1, 0],
    ];
    const pushFace = (a, b, c, side = false) => {
      const positions = side ? rockPositions : topPositions, uvs = side ? rockUvs : topUvs; // Grass cap shares plateau XY-projected material; steep slopes use cliff stone.
      positions.push(...a, ...b, ...c);
      const useX = Math.abs(a[0] - b[0]) >= Math.abs(a[2] - b[2]); // Tile the rock down the taper.
      for (const p of [a, b, c]) uvs.push(side ? p[useX ? 0 : 2] : p[0], side ? p[1] : p[2]);
    };
    const mix = (a, b, t) => a + (b - a) * t;
    for (const shelf of shelves) {
      const base = shelf.base;
      const top = ringCorners.map(([u, v]) => miniCliffTopPoint(shelf, u, v)); // The translated original plateau lid.
      const original = { ...shelf, x: base.x, z: base.z }; // Original unshifted footprint stays at ground level.
      const bottom = ringCorners.map(([u, v]) => {
        const p = miniCliffTopPoint(original, u, v);
        return [p[0], base.y, p[2]];
      });
      // The interior ring gives the underside a gradual, irregular return
      // into the parent plateau rather than a flat hanging box slab.
      const middle = top.map((point, i) => {
        const inner = bottom[i];
        const ripple = ((hash(Math.floor(shelf.x * 71), Math.floor(shelf.z * 73), i + 11) % 9) - 4) * 0.012;
        return [
          mix(point[0], inner[0], 0.50) + ripple,
          mix(point[1], inner[1], 0.40),
          mix(point[2], inner[2], 0.50) - ripple,
        ];
      });
      const center = [shelf.x, shelf.y, shelf.z];
      for (let i = 0; i < top.length; i++) {
        const j = (i + 1) % top.length;
        // Only the translated lid is walkable. Long rock sides run down to actual ground.
        pushFace(center, top[j], top[i]);
        pushFace(top[i], top[j], middle[j], true);
        pushFace(top[i], middle[j], middle[i], true);
        pushFace(middle[i], middle[j], bottom[j], true);
        pushFace(middle[i], bottom[j], bottom[i], true);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([...topPositions, ...rockPositions], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([...topUvs, ...rockUvs], 2));
    geometry.addGroup(0, topPositions.length / 3, 0); // Same grass surface material as ordinary plateau lids.
    geometry.addGroup(topPositions.length / 3, rockPositions.length / 3, 1); // Keep all vertical rock sides and undersides rocky.
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, [topMaterial || stoneMaterial, stoneMaterial]);
    mesh.name = network.area + '-cliff-balconies';
    mesh.userData.hobunjiGroundSurface = true; // Same camera/occlusion tags as the former flat caps.
    mesh.userData.cameraObstacle = true;
    mesh.userData.cliffGenerated = true; // Do not feed the tapered shell into unrelated plateau mesh batching.
    mesh.userData.terrainJigsawIgnore = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }

  let _holdMaterial = null; // Shared by all zone decals to avoid duplicate texture downloads and shader programs.
  let _stoneMaterial = null; // Shared rock material for actual stacked mini-cliff geometry.
  let _chestWoodMaterial = null; // Shared by all scenery rebuilds; old per-render allocations leaked GPU materials.
  let _chestLidMaterial = null; // Same lifecycle as the stone and decal materials.
  function render(THREE, scene, network, rockMaterial, topMaterial) {
    if (!THREE || !scene || !network) return [];
    if (!_holdMaterial) {
      const texture = new THREE.TextureLoader().load('assets/textures/carved_smooth.png');
      if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
      _holdMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
      _stoneMaterial = new THREE.MeshStandardMaterial({ color: 0x77766e, roughness: 1 });
      _chestWoodMaterial = new THREE.MeshStandardMaterial({ color: 0x6a4625, roughness: 0.82 });
      _chestLidMaterial = new THREE.MeshStandardMaterial({ color: 0xbe993b, roughness: 0.62 });
    }
    const vertices = [], uvs = [];
    const uvSteps = [0, 0.32, 0.68, 1]; // Nine-slice margins preserve the carved border when each hold is stretched.
    for (const route of network.routes) for (const node of route.nodes) {
      if (node.id === 0 || node.id === route.upperNode || node.transfer || node.balconyId) continue;
      const h = hash(Math.floor(node.x * 13), Math.floor(node.y * 13), route.id);
      const width = 0.21 + (h % 100) / 900, height = 0.23 + ((h >>> 8) % 100) / 800;
      const skew = (((h >>> 16) % 100) / 100 - 0.5) * width * 0.4;
      const xs = [-width / 2, -width * 0.23, width * 0.23, width / 2];
      const ys = [-height / 2, -height * 0.21, height * 0.21, height / 2];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        const corner = (ix, iy) => {
          const w = xs[ix] + skew * (iy / 3 - 0.5);
          const up = ys[iy] + (ix === 0 || ix === 3 ? Math.sin((h % 13) + iy * 2) * 0.025 : 0);
          const x = node.x + route.tangent.x * w, y = node.y + up, z = node.z + route.tangent.z * w;
          const face = route.project?.(x, y, z); // All nine-slice vertices follow the actual slope.
          if (route.project && !face) return null;
          return [(face?.x ?? x) + route.normal.x * 0.012, y, (face?.z ?? z) + route.normal.z * 0.012];
        };
        const p00 = corner(c, r), p10 = corner(c + 1, r), p01 = corner(c, r + 1), p11 = corner(c + 1, r + 1);
        if (!p00 || !p10 || !p01 || !p11) continue;
        vertices.push(...p00, ...p10, ...p11, ...p00, ...p11, ...p01);
        uvs.push(uvSteps[c], 1 - uvSteps[r], uvSteps[c + 1], 1 - uvSteps[r], uvSteps[c + 1], 1 - uvSteps[r + 1],
          uvSteps[c], 1 - uvSteps[r], uvSteps[c + 1], 1 - uvSteps[r + 1], uvSteps[c], 1 - uvSteps[r + 1]);
      }
    }
    const meshes = [];
    const rewardMeshes = new Map(); // Area-local visibility registry for ore and diggable treasure.
    rewardMeshesByArea.set(network.area, rewardMeshes);
    if (vertices.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.computeVertexNormals();
      const decals = new THREE.Mesh(geometry, _holdMaterial);
      decals.name = network.area + '-cliff-handhold-decals';
      decals.userData.cliffRoutes = true;
      decals.userData.terrainJigsawIgnore = true;
      scene.add(decals); meshes.push(decals);
    }
    // A single instanced cap/ore/chest draw per zone replaces hundreds of
    // separate mesh draw calls on cliff-heavy maps (particularly mobile).
    const shelves = network.balconies;
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0); // Invisible claimed/unrevealed reward matrix, with no instance list reallocation.
    const makeInstanced = (geometry, material, count, name) => {
      if (!count) return null;
      const inst = new THREE.InstancedMesh(geometry, material, count);
      inst.name = network.area + '-' + name;
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      inst.userData.terrainJigsawIgnore = true;
      inst.receiveShadow = true;
      scene.add(inst); meshes.push(inst);
      return inst;
    };
    const cap = makeMiniCliffRockMesh(THREE, scene, network, rockMaterial || _stoneMaterial, topMaterial);
    if (cap) meshes.push(cap); // Already generated as one fused mesh across all inverted profiles.
    const ores = shelves.filter(s => s.reward === 'oreRock' && !s.puzzleCavePortal); // Avoid a protruding ore boulder across the entrance.
    const chests = shelves.filter(s => s.reward !== 'oreRock' && !s.puzzleCavePortal); // The rock-door occupies this ledge; a hidden treasure chest would overlap the player's pressure plate.
    const oreMesh = makeInstanced(new THREE.DodecahedronGeometry(1, 0), _stoneMaterial, ores.length, 'cliff-balcony-ores');
    const chestWood = makeInstanced(new THREE.BoxGeometry(1, 1, 1),
      _chestWoodMaterial, chests.length, 'cliff-balcony-chest-bodies');
    const chestLid = makeInstanced(new THREE.BoxGeometry(1, 1, 1),
      _chestLidMaterial, chests.length, 'cliff-balcony-chest-lids');
    const transform = (mesh, index, x, y, z, sx, sy, sz, yaw, visible, kind, shelfId) => {
      if (!mesh) return;
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      o.scale.set(sx, sy, sz);
      o.rotation.y = yaw;
      o.updateMatrix();
      const matrix = o.matrix.clone(); // Original transform is retained for stage-based reappearance.
      mesh.setMatrixAt(index, visible ? matrix : hidden);
      const handles = rewardMeshes.get(shelfId) || [];
      if (kind) { handles.push({ mesh, index, matrix, hidden, kind }); rewardMeshes.set(shelfId, handles); }
    };
    let oi = 0, ci = 0;
    for (let i = 0; i < shelves.length; i++) {
      const s = shelves[i];
      if(s.puzzleCavePortal)continue; // The entrance reserves this shelf's decorative reward slot.
      const yaw = Math.atan2(-s.tangent.z, s.tangent.x);
      const state = getRewardState(network.area, s.id);
      const visible = !state.claimed && (s.reward === 'oreRock' || state.revealed);
      if (s.reward === 'oreRock') {
        transform(oreMesh, oi++, s.x, s.y + 0.18, s.z, 0.32, 0.23, 0.29, yaw, visible, s.reward, s.id);
      } else {
        transform(chestWood, ci, s.x, s.y + 0.16, s.z, 0.42, 0.27, 0.3, yaw, visible, s.reward, s.id);
        transform(chestLid, ci, s.x, s.y + 0.33, s.z, 0.44, 0.075, 0.32, yaw, visible, s.reward, s.id);
        ci++;
      }
    }
    for (const mesh of [oreMesh, chestWood, chestLid]) if (mesh) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere?.(); // Correct frustum culling across discontiguous balcony instances.
    }
    return meshes;
  }
  return Object.freeze({
    build, forGrid, verifyReachability, componentAt, crossing, toward, nextHop, shelfContains, shelfAt, highestBelow, render, overlapsClimb,
    getRewardState, setRewardStage, serializeRewards, restoreRewards, releaseArea,
    forArea: area => activeByArea.get(area) || null,
    debugSnapshot: () => ({ ...debug, areas: [...activeByArea.entries()].map(([area,n]) => ({
      area, routes: n.routes.length, balconies: n.balconies.length,
      components: n.components.length, rejectedRoutes: n.rejectedRoutes, disconnectedSets: n.unconnectedComponents, candidates: n.candidateCount,
      unreachablePlateaus: n.verification?.unreachablePlateaus?.length ?? null,
      unreachableBalconies: n.verification?.unreachableBalconies?.length ?? null,
      invalidHops: n.verification?.invalidHops?.length ?? null,
      invalidEmbeddedBases: n.verification?.invalidEmbeddedBases?.length ?? null,
      miniBaseStats: n.miniBaseStats, // Mobile diagnostics: area coverage and reasons why a tiny plateau could not be grown.
    })) }),
  });
});
