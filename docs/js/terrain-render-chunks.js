(() => {
  'use strict';

  // Whole-zone terrain meshes are excellent for draw-call count but terrible
  // for frustum culling: one visible tile keeps every triangle in that material
  // bucket alive in both the normal scene and layer-3 material-ID pass.
  //
  // Re-index those triangles ONCE by real X/Z position into 12x12-tile cells.
  // Each cell keeps the original vertex attributes/materials and only gets its
  // own draw range + conservative bounds. Indexed source geometry reuses its
  // existing index BufferAttribute (the array is reordered in place after a
  // temporary typed-array build), so steady-state GPU memory does not gain a
  // second full terrain vertex buffer.
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
  const TILE_WORLD = 55;
  const CHUNK_TILES = 12;
  const CHUNK_WORLD = TILE_WORLD * CHUNK_TILES;
  const MIN_SOURCE_TRIANGLES = 60000;
  const SCAN_INTERVAL_MS = 500;
  const MAX_SPATIAL_BUCKETS = 400;

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
    if (mesh.geometry.attributes.position.isInterleavedBufferAttribute) return false;
    if (Array.isArray(mesh.material)) return false;
    if (mesh.geometry.groups?.length > 1) return false;
    return triangleCount(mesh.geometry) >= MIN_SOURCE_TRIANGLES;
  }

  function makePositionReader(position) {
    const array = position.array;
    const stride = position.itemSize;
    return function read(index) {
      const offset = index * stride;
      return [array[offset], array[offset + 1], array[offset + 2]];
    };
  }

  function sourceIndexAt(indexAttribute, element) {
    return indexAttribute ? indexAttribute.array[element] : element;
  }

  function bucketKey(gx, gz) {
    return gx * 65536 + gz;
  }

  function getOrCreateBucket(buckets, gx, gz) {
    const key = bucketKey(gx, gz);
    let bucket = buckets.get(key);
    if (bucket) return bucket;
    bucket = {
      key, gx, gz, count: 0, start: 0, write: 0,
      minX: Infinity, minY: Infinity, minZ: Infinity,
      maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
    };
    buckets.set(key, bucket);
    return bucket;
  }

  function expandBounds(bucket, x, y, z) {
    if (x < bucket.minX) bucket.minX = x;
    if (x > bucket.maxX) bucket.maxX = x;
    if (y < bucket.minY) bucket.minY = y;
    if (y > bucket.maxY) bucket.maxY = y;
    if (z < bucket.minZ) bucket.minZ = z;
    if (z > bucket.maxZ) bucket.maxZ = z;
  }

  function spatialPlan(geometry) {
    const position = geometry.attributes.position;
    const sourceIndex = geometry.index || null;
    const read = makePositionReader(position);
    const elementCount = Math.floor((sourceIndex?.count ?? position.count) / 3) * 3;
    const buckets = new Map();

    for (let i = 0; i < elementCount; i += 3) {
      const ia = sourceIndexAt(sourceIndex, i);
      const ib = sourceIndexAt(sourceIndex, i + 1);
      const ic = sourceIndexAt(sourceIndex, i + 2);
      const a = read(ia), b = read(ib), c = read(ic);
      const cx = (a[0] + b[0] + c[0]) / 3;
      const cz = (a[2] + b[2] + c[2]) / 3;
      const bucket = getOrCreateBucket(buckets, Math.floor(cx / CHUNK_WORLD), Math.floor(cz / CHUNK_WORLD));
      bucket.count += 3;
      expandBounds(bucket, a[0], a[1], a[2]);
      expandBounds(bucket, b[0], b[1], b[2]);
      expandBounds(bucket, c[0], c[1], c[2]);
    }

    if (buckets.size < 2 || buckets.size > MAX_SPATIAL_BUCKETS) return null;
    const orderedBuckets = [...buckets.values()].sort((a, b) => (a.gz - b.gz) || (a.gx - b.gx));
    let cursor = 0;
    for (const bucket of orderedBuckets) {
      bucket.start = cursor;
      bucket.write = cursor;
      cursor += bucket.count;
    }

    const SourceArray = sourceIndex?.array?.constructor
      || (position.count > 65535 ? Uint32Array : Uint16Array);
    const reordered = new SourceArray(elementCount);

    for (let i = 0; i < elementCount; i += 3) {
      const ia = sourceIndexAt(sourceIndex, i);
      const ib = sourceIndexAt(sourceIndex, i + 1);
      const ic = sourceIndexAt(sourceIndex, i + 2);
      const a = read(ia), b = read(ib), c = read(ic);
      const cx = (a[0] + b[0] + c[0]) / 3;
      const cz = (a[2] + b[2] + c[2]) / 3;
      const bucket = buckets.get(bucketKey(Math.floor(cx / CHUNK_WORLD), Math.floor(cz / CHUNK_WORLD)));
      let w = bucket.write;
      reordered[w++] = ia;
      reordered[w++] = ib;
      reordered[w++] = ic;
      bucket.write = w;
    }

    return { buckets: orderedBuckets, reordered, sourceIndex };
  }

  function boundsForBucket(bucket) {
    const box = new THREE.Box3(
      new THREE.Vector3(bucket.minX, bucket.minY, bucket.minZ),
      new THREE.Vector3(bucket.maxX, bucket.maxY, bucket.maxZ),
    );
    const center = new THREE.Vector3();
    box.getCenter(center);
    const dx = bucket.maxX - bucket.minX;
    const dy = bucket.maxY - bucket.minY;
    const dz = bucket.maxZ - bucket.minZ;
    return { box, sphere: new THREE.Sphere(center, 0.5 * Math.sqrt(dx * dx + dy * dy + dz * dz)) };
  }

  function wrapperGeometry(source, sharedIndex, bucket, reuseSource) {
    const geometry = reuseSource ? source : new THREE.BufferGeometry();
    if (!reuseSource) {
      for (const [name, attribute] of Object.entries(source.attributes || {})) geometry.setAttribute(name, attribute);
      for (const [name, attribute] of Object.entries(source.morphAttributes || {})) geometry.morphAttributes[name] = attribute;
      geometry.morphTargetsRelative = !!source.morphTargetsRelative;
    }
    geometry.setIndex(sharedIndex);
    geometry.setDrawRange(bucket.start, bucket.count);
    const bounds = boundsForBucket(bucket);
    geometry.boundingBox = bounds.box;
    geometry.boundingSphere = bounds.sphere;
    return geometry;
  }

  function makeChunkMesh(sourceMesh, geometry, bucket, index) {
    const chunk = new THREE.Mesh(geometry, sourceMesh.material);
    chunk.name = `${sourceMesh.name || 'zone_floor'}__spatial_chunk_${bucket.gx}_${bucket.gz}`;
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
      terrainRenderChunkCellX: bucket.gx,
      terrainRenderChunkCellZ: bucket.gz,
    });
    return chunk;
  }

  function chunkMesh(mesh) {
    const sourceGeometry = mesh.geometry;
    const totalTriangles = triangleCount(sourceGeometry);
    const plan = spatialPlan(sourceGeometry);
    if (!plan) return 0;

    let sharedIndex;
    if (plan.sourceIndex) {
      plan.sourceIndex.array.set(plan.reordered);
      plan.sourceIndex.needsUpdate = true;
      sharedIndex = plan.sourceIndex;
    } else {
      sharedIndex = new THREE.BufferAttribute(plan.reordered, 1);
    }

    const chunks = [];
    for (let i = 0; i < plan.buckets.length; i++) {
      const bucket = plan.buckets[i];
      const geometry = wrapperGeometry(sourceGeometry, sharedIndex, bucket, i === 0);
      chunks.push(makeChunkMesh(mesh, geometry, bucket, i));
    }

    mesh.geometry = new THREE.BufferGeometry();
    mesh.userData = Object.assign({}, mesh.userData, {
      terrainRenderChunkSource: true,
      terrainRenderChunkCount: chunks.length,
      terrainRenderChunkTriangles: totalTriangles,
      terrainRenderChunkWorldSize: CHUNK_WORLD,
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
      const message = `[terrain-perf] spatial split ${sources} whole-zone seam mesh(es), ${compactNumber(tris)} tri into ${made} real ${CHUNK_TILES}x${CHUNK_TILES}-tile cell(s)`;
      if (typeof window.__farmLog === 'function') window.__farmLog(message, 'render');
      else console.debug(message);
    }
    return made;
  }

  function wrappedRender(scene, camera) {
    scanScene(scene);
    return originalRender.call(this, scene, camera);
  }

  const api = {
    installed: true,
    scanScene,
    snapshot() {
      return {
        sourceMeshesChunked,
        chunksCreated,
        sourceTrianglesChunked,
        chunkTiles: CHUNK_TILES,
        chunkWorldSize: CHUNK_WORLD,
      };
    },
  };

  wrappedRender.__hobunjiTerrainChunkWrapped = true;
  wrappedRender.__hobunjiTerrainChunkOriginal = originalRender;
  wrappedRender.__hobunjiTerrainChunkApi = api;
  rendererProto.render = wrappedRender;
  window.TerrainRenderChunks = api;
})();