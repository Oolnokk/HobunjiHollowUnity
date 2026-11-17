(() => {
  'use strict';

  // Render-only distance culling for wilderness geometry that the vegetation
  // corridor culler does not own. Called AFTER prop batching, before any world
  // colour/depth/outline pass; gameplay visibility is restored in finally.
  if (window.WildernessDistanceCull) return;

  const DEFAULT_DISTANCE_TILES = 112; // Objects outside this distance from both player and camera may be hidden.
  const HYSTERESIS_TILES = 12; // A previously hidden mesh reappears this many tiles before the hide threshold.
  const RESCAN_MS = 750; // Scene candidates are rebuilt at most this often, accommodating newly streamed chunks.
  const VEGETATION_NAME = /(?:^|[_\s-])(tree|trees|grass|shrub|bush|berry|berries|reagent|herb|foliage|plant|vine|leaf|leaves|weed|moss)(?:[_\s-]|$)/i;
  const ACTOR_NAME = /^(npc[_-]|player(?:[_-]|$)|animal[_-]|creature[_-]|hostile[_-]|companion[_-]|mount[_-]|portrait[_-]|shoulder[_-]|held[_-])/i;
  const WORLD_NAME = /(?:^|[_\s-])(mesa|cliff|ruin|terrain|rock|floor|campfire|crate|tent|totem)(?:[_\s-]|$)/i;
  const EFFECT_NAME = /(?:^|[_\s-])(water|river|rain|sky|cloud|fog|mist|weather|particle|effect|vfx)(?:[_\s-]|$)/i;
  const EXCLUDED_BATCH_KINDS = new Set(['berry', 'reagent']); // Those batches belong to the existing vegetation system.
  const records = new WeakMap(); // Per-scene candidate lists, never retained across a disposed scene's lifetime.
  const worldBoxes = new WeakMap(); // Last known local geometry and world-matrix bounds for static candidate meshes.
  let instanceSphere = null; // Reused target for the existing authoritative InstancedMeshBounds registry.
  let hiddenHistory = new WeakMap(); // Per-mesh hysteresis, independent of logical Object3D.visible.
  let enabled = true; // Mobile A/B setting through setEnabled; defaults on in outdoor wilderness.
  let distanceTiles = DEFAULT_DISTANCE_TILES; // Editable threshold via setDistanceTiles for device-specific comparisons.
  let activeRestore = null; // Recovery if the previous render scope was interrupted.
  const stats = {
    frames: 0, scans: 0, candidates: 0, tested: 0, hidden: 0,
    hiddenChunk: 0, hiddenBatch: 0, hiddenScenery: 0, hiddenInstanced: 0,
    skippedUnknownBounds: 0, scanMs: 0, enabled: true, distanceTiles,
  }; // Counts render-suppressed meshes, NOT verified GPU draw-call savings.

  function prohibited(node) {
    const d = node.userData || {};
    const name = String(node.name || '');
    return d.hobunjiNeverDistanceCull === true
      || d.hobunjiDistanceCullNever === true
      || d.isBillboard === true
      || d.waterSurfaceRole != null
      || d.isCharacter === true
      || d.isActor === true
      || d.hobunjiHeldObjectPlane === true
      || d.hobunjiShoulderRest != null
      || VEGETATION_NAME.test(name) || ACTOR_NAME.test(name) || EFFECT_NAME.test(name)
      || d.vegetation === true || d.isVegetation === true
      || d.hobunjiZonePropKind === 'berry' || d.hobunjiZonePropKind === 'reagent';
  }

  function meshEligible(mesh, ownedByChunk, taggedWorld) {
    if (!ownedByChunk && !taggedWorld && mesh.userData?.hobunjiInstanceBounds !== true) return false;
    if (!mesh.isMesh || mesh.isSkinnedMesh) return false;
    // An InstancedMesh's base geometry box is NOT the bounds of its instances.
    if (mesh.isInstancedMesh) return mesh.userData?.hobunjiInstanceBounds === true
      && !!window.InstancedMeshBounds?.worldSphere && !!window.THREE?.Sphere;
    if (mesh.frustumCulled === false || !mesh.geometry?.attributes?.position) return false;
    if (mesh.userData?.hobunjiZonePropBatchHolder) return false;
    const originalBeforeRender = window.THREE?.Object3D?.prototype?.onBeforeRender;
    // _markTerrainEdgeId installs a render hook on world floors; the
    // TerrainRenderChunks splitter copies it to every spatial bucket.
    // Its only purpose is setting the edge-ID color when that bucket DRAWs,
    // so omitting a distant draw needs no hook. Other custom hooks remain
    // excluded because they may change geometry/matrices or game state.
    const knownTerrainEdgeHook = mesh.userData?.terrainRenderChunk === true
      && mesh.userData?.hobunjiTerrainEdgeIdColor != null;
    if (typeof mesh.onBeforeRender === 'function' && mesh.onBeforeRender !== originalBeforeRender
      && !knownTerrainEdgeHook) return false;
    return true;
  }

  function scan(scene, now) {
    const start = now;
    const candidates = []; // Derived from authoritative wilderness chunk/prop owners, never from scene-wide arbitrary actors.
    const stack = [{ node: scene, chunk: false, excluded: false }];
    while (stack.length) {
      const { node, chunk, excluded } = stack.pop();
      const data = node.userData || {};
      const isChunk = chunk || data.wildernessChunk === true;
      const isBatch = data.hobunjiZonePropBatch === true && !EXCLUDED_BATCH_KINDS.has(data.hobunjiZonePropKind);
      const taggedWorld = isBatch || data.terrainRenderChunk === true
        || data.hobunjiInstanceBounds === true
        || data.hobunjiWildernessDistanceCull === true
        || (!isChunk && WORLD_NAME.test(String(node.name || '')));
      // Scene/chunk/source names often contain map IDs such as "Cloud Forest"
      // or "River". They are structural wilderness owners, not effect/plant
      // subtrees; only explicit no-cull flags may prune their descendants.
      const isStructuralOwner = node === scene || data.wildernessChunk === true
        || data.terrainRenderChunkSource === true;
      const skip = excluded || data.hobunjiNeverDistanceCull === true
        || data.hobunjiDistanceCullNever === true
        || (!isStructuralOwner && prohibited(node));
      if (skip) continue; // Prune complete tree/actor/weather subtrees instead of walking their many meshes on every scan.
      if (meshEligible(node, isChunk, taggedWorld)) {
        candidates.push({ mesh: node, kind: isBatch ? 'batch' : isChunk ? 'chunk' : 'scenery' });
      }
      for (const child of node.children || []) stack.push({ node: child, chunk: isChunk, excluded: false });
    }
    stats.scans++;
    stats.scanMs = Math.max(0, (typeof performance !== 'undefined' ? performance.now() : now) - start);
    records.set(scene, { candidates, lastScanAt: now });
    return candidates;
  }

  function boundsFor(mesh) {
    const geometry = mesh.geometry;
    const matrix = mesh.matrixWorld?.elements;
    const position = geometry?.attributes?.position;
    if (!matrix || matrix.length !== 16 || !position) return null;
    let record = worldBoxes.get(mesh);
    const version = Number(position.version) || 0;
    const changedGeometry = !record || record.geometry !== geometry || record.version !== version;
    // TerrainRenderChunks deliberately assigns each draw-range a tight bucket
    // box. Their position attributes span the entire shared source buffer:
    // computeBoundingBox() reads ALL vertices and would inflate every bucket
    // back to whole-zone bounds, making distant terrain impossible to cull.
    const preserveSpatialBucket = mesh.userData?.terrainRenderChunk === true
      && !!geometry.boundingBox && !record;
    if (changedGeometry && !preserveSpatialBucket && typeof geometry.computeBoundingBox === 'function') {
      // A later buffer version change invalidates even a spatial bucket's
      // authored bounds; fall back to the full conservative box until rebuilt.
      geometry.computeBoundingBox();
    }
    if (!geometry.boundingBox || geometry.boundingBox.isEmpty?.()) return null;
    if (!record) {
      const Box3 = window.THREE?.Box3;
      if (!Box3) return null;
      record = { geometry: null, version: -1, matrix: new Float64Array(16), box: new Box3() };
      worldBoxes.set(mesh, record);
    }
    let moved = changedGeometry;
    if (!moved) for (let i = 0; i < 16; i++) if (record.matrix[i] !== matrix[i]) { moved = true; break; }
    if (moved) {
      record.box.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
      record.matrix.set(matrix);
      record.geometry = geometry;
      record.version = version;
    }
    return record.box;
  }

  function instancedBoundsFor(mesh) {
    if (!instanceSphere) instanceSphere = new window.THREE.Sphere();
    return window.InstancedMeshBounds?.worldSphere?.(mesh, instanceSphere) || null;
  }

  function nearestInstancedXZ(sphere, x, z) {
    // Sphere union is conservative for every instance, including rotated bricks.
    return Math.max(0, Math.hypot(sphere.center.x - x, sphere.center.z - z) - sphere.radius);
  }

  function actuallyVisibleInScene(mesh, scene) {
    // Another render system may have hidden a parent; such meshes cost no draw calls.
    for (let node = mesh; node; node = node.parent) {
      if (node.visible === false) return false;
      if (node === scene) return true;
    }
    return false;
  }

  function nearestXZ(box, x, z) {
    const dx = Math.max(box.min.x - x, 0, x - box.max.x);
    const dz = Math.max(box.min.z - z, 0, z - box.max.z);
    return Math.hypot(dx, dz);
  }

  function restore() {
    const closure = activeRestore;
    if (closure) closure();
  }

  function suspendForRender(scene, camera, playerPosition, { isZone = false } = {}) {
    restore(); // A renderer exception cannot leave visual objects hidden for gameplay.
    stats.hidden = stats.hiddenChunk = stats.hiddenBatch = stats.hiddenScenery = stats.hiddenInstanced = 0;
    stats.tested = stats.skippedUnknownBounds = 0;
    stats.candidates = 0;
    if (!enabled || !isZone || !scene?.isScene || !camera?.isCamera
      || !Number.isFinite(playerPosition?.x) || !Number.isFinite(playerPosition?.z)) return null;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let candidates, cameraX, cameraZ; // Scan and camera sampling must fail open before any earlier culler can leak visibility.
    try {
      const record = records.get(scene);
      candidates = !record || now - record.lastScanAt >= RESCAN_MS ? scan(scene, now) : record.candidates;
      stats.frames++;
      stats.candidates = candidates.length;
      camera.updateMatrixWorld?.(true); // The view may be a cutscene camera unrelated to the player's tile.
      const elements = camera.matrixWorld?.elements;
      cameraX = elements?.[12] ?? camera.position?.x;
      cameraZ = elements?.[14] ?? camera.position?.z;
    } catch (error) {
      window.__farmLog?.('Wilderness distance cull scan failed open: ' + String(error), 'warn', 'performance');
      return null;
    }
    if (!Number.isFinite(cameraX) || !Number.isFinite(cameraZ)) return null;
    const changed = []; // Only logical-true meshes; never unhide something another system intentionally hid.
    try {
      for (const { mesh, kind } of candidates) {
        if (!actuallyVisibleInScene(mesh, scene)) continue;
        const isInstance = mesh.isInstancedMesh === true;
        const bounds = isInstance ? instancedBoundsFor(mesh) : boundsFor(mesh);
        if (!bounds) { stats.skippedUnknownBounds++; continue; }
        stats.tested++;
        const limit = distanceTiles - (hiddenHistory.get(mesh) ? HYSTERESIS_TILES : 0);
        const distance = isInstance ? nearestInstancedXZ : nearestXZ;
        const farFromPlayer = distance(bounds, playerPosition.x, playerPosition.z) > limit;
        const farFromCamera = distance(bounds, cameraX, cameraZ) > limit;
        const hide = farFromPlayer && farFromCamera;
        hiddenHistory.set(mesh, hide);
        if (!hide) continue;
        mesh.visible = false;
        changed.push(mesh);
        stats.hidden++;
        if (isInstance) stats.hiddenInstanced++;
        if (kind === 'batch') stats.hiddenBatch++;
        else if (kind === 'chunk') stats.hiddenChunk++;
        else stats.hiddenScenery++;
      }
    } catch (error) {
      for (const mesh of changed) mesh.visible = true;
      stats.hidden = 0;
      window.__farmLog?.('Wilderness distance cull failed open: ' + String(error), 'warn', 'performance');
      return null;
    }
    if (!changed.length) return null;
    const release = () => {
      for (const mesh of changed) mesh.visible = true;
      changed.length = 0;
      if (activeRestore === release) activeRestore = null;
    }; // Restores exactly the render-only changes in the caller's finally.
    activeRestore = release;
    return release;
  }

  function setEnabled(value) {
    restore();
    enabled = value !== false;
    stats.enabled = enabled;
    hiddenHistory = new WeakMap(); // Reset hysteresis when toggling the comparison baseline.
    return enabled;
  }

  function setDistanceTiles(value) {
    const distance = Number(value);
    if (!Number.isFinite(distance) || distance < 32 || distance > 250) return distanceTiles;
    distanceTiles = distance;
    stats.distanceTiles = distance;
    hiddenHistory = new WeakMap(); // Changing the threshold must not inherit stale hide decisions.
    return distanceTiles;
  }

  window.WildernessDistanceCull = Object.freeze({
    suspendForRender, setEnabled, setDistanceTiles, reset: restore,
    snapshot: () => ({ ...stats, enabled, distanceTiles, hysteresisTiles: HYSTERESIS_TILES,
      scanIntervalMs: RESCAN_MS, renderOnly: true }),
  });
  window.__wildernessDistanceCullDebug = window.WildernessDistanceCull.snapshot; // Copyable from mobile in-game debug panels.
})();
