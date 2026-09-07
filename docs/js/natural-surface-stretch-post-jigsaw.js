(() => {
  'use strict';

  const THREE = window.THREE; // Used to recognize terrain geometry and preserve the renderer wrapper ordering below.
  if (!THREE) return;

  const FRAME_SOURCE_EDGE_FRACTION = 0.16; // Used as the outer 16% of the PNG that stays visually concentrated along detected surface boundaries.
  const FRAME_SURFACE_EDGE_FRACTION = 0.06; // Used as the narrow solved-UV band that receives each protected PNG edge, leaving the center to absorb most stretch.
  const FRAME_DEBUG_HISTORY_LIMIT = 16; // Used to keep mobile-visible perimeter-frame diagnostics bounded.
  const frameStats = {
    installed: false,
    mapGeometryCalls: 0,
    mapMeshCalls: 0,
    remapCalls: 0,
    capHintsIgnored: 0,
    warpedGeometries: 0,
    warpedUvs: 0,
    successLogs: 0,
    recent: [],
  }; // Used by HobunjiSurfacePerimeterFrame.snapshot() for mobile-visible verification without DevTools.

  function debugLog(message, level = 'info') {
    const text = `[surface-stretch-post-jigsaw] ${message}`; // Used as the final terrain-UV ordering/perimeter diagnostic prefix.
    if (typeof window.__farmLog === 'function') window.__farmLog(text, level, 'render');
    else if (level === 'warn') console.warn(text);
    else console.debug(text);
  }

  function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }

  function frameRemapCoordinate(value) {
    const t = clamp01(value); // Used as the existing continuous square-domain UV before edge preservation is applied.
    const sourceEdge = FRAME_SOURCE_EDGE_FRACTION; // Used as the protected raw-PNG edge width on this axis.
    const surfaceEdge = FRAME_SURFACE_EDGE_FRACTION; // Used as the much narrower rendered-surface band occupied by that raw-PNG edge.
    if (t <= surfaceEdge) return (t / surfaceEdge) * sourceEdge;
    if (t >= 1 - surfaceEdge) return 1 - sourceEdge + ((t - (1 - surfaceEdge)) / surfaceEdge) * sourceEdge;
    return sourceEdge + ((t - surfaceEdge) / (1 - surfaceEdge * 2)) * (1 - sourceEdge * 2);
  }

  function cleanSurfaceMappingOptions(options) {
    const next = Object.assign({}, options || {}); // Used so existing farm/wilderness callers are not mutated when their obsolete patch cap is ignored.
    if (Object.prototype.hasOwnProperty.call(next, 'maxPatchWorldSize')) {
      delete next.maxPatchWorldSize;
      frameStats.capHintsIgnored++;
    }
    return next;
  }

  function selectedUvRanges(geometry, materialIndex, uvCount) {
    if (materialIndex == null) return [[0, uvCount]]; // Used for ordinary single-material rock/cliff meshes whose complete UV domain belongs to the detected surfaces.
    const groups = Array.isArray(geometry?.groups) ? geometry.groups : []; // Used to preserve grass/top UVs on shared plateau geometry.
    if (!groups.length) return Number(materialIndex) === 0 ? [[0, uvCount]] : [];
    const ranges = []; // Used as non-indexed vertex spans belonging only to the requested cliff material slot.
    for (const group of groups) {
      if (Number(group.materialIndex || 0) !== Number(materialIndex)) continue;
      const start = Math.max(0, Math.min(uvCount, Number(group.start) || 0)); // Used as the first target UV vertex after surface mapper non-indexing.
      const end = Math.max(start, Math.min(uvCount, start + Math.max(0, Number(group.count) || 0))); // Used as the exclusive target UV vertex bound.
      if (end > start) ranges.push([start, end]);
    }
    return ranges;
  }

  function applyPerimeterFrame(geometry, report, force = false, label = '') {
    const uv = geometry?.getAttribute?.('uv') || geometry?.attributes?.uv; // Used as the solved surface-island UVs that already follow one continuous outer loop.
    if (!geometry || !uv || Number(uv.itemSize || 0) < 2 || !report) return false;
    geometry.userData = Object.assign({}, geometry.userData || {});
    const baseSignature = String(geometry.userData.hobunjiSurfaceStretchSignature || ''); // Used to invalidate an old frame marker whenever the underlying island unwrap is rebuilt.
    const materialIndex = report.materialIndex == null ? null : Number(report.materialIndex); // Used to keep non-cliff material slots untouched.
    const frameSignature = `perimeter-frame-v1|base=${baseSignature}|material=${materialIndex == null ? '*' : materialIndex}|source=${FRAME_SOURCE_EDGE_FRACTION}|surface=${FRAME_SURFACE_EDGE_FRACTION}`; // Used to prevent repeated piecewise warps of already-framed UVs.
    if (!force && geometry.userData.hobunjiSurfacePerimeterFrameSignature === frameSignature) return false;

    const ranges = selectedUvRanges(geometry, materialIndex, uv.count); // Used to warp only the UV vertices owned by this natural-surface mapping pass.
    let warped = 0; // Used by mobile diagnostics to prove the final UV buffer was actually rewritten.
    for (const [start, end] of ranges) {
      for (let index = start; index < end; index++) {
        uv.setXY(index, frameRemapCoordinate(uv.getX(index)), frameRemapCoordinate(uv.getY(index)));
        warped++;
      }
    }
    if (!warped) return false;

    uv.needsUpdate = true;
    geometry.userData.hobunjiSurfacePerimeterFrameSignature = frameSignature;
    geometry.userData.hobunjiSurfacePerimeterFrame = {
      version: 1,
      mapping: 'continuous-detected-surface-perimeter',
      sourceEdgeFraction: FRAME_SOURCE_EDGE_FRACTION,
      surfaceEdgeFraction: FRAME_SURFACE_EDGE_FRACTION,
      materialIndex,
      warpedUvCount: warped,
      ignoredPatchSplitting: true,
    };
    report.perimeterFrame = Object.assign({}, geometry.userData.hobunjiSurfacePerimeterFrame); // Used to expose the frame treatment through the existing mapper report/debug path.
    frameStats.warpedGeometries++;
    frameStats.warpedUvs += warped;
    const entry = { label: label || '(surface)', patchCount: report.patchCount, materialIndex, warpedUvCount: warped }; // Used by snapshot() to show recent final mappings on mobile.
    frameStats.recent.push(entry);
    while (frameStats.recent.length > FRAME_DEBUG_HISTORY_LIMIT) frameStats.recent.shift();
    if (frameStats.successLogs < 8) {
      frameStats.successLogs++;
      debugLog(`${entry.label}: continuous detected-surface perimeter frame applied to ${warped} UV vertex/vertices; PNG outer ${(FRAME_SOURCE_EDGE_FRACTION * 100).toFixed(0)}% compressed into ${(FRAME_SURFACE_EDGE_FRACTION * 100).toFixed(0)}% surface bands.`);
    }
    return true;
  }

  function installContinuousPerimeterFrameMapper() {
    const mapper = window.HobunjiSurfaceStretchUV; // Used as the existing furniture-style shared-edge detector and irregular perimeter square mapper.
    if (!mapper?.installed || mapper.__continuousPerimeterFrameWrapped) return mapper || null;

    const originalMapGeometry = mapper.mapGeometry; // Used to preserve direct/tests callers while discarding only the obsolete spatial patch-split hint.
    if (typeof originalMapGeometry === 'function') {
      mapper.mapGeometry = function (sourceGeometry, options = {}) {
        frameStats.mapGeometryCalls++;
        const mapped = originalMapGeometry.call(this, sourceGeometry, cleanSurfaceMappingOptions(options));
        const report = mapped?.userData?.hobunjiSurfaceStretch || null; // Used as the detected-surface report produced by the authoritative mapper.
        if (report) applyPerimeterFrame(mapped, report, mapped !== sourceGeometry, options.label || 'mapGeometry');
        return mapped;
      };
      mapper.mapGeometry.__continuousPerimeterFrameOriginal = originalMapGeometry;
    }

    const originalMapMesh = mapper.mapMesh; // Used by farm/wilderness final passes, which previously supplied maxPatchWorldSize=6 and restarted the PNG every six units.
    if (typeof originalMapMesh === 'function') {
      mapper.mapMesh = function (mesh, options = {}) {
        frameStats.mapMeshCalls++;
        const beforeGeometry = mesh?.geometry || null; // Used to force one frame warp when the base mapper regenerated geometry during this call.
        const report = originalMapMesh.call(this, mesh, cleanSurfaceMappingOptions(options));
        if (report && mesh?.geometry) applyPerimeterFrame(mesh.geometry, report, mesh.geometry !== beforeGeometry, options.label || mesh.name || 'mapMesh');
        return report;
      };
      mapper.mapMesh.__continuousPerimeterFrameOriginal = originalMapMesh;
    }

    const originalRemap = mapper.remapNaturalTerrainMesh; // Used by runtime repair after jigsaw/chunk mutations so later self-healing cannot restore the old uniformly-stretched UVs.
    if (typeof originalRemap === 'function') {
      mapper.remapNaturalTerrainMesh = function (mesh, label = '') {
        frameStats.remapCalls++;
        const beforeGeometry = mesh?.geometry || null; // Used to distinguish a fresh unwrap from a cached reassertion.
        const report = originalRemap.call(this, mesh, label);
        if (report && mesh?.geometry) applyPerimeterFrame(mesh.geometry, report, mesh.geometry !== beforeGeometry, label || mesh.name || 'runtime-remap');
        return report;
      };
      mapper.remapNaturalTerrainMesh.__continuousPerimeterFrameOriginal = originalRemap;
    }

    mapper.__continuousPerimeterFrameWrapped = true;
    frameStats.installed = true;
    window.HobunjiSurfacePerimeterFrame = {
      installed: true,
      sourceEdgeFraction: FRAME_SOURCE_EDGE_FRACTION,
      surfaceEdgeFraction: FRAME_SURFACE_EDGE_FRACTION,
      applyPerimeterFrame,
      snapshot() {
        return Object.assign({}, frameStats, { recent: frameStats.recent.slice() });
      },
    };
    debugLog(`continuous perimeter frame mapper installed: connected detected surfaces ignore maxPatchWorldSize and keep one PNG perimeter across all constituent mesh edges.`);
    return mapper;
  }

  installContinuousPerimeterFrameMapper();

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
        perimeterFrame: window.HobunjiSurfacePerimeterFrame?.snapshot?.() || null,
        runtime: runtime.snapshot?.() || null,
        jigsaw: jigsawApi.snapshot?.() || null,
        chunks: chunkApi.snapshot?.() || null,
      });
    },
  };

  debugLog('installed: Terrain Jigsaw runs first, natural rock/cliff texture+UV repair runs second, spatial chunking runs third, then the frame renders; detected cliff surfaces keep one continuous PNG perimeter frame.');
})();