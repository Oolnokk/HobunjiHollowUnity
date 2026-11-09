(() => {
  'use strict';

  // Raycast-only chunk proxies for huge single-mesh interior shells.
  //
  // A procedural mine/den cavern is one ~47k-triangle mesh tagged as a
  // camera obstacle. three r128's Mesh.raycast tests EVERY triangle of a
  // mesh whose bounding sphere the (infinite) ray touches, and an interior
  // ray always starts inside the cave's sphere. The shoulder camera's
  // 16-spoke clearance ring re-casts on most frames while the player walks,
  // so the mine spent ~2.8s of every 16s of JS on triangle tests.
  //
  // replaceLargeMeshes() swaps such a mesh, in the camera's obstacle list
  // only, for invisible proxies holding its triangles split into XZ chunks.
  // Each proxy skips itself when its world bounding sphere lies beyond
  // raycaster.far, so a short boom/clearance ray only tests nearby
  // triangles. Hit distances are identical: the same triangles, same world
  // matrix, same face side. The rendered mesh is untouched.
  const MIN_TRIANGLES = 4000; // Ordinary walls/furniture stay as-is.
  const CHUNK_SIZE = 6; // Local X/Z units per chunk (tiles for caverns).

  function triangleCount(geometry) {
    const position = geometry?.attributes?.position;
    if (!position) return 0;
    return Math.floor((geometry.index ? geometry.index.count : position.count) / 3);
  }

  // Triangle ranges to keep, each with the material whose face side three
  // uses for it: a multi-material mesh only raycasts triangles inside its
  // groups, each with that group's material.
  function triangleRanges(mesh) {
    const triangles = triangleCount(mesh.geometry);
    if (!Array.isArray(mesh.material)) return [{ start: 0, end: triangles, material: mesh.material }];
    return (mesh.geometry.groups || []).map(group => ({
      start: Math.floor(group.start / 3),
      end: Math.min(triangles, Math.floor((group.start + group.count) / 3)),
      material: mesh.material[group.materialIndex],
    })).filter(range => range.material && range.end > range.start);
  }

  function chunkedProxies(THREE, mesh) {
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    const index = geometry.index;
    const buckets = new Map(); // "material|cx,cz" -> { material, soup: flat xyz triangle soup }
    const vertex = i => (index ? index.getX(i) : i);
    for (const range of triangleRanges(mesh)) {
      const materialId = range.material.uuid || range.material.id;
      for (let t = range.start; t < range.end; t++) {
        const a = vertex(t * 3), b = vertex(t * 3 + 1), c = vertex(t * 3 + 2);
        const cx = (position.getX(a) + position.getX(b) + position.getX(c)) / 3;
        const cz = (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3;
        const key = materialId + '|' + Math.floor(cx / CHUNK_SIZE) + ',' + Math.floor(cz / CHUNK_SIZE);
        let bucket = buckets.get(key);
        if (!bucket) buckets.set(key, bucket = { material: range.material, soup: [] });
        for (const v of [a, b, c]) bucket.soup.push(position.getX(v), position.getY(v), position.getZ(v));
      }
    }
    mesh.updateWorldMatrix?.(true, false);
    const proxies = [];
    for (const { material, soup } of buckets.values()) {
      const chunkGeometry = new THREE.BufferGeometry();
      chunkGeometry.setAttribute('position', new THREE.Float32BufferAttribute(soup, 3));
      chunkGeometry.computeBoundingSphere();
      chunkGeometry.computeBoundingBox();
      const proxy = new THREE.Mesh(chunkGeometry, material); // Shared source material: raycast reads only its face side; never rendered.
      proxy.name = (mesh.name || 'occluder') + '_camera_chunk';
      proxy.visible = false;
      proxy.matrixAutoUpdate = false;
      proxy.matrixWorld.copy(mesh.matrixWorld);
      proxy.userData.cameraObstacle = true;
      proxy.userData.cameraObstacleSource = mesh;
      const worldSphere = chunkGeometry.boundingSphere.clone().applyMatrix4(mesh.matrixWorld);
      proxy.raycast = function chunkRaycast(raycaster, intersects) {
        if (raycaster.ray.origin.distanceTo(worldSphere.center) - worldSphere.radius > raycaster.far) return;
        THREE.Mesh.prototype.raycast.call(this, raycaster, intersects);
      };
      proxies.push(proxy);
    }
    return proxies;
  }

  // Returns a new obstacle list; meshes under MIN_TRIANGLES, groups and
  // skinned meshes pass through unchanged.
  function replaceLargeMeshes(THREE, meshes) {
    const out = [];
    for (const mesh of meshes || []) {
      if (mesh?.isMesh && !mesh.isSkinnedMesh && !mesh.isInstancedMesh && triangleCount(mesh.geometry) >= MIN_TRIANGLES) {
        out.push(...chunkedProxies(THREE, mesh));
      } else out.push(mesh);
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // Bounded-ray accelerator for heavy meshes anywhere in an obstacle list.
  //
  // replaceLargeMeshes() only helps meshes the caller hands it directly, at
  // one registration point. Generated root meshes (FoliageGenerator "Surface
  // roots", LiveRootMechanisms in rooted ruins) are tens of thousands of
  // triangles each, reach the camera obstacle list through groups or are
  // appended after the scene was registered, and a camera ray starting
  // inside their bounding sphere made three test every triangle, every
  // frame (raycast + intersectTriangle were ~55% of a rooted-ruin profile).
  //
  // This wraps Mesh.prototype.raycast the same way sprite-raycast-guard.js
  // wraps Sprite.raycast. For a heavy mesh hit by a BOUNDED ray (far is
  // finite: camera booms, clearance spokes) it tests the mesh as spatial
  // chunks instead, calling three's own Mesh.raycast on each chunk that can
  // be reached. Chunks are index subsets that SHARE the source geometry's
  // attributes, so face vertex ids, normals and UVs are the real ones, and
  // hit.object / hit.faceIndex are remapped to the source mesh. The current
  // matrixWorld is read on every call, so moving meshes stay exact. Anything
  // unusual (skinned, instanced, morph targets, custom draw range, geometry
  // that keeps changing) falls back to three's untouched raycast, as do
  // unbounded picking rays (far = Infinity), so editors/pickers are unchanged.
  const ACCEL_MIN_TRIANGLES = 2000;
  const ACCEL_TARGET_TRIANGLES_PER_CHUNK = 400;
  const ACCEL_MAX_GRID = 14; // Cells per axis.
  const ACCEL_MAX_BOUNDED_FAR = 1e5; // At or beyond this a ray behaves like a picking ray.
  const ACCEL_MAX_REBUILDS = 3; // A geometry rewritten more often than this is animated: stop chunking it...
  const ACCEL_RETRY_AFTER_MS = 3000; // ...until it has been left alone this long (a door that finished opening is static again).
  const ACCEL_BUILD_BUDGET_MS = 4; // Chunk building spends at most this much per window; until a mesh's chunks exist its rays use three's exact path.
  const ACCEL_BUILD_SLICE_MS = 1; // One advance of a chunk build runs at most about this long.
  const ACCEL_BUILD_WINDOW_MS = 100;

  function installBoundedRayAccelerator(THREE) {
    const proto = THREE?.Mesh?.prototype;
    const original = proto?.raycast;
    if (typeof original !== 'function') return null;
    if (original.__hobunjiBoundedRayAccel) return original.__hobunjiBoundedRayAccel;

    const INFO = Symbol('boundedRayAccelerator'); // Per-geometry state lives on the geometry itself: one property read on the hot path, freed with it.
    const scratch = new THREE.Mesh(new THREE.BufferGeometry(), undefined); // Stand-in whose geometry/material/matrixWorld are set per chunk.
    const sphere = new THREE.Sphere();
    const stats = { enabled: true, meshesChunked: 0, chunkedCalls: 0, rebuilds: 0, disabledGeometries: 0, buildMs: 0 };
    let windowStart = -Infinity, windowSpent = 0;
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

    function groupsKey(mesh) {
      return (mesh.geometry.groups || []).map(g => g.start + ':' + g.count + ':' + g.materialIndex).join('|');
    }

    // Everything the chunks were derived from; any change means "rebuild".
    function validFor(info, mesh) {
      const geometry = mesh.geometry, position = geometry.attributes.position, index = geometry.index, range = geometry.drawRange;
      if (info.position !== position || info.positionVersion !== position.version || info.positionCount !== position.count) return false;
      if (info.index !== (index || null)) return false;
      if (index && (info.indexVersion !== index.version || info.indexCount !== index.count)) return false;
      if (info.material !== mesh.material) return false;
      if (info.drawStart !== range.start || info.drawCount !== range.count) return false;
      if (Array.isArray(mesh.material) && info.groupsKey !== groupsKey(mesh)) return false;
      return true;
    }

    function snapshot(mesh) {
      const geometry = mesh.geometry, position = geometry.attributes.position, index = geometry.index;
      return {
        position, positionVersion: position.version, positionCount: position.count,
        index: index || null, indexVersion: index ? index.version : 0, indexCount: index ? index.count : 0,
        material: mesh.material, groupsKey: Array.isArray(mesh.material) ? groupsKey(mesh) : '',
        drawStart: geometry.drawRange.start, drawCount: geometry.drawRange.count,
        rebuilds: 0, small: false, disabled: false, disabledAt: 0, chunks: null, building: null,
        matrixKey: new Float64Array(16), matrixKeyValid: false,
      };
    }

    // Plain float positions in a flat array (what every generated mesh uses).
    function supportedLayout(geometry) {
      const position = geometry.attributes.position;
      return position.isBufferAttribute === true && position.itemSize === 3 && !position.normalized && !position.isInterleavedBufferAttribute
        && (!geometry.index || ArrayBuffer.isView(geometry.index.array));
    }

    function eligible(mesh) {
      const geometry = mesh.geometry;
      if (!geometry?.isBufferGeometry || !geometry.attributes?.position || mesh.material === undefined) return false;
      if (mesh.isSkinnedMesh || mesh.isInstancedMesh) return false;
      if (geometry.morphAttributes?.position?.length) return false;
      return drawAligned(geometry);
    }

    // three raycasts only geometry.drawRange (intersected with material groups).
    // Root growth reveals meshes with setDrawRange(0, n), so honor it instead
    // of refusing; refuse only a range that is not triangle-aligned (three's
    // loop would then read odd triples).
    function drawAligned(geometry) {
      const range = geometry.drawRange;
      if (range.start % 3 !== 0) return false;
      const entries = geometry.index ? geometry.index.count : geometry.attributes.position.count;
      const end = Math.min(entries, range.start + range.count);
      return end === entries || end % 3 === 0;
    }

    function drawWindow(geometry) {
      const entries = geometry.index ? geometry.index.count : geometry.attributes.position.count;
      const range = geometry.drawRange;
      const end = Math.min(entries, range.start + range.count);
      return { start: Math.max(0, range.start) / 3, end: Math.min(triangleCount(geometry), Math.floor(end / 3)) };
    }

    // Typed-array build: centroid pass, counting-sort binning, one gather per
    // chunk. About 0.15us per triangle warm (a 43k-triangle root mesh is a few
    // ms) but tens of ms while the JIT is cold, so it is a generator that yields
    // every few thousand triangles and is advanced in ~1ms slices (advanceBuild).
    function* buildChunks(mesh) {
      const geometry = mesh.geometry, positions = geometry.attributes.position.array, indexArray = geometry.index ? geometry.index.array : null;
      const limits = drawWindow(geometry);
      const arrayMaterial = Array.isArray(mesh.material);
      const ranges = triangleRanges(mesh).map(range => ({
        ...range, start: Math.max(range.start, limits.start), end: Math.min(range.end, limits.end),
      })).filter(range => range.end > range.start); // Same window three's raycast loops over.
      let total = 0;
      for (const range of ranges) total += range.end - range.start;
      if (total === 0) return [];
      const triId = new Uint32Array(total), slot = new Uint8Array(total), centroid = new Float32Array(total * 3);
      const slotMaterials = []; // slot -> { material, materialIndex }
      let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      let n = 0;
      for (const range of ranges) {
        const materialIndex = arrayMaterial ? mesh.material.indexOf(range.material) : -1;
        let materialSlot = slotMaterials.findIndex(entry => entry.materialIndex === materialIndex);
        if (materialSlot < 0) { materialSlot = slotMaterials.length; slotMaterials.push({ material: range.material, materialIndex }); }
        for (let t = range.start; t < range.end; t++, n++) {
          if ((n & 4095) === 4095) yield;
          const i = t * 3;
          const a = (indexArray ? indexArray[i] : i) * 3, b = (indexArray ? indexArray[i + 1] : i + 1) * 3, c = (indexArray ? indexArray[i + 2] : i + 2) * 3;
          const cx = (positions[a] + positions[b] + positions[c]) / 3;
          const cy = (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3;
          const cz = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3;
          triId[n] = t; slot[n] = materialSlot;
          centroid[n * 3] = cx; centroid[n * 3 + 1] = cy; centroid[n * 3 + 2] = cz;
          if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
          if (cz < minZ) minZ = cz; if (cz > maxZ) maxZ = cz;
        }
      }
      const cellsWanted = Math.max(1, Math.round(total / ACCEL_TARGET_TRIANGLES_PER_CHUNK));
      const spanX = Math.max(1e-6, maxX - minX), spanY = Math.max(1e-6, maxY - minY), spanZ = Math.max(1e-6, maxZ - minZ);
      const edge = Math.cbrt(spanX * spanY * spanZ / cellsWanted) || Math.max(spanX, spanY, spanZ);
      const gx = Math.min(ACCEL_MAX_GRID, Math.max(1, Math.ceil(spanX / Math.max(edge, spanX / ACCEL_MAX_GRID))));
      const gy = Math.min(ACCEL_MAX_GRID, Math.max(1, Math.ceil(spanY / Math.max(edge, spanY / ACCEL_MAX_GRID))));
      const gz = Math.min(ACCEL_MAX_GRID, Math.max(1, Math.ceil(spanZ / Math.max(edge, spanZ / ACCEL_MAX_GRID))));
      const cells = gx * gy * gz, buckets = cells * slotMaterials.length;
      const bucketOf = new Int32Array(total), counts = new Int32Array(buckets + 1);
      for (let k = 0; k < total; k++) {
        if ((k & 8191) === 8191) yield;
        const cx = Math.min(gx - 1, Math.max(0, Math.floor((centroid[k * 3] - minX) / spanX * gx)));
        const cy = Math.min(gy - 1, Math.max(0, Math.floor((centroid[k * 3 + 1] - minY) / spanY * gy)));
        const cz = Math.min(gz - 1, Math.max(0, Math.floor((centroid[k * 3 + 2] - minZ) / spanZ * gz)));
        const bucket = slot[k] * cells + cx + gx * (cy + gy * cz);
        bucketOf[k] = bucket; counts[bucket + 1]++;
      }
      for (let k = 0; k < buckets; k++) counts[k + 1] += counts[k]; // counts[k] = first slot of bucket k.
      const order = new Int32Array(total), cursor = counts.slice(0, buckets);
      for (let k = 0; k < total; k++) {
        if ((k & 16383) === 16383) yield;
        order[cursor[bucketOf[k]]++] = k;
      }

      const position = geometry.attributes.position;
      const chunks = [];
      for (let bucket = 0; bucket < buckets; bucket++) {
        const from = counts[bucket], to = counts[bucket + 1], count = to - from;
        if (count === 0) continue;
        if ((chunks.length & 7) === 7) yield;
        const indices = new Uint32Array(count * 3), ids = new Uint32Array(count);
        let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
        for (let m = 0; m < count; m++) {
          const k = order[from + m], t = triId[k], i = t * 3;
          ids[m] = t;
          for (let corner = 0; corner < 3; corner++) {
            const v = indexArray ? indexArray[i + corner] : i + corner;
            indices[m * 3 + corner] = v;
            const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
            if (z < z0) z0 = z; if (z > z1) z1 = z;
          }
        }
        const cxm = (x0 + x1) / 2, cym = (y0 + y1) / 2, czm = (z0 + z1) / 2;
        let radiusSq = 0;
        for (let m = 0; m < indices.length; m++) {
          const v = indices[m] * 3, dx = positions[v] - cxm, dy = positions[v + 1] - cym, dz = positions[v + 2] - czm;
          const d = dx * dx + dy * dy + dz * dz;
          if (d > radiusSq) radiusSq = d;
        }
        const chunkGeometry = new THREE.BufferGeometry();
        chunkGeometry.setAttribute('position', position); // Shared, never copied: ids/normals/uv stay the source's.
        if (geometry.attributes.uv) chunkGeometry.setAttribute('uv', geometry.attributes.uv);
        chunkGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
        chunkGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(cxm, cym, czm), Math.sqrt(radiusSq));
        chunkGeometry.boundingBox = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)); // Subset box; three would otherwise lazily use the whole mesh.
        const entry = slotMaterials[Math.floor(bucket / cells)];
        chunks.push({ geometry: chunkGeometry, material: entry.material, materialIndex: entry.materialIndex, triIds: ids, sphere: chunkGeometry.boundingSphere, world: null });
      }
      return chunks;
    }

    function infoFor(mesh) {
      const geometry = mesh.geometry;
      const info = geometry[INFO];
      if (info !== undefined) {
        if (info.disabled) {
          if (now() - info.disabledAt < ACCEL_RETRY_AFTER_MS) return null; // Still animating: exact three path.
          info.disabled = false; info.rebuilds = 0; // Settled: fall through and rebuild once.
        } else if (validFor(info, mesh)) {
          if (info.small) return null;
          return info.chunks !== null ? info : advanceBuild(info);
        }
      }
      if (triangleCount(geometry) < ACCEL_MIN_TRIANGLES || !supportedLayout(geometry)) { const fresh = snapshot(mesh); fresh.small = true; geometry[INFO] = fresh; return null; }
      let rebuilds = 0;
      if (info !== undefined && !info.small) {
        rebuilds = info.rebuilds + 1; stats.rebuilds++;
        if (rebuilds > ACCEL_MAX_REBUILDS) { info.disabled = true; info.disabledAt = now(); info.chunks = null; info.building = null; stats.disabledGeometries++; return null; }
      }
      const fresh = snapshot(mesh);
      fresh.rebuilds = rebuilds;
      fresh.building = buildChunks(mesh); // Nothing runs until advanceBuild: the generator is lazy.
      if (info === undefined) { stats.meshesChunked++; geometry.addEventListener?.('dispose', () => { delete geometry[INFO]; }); }
      geometry[INFO] = fresh;
      return advanceBuild(fresh);
    }

    // Runs the resumable build for at most ~ACCEL_BUILD_SLICE_MS per call and
    // ACCEL_BUILD_BUDGET_MS per window; until it finishes callers use three's
    // exact path (null), so a half-built mesh can never change a result.
    function advanceBuild(info) {
      const t0 = now();
      if (t0 - windowStart > ACCEL_BUILD_WINDOW_MS) { windowStart = t0; windowSpent = 0; }
      if (windowSpent >= ACCEL_BUILD_BUDGET_MS) return null;
      for (;;) {
        const step = info.building.next();
        if (step.done) { info.chunks = step.value; info.building = null; break; }
        if (now() - t0 >= ACCEL_BUILD_SLICE_MS) break;
      }
      const spent = now() - t0;
      windowSpent += spent; stats.buildMs += spent;
      return info.chunks !== null ? info : null;
    }

    // World-space spheres are cached per info and refreshed only when the
    // mesh's matrixWorld changed since the last call (roots are static).
    function refreshWorldSpheres(info, mesh) {
      const elements = mesh.matrixWorld.elements, key = info.matrixKey;
      let same = info.matrixKeyValid;
      if (same) for (let i = 0; i < 16; i++) if (key[i] !== elements[i]) { same = false; break; }
      if (same) return;
      for (let i = 0; i < 16; i++) key[i] = elements[i];
      info.matrixKeyValid = true;
      for (const chunk of info.chunks) chunk.world = sphere.copy(chunk.sphere).applyMatrix4(mesh.matrixWorld).clone();
    }

    // Can the segment origin + t*direction, t in [0, far], touch this sphere?
    function segmentTouchesSphere(origin, direction, far, s) {
      const cx = s.center.x - origin.x, cy = s.center.y - origin.y, cz = s.center.z - origin.z;
      let t = cx * direction.x + cy * direction.y + cz * direction.z;
      if (t < 0) t = 0; else if (t > far) t = far;
      const dx = cx - direction.x * t, dy = cy - direction.y * t, dz = cz - direction.z * t;
      return dx * dx + dy * dy + dz * dz <= s.radius * s.radius;
    }

    function acceleratedRaycast(raycaster, intersects) {
      // Most obstacle meshes are small: recognise them with a few property reads and hand
      // straight back to three, so the patch costs nothing on the common path.
      const geometry = this.geometry;
      const known = geometry === undefined ? undefined : geometry[INFO];
      if (known !== undefined && known.small === true) {
        const position = geometry.attributes.position, index = geometry.index;
        if (known.position === position && known.positionCount === position.count && known.indexCount === (index === null ? 0 : index.count)) return original.call(this, raycaster, intersects);
      }
      if (!stats.enabled || !(raycaster.far < ACCEL_MAX_BOUNDED_FAR) || !eligible(this)) return original.call(this, raycaster, intersects);
      const origin = raycaster.ray.origin, far = raycaster.far, direction = raycaster.ray.direction;
      // Raycaster requires a unit direction; three's own sphere rejection is only exact for one, so a malformed
      // ray keeps three's untouched behavior rather than a different (chunk-sized) rejection.
      const lengthSq = direction.x * direction.x + direction.y * direction.y + direction.z * direction.z;
      if (Math.abs(lengthSq - 1) > 1e-4) return original.call(this, raycaster, intersects);
      // Whole-mesh reject first, using the same bounding sphere three uses but against the ray SEGMENT
      // [0, far]: a mesh nowhere near the boom costs one sphere test, and never triggers a chunk build.
      if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
      if (!segmentTouchesSphere(origin, direction, far, sphere.copy(geometry.boundingSphere).applyMatrix4(this.matrixWorld))) return;
      const info = infoFor(this);
      if (info === null) return original.call(this, raycaster, intersects);
      stats.chunkedCalls++;
      refreshWorldSpheres(info, this);
      scratch.matrixWorld.copy(this.matrixWorld);
      const array = Array.isArray(this.material);
      for (const chunk of info.chunks) {
        if (!segmentTouchesSphere(origin, direction, far, chunk.world)) continue;
        scratch.geometry = chunk.geometry;
        scratch.material = chunk.material;
        const before = intersects.length;
        original.call(scratch, raycaster, intersects);
        for (let i = before; i < intersects.length; i++) {
          const hit = intersects[i];
          hit.object = this;
          hit.faceIndex = chunk.triIds[hit.faceIndex];
          if (array && hit.face) hit.face.materialIndex = chunk.materialIndex;
        }
      }
    }
    // Synchronous build outside the frame budget, for loading code that wants
    // heavy meshes ready before the first camera ray and for deterministic
    // tests. Returns true once the mesh is served from chunks.
    function prepare(mesh) {
      if (!mesh?.isMesh || !eligible(mesh)) return false;
      for (let i = 0; i < 100000; i++) {
        windowStart = now(); windowSpent = 0; // Lift the per-window budget for this call only.
        if (infoFor(mesh) !== null) return true;
        const current = mesh.geometry[INFO];
        if (current === undefined || current.small || current.disabled) return false;
      }
      return false;
    }
    acceleratedRaycast.__hobunjiBoundedRayAccel = { stats, original, prepare };
    proto.raycast = acceleratedRaycast;
    return acceleratedRaycast.__hobunjiBoundedRayAccel;
  }

  const accelerator = installBoundedRayAccelerator(typeof window !== 'undefined' ? window.THREE : null);
  const setBoundedRayAcceleratorEnabled = (enabled) => { if (accelerator) accelerator.stats.enabled = !!enabled; };
  const boundedRayAcceleratorStats = () => (accelerator ? { ...accelerator.stats } : null);
  const prepareBoundedRayMesh = (mesh) => (accelerator ? accelerator.prepare(mesh) : false);

  window.CameraOcclusionChunks = Object.freeze({
    replaceLargeMeshes, MIN_TRIANGLES, CHUNK_SIZE,
    installBoundedRayAccelerator, setBoundedRayAcceleratorEnabled, boundedRayAcceleratorStats, prepareBoundedRayMesh, ACCEL_MIN_TRIANGLES,
  });
})();
