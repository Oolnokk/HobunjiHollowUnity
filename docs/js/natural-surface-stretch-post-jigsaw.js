(() => {
  'use strict';

  const THREE = window.THREE; // Used to replace TerrainRenderChunks' render wrapper with an equivalent ordered wrapper.
  const rendererProto = THREE?.WebGLRenderer?.prototype;
  const terrainRender = rendererProto?.render; // Used as the installed TerrainRenderChunks wrapper we are ordering around.
  if (!rendererProto || typeof terrainRender !== 'function') return;
  if (terrainRender.__hobunjiNaturalSurfacePostJigsawWrapped) return;
  if (!terrainRender.__hobunjiTerrainSurfaceWrapped) return;

  const originalRender = terrainRender.__hobunjiTerrainSurfaceOriginal; // Used to preserve every renderer wrapper that existed before TerrainRenderChunks.
  const jigsawApi = window.TerrainJigsawUV; // Used to run the exact public jigsaw scan before natural-surface reassertion.
  const chunkApi = window.TerrainRenderChunks; // Used to keep the existing spatial chunk scan after final natural UVs are restored.
  const runtime = window.NaturalSurfaceStretchRuntime; // Used to repair stranded 4x4 maps and restore surface-island UVs before chunking/render.
  if (typeof originalRender !== 'function' || !jigsawApi?.scanScene || !chunkApi?.scanScene || !runtime?.inspectObject) return;

  const stats = {
    renderPasses: 0,
    jigsawMutations: 0,
    postJigsawInspections: 0,
    chunkMutations: 0,
    terrainGeometryNotifications: 0,
    manualJigsawCalls: 0,
  }; // Used by snapshot() for mobile-visible verification of the final ordering guard.

  function debugLog(message, level = 'info') {
    const text = `[surface-stretch-post-jigsaw] ${message}`; // Used as the final terrain-UV ordering diagnostic prefix.
    if (typeof window.__farmLog === 'function') window.__farmLog(text, level, 'render');
    else if (level === 'warn') console.warn(text);
    else console.debug(text);
  }

  function inspectSceneTerrain(scene) {
    if (!scene?.isScene) return 0;
    let inspected = 0; // Used to report how many top-level terrain roots were checked after a jigsaw mutation.
    for (const object of scene.children.slice()) {
      if (!object) continue;
      runtime.inspectObject(object);
      inspected++;
    }
    stats.postJigsawInspections += inspected;
    return inspected;
  }

  // Duplicates TerrainRenderChunks' small notification seam because this final
  // wrapper deliberately bypasses only its outer render function. The public
  // jigsaw/chunk scans remain the same APIs and the pre-chunker renderer stays
  // untouched.
  function notifyTerrainGeometryReady(scene) {
    if (!scene?.isScene) return 0;
    let notified = 0; // Used to preserve runtime tile-owner geometry updates after jigsaw/chunk mutation.
    for (const mesh of scene.children) {
      const callback = mesh?.userData?.onTerrainGeometryReady;
      if (typeof callback !== 'function') continue;
      const revision = Number(mesh.userData.terrainGeometryRevision) || 0; // Used to detect jigsaw replacement and spatial index reordering.
      if (mesh.userData.terrainGeometryReadyRevision === revision) continue;
      const renderedChunk = mesh.children?.find?.(child => child.userData?.terrainRenderChunk); // Used as the shared GPU-facing geometry after spatial splitting.
      const geometry = renderedChunk?.geometry || mesh.geometry; // Used as the final rendered geometry returned to the terrain owner.
      if (!geometry?.index) continue;
      callback(geometry);
      mesh.userData.terrainGeometryReadyRevision = revision;
      notified++;
    }
    stats.terrainGeometryNotifications += notified;
    return notified;
  }

  function wrappedRender(scene, camera) {
    const now = performance.now(); // Used so both terrain scanners share one timestamp just like the original TerrainRenderChunks wrapper.
    stats.renderPasses++;

    const jigsawMade = Number(jigsawApi.scanScene(scene, now)) || 0; // Runs legacy/general terrain jigsaw first because it may clone maps and replace UV geometry.
    if (jigsawMade) {
      stats.jigsawMutations += jigsawMade;
      // Critical ordering: repair/reassert BEFORE spatial chunking. Chunk meshes
      // then inherit the final material/geometry instead of cloning a stranded
      // 4x4 texture or requiring a dangerous post-chunk whole-geometry unwrap.
      inspectSceneTerrain(scene);
    }

    const chunksMade = Number(chunkApi.scanScene(scene, now)) || 0; // Runs after natural surfaces have reclaimed their final texture and UV ownership.
    if (chunksMade) stats.chunkMutations += chunksMade;
    notifyTerrainGeometryReady(scene);
    return originalRender.call(this, scene, camera);
  }

  wrappedRender.__hobunjiNaturalSurfacePostJigsawWrapped = true;
  wrappedRender.__hobunjiNaturalSurfacePostJigsawOriginal = terrainRender;
  wrappedRender.__hobunjiTerrainSurfaceWrapped = true; // Preserves feature-detection compatibility for code that checks TerrainRenderChunks' marker.
  wrappedRender.__hobunjiTerrainSurfaceOriginal = originalRender;
  wrappedRender.__hobunjiTerrainChunkApi = chunkApi;
  wrappedRender.__hobunjiTerrainJigsawApi = jigsawApi;
  rendererProto.render = wrappedRender;

  // Public/manual bakeMesh callers do not pass through scanScene, so inspect the
  // target immediately afterward too. The internal automatic scanner still uses
  // its lexical bakeMesh and is handled by wrappedRender above.
  const previousBakeMesh = jigsawApi.bakeMesh;
  if (typeof previousBakeMesh === 'function' && !previousBakeMesh.__hobunjiNaturalSurfacePostJigsawWrapped) {
    function wrappedBakeMesh(mesh, ...args) {
      const result = previousBakeMesh.call(this, mesh, ...args);
      stats.manualJigsawCalls++;
      if (result && mesh) runtime.inspectObject(mesh);
      return result;
    }
    wrappedBakeMesh.__hobunjiNaturalSurfacePostJigsawWrapped = true;
    wrappedBakeMesh.__hobunjiNaturalSurfacePostJigsawOriginal = previousBakeMesh;
    jigsawApi.bakeMesh = wrappedBakeMesh;
  }

  window.NaturalSurfaceStretchPostJigsaw = {
    installed: true,
    inspectSceneTerrain,
    snapshot() {
      return Object.assign({}, stats, {
        runtime: runtime.snapshot?.() || null,
        jigsaw: jigsawApi.snapshot?.() || null,
        chunks: chunkApi.snapshot?.() || null,
      });
    },
  };

  debugLog('installed: Terrain Jigsaw runs first, natural rock/cliff texture+UV repair runs second, spatial chunking runs third, then the frame renders.');
})();