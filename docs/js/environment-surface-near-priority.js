(() => {
  'use strict';

  const PATCH_KEY = '__environmentSurfaceNearPriorityV2'; // Prevents duplicate RainPlanes wrappers when the diagnostic entrypoint is reloaded.
  const MIN_BOOT_DELAY_MS = 900; // Gives save restoration/player placement time to settle before the one-time queue reseed.
  const PLAYER_SETTLE_MS = 250; // Requires a short stable-position window so initial spawn coordinates cannot define the snow order.
  const FORCE_PRIORITY_AFTER_MS = 2200; // Guarantees prioritization even if the player is already walking during startup.
  const PLAYER_STABLE_DISTANCE_SQ = 0.04; // Treats sub-0.2-tile movement as stable for startup ordering purposes.
  const RAIN_UPDATE_STALL_MS = 55; // If RainPlanes has not ticked for this long while snow work remains, the RAF watchdog advances one bounded runtime slice.

  let deps = null; // Captured from RainPlanes.init so this adapter can rank spatial terrain chunks by the real player position.
  let initializedAt = 0; // Monotonic timestamp used to avoid sorting against transient pre-save player coordinates.
  let prioritizedScene = null; // Ensures each active scene is reseeded only after its loaded player position has settled.
  let prioritizedArea = null; // Distinguishes a reused scene object after an area transition.
  let priorityPlayer = null; // World/tile-space player position actually used for the successful sort, exposed to Pixel Probe.
  let nearestChunk = null; // Name of the closest renderer chunk at the moment priority was applied.
  let reorderedSources = 0; // Exposed for the Pixel Probe diagnostic line.
  let reorderedChunks = 0; // Exposed for the Pixel Probe diagnostic line.
  let lastReason = 'awaiting RainPlanes init'; // Human-readable status for mobile diagnostics.
  let lastPlayerSample = null; // Most recent world-space player sample used to detect startup-position settling.
  let playerStableSince = 0; // Timestamp when the current near-identical player-position run began.
  let rainUpdateCalls = 0; // Counts real game calls into RainPlanes.update so the probe can expose its effective cadence.
  let assistUpdateCalls = 0; // Counts RAF watchdog calls into EnvironmentSurfaceRuntime.update when the rain-linked tick stalls.
  let lastRainUpdateAt = -Infinity; // Monotonic timestamp of the most recent real RainPlanes.update call.
  let watchdogStarted = false; // Prevents scheduling more than one RAF watchdog loop.

  function now() {
    return globalThis.performance?.now?.() ?? Date.now();
  }

  function playerWorldPosition() {
    const tile = Number(deps?.TILE) || 1; // Converts the player's simulation coordinates back into the Three.js tile/world coordinate system.
    const player = deps?.player;
    if (!player || !Number.isFinite(Number(player.x)) || !Number.isFinite(Number(player.y))) return null;
    return { x: Number(player.x) / tile, z: Number(player.y) / tile };
  }

  function chunkDistanceSq(chunk, player) {
    const geometry = chunk?.geometry;
    if (!geometry?.attributes?.position || !player) return Number.POSITIVE_INFINITY;
    if (!geometry.boundingBox) geometry.computeBoundingBox?.();
    const box = geometry.boundingBox;
    if (!box) return Number.POSITIVE_INFINITY;
    chunk.updateWorldMatrix?.(true, false);
    const center = box.getCenter(new deps.THREE.Vector3()); // Uses the renderer chunk's bucket-specific bounding box, not the original full-zone bounds.
    center.applyMatrix4(chunk.matrixWorld);
    const dx = center.x - player.x;
    const dz = center.z - player.z;
    return dx * dx + dz * dz;
  }

  function nearestDistanceSqForSource(source, player) {
    let nearest = Number.POSITIVE_INFINITY; // Ranks source wrappers while preserving non-source scene-child positions.
    for (const child of source?.children || []) {
      if (child?.userData?.terrainRenderChunk !== true) continue;
      nearest = Math.min(nearest, chunkDistanceSq(child, player));
    }
    return nearest;
  }

  function nearestSpatialChunk(scene, player) {
    let best = null; // Stores the nearest chunk and squared distance for diagnostics without changing generation policy.
    for (const source of scene?.children || []) {
      if (source?.userData?.terrainRenderChunkSource !== true) continue;
      for (const chunk of source.children || []) {
        if (chunk?.userData?.terrainRenderChunk !== true) continue;
        const distanceSq = chunkDistanceSq(chunk, player);
        if (!best || distanceSq < best.distanceSq) best = { chunk, distanceSq };
      }
    }
    return best;
  }

  function reorderSpatialChunksNearestFirst(scene, player) {
    if (!scene?.children || !player || !deps?.THREE) return { sources: 0, chunks: 0 };

    const sources = scene.children.filter(child => child?.userData?.terrainRenderChunkSource === true); // TerrainRenderChunks keeps each emptied source mesh as the direct scene wrapper for its spatial children.
    let sourceChanges = 0; // Counts wrappers whose child order actually changed.
    let chunkChanges = 0; // Counts spatial child positions that moved.

    for (const source of sources) {
      const spatial = (source.children || []).filter(child => child?.userData?.terrainRenderChunk === true);
      if (spatial.length < 2) continue;
      const ordered = spatial
        .map((chunk, index) => ({ chunk, index, distanceSq: chunkDistanceSq(chunk, player) })) // Captures stable original order for ties.
        .sort((a, b) => a.distanceSq - b.distanceSq || a.index - b.index)
        .map(entry => entry.chunk);
      let changed = false;
      for (let i = 0; i < ordered.length; i++) {
        if (ordered[i] !== spatial[i]) { changed = true; chunkChanges++; }
      }
      if (!changed) continue;

      const spatialSet = new Set(spatial); // Replaces only renderer chunk slots; non-spatial helper children stay exactly where they were.
      let nextSpatial = 0;
      source.children = source.children.map(child => spatialSet.has(child) ? ordered[nextSpatial++] : child);
      sourceChanges++;
    }

    if (sources.length > 1) {
      const sourceSlots = scene.children.map((child, index) => child?.userData?.terrainRenderChunkSource === true ? index : -1).filter(index => index >= 0); // Keeps every non-terrain scene child at its original index.
      const orderedSources = sources
        .map((source, index) => ({ source, index, distanceSq: nearestDistanceSqForSource(source, player) }))
        .sort((a, b) => a.distanceSq - b.distanceSq || a.index - b.index)
        .map(entry => entry.source);
      for (let i = 0; i < sourceSlots.length; i++) scene.children[sourceSlots[i]] = orderedSources[i];
    }

    return { sources: sourceChanges, chunks: chunkChanges };
  }

  function updatePlayerStability(player, time) {
    if (!player) return false;
    if (!lastPlayerSample) {
      lastPlayerSample = { ...player };
      playerStableSince = time;
      return false;
    }
    const dx = player.x - lastPlayerSample.x;
    const dz = player.z - lastPlayerSample.z;
    if (dx * dx + dz * dz > PLAYER_STABLE_DISTANCE_SQ) playerStableSince = time;
    lastPlayerSample = { ...player };
    return time - playerStableSince >= PLAYER_SETTLE_MS;
  }

  function maybePrioritize(time = now()) {
    const scene = deps?.getActiveScene?.() || null;
    const area = String(deps?.getCurrentArea?.() || '');
    const runtime = window.EnvironmentSurfaceRuntime;
    const snapshot = runtime?.debugSnapshot?.();
    if (!scene || !snapshot?.initialized || snapshot.mode === 'none') return;
    if (scene === prioritizedScene && area === prioritizedArea) return;

    const hasSpatialChunks = scene.children?.some(child => child?.userData?.terrainRenderChunkSource === true && child.children?.some(spatial => spatial?.userData?.terrainRenderChunk === true)); // Waits until the renderer has actually split at least one giant terrain source.
    if (!hasSpatialChunks) {
      lastReason = `${area || '(unknown area)'}: waiting for renderer spatial chunks`;
      return;
    }

    const player = playerWorldPosition();
    if (!player) {
      lastReason = `${area || '(unknown area)'}: waiting for valid player coordinates`;
      return;
    }
    const stable = updatePlayerStability(player, time);
    const bootAge = time - initializedAt;
    if (bootAge < MIN_BOOT_DELAY_MS || (!stable && bootAge < FORCE_PRIORITY_AFTER_MS)) {
      lastReason = `${area || '(unknown area)'}: waiting for loaded player position (${Math.max(0, Math.round(bootAge))}ms)`;
      return;
    }

    const closest = nearestSpatialChunk(scene, player);
    const result = reorderSpatialChunksNearestFirst(scene, player);
    prioritizedScene = scene;
    prioritizedArea = area;
    priorityPlayer = { ...player };
    nearestChunk = closest?.chunk?.name || null;
    reorderedSources += result.sources;
    reorderedChunks += result.chunks;
    lastReason = `${area || '(unknown area)'}: prioritized around (${player.x.toFixed(2)},${player.z.toFixed(2)}) nearest=${nearestChunk || '-'} (${result.sources} source wrappers, ${result.chunks} moved chunk slots)`;
    runtime.forceRebuild?.('settled near-player spatial priority bootstrap'); // Clears the stale boot-position queue and reseeds from the loaded player's actual location.
  }

  function runtimeNeedsWork(state) {
    return Boolean(state && state.initialized && state.mode !== 'none' && (Number(state.pendingJobs) > 0 || state.activeJob || state.shellDirty || state.shellInProgress));
  }

  function watchdogFrame(time) {
    const runtime = window.EnvironmentSurfaceRuntime;
    const state = runtime?.debugSnapshot?.();
    maybePrioritize(time);
    if (runtimeNeedsWork(state) && time - lastRainUpdateAt > RAIN_UPDATE_STALL_MS && typeof runtime?.update === 'function') {
      runtime.update(); // Uses the runtime's own 1.25ms/160-triangle limits; this only supplies a missing frame tick, not extra unbounded work.
      assistUpdateCalls++;
    }
    requestAnimationFrame(watchdogFrame);
  }

  function ensureWatchdog() {
    if (watchdogStarted || typeof requestAnimationFrame !== 'function') return;
    watchdogStarted = true;
    requestAnimationFrame(watchdogFrame);
  }

  function patchRainPlanes() {
    const rain = window.RainPlanes;
    if (!rain?.init || !rain?.update || rain[PATCH_KEY]) return false;
    const priorInit = rain.init; // Preserves EnvironmentSurfaceRuntime/SkyDome wrappers already installed before this diagnostic adapter.
    const priorUpdate = rain.update; // Preserves all earlier rain-linked update work before applying the settled-position priority/watchdog layer.
    rain.init = function environmentSurfacePriorityInit(injectedDeps) {
      deps = injectedDeps;
      initializedAt = now();
      prioritizedScene = null;
      prioritizedArea = null;
      priorityPlayer = null;
      nearestChunk = null;
      lastPlayerSample = null;
      playerStableSince = initializedAt;
      rainUpdateCalls = 0;
      assistUpdateCalls = 0;
      lastRainUpdateAt = initializedAt;
      lastReason = 'RainPlanes initialized; waiting for loaded player position and spatial chunks';
      const value = priorInit.call(this, injectedDeps);
      ensureWatchdog();
      return value;
    };
    rain.update = function environmentSurfacePriorityUpdate(dt) {
      rainUpdateCalls++;
      lastRainUpdateAt = now();
      const result = priorUpdate.call(this, dt);
      maybePrioritize(lastRainUpdateAt);
      return result;
    };
    rain[PATCH_KEY] = true;
    return true;
  }

  function debugSnapshot() {
    const time = now();
    return {
      installed: true,
      initialized: Boolean(deps),
      prioritized: Boolean(prioritizedScene),
      area: prioritizedArea || deps?.getCurrentArea?.() || null,
      priorityPlayer,
      nearestChunk,
      reorderedSources,
      reorderedChunks,
      rainUpdateCalls,
      assistUpdateCalls,
      rainGapMs: Number.isFinite(lastRainUpdateAt) ? Math.max(0, Math.round(time - lastRainUpdateAt)) : null,
      lastReason,
    };
  }

  window.EnvironmentSurfaceNearPriority = Object.freeze({ debugSnapshot, force: () => {
    prioritizedScene = null;
    prioritizedArea = null;
    priorityPlayer = null;
    nearestChunk = null;
    initializedAt = Math.min(initializedAt || now(), now() - FORCE_PRIORITY_AFTER_MS);
    playerStableSince = now() - PLAYER_SETTLE_MS;
    maybePrioritize();
    return debugSnapshot();
  } }); // Exposed for the mobile Pixel Probe line and manual one-shot retests.

  if (!patchRainPlanes()) console.warn('[environment surface priority] RainPlanes unavailable; diagnostic priority adapter not installed.');
})();
