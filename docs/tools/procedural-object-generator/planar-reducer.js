(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProceduralPlanarReducer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_TOLERANCE = 1e-5;

  function vec3(positions, index) {
    const i = index * 3;
    return [positions[i], positions[i + 1], positions[i + 2]];
  }

  function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }

  function cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  }

  function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  function length(v) {
    return Math.sqrt(dot(v, v));
  }

  function normalize(v) {
    const len = length(v);
    if (len <= 1e-12) return null;
    return [v[0] / len, v[1] / len, v[2] / len];
  }

  function trianglePlane(positions, ia, ib, ic) {
    const a = vec3(positions, ia);
    const b = vec3(positions, ib);
    const c = vec3(positions, ic);
    const normal = normalize(cross(sub(b, a), sub(c, a)));
    if (!normal) return null;
    return { normal, d: -dot(normal, a) };
  }

  function edgeKey(a, b) {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }

  function planesMatch(a, b, tolerance, normalTolerance) {
    if (!a || !b) return false;
    let alignment = dot(a.normal, b.normal);
    let d = b.d;
    if (alignment < 0) {
      alignment = -alignment;
      d = -d;
    }
    return (1 - alignment) <= normalTolerance && Math.abs(a.d - d) <= tolerance;
  }

  function dominantDropAxis(normal) {
    const ax = Math.abs(normal[0]);
    const ay = Math.abs(normal[1]);
    const az = Math.abs(normal[2]);
    if (ax >= ay && ax >= az) return 0;
    if (ay >= az) return 1;
    return 2;
  }

  function project(point, dropAxis) {
    if (dropAxis === 0) return [point[1], point[2]];
    if (dropAxis === 1) return [point[0], point[2]];
    return [point[0], point[1]];
  }

  function cross2(a, b, c) {
    return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  }

  function polygonArea2(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      sum += a[0] * b[1] - b[0] * a[1];
    }
    return sum;
  }

  function removeCollinearLoopVertices(loop, positions, dropAxis, tolerance) {
    let out = loop.slice();
    let changed = true;
    while (changed && out.length > 3) {
      changed = false;
      const next = [];
      for (let i = 0; i < out.length; i++) {
        const prevIndex = out[(i + out.length - 1) % out.length];
        const currIndex = out[i];
        const nextIndex = out[(i + 1) % out.length];
        const prev = project(vec3(positions, prevIndex), dropAxis);
        const curr = project(vec3(positions, currIndex), dropAxis);
        const after = project(vec3(positions, nextIndex), dropAxis);
        const a = Math.hypot(curr[0] - prev[0], curr[1] - prev[1]);
        const b = Math.hypot(after[0] - curr[0], after[1] - curr[1]);
        const scale = Math.max(1, a * b);
        if (Math.abs(cross2(prev, curr, after)) <= tolerance * scale) {
          changed = true;
          continue;
        }
        next.push(currIndex);
      }
      if (next.length < 3) break;
      out = next;
    }
    return out;
  }

  function isConvexLoop(loop, positions, dropAxis, tolerance) {
    if (loop.length < 3) return false;
    let sign = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = project(vec3(positions, loop[(i + loop.length - 1) % loop.length]), dropAxis);
      const b = project(vec3(positions, loop[i]), dropAxis);
      const c = project(vec3(positions, loop[(i + 1) % loop.length]), dropAxis);
      const turn = cross2(a, b, c);
      if (Math.abs(turn) <= tolerance) continue;
      const currentSign = Math.sign(turn);
      if (sign && currentSign !== sign) return false;
      sign = currentSign;
    }
    return sign !== 0;
  }

  function buildBoundaryLoop(componentTriangles, triangles) {
    const edgeCounts = new Map();
    for (const triIndex of componentTriangles) {
      const tri = triangles[triIndex];
      for (const [a, b] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]]) {
        const key = edgeKey(a, b);
        const entry = edgeCounts.get(key);
        if (entry) {
          entry.count++;
        } else {
          edgeCounts.set(key, { count: 1, a, b });
        }
      }
    }

    const adjacency = new Map();
    for (const edge of edgeCounts.values()) {
      if (edge.count !== 1) continue;
      if (!adjacency.has(edge.a)) adjacency.set(edge.a, []);
      if (!adjacency.has(edge.b)) adjacency.set(edge.b, []);
      adjacency.get(edge.a).push(edge.b);
      adjacency.get(edge.b).push(edge.a);
    }
    if (adjacency.size < 3) return null;
    for (const neighbors of adjacency.values()) {
      if (neighbors.length !== 2) return null;
    }

    const start = Math.min(...adjacency.keys());
    const loop = [start];
    let previous = null;
    let current = start;
    for (let guard = 0; guard <= adjacency.size; guard++) {
      const neighbors = adjacency.get(current);
      const next = neighbors[0] !== previous ? neighbors[0] : neighbors[1];
      if (next === start) break;
      if (loop.includes(next)) return null;
      loop.push(next);
      previous = current;
      current = next;
    }
    return loop.length === adjacency.size ? loop : null;
  }

  function allVerticesOnPlane(loop, positions, plane, tolerance) {
    for (const vertexIndex of loop) {
      const p = vec3(positions, vertexIndex);
      if (Math.abs(dot(plane.normal, p) + plane.d) > tolerance) return false;
    }
    return true;
  }

  function orientLoopToPlane(loop, positions, plane) {
    if (loop.length < 3) return loop;
    const a = vec3(positions, loop[0]);
    const b = vec3(positions, loop[1]);
    const c = vec3(positions, loop[2]);
    const n = cross(sub(b, a), sub(c, a));
    return dot(n, plane.normal) >= 0 ? loop : [loop[0], ...loop.slice(1).reverse()];
  }

  function componentTriangleArea(componentTriangles, triangles, positions, dropAxis) {
    let total = 0;
    for (const triIndex of componentTriangles) {
      const tri = triangles[triIndex];
      const a = project(vec3(positions, tri[0]), dropAxis);
      const b = project(vec3(positions, tri[1]), dropAxis);
      const c = project(vec3(positions, tri[2]), dropAxis);
      total += Math.abs(
        a[0] * (b[1] - c[1]) +
        b[0] * (c[1] - a[1]) +
        c[0] * (a[1] - b[1])
      );
    }
    return total;
  }

  function reduceIndexedMeshData(input, options = {}) {
    const positions = input && input.positions;
    const sourceIndices = input && input.indices;
    const tolerance = Math.max(0, Number(options.tolerance ?? DEFAULT_TOLERANCE));
    const normalTolerance = Math.max(1e-12, Number(options.normalTolerance ?? tolerance * 4));
    if (!positions || !sourceIndices || sourceIndices.length % 3 !== 0) {
      return {
        indices: sourceIndices ? Array.from(sourceIndices) : [],
        originalTriangles: sourceIndices ? Math.floor(sourceIndices.length / 3) : 0,
        triangles: sourceIndices ? Math.floor(sourceIndices.length / 3) : 0,
        simplifiedPatches: 0,
        skipped: true,
        reason: 'Expected indexed triangle geometry.',
      };
    }

    const indices = Array.from(sourceIndices);
    const triangleCount = indices.length / 3;
    const triangles = new Array(triangleCount);
    const planes = new Array(triangleCount);
    const edgeToTriangles = new Map();

    for (let t = 0; t < triangleCount; t++) {
      const tri = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]];
      triangles[t] = tri;
      planes[t] = trianglePlane(positions, tri[0], tri[1], tri[2]);
      for (const [a, b] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]]) {
        const key = edgeKey(a, b);
        if (!edgeToTriangles.has(key)) edgeToTriangles.set(key, []);
        edgeToTriangles.get(key).push(t);
      }
    }

    const neighbors = Array.from({ length: triangleCount }, () => []);
    for (const linked of edgeToTriangles.values()) {
      if (linked.length !== 2) continue;
      neighbors[linked[0]].push(linked[1]);
      neighbors[linked[1]].push(linked[0]);
    }

    const visited = new Uint8Array(triangleCount);
    const output = [];
    let simplifiedPatches = 0;

    for (let start = 0; start < triangleCount; start++) {
      if (visited[start]) continue;
      visited[start] = 1;
      const refPlane = planes[start];
      const component = [start];
      const queue = [start];

      while (queue.length) {
        const current = queue.pop();
        for (const next of neighbors[current]) {
          if (visited[next]) continue;
          if (!planesMatch(refPlane, planes[next], tolerance, normalTolerance)) continue;
          visited[next] = 1;
          component.push(next);
          queue.push(next);
        }
      }

      if (!refPlane || component.length <= 2) {
        for (const triIndex of component) output.push(...triangles[triIndex]);
        continue;
      }

      let loop = buildBoundaryLoop(component, triangles);
      if (!loop || !allVerticesOnPlane(loop, positions, refPlane, tolerance)) {
        for (const triIndex of component) output.push(...triangles[triIndex]);
        continue;
      }

      const dropAxis = dominantDropAxis(refPlane.normal);
      loop = removeCollinearLoopVertices(loop, positions, dropAxis, tolerance);
      if (loop.length < 3 || !isConvexLoop(loop, positions, dropAxis, tolerance)) {
        for (const triIndex of component) output.push(...triangles[triIndex]);
        continue;
      }

      const projectedLoop = loop.map(index => project(vec3(positions, index), dropAxis));
      const polygonDoubleArea = Math.abs(polygonArea2(projectedLoop));
      const sourceDoubleArea = componentTriangleArea(component, triangles, positions, dropAxis);
      const areaTolerance = Math.max(tolerance * tolerance * 8, sourceDoubleArea * tolerance * 8);
      if (Math.abs(polygonDoubleArea - sourceDoubleArea) > areaTolerance) {
        for (const triIndex of component) output.push(...triangles[triIndex]);
        continue;
      }

      const replacementTriangles = loop.length - 2;
      if (replacementTriangles >= component.length) {
        for (const triIndex of component) output.push(...triangles[triIndex]);
        continue;
      }

      loop = orientLoopToPlane(loop, positions, refPlane);
      for (let i = 1; i < loop.length - 1; i++) {
        output.push(loop[0], loop[i], loop[i + 1]);
      }
      simplifiedPatches++;
    }

    return {
      indices: output,
      originalTriangles: triangleCount,
      triangles: output.length / 3,
      simplifiedPatches,
      skipped: false,
      reason: '',
    };
  }

  function reduceThreeGeometry(geometry, options = {}) {
    if (!geometry || !geometry.isBufferGeometry) {
      return { skipped: true, reason: 'Not a BufferGeometry.', originalTriangles: 0, triangles: 0, simplifiedPatches: 0 };
    }
    const position = geometry.getAttribute && geometry.getAttribute('position');
    const index = geometry.index;
    if (!position || !index) {
      const triangleCount = position ? Math.floor(position.count / 3) : 0;
      return { skipped: true, reason: 'Reducer only rewires indexed triangle geometry.', originalTriangles: triangleCount, triangles: triangleCount, simplifiedPatches: 0 };
    }
    if (geometry.groups && geometry.groups.length) {
      return { skipped: true, reason: 'Material groups are preserved by skipping this mesh.', originalTriangles: index.count / 3, triangles: index.count / 3, simplifiedPatches: 0 };
    }
    if (geometry.morphAttributes && Object.keys(geometry.morphAttributes).length) {
      return { skipped: true, reason: 'Morph geometry is preserved by skipping this mesh.', originalTriangles: index.count / 3, triangles: index.count / 3, simplifiedPatches: 0 };
    }

    const result = reduceIndexedMeshData(
      { positions: position.array, indices: index.array },
      options
    );
    if (!result.skipped && result.triangles < result.originalTriangles) {
      geometry.setIndex(result.indices);
      geometry.setDrawRange(0, result.indices.length);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    }
    return result;
  }

  function reduceThreeObject(object, options = {}) {
    const totals = {
      originalTriangles: 0,
      triangles: 0,
      removedTriangles: 0,
      simplifiedPatches: 0,
      meshes: 0,
      skippedMeshes: 0,
      skipReasons: {},
    };
    if (!object || typeof object.traverse !== 'function') return totals;

    object.traverse(child => {
      if (!child || !child.isMesh || !child.geometry) return;
      totals.meshes++;
      const result = reduceThreeGeometry(child.geometry, options);
      totals.originalTriangles += result.originalTriangles || 0;
      totals.triangles += result.triangles || 0;
      totals.simplifiedPatches += result.simplifiedPatches || 0;
      if (result.skipped) {
        totals.skippedMeshes++;
        const reason = result.reason || 'Unknown reason';
        totals.skipReasons[reason] = (totals.skipReasons[reason] || 0) + 1;
      }
    });
    totals.removedTriangles = totals.originalTriangles - totals.triangles;
    return totals;
  }

  function makeFlatGridData(raiseCenter) {
    const positions = [];
    for (let z = 0; z < 3; z++) {
      for (let x = 0; x < 3; x++) {
        const y = (x === 1 && z === 1) ? raiseCenter : 0;
        positions.push(x, y, z);
      }
    }
    const indices = [];
    for (let z = 0; z < 2; z++) {
      for (let x = 0; x < 2; x++) {
        const a = z * 3 + x;
        const b = a + 1;
        const c = a + 3;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    return { positions, indices };
  }

  function runSelfTests() {
    const flat = reduceIndexedMeshData(makeFlatGridData(0), { tolerance: 1e-6 });
    const raised = reduceIndexedMeshData(makeFlatGridData(0.25), { tolerance: 1e-6 });
    return [
      {
        name: 'flat 2x2 grid collapses from 8 triangles to 2',
        pass: flat.originalTriangles === 8 && flat.triangles === 2,
        details: `${flat.originalTriangles} -> ${flat.triangles}`,
      },
      {
        name: 'raised center is preserved',
        pass: raised.originalTriangles === 8 && raised.triangles === 8,
        details: `${raised.originalTriangles} -> ${raised.triangles}`,
      },
    ];
  }

  return {
    DEFAULT_TOLERANCE,
    reduceIndexedMeshData,
    reduceThreeGeometry,
    reduceThreeObject,
    runSelfTests,
  };
});