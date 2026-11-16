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
  const STATIC_REFRESH_MS = 1500; // Limits periodic dead-tree validation when the player is stationary.
  const ROOT_RETRY_MS = 3000; // Rechecks a not-yet-populated Cloud Forest scene without traversing it every frame.
  const FRUSTUM_PADDING_TILES = 3; // Keeps animated foliage and camera-edge canopies inside the view bounds.
  const BATCHABLE_SPECIES = new Set(['crowned_pine', 'shadewood']);

  let nearRadiusTiles = DEFAULT_NEAR_RADIUS_TILES;
  let activeState = null;
  let fogDeps = null; // Captured from CloudForestFog.init so batching follows the authoritative player/scene/cull state.
  let lastDebugLog = '';
  let lastDevPanelCheckMs = -Infinity; // Used to throttle optional dev-panel DOM work to once per second.
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
    const pending = scene ? [scene] : []; // Used to stop at the outermost tagged gameplay tree; its GLB/LOD children carry the same tags.
    while (pending.length) {
      const object = pending.pop();
      if (isBatchableTreeRoot(object)) {
        roots.push(object);
        continue; // A baked tree's inner near/far GLBs must not be registered as separate trees.
      }
      const children = object?.children || [];
      for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]);
    }
    return roots;
  }

  function batchVisualRoot(treeRoot) {
    const lod = treeRoot.children?.find(child => child?.isLOD && child.userData?.treeLodController);
    return lod?.levels?.[lod.levels.length - 1]?.object || treeRoot; // Use only the most distant authored GLB for far instances.
  }

  function isInVisualRoot(mesh, visualRoot) {
    let node = mesh;
    while (node) {
      if (node === visualRoot) return true;
      node = node.parent;
    }
    return false;
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
        lastRootProbeMs: performance.now(), // Retry after async tree scene construction finishes.
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
          renderBounds: new THREE.Box3(), // Union of source meshes used for conservative 3D view culling.
          canFrustumCull: true, // Falls back to radial-only culling if any source has unknown geometry bounds.
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

      const farVisual = batchVisualRoot(treeRoot); // GLB LODs contain separate near/far meshes, never batch both.
      treeRoot.traverse(object => {
        if (!object?.isMesh || object.isInstancedMesh || object.isSkinnedMesh) return;
        if (!object.geometry || !object.material || object.userData?.cloudForestTreeBatch) return;
        object.updateWorldMatrix?.(true, false);
        const source = {
          mesh: object,
          originalVisible: object.visible !== false,
          matrix: object.matrixWorld.clone(),
          batchMesh: null,
          batchIndex: -1,
        };
        entry.sources.push(source); // Both near and far meshes still need hiding/restoring as the player approaches.
        sourceMeshCount++;
        if (!isInVisualRoot(object, farVisual)) return;
        const bucket = makeBucket(chunk.buckets, object.geometry, object.material, object);
        // Only the selected far-detail GLB contributes to camera bounds or instanced draw calls.
        const geometryBounds = object.geometry.boundingBox || (object.geometry.computeBoundingBox?.(), object.geometry.boundingBox);
        if (geometryBounds && !geometryBounds.isEmpty()) {
          chunk.renderBounds.union(geometryBounds.clone().applyMatrix4(source.matrix));
        } else {
          chunk.canFrustumCull = false;
        }
        bucket.slots.push({ entry, source });
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
      // Include the complete authored height, not only trunk origins, before hiding a chunk off-camera.
      const viewSphere = definition.canFrustumCull && !definition.renderBounds.isEmpty()
        ? definition.renderBounds.getBoundingSphere(new THREE.Sphere()) : null;
      if (viewSphere) viewSphere.radius += FRUSTUM_PADDING_TILES;
      scene.add(group);
      chunks.push({
        ...definition,
        buckets: undefined,
        group,
        centerX,
        centerZ,
        radius,
        viewSphere, // Used by updateChunkVisibility to skip batches outside the live camera view.
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
      frustumCulledChunkCount: 0, // Exposed in mobile diagnostics, separate from distance culling.
      frustumActive: false, // Shows whether a valid gameplay camera is supplying view bounds.
      lastVisibilityX: NaN, lastVisibilityZ: NaN, lastVisibilityRadius: NaN,
      lastViewCamera: null, lastViewMatrix: null, lastProjectionMatrix: null,
      frustum: new THREE.Frustum(), // Reused; never allocate a new frustum in the frame loop.
      projectionViewMatrix: new THREE.Matrix4(), // Reused to project chunk bounds into camera space.
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

    state.nearTreeCount = nearTreeCount;
    state.batchedTreeCount = batchedTreeCount;
  }

  function updateChunkVisibility(state, playerX, playerZ, cullRadiusTiles, camera) {
    if (!state || state.disposed || state.status !== 'ready') return;
    const cameraReady = !!(camera?.isCamera && camera.matrixWorld && camera.matrixWorldInverse && camera.projectionMatrix);
    if (cameraReady) camera.updateWorldMatrix?.(true, false);
    const cameraChanged = cameraReady !== state.frustumActive
      || (cameraReady && (state.lastViewCamera !== camera
        || !state.lastViewMatrix?.equals(camera.matrixWorld)
        || !state.lastProjectionMatrix?.equals(camera.projectionMatrix)));
    const moved = !Number.isFinite(state.lastVisibilityX)
      || Math.hypot(playerX - state.lastVisibilityX, playerZ - state.lastVisibilityZ) >= MOVE_REFRESH_TILES;
    const radiusChanged = !Number.isFinite(state.lastVisibilityRadius)
      || Math.abs(cullRadiusTiles - state.lastVisibilityRadius) >= 0.05;
    if (!cameraChanged && !moved && !radiusChanged) {
      // The general wilderness vegetation pass can toggle group.visible independently.
      // Preserve the last camera decision without recomputing frustum planes every frame.
      for (const chunk of state.chunks) {
        if (chunk.group.visible !== chunk.visible) chunk.group.visible = chunk.visible;
      }
      return;
    }

    state.lastVisibilityX = playerX;
    state.lastVisibilityZ = playerZ;
    state.lastVisibilityRadius = cullRadiusTiles;
    state.frustumActive = cameraReady;
    if (cameraReady) {
      state.lastViewCamera = camera;
      if (!state.lastViewMatrix) state.lastViewMatrix = camera.matrixWorld.clone();
      else state.lastViewMatrix.copy(camera.matrixWorld);
      if (!state.lastProjectionMatrix) state.lastProjectionMatrix = camera.projectionMatrix.clone();
      else state.lastProjectionMatrix.copy(camera.projectionMatrix);
      state.frustum.setFromProjectionMatrix(
        state.projectionViewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
      );
    } else {
      state.lastViewCamera = null;
    }

    let culledChunkCount = 0;
    let frustumCulledChunkCount = 0;
    for (const chunk of state.chunks) {
      const dx = chunk.centerX - playerX;
      const dz = chunk.centerZ - playerZ;
      const maxDistance = Math.max(0, cullRadiusTiles) + chunk.radius;
      const withinRadius = dx * dx + dz * dz <= maxDistance * maxDistance;
      const outsideView = withinRadius && cameraReady && chunk.viewSphere
        && !state.frustum.intersectsSphere(chunk.viewSphere);
      const visible = withinRadius && !outsideView;
      chunk.group.visible = visible; // Reassert our view gate if the general vegetation culler touched the group.
      chunk.visible = visible;
      if (!visible) culledChunkCount++;
      if (outsideView) frustumCulledChunkCount++;
    }
    state.culledChunkCount = culledChunkCount;
    state.frustumCulledChunkCount = frustumCulledChunkCount;
  }

  function ensureState(scene) {
    let state = states.get(scene);
    if (state && !state.disposed) {
      if (state.status !== 'no-baked-roots') return state;
      if (root.TreeAssetLibrary?.getMode?.() === 'procedural') return null; // No repeated scene scans in the game's default procedural mode.
      const now = performance.now(); // Used to retry a scene that was first visited before its baked trees were attached.
      if (now - state.lastRootProbeMs < ROOT_RETRY_MS) return state;
    }
    state = buildState(scene);
    if (state) states.set(scene, state);
    return state;
  }

  function update({ scene, playerX, playerZ, cullRadiusTiles } = {}) {
    if (!scene || !Number.isFinite(Number(playerX)) || !Number.isFinite(Number(playerZ))) return false;
    const radius = Number.isFinite(Number(cullRadiusTiles)) ? Math.max(0, Number(cullRadiusTiles)) : 34;
    const state = ensureState(scene);
    if (!state) {
      activeState = null;
      updateDevPanelStatus(null);
      return false;
    }
    activeState = state;
    refreshState(state, Number(playerX), Number(playerZ), radius);
    const camera = fogDeps?.getActiveCamera?.()
      || root.Combat?.deps?.getActiveCamera?.() || fogDeps?.camera || null; // Prefer the active cinematic/gameplay camera over a static camera reference.
    updateChunkVisibility(state, Number(playerX), Number(playerZ), radius, camera);
    updateDevPanelStatus(state);
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

  function updateDevPanelStatus(state = activeState) {
    const now = performance.now();
    if (now - lastDevPanelCheckMs < 1000) return;
    lastDevPanelCheckMs = now;
    const panel = document.getElementById('cloudForestDevTuning');
    const devMode = document.getElementById('settingDevMode');
    if (!panel || !devMode?.checked) return;
    let line = document.getElementById('cloudForestTreeBatchStatus');
    if (!line) {
      line = document.createElement('div');
      line.id = 'cloudForestTreeBatchStatus';
      line.style.cssText = 'font-size:10px;line-height:1.35;color:#bae6fd;opacity:.82;margin:4px 0 7px';
      const anchor = document.getElementById('cloudForestDevStatus');
      if (anchor?.nextSibling) panel.insertBefore(line, anchor.nextSibling);
      else panel.appendChild(line);
    }
    if (!state) {
      const message = root.TreeAssetLibrary?.getMode?.() === 'procedural'
        ? 'Tree batching: procedural mode (baked-tree optimization inactive)'
        : 'Tree batching: inactive';
      if (line.textContent !== message) line.textContent = message;
      return;
    }
    if (state.status !== 'ready') {
      const message = `Tree batching: ${state.status === 'no-baked-roots' ? 'waiting for baked tree roots / rebuild' : state.status}`;
      if (line.textContent !== message) line.textContent = message;
      return;
    }
    const visibleChunks = Math.max(0, (state.chunks?.length || 0) - (state.culledChunkCount || 0));
    const viewCull = state.frustumActive ? `${state.frustumCulledChunkCount} off-camera` : 'camera unavailable';
    const message = `Tree batching: ${state.batchedTreeCount} batched · ${state.nearTreeCount} near-original · ${visibleChunks}/${state.chunks.length} chunks visible (${viewCull}) · ${state.instancedMeshCount} instanced draws max`;
    if (line.textContent !== message) line.textContent = message;
  }

  function getDebugState() {
    const state = activeState;
    return {
      enabled: !!state && state.status === 'ready',
      status: state?.status || (root.TreeAssetLibrary?.getMode?.() === 'procedural' ? 'procedural-mode' : 'inactive'),
      treeSourceMode: root.TreeAssetLibrary?.getMode?.() || 'unknown', // Identifies whether this optimization can affect the current game.
      chunkSizeTiles: CHUNK_SIZE_TILES,
      nearRadiusTiles,
      treeCount: state?.treeCount || 0,
      nearTreeCount: state?.nearTreeCount || 0,
      batchedTreeCount: state?.batchedTreeCount || 0,
      sourceMeshCount: state?.sourceMeshCount || 0,
      instancedMeshCount: state?.instancedMeshCount || 0,
      chunkCount: state?.chunks?.length || 0,
      culledChunkCount: state?.culledChunkCount || 0,
      frustumActive: !!state?.frustumActive,
      frustumCulledChunkCount: state?.frustumCulledChunkCount || 0,
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
