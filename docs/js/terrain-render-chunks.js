(() => {
  'use strict';

  // Large wilderness floor/material-seam meshes are currently merged across
  // an entire zone. A single visible piece therefore keeps the whole mesh in
  // both the normal scene and layer-3 material-ID pass. This adapter preserves
  // the source geometry/materials exactly, but exposes contiguous draw ranges
  // as independently frustum-cullable children.
  //
  // Child geometries SHARE the source BufferAttributes/index; only drawRange
  // and conservative bounds differ. No duplicate vertex buffers, topology,
  // UV, normal, terrain-height, or material-ID changes are introduced.
  const THREE = window.THREE;
  const rendererProto = THREE?.WebGLRenderer?.prototype;
  if (!THREE?.BufferGeometry || !THREE?.Mesh || !rendererProto || typeof rendererProto.render !== 'function') return;

  const existing = window.TerrainRenderChunks;
  if (existing?.installed) return;

  const originalRender = rendererProto.render;
  if (originalRender.__hobunjiTerrainChunkWrapped) {
    window.TerrainRenderChunks = originalRender.__hobunjiTerrainChunkApi || existing || { installed: true };
    return;
  }

  const MATERIAL_ID_LAYER = 3;
  const MIN_SOURCE_TRIANGLES = 60000;
  const TARGET_TRIANGLES_PER_CHUNK = 48000;
  const MIN_CHUNKS = 2;
  const MAX_CHUNKS_PER_MESH = 96;
  const SCAN_INTERVAL_MS = 500;

  const lastScanAt = new WeakMap();
  let sourceMeshesChunked = 0;
  let chunksCreated = 0;
  let sourceTrianglesChunked = 0;

  function triangleCount(geometry) {
    if (!geometry) return 0;
    const count = geometry.index?.count ?? geometry.attributes?.position?.count ?? 0;
    return Math.floor(Number(count) / 3) || 0;
  }

  function hasLayer(object, layer) {
    const mask = Number(object?.layers?.mask ?? 0) >>> 0;
    return !!(mask & ((1 << layer) >>> 0));
  }

  function isEligibleTerrainMesh(mesh) {
    if (!mesh?.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh) return false;
    if (mesh.userData?.terrainRenderChunkSource || mesh.userData?.terrainRenderChunk) return false;
    if (!mesh.parent?.isScene) return false;
    if (!mesh.receiveShadow) return false;
    if (!hasLayer(mesh, MATERIAL_ID_LAYER)) return false;
    if (!mesh.geometry?.attributes?.position) return false;
    if (Array.isArray(mesh.material)) return false;
    if (mesh.geometry.groups?.length > 1) return false;
    return triangleCount(mesh.geometry) >= MIN_SOURCE_TRIANGLES;
  }

  function fullElementCount(geometry) {
    return geometry.index?.count ?? geometry.attributes.position.count;
  }

  function alignedRanges(elementCount) {
    const totalTriangles = Math.floor(elementCount / 3);
    let chunkCount = Math.ceil(totalTriangles / TARGET_TRIANGLES_PER_CHUNK);
    chunkCount = Math.max(MIN_CHUNKS, Math.min(MAX_CHUNKS_PER_MESH, chunkCount));
    const trianglesPerChunk = Math.ceil(totalTriangles / chunkCount);
    const elementsPerChunk = Math.max(3, trianglesPerChunk * 3);
    const ranges = [];
    for (let start = 0; start < totalTriangles * 3; start += elementsPerChunk) {
      ranges.push({ start, count: Math.min(elementsPerChunk, totalTriangles * 3 - start) });
    }
    return ranges;
  }

  function boundsForRange(geometry, start, count) {
    const position = geometry.attributes.position;
    const index = geometry.index;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const end = Math.min(start + count, fullElementCount(geometry));

    for (let i = start; i < end; i++) {
      const vertexIndex = index ? index.getX(i) : i;
      const x = position.getX(vertexIndex);
      const y = position.getY(vertexIndex);
      const z = position.getZ(vertexIndex);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }

    if (!Number.isFinite(minX)) return null;
    const box = new THREE.Box3(
      new THREE.Vector3(minX, minY, minZ),
      new THREE.Vector3(maxX, maxY, maxZ),
    );
    const center = new THREE.Vector3();
    box.getCenter(center);
    const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
    const sphere = new THREE.Sphere(center, 0.5 * Math.sqrt(dx * dx + dy * dy + dz * dz));
    return { box, sphere };
  }

  function wrapperGeometry(source, range, bounds) {
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes || {})) {
      geometry.setAttribute(name, attribute);
    }
    if (source.index) geometry.setIndex(source.index);
    for (const [name, attribute] of Object.entries(source.morphAttributes || {})) {
      geometry.morphAttributes[name] = attribute;
    }
    geometry.morphTargetsRelative = !!source.morphTargetsRelative;
    geometry.drawRange.start = range.start;
    geometry.drawRange.count = range.count;
    geometry.boundingBox = bounds.box;
    geometry.boundingSphere = bounds.sphere;
    return geometry;
  }

  function makeChunkMesh(sourceMesh, geometry, index) {
    const chunk = new THREE.Mesh(geometry, sourceMesh.material);
    chunk.name = `${sourceMesh.name || 'zone_floor'}__render_chunk_${index}`;
    chunk.layers.mask = sourceMesh.layers.mask;
    chunk.castShadow = sourceMesh.castShadow;
    chunk.receiveShadow = sourceMesh.receiveShadow;
    chunk.frustumCulled = true;
    chunk.renderOrder = sourceMesh.renderOrder;
    chunk.visible = sourceMesh.visible;
    chunk.onBeforeRender = sourceMesh.onBeforeRender;
    chunk.onAfterRender = sourceMesh.onAfterRender;
    chunk.customDepthMaterial = sourceMesh.customDepthMaterial;
    chunk.customDistanceMaterial = sourceMesh.customDistanceMaterial;
    chunk.userData = Object.assign({}, sourceMesh.userData, {
      terrainRenderChunk: true,
      terrainRenderChunkIndex: index,
    });
    return chunk;
  }

  function chunkMesh(mesh) {
    const sourceGeometry = mesh.geometry;
    const totalTriangles = triangleCount(sourceGeometry);
    const ranges = alignedRanges(fullElementCount(sourceGeometry));
    if (ranges.length < MIN_CHUNKS) return 0;

    const chunks = [];
    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i];
      const bounds = boundsForRange(sourceGeometry, range.start, range.count);
      if (!bounds) continue;
      chunks.push(makeChunkMesh(mesh, wrapperGeometry(sourceGeometry, range, bounds), i));
    }
    if (chunks.length < MIN_CHUNKS) return 0;

    // Keep the original Mesh as the ownership/container object because the
    // existing zone-floor cleanup retains that exact reference. Emptying only
    // its drawable geometry means its normal removal/disposal traversal owns
    // the children too.
    mesh.geometry = new THREE.BufferGeometry();
    mesh.userData = Object.assign({}, mesh.userData, {
      terrainRenderChunkSource: true,
      terrainRenderChunkCount: chunks.length,
      terrainRenderChunkTriangles: totalTriangles,
    });
    for (const chunk of chunks) mesh.add(chunk);

    sourceMeshesChunked++;
    chunksCreated += chunks.length;
    sourceTrianglesChunked += totalTriangles;
    return chunks.length;
  }

  function compactNumber(value) {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
    return String(Math.round(value));
  }

  function scanScene(scene, now = performance.now()) {
    if (!scene?.isScene) return 0;
    const last = lastScanAt.get(scene) || -Infinity;
    if (now - last < SCAN_INTERVAL_MS) return 0;
    lastScanAt.set(scene, now);

    // Snapshot direct children because chunkMesh() adds descendants while we
    // work. Terrain material buckets are direct children of their zone scene;
    // this intentionally excludes furniture and procedural feet even though
    // they share the layer-3 material-seam convention.
    const candidates = scene.children.filter(isEligibleTerrainMesh);
    if (!candidates.length) return 0;

    let made = 0;
    let tris = 0;
    let sources = 0;
    for (const mesh of candidates) {
      const sourceTris = triangleCount(mesh.geometry);
      const count = chunkMesh(mesh);
      if (!count) continue;
      made += count;
      tris += sourceTris;
      sources++;
    }

    if (made) {
      const message = `[terrain-perf] split ${sources} whole-zone seam mesh(es), ${compactNumber(tris)} tri into ${made} frustum-cullable draw-range chunk(s) (shared vertex buffers)`;
      if (typeof window.__farmLog === 'function') window.__farmLog(message, 'render');
      else console.debug(message);
    }
    return made;
  }

  function wrappedRender(scene, camera) {
    // Scan before the underlying renderer's world-matrix update so newly added
    // chunk children have current matrixWorld state on this same frame.
    scanScene(scene);
    return originalRender.call(this, scene, camera);
  }

  const api = {
    installed: true,
    scanScene,
    snapshot() {
      return { sourceMeshesChunked, chunksCreated, sourceTrianglesChunked };
    },
  };

  wrappedRender.__hobunjiTerrainChunkWrapped = true;
  wrappedRender.__hobunjiTerrainChunkOriginal = originalRender;
  wrappedRender.__hobunjiTerrainChunkApi = api;
  rendererProto.render = wrappedRender;
  window.TerrainRenderChunks = api;
})();
