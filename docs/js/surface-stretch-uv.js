(() => {
  'use strict';

  const THREE = window.THREE; // Used by every geometry/UV operation in this module.
  if (!THREE || window.HobunjiSurfaceStretchUV?.installed) return;

  const DEFAULT_ANGLE_TOLERANCE_DEG = 18; // Used to decide whether edge-adjacent triangles belong to the same planar surface island.
  const MAX_RELAX_ITERATIONS = 140; // Used by the harmonic UV solver for interior vertices.
  const RELAX_EPSILON = 1e-5; // Used to stop the harmonic UV solver once changes are visually negligible.
  const DEBUG_HISTORY_LIMIT = 16; // Used to keep the mobile-visible mapping history bounded.
  const debugState = { mappedMeshes: 0, mappedGeometries: 0, patches: 0, fallbacks: 0, successLogs: 0, history: [] }; // Used by snapshot() and the in-game Debug panel.
  const wrapperState = { borderDeps: null, patchedObjects: new WeakSet() }; // Used by runtime wrappers so terrain created after startup is remapped once.

  function debugLog(message, level = 'info') {
    const text = `[surface-stretch] ${message}`; // Used for both the mobile Debug panel and console fallback.
    if (typeof window.__farmLog === 'function') window.__farmLog(text, level, 'render');
    else if (level === 'warn') console.warn(text);
    else console.debug(text);
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function edgeKey(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  function chooseQuantizationEpsilon(geometry) {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox; // Used to scale vertex matching tolerance to the geometry's physical size.
    const dx = box ? box.max.x - box.min.x : 1; // Used to estimate geometry diagonal for stable shared-edge matching.
    const dy = box ? box.max.y - box.min.y : 1; // Used to estimate geometry diagonal for stable shared-edge matching.
    const dz = box ? box.max.z - box.min.z : 1; // Used to estimate geometry diagonal for stable shared-edge matching.
    const diagonal = Math.sqrt(dx * dx + dy * dy + dz * dz); // Used to make matching tolerant without merging visibly separate vertices.
    return Math.max(1e-6, diagonal * 1e-6);
  }

  function vertexKey(position, index, epsilon) {
    const inv = 1 / epsilon; // Used to quantize nearly-identical triangle-corner positions onto one topology vertex.
    const x = Math.round(position.getX(index) * inv); // Used as the quantized X component of the topology key.
    const y = Math.round(position.getY(index) * inv); // Used as the quantized Y component of the topology key.
    const z = Math.round(position.getZ(index) * inv); // Used as the quantized Z component of the topology key.
    return `${x},${y},${z}`;
  }

  function selectedTriangleSet(geometry, materialIndex) {
    if (materialIndex == null) return null;
    const groups = Array.isArray(geometry.groups) ? geometry.groups : []; // Used to preserve non-target material UVs on multi-material terrain.
    if (!groups.length) return materialIndex === 0 ? null : new Set();
    const selected = new Set(); // Used by triangle collection to restrict remapping to one material slot.
    for (const group of groups) {
      if (Number(group.materialIndex || 0) !== Number(materialIndex)) continue;
      const firstTriangle = Math.floor(Number(group.start || 0) / 3); // Used as the first triangle covered by the selected material group.
      const triangleCount = Math.ceil(Number(group.count || 0) / 3); // Used to enumerate every triangle covered by the selected material group.
      for (let i = 0; i < triangleCount; i++) selected.add(firstTriangle + i);
    }
    return selected;
  }

  function seedUvIfMissing(geometry) {
    const position = geometry.getAttribute('position'); // Used to seed untouched material slots when a source mesh has no UV attribute at all.
    if (!position) return null;
    const existing = geometry.getAttribute('uv'); // Used unchanged when the source geometry already provides UVs for non-target surfaces.
    if (existing?.count === position.count) return existing;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox; // Used for a conservative XZ fallback on triangles that are not being surface-unwrapped.
    const dx = Math.max(1e-5, box.max.x - box.min.x); // Used to normalize fallback U coordinates.
    const dz = Math.max(1e-5, box.max.z - box.min.z); // Used to normalize fallback V coordinates.
    const array = new Float32Array(position.count * 2); // Used as the geometry's new UV buffer.
    const uv = new THREE.BufferAttribute(array, 2); // Used by both untouched triangles and the surface-island overwrite below.
    for (let i = 0; i < position.count; i++) {
      uv.setXY(i, (position.getX(i) - box.min.x) / dx, (position.getZ(i) - box.min.z) / dz);
    }
    geometry.setAttribute('uv', uv);
    return uv;
  }

  function cloneForIndependentUvs(source) {
    const clone = source.index ? source.toNonIndexed() : source.clone(); // Used so one triangle can own different UVs from its neighbor at an island seam.
    clone.userData = Object.assign({}, source.userData || {}, clone.userData || {});
    return clone;
  }

  function collectTriangles(geometry, materialIndex, epsilon) {
    const position = geometry.getAttribute('position'); // Used to read each triangle corner in the expanded geometry.
    const selected = selectedTriangleSet(geometry, materialIndex); // Used to omit grass/top triangles when remapping only a cliff slot.
    const triangleCount = Math.floor(position.count / 3); // Used as the maximum triangle index in a non-indexed geometry.
    const triangles = []; // Used by island segmentation and UV writing.
    const vertexPositions = new Map(); // Used to keep one representative 3D point for each quantized topology vertex.
    const edgeToTriangles = new Map(); // Used to discover triangle adjacency across shared geometric edges.

    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
      if (selected && !selected.has(triangleIndex)) continue;
      const base = triangleIndex * 3; // Used as the first BufferAttribute vertex of this triangle.
      const keys = [
        vertexKey(position, base, epsilon),
        vertexKey(position, base + 1, epsilon),
        vertexKey(position, base + 2, epsilon),
      ]; // Used to reconnect duplicated non-indexed triangle corners into topology.
      const a = new THREE.Vector3(position.getX(base), position.getY(base), position.getZ(base)); // Used to calculate this triangle's plane normal.
      const b = new THREE.Vector3(position.getX(base + 1), position.getY(base + 1), position.getZ(base + 1)); // Used to calculate this triangle's plane normal.
      const c = new THREE.Vector3(position.getX(base + 2), position.getY(base + 2), position.getZ(base + 2)); // Used to calculate this triangle's plane normal.
      const cross = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)); // Used for both area weighting and plane orientation.
      const twiceArea = cross.length(); // Used to ignore degenerate triangles and weight averaged patch normals.
      const normal = twiceArea > 1e-10 ? cross.multiplyScalar(1 / twiceArea) : new THREE.Vector3(0, 1, 0); // Used by planar-rotation similarity tests.
      const triangle = { triangleIndex, base, keys, normal, area: twiceArea * 0.5 }; // Used throughout segmentation and final UV assignment.
      const localIndex = triangles.length; // Used by edge adjacency lists rather than sparse source triangle indices.
      triangles.push(triangle);

      for (let corner = 0; corner < 3; corner++) {
        const key = keys[corner]; // Used to index the representative point of this topology vertex.
        if (!vertexPositions.has(key)) {
          const sourceIndex = base + corner; // Used to copy this topology vertex's representative position.
          vertexPositions.set(key, new THREE.Vector3(position.getX(sourceIndex), position.getY(sourceIndex), position.getZ(sourceIndex)));
        }
      }
      for (let edge = 0; edge < 3; edge++) {
        const key = edgeKey(keys[edge], keys[(edge + 1) % 3]); // Used to find triangles sharing this exact geometric edge.
        const list = edgeToTriangles.get(key) || []; // Used to append this triangle to the edge's adjacency bucket.
        list.push(localIndex);
        edgeToTriangles.set(key, list);
      }
    }

    return { triangles, vertexPositions, edgeToTriangles };
  }

  function segmentSurfaceIslands(topology, angleToleranceDeg) {
    const triangles = topology.triangles; // Used as the source set for connected planar-region growing.
    const edgeToTriangles = topology.edgeToTriangles; // Used to enumerate only edge-connected neighbor triangles.
    const cosTolerance = Math.cos(THREE.MathUtils.degToRad(angleToleranceDeg)); // Used as the normal-similarity threshold.
    const assigned = new Int32Array(triangles.length); // Used to prevent a triangle from joining more than one surface island.
    assigned.fill(-1);
    const islands = []; // Used by the unwrap stage; each island receives one complete 0..1 texture square.

    for (let seedIndex = 0; seedIndex < triangles.length; seedIndex++) {
      if (assigned[seedIndex] !== -1) continue;
      const islandIndex = islands.length; // Used as the assignment marker for this region-growing pass.
      const seedNormal = triangles[seedIndex].normal.clone(); // Used to prevent gradual curvature from chaining around a large bend.
      const normalSum = seedNormal.clone().multiplyScalar(Math.max(triangles[seedIndex].area, 1e-6)); // Used to track the island's area-weighted average orientation.
      const queue = [seedIndex]; // Used to breadth-first traverse edge-connected triangles.
      const triangleIndices = []; // Used as this island's compact list of topology triangle indices.
      assigned[seedIndex] = islandIndex;

      while (queue.length) {
        const currentIndex = queue.shift(); // Used to inspect all edges of the next triangle in this island.
        const current = triangles[currentIndex]; // Used to discover neighbor triangles through its three topology edges.
        triangleIndices.push(currentIndex);
        for (let edge = 0; edge < 3; edge++) {
          const neighbors = edgeToTriangles.get(edgeKey(current.keys[edge], current.keys[(edge + 1) % 3])) || []; // Used to inspect only edge-sharing triangles.
          for (const neighborIndex of neighbors) {
            if (assigned[neighborIndex] !== -1) continue;
            const neighbor = triangles[neighborIndex]; // Used for the candidate plane-rotation checks below.
            const averageNormal = normalSum.clone().normalize(); // Used to keep the region centered on its accumulated planar rotation.
            if (neighbor.normal.dot(seedNormal) < cosTolerance) continue;
            if (neighbor.normal.dot(averageNormal) < cosTolerance) continue;
            assigned[neighborIndex] = islandIndex;
            queue.push(neighborIndex);
            normalSum.addScaledVector(neighbor.normal, Math.max(neighbor.area, 1e-6));
          }
        }
      }

      islands.push({ triangleIndices, normal: normalSum.normalize() });
    }
    return islands;
  }

  function projectionBasis(normal) {
    const candidates = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)]; // Used to choose a stable world-oriented tangent axis.
    let u = null; // Used as the patch's planar U axis.
    for (const candidate of candidates) {
      const projected = candidate.clone().addScaledVector(normal, -candidate.dot(normal)); // Used to remove the component perpendicular to the patch plane.
      if (projected.lengthSq() > 1e-6) { u = projected.normalize(); break; }
    }
    if (!u) u = new THREE.Vector3(1, 0, 0);
    const v = new THREE.Vector3().crossVectors(normal, u).normalize(); // Used as the patch's planar V axis, perpendicular to U.
    return { u, v };
  }

  function islandData(topology, island) {
    const vertices = new Set(); // Used to enumerate each topology vertex in the island exactly once.
    const edgeCounts = new Map(); // Used to identify the island perimeter: edges referenced by exactly one island triangle.
    const adjacency = new Map(); // Used by the harmonic solver to average each interior vertex over its mesh neighbors.
    for (const triangleIndex of island.triangleIndices) {
      const triangle = topology.triangles[triangleIndex]; // Used to add its vertices and three edges to island topology.
      for (const key of triangle.keys) vertices.add(key);
      for (let edge = 0; edge < 3; edge++) {
        const a = triangle.keys[edge]; // Used as one endpoint of the current mesh edge.
        const b = triangle.keys[(edge + 1) % 3]; // Used as the other endpoint of the current mesh edge.
        const key = edgeKey(a, b); // Used to count how many island triangles share this edge.
        edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
        if (!adjacency.has(a)) adjacency.set(a, new Set());
        if (!adjacency.has(b)) adjacency.set(b, new Set());
        adjacency.get(a).add(b);
        adjacency.get(b).add(a);
      }
    }

    const basis = projectionBasis(island.normal); // Used to flatten the island into a temporary 2D coordinate system before square-boundary mapping.
    const projected = new Map(); // Used for boundary ordering, fallback UVs, and harmonic initialization.
    for (const key of vertices) {
      const point = topology.vertexPositions.get(key); // Used to project this topology vertex onto the island plane.
      projected.set(key, [point.dot(basis.u), point.dot(basis.v)]);
    }

    const boundaryAdjacency = new Map(); // Used to trace one or more perimeter loops from one-use island edges.
    for (const [key, count] of edgeCounts) {
      if (count !== 1) continue;
      const [a, b] = key.split('|'); // Used as the endpoints of this perimeter edge; topology keys never contain '|'.
      if (!boundaryAdjacency.has(a)) boundaryAdjacency.set(a, new Set());
      if (!boundaryAdjacency.has(b)) boundaryAdjacency.set(b, new Set());
      boundaryAdjacency.get(a).add(b);
      boundaryAdjacency.get(b).add(a);
    }
    return { vertices, adjacency, projected, boundaryAdjacency };
  }

  function traceBoundaryLoops(boundaryAdjacency) {
    const unused = new Set(); // Used to ensure each perimeter edge is traced only once.
    for (const [a, neighbors] of boundaryAdjacency) {
      for (const b of neighbors) unused.add(edgeKey(a, b));
    }
    const loops = []; // Used to select the outer perimeter and preserve any inner holes.

    while (unused.size) {
      const firstEdge = unused.values().next().value; // Used to seed the next perimeter trace.
      const [edgeA, edgeB] = firstEdge.split('|'); // Used as initial boundary vertices for the trace.
      let start = edgeA; // Used as the loop-closing target.
      if ((boundaryAdjacency.get(edgeA)?.size || 0) !== 2) start = edgeA;
      else if ((boundaryAdjacency.get(edgeB)?.size || 0) !== 2) start = edgeB;
      const loop = [start]; // Used as the ordered vertex cycle/chain for one perimeter component.
      let previous = null; // Used to avoid immediately walking back across the edge we just consumed.
      let current = start; // Used as the active perimeter vertex during tracing.
      let guard = 0; // Used to prevent malformed non-manifold boundaries from causing an infinite loop.

      while (guard++ < boundaryAdjacency.size + 8) {
        const neighbors = Array.from(boundaryAdjacency.get(current) || []); // Used to choose the next still-unused perimeter edge.
        let next = null; // Used as the next ordered vertex in this loop.
        for (const candidate of neighbors) {
          if (candidate === previous) continue;
          if (unused.has(edgeKey(current, candidate))) { next = candidate; break; }
        }
        if (!next) {
          for (const candidate of neighbors) {
            if (unused.has(edgeKey(current, candidate))) { next = candidate; break; }
          }
        }
        if (!next) break;
        unused.delete(edgeKey(current, next));
        previous = current;
        current = next;
        if (current === start) break;
        loop.push(current);
      }
      if (loop.length >= 2) loops.push(loop);
    }
    return loops;
  }

  function signedArea(loop, projected) {
    let area = 0; // Used to rank perimeter loops and normalize their winding direction.
    for (let i = 0; i < loop.length; i++) {
      const a = projected.get(loop[i]); // Used as the current projected perimeter point.
      const b = projected.get(loop[(i + 1) % loop.length]); // Used as the next projected perimeter point.
      area += a[0] * b[1] - b[0] * a[1];
    }
    return area * 0.5;
  }

  function rotateLoopToStableCorner(loop, projected) {
    if (!loop.length) return loop;
    let bestIndex = 0; // Used to pin texture orientation to a stable southwest-ish perimeter point.
    let bestScore = Infinity; // Used to compare candidate starting corners independent of loop vertex count.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity; // Used to normalize the stable-corner score on long/thin patches.
    for (const key of loop) {
      const point = projected.get(key); // Used to measure the projected bounds of the perimeter.
      minX = Math.min(minX, point[0]); maxX = Math.max(maxX, point[0]);
      minY = Math.min(minY, point[1]); maxY = Math.max(maxY, point[1]);
    }
    const dx = Math.max(1e-6, maxX - minX); // Used to normalize horizontal score contribution.
    const dy = Math.max(1e-6, maxY - minY); // Used to normalize vertical score contribution.
    for (let i = 0; i < loop.length; i++) {
      const point = projected.get(loop[i]); // Used to rank this perimeter vertex as the square's 0,0 anchor.
      const score = (point[0] - minX) / dx + (point[1] - minY) / dy; // Used to choose a stable lower-left-ish texture corner.
      if (score < bestScore) { bestScore = score; bestIndex = i; }
    }
    return loop.slice(bestIndex).concat(loop.slice(0, bestIndex));
  }

  function loopCumulativeLengths(loop, projected) {
    const cumulative = new Float64Array(loop.length + 1); // Used to place the four square corners at approximately quarter-perimeter intervals.
    for (let i = 0; i < loop.length; i++) {
      const a = projected.get(loop[i]); // Used as the current flattened boundary point.
      const b = projected.get(loop[(i + 1) % loop.length]); // Used as the next flattened boundary point, including the closing edge.
      const dx = b[0] - a[0]; // Used to measure flattened boundary edge length.
      const dy = b[1] - a[1]; // Used to measure flattened boundary edge length.
      cumulative[i + 1] = cumulative[i] + Math.max(1e-9, Math.hypot(dx, dy));
    }
    return cumulative;
  }

  function chooseSquareAnchors(loop, projected) {
    if (loop.length < 4) return null;
    const cumulative = loopCumulativeLengths(loop, projected); // Used to choose four distinct perimeter vertices nearest 0/25/50/75% of boundary length.
    const total = cumulative[loop.length]; // Used to convert quarter-perimeter targets into flattened distance.
    if (!(total > 1e-8)) return null;
    const anchors = [0]; // Used as loop indices that map exactly to the square's four corners.
    for (let corner = 1; corner < 4; corner++) {
      const target = total * corner / 4; // Used as the desired perimeter distance of this square corner.
      const minIndex = anchors[anchors.length - 1] + 1; // Used to keep square corners ordered and distinct around the loop.
      const maxIndex = loop.length - (4 - corner); // Used to leave at least one vertex for each remaining square corner.
      let bestIndex = minIndex; // Used as the closest feasible loop vertex to this quarter-perimeter target.
      let bestDistance = Infinity; // Used to rank feasible anchor candidates.
      for (let i = minIndex; i <= maxIndex; i++) {
        const distance = Math.abs(cumulative[i] - target); // Used to compare this loop vertex against the target quarter-perimeter distance.
        if (distance < bestDistance) { bestDistance = distance; bestIndex = i; }
      }
      anchors.push(bestIndex);
    }
    anchors.push(loop.length);
    return { anchors, cumulative };
  }

  function mapOuterBoundaryToSquare(loop, projected, uvByKey) {
    if (loop.length < 4) return false;
    let ordered = loop.slice(); // Used to normalize perimeter winding and texture-corner start without mutating topology data.
    if (signedArea(ordered, projected) < 0) ordered.reverse();
    ordered = rotateLoopToStableCorner(ordered, projected);
    const anchorData = chooseSquareAnchors(ordered, projected); // Used to guarantee real mesh vertices hit all four texture-square corners exactly.
    if (!anchorData) return false;
    const anchors = anchorData.anchors; // Used to divide the perimeter into four side segments.
    const cumulative = anchorData.cumulative; // Used to preserve approximate boundary arc length along each square side.
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]; // Used as the exact UV targets for the square outline.

    for (let side = 0; side < 4; side++) {
      const start = anchors[side]; // Used as the loop index pinned to this square corner.
      const end = anchors[side + 1]; // Used as the loop index pinned to the next square corner.
      const sideLength = Math.max(1e-9, cumulative[end] - cumulative[start]); // Used to interpolate UVs along this one square edge.
      for (let i = start; i <= end; i++) {
        const loopIndex = i % ordered.length; // Used to wrap the closing side's end back to the first loop vertex.
        const t = clamp01((cumulative[i] - cumulative[start]) / sideLength); // Used to preserve relative arc length within this boundary quarter.
        const from = corners[side]; // Used as this square side's starting UV corner.
        const to = corners[side + 1]; // Used as this square side's ending UV corner.
        uvByKey.set(ordered[loopIndex], [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
      }
    }
    return true;
  }

  function projectedBounds(projected, keys) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity; // Used to normalize projected fallback/interior UV initialization.
    for (const key of keys) {
      const point = projected.get(key); // Used to extend the flattened patch bounds.
      minX = Math.min(minX, point[0]); maxX = Math.max(maxX, point[0]);
      minY = Math.min(minY, point[1]); maxY = Math.max(maxY, point[1]);
    }
    return { minX, maxX, minY, maxY, dx: Math.max(1e-6, maxX - minX), dy: Math.max(1e-6, maxY - minY) };
  }

  function projectedUv(point, bounds, inset = 0) {
    const span = Math.max(0, 1 - inset * 2); // Used to optionally keep hole/interior initialization away from the square border.
    return [
      inset + ((point[0] - bounds.minX) / bounds.dx) * span,
      inset + ((point[1] - bounds.minY) / bounds.dy) * span,
    ];
  }

  function relaxInteriorUvs(data, outerLoop, extraLoops, uvByKey) {
    const bounds = projectedBounds(data.projected, data.vertices); // Used to initialize interior and hole vertices near their original planar location.
    const fixed = new Set(outerLoop); // Used to keep the Texas-shaped surface perimeter pinned to the square texture outline.

    for (const loop of extraLoops) {
      for (const key of loop) {
        uvByKey.set(key, projectedUv(data.projected.get(key), bounds, 0.12));
        fixed.add(key);
      }
    }
    for (const key of data.vertices) {
      if (!uvByKey.has(key)) uvByKey.set(key, projectedUv(data.projected.get(key), bounds, 0.04));
    }

    const freeKeys = Array.from(data.vertices).filter(key => !fixed.has(key)); // Used as the vertices updated by the harmonic relaxation loop.
    for (let iteration = 0; iteration < MAX_RELAX_ITERATIONS; iteration++) {
      let maxDelta = 0; // Used to terminate early when UV relaxation has converged.
      for (const key of freeKeys) {
        const neighbors = Array.from(data.adjacency.get(key) || []); // Used as positive uniform weights for a Tutte-style harmonic embedding.
        if (!neighbors.length) continue;
        let u = 0, v = 0; // Used to accumulate neighboring UV coordinates for this free vertex.
        let count = 0; // Used to average only neighbors that already have valid UVs.
        for (const neighbor of neighbors) {
          const value = uvByKey.get(neighbor); // Used as this neighbor's current relaxed UV.
          if (!value) continue;
          u += value[0]; v += value[1]; count++;
        }
        if (!count) continue;
        u /= count; v /= count;
        const old = uvByKey.get(key); // Used to measure convergence before replacing this vertex's UV.
        maxDelta = Math.max(maxDelta, Math.abs(u - old[0]), Math.abs(v - old[1]));
        uvByKey.set(key, [u, v]);
      }
      if (maxDelta < RELAX_EPSILON) break;
    }
  }

  function fallbackProjectedIsland(data, uvByKey) {
    const bounds = projectedBounds(data.projected, data.vertices); // Used to retain a stable patch-local mapping when a malformed perimeter cannot be square-wrapped.
    for (const key of data.vertices) uvByKey.set(key, projectedUv(data.projected.get(key), bounds, 0));
  }

  function unwrapIsland(topology, island, uvAttribute) {
    const data = islandData(topology, island); // Used to derive the island's boundary loops, mesh adjacency, and temporary planar projection.
    const loops = traceBoundaryLoops(data.boundaryAdjacency); // Used to identify the outer perimeter plus optional holes.
    let outerLoop = null; // Used as the perimeter that receives the texture square outline.
    let outerArea = -1; // Used to pick the largest projected perimeter as the outer boundary.
    for (const loop of loops) {
      const area = Math.abs(signedArea(loop, data.projected)); // Used to distinguish the outer boundary from smaller holes/components.
      if (loop.length >= 3 && area > outerArea) { outerArea = area; outerLoop = loop; }
    }

    const uvByKey = new Map(); // Used to store one consistent UV for every topology vertex in this island.
    let usedFallback = false; // Used by diagnostics to flag malformed/tiny islands that could not consume the full square outline.
    if (!outerLoop || !mapOuterBoundaryToSquare(outerLoop, data.projected, uvByKey)) {
      fallbackProjectedIsland(data, uvByKey);
      usedFallback = true;
    } else {
      const extraLoops = loops.filter(loop => loop !== outerLoop); // Used to keep holes/non-outer boundary components from collapsing during relaxation.
      relaxInteriorUvs(data, outerLoop, extraLoops, uvByKey);
    }

    for (const triangleIndex of island.triangleIndices) {
      const triangle = topology.triangles[triangleIndex]; // Used to write the solved topology UV back to each duplicated triangle corner.
      for (let corner = 0; corner < 3; corner++) {
        const uv = uvByKey.get(triangle.keys[corner]) || [0, 0]; // Used as this triangle corner's final texture coordinate.
        uvAttribute.setXY(triangle.base + corner, uv[0], uv[1]);
      }
    }
    return { usedFallback, boundaryLoops: loops.length, vertices: data.vertices.size };
  }

  function mapGeometry(sourceGeometry, options = {}) {
    if (!sourceGeometry?.getAttribute?.('position')) return sourceGeometry;
    const angleToleranceDeg = Number.isFinite(Number(options.angleToleranceDeg))
      ? Math.max(1, Math.min(89, Number(options.angleToleranceDeg)))
      : DEFAULT_ANGLE_TOLERANCE_DEG; // Used as the planar-rotation similarity threshold for this mapping call.
    const materialIndex = options.materialIndex == null ? null : Number(options.materialIndex); // Used to remap only one material group's triangles on a shared terrain mesh.
    const signature = `surface-island-v1|angle=${angleToleranceDeg}|material=${materialIndex == null ? '*' : materialIndex}`; // Used to avoid repeating an identical unwrap on the same geometry.
    if (sourceGeometry.userData?.hobunjiSurfaceStretchSignature === signature) return sourceGeometry;

    const geometry = cloneForIndependentUvs(sourceGeometry); // Used as the independently seamable output geometry returned to the mesh.
    const uv = seedUvIfMissing(geometry); // Used as the writable UV attribute while preserving non-target material coordinates.
    if (!uv) return sourceGeometry;
    const epsilon = chooseQuantizationEpsilon(geometry); // Used to reconnect duplicated triangle corners by geometric position.
    const topology = collectTriangles(geometry, materialIndex, epsilon); // Used by both surface segmentation and island unwrapping.
    if (!topology.triangles.length) return sourceGeometry;
    const islands = segmentSurfaceIslands(topology, angleToleranceDeg); // Used so each similarly rotated connected surface gets its own full PNG square.
    let fallbackCount = 0; // Used to summarize malformed/tiny island fallbacks in diagnostics.
    let boundaryLoopCount = 0; // Used to expose how complex the resulting surface boundaries were.
    for (const island of islands) {
      const report = unwrapIsland(topology, island, uv); // Used to square-wrap this island and accumulate diagnostics.
      if (report.usedFallback) fallbackCount++;
      boundaryLoopCount += report.boundaryLoops;
    }
    uv.needsUpdate = true;
    geometry.userData = Object.assign({}, geometry.userData, {
      hobunjiSurfaceStretchSignature: signature,
      hobunjiSurfaceStretch: {
        version: 1,
        angleToleranceDeg,
        materialIndex,
        patchCount: islands.length,
        fallbackCount,
        boundaryLoopCount,
      },
    });

    debugState.mappedGeometries++;
    debugState.patches += islands.length;
    debugState.fallbacks += fallbackCount;
    return geometry;
  }

  function mapMesh(mesh, options = {}) {
    if (!mesh?.isMesh || !mesh.geometry) return null;
    const before = mesh.geometry; // Used to tell whether this call actually replaced the mesh's geometry.
    const mapped = mapGeometry(before, options); // Used as the seam-capable, surface-island-unwrapped geometry.
    if (mapped !== before) {
      mesh.geometry = mapped;
      debugState.mappedMeshes++;
    }
    const report = mesh.geometry?.userData?.hobunjiSurfaceStretch || null; // Used for the mobile-visible debug history and caller diagnostics.
    if (report) {
      const label = options.label || mesh.name || '(unnamed mesh)'; // Used to identify the mapped terrain piece without DevTools.
      debugState.history.push({ label, patchCount: report.patchCount, fallbackCount: report.fallbackCount, materialIndex: report.materialIndex });
      while (debugState.history.length > DEBUG_HISTORY_LIMIT) debugState.history.shift();
      if (report.fallbackCount) debugLog(`${label}: ${report.patchCount} surface island(s), ${report.fallbackCount} fallback unwrap(s).`, 'warn');
      else if (debugState.successLogs < 8) {
        debugState.successLogs++;
        debugLog(`${label}: ${report.patchCount} connected planar surface island(s), full PNG square mapped to each.`);
      }
    }
    return report;
  }

  function remapNaturalTerrainMesh(mesh, label = '') {
    if (!mesh?.isMesh) return null;
    const surface = mesh.userData?.naturalSurface; // Used to distinguish rock/cliff PNG stretch mapping from cylindrical foliage mapping.
    const cliffSlot = mesh.userData?.naturalSurfaceCliffSlot; // Used to remap only cliff triangles when a plateau mesh shares UVs with grass/top material.
    if (cliffSlot != null) return mapMesh(mesh, { materialIndex: Number(cliffSlot), label: label || `${mesh.name || 'terrain'} cliff-slot` });
    if (surface === 'rocks' || surface === 'cliffs') return mapMesh(mesh, { label: label || mesh.name || surface });
    return null;
  }

  function remapNewSceneMeshes(scene, beforeCount, labelPrefix) {
    const children = scene?.children || []; // Used to inspect only meshes appended by the wrapped terrain builder call.
    for (let i = Math.max(0, beforeCount || 0); i < children.length; i++) {
      const child = children[i]; // Used as the newly-created terrain candidate for surface-island mapping.
      if (child?.isMesh) remapNaturalTerrainMesh(child, `${labelPrefix || 'terrain'}:${child.name || i}`);
    }
  }

  function patchNaturalSurfaceMaterials(api) {
    if (!api || wrapperState.patchedObjects.has(api)) return api;
    const originalNaturalizeMesh = api.naturalizeMesh; // Used by the wrapper so direct callers also receive the new island UV mapping.
    if (typeof originalNaturalizeMesh === 'function') {
      api.naturalizeMesh = function (...args) {
        const mesh = originalNaturalizeMesh.apply(this, args); // Used as the already-textured mesh produced by the existing natural-surface pipeline.
        remapNaturalTerrainMesh(mesh, `naturalize:${args[1] || mesh?.name || 'surface'}`);
        return mesh;
      };
    }
    wrapperState.patchedObjects.add(api);
    return api;
  }

  function patchZoneTerrainFeatures(api) {
    if (!api || api.__surfaceStretchWrapped) return api;
    const originalRock = api.buildRockFormationMeshes; // Used to preserve the existing terrain feature builder before post-processing its added meshes.
    if (typeof originalRock === 'function') {
      api.buildRockFormationMeshes = function (scene, ...args) {
        const before = scene?.children?.length || 0; // Used to isolate only meshes created by this rock-formation call.
        const result = originalRock.call(this, scene, ...args); // Used to run the original builder and NaturalSurfaceMaterials wrapper first.
        remapNewSceneMeshes(scene, before, 'rock');
        return result;
      };
    }
    api.__surfaceStretchWrapped = true;
    return api;
  }

  function patchPlateauMesa(api) {
    if (!api || api.__surfaceStretchWrapped) return api;
    const originalBuild = api.buildPlateauMesa; // Used to preserve plateau creation/material grouping before replacing cliff-slot UVs.
    if (typeof originalBuild === 'function') {
      api.buildPlateauMesa = function (...args) {
        const mesh = originalBuild.apply(this, args); // Used as the plateau mesh already decorated by the natural-surface wrapper.
        remapNaturalTerrainMesh(mesh, `plateau:${mesh?.name || 'mesa'}`);
        return mesh;
      };
    }
    api.__surfaceStretchWrapped = true;
    return api;
  }

  function patchBorderTerrain(api) {
    if (!api || api.__surfaceStretchWrapped) return api;
    const originalInit = api.init; // Used to capture the same scene dependencies the existing natural-surface border wrapper receives.
    if (typeof originalInit === 'function') {
      api.init = function (deps) {
        wrapperState.borderDeps = deps; // Used by farm/town border build wrappers that do not receive their scene as an argument.
        return originalInit.call(this, deps);
      };
    }

    const zone = api.buildZoneBorderTerrain; // Used to post-process zone-border meshes appended to the explicit scene argument.
    if (typeof zone === 'function') {
      api.buildZoneBorderTerrain = function (scene, ...args) {
        const before = scene?.children?.length || 0; // Used to isolate zone-border meshes created by this call.
        const result = zone.call(this, scene, ...args); // Used to run existing border generation and natural-surface replacement first.
        remapNewSceneMeshes(scene, before, 'zone-border');
        return result;
      };
    }

    const farm = api.buildBorderTerrain; // Used to post-process farm-border meshes using dependencies captured from init().
    if (typeof farm === 'function') {
      api.buildBorderTerrain = function (...args) {
        const scene = wrapperState.borderDeps?.scene; // Used as the farm scene whose new children need island UVs.
        const before = scene?.children?.length || 0; // Used to isolate farm-border meshes created by this call.
        const result = farm.apply(this, args); // Used to preserve the existing border builder and natural-surface wrappers.
        remapNewSceneMeshes(scene, before, 'farm-border');
        return result;
      };
    }

    const town = api.buildTownBorderTerrain; // Used to post-process town-border meshes using the existing injected scene getter.
    if (typeof town === 'function') {
      api.buildTownBorderTerrain = function (...args) {
        const scene = wrapperState.borderDeps?.townScene || wrapperState.borderDeps?.getTownScene?.(); // Used as the town scene whose new children need island UVs.
        const before = scene?.children?.length || 0; // Used to isolate town-border meshes created by this call.
        const result = town.apply(this, args); // Used to preserve the existing town border generation first.
        remapNewSceneMeshes(scene, before, 'town-border');
        return result;
      };
    }

    api.__surfaceStretchWrapped = true;
    return api;
  }

  function chainGlobal(name, wrapper) {
    const descriptor = Object.getOwnPropertyDescriptor(window, name); // Used to compose with NaturalSurfaceMaterials' configurable late-load accessor when present.
    if (descriptor?.get && descriptor?.set && descriptor.configurable) {
      const oldGet = descriptor.get; // Used to read the value managed by the existing accessor closure.
      const oldSet = descriptor.set; // Used to let the existing accessor apply its own wrapper before ours.
      const current = oldGet.call(window); // Used to patch an API that was already assigned before this module loaded.
      if (current) oldSet.call(window, wrapper(current));
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: descriptor.enumerable !== false,
        get() { return oldGet.call(window); },
        set(value) {
          oldSet.call(window, value);
          const prepared = oldGet.call(window); // Used as the value after the previously-installed global setter has finished wrapping it.
          if (prepared) oldSet.call(window, wrapper(prepared));
        },
      });
      return;
    }

    let current = window[name]; // Used as the backing value for globals that have not already installed an accessor.
    if (current) current = wrapper(current);
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get() { return current; },
        set(value) { current = wrapper(value); },
      });
    } catch (_) {
      if (window[name]) window[name] = wrapper(window[name]);
    }
  }

  window.HobunjiSurfaceStretchUV = {
    installed: true,
    mapGeometry,
    mapMesh,
    remapNaturalTerrainMesh,
    settings: {
      angleToleranceDeg: DEFAULT_ANGLE_TOLERANCE_DEG,
    },
    snapshot() {
      return {
        angleToleranceDeg: DEFAULT_ANGLE_TOLERANCE_DEG,
        mappedMeshes: debugState.mappedMeshes,
        mappedGeometries: debugState.mappedGeometries,
        patches: debugState.patches,
        fallbacks: debugState.fallbacks,
        recent: debugState.history.slice(),
      };
    },
  };

  if (window.NaturalSurfaceMaterials) patchNaturalSurfaceMaterials(window.NaturalSurfaceMaterials);
  chainGlobal('ZoneTerrainFeatures', patchZoneTerrainFeatures);
  chainGlobal('ZonePlateauMesa', patchPlateauMesa);
  chainGlobal('BorderTerrain', patchBorderTerrain);

  debugLog(`installed: connected planar islands use one full PNG square each; normal tolerance ${DEFAULT_ANGLE_TOLERANCE_DEG}°.`);
})();
