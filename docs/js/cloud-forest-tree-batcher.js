// Southern Cloud Forest baked-tree draw-call reduction.
//
// Keeps the original per-tree Object3D roots as gameplay/collision/culling
// proxies, but replaces the expensive far-tree render meshes with coarse
// spatial InstancedMesh batches. Trees close to the player automatically
// switch back to their original meshes so camera occlusion fading, chopping,
// outlines, and other near-player presentation continue to use the existing
// code paths unchanged.
(function (root) {
  'use strict';

  if (!root || root.CloudForestTreeBatcher) return;

  const CHUNK_SIZE_TILES = 8;
  const DEFAULT_NEAR_RADIUS_TILES = 10;
  const MOVE_REFRESH_TILES = 0.35;
  const STATIC_REFRESH_MS = 750;
  const BATCHABLE_SPECIES = new Set(['crowned_pine', 'shadewood']);

  let nearRadiusTiles = DEFAULT_NEAR_RADIUS_TILES;
  let activeState = null;
  let fogDeps = null; // Captured from CloudForestFog.init so batching follows the authoritative player/scene/cull state.
  let lastDebugLog = '';
  const states = new WeakMap();

  function debug(message, level = 'info') {
    const text = `[CloudForestTreeBatcher] ${message}`;
    if (text === lastDebugLog && level === 'info') return;
    lastDebugLog = text;
    if (typeof root.__farmLog === 'function') root.__farmLog(text, level, 'foliage');
    else if (level === 'warn' || level === 'error') console.warn(text);
  }

  function normalizedSpecies(value) {
    const raw = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (raw === 'crownedpine' || raw === 'pine') return 'crowned_pine';
    if (raw === 'shadewood_tree') return 'shadewood';
    return raw;
  }

  function isBatchableTreeRoot(object) {
    if (!object?.isObject3D || object.userData?.cloudForestTreeBatch) return false;
    if (object.userData?.bakedTreeAsset !== true) return false;
    const species = normalizedSpecies(object.userData?.treeSpecies);
    return BATCHABLE_SPECIES.has(species) && Number.isFinite(Number(object.userData?.treeVariant));
  }

  function materialKey(material) {
    // Object3D.clone() preserves material references for these static GLBs, so
    // the material object/array itself is a stable Map key shared by copies.
    return material;
  }

  function sceneContains(scene, object) {
    let node = object;
    while (node) {
      if (node === scene) return true;
      node = node.parent;
    }
    return false;
  }

  function collectRoots(scene) {
    const roots = [];
    scene?.traverse?.(object => {
      if (isBatchableTreeRoot(object)) roots.push(object);
    });
    return roots;
  }

  function restoreSourceMeshes(state) {
    for (const entry of state?.entries || []) {
      for (const source of entry.sources) {
        if (source.mesh) source.mesh.visible = source.originalVisible;
      }
    }
  }

  function removeBatchGroups(state) {
    for (const chunk of state?.chunks || []) {
      try { chunk.group?.parent?.remove?.(chunk.group); } catch (_) {}
    }
  }

  function disposeState(state, restore = true) {
    if (!state) return;
    if (restore) restoreSourceMeshes(state);
    removeBatchGroups(state);
    state.disposed = true;
    if (activeState === state) activeState = null;
  }

  function makeBucket(buckets, geometry, material, sampleMesh) {
    let byMaterial = buckets.get(geometry);
    if (!byMaterial) buckets.set(geometry, byMaterial = new Map());
    const key = materialKey(material);
    let bucket = byMaterial.get(key);
    if (!bucket) {
      bucket = { geometry, material, sampleMesh, slots: [] };
      byMaterial.set(key, bucket);
    }
    return bucket;
  }

  function buildState(scene) {
    const THREE = root.THREE;
    if (!THREE?.InstancedMesh || !THREE?.Matrix4 || !scene) return null;
    if (root.TreeAssetLibrary?.getMode?.() === 'procedural') return null;

    scene.updateMatrixWorld?.(true);
    const roots = collectRoots(scene);
    if (!roots.length) {
      return {
        scene,
        status: 'no-baked-roots',
        entries: [], chunks: [], treeCount: 0, sourceMeshCount: 0,
        instancedMeshCount: 0, lastRefreshMs: performance.now(),
        lastPlayerX: NaN, lastPlayerZ: NaN, lastCullRadius: NaN,
      };
    }

    const chunkDefs = new Map();
    const entries = [];
    let sourceMeshCount = 0;

    for (const treeRoot of roots) {
      treeRoot.updateWorldMatrix?.(true, true);
      const worldPosition = new THREE.Vector3().setFromMatrixPosition(treeRoot.matrixWorld);
      const cx = Math.floor(worldPosition.x / CHUNK_SIZE_TILES);
      const cz = Math.floor(worldPosition.z / CHUNK_SIZE_TILES);
      const chunkKey = `${cx},${cz}`;
      let chunk = chunkDefs.get(chunkKey);
      if (!chunk) {
        chunk = {
          key: chunkKey,
          gridX: cx,
          gridZ: cz,
          entries: [],
          buckets: new Map(),
          minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity,
        };
        chunkDefs.set(chunkKey, chunk);
      }

      const entry = {
        root: treeRoot,
        species: normalizedSpecies(treeRoot.userData?.treeSpecies),
        variant: Number(treeRoot.userData?.treeVariant) || 1,
        x: worldPosition.x,
        z: worldPosition.z,
        near: null,
        alive: true,
        sources: [],
      };
      entries.push(entry);
      chunk.entries.push(entry);
      chunk.minX = Math.min(chunk.minX, entry.x);
      chunk.maxX = Math.max(chunk.maxX, entry.x);
      chunk.minZ = Math.min(chunk.minZ, entry.z);
      chunk.maxZ = Math.max(chunk.maxZ, entry.z);

      treeRoot.traverse(object => {
        if (!object?.isMesh || object.isInstancedMesh || object.isSkinnedMesh) return;
        if (!object.geometry || !object.material || object.userData?.cloudForestTreeBatch) return;
        object.updateWorldMatrix?.(true, false);
        const bucket = makeBucket(chunk.buckets, object.geometry, object.material, object);
        const source = {
          mesh: object,
          originalVisible: object.visible !== false,
          matrix: object.matrixWorld.clone(),
          batchMesh: null,
          batchIndex: -1,
        };
        entry.sources.push(source);
        bucket.slots.push({ entry, source });
        sourceMeshCount++;
      });
    }

    const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    const chunks = [];
    let instancedMeshCount = 0;
    let chunkIndex = 0;

    for (const definition of chunkDefs.values()) {
      const group = new THREE.Group();
      group.name = `CloudForestTreeBatchChunk_${chunkIndex++}`;
      group.userData.cloudForestTreeBatch = true;
      group.userData.skipOcclusionFade = true;
      group.userData.backgroundScenery = false;

      for (const byMaterial of definition.buckets.values()) {
        for (const bucket of byMaterial.values()) {
          if (!bucket.slots.length) continue;
          const sample = bucket.sampleMesh;
          const mesh = new THREE.InstancedMesh(bucket.geometry, bucket.material, bucket.slots.length);
          mesh.name = `CloudForestTreeInstances_${definition.key}_${instancedMeshCount}`;
          mesh.castShadow = !!sample.castShadow;
          mesh.receiveShadow = !!sample.receiveShadow;
          mesh.renderOrder = sample.renderOrder || 0;
          mesh.frustumCulled = false; // Chunk-level radial culling is authoritative.
          mesh.userData = {
            ...(sample.userData || {}),
            cloudForestTreeBatch: true,
            skipOcclusionFade: true,
          };
          if (THREE.DynamicDrawUsage && mesh.instanceMatrix?.setUsage) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          for (let i = 0; i < bucket.slots.length; i++) {
            const slot = bucket.slots[i];
            slot.source.batchMesh = mesh;
            slot.source.batchIndex = i;
            mesh.setMatrixAt(i, zeroMatrix);
          }
          mesh.instanceMatrix.needsUpdate = true;
          group.add(mesh);
          instancedMeshCount++;
        }
      }

      if (!group.children.length) continue;
      const centerX = (definition.minX + definition.maxX) * 0.5;
      const centerZ = (definition.minZ + definition.maxZ) * 0.5;
      const pad = 3.5;
      const radius = Math.hypot(
        (definition.maxX - definition.minX) * 0.5 + pad,
        (definition.maxZ - definition.minZ) * 0.5 + pad,
      );
      group.userData.cullSphere = { x: centerX, z: centerZ, radius, xzRadius: radius };
      scene.add(group);
      chunks.push({
        ...definition,
        buckets: undefined,
        group,
        centerX,
        centerZ,
        radius,
        visible: true,
      });
    }

    const state = {
      scene,
      status: chunks.length ? 'ready' : 'no-render-meshes',
      entries,
      chunks,
      treeCount: entries.length,
      sourceMeshCount,
      instancedMeshCount,
      nearTreeCount: 0,
      batchedTreeCount: 0,
      culledChunkCount: 0,
      lastRefreshMs: 0,
      lastPlayerX: NaN,
      lastPlayerZ: NaN,
      lastCullRadius: NaN,
      zeroMatrix,
      disposed: false,
    };
    debug(`Built ${chunks.length} chunks / ${instancedMeshCount} instanced meshes for ${entries.length} baked trees (${sourceMeshCount} source meshes).`);
    return state;
  }

  function setSourceMode(entry, useOriginal, zeroMatrix, dirtyMeshes) {
    if (entry.near === useOriginal) return;
    entry.near = useOriginal;
    for (const source of entry.sources) {
      if (source.mesh) source.mesh.visible = useOriginal ? source.originalVisible : false;
      if (!source.batchMesh || source.batchIndex < 0) continue;
      source.batchMesh.setMatrixAt(source.batchIndex, useOriginal ? zeroMatrix : source.matrix);
      dirtyMeshes.add(source.batchMesh);
    }
  }

  function hideRemovedEntry(entry, zeroMatrix, dirtyMeshes) {
    if (!entry.alive) return;
    entry.alive = false;
    entry.near = false;
    for (const source of entry.sources) {
      if (!source.batchMesh || source.batchIndex < 0) continue;
      source.batchMesh.setMatrixAt(source.batchIndex, zeroMatrix);
      dirtyMeshes.add(source.batchMesh);
    }
  }

  function refreshState(state, playerX, playerZ, cullRadiusTiles, force = false) {
    if (!state || state.disposed || state.status !== 'ready') return;
    const now = performance.now();
    const moved = !Number.isFinite(state.lastPlayerX)
      || Math.hypot(playerX - state.lastPlayerX, playerZ - state.lastPlayerZ) >= MOVE_REFRESH_TILES;
    const cullChanged = !Number.isFinite(state.lastCullRadius) || Math.abs(cullRadiusTiles - state.lastCullRadius) >= 0.05;
    const stale = now - state.lastRefreshMs >= STATIC_REFRESH_MS;
    if (!force && !moved && !cullChanged && !stale) return;

    state.lastRefreshMs = now;
    state.lastPlayerX = playerX;
    state.lastPlayerZ = playerZ;
    state.lastCullRadius = cullRadiusTiles;
    const nearRadiusSq = nearRadiusTiles * nearRadiusTiles;
    const dirtyMeshes = new Set();
    let nearTreeCount = 0;
    let batchedTreeCount = 0;

    for (const entry of state.entries) {
      if (!sceneContains(state.scene, entry.root)) {
        hideRemovedEntry(entry, state.zeroMatrix, dirtyMeshes);
        continue;
      }
      entry.alive = true;
      const dx = entry.x - playerX;
      const dz = entry.z - playerZ;
      const useOriginal = dx * dx + dz * dz <= nearRadiusSq;
      setSourceMode(entry, useOriginal, state.zeroMatrix, dirtyMeshes);
      if (useOriginal) nearTreeCount++;
      else batchedTreeCount++;
    }

    for (const mesh of dirtyMeshes) mesh.instanceMatrix.needsUpdate = true;

    let culledChunkCount = 0;
    for (const chunk of state.chunks) {
      const dx = chunk.centerX - playerX;
      const dz = chunk.centerZ - playerZ;
      const maxDistance = Math.max(0, cullRadiusTiles) + chunk.radius;
      const visible = dx * dx + dz * dz <= maxDistance * maxDistance;
      chunk.group.visible = visible;
      chunk.visible = visible;
      if (!visible) culledChunkCount++;
    }

    state.nearTreeCount = nearTreeCount;
    state.batchedTreeCount = batchedTreeCount;
    state.culledChunkCount = culledChunkCount;
  }

  function ensureState(scene) {
    let state = states.get(scene);
    if (state && !state.disposed) return state;
    state = buildState(scene);
    if (state) states.set(scene, state);
    return state;
  }

  function update({ scene, playerX, playerZ, cullRadiusTiles } = {}) {
    if (!scene || !Number.isFinite(Number(playerX)) || !Number.isFinite(Number(playerZ))) return false;
    const radius = Number.isFinite(Number(cullRadiusTiles)) ? Math.max(0, Number(cullRadiusTiles)) : 34;
    const state = ensureState(scene);
    if (!state) return false;
    activeState = state;
    refreshState(state, Number(playerX), Number(playerZ), radius);
    return state.status === 'ready';
  }

  function setNearRadiusTiles(value) {
    const next = Math.max(2, Math.min(24, Number(value) || DEFAULT_NEAR_RADIUS_TILES));
    nearRadiusTiles = next;
    if (activeState?.status === 'ready' && Number.isFinite(activeState.lastPlayerX)) {
      refreshState(activeState, activeState.lastPlayerX, activeState.lastPlayerZ, activeState.lastCullRadius || 34, true);
    }
    return nearRadiusTiles;
  }

  function rebuild(scene = activeState?.scene) {
    if (!scene) return false;
    const prior = states.get(scene);
    if (prior) disposeState(prior, true);
    const next = buildState(scene);
    if (!next) return false;
    states.set(scene, next);
    activeState = next;
    if (prior && Number.isFinite(prior.lastPlayerX)) {
      refreshState(next, prior.lastPlayerX, prior.lastPlayerZ, prior.lastCullRadius || 34, true);
    }
    return next.status === 'ready';
  }

  function updateFromFogDeps() {
    if (!fogDeps?.isCloudForestArea?.()) return false;
    const scene = fogDeps.getActiveScene?.();
    const tile = Number(fogDeps.TILE) || 1;
    const player = fogDeps.player;
    if (!scene || !player || !Number.isFinite(Number(player.x)) || !Number.isFinite(Number(player.y))) return false;
    const cullRadiusTiles = Number(fogDeps.getCloudForestFogRadiusTiles?.()) || 34;
    return update({
      scene,
      playerX: Number(player.x) / tile,
      playerZ: Number(player.y) / tile,
      cullRadiusTiles,
    });
  }

  function hookCloudForestFogApi(api) {
    if (!api || api.__cloudForestTreeBatcherHooked) return !!api;
    const originalInit = api.init;
    const originalUpdate = api.update;
    if (typeof originalInit !== 'function' || typeof originalUpdate !== 'function') return false;
    api.init = function cloudForestTreeBatchInit(injectedDeps) {
      fogDeps = injectedDeps || null;
      return originalInit.apply(this, arguments);
    };
    api.update = function cloudForestTreeBatchUpdate() {
      const result = originalUpdate.apply(this, arguments);
      try { updateFromFogDeps(); }
      catch (error) { debug(`Update failed: ${error?.message || error}`, 'warn'); }
      return result;
    };
    Object.defineProperty(api, '__cloudForestTreeBatcherHooked', { value: true, configurable: true });
    return true;
  }

  function installCloudForestFogHook() {
    if (hookCloudForestFogApi(root.CloudForestFog)) return true;
    // This file is parser-loaded before cloud-forest-fog.js. Intercept that
    // module's single global assignment so its init() can be wrapped before
    // game.js injects the private player/scene dependencies.
    try {
      const descriptor = Object.getOwnPropertyDescriptor(root, 'CloudForestFog');
      if (descriptor && descriptor.configurable === false) return false;
      let pending = descriptor?.value;
      Object.defineProperty(root, 'CloudForestFog', {
        configurable: true,
        enumerable: true,
        get() { return pending; },
        set(value) {
          pending = value;
          hookCloudForestFogApi(pending);
          Object.defineProperty(root, 'CloudForestFog', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: pending,
          });
        },
      });
      if (pending) hookCloudForestFogApi(pending);
      return true;
    } catch (error) {
      debug(`Could not arm CloudForestFog hook: ${error?.message || error}`, 'warn');
      return false;
    }
  }

  function getDebugState() {
    const state = activeState;
    return {
      enabled: !!state && state.status === 'ready',
      status: state?.status || 'inactive',
      chunkSizeTiles: CHUNK_SIZE_TILES,
      nearRadiusTiles,
      treeCount: state?.treeCount || 0,
      nearTreeCount: state?.nearTreeCount || 0,
      batchedTreeCount: state?.batchedTreeCount || 0,
      sourceMeshCount: state?.sourceMeshCount || 0,
      instancedMeshCount: state?.instancedMeshCount || 0,
      chunkCount: state?.chunks?.length || 0,
      culledChunkCount: state?.culledChunkCount || 0,
      cullRadiusTiles: Number.isFinite(state?.lastCullRadius) ? state.lastCullRadius : null,
    };
  }

  installCloudForestFogHook();

  root.CloudForestTreeBatcher = Object.freeze({
    CHUNK_SIZE_TILES,
    DEFAULT_NEAR_RADIUS_TILES,
    update,
    updateFromFogDeps,
    rebuild,
    setNearRadiusTiles,
    getDebugState,
  });
})(typeof window !== 'undefined' ? window : null);
