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
// one InstancedMesh per (geometry, material, layers, renderOrder, shadow
// flags) for the frame only, then restores the originals, which stay the
// authority for gameplay: corridor culling, felling, climbing, raycasts,
// hive prompts. Only trees the corridor cull draws and that are not fading
// take part: a fading tree has its own transparent material clone
// (js/zone-tree-fade.js) and keeps drawing itself, so occlusion and edge
// fades are unchanged. The per-mesh SHELL_OUTLINE layer is part of the
// batch key, so the corridor's outline budget still applies per tree.
// Instance matrices are the trees' last rendered world matrices (they do
// not move after placement). Instanced meshes carry InstancedMeshBounds
// tags, so the instanced view cull and the held replay cull still work.
//
// Members hidden here are flagged userData.hobunjiDrawProxyHidden while
// hidden, so a pass that masks specific meshes (Perception Mode) can still
// draw them. A/B: WildernessTreeInstancer.setEnabled(false), or
// localStorage hobunjiTreeInstancing=off; benchmark variant treeInstancingOff.
(() => {
  'use strict';

  if (window.WildernessTreeInstancer) return;

  const STORAGE_KEY = 'hobunjiTreeInstancing';
  const PROXY_FLAG = 'hobunjiDrawProxyHidden';
  let enabled = (() => {
    try { return localStorage.getItem(STORAGE_KEY) !== 'off'; } catch (_) { return true; }
  })();
  const records = new WeakMap(); // scene -> { holder, batches: Map<key, batch> }
  let lastScene = null;
  const stats = { frames: 0, trees: 0, members: 0, batches: 0, drawsSaved: 0, uploads: 0, skipped: {}, enabled };
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
    if (mesh.geometry.morphAttributes?.position?.length) return 'morph';
    if (mesh.onBeforeRender !== prototypeHook()) return 'draw-hook';
    return null;
  }

  // Visible meshes of one tree (any depth, every intermediate node visible).
  function collectMembers(tree, out) {
    const walk = node => {
      for (const child of node.children) {
        if (child.visible === false && child.userData?.[PROXY_FLAG] !== true) continue; // Authored-hidden (e.g. an unrolled climb branch).
        if (child.isMesh) {
          const reason = memberEligible(child);
          if (reason) skip(reason); else out.push(child);
        }
        if (child.children?.length) walk(child);
      }
    };
    walk(tree);
  }

  function batchKey(mesh) {
    return `${mesh.geometry.uuid}|${mesh.material.uuid}|${mesh.layers.mask}|${mesh.renderOrder || 0}|${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}`;
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
    for (const batch of record.batches.values()) batch.mesh.dispose?.(); // Instance buffers only; geometry/material belong to the tree variants.
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
    Object.assign(mesh.userData, { wildernessTreeInstances: true, vegetation: true, hobunjiNeverDistanceCull: true });
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
    if (!enabled || !isZone || !scene?.isScene || !THREE?.InstancedMesh) return null;
    const cullables = window.ZoneVegetationCull?.currentCullables?.();
    if (!cullables?.length) return null;
    stats.frames++;
    stats.skipped = {};
    const fade = window.ZoneTreeFade;
    const groups = new Map();
    let trees = 0;
    const scratch = [];
    for (const tree of cullables) {
      if (tree.userData?.isWildernessGrassChunk || !treeDrawn(tree, scene)) continue;
      if (fade?.hasFade?.(tree)) { skip('fading'); continue; }
      scratch.length = 0;
      collectMembers(tree, scratch);
      if (!scratch.length) continue;
      trees++;
      for (const mesh of scratch) {
        const key = batchKey(mesh);
        let group = groups.get(key);
        if (!group) groups.set(key, group = []);
        group.push(mesh);
      }
    }
    const record = recordFor(scene);
    lastScene = scene;
    const hidden = [];
    let batchesUsed = 0;
    for (const [key, members] of groups) {
      if (members.length < 2) continue; // A lone mesh gains nothing.
      let batch = record.batches.get(key);
      if (batch && batch.capacity < members.length) {
        record.holder.remove(batch.mesh);
        batch.mesh.dispose?.();
        batch = null;
      }
      if (!batch) {
        const capacity = Math.max(8, 1 << Math.ceil(Math.log2(members.length)));
        batch = { mesh: makeBatchMesh(THREE, members[0], capacity), capacity, members: [] };
        record.holder.add(batch.mesh);
        record.batches.set(key, batch);
      }
      fillBatch(batch, members);
      batch.mesh.visible = true;
      batchesUsed++;
      for (const mesh of members) {
        mesh.visible = false;
        mesh.userData[PROXY_FLAG] = true;
        hidden.push(mesh);
      }
    }
    for (const [key, batch] of record.batches) {
      if ((groups.get(key)?.length || 0) >= 2) continue;
      batch.mesh.visible = false; // Kept for reuse; nothing to draw this frame.
      batch.mesh.count = 0;
    }
    stats.trees = trees;
    stats.members = hidden.length;
    stats.batches = batchesUsed;
    stats.drawsSaved = hidden.length - batchesUsed;
    if (!hidden.length) return null;
    record.holder.visible = true;
    return function restoreWildernessTreeInstances() {
      for (const mesh of hidden) {
        mesh.visible = true;
        delete mesh.userData[PROXY_FLAG];
      }
      record.holder.visible = false;
    };
  }

  function setEnabled(value) {
    enabled = value !== false;
    stats.enabled = enabled;
    try { localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off'); } catch (_) {}
    if (!enabled && lastScene) { disposeRecord(lastScene); lastScene = null; }
    return enabled;
  }

  window.WildernessTreeInstancer = Object.freeze({
    STORAGE_KEY,
    PROXY_FLAG,
    suspendForRender,
    setEnabled,
    enabled: () => enabled,
    snapshot: () => ({ ...stats, skipped: { ...stats.skipped } }),
  });
})();
