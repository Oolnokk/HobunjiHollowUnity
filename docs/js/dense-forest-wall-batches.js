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
//
// Distance LOD (same scope, render-only). Each wall tree whose base is at
// least lodDistance from the camera draws its roots, branches and vines (the
// trunk is unchanged) with the lighter twin of the SAME shared tree variant
// (FoliageGenerator.liteTreeGeometry: identical spines, so every branch tip,
// root, vine wrap and leaf card stays where it was; only the tubes have fewer
// rings and sides). Trees are classified one by one, not per chunk: a 10x6
// chunk spans near and far trees, and at the spawn view every drawn chunk had
// a tree within 16 tiles. The tree's own instance matrix, the chunk's instance
// count (after the quarter-density pass), material, layers (shell outline) and
// leaf cards are used unchanged. A tree must come LOD_HYSTERESIS closer than
// lodDistance to switch back, so walking along the boundary does not flicker
// or rebuild every frame. A full shadewood is ~4,200 triangles, its far twin
// ~1,660. A fading chunk's parts (their own transparent material clone) are
// never merged with other chunks: a part whose trees are all far simply draws
// itself with the twin for this render (no extra draw); a part straddling the
// boundary splits into a near and a far batch with that same material. The
// chunk meshes keep the full geometry for every gameplay purpose.
// setLodEnabled(false) / setLodDistance(n) are the A/B switches; snapshot()
// reports the split.
(() => {
  'use strict';
  if (window.DenseForestWallBatches) return;

  let enabled = true;
  let lodEnabled = true;
  // World units (≈ tiles) from the camera to a tree's base. A wall shadewood is
  // ~11 units tall; past this range the coarser roots, branches and vines were
  // indistinguishable from full detail in 1280x720 headless comparisons
  // (performance-investigation-log.md, 24 Nov), while 8 tiles showed changes.
  let lodDistance = 12;
  const LOD_HYSTERESIS = 1.5;
  const records = new WeakMap(); // scene -> { holder, batches: Map<key, batch> }
  const farFlags = new WeakMap(); // chunk part -> Uint8Array, 1 = that instance is far (kept for hysteresis)
  const stats = { frames: 0, sourceMeshes: 0, sourceInstances: 0, batches: 0, drawsSaved: 0, rebuilds: 0, skippedTransparent: 0, skippedOther: 0, offCamera: 0,
    lodFarTrees: 0, lodNearTrees: 0, lodLiteParts: 0, lodOmittedParts: 0, lodTrianglesAvoided: 0, lodSwappedInPlace: 0, allocations: 0 };
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

  // 'merge': may share a batch with other chunks' parts. 'own': a fading
  // chunk's part (its transparent per-chunk material clone has its own
  // opacity), never merged, but its far trees can still use the lite twin in
  // a batch of its own. false: drawn as it is.
  function eligible(mesh) {
    if (!mesh?.isInstancedMesh || mesh.visible === false || !(mesh.count > 0)) return false;
    const material = mesh.material;
    if (!material || Array.isArray(material)) { stats.skippedOther++; return false; }
    if (mesh.onBeforeRender !== defaultBeforeRender) { stats.skippedOther++; return false; }
    if (material.transparent) { stats.skippedTransparent++; return 'own'; }
    return 'merge';
  }

  function keyFor(mesh, geometry, own) {
    return geometry.id + '|' + mesh.material.id + '|' + (mesh.layers.mask >>> 0) + '|' + mesh.renderOrder
      + '|' + (mesh.castShadow ? 1 : 0) + (mesh.receiveShadow ? 1 : 0) + (own ? '|own' + mesh.id : '');
  }

  // A group's members: chunk parts, each with the instances it contributes.
  // sel null = all of them; otherwise { flags, want, n }: the n instances whose
  // far flag equals want (0 = near, full geometry; 1 = far, lite twin).
  function addMember(groups, mesh, geometry, sel, own = false) {
    const key = keyFor(mesh, geometry, own);
    let group = groups.get(key);
    if (!group) groups.set(key, group = { geometry, meshes: [], sels: [], subset: false });
    group.meshes.push(mesh);
    group.sels.push(sel);
    if (sel) group.subset = true;
  }
  // A lone full-detail chunk part gains nothing from a copy of itself; a
  // subset or a lite twin must be drawn by a batch.
  function drawsAsBatch(group) {
    return !!group && (group.meshes.length >= 2 || group.subset || group.geometry !== group.meshes[0].geometry);
  }

  // What a batch was built from: member identities, their instance counts and
  // matrix versions, the member's world transform (chunks sit at identity) and
  // which of its instances it took.
  const SIG = 19;
  function writeSignature(out, offset, mesh, sel) {
    out[offset] = mesh.count;
    out[offset + 1] = mesh.instanceMatrix.version;
    const e = mesh.matrixWorld.elements;
    for (let i = 0; i < 16; i++) out[offset + 2 + i] = e[i];
    out[offset + 18] = sel ? sel.want : -1;
  }
  function sameFlags(a, b, count) {
    if (!a || !b) return a === b;
    for (let i = 0; i < count; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function isCurrent(batch, group) {
    const { meshes, sels, geometry } = group;
    if (!batch.mesh || batch.members.length !== meshes.length || batch.mesh.geometry !== geometry) return false;
    const sig = batch.signature;
    for (let m = 0; m < meshes.length; m++) {
      const mesh = meshes[m], o = m * SIG, sel = sels[m];
      if (batch.members[m] !== mesh || sig[o] !== mesh.count || sig[o + 1] !== mesh.instanceMatrix.version
        || sig[o + 18] !== (sel ? sel.want : -1) || !sameFlags(batch.flags[m], sel?.flags || null, mesh.count)) return false;
      const e = mesh.matrixWorld.elements;
      for (let i = 0; i < 16; i++) if (sig[o + 2 + i] !== e[i]) return false;
    }
    return true;
  }

  function buildBatch(THREE, record, batch, group) {
    const { meshes, sels, geometry } = group;
    const first = meshes[0];
    let total = 0;
    for (let m = 0; m < meshes.length; m++) total += sels[m] ? sels[m].n : meshes[m].count;
    if (!batch.mesh || batch.capacity < total || batch.mesh.geometry !== geometry) {
      if (batch.mesh) { record.holder.remove(batch.mesh); batch.mesh.dispose?.(); } // Frees the old instance buffer.
      batch.mesh = new THREE.InstancedMesh(geometry, first.material, total);
      batch.capacity = total;
      stats.allocations++;
      batch.mesh.name = 'dense_forest_wall_batch';
      batch.mesh.matrixAutoUpdate = false; // Instances are world-space under an identity holder.
      batch.mesh.frustumCulled = false; // Like the chunk meshes: r128 would bound it by the base geometry only.
      batch.mesh.raycast = noRaycast; // The chunk meshes stay the only authority.
      record.holder.add(batch.mesh);
    }
    const mesh = batch.mesh;
    const out = mesh.instanceMatrix.array;
    let offset = 0;
    for (let m = 0; m < meshes.length; m++) {
      const member = meshes[m], sel = sels[m];
      const src = member.instanceMatrix.array, identity = isIdentity(member.matrixWorld.elements);
      if (!sel && identity) { out.set(src.subarray(0, member.count * 16), offset); offset += member.count * 16; continue; }
      for (let i = 0; i < member.count; i++) {
        if (sel && sel.flags[i] !== sel.want) continue;
        if (identity) out.set(src.subarray(i * 16, i * 16 + 16), offset);
        else {
          if (!scratchMatrix) scratchMatrix = new THREE.Matrix4();
          scratchMatrix.fromArray(src, i * 16).premultiply(member.matrixWorld);
          scratchMatrix.toArray(out, offset);
        }
        offset += 16;
      }
    }
    mesh.count = total;
    mesh.instanceMatrix.needsUpdate = true; // Also invalidates InstancedMeshBounds' cached sphere.
    mesh.material = first.material;
    mesh.layers.mask = first.layers.mask;
    mesh.renderOrder = first.renderOrder;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    // backgroundScenery keeps the batch out of the held/x-ray depth replays exactly like its chunks.
    mesh.userData = { ...first.userData, hobunjiRenderProxy: true, denseForestWallBatch: true, denseForestWallLod: geometry === first.geometry ? 'full' : 'far' };
    delete mesh.userData.hobunjiInstanceBounds; // Re-tagged below so the camera-pass cull tracks this mesh.
    window.InstancedMeshBounds?.tag?.(mesh);
    batch.members = meshes.slice();
    batch.flags = sels.map(sel => (sel ? sel.flags.slice() : null));
    batch.signature = new Float64Array(meshes.length * SIG);
    meshes.forEach((member, i) => writeSignature(batch.signature, i * SIG, member, sels[i]));
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

  function onCamera(mesh) {
    const world = window.InstancedMeshBounds?.worldSphere?.(mesh, sphere);
    return !world || frustum.intersectsSphere(world); // Unbounded: the camera cull would keep it drawn too.
  }

  // Per-instance far flags for one chunk part (instance base xz vs camera xz),
  // with hysteresis from the previous frame. Returns the number of far trees.
  function classify(mesh, cameraX, cameraZ) {
    const count = mesh.count;
    let flags = farFlags.get(mesh);
    if (!flags || flags.length < count) { const grown = new Uint8Array(count); if (flags) grown.set(flags.subarray(0, Math.min(flags.length, count))); farFlags.set(mesh, flags = grown); }
    const src = mesh.instanceMatrix.array, e = mesh.matrixWorld.elements, identity = isIdentity(e);
    let far = 0;
    for (let i = 0; i < count; i++) {
      let x = src[i * 16 + 12], z = src[i * 16 + 14];
      if (!identity) { const y = src[i * 16 + 13]; const wx = e[0] * x + e[4] * y + e[8] * z + e[12]; z = e[2] * x + e[6] * y + e[10] * z + e[14]; x = wx; }
      const d = Math.hypot(x - cameraX, z - cameraZ);
      const isFar = d >= lodDistance || (flags[i] === 1 && d >= lodDistance - LOD_HYSTERESIS) ? 1 : 0;
      flags[i] = isFar;
      far += isFar;
    }
    return far;
  }

  // Returns a restore function, or null when nothing was swapped.
  function suspendForRender(scene, { isZone = false, camera = null } = {}) {
    if (scene !== lastScene) { releaseScene(lastScene); lastScene = scene || null; }
    if (!enabled || !isZone || !scene?.isScene || !window.THREE || !camera?.isCamera) { releaseScene(scene); return null; }
    stats.sourceMeshes = stats.sourceInstances = stats.drawsSaved = stats.skippedTransparent = stats.skippedOther = stats.offCamera = 0;
    stats.lodFarTrees = stats.lodNearTrees = stats.lodLiteParts = stats.lodOmittedParts = stats.lodTrianglesAvoided = 0;
    if (!frustum) { frustum = new window.THREE.Frustum(); viewProjection = new window.THREE.Matrix4(); sphere = new window.THREE.Sphere(); }
    camera.updateMatrixWorld?.(true);
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
    const groups = new Map(); // key -> { geometry, meshes, sels, subset }
    const liteFor = lodEnabled ? window.FoliageGenerator?.liteTreeGeometry : null;
    const cameraX = camera.matrixWorld.elements[12], cameraZ = camera.matrixWorld.elements[14];
    let any = false, omittedOnly = 0;
    const omitted = []; // Parts whose every instance is far and that have no twin.
    const swapped = []; // [mesh, full geometry, ...]: fading parts drawn with their twin in place.
    for (const chunk of scene.children) {
      if (chunk.userData?.denseForestWall !== true || chunk.visible === false) continue;
      any = true;
      let chunkTreesCounted = false;
      for (const mesh of chunk.children) {
        const mode = eligible(mesh);
        if (!mode) continue;
        if (!onCamera(mesh)) { stats.offCamera++; continue; }
        const own = mode === 'own';
        const lite = liteFor ? liteFor(mesh.geometry) : undefined;
        if (lite === undefined) { if (!own) addMember(groups, mesh, mesh.geometry, null); continue; } // Leaf cards and unknown parts: as they are.
        const far = classify(mesh, cameraX, cameraZ);
        if (!chunkTreesCounted && lite) { stats.lodFarTrees += far; stats.lodNearTrees += mesh.count - far; chunkTreesCounted = true; }
        if (!far) { if (!own) addMember(groups, mesh, mesh.geometry, null); continue; } // A near fading part draws itself.
        const flags = farFlags.get(mesh);
        const near = mesh.count - far;
        if (own && !near && lite) { // Whole fading part far: draw itself with the twin, no extra draw.
          swapped.push(mesh, mesh.geometry);
          mesh.geometry = lite;
          stats.lodLiteParts++;
          stats.lodTrianglesAvoided += (triangles(swapped[swapped.length - 1]) - triangles(lite)) * far;
          continue;
        }
        if (near) addMember(groups, mesh, mesh.geometry, { flags, want: 0, n: near }, own);
        if (lite) {
          addMember(groups, mesh, lite, { flags, want: 1, n: far }, own);
          stats.lodLiteParts++;
          stats.lodTrianglesAvoided += (triangles(mesh.geometry) - triangles(lite)) * far;
        } else {
          stats.lodOmittedParts++;
          stats.lodTrianglesAvoided += triangles(mesh.geometry) * far;
          if (!near) { omitted.push(mesh); omittedOnly++; }
        }
      }
    }
    const record = any || records.has(scene) ? recordFor(scene) : null;
    const restoreSwapped = () => { for (let i = 0; i < swapped.length; i += 2) swapped[i].geometry = swapped[i + 1]; swapped.length = 0; };
    if (!record) { restoreSwapped(); return null; }
    stats.frames++;
    for (const [key, batch] of record.batches) {
      if (drawsAsBatch(groups.get(key))) continue;
      record.holder.remove(batch.mesh); // Geometry and material belong to the chunks.
      batch.mesh.dispose?.();
      record.batches.delete(key);
    }
    const THREE = window.THREE;
    const hidden = [];
    const hiddenSet = new Set();
    const hide = mesh => { if (hiddenSet.has(mesh)) return; hiddenSet.add(mesh); mesh.visible = false; hidden.push(mesh); };
    for (const mesh of omitted) hide(mesh);
    for (const [key, group] of groups) {
      if (!drawsAsBatch(group)) continue;
      let batch = record.batches.get(key);
      if (!batch) { batch = { mesh: null, capacity: 0, members: [], flags: [], signature: null }; record.batches.set(key, batch); }
      if (!isCurrent(batch, group)) buildBatch(THREE, record, batch, group);
      batch.mesh.visible = true;
      for (let m = 0; m < group.meshes.length; m++) {
        hide(group.meshes[m]);
        stats.sourceInstances += group.sels[m] ? group.sels[m].n : group.meshes[m].count;
      }
      stats.drawsSaved += group.meshes.length - 1;
    }
    stats.sourceMeshes = hidden.length - omittedOnly;
    stats.batches = record.batches.size;
    stats.lodSwappedInPlace = swapped.length / 2;
    if (!hidden.length && !swapped.length) return null;
    record.holder.visible = hidden.length > 0;
    return function restoreDenseForestWallBatches() {
      for (let i = 0; i < hidden.length; i++) hidden[i].visible = true;
      restoreSwapped();
      record.holder.visible = false;
    };
  }

  function triangles(geometry) {
    return Math.round((geometry.index ? geometry.index.count : (geometry.attributes.position?.count || 0)) / 3);
  }

  function setLodEnabled(value) {
    lodEnabled = value !== false;
    return lodEnabled;
  }
  function setLodDistance(value) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) lodDistance = n;
    return lodDistance;
  }

  function setEnabled(value) {
    enabled = value !== false;
    if (!enabled) releaseScene(lastScene);
    return enabled;
  }

  window.DenseForestWallBatches = Object.freeze({
    suspendForRender,
    setEnabled,
    setLodEnabled,
    setLodDistance,
    snapshot: () => ({ enabled, lodEnabled, lodDistance, lodHysteresis: LOD_HYSTERESIS, ...stats }),
  });
})();
