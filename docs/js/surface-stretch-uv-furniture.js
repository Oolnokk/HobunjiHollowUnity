(() => {
  'use strict';

  const THREE = window.THREE; // Used by every topology, surface-recognition, and UV operation in this module.
  if (!THREE || window.HobunjiSurfaceStretchUV?.installed) return;

  const DEFAULT_SPLIT_ANGLE_DEG = 24; // Used to match the Furniture + Avatar Author's default edge-adjacent surface split threshold.
  const MAX_RELAX_ITERATIONS = 140; // Used by the harmonic UV solver after an irregular perimeter is pinned to the texture square.
  const RELAX_EPSILON = 1e-5; // Used to stop the harmonic solver once free UV vertices have converged.
  const DEBUG_HISTORY_LIMIT = 16; // Used to keep mobile-visible mapping history bounded.
  const debugState = { mappedMeshes: 0, mappedGeometries: 0, patches: 0, fallbacks: 0, successLogs: 0, history: [] }; // Used by snapshot() and the in-game render log.
  const wrapperState = { borderDeps: null, patchedObjects: new WeakSet() }; // Used by late-load wrappers around terrain builders.

  function debugLog(message, level = 'info') {
    const text = `[surface-stretch] ${message}`; // Used as the common mobile/console diagnostic prefix.
    if (typeof window.__farmLog === 'function') window.__farmLog(text, level, 'render');
    else if (level === 'warn') console.warn(text);
    else console.debug(text);
  }

  function clamp01(value) { return Math.max(0, Math.min(1, value)); }
  function edgeKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }

  function chooseQuantizationEpsilon(geometry) {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox; // Used to scale shared-edge position matching to the mesh's physical size.
    const dx = box ? box.max.x - box.min.x : 1; // Used as one component of the geometry diagonal.
    const dy = box ? box.max.y - box.min.y : 1; // Used as one component of the geometry diagonal.
    const dz = box ? box.max.z - box.min.z : 1; // Used as one component of the geometry diagonal.
    const diagonal = Math.sqrt(dx * dx + dy * dy + dz * dz); // Used to avoid both floating-point cracks and accidental distant vertex welding.
    return Math.max(1e-6, diagonal * 1e-6);
  }

  function vertexKey(position, index, epsilon) {
    const inv = 1 / epsilon; // Used to quantize duplicated triangle corners back into logical topology vertices.
    const x = Math.round(position.getX(index) * inv); // Used as the topology key's X component.
    const y = Math.round(position.getY(index) * inv); // Used as the topology key's Y component.
    const z = Math.round(position.getZ(index) * inv); // Used as the topology key's Z component.
    return `${x},${y},${z}`;
  }

  function selectedTriangleSet(geometry, materialIndex) {
    if (materialIndex == null) return null;
    const groups = Array.isArray(geometry.groups) ? geometry.groups : []; // Used to preserve grass/top UVs while remapping only a cliff material slot.
    if (!groups.length) return materialIndex === 0 ? null : new Set();
    const selected = new Set(); // Used to hold source triangle numbers belonging to the requested material slot.
    for (const group of groups) {
      if (Number(group.materialIndex || 0) !== Number(materialIndex)) continue;
      const firstTriangle = Math.floor(Number(group.start || 0) / 3); // Used as the first triangle represented by this material group.
      const triangleCount = Math.ceil(Number(group.count || 0) / 3); // Used to enumerate the group's complete triangle range.
      for (let i = 0; i < triangleCount; i++) selected.add(firstTriangle + i);
    }
    return selected;
  }

  function seedUvIfMissing(geometry) {
    const position = geometry.getAttribute('position'); // Used as the vertex-count/source-position reference for a new UV buffer.
    if (!position) return null;
    const existing = geometry.getAttribute('uv'); // Used unchanged when non-target material slots already have valid authored/world UVs.
    if (existing?.count === position.count && Number(existing.itemSize || 2) >= 2) return existing;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox; // Used for a conservative XZ fallback on triangles outside the remapped cliff slot.
    const dx = Math.max(1e-5, box.max.x - box.min.x); // Used to normalize fallback U.
    const dz = Math.max(1e-5, box.max.z - box.min.z); // Used to normalize fallback V.
    const uv = new THREE.BufferAttribute(new Float32Array(position.count * 2), 2); // Used as the final writable UV attribute.
    for (let i = 0; i < position.count; i++) uv.setXY(i, (position.getX(i) - box.min.x) / dx, (position.getZ(i) - box.min.z) / dz);
    geometry.setAttribute('uv', uv);
    return uv;
  }

  function cloneForIndependentUvs(source) {
    const clone = source.index ? source.toNonIndexed() : source.clone(); // Used so triangle corners can carry separate UVs at detected surface seams.
    clone.userData = Object.assign({}, source.userData || {}, clone.userData || {});
    return clone;
  }

  function collectTriangles(geometry, materialIndex, epsilon) {
    const position = geometry.getAttribute('position'); // Used to read each non-indexed triangle corner.
    const selected = selectedTriangleSet(geometry, materialIndex); // Used to omit non-cliff triangles on shared plateau geometry.
    const triangleCount = Math.floor(position.count / 3); // Used as the source triangle count in the expanded geometry.
    const triangles = []; // Used by adjacency recognition and UV writing.
    const vertexPositions = new Map(); // Used to retain one representative 3D position for each logical topology vertex.
    const edgeToTriangles = new Map(); // Used to build the same shared-edge adjacency graph as the furniture editor.

    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
      if (selected && !selected.has(triangleIndex)) continue;
      const base = triangleIndex * 3; // Used as the first BufferAttribute vertex for this triangle.
      const keys = [vertexKey(position, base, epsilon), vertexKey(position, base + 1, epsilon), vertexKey(position, base + 2, epsilon)]; // Used to reconstruct shared topology edges.
      const a = new THREE.Vector3(position.getX(base), position.getY(base), position.getZ(base)); // Used to calculate the face normal.
      const b = new THREE.Vector3(position.getX(base + 1), position.getY(base + 1), position.getZ(base + 1)); // Used to calculate the face normal.
      const c = new THREE.Vector3(position.getX(base + 2), position.getY(base + 2), position.getZ(base + 2)); // Used to calculate the face normal.
      const cross = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)); // Used for face area and orientation.
      const twiceArea = cross.length(); // Used as a degeneracy test and later area weight.
      const normal = twiceArea > 1e-10 ? cross.multiplyScalar(1 / twiceArea) : new THREE.Vector3(0, 1, 0); // Used by the furniture-style adjacent-face angle test.
      const localIndex = triangles.length; // Used by compact adjacency lists instead of sparse source triangle numbers.
      triangles.push({ triangleIndex, base, keys, normal, area: twiceArea * 0.5 });

      for (let corner = 0; corner < 3; corner++) {
        const key = keys[corner]; // Used to store one representative point for this logical vertex.
        if (!vertexPositions.has(key)) {
          const sourceIndex = base + corner; // Used to read the representative point from the expanded position buffer.
          vertexPositions.set(key, new THREE.Vector3(position.getX(sourceIndex), position.getY(sourceIndex), position.getZ(sourceIndex)));
        }
      }
      for (let edge = 0; edge < 3; edge++) {
        const key = edgeKey(keys[edge], keys[(edge + 1) % 3]); // Used as the logical shared-edge identifier.
        const owners = edgeToTriangles.get(key) || []; // Used to collect every face sharing this exact geometric edge.
        owners.push(localIndex);
        edgeToTriangles.set(key, owners);
      }
    }
    return { triangles, vertexPositions, edgeToTriangles };
  }

  // Mirrors the Furniture + Avatar Author's surface recognition rule: topology
  // first, then flood-fill across a real shared edge only when the CURRENT face
  // and neighboring face are within the split angle. There is deliberately no
  // seed-normal or growing-average veto, so a gently curving cliff remains one
  // recognized surface when every local step is smooth enough.
  function segmentSurfaceIslands(topology, splitAngleDeg) {
    const triangles = topology.triangles; // Used as the face set consumed by the furniture-style flood fill.
    const cosThreshold = Math.cos(THREE.MathUtils.degToRad(splitAngleDeg)); // Used as the adjacent-face normal similarity threshold.
    const neighbors = Array.from({ length: triangles.length }, () => new Set()); // Used as each triangle's edge-sharing neighbor set.
    for (const owners of topology.edgeToTriangles.values()) {
      for (let i = 0; i < owners.length; i++) for (let j = i + 1; j < owners.length; j++) {
        neighbors[owners[i]].add(owners[j]);
        neighbors[owners[j]].add(owners[i]);
      }
    }

    const visited = new Uint8Array(triangles.length); // Used to ensure each face belongs to exactly one recognized surface.
    const islands = []; // Used as the final connected surface groups, matching furniture's recognized surfaces.
    for (let start = 0; start < triangles.length; start++) {
      if (visited[start]) continue;
      const stack = [start]; // Used to flood-fill one recognized surface through acceptable adjacent faces.
      const triangleIndices = []; // Used as this recognized surface's compact face list.
      visited[start] = 1;
      while (stack.length) {
        const currentIndex = stack.pop(); // Used as the current face whose neighbors are compared directly against it.
        const current = triangles[currentIndex]; // Used as the furniture-style local normal reference.
        triangleIndices.push(currentIndex);
        for (const neighborIndex of neighbors[currentIndex]) {
          if (visited[neighborIndex]) continue;
          const neighbor = triangles[neighborIndex]; // Used as the candidate adjacent face.
          if (current.normal.dot(neighbor.normal) + 1e-7 < cosThreshold) continue;
          visited[neighborIndex] = 1;
          stack.push(neighborIndex);
        }
      }

      const normalSum = new THREE.Vector3(); // Used to derive the recognized surface's area-weighted projection normal after grouping is complete.
      for (const triangleIndex of triangleIndices) {
        const face = triangles[triangleIndex]; // Used to contribute this face's orientation according to its area.
        normalSum.addScaledVector(face.normal, Math.max(face.area, 1e-8));
      }
      if (normalSum.lengthSq() < 1e-12) normalSum.addScaledVector(new THREE.Vector3(0, 1, 0), 1);
      else normalSum.normalize();
      islands.push({ triangleIndices, normal: normalSum });
    }
    return islands;
  }

  function projectionBasis(normal) {
    const candidates = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)]; // Used to choose a stable tangent axis for this recognized surface.
    let u = null; // Used as the surface-local U axis.
    for (const candidate of candidates) {
      const projected = candidate.clone().addScaledVector(normal, -candidate.dot(normal)); // Used to remove the component perpendicular to the surface plane.
      if (projected.lengthSq() > 1e-6) { u = projected.normalize(); break; }
    }
    if (!u) u = new THREE.Vector3(1, 0, 0);
    const v = new THREE.Vector3().crossVectors(normal, u).normalize(); // Used as the orthogonal surface-local V axis.
    return { u, v };
  }

  function islandData(topology, island) {
    const vertices = new Set(); // Used to enumerate logical vertices belonging to this recognized surface.
    const edgeCounts = new Map(); // Used to distinguish perimeter edges from internal edges.
    const adjacency = new Map(); // Used by harmonic relaxation of interior UV vertices.
    for (const triangleIndex of island.triangleIndices) {
      const triangle = topology.triangles[triangleIndex]; // Used to contribute this face's vertices/edges.
      for (const key of triangle.keys) vertices.add(key);
      for (let edge = 0; edge < 3; edge++) {
        const a = triangle.keys[edge]; // Used as one endpoint of this mesh edge.
        const b = triangle.keys[(edge + 1) % 3]; // Used as the other endpoint of this mesh edge.
        const key = edgeKey(a, b); // Used to count whether the edge is boundary or internal.
        edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
        if (!adjacency.has(a)) adjacency.set(a, new Set());
        if (!adjacency.has(b)) adjacency.set(b, new Set());
        adjacency.get(a).add(b);
        adjacency.get(b).add(a);
      }
    }

    const basis = projectionBasis(island.normal); // Used to flatten this recognized surface into its own 2D coordinate system.
    const projected = new Map(); // Used by boundary tracing and UV initialization.
    for (const key of vertices) {
      const point = topology.vertexPositions.get(key); // Used as the logical 3D vertex being projected.
      projected.set(key, [point.dot(basis.u), point.dot(basis.v)]);
    }

    const boundaryAdjacency = new Map(); // Used to trace the literal irregular perimeter of this surface.
    for (const [key, count] of edgeCounts) {
      if (count !== 1) continue;
      const [a, b] = key.split('|'); // Used as the one-use perimeter edge endpoints.
      if (!boundaryAdjacency.has(a)) boundaryAdjacency.set(a, new Set());
      if (!boundaryAdjacency.has(b)) boundaryAdjacency.set(b, new Set());
      boundaryAdjacency.get(a).add(b);
      boundaryAdjacency.get(b).add(a);
    }
    return { vertices, adjacency, projected, boundaryAdjacency };
  }

  function traceBoundaryLoops(boundaryAdjacency) {
    const unused = new Set(); // Used to consume each perimeter edge only once.
    for (const [a, adjacent] of boundaryAdjacency) for (const b of adjacent) unused.add(edgeKey(a, b));
    const loops = []; // Used to distinguish the outer perimeter from holes or malformed extra components.
    while (unused.size) {
      const firstEdge = unused.values().next().value; // Used to seed the next perimeter trace.
      const [edgeA, edgeB] = firstEdge.split('|'); // Used as candidate starting vertices.
      let start = edgeA; // Used as the loop-closing target.
      if ((boundaryAdjacency.get(edgeA)?.size || 0) === 2 && (boundaryAdjacency.get(edgeB)?.size || 0) !== 2) start = edgeB;
      const loop = [start]; // Used as the ordered boundary vertex list.
      let previous = null; // Used to avoid immediately walking back along the consumed edge.
      let current = start; // Used as the active boundary vertex.
      let guard = 0; // Used to prevent malformed non-manifold geometry from looping forever.
      while (guard++ < boundaryAdjacency.size + 8) {
        const adjacent = Array.from(boundaryAdjacency.get(current) || []); // Used to choose an unused outgoing perimeter edge.
        let next = null; // Used as the next ordered boundary vertex.
        for (const candidate of adjacent) {
          if (candidate === previous) continue;
          if (unused.has(edgeKey(current, candidate))) { next = candidate; break; }
        }
        if (!next) for (const candidate of adjacent) if (unused.has(edgeKey(current, candidate))) { next = candidate; break; }
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
    let area = 0; // Used to rank boundary loops and normalize winding.
    for (let i = 0; i < loop.length; i++) {
      const a = projected.get(loop[i]); // Used as the current 2D boundary point.
      const b = projected.get(loop[(i + 1) % loop.length]); // Used as the next 2D boundary point.
      area += a[0] * b[1] - b[0] * a[1];
    }
    return area * 0.5;
  }

  function rotateLoopToStableCorner(loop, projected) {
    let bestIndex = 0; // Used to choose a deterministic lower-left-ish texture anchor.
    let bestScore = Infinity; // Used to compare possible starting perimeter vertices.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity; // Used to normalize the anchor score.
    for (const key of loop) {
      const point = projected.get(key); // Used to extend the recognized surface's projected perimeter bounds.
      minX = Math.min(minX, point[0]); maxX = Math.max(maxX, point[0]); minY = Math.min(minY, point[1]); maxY = Math.max(maxY, point[1]);
    }
    const dx = Math.max(1e-6, maxX - minX); // Used to normalize horizontal anchor distance.
    const dy = Math.max(1e-6, maxY - minY); // Used to normalize vertical anchor distance.
    for (let i = 0; i < loop.length; i++) {
      const point = projected.get(loop[i]); // Used to score this candidate as square corner 0,0.
      const score = (point[0] - minX) / dx + (point[1] - minY) / dy; // Used to favor the projected lower-left perimeter point.
      if (score < bestScore) { bestScore = score; bestIndex = i; }
    }
    return loop.slice(bestIndex).concat(loop.slice(0, bestIndex));
  }

  function loopCumulativeLengths(loop, projected) {
    const cumulative = new Float64Array(loop.length + 1); // Used to place square corners at quarter-perimeter distances.
    for (let i = 0; i < loop.length; i++) {
      const a = projected.get(loop[i]); // Used as one end of this projected perimeter edge.
      const b = projected.get(loop[(i + 1) % loop.length]); // Used as the other end of this projected perimeter edge.
      cumulative[i + 1] = cumulative[i] + Math.max(1e-9, Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    return cumulative;
  }

  function chooseSquareAnchors(loop, projected) {
    if (loop.length < 4) return null;
    const cumulative = loopCumulativeLengths(loop, projected); // Used to choose distinct boundary vertices near 0/25/50/75% of perimeter length.
    const total = cumulative[loop.length]; // Used as the complete projected perimeter length.
    if (!(total > 1e-8)) return null;
    const anchors = [0]; // Used as loop indices pinned exactly to the four square corners.
    for (let corner = 1; corner < 4; corner++) {
      const target = total * corner / 4; // Used as this square corner's desired boundary distance.
      const minIndex = anchors[anchors.length - 1] + 1; // Used to keep corner vertices distinct and ordered.
      const maxIndex = loop.length - (4 - corner); // Used to reserve enough vertices for the remaining corners.
      let bestIndex = minIndex; // Used as the closest feasible loop vertex.
      let bestDistance = Infinity; // Used to compare candidate quarter-perimeter anchors.
      for (let i = minIndex; i <= maxIndex; i++) {
        const distance = Math.abs(cumulative[i] - target); // Used to measure how close this boundary vertex is to the desired quarter.
        if (distance < bestDistance) { bestDistance = distance; bestIndex = i; }
      }
      anchors.push(bestIndex);
    }
    anchors.push(loop.length);
    return { anchors, cumulative };
  }

  function mapOuterBoundaryToSquare(loop, projected, uvByKey) {
    if (loop.length < 4) return false;
    let ordered = loop.slice(); // Used to normalize winding/orientation without mutating topology data.
    if (signedArea(ordered, projected) < 0) ordered.reverse();
    ordered = rotateLoopToStableCorner(ordered, projected);
    const anchorData = chooseSquareAnchors(ordered, projected); // Used to map real perimeter vertices to all four exact UV corners.
    if (!anchorData) return false;
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]; // Used as the complete square texture outline.
    for (let side = 0; side < 4; side++) {
      const start = anchorData.anchors[side]; // Used as this square side's first perimeter index.
      const end = anchorData.anchors[side + 1]; // Used as this square side's final perimeter index.
      const sideLength = Math.max(1e-9, anchorData.cumulative[end] - anchorData.cumulative[start]); // Used to preserve relative perimeter arc length on this square edge.
      for (let i = start; i <= end; i++) {
        const loopIndex = i % ordered.length; // Used to wrap the closing square edge back onto the first perimeter vertex.
        const t = clamp01((anchorData.cumulative[i] - anchorData.cumulative[start]) / sideLength); // Used to interpolate along this square side.
        const from = corners[side]; // Used as this square edge's first UV corner.
        const to = corners[side + 1]; // Used as this square edge's second UV corner.
        uvByKey.set(ordered[loopIndex], [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
      }
    }
    return true;
  }

  function projectedBounds(projected, keys) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity; // Used to normalize fallback and interior UV initialization.
    for (const key of keys) {
      const point = projected.get(key); // Used to extend projected surface bounds.
      minX = Math.min(minX, point[0]); maxX = Math.max(maxX, point[0]); minY = Math.min(minY, point[1]); maxY = Math.max(maxY, point[1]);
    }
    return { minX, maxX, minY, maxY, dx: Math.max(1e-6, maxX - minX), dy: Math.max(1e-6, maxY - minY) };
  }

  function projectedUv(point, bounds, inset = 0) {
    const span = Math.max(0, 1 - inset * 2); // Used to optionally keep initialization away from the square boundary.
    return [inset + ((point[0] - bounds.minX) / bounds.dx) * span, inset + ((point[1] - bounds.minY) / bounds.dy) * span];
  }

  function relaxInteriorUvs(data, outerLoop, extraLoops, uvByKey) {
    const bounds = projectedBounds(data.projected, data.vertices); // Used to initialize free/hole UVs near their local projected locations.
    const fixed = new Set(outerLoop); // Used to keep the literal cliff perimeter pinned to the texture square outline.
    for (const loop of extraLoops) for (const key of loop) { uvByKey.set(key, projectedUv(data.projected.get(key), bounds, 0.12)); fixed.add(key); }
    for (const key of data.vertices) if (!uvByKey.has(key)) uvByKey.set(key, projectedUv(data.projected.get(key), bounds, 0.04));
    const freeKeys = Array.from(data.vertices).filter(key => !fixed.has(key)); // Used as the vertices updated by harmonic relaxation.
    for (let iteration = 0; iteration < MAX_RELAX_ITERATIONS; iteration++) {
      let maxDelta = 0; // Used to terminate early when the harmonic embedding has converged.
      for (const key of freeKeys) {
        const adjacent = Array.from(data.adjacency.get(key) || []); // Used as positive uniform neighbors for a Tutte-style embedding.
        if (!adjacent.length) continue;
        let u = 0, v = 0, count = 0; // Used to average neighboring UV positions.
        for (const neighbor of adjacent) {
          const value = uvByKey.get(neighbor); // Used as this neighbor's current UV.
          if (!value) continue;
          u += value[0]; v += value[1]; count++;
        }
        if (!count) continue;
        u /= count; v /= count;
        const old = uvByKey.get(key); // Used to measure convergence before replacing this free vertex.
        maxDelta = Math.max(maxDelta, Math.abs(u - old[0]), Math.abs(v - old[1]));
        uvByKey.set(key, [u, v]);
      }
      if (maxDelta < RELAX_EPSILON) break;
    }
  }

  function fallbackProjectedIsland(data, uvByKey) {
    const bounds = projectedBounds(data.projected, data.vertices); // Used as a stable local planar fallback for malformed/tiny boundaries.
    for (const key of data.vertices) uvByKey.set(key, projectedUv(data.projected.get(key), bounds, 0));
  }

  function unwrapIsland(topology, island, uvAttribute) {
    const data = islandData(topology, island); // Used to derive this recognized surface's perimeter, adjacency, and local 2D projection.
    const loops = traceBoundaryLoops(data.boundaryAdjacency); // Used to identify the outer irregular outline and any holes.
    let outerLoop = null; // Used as the boundary component that consumes the full texture-square outline.
    let outerArea = -1; // Used to choose the largest projected boundary as the outer perimeter.
    for (const loop of loops) {
      const area = Math.abs(signedArea(loop, data.projected)); // Used to rank boundary loops by projected area.
      if (loop.length >= 3 && area > outerArea) { outerArea = area; outerLoop = loop; }
    }
    const uvByKey = new Map(); // Used to store one consistent solved UV per logical topology vertex.
    let usedFallback = false; // Used by diagnostics when a surface cannot consume all four square edges.
    if (!outerLoop || !mapOuterBoundaryToSquare(outerLoop, data.projected, uvByKey)) {
      fallbackProjectedIsland(data, uvByKey);
      usedFallback = true;
    } else {
      const extraLoops = loops.filter(loop => loop !== outerLoop); // Used to keep holes from collapsing during relaxation.
      relaxInteriorUvs(data, outerLoop, extraLoops, uvByKey);
    }
    for (const triangleIndex of island.triangleIndices) {
      const triangle = topology.triangles[triangleIndex]; // Used to write solved logical UVs back to this triangle's independent corners.
      for (let corner = 0; corner < 3; corner++) {
        const uv = uvByKey.get(triangle.keys[corner]) || [0, 0]; // Used as this corner's final texture coordinate.
        uvAttribute.setXY(triangle.base + corner, uv[0], uv[1]);
      }
    }
    return { usedFallback, boundaryLoops: loops.length, vertices: data.vertices.size };
  }

  function mapGeometry(sourceGeometry, options = {}) {
    if (!sourceGeometry?.getAttribute?.('position')) return sourceGeometry;
    const splitAngleDeg = Number.isFinite(Number(options.angleToleranceDeg)) ? Math.max(1, Math.min(89, Number(options.angleToleranceDeg))) : DEFAULT_SPLIT_ANGLE_DEG; // Used as the furniture-style adjacent-face split threshold.
    const materialIndex = options.materialIndex == null ? null : Number(options.materialIndex); // Used to isolate only the cliff material slot on a shared grass/cliff mesh.
    const signature = `surface-island-v2|furniture-adjacency|angle=${splitAngleDeg}|material=${materialIndex == null ? '*' : materialIndex}`; // Used to invalidate every older seed/average-normal unwrap automatically.
    const sourcePosition = sourceGeometry.getAttribute('position'); // Used to validate a cached signature against the actual surviving vertex buffer.
    const sourceUv = sourceGeometry.getAttribute('uv'); // Used to reject stale metadata when downstream code lost the UV attribute.
    const cachedUvValid = !!(sourcePosition && sourceUv?.count === sourcePosition.count && Number(sourceUv.itemSize || 2) >= 2); // Used to trust the v2 signature only when real UV data still exists.
    if (sourceGeometry.userData?.hobunjiSurfaceStretchSignature === signature && cachedUvValid) return sourceGeometry;

    const geometry = cloneForIndependentUvs(sourceGeometry); // Used as the seam-capable geometry that replaces the source mesh geometry.
    const uv = seedUvIfMissing(geometry); // Used as the writable final UV buffer while preserving non-target material coordinates.
    if (!uv) return sourceGeometry;
    const epsilon = chooseQuantizationEpsilon(geometry); // Used to reconstruct shared topology after non-indexing.
    const topology = collectTriangles(geometry, materialIndex, epsilon); // Used by furniture-style surface recognition and irregular perimeter mapping.
    if (!topology.triangles.length) return sourceGeometry;
    const islands = segmentSurfaceIslands(topology, splitAngleDeg); // Used so each furniture-recognized cliff surface gets its own complete PNG domain.
    let fallbackCount = 0; // Used to summarize malformed/tiny surface fallbacks.
    let boundaryLoopCount = 0; // Used to expose recognized-boundary complexity in diagnostics.
    for (const island of islands) {
      const report = unwrapIsland(topology, island, uv); // Used to map one recognized surface after segmentation is complete.
      if (report.usedFallback) fallbackCount++;
      boundaryLoopCount += report.boundaryLoops;
    }
    uv.needsUpdate = true;
    geometry.userData = Object.assign({}, geometry.userData, {
      hobunjiSurfaceStretchSignature: signature,
      hobunjiSurfaceStretch: {
        version: 2,
        segmentation: 'furniture-edge-adjacency',
        angleToleranceDeg: splitAngleDeg,
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
    const before = mesh.geometry; // Used to detect whether this mapping call replaced geometry.
    const mapped = mapGeometry(before, options); // Used as the furniture-recognized, independently seamable output geometry.
    if (mapped !== before) { mesh.geometry = mapped; debugState.mappedMeshes++; }
    const report = mesh.geometry?.userData?.hobunjiSurfaceStretch || null; // Used for mobile-visible mapping diagnostics.
    if (report) {
      const label = options.label || mesh.name || '(unnamed mesh)'; // Used to identify the mapped terrain piece without DevTools.
      debugState.history.push({ label, patchCount: report.patchCount, fallbackCount: report.fallbackCount, materialIndex: report.materialIndex, segmentation: report.segmentation });
      while (debugState.history.length > DEBUG_HISTORY_LIMIT) debugState.history.shift();
      if (report.fallbackCount) debugLog(`${label}: ${report.patchCount} furniture-style surface(s), ${report.fallbackCount} fallback unwrap(s).`, 'warn');
      else if (debugState.successLogs < 8) { debugState.successLogs++; debugLog(`${label}: ${report.patchCount} furniture-style connected surface(s), full PNG square mapped to each.`); }
    }
    return report;
  }

  function remapNaturalTerrainMesh(mesh, label = '') {
    if (!mesh?.isMesh) return null;
    const surface = mesh.userData?.naturalSurface; // Used to route natural rocks/cliffs while leaving cylindrical foliage alone.
    const cliffSlot = mesh.userData?.naturalSurfaceCliffSlot; // Used to isolate stone triangles on a shared plateau grass/cliff geometry.
    if (cliffSlot != null) return mapMesh(mesh, { materialIndex: Number(cliffSlot), label: label || `${mesh.name || 'terrain'} cliff-slot` });
    if (surface === 'rocks' || surface === 'cliffs') return mapMesh(mesh, { label: label || mesh.name || surface });
    return null;
  }

  function remapNewSceneMeshes(scene, beforeCount, labelPrefix) {
    const children = scene?.children || []; // Used to inspect only meshes appended by the wrapped terrain builder call.
    for (let i = Math.max(0, beforeCount || 0); i < children.length; i++) {
      const child = children[i]; // Used as a newly-created natural terrain candidate.
      if (child?.isMesh) remapNaturalTerrainMesh(child, `${labelPrefix || 'terrain'}:${child.name || i}`);
    }
  }

  function patchNaturalSurfaceMaterials(api) {
    if (!api || wrapperState.patchedObjects.has(api)) return api;
    const originalNaturalizeMesh = api.naturalizeMesh; // Used to preserve the proven wilderness-rock texture/tint material pipeline before UV segmentation.
    if (typeof originalNaturalizeMesh === 'function') {
      api.naturalizeMesh = function (...args) {
        const mesh = originalNaturalizeMesh.apply(this, args); // Used as the mesh after carved_smooth pixel tinting + white natural-surface material assignment.
        remapNaturalTerrainMesh(mesh, `naturalize:${args[1] || mesh?.name || 'surface'}`);
        return mesh;
      };
    }
    wrapperState.patchedObjects.add(api);
    return api;
  }

  function patchZoneTerrainFeatures(api) {
    if (!api || api.__surfaceStretchFurnitureWrapped) return api;
    const originalRock = api.buildRockFormationMeshes; // Used to preserve generated wilderness rock formation construction/material naturalization.
    if (typeof originalRock === 'function') {
      api.buildRockFormationMeshes = function (scene, ...args) {
        const before = scene?.children?.length || 0; // Used to isolate meshes created by this build.
        const result = originalRock.call(this, scene, ...args); // Used to run the existing generated-mesh and natural-surface pipeline first.
        remapNewSceneMeshes(scene, before, 'rock');
        return result;
      };
    }
    api.__surfaceStretchFurnitureWrapped = true;
    return api;
  }

  function patchPlateauMesa(api) {
    if (!api || api.__surfaceStretchFurnitureWrapped) return api;
    const originalBuild = api.buildPlateauMesa; // Used to preserve plateau grass-vs-stone classification before furniture-style cliff splitting.
    if (typeof originalBuild === 'function') {
      api.buildPlateauMesa = function (...args) {
        const mesh = originalBuild.apply(this, args); // Used as the plateau mesh after NaturalSurfaceMaterials has assigned the cliff material slot.
        remapNaturalTerrainMesh(mesh, `plateau:${mesh?.name || 'mesa'}`);
        return mesh;
      };
    }
    api.__surfaceStretchFurnitureWrapped = true;
    return api;
  }

  function patchBorderTerrain(api) {
    if (!api || api.__surfaceStretchFurnitureWrapped) return api;
    const originalInit = api.init; // Used to capture farm/town scene dependencies for border builders without explicit scene arguments.
    if (typeof originalInit === 'function') api.init = function (deps) { wrapperState.borderDeps = deps; return originalInit.call(this, deps); };
    const zone = api.buildZoneBorderTerrain; // Used to post-process newly-created zone border natural surfaces.
    if (typeof zone === 'function') api.buildZoneBorderTerrain = function (scene, ...args) { const before = scene?.children?.length || 0; const result = zone.call(this, scene, ...args); remapNewSceneMeshes(scene, before, 'zone-border'); return result; };
    const farm = api.buildBorderTerrain; // Used to post-process newly-created farm border natural surfaces.
    if (typeof farm === 'function') api.buildBorderTerrain = function (...args) { const scene = wrapperState.borderDeps?.scene; const before = scene?.children?.length || 0; const result = farm.apply(this, args); remapNewSceneMeshes(scene, before, 'farm-border'); return result; };
    const town = api.buildTownBorderTerrain; // Used to post-process newly-created town border natural surfaces.
    if (typeof town === 'function') api.buildTownBorderTerrain = function (...args) { const scene = wrapperState.borderDeps?.townScene || wrapperState.borderDeps?.getTownScene?.(); const before = scene?.children?.length || 0; const result = town.apply(this, args); remapNewSceneMeshes(scene, before, 'town-border'); return result; };
    api.__surfaceStretchFurnitureWrapped = true;
    return api;
  }

  function chainGlobal(name, wrapper) {
    const descriptor = Object.getOwnPropertyDescriptor(window, name); // Used to compose with NaturalSurfaceMaterials' existing configurable late-load accessors.
    if (descriptor?.get && descriptor?.set && descriptor.configurable) {
      const oldGet = descriptor.get; // Used to read the value managed by the previous accessor.
      const oldSet = descriptor.set; // Used to let the previous accessor perform its own wrapping before ours.
      const current = oldGet.call(window); // Used to patch an API already assigned before this module loaded.
      if (current) oldSet.call(window, wrapper(current));
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: descriptor.enumerable !== false,
        get() { return oldGet.call(window); },
        set(value) { oldSet.call(window, value); const prepared = oldGet.call(window); if (prepared) oldSet.call(window, wrapper(prepared)); },
      });
      return;
    }
    let current = window[name]; // Used as the backing value when no previous accessor exists.
    if (current) current = wrapper(current);
    try {
      Object.defineProperty(window, name, { configurable: true, enumerable: true, get() { return current; }, set(value) { current = wrapper(value); } });
    } catch (_) {
      if (window[name]) window[name] = wrapper(window[name]);
    }
  }

  window.HobunjiSurfaceStretchUV = {
    installed: true,
    mapGeometry,
    mapMesh,
    remapNaturalTerrainMesh,
    settings: { angleToleranceDeg: DEFAULT_SPLIT_ANGLE_DEG },
    snapshot() {
      return {
        version: 2,
        segmentation: 'furniture-edge-adjacency',
        angleToleranceDeg: DEFAULT_SPLIT_ANGLE_DEG,
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

  debugLog(`installed v2: furniture-style shared-edge surface recognition (${DEFAULT_SPLIT_ANGLE_DEG}°) runs before irregular full-square PNG mapping.`);
})();