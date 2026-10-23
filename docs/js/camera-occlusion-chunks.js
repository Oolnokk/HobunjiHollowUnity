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

  window.CameraOcclusionChunks = Object.freeze({ replaceLargeMeshes, MIN_TRIANGLES, CHUNK_SIZE });
})();
