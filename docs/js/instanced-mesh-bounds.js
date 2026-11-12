// InstancedMeshBounds — one authority for "where are this InstancedMesh's
// instances". Three r128 bounds an InstancedMesh by its base geometry only,
// so it can neither frustum-cull one nor skip it in a scissored replay.
// Meshes tagged here (userData.hobunjiInstanceBounds) get a sphere around
// every instance, cached until the instance matrices or count change.
//
// Consumers: WallBuilder's raycast early-out, InstancedMeshViewCull (camera
// pass), HeldObjectRenderOrder's replay cull, GrassBillboardRenderChunks.
(function (root) {
  'use strict';

  const THREE = root.THREE;
  if (!THREE) { console.error('InstancedMeshBounds: window.THREE not found — load three.js first'); return; }

  const PAD = 0.5; // World units; covers brick jitter, grass sway and shader-side elevation nudges.
  const box = new THREE.Box3(), instBox = new THREE.Box3(), matrix = new THREE.Matrix4();
  const cache = new WeakMap(); // InstancedMesh -> { key, sphere } in mesh-local space.
  const tracked = []; // WeakRef<InstancedMesh> for the camera-pass cull; pruned while iterating.

  // Mesh-local sphere around every instance, or null when nothing finite.
  function localSphere(mesh) {
    const geo = mesh?.geometry;
    if (!geo || !mesh.instanceMatrix || !(mesh.count > 0)) return null;
    const key = mesh.instanceMatrix.version + ':' + mesh.count;
    let entry = cache.get(mesh);
    if (!entry || entry.key !== key) {
      if (!geo.boundingBox) geo.computeBoundingBox();
      box.makeEmpty();
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        instBox.copy(geo.boundingBox).applyMatrix4(matrix);
        // An instance with a NaN matrix can never draw or be hit, but would poison the union.
        if (Number.isFinite(instBox.min.x + instBox.min.y + instBox.min.z +
            instBox.max.x + instBox.max.y + instBox.max.z)) box.union(instBox);
      }
      entry = { key, sphere: box.isEmpty() ? null : box.getBoundingSphere(new THREE.Sphere()) };
      cache.set(mesh, entry);
    }
    return entry.sphere;
  }

  // Padded world-space sphere, only for tagged meshes (untagged instanced
  // meshes keep Three's default "never cull" behaviour everywhere).
  function worldSphere(mesh, target) {
    if (!mesh?.isInstancedMesh || mesh.userData?.hobunjiInstanceBounds !== true || !target) return null;
    const sphere = localSphere(mesh);
    if (!sphere) return null;
    target.copy(sphere).applyMatrix4(mesh.matrixWorld);
    target.radius += PAD;
    return Number.isFinite(target.radius + target.center.x + target.center.y + target.center.z) ? target : null;
  }

  // track:true also enrols the mesh in the camera-pass cull. Use track:false
  // for meshes Three already culls by authored bounds (only the replay cull
  // needs the tag) or whose instances are scattered too widely to help.
  function tag(mesh, { track = true } = {}) {
    if (!mesh?.isInstancedMesh || mesh.userData.hobunjiInstanceBounds === true) return mesh;
    mesh.userData.hobunjiInstanceBounds = true;
    if (track && typeof WeakRef === 'function') tracked.push(new WeakRef(mesh));
    return mesh;
  }

  function forEachTracked(callback) {
    let kept = 0;
    for (let i = 0; i < tracked.length; i++) {
      const ref = tracked[i], mesh = ref.deref();
      if (!mesh) continue;
      tracked[kept++] = ref;
      callback(mesh);
    }
    tracked.length = kept;
  }

  root.InstancedMeshBounds = Object.freeze({ localSphere, worldSphere, tag, forEachTracked, PAD });
})(typeof window !== 'undefined' ? window : globalThis);
