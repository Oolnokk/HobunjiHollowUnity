(() => {
  'use strict';

  const THREE = window.THREE; // Used to recognize terrain geometry and preserve the renderer wrapper ordering below.
  if (!THREE) return;

  const FRAME_SOURCE_EDGE_FRACTION = 0.16; // Used as the outer 16% of the PNG that stays visually concentrated along detected surface boundaries.
  const FRAME_SURFACE_EDGE_FRACTION = 0.06; // Used as the narrow solved-UV band that receives each protected PNG edge, leaving the center to absorb most stretch.
  const FRAME_DEBUG_HISTORY_LIMIT = 16; // Used to keep mobile-visible perimeter-frame diagnostics bounded.
  const CROSS_MESH_UV_OWNER = 'plateau-cliff-cross-mesh-v1'; // Used to keep runtime per-mesh repair from splitting a batch-solved plateau cliff back apart.
  const PLATEAU_CLIFF_MATERIAL_SLOT = 1; // Used by ZonePlateauMesa: slot 0 is the walkable top and slot 1 is the steep cliff surface.
  const frameStats = {
    installed: false,
    mapGeometryCalls: 0,
    mapMeshCalls: 0,
    remapCalls: 0,
    capHintsIgnored: 0,
    warpedGeometries: 0,
    warpedUvs: 0,
    crossMeshBatches: 0,
    crossMeshMeshes: 0,
    crossMeshUvVertices: 0,
    crossMeshRuntimeSkips: 0,
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

  function geometryHasValidUvs(geometry) {
    const position = geometry?.getAttribute?.('position') || geometry?.attributes?.position; // Used as the authoritative vertex-count reference for cross-mesh ownership.
    const uv = geometry?.getAttribute?.('uv') || geometry?.attributes?.uv; // Used to avoid preserving a cross-mesh marker after UV data was actually lost.
    return !!(position && uv && uv.count === position.count && Number(uv.itemSize || 0) >= 2);
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
        if (mesh?.userData?.naturalSurfaceCrossMeshUvOwner === CROSS_MESH_UV_OWNER && geometryHasValidUvs(mesh.geometry)) {
          frameStats.crossMeshRuntimeSkips++;
          return mesh.geometry?.userData?.hobunjiSurfaceStretch || null;
        }
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

  function ensureIndependentPlateauGeometry(mesh) {
    const source = mesh?.geometry; // Used as the current per-mesh wilderness result after the normal final surface pass.
    if (!source?.getAttribute?.('position')) return null;
    const geometry = source.index ? source.toNonIndexed() : source.clone(); // Used so cliff-slot corners can receive cross-mesh UVs without changing grass corners that shared indexed vertices.
    const position = geometry.getAttribute('position'); // Used as the final per-corner position buffer for this plateau mesh.
    let uv = geometry.getAttribute('uv'); // Used as the writable per-corner UV buffer; existing grass UVs are preserved when present.
    if (!uv || uv.count !== position.count || Number(uv.itemSize || 0) < 2) {
      const seed = new Float32Array(position.count * 2); // Used to restore ZonePlateauMesa's original world-X/Z grass UV convention before cliff-only values overwrite slot 1.
      for (let index = 0; index < position.count; index++) {
        seed[index * 2] = position.getX(index);
        seed[index * 2 + 1] = position.getZ(index);
      }
      uv = new THREE.Float32BufferAttribute(seed, 2); // Used to repair the exact Pixel Probe no-UV state without collapsing the plateau-top texture.
      geometry.setAttribute('uv', uv);
    }
    geometry.userData = Object.assign({}, source.userData || {}, geometry.userData || {});
    delete geometry.userData.hobunjiSurfaceStretchSignature;
    delete geometry.userData.hobunjiSurfacePerimeterFrameSignature;
    mesh.geometry = geometry;
    return geometry;
  }

  function mapTouchingPlateauCliffBatch(meshes, label = 'plateau-cross-mesh') {
    const mapper = window.HobunjiSurfaceStretchUV; // Used to run the same shared-edge surface detector once across every touching mesa cliff in the zone.
    if (typeof mapper?.mapGeometry !== 'function') return false;
    const candidates = (meshes || []).filter(mesh => mesh?.isMesh && Array.isArray(mesh.material) && mesh.material[PLATEAU_CLIFF_MATERIAL_SLOT] && mesh.geometry); // Used to exclude unrelated meshes captured during a zone rebuild.
    if (candidates.length < 2) return false;

    const positions = []; // Used as one temporary world-space triangle soup spanning every plateau cliff-slot mesh in this batch.
    const targets = []; // Used to copy each solved combined UV back to its exact source mesh vertex afterward.
    const touched = new Map(); // Used to mark each source UV attribute once after all copied writes finish.
    const point = new THREE.Vector3(); // Reused while transforming local plateau vertices into common world space.

    for (const mesh of candidates) {
      const geometry = ensureIndependentPlateauGeometry(mesh); // Used to make grass and cliff corners independently writable before cross-mesh solving.
      const position = geometry?.getAttribute?.('position');
      const uv = geometry?.getAttribute?.('uv');
      if (!position || !uv) continue;
      mesh.updateMatrixWorld?.(true);
      const ranges = selectedUvRanges(geometry, PLATEAU_CLIFF_MATERIAL_SLOT, position.count); // Used to include only the actual cliff-side material slot.
      for (const [start, end] of ranges) {
        for (let index = start; index < end; index++) {
          point.set(position.getX(index), position.getY(index), position.getZ(index));
          if (mesh.matrixWorld) point.applyMatrix4(mesh.matrixWorld);
          positions.push(point.x, point.y, point.z);
          targets.push({ mesh, geometry, uv, index });
        }
      }
      if (ranges.length) touched.set(mesh, { geometry, uv });
    }
    if (targets.length < 6 || targets.length % 3 !== 0) return false;

    const combined = new THREE.BufferGeometry(); // Used only as a temporary cross-mesh topology carrier; never enters the scene.
    combined.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mapped = mapper.mapGeometry(combined, { label: `${label}:touching-mesh-batch` }); // Shared position keys now cancel touching mesh seams as internal edges.
    const mappedUv = mapped?.getAttribute?.('uv');
    const report = mapped?.userData?.hobunjiSurfaceStretch || null;
    if (!mappedUv || mappedUv.count !== targets.length || !report) {
      if (mapped && mapped !== combined) mapped.dispose?.();
      combined.dispose?.();
      return false;
    }

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      target.uv.setXY(target.index, mappedUv.getX(i), mappedUv.getY(i));
    }
    const batchSignature = `cross-mesh-surface-v1|meshes=${touched.size}|surfaces=${report.patchCount}|uvs=${targets.length}`; // Used by runtime repair to recognize this final batch-owned solve.
    for (const [mesh, state] of touched) {
      state.uv.needsUpdate = true;
      state.geometry.userData = Object.assign({}, state.geometry.userData || {}, {
        hobunjiSurfaceStretchSignature: batchSignature,
        hobunjiSurfaceStretch: {
          version: 3,
          segmentation: 'cross-mesh-furniture-edge-adjacency',
          angleToleranceDeg: report.angleToleranceDeg,
          materialIndex: PLATEAU_CLIFF_MATERIAL_SLOT,
          maxPatchWorldSize: null,
          patchCount: report.patchCount,
          fallbackCount: report.fallbackCount,
          boundaryLoopCount: report.boundaryLoopCount,
          crossMeshBatch: true,
          crossMeshCount: touched.size,
        },
        hobunjiSurfacePerimeterFrame: Object.assign({}, mapped.userData?.hobunjiSurfacePerimeterFrame || report.perimeterFrame || {}, {
          mapping: 'continuous-detected-surface-perimeter-cross-mesh',
          materialIndex: PLATEAU_CLIFF_MATERIAL_SLOT,
        }),
      });
      delete state.geometry.userData.hobunjiSurfacePerimeterFrameSignature; // Combined geometry owns the temporary signature; source meshes use the cross-mesh owner marker instead.
      mesh.userData = Object.assign({}, mesh.userData || {}, {
        naturalSurfaceCrossMeshUvOwner: CROSS_MESH_UV_OWNER,
        naturalSurfaceCrossMeshUvBatch: batchSignature,
        terrainJigsawIgnore: true,
      });
    }

    frameStats.crossMeshBatches++;
    frameStats.crossMeshMeshes += touched.size;
    frameStats.crossMeshUvVertices += targets.length;
    frameStats.recent.push({ label: `${label}:cross-mesh`, patchCount: report.patchCount, materialIndex: PLATEAU_CLIFF_MATERIAL_SLOT, warpedUvCount: targets.length });
    while (frameStats.recent.length > FRAME_DEBUG_HISTORY_LIMIT) frameStats.recent.shift();
    debugLog(`${label}: solved ${touched.size} plateau mesh(es) as one shared cliff topology; ${report.patchCount} true connected surface(s), ${targets.length} cliff UV corners written.`);

    if (mapped && mapped !== combined) mapped.dispose?.();
    combined.dispose?.();
    return true;
  }

  function captureSceneMeshes(callback) {
    const scenePrototype = THREE.Scene?.prototype; // Used to capture rebuilt plateau meshes from rebuildZoneMesaMeshes, whose public method returns no mesh list.
    const previousAdd = scenePrototype?.add;
    if (!scenePrototype || typeof previousAdd !== 'function') return { result: callback(), meshes: [] };
    const meshes = []; // Used as direct Scene.add mesh captures from this exact synchronous rebuild call.
    function capturingAdd(...objects) {
      for (const object of objects) if (object?.isMesh) meshes.push(object);
      return previousAdd.apply(this, objects);
    }
    scenePrototype.add = capturingAdd;
    let result;
    try { result = callback(); }
    finally { if (scenePrototype.add === capturingAdd) scenePrototype.add = previousAdd; }
    return { result, meshes };
  }

  function schedulePlateauCrossMeshBatch(meshes, label) {
    const candidates = (meshes || []).filter(mesh => mesh?.isMesh); // Used to freeze the builder result before later unrelated scene additions occur.
    if (candidates.length < 2) return;
    const run = () => mapTouchingPlateauCliffBatch(candidates, label); // Used after WildernessCliffSurfaceParity's own per-mesh microtask so this batch solve is authoritative.
    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else Promise.resolve().then(run);
  }

  function installPlateauCrossMeshBatching() {
    const api = window.ZonePlateauMesa; // Used as the existing plateau builder after wilderness material/final-pass wrappers are already installed.
    if (!api || api.__hobunjiCrossMeshCliffUvWrapped) return !!api;

    const previousBuildZoneMesas = api.buildZoneMesaMeshes; // Used to receive the complete initial plateau mesh batch for one zone.
    if (typeof previousBuildZoneMesas === 'function') {
      api.buildZoneMesaMeshes = function (...args) {
        const meshes = previousBuildZoneMesas.apply(this, args) || [];
        schedulePlateauCrossMeshBatch(meshes, `plateau-zone:${String(args[1] || 'wilderness')}`);
        return meshes;
      };
      api.buildZoneMesaMeshes.__hobunjiCrossMeshCliffUvOriginal = previousBuildZoneMesas;
    }

    const previousRebuildZoneMesas = api.rebuildZoneMesaMeshes; // Used to keep runtime dig/fill/raise plateau rebuilds on the same cross-mesh UV policy.
    if (typeof previousRebuildZoneMesas === 'function') {
      api.rebuildZoneMesaMeshes = function (...args) {
        const capture = captureSceneMeshes(() => previousRebuildZoneMesas.apply(this, args));
        schedulePlateauCrossMeshBatch(capture.meshes, `plateau-rebuild:${String(args[0] || 'wilderness')}`);
        return capture.result;
      };
      api.rebuildZoneMesaMeshes.__hobunjiCrossMeshCliffUvOriginal = previousRebuildZoneMesas;
    }

    api.__hobunjiCrossMeshCliffUvWrapped = true;
    debugLog('plateau cross-mesh cliff UV batching installed: touching mesa mesh edges are internal UV seams, not PNG borders.');
    return true;
  }

  if (!installPlateauCrossMeshBatching()) {
    const retryPlateauInstall = () => installPlateauCrossMeshBatching(); // Used only for unusual dynamic-load ordering; no recurring frame work.
    if (typeof queueMicrotask === 'function') queueMicrotask(retryPlateauInstall);
    window.addEventListener?.('DOMContentLoaded', retryPlateauInstall, { once: true });
  }

  function formatPixelProbePerimeterDiagnostics() {
    const snapshot = window.HobunjiSurfacePerimeterFrame?.snapshot?.(); // Used to append the exact live mapping counters to copied Pixel Probe reports on mobile.
    if (!snapshot) return '';
    const lines = [
      '',
      '=== Natural surface perimeter-frame diagnostics ===',
      `Installed=${!!snapshot.installed} mapping=continuous-detected-surface-perimeter sourcePNGEdge=${(FRAME_SOURCE_EDGE_FRACTION * 100).toFixed(0)}% renderedEdgeBand=${(FRAME_SURFACE_EDGE_FRACTION * 100).toFixed(0)}%`,
      `Mapper calls: geometry=${snapshot.mapGeometryCalls || 0} mesh=${snapshot.mapMeshCalls || 0} runtimeRemap=${snapshot.remapCalls || 0} legacyPatchCapsIgnored=${snapshot.capHintsIgnored || 0} crossMeshRuntimeSkips=${snapshot.crossMeshRuntimeSkips || 0}`,
      `Frame writes: geometries=${snapshot.warpedGeometries || 0} UVvertices=${snapshot.warpedUvs || 0} crossMeshBatches=${snapshot.crossMeshBatches || 0} crossMeshMeshes=${snapshot.crossMeshMeshes || 0} crossMeshUVs=${snapshot.crossMeshUvVertices || 0}`,
    ]; // Used as a compact self-contained readout that can be pasted back without DevTools.
    const recent = Array.isArray(snapshot.recent) ? snapshot.recent.slice(-8) : []; // Used to show which connected surfaces were most recently remapped without flooding the report.
    if (!recent.length) {
      lines.push('Recent mapped surfaces: none yet — this scene has not sent a rock/cliff surface through the perimeter mapper since load.');
    } else {
      lines.push('Recent mapped surfaces:');
      for (const entry of recent) {
        lines.push(`  ${entry.label || '(surface)'} surfaces=${entry.patchCount ?? '-'} materialSlot=${entry.materialIndex ?? '*'} warpedUVs=${entry.warpedUvCount ?? 0}`);
      }
    }
    return lines.join('\n');
  }

  function installPixelProbePerimeterDiagnostics() {
    const result = document?.getElementById?.('debugProbeResult'); // Used as Pixel Probe's existing mobile-copy report surface; observing it avoids coupling to Pixel Probe's private raycast closure.
    if (!result || result.__hobunjiSurfacePerimeterFrameObserver || typeof MutationObserver !== 'function') return false;
    const marker = '=== Natural surface perimeter-frame diagnostics ==='; // Used to make observer-triggered appends idempotent when textContent itself causes another mutation.
    const appendDiagnostics = () => {
      const text = String(result.textContent || ''); // Used as the finished Pixel Probe report after its asynchronous capture completes.
      if (!text || text.includes(marker) || !text.startsWith('Pixel Probe report')) return;
      const diagnostics = formatPixelProbePerimeterDiagnostics(); // Used to append only when the perimeter mapper is actually installed.
      if (diagnostics) result.textContent = text + diagnostics;
    };
    const observer = new MutationObserver(() => {
      if (typeof queueMicrotask === 'function') queueMicrotask(appendDiagnostics);
      else Promise.resolve().then(appendDiagnostics);
    }); // Used so the diagnostics are appended after Pixel Probe finishes replacing the report text.
    observer.observe(result, { childList: true, subtree: true, characterData: true });
    result.__hobunjiSurfacePerimeterFrameObserver = observer;
    return true;
  }

  if (!installPixelProbePerimeterDiagnostics()) {
    window.addEventListener?.('DOMContentLoaded', installPixelProbePerimeterDiagnostics, { once: true });
  }

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

  debugLog('installed: Terrain Jigsaw runs first, natural rock/cliff texture+UV repair runs second, spatial chunking runs third, then the frame renders; detected cliff surfaces keep one continuous PNG perimeter frame, including touching plateau meshes.');
})();
