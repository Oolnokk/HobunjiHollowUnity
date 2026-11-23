// Render-time merge of the Southern Cloud Forest's dense shadewood wall.
//
// border-terrain.js instances the north wall as ~63 chunk groups
// (userData.denseForestWall), one InstancedMesh per tree part per chunk, about
// 12 per chunk. The corridor cull (zone-vegetation-cull.js) keeps ~6-9 chunks
// drawn, and they are genuinely on screen (performance-investigation-log.md,
// 20 Nov), so frustum culling cannot trim them: a headless census of a Cloud
// Forest frame found the wall was 72 of the main pass's 166 draws.
// Chunks that are not fading share their part materials, so for the world
// render only this scope draws every drawn, opaque chunk part as ONE
// InstancedMesh per (geometry, material, layers, render order, shadow flags),
// holding all of those chunks' instances, and hides the per-chunk meshes.
//
// Why this is not the tree-instancing loss (WildernessTreeInstancer, off by
// default): those batches defeated the held/x-ray replay cull and regrouped
// every frame. The wall is backgroundScenery, which the replays ignore (xray
// rule background.gearDepth), so its batches never enter a replay; and a batch
// is rebuilt only when its member set, a member's instance count or matrices,
// or a chunk transform changes (the corridor cull flips chunks a few times a
// second at most while walking).
//
// Only chunk parts on camera are merged, by the same instance-bounds test the
// camera-pass cull (instanced-mesh-view-cull.js) applies afterwards: a batch
// spanning off-camera chunks could not be trimmed by that cull, and a headless
// check with the wall partly on screen drew 8-32% more triangles to save 4-14
// draws. Off-camera parts stay as they are and that cull still hides them.
//
// Left to draw themselves: fading chunks (their transparent per-chunk material
// clones have their own opacity), material arrays, custom draw hooks, and any
// render state shared by fewer than two chunks. The chunk meshes stay the only
// authority; batches never raycast. DenseForestWallBatches.setEnabled(false)
// is the A/B switch; snapshot() reports counts.
(() => {
  'use strict';
  if (window.DenseForestWallBatches) return;

  let enabled = true;
  const records = new WeakMap(); // scene -> { holder, batches: Map<key, batch> }
  const stats = { frames: 0, sourceMeshes: 0, sourceInstances: 0, batches: 0, drawsSaved: 0, rebuilds: 0, skippedTransparent: 0, skippedOther: 0, offCamera: 0 };
  const defaultBeforeRender = window.THREE?.Object3D?.prototype?.onBeforeRender;
  let scratchMatrix = null;
  let frustum = null, viewProjection = null, sphere = null; // Created on first use.
  let lastScene = null; // Batches of a scene no longer rendered are released (zone exit, eviction).
  function noRaycast() {}

  function releaseScene(scene) {
    const record = scene && records.get(scene);
    if (!record) return;
    for (const batch of record.batches.values()) { record.holder.remove(batch.mesh); batch.mesh.dispose?.(); }
    record.batches.clear();
    record.holder.parent?.remove(record.holder);
    records.delete(scene);
  }

  function isIdentity(e) {
    return e[0] === 1 && e[1] === 0 && e[2] === 0 && e[3] === 0 && e[4] === 0 && e[5] === 1 && e[6] === 0 && e[7] === 0
      && e[8] === 0 && e[9] === 0 && e[10] === 1 && e[11] === 0 && e[12] === 0 && e[13] === 0 && e[14] === 0 && e[15] === 1;
  }

  function eligible(mesh) {
    if (!mesh?.isInstancedMesh || mesh.visible === false || !(mesh.count > 0)) return false;
    const material = mesh.material;
    if (!material || Array.isArray(material)) { stats.skippedOther++; return false; }
    if (material.transparent) { stats.skippedTransparent++; return false; } // A fading chunk: its own opacity.
    if (mesh.onBeforeRender !== defaultBeforeRender) { stats.skippedOther++; return false; }
    return true;
  }

  function keyFor(mesh) {
    return mesh.geometry.id + '|' + mesh.material.id + '|' + (mesh.layers.mask >>> 0) + '|' + mesh.renderOrder
      + '|' + (mesh.castShadow ? 1 : 0) + (mesh.receiveShadow ? 1 : 0);
  }

  // What a batch was built from: member identities, their instance counts and
  // matrix versions, and the member's world transform (chunks sit at identity).
  const SIG = 18;
  function writeSignature(out, offset, mesh) {
    out[offset] = mesh.count;
    out[offset + 1] = mesh.instanceMatrix.version;
    const e = mesh.matrixWorld.elements;
    for (let i = 0; i < 16; i++) out[offset + 2 + i] = e[i];
  }
  function isCurrent(batch, members) {
    if (!batch.mesh || batch.members.length !== members.length) return false;
    const sig = batch.signature;
    for (let m = 0; m < members.length; m++) {
      const mesh = members[m], o = m * SIG;
      if (batch.members[m] !== mesh || sig[o] !== mesh.count || sig[o + 1] !== mesh.instanceMatrix.version) return false;
      const e = mesh.matrixWorld.elements;
      for (let i = 0; i < 16; i++) if (sig[o + 2 + i] !== e[i]) return false;
    }
    return true;
  }

  function buildBatch(THREE, record, batch, members) {
    const first = members[0];
    let total = 0;
    for (const mesh of members) total += mesh.count;
    if (!batch.mesh || batch.capacity < total) {
      if (batch.mesh) { record.holder.remove(batch.mesh); batch.mesh.dispose?.(); } // Frees the old instance buffer.
      batch.mesh = new THREE.InstancedMesh(first.geometry, first.material, total);
      batch.capacity = total;
      batch.mesh.name = 'dense_forest_wall_batch';
      batch.mesh.matrixAutoUpdate = false; // Instances are world-space under an identity holder.
      batch.mesh.frustumCulled = false; // Like the chunk meshes: r128 would bound it by the base geometry only.
      batch.mesh.raycast = noRaycast; // The chunk meshes stay the only authority.
      record.holder.add(batch.mesh);
    }
    const mesh = batch.mesh;
    const out = mesh.instanceMatrix.array;
    let offset = 0;
    for (const member of members) {
      const src = member.instanceMatrix.array, n = member.count * 16;
      if (isIdentity(member.matrixWorld.elements)) out.set(src.subarray(0, n), offset);
      else {
        if (!scratchMatrix) scratchMatrix = new THREE.Matrix4();
        for (let i = 0; i < member.count; i++) {
          scratchMatrix.fromArray(src, i * 16).premultiply(member.matrixWorld);
          scratchMatrix.toArray(out, offset + i * 16);
        }
      }
      offset += n;
    }
    mesh.count = total;
    mesh.instanceMatrix.needsUpdate = true; // Also invalidates InstancedMeshBounds' cached sphere.
    mesh.material = first.material;
    mesh.layers.mask = first.layers.mask;
    mesh.renderOrder = first.renderOrder;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    // backgroundScenery keeps the batch out of the held/x-ray depth replays exactly like its chunks.
    mesh.userData = { ...first.userData, hobunjiRenderProxy: true, denseForestWallBatch: true };
    delete mesh.userData.hobunjiInstanceBounds; // Re-tagged below so the camera-pass cull tracks this mesh.
    window.InstancedMeshBounds?.tag?.(mesh);
    batch.members = members.slice();
    batch.signature = new Float64Array(members.length * SIG);
    members.forEach((member, i) => writeSignature(batch.signature, i * SIG, member));
    stats.rebuilds++;
  }

  function recordFor(scene) {
    let record = records.get(scene);
    if (!record) {
      const holder = new window.THREE.Group();
      holder.name = 'dense_forest_wall_batches';
      holder.visible = false; // Shown only inside the world render.
      holder.matrixAutoUpdate = false;
      holder.userData.backgroundScenery = true;
      record = { holder, batches: new Map() };
      records.set(scene, record);
    }
    if (record.holder.parent !== scene) scene.add(record.holder);
    return record;
  }

  // Returns a restore function, or null when nothing was swapped.
  function onCamera(mesh) {
    const world = window.InstancedMeshBounds?.worldSphere?.(mesh, sphere);
    return !world || frustum.intersectsSphere(world); // Unbounded: the camera cull would keep it drawn too.
  }

  function suspendForRender(scene, { isZone = false, camera = null } = {}) {
    if (scene !== lastScene) { releaseScene(lastScene); lastScene = scene || null; }
    if (!enabled || !isZone || !scene?.isScene || !window.THREE || !camera?.isCamera) { releaseScene(scene); return null; }
    stats.sourceMeshes = stats.sourceInstances = stats.drawsSaved = stats.skippedTransparent = stats.skippedOther = stats.offCamera = 0;
    if (!frustum) { frustum = new window.THREE.Frustum(); viewProjection = new window.THREE.Matrix4(); sphere = new window.THREE.Sphere(); }
    camera.updateMatrixWorld?.(true);
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
    const groups = new Map();
    let any = false;
    for (const chunk of scene.children) {
      if (chunk.userData?.denseForestWall !== true || chunk.visible === false) continue;
      any = true;
      for (const mesh of chunk.children) {
        if (!eligible(mesh)) continue;
        if (!onCamera(mesh)) { stats.offCamera++; continue; }
        const key = keyFor(mesh);
        let list = groups.get(key);
        if (!list) groups.set(key, list = []);
        list.push(mesh);
      }
    }
    const record = any || records.has(scene) ? recordFor(scene) : null;
    if (!record) return null;
    stats.frames++;
    for (const [key, batch] of record.batches) {
      if ((groups.get(key)?.length || 0) >= 2) continue;
      record.holder.remove(batch.mesh); // Geometry and material belong to the chunks.
      batch.mesh.dispose?.();
      record.batches.delete(key);
    }
    const THREE = window.THREE;
    const hidden = [];
    for (const [key, members] of groups) {
      if (members.length < 2) continue; // One chunk gains nothing from a copy.
      let batch = record.batches.get(key);
      if (!batch) { batch = { mesh: null, capacity: 0, members: [], signature: null }; record.batches.set(key, batch); }
      if (!isCurrent(batch, members)) buildBatch(THREE, record, batch, members);
      batch.mesh.visible = true;
      for (const member of members) {
        member.visible = false;
        hidden.push(member);
        stats.sourceInstances += member.count;
      }
      stats.drawsSaved += members.length - 1;
    }
    stats.sourceMeshes = hidden.length;
    stats.batches = record.batches.size;
    if (!hidden.length) return null;
    record.holder.visible = true;
    return function restoreDenseForestWallBatches() {
      for (let i = 0; i < hidden.length; i++) hidden[i].visible = true;
      record.holder.visible = false;
    };
  }

  function setEnabled(value) {
    enabled = value !== false;
    if (!enabled) releaseScene(lastScene);
    return enabled;
  }

  window.DenseForestWallBatches = Object.freeze({
    suspendForRender,
    setEnabled,
    snapshot: () => ({ enabled, ...stats }),
  });
})();
