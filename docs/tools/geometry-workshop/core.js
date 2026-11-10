// Geometry Workshop mesh operations. Preview-only; never mutates an input mesh.
// meshoptimizer is shared with the Tree Asset Exporter. Material boundaries stay locked.
(function (root, factory) {
  const api = factory(root?.THREE, root?.MeshoptSimplifier);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeometryWorkshopCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function (THREE, simplifier) {
  'use strict';

  const MAX_OUTPUT_TRIANGLES = 250000; // Remeshing budget: prevents a large scene mesh freezing mobile browsers.
  const MAX_SOURCE_TRIANGLES = 350000; // Processing budget: keeps accidental scene captures bounded.
  const IGNORE_TAGS = ['noOutline', 'isClimbBranch', 'isCollisionMesh']; // Optional protected geometry, including leaf cards and climbable branches.

  function triangles(geometry) {
    if (!geometry?.getAttribute?.('position')) return 0;
    return Math.floor((geometry.index?.count ?? geometry.getAttribute('position').count) / 3);
  }
  function materialSlots(mesh) {
    return Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
  }
  function stats(rootObject) {
    const result = { triangles: 0, vertices: 0, meshes: 0, materialSlots: 0, groups: 0 };
    rootObject?.traverse?.(node => {
      if (!node.isMesh || !node.geometry) return;
      result.meshes++;
      result.vertices += node.geometry.getAttribute('position')?.count || 0;
      result.triangles += triangles(node.geometry);
      result.materialSlots += materialSlots(node).length;
      result.groups += Math.max(1, node.geometry.groups?.length || 0);
    });
    return result;
  }
  function edgeDiagnostics(rootObject, edgePercent = 12) {
    // Evaluates the true edge-length threshold against each source mesh, so an
    // intentionally shape-preserving subdivision cannot masquerade as a remesh.
    const result = { inspected: 0, skipped: 0, edgesAboveCutoff: 0, maximumEdgePercent: 0, maximumEdgeLength: 0 };
    const fraction = Math.max(0.005, Math.min(0.5, (Number(edgePercent) || 12) / 100));
    rootObject?.traverse?.(node => {
      if (!node.isMesh || !node.geometry) return;
      const geo = node.geometry, pos = geo.getAttribute?.('position'), index = geo.index;
      if (!pos || pos.itemSize !== 3) return;
      const size = index?.count ?? pos.count, faces = Math.floor(size / 3);
      if (faces > 100000) { result.skipped++; return; } // Bounded mobile diagnostics; no frame-loop work.
      geo.computeBoundingBox?.();
      const box = geo.boundingBox;
      if (!box) return;
      const dimensions = box.getSize(new THREE.Vector3());
      const diag = Math.hypot(dimensions.x, dimensions.y, dimensions.z);
      if (!(diag > 0)) return;
      result.inspected++;
      const cutoffSq = (diag * fraction) ** 2;
      const readIndex = i => index ? index.getX(i) : i;
      for (let i = 0; i < faces * 3; i += 3) {
        const ids = [readIndex(i),readIndex(i + 1),readIndex(i + 2)];
        for (let edge = 0; edge < 3; edge++) {
          const a = ids[edge], b = ids[(edge + 1) % 3];
          const dx = pos.getX(a) - pos.getX(b), dy = pos.getY(a) - pos.getY(b), dz = pos.getZ(a) - pos.getZ(b);
          const squared = dx * dx + dy * dy + dz * dz;
          result.maximumEdgeLength = Math.max(result.maximumEdgeLength, Math.sqrt(squared));
          result.maximumEdgePercent = Math.max(result.maximumEdgePercent, Math.sqrt(squared) / diag * 100);
          if (squared > cutoffSq) result.edgesAboveCutoff++; // Triangle-edge references, not unique edges.
        }
      }
    });
    return result;
  }
  function hasProtectedMaterial(mesh, protectCards) {
    if (!protectCards) return false;
    if (IGNORE_TAGS.some(tag => !!mesh.userData?.[tag])) return true;
    return materialSlots(mesh).some(mat => !!mat && (mat.transparent || (mat.alphaTest || 0) > 0 || !!mat.alphaMap));
  }
  function spans(geometry, slots) {
    const count = geometry.index ? geometry.index.count : geometry.getAttribute('position').count;
    const groups = geometry.groups?.length
      ? geometry.groups.map(g => ({ start: g.start, count: g.count, materialIndex: g.materialIndex || 0 }))
      : [{ start: 0, count, materialIndex: 0 }];
    if (!groups.length || groups.some(g =>
      !Number.isInteger(g.start) || !Number.isInteger(g.count) ||
      g.start < 0 || g.count < 0 || g.start % 3 || g.count % 3 ||
      g.start + g.count > count || g.materialIndex < 0 || g.materialIndex >= slots.length)) {
      throw new Error('Invalid geometry material groups');
    }
    const covered = new Uint8Array(count);
    for (const g of groups) for (let n = g.start; n < g.start + g.count; n++) {
      if (covered[n]) throw new Error('Overlapping material groups');
      covered[n] = 1;
    }
    if (covered.some(value => !value)) throw new Error('Unassigned triangles would lose their material');
    return groups;
  }
  function unsupported(geometry) {
    if (!geometry?.isBufferGeometry || !geometry.getAttribute('position')) return 'missing BufferGeometry positions';
    if (Object.keys(geometry.morphAttributes || {}).some(key => geometry.morphAttributes[key].length)) return 'morph targets (left unchanged)';
    if (geometry.drawRange?.start > 0 || (geometry.drawRange?.count !== Infinity && geometry.drawRange?.count < (geometry.index?.count ?? geometry.getAttribute('position').count))) return 'partial draw range';
    if (Object.values(geometry.attributes || {}).some(attr => attr.isInterleavedBufferAttribute || !attr.array)) return 'interleaved vertex attributes';
    if (geometry.index?.isInterleavedBufferAttribute) return 'interleaved indices';
    return '';
  }
  function indexed(geometry) {
    if (geometry.index) return geometry;
    // Merge exact attribute-identical vertices, never UV seams or different normals.
    const attrs = Object.entries(geometry.attributes);
    const posCount = geometry.getAttribute('position').count;
    const unique = new Map(), originals = [], indices = [];
    for (let i = 0; i < posCount; i++) {
      const key = attrs.map(([name, attr]) => {
        const start = i * attr.itemSize;
        return name + ':' + Array.from(attr.array.subarray(start, start + attr.itemSize)).join(',');
      }).join('|');
      let at = unique.get(key);
      if (at == null) { at = originals.length; originals.push(i); unique.set(key, at); }
      indices.push(at);
    }
    const result = subset(geometry, originals, indices, geometry.groups || []);
    return result;
  }
  function subset(source, used, indices, groups) {
    const output = source.clone();
    for (const [name, attribute] of Object.entries(source.attributes)) {
      const count = attribute.itemSize, old = attribute.array;
      const copy = new old.constructor(used.length * count);
      for (let i = 0; i < used.length; i++) {
        const from = used[i] * count;
        copy.set(old.subarray(from, from + count), i * count);
      }
      const value = new THREE.BufferAttribute(copy, count, attribute.normalized);
      value.name = attribute.name || '';
      output.setAttribute(name, value);
    }
    output.setIndex(indices);
    output.clearGroups();
    for (const g of groups) output.addGroup(g.start, g.count, g.materialIndex);
    output.setDrawRange(0, indices.length);
    output.computeBoundingBox();
    output.computeBoundingSphere();
    return output;
  }
  function compact(source, indexList, groups) {
    const translation = new Int32Array(source.getAttribute('position').count).fill(-1);
    const used = [], remapped = [];
    for (const old of indexList) {
      if (translation[old] === -1) { translation[old] = used.length; used.push(old); }
      remapped.push(translation[old]);
    }
    return subset(source, used, remapped, groups);
  }
  function splitLongEdges(source, edgeFraction, limit) {
    const pos = source.getAttribute('position');
    if (!pos || triangles(source) === 0) return source;
    source.computeBoundingBox();
    const extents = source.boundingBox.getSize(new THREE.Vector3());
    const diagonal = Math.hypot(extents.x, extents.y, extents.z);
    const cutoffSq = Math.pow(diagonal * edgeFraction, 2);
    if (!Number.isFinite(cutoffSq) || cutoffSq <= 0) return source;

    const geometry = source.index ? source : indexed(source);
    const vertexData = {};
    for (const [name, attr] of Object.entries(geometry.attributes)) vertexData[name] = Array.from(attr.array);
    const sourcePos = geometry.getAttribute('position');
    const cache = new Map(); // Original shared edge -> one midpoint (shared across material groups).
    let newVertices = sourcePos.count;
    function distanceSq(a, b) {
      const ax = sourcePos.getX(a) - sourcePos.getX(b), ay = sourcePos.getY(a) - sourcePos.getY(b), az = sourcePos.getZ(a) - sourcePos.getZ(b);
      return ax * ax + ay * ay + az * az;
    }
    function midpoint(a, b) {
      if (distanceSq(a, b) <= cutoffSq) return -1;
      const key = a < b ? a + ':' + b : b + ':' + a;
      if (cache.has(key)) return cache.get(key);
      const at = newVertices++;
      for (const [name, attr] of Object.entries(geometry.attributes)) {
        const values = vertexData[name];
        const n = attr.itemSize;
        let length = 0;
        for (let k = 0; k < n; k++) {
          const v = (attr.array[a * n + k] + attr.array[b * n + k]) * 0.5;
          values.push(v);
          if (name === 'normal' && k < 3) length += v * v;
        }
        if (name === 'normal' && length > 1e-12) {
          const scale = 1 / Math.sqrt(length);
          for (let k = 0; k < Math.min(3, n); k++) values[at * n + k] *= scale;
        }
      }
      cache.set(key, at);
      return at;
    }
    const out = [], groups = [];
    const src = geometry.index.array;
    function face(a, b, c) { out.push(a, b, c); }
    const slotCount = Math.max(1, ...(geometry.groups || []).map(g => (g.materialIndex || 0) + 1));
    for (const group of spans(geometry, Array(slotCount).fill(null))) {
      const start = out.length;
      for (let i = group.start; i < group.start + group.count; i += 3) {
        const a = src[i], b = src[i + 1], c = src[i + 2];
        const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
        const mask = (ab >= 0 ? 1 : 0) | (bc >= 0 ? 2 : 0) | (ca >= 0 ? 4 : 0);
        switch (mask) {
          case 0: face(a,b,c); break;
          case 1: face(a,ab,c); face(ab,b,c); break;
          case 2: face(b,bc,a); face(bc,c,a); break;
          case 4: face(c,ca,b); face(ca,a,b); break;
          case 3: face(b,bc,ab); face(a,ab,c); face(ab,bc,c); break;
          case 6: face(c,ca,bc); face(b,bc,a); face(bc,ca,a); break;
          case 5: face(a,ab,ca); face(b,c,ab); face(ab,c,ca); break;
          case 7: face(a,ab,ca); face(ab,b,bc); face(ca,bc,c); face(ab,bc,ca); break;
        }
        if (out.length / 3 > limit) throw new Error('Remesh exceeds the ' + limit.toLocaleString() + '-triangle mobile budget; use a larger edge size or a smaller object.');
      }
      groups.push({ start, count: out.length - start, materialIndex: group.materialIndex });
    }
    if (!cache.size) {
      // Adaptive subdivision produced no new vertices: do not manufacture a
      // duplicate geometry or advertise a visibly changed 'remesh' in JSON.
      if (geometry !== source) geometry.dispose();
      return source;
    }
    const remeshed = geometry.clone();
    for (const [name, attr] of Object.entries(geometry.attributes)) {
      const converted = new attr.array.constructor(vertexData[name]);
      remeshed.setAttribute(name, new THREE.BufferAttribute(converted, attr.itemSize, attr.normalized));
    }
    remeshed.setIndex(out);
    remeshed.clearGroups();
    for (const g of groups) remeshed.addGroup(g.start, g.count, g.materialIndex);
    remeshed.computeBoundingBox(); remeshed.computeBoundingSphere();
    if (geometry !== source) geometry.dispose();
    return remeshed;
  }
  function reduceGeometry(geometry, reduction, errorTolerance) {
    if (!simplifier?.supported || !simplifier?.simplify) throw new Error('Meshoptimizer WebAssembly is not available; remeshing still works without decimation.');
    const position = geometry.getAttribute('position');
    const source = geometry.index ? geometry : indexed(geometry);
    const positions = source.getAttribute('position');
    if (positions.itemSize !== 3) throw new Error('Only XYZ position attributes can be simplified');
    const fp = positions.array instanceof Float32Array ? positions.array : Float32Array.from(positions.array);
    const original = source.index.array;
    const nextIndices = [], nextGroups = [];
    const materialCount = Math.max(1, ...source.groups.map(g => g.materialIndex + 1));
    for (const group of spans(source, Array(materialCount).fill(null))) {
      const slice = new Uint32Array(group.count);
      for (let j = 0; j < group.count; j++) slice[j] = original[group.start + j];
      const target = Math.max(3, Math.floor((group.count / 3) * (1 - reduction / 100)) * 3);
      // LockBorder preserves both material seams and the original open-mesh outline.
      const simplified = group.count <= 6 || target >= group.count ? slice
        : simplifier.simplify(slice, fp, 3, target, errorTolerance, ['LockBorder'])[0];
      if (!simplified?.length || simplified.length % 3 || simplified.length > slice.length) throw new Error('Invalid meshoptimizer output');
      const at = nextIndices.length;
      for (const id of simplified) nextIndices.push(id);
      nextGroups.push({ start: at, count: nextIndices.length - at, materialIndex: group.materialIndex });
    }
    const result = compact(source, nextIndices, nextGroups);
    if (source !== geometry) source.dispose();
    return result;
  }
  async function process(sourceRoot, options = {}) {
    if (!THREE?.BufferGeometry) throw new Error('Three.js not loaded');
    const reduction = Math.max(0, Math.min(95, Number(options.reduction) || 0));
    const remesh = !!options.remesh;
    const edgeFraction = Math.max(0.005, Math.min(0.5, (Number(options.edgePercent) || 12) / 100));
    const errorTolerance = Math.max(0.0001, Math.min(1, Number(options.errorTolerance) || 0.02));
    const sourceStats = stats(sourceRoot);
    if (sourceStats.triangles > MAX_SOURCE_TRIANGLES) throw new Error('Object exceeds the ' + MAX_SOURCE_TRIANGLES.toLocaleString() + '-triangle safety budget.');
    if (remesh && sourceStats.triangles > MAX_OUTPUT_TRIANGLES) throw new Error('Decimate this object before remeshing: it exceeds the ' + MAX_OUTPUT_TRIANGLES.toLocaleString() + '-triangle mobile preview budget.');
    if (reduction) await simplifier?.ready;

    const output = sourceRoot.clone(true);
    const originals = [], copies = [];
    sourceRoot.traverse(node => { if (node.isMesh) originals.push(node); });
    output.traverse(node => { if (node.isMesh) copies.push(node); });
    const warnings = [], details = [];
    let outputTriangleCount = sourceStats.triangles; // Tracks the aggregate remesh budget across every mesh, not merely each component.
    for (let i = 0; i < originals.length; i++) {
      const before = originals[i], after = copies[i];
      if (!before.geometry) continue;
      const label = before.name || 'mesh ' + (i + 1);
      const reason = before.isSkinnedMesh ? 'skinned mesh' : unsupported(before.geometry);
      if (reason || hasProtectedMaterial(before, options.protectCards !== false)) {
        warnings.push(label + ': preserved (' + (reason || 'transparent/protected mesh') + ')');
        continue;
      }
      let working = null;
      try {
        spans(before.geometry, materialSlots(before));
        if (remesh) {
          const available = MAX_OUTPUT_TRIANGLES - (outputTriangleCount - triangles(before.geometry)); // Reserve the current triangles of every other mesh in the object.
          if (triangles(before.geometry) * 4 > available) {
            warnings.push(label + ': remesh skipped (aggregate mobile triangle budget)');
          } else {
            working = splitLongEdges(before.geometry, edgeFraction, available);
            if (working === before.geometry) {
              warnings.push(label + ': adaptive edge subdivision skipped — no edge exceeds ' + (edgeFraction * 100).toFixed(1) + '% of its bounding-box diagonal.');
            }
          }
        }
        if (reduction) {
          const reduced = reduceGeometry(working || before.geometry, reduction, errorTolerance);
          if (working && working !== before.geometry) working.dispose();
          working = reduced;
        }
        if (working && working !== before.geometry) {
          after.geometry = working; // Never replace/dispose the live source geometry.
          outputTriangleCount += triangles(working) - triangles(before.geometry); // Include changes before deciding whether the next mesh fits.
          details.push(label + ': ' + triangles(before.geometry) + ' → ' + triangles(working) + ' triangles');
        }
      } catch (error) {
        if (working && working !== before.geometry) working.dispose();
        warnings.push(label + ': ' + (error?.message || error));
      }
    }
    output.userData = { ...output.userData, geometryWorkshop: { remesh, reduction, edgePercent: edgeFraction * 100, sourceTriangles: sourceStats.triangles, outputTriangles: stats(output).triangles } };
    return { object: output, source: sourceStats, result: stats(output), warnings, details };
  }
  function preservedMaterials(original, candidate) {
    const a = [], b = [];
    original.traverse(node => { if (node.isMesh) a.push(node); });
    candidate.traverse(node => { if (node.isMesh) b.push(node); });
    if (a.length !== b.length) return false;
    return a.every((node, i) => {
      if (node.material !== b[i].material && (Array.isArray(node.material) ? node.material.some((m,j) => m !== b[i].material?.[j]) : true)) return false;
      const g1 = node.geometry.groups || [], g2 = b[i].geometry.groups || [];
      const materialsA = materialSlots(node), materialsB = materialSlots(b[i]);
      const slotsMatch = materialsA.length === materialsB.length && materialsA.every((m,j) => m === materialsB[j]);
      const usedA = new Set(g1.length ? g1.map(g => g.materialIndex) : [0]);
      const usedB = new Set(g2.length ? g2.map(g => g.materialIndex) : [0]);
      return slotsMatch && usedA.size === usedB.size && [...usedA].every(index => usedB.has(index));
    });
  }
  return Object.freeze({ triangles, stats, edgeDiagnostics, process, preservedMaterials, splitLongEdges, reduceGeometry, MAX_OUTPUT_TRIANGLES });
});
