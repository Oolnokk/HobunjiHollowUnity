(() => {
  'use strict';

  const THREE = window.THREE; // Used to rebuild generated natural terrain geometry at the top/side ridge.
  const naturalApi = window.NaturalSurfaceMaterials; // Used to hook the existing proven rock/cliff texture-material pipeline after it finishes.
  const mapper = window.HobunjiSurfaceStretchUV; // Used to remap only the side region after the semantic ridge split.
  if (!THREE?.BufferGeometry || !naturalApi?.installed || !mapper?.installed || window.NaturalSurfaceCliffRidgeIsolation?.installed) return;

  // zone-plateau-mesa.js classifies a quad as cliff stone when horizontal slope² > 0.194.
  // The equivalent normalized upward-normal cutoff is 1/sqrt(1 + 0.194).
  const TOP_NORMAL_Y_MIN = 1 / Math.sqrt(1 + 0.194); // Used to stop a smooth 24° furniture flood-fill from walking over a rounded cliff ridge.
  const stats = { inspected: 0, isolated: 0, topTriangles: 0, sideTriangles: 0, remaps: 0 }; // Used by snapshot() and mobile-visible diagnostics.

  function debugLog(message, level = 'info') {
    const text = `[surface-ridge] ${message}`; // Used as the shared mobile/console diagnostic prefix.
    if (typeof window.__farmLog === 'function') window.__farmLog(text, level, 'render');
    else if (level === 'warn') console.warn(text);
    else console.debug(text);
  }

  function surfaceFor(mesh, requestedSurface = null) {
    const material = Array.isArray(mesh?.material) ? mesh.material[0] : mesh?.material; // Used to recover the natural-surface semantic before/after material duplication.
    return requestedSurface || mesh?.userData?.naturalSurface || material?.userData?.naturalSurface || null;
  }

  function isNaturalRockOrCliff(mesh, requestedSurface = null) {
    const surface = surfaceFor(mesh, requestedSurface); // Used to avoid touching furniture/buildings or unrelated textured meshes.
    return surface === 'rocks' || surface === 'cliffs';
  }

  function expandedGeometry(source) {
    if (!source?.getAttribute?.('position')) return null;
    const geometry = source.index ? source.toNonIndexed() : source.clone(); // Used so every triangle can be reordered without changing shared source vertices.
    geometry.userData = Object.assign({}, source.userData || {}, geometry.userData || {});
    return geometry;
  }

  function faceNormalY(position, base) {
    const ax = position.getX(base), ay = position.getY(base), az = position.getZ(base); // Used as triangle vertex A.
    const abx = position.getX(base + 1) - ax, aby = position.getY(base + 1) - ay, abz = position.getZ(base + 1) - az; // Used as triangle edge AB.
    const acx = position.getX(base + 2) - ax, acy = position.getY(base + 2) - ay, acz = position.getZ(base + 2) - az; // Used as triangle edge AC.
    const nx = aby * acz - abz * acy; // Used as the unnormalized face-normal X component.
    const ny = abz * acx - abx * acz; // Used as the unnormalized face-normal Y component.
    const nz = abx * acy - aby * acx; // Used as the unnormalized face-normal Z component.
    const length = Math.hypot(nx, ny, nz); // Used to normalize the face orientation before comparing it with the terrain cliff cutoff.
    return length > 1e-10 ? ny / length : 1;
  }

  function reorderedGeometry(geometry, topTriangles, sideTriangles) {
    const order = topTriangles.concat(sideTriangles); // Used to make the two semantic regions contiguous Three.js material groups.
    const next = new THREE.BufferGeometry(); // Used as the independent ridge-split geometry assigned back to the natural terrain mesh.
    for (const [name, attribute] of Object.entries(geometry.attributes || {})) {
      if (!attribute?.array || attribute.isInterleavedBufferAttribute) return null;
      const ArrayType = attribute.array.constructor; // Used to preserve Float32/Uint8/etc. storage for every existing vertex attribute.
      const array = new ArrayType(attribute.array.length); // Used as the reordered copy of this attribute.
      let writeVertex = 0; // Used to append triangle corners in top-then-side order.
      for (const triangleIndex of order) {
        const sourceBase = triangleIndex * 3; // Used as the first source vertex of this triangle.
        for (let corner = 0; corner < 3; corner++, writeVertex++) {
          const sourceVertex = sourceBase + corner; // Used as the exact source triangle corner copied to the output.
          for (let component = 0; component < attribute.itemSize; component++) {
            array[writeVertex * attribute.itemSize + component] = attribute.array[sourceVertex * attribute.itemSize + component];
          }
        }
      }
      const copied = new THREE.BufferAttribute(array, attribute.itemSize, !!attribute.normalized); // Used as the final reordered attribute on the ridge-split geometry.
      copied.name = attribute.name || '';
      next.setAttribute(name, copied);
    }

    if (topTriangles.length) next.addGroup(0, topTriangles.length * 3, 0);
    if (sideTriangles.length) next.addGroup(topTriangles.length * 3, sideTriangles.length * 3, 1);
    next.userData = Object.assign({}, geometry.userData || {}, {
      naturalSurfaceRidgeIsolated: true,
      naturalSurfaceRidgeTopNormalYMin: TOP_NORMAL_Y_MIN,
      naturalSurfaceRidgeTopTriangles: topTriangles.length,
      naturalSurfaceRidgeSideTriangles: sideTriangles.length,
    });
    delete next.userData.hobunjiSurfaceStretchSignature;
    delete next.userData.hobunjiSurfaceStretch;
    next.computeBoundingBox?.();
    next.computeBoundingSphere?.();
    return next;
  }

  function ensureMaterialPair(mesh) {
    if (!mesh) return;
    if (Array.isArray(mesh.material)) {
      if (mesh.material.length === 1) mesh.material = [mesh.material[0], mesh.material[0]];
      return;
    }
    if (mesh.material) mesh.material = [mesh.material, mesh.material];
  }

  function isolateRidge(mesh, requestedSurface = null) {
    if (!mesh?.isMesh || !mesh.geometry || !isNaturalRockOrCliff(mesh, requestedSurface)) return false;
    if (mesh.userData?.naturalSurfaceCliffSlot != null || mesh.geometry.userData?.naturalSurfaceRidgeIsolated) return false;
    stats.inspected++;

    const expanded = expandedGeometry(mesh.geometry); // Used to classify every rendered triangle independently by upward-vs-side orientation.
    const position = expanded?.getAttribute?.('position'); // Used as the triangle source for the semantic ridge classification.
    if (!position || position.count < 6 || position.count % 3 !== 0) return false;

    const topTriangles = []; // Used as upward terrain faces that must not belong to the cliff-side UV island.
    const sideTriangles = []; // Used as the cliff-facing faces whose upper perimeter should terminate exactly at the ridge.
    const triangleCount = position.count / 3; // Used to inspect every non-indexed triangle once.
    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
      const normalY = faceNormalY(position, triangleIndex * 3); // Used to apply the same steep-vs-top semantic threshold as plateau generation.
      (normalY >= TOP_NORMAL_Y_MIN ? topTriangles : sideTriangles).push(triangleIndex);
    }
    if (!topTriangles.length || !sideTriangles.length) return false;

    const next = reorderedGeometry(expanded, topTriangles, sideTriangles); // Used to turn the semantic ridge into a literal material/UV group boundary.
    if (!next) return false;
    mesh.geometry = next;
    ensureMaterialPair(mesh);
    mesh.userData = Object.assign({}, mesh.userData || {}, {
      naturalSurfaceCliffSlot: 1,
      naturalSurfaceRidgeTopSlot: 0,
      naturalSurfaceRidgeIsolated: true,
      naturalSurfaceUvOwner: 'HobunjiSurfaceStretchUV',
      terrainJigsawIgnore: true,
    });
    stats.isolated++;
    stats.topTriangles += topTriangles.length;
    stats.sideTriangles += sideTriangles.length;
    debugLog(`${mesh.name || '(unnamed)'}: separated ${topTriangles.length} upward triangle(s) from ${sideTriangles.length} cliff-side triangle(s); ridge is now the side UV perimeter.`);
    return true;
  }

  const previousRemap = mapper.remapNaturalTerrainMesh; // Used to preserve the furniture-style mapper for callers outside NaturalSurfaceMaterials.
  if (typeof previousRemap === 'function' && !previousRemap.__naturalSurfaceRidgeWrapped) {
    function wrappedRemap(mesh, label = '') {
      isolateRidge(mesh);
      const report = previousRemap.call(this, mesh, label);
      if (report && mesh?.userData?.naturalSurfaceRidgeIsolated) {
        mesh.userData.terrainJigsawIgnore = true;
        mesh.userData.naturalSurfaceUvOwner = 'HobunjiSurfaceStretchUV';
        stats.remaps++;
      }
      return report;
    }
    wrappedRemap.__naturalSurfaceRidgeWrapped = true;
    wrappedRemap.__naturalSurfaceRidgeOriginal = previousRemap;
    mapper.remapNaturalTerrainMesh = wrappedRemap;
  }

  // surface-stretch-uv-furniture.js already wrapped naturalizeMesh before this
  // adapter loads. Let that normal mapping/material pass finish, then split the
  // semantic top from the side and immediately remap only slot 1. This catches
  // older builders that call a generated cliff "rocks" and never invoke the
  // mapper's public remap function directly.
  const previousNaturalize = naturalApi.naturalizeMesh; // Used to preserve the canonical texture coloring/material path and its existing mapper wrapper.
  if (typeof previousNaturalize === 'function' && !previousNaturalize.__naturalSurfaceRidgeWrapped) {
    function wrappedNaturalize(...args) {
      const mesh = previousNaturalize.apply(this, args); // Used as the fully naturalized/mapped mesh before ridge isolation.
      const surface = args[1] || surfaceFor(mesh); // Used to preserve the caller's rock/cliff semantic even if the material was replaced.
      if (isolateRidge(mesh, surface)) {
        const report = mapper.mapMesh?.(mesh, { materialIndex: 1, label: `ridge:${mesh.name || surface || 'natural-surface'}` }); // Used to make the ridge the upper boundary of the cliff-side texture island.
        if (report) stats.remaps++;
      }
      return mesh;
    }
    wrappedNaturalize.__naturalSurfaceRidgeWrapped = true;
    wrappedNaturalize.__naturalSurfaceRidgeOriginal = previousNaturalize;
    naturalApi.naturalizeMesh = wrappedNaturalize;
  }

  window.NaturalSurfaceCliffRidgeIsolation = {
    installed: true,
    topNormalYMin: TOP_NORMAL_Y_MIN,
    isolateRidge,
    snapshot() { return Object.assign({}, stats, { topNormalYMin: TOP_NORMAL_Y_MIN }); },
  };

  debugLog(`installed: upward terrain and cliff-facing triangles split at normalY ${TOP_NORMAL_Y_MIN.toFixed(3)} before final cliff-side UV mapping.`);
})();