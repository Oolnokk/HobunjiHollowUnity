// Wilderness tree instancing for drawing only (window.WildernessTreeInstancer).
//
// Procedural wilderness trees/bushes (FoliageGenerator variants: shadewood,
// crowned pine, dead trees, bushes, stumps) are one group per tile, each a
// clone of a few cached variants: every trunk/vine/leaf mesh of a variant
// shares one geometry and, while the tree is opaque, one natural-surface
// material (NaturalSurfaceMaterials caches them). Drawn one by one that was
// 3-4 draws per tree per pass, again in every held/x-ray replay — the
// device report's "WildernessChunk_*" draws.
//
// This render scope (js/world-render-pipeline.js, order 250) draws them as
// one InstancedMesh per 8x8-tile cell and shared (geometry, material, layers,
// renderOrder, shadow flags) for the frame only, then restores the originals, which stay the
// authority for gameplay: corridor culling, felling, climbing, raycasts,
// hive prompts. Only trees the corridor cull draws and that are not fading
// take part: a fading tree has its own transparent material clone
// (js/zone-tree-fade.js) and keeps drawing itself, so occlusion and edge
// fades are unchanged. The per-mesh SHELL_OUTLINE layer is part of the
// batch key, so the corridor's outline budget still applies per tree.
// Instance matrices are refreshed before collection, including newly streamed
// trees that have not yet rendered. Instanced meshes carry InstancedMeshBounds
// tags, so the instanced view cull and the held replay cull still work.
//
// Members hidden here are flagged userData.hobunjiDrawProxyHidden while
// hidden, so a pass that masks specific meshes (Perception Mode) can still
// draw them.
//
// OFF BY DEFAULT. On the user's GTX 1060 it measured as a net loss
// (treeInstancingOff: -6 ms a frame and -350k triangles): the batches span the
// whole vegetation corridor, so neither Three's frustum cull nor the held/x-ray
// replay cull could drop the trees outside a pass's view or scissor. Spatial
// cells and cached grouping keys address that measured failure, but the new
// variant remains opt-in until a real-device A/B confirms a gain.
// Opt in through Render optimizations or benchmark variant treeInstancingOn.
(() => {
  'use strict';

  if (window.WildernessTreeInstancer) return;

  const STORAGE_KEY = 'hobunjiTreeInstancingOptIn'; // Preserve the player's explicit opt-in; default remains off.
  const CELL_TILES = 8; // Same spatial scale as static prop and dense-tree chunk batching.
  const RETIRED_MAX = 64; // Bound inactive instance buffers even during a long walk.
  const RETIRE_AFTER_FRAMES = 30; // Brief reuse window for fades and outline-budget changes.
  const keyCache = new WeakMap(); // Mesh -> last cell and live draw-state key.
  const PROXY_FLAG = 'hobunjiDrawProxyHidden';
  let enabled = (() => {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) { return false; }
  })();
  const records = new WeakMap(); // scene -> { holder, batches: Map<key, batch> }
  let lastScene = null;
  const stats = { frames: 0, trees: 0, members: 0, batches: 0, cells: 0, drawsSaved: 0, uploads: 0,
    keyHits: 0, keyBuilds: 0, retired: 0, disposed: 0, skipped: {}, enabled };
  const prototypeHook = () => window.THREE?.Object3D?.prototype?.onBeforeRender;

  function skip(reason) { stats.skipped[reason] = (stats.skipped[reason] || 0) + 1; }

  // Drawn by the corridor cull (tree and every ancestor visible) and in this scene.
  function treeDrawn(tree, scene) {
    for (let node = tree; node; node = node.parent) {
      if (node.visible === false) return false;
      if (node === scene) return true;
    }
    return false;
  }

  function memberEligible(mesh) {
    if (!mesh.isMesh || mesh.isInstancedMesh || mesh.isSkinnedMesh) return 'type';
    if (!mesh.geometry || !mesh.material || Array.isArray(mesh.material)) return 'material';
    if (mesh.material.transparent) return 'transparent';
    if (mesh.material.visible === false || mesh.material.opacity !== 1) return 'material-visibility';
    if (mesh.frustumCulled === false) return 'uncullable'; // Do not newly cull an explicitly uncullable source.
    if (mesh.material.isShaderMaterial || mesh.material.isRawShaderMaterial
      || mesh.material.onBeforeCompile !== window.THREE?.Material?.prototype?.onBeforeCompile
      || mesh.material.customProgramCacheKey !== window.THREE?.Material?.prototype?.customProgramCacheKey) return 'shader-hook';
    if (mesh.children?.length) return 'children'; // Hiding a source must never hide independently drawn descendants.
    if (mesh.customDepthMaterial || mesh.customDistanceMaterial) return 'custom-depth';
    if (mesh.geometry.morphAttributes?.position?.length) return 'morph';
    const e = mesh.matrixWorld.elements; // Three r128 instancing cannot flip winding per negatively scaled member.
    const det = e[0]*(e[5]*e[10]-e[9]*e[6])-e[4]*(e[1]*e[10]-e[9]*e[2])+e[8]*(e[1]*e[6]-e[5]*e[2]);
    if (!(det > 0) || !Number.isFinite(det)) return 'mirrored-or-invalid';
    if (mesh.onBeforeRender !== prototypeHook()
      || mesh.onAfterRender !== window.THREE?.Object3D?.prototype?.onAfterRender) return 'draw-hook';
    return null;
  }

  // Visible meshes of one tree (any depth, every intermediate node visible).
  function collectMembers(tree, out, groupOrder = 0) {
    for (const child of tree.children) {
      if (child.visible === false) continue; // Authored-hidden or already owned by a prior render scope.
      const order = child.isGroup && child.renderOrder !== 0 ? child.renderOrder : groupOrder;
      if (child.isMesh) {
        const reason = order !== 0 ? 'group-order' : memberEligible(child);
        if (reason) skip(reason); else out.push(child);
      }
      if (child.children?.length) collectMembers(child, out, order);
    }
  }

  function batchKey(mesh, cellX, cellZ) {
    const data = mesh.userData;
    const mask = mesh.layers.mask, order = mesh.renderOrder || 0;
    const cast = !!mesh.castShadow, receive = !!mesh.receiveShadow;
    const noOutline = data.noOutline, billboard = data.isBillboard, surface = data.naturalSurface;
    let entry = keyCache.get(mesh);
    if (entry && entry.cellX === cellX && entry.cellZ === cellZ
      && entry.geometry === mesh.geometry && entry.material === mesh.material
      && entry.mask === mask && entry.order === order && entry.cast === cast && entry.receive === receive
      && entry.noOutline === noOutline && entry.billboard === billboard && entry.surface === surface) {
      stats.keyHits++;
      return entry.key;
    }
    // Natural-surface metadata can be an object; preserve its identity rather
    // than serialising different objects to the same string.
    const key = `${cellX},${cellZ}|${mesh.geometry.uuid}|${mesh.material.uuid}|${mask}|${order}|${+cast}${+receive}|${flagId(noOutline)}|${flagId(billboard)}|${flagId(surface)}`;
    entry = {cellX,cellZ,geometry:mesh.geometry,material:mesh.material,mask,order,cast,receive,noOutline,billboard,surface,key};
    keyCache.set(mesh,entry);
    stats.keyBuilds++;
    return key;
  }
  const flagIds = new WeakMap(); // Object-valued source flags must not alias.
  let nextFlagId = 0;
  function flagId(value) {
    if (value && typeof value === 'object') {
      let id = flagIds.get(value);
      if (!id) { id = ++nextFlagId; flagIds.set(value,id); }
      return 'obj:' + id;
    }
    return typeof value + ':' + String(value);
  }

  function recordFor(scene) {
    let record = records.get(scene);
    if (!record) {
      const holder = new window.THREE.Group();
      holder.name = 'wilderness_tree_instances';
      holder.visible = false;
      Object.assign(holder.userData, { wildernessTreeInstances: true, vegetation: true, hobunjiNeverDistanceCull: true });
      scene.add(holder);
      record = { holder, batches: new Map() };
      records.set(scene, record);
    }
    return record;
  }

  function disposeRecord(scene) {
    const record = records.get(scene);
    if (!record) return;
    for (const batch of record.batches.values()) { batch.mesh.dispose?.(); stats.disposed++; } // Instance buffers only; source geometry/material are shared.
    record.holder.parent?.remove(record.holder);
    records.delete(scene);
  }

  function makeBatchMesh(THREE, sample, capacity) {
    const mesh = new THREE.InstancedMesh(sample.geometry, sample.material, capacity);
    mesh.name = 'wilderness_tree_instance_batch';
    mesh.layers.mask = sample.layers.mask;
    mesh.renderOrder = sample.renderOrder || 0;
    mesh.castShadow = !!sample.castShadow;
    mesh.receiveShadow = !!sample.receiveShadow;
    mesh.frustumCulled = false; // r128 would cull by the base geometry; InstancedMeshBounds covers every instance.
    mesh.raycast = () => {}; // The hidden originals stay the raycast authority.
    const data = sample.userData || {};
    Object.assign(mesh.userData, { wildernessTreeInstances: true, vegetation: true, hobunjiNeverDistanceCull: true,
      hobunjiRenderProxy: true, geometryAutoLODExclude: true }); // Add-time surface and LOD passes must not mutate the shared variant.
    for (const key of ['noOutline', 'isBillboard', 'naturalSurface']) if (data[key] !== undefined) mesh.userData[key] = data[key];
    window.InstancedMeshBounds?.tag?.(mesh);
    return mesh;
  }

  function sameMembers(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // Writes the members' world matrices; skipped when members and their matrices are unchanged.
  function fillBatch(batch, members) {
    const array = batch.mesh.instanceMatrix.array;
    let changed = !sameMembers(batch.members, members);
    if (!changed) {
      for (let i = 0; i < members.length && !changed; i++) {
        const e = members[i].matrixWorld.elements, o = i * 16;
        for (let k = 0; k < 16; k++) if (array[o + k] !== Math.fround(e[k])) { changed = true; break; } // The buffer is float32.
      }
    }
    batch.mesh.count = members.length;
    if (!changed) return;
    for (let i = 0; i < members.length; i++) array.set(members[i].matrixWorld.elements, i * 16);
    batch.mesh.instanceMatrix.needsUpdate = true;
    batch.members = members.slice();
    stats.uploads++;
  }

  // Render scope: returns a restore function, or null when nothing is batched.
  function suspendForRender(scene, { isZone = false } = {}) {
    const THREE = window.THREE;
    if (lastScene && lastScene !== scene) { disposeRecord(lastScene); lastScene = null; }
    stats.trees = stats.members = stats.batches = stats.cells = stats.drawsSaved = stats.retired = 0;
    if (!enabled || !isZone || !scene?.isScene || !THREE?.InstancedMesh) {
      if (lastScene) { disposeRecord(lastScene); lastScene = null; }
      return null;
    }
    const cullables = window.ZoneVegetationCull?.currentCullables?.();
    if (!cullables?.length) {
      if (lastScene) { disposeRecord(lastScene); lastScene = null; }
      return null;
    }
    stats.frames++;
    stats.skipped = {};
    const fade = window.ZoneTreeFade;
    const groups = new Map();
    let trees = 0;
    const scratch = [];
    const seen = new Set(); // Defensive: a residency rebuild may momentarily repeat an entry.
    const cells = new Set(); // Distinct occupied spatial buckets in the current corridor.
    for (const tree of cullables) {
      if (!tree || seen.has(tree) || tree.userData?.isWildernessGrassChunk || !treeDrawn(tree, scene)) continue;
      seen.add(tree);
      if (fade?.hasFade?.(tree)) { skip('fading'); continue; }
      // Scopes run before WebGLRenderer updates scene matrices. Refresh only drawn trees, not the whole scene.
      tree.updateWorldMatrix(true, true);
      const e = tree.matrixWorld.elements;
      if (!Number.isFinite(e[12]) || !Number.isFinite(e[14])) { skip('invalid-cell'); continue; }
      const cellX = Math.floor(e[12] / CELL_TILES), cellZ = Math.floor(e[14] / CELL_TILES);
      scratch.length = 0;
      let groupOrder = 0;
      for (let node = tree; node && node !== scene; node = node.parent) {
        if (node.isGroup && node.renderOrder !== 0) { groupOrder = node.renderOrder; break; }
      }
      collectMembers(tree, scratch, groupOrder);
      if (!scratch.length) continue;
      trees++;
      cells.add(cellX + ',' + cellZ);
      for (const mesh of scratch) {
        const key = batchKey(mesh, cellX, cellZ);
        let group = groups.get(key);
        if (!group) groups.set(key, group = []);
        group.push(mesh);
      }
    }
    const record = recordFor(scene);
    lastScene = scene;
    const hidden = [];
    let batchesUsed = 0;
    let restored = false; // Idempotent restore also handles interrupted scope setup.
    const restore = () => {
      if (restored) return;
      restored = true;
      for (const mesh of hidden) {
        mesh.visible = true;
        delete mesh.userData[PROXY_FLAG];
      }
      record.holder.visible = false;
    };
    try {
      for (const [key, members] of groups) {
        if (members.length < 2) continue; // A lone mesh gains nothing.
        let batch = record.batches.get(key);
        if (batch && batch.capacity < members.length) {
          record.batches.delete(key); // If allocation fails, a disposed batch cannot be reused next frame.
          record.holder.remove(batch.mesh);
          batch.mesh.dispose?.();
          stats.disposed++;
          batch = null;
        }
        if (!batch) {
          const capacity = Math.max(8, 1 << Math.ceil(Math.log2(members.length)));
          batch = { mesh: makeBatchMesh(THREE, members[0], capacity), capacity, members: [] };
          record.batches.set(key, batch); // Register before add-time hooks so failure cleanup owns the new buffer.
          record.holder.add(batch.mesh);
        }
        fillBatch(batch, members);
        batch.mesh.visible = true;
        batch.lastUsed = stats.frames;
        batchesUsed++;
        for (const mesh of members) {
          hidden.push(mesh); // Restore owns the source before mutating presentation state.
          mesh.visible = false;
          mesh.userData[PROXY_FLAG] = true;
        }
      }
      let retired = 0;
      for (const [key, batch] of record.batches) {
        if ((groups.get(key)?.length || 0) >= 2) continue;
        batch.mesh.visible = false;
        batch.mesh.count = 0;
        batch.members.length = 0; // Do not retain unloaded source trees through a retired buffer.
        if (stats.frames - batch.lastUsed > RETIRE_AFTER_FRAMES || retired >= RETIRED_MAX) {
          record.holder.remove(batch.mesh);
          batch.mesh.dispose?.();
          stats.disposed++;
          record.batches.delete(key);
        } else retired++;
      }
      stats.retired = retired;
      stats.cells = cells.size;
      stats.trees = trees;
      stats.members = hidden.length;
      stats.batches = batchesUsed;
      stats.drawsSaved = hidden.length - batchesUsed;
      if (!hidden.length) return null;
      record.holder.visible = true;
      return restore;
    } catch (error) {
      restore(); // The pipeline cannot restore a scope whose setup threw before returning.
      disposeRecord(scene);
      lastScene = null;
      stats.trees = stats.members = stats.batches = stats.cells = stats.drawsSaved = stats.retired = 0;
      throw error;
    }
  }

  // persist: remember the choice (benchmark windows toggle without persisting).
  function setEnabled(value, { persist = false } = {}) {
    enabled = value !== false;
    stats.enabled = enabled;
    if (persist) { try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0'); } catch (_) {} }
    if (!enabled && lastScene) { disposeRecord(lastScene); lastScene = null; }
    return enabled;
  }

  window.WildernessTreeInstancer = Object.freeze({
    STORAGE_KEY,
    CELL_TILES, RETIRED_MAX, RETIRE_AFTER_FRAMES,
    PROXY_FLAG,
    suspendForRender,
    setEnabled,
    enabled: () => enabled,
    snapshot: () => ({ ...stats, skipped: { ...stats.skipped } }),
  });
})();
