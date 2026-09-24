(() => {
  'use strict';

  const THREE = window.THREE; // Used to batch touching plateau geometry and preserve terrain renderer ordering below.
  if (!THREE) return;

  const FRAME_DEBUG_HISTORY_LIMIT = 16; // Used to keep mobile-visible cross-mesh diagnostics bounded.
  const CROSS_MESH_UV_OWNER = 'plateau-cliff-cross-mesh-v1'; // Used by the central mapper to preserve a batch-solved plateau cliff during runtime repair.
  const PLATEAU_CLIFF_MATERIAL_SLOT = 1; // Used by ZonePlateauMesa: slot 0 is the walkable top and slot 1 is the steep cliff surface.
  const crossMeshStats = {
    batches: 0,
    meshes: 0,
    uvVertices: 0,
    failures: 0,
    recent: [],
  }; // Used by Pixel Probe and snapshot() to verify the remaining cross-mesh adapter without duplicating stretch policy.

  function debugLog(message, level = 'info') {
    const text = `[surface-stretch-post-jigsaw] ${message}`; // Used as the final terrain-UV ordering/cross-mesh diagnostic prefix.
    if (typeof window.__farmLog === 'function') window.__farmLog(text, level, 'render');
    else if (level === 'warn') console.warn(text);
    else console.debug(text);
  }

  function selectedUvRanges(geometry, materialIndex, uvCount) {
    if (materialIndex == null) return [[0, uvCount]];
    const groups = Array.isArray(geometry?.groups) ? geometry.groups : []; // Used to preserve grass/top UVs while selecting only the plateau cliff material slot.
    if (!groups.length) return Number(materialIndex) === 0 ? [[0, uvCount]] : [];
    const ranges = []; // Used as non-indexed vertex spans belonging only to the requested material slot.
    for (const group of groups) {
      if (Number(group.materialIndex || 0) !== Number(materialIndex)) continue;
      const start = Math.max(0, Math.min(uvCount, Number(group.start) || 0)); // Used as the first target UV vertex after the central mapper non-indexes geometry.
      const end = Math.max(start, Math.min(uvCount, start + Math.max(0, Number(group.count) || 0))); // Used as the exclusive target UV vertex bound.
      if (end > start) ranges.push([start, end]);
    }
    return ranges;
  }

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
      uv = new THREE.Float32BufferAttribute(seed, 2); // Used to repair a missing UV state without collapsing the plateau-top texture.
      geometry.setAttribute('uv', uv);
    }
    geometry.userData = Object.assign({}, source.userData || {}, geometry.userData || {});
    delete geometry.userData.hobunjiSurfaceStretchSignature;
    delete geometry.userData.hobunjiSurfacePerimeterFrameSignature;
    mesh.geometry = geometry;
    return geometry;
  }

  function mapTouchingPlateauCliffBatch(meshes, label = 'plateau-cross-mesh') {
    const mapper = window.HobunjiSurfaceStretchUV; // Used as the single authoritative surface recognition, fit, and edge-preservation implementation.
    if (typeof mapper?.mapGeometry !== 'function') return false;
    const candidates = (meshes || []).filter(mesh => mesh?.isMesh && Array.isArray(mesh.material) && mesh.material[PLATEAU_CLIFF_MATERIAL_SLOT] && mesh.geometry); // Used to exclude unrelated meshes captured during a zone rebuild.
    if (candidates.length < 2) return false;

    const positions = []; // Used as one temporary world-space triangle soup spanning every plateau cliff-slot mesh in this batch.
    const targets = []; // Used to copy each solved combined UV back to its exact source mesh vertex afterward.
    const touched = new Map(); // Used to mark each source UV attribute once after all copied writes finish.
    const point = new THREE.Vector3(); // Used repeatedly while transforming local plateau vertices into common world space.

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

    const combined = new THREE.BufferGeometry(); // Used only as a temporary common-topology carrier; it never enters the scene.
    combined.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mapped = mapper.mapGeometry(combined, { label: `${label}:touching-mesh-batch` }); // The central mapper now owns both continuous fitting and no-perpendicular-stretch edge behavior.
    const mappedUv = mapped?.getAttribute?.('uv');
    const report = mapped?.userData?.hobunjiSurfaceStretch || null;
    if (!mappedUv || mappedUv.count !== targets.length || !report) {
      crossMeshStats.failures++;
      if (mapped && mapped !== combined) mapped.dispose?.();
      combined.dispose?.();
      return false;
    }

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      target.uv.setXY(target.index, mappedUv.getX(i), mappedUv.getY(i));
    }
    const batchSignature = `cross-mesh-surface-v2|meshes=${touched.size}|surfaces=${report.patchCount}|uvs=${targets.length}|mapping=${report.mapping || 'unknown'}`; // Used by runtime repair/debugging to identify this exact shared solve.
    for (const [mesh, state] of touched) {
      state.uv.needsUpdate = true;
      state.geometry.userData = Object.assign({}, state.geometry.userData || {}, {
        hobunjiSurfaceStretchSignature: batchSignature,
        hobunjiSurfaceStretch: Object.assign({}, report, {
          materialIndex: PLATEAU_CLIFF_MATERIAL_SLOT,
          crossMeshBatch: true,
          crossMeshCount: touched.size,
        }),
        hobunjiSurfacePerimeterFrame: Object.assign({}, mapped.userData?.hobunjiSurfacePerimeterFrame || report.perimeterFrame || {}, {
          mapping: 'edge-preserving-nine-slice-cross-mesh',
          materialIndex: PLATEAU_CLIFF_MATERIAL_SLOT,
        }),
      });
      delete state.geometry.userData.hobunjiSurfacePerimeterFrameSignature; // The temporary combined geometry owns the central signature; source meshes use the cross-mesh owner marker instead.
      mesh.userData = Object.assign({}, mesh.userData || {}, {
        naturalSurfaceCrossMeshUvOwner: CROSS_MESH_UV_OWNER,
        naturalSurfaceCrossMeshUvBatch: batchSignature,
        terrainJigsawIgnore: true,
      });
    }

    crossMeshStats.batches++;
    crossMeshStats.meshes += touched.size;
    crossMeshStats.uvVertices += targets.length;
    crossMeshStats.recent.push({ label: `${label}:cross-mesh`, patchCount: report.patchCount, materialIndex: PLATEAU_CLIFF_MATERIAL_SLOT, uvVertices: targets.length, edgeWorldSize: report.edgeWorldSize ?? null });
    while (crossMeshStats.recent.length > FRAME_DEBUG_HISTORY_LIMIT) crossMeshStats.recent.shift();
    debugLog(`${label}: solved ${touched.size} touching plateau mesh(es) through the central mapper; ${report.patchCount} connected surface(s), ${targets.length} cliff UV corners written.`);

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
    debugLog('plateau cross-mesh batching installed; UV fitting and protected-edge scale remain owned exclusively by HobunjiSurfaceStretchUV.');
    return true;
  }

  if (!installPlateauCrossMeshBatching()) {
    const retryPlateauInstall = () => installPlateauCrossMeshBatching(); // Used only for unusual dynamic-load ordering; no recurring frame work.
    if (typeof queueMicrotask === 'function') queueMicrotask(retryPlateauInstall);
    window.addEventListener?.('DOMContentLoaded', retryPlateauInstall, { once: true });
  }

  function formatPixelProbePerimeterDiagnostics() {
    const surface = window.HobunjiSurfaceStretchUV?.snapshot?.(); // Used as the authoritative live mapping state for mobile-visible verification.
    if (!surface) return '';
    const lines = [
      '',
      '=== Natural surface edge-preserving stretch diagnostics ===',
      `Installed=${!!window.HobunjiSurfaceStretchUV?.installed} loaderGeneration=${window.HobunjiNaturalSurfaceUvLoaderVersion || '-'} mapping=${surface.mapping || '-'} sourcePNGEdge=${((surface.edgeSourceFraction || 0) * 100).toFixed(1)}% nativePNGWorldSize=${Number(surface.edgeReferenceWorldSize || 0).toFixed(2)} protectedEdgeWorld=${Number(surface.edgeWorldSize || 0).toFixed(3)}`,
      `Central mapper: geometries=${surface.mappedGeometries || 0} meshes=${surface.mappedMeshes || 0} surfaces=${surface.patches || 0} fallbacks=${surface.fallbacks || 0}`,
      `Cross-mesh plateau adapter: batches=${crossMeshStats.batches} meshes=${crossMeshStats.meshes} UVvertices=${crossMeshStats.uvVertices} failures=${crossMeshStats.failures}`,
    ]; // Used as a compact self-contained readout that can be pasted back without DevTools.
    const recent = Array.isArray(surface.recent) ? surface.recent.slice(-6) : []; // Used to show which natural surfaces most recently passed through the central mapper.
    if (!recent.length) {
      lines.push('Recent mapped surfaces: none yet — this scene has not sent a rock/cliff surface through the central mapper since load.');
    } else {
      lines.push('Recent mapped surfaces:');
      for (const entry of recent) {
        lines.push(`  ${entry.label || '(surface)'} surfaces=${entry.patchCount ?? '-'} materialSlot=${entry.materialIndex ?? '*'} edgeWorld=${entry.edgeWorldSize == null ? '-' : Number(entry.edgeWorldSize).toFixed(3)}`);
      }
    }
    return lines.join('\n');
  }

  function installPixelProbePerimeterDiagnostics() {
    const result = document?.getElementById?.('debugProbeResult'); // Used as Pixel Probe's existing mobile-copy report surface; observing it avoids coupling to Pixel Probe's private raycast closure.
    if (!result || result.__hobunjiSurfacePerimeterFrameObserver || typeof MutationObserver !== 'function') return false;
    const marker = '=== Natural surface edge-preserving stretch diagnostics ==='; // Used to make observer-triggered appends idempotent when textContent itself causes another mutation.
    const appendDiagnostics = () => {
      const text = String(result.textContent || ''); // Used as the finished Pixel Probe report after its asynchronous capture completes.
      if (!text || text.includes(marker) || !text.startsWith('Pixel Probe report')) return;
      const diagnostics = formatPixelProbePerimeterDiagnostics(); // Used to append only when the central surface mapper is actually installed.
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
  const runtime = window.NaturalSurfaceStretchRuntime; // Used to repair stranded textures and restore central surface-island UVs before chunking/render.
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
    let inspected = 0; // Used to report how many top-level terrain roots were checked after a Jigsaw mutation.
    for (const object of scene.children.slice()) {
      if (!object) continue;
      runtime.inspectObject(object);
      inspected++;
    }
    stats.postJigsawInspections += inspected;
    return inspected;
  }

  function notifyTerrainGeometryReady(scene) {
    if (!scene?.isScene) return 0;
    let notified = 0; // Used to preserve runtime tile-owner geometry updates after Jigsaw/chunk mutation.
    for (const mesh of scene.children) {
      const callback = mesh?.userData?.onTerrainGeometryReady;
      if (typeof callback !== 'function') continue;
      const revision = Number(mesh.userData.terrainGeometryRevision) || 0; // Used to detect Jigsaw replacement and spatial index reordering.
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

    const jigsawMade = Number(jigsawApi.scanScene(scene, now)) || 0; // Runs legacy/general terrain Jigsaw first because it may replace UV geometry.
    if (jigsawMade) {
      stats.jigsawMutations += jigsawMade;
      inspectSceneTerrain(scene);
    }

    const chunksMade = Number(chunkApi.scanScene(scene, now)) || 0; // Runs only after the central natural-surface mapper has reclaimed final texture and UV ownership.
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

  const previousBakeMesh = jigsawApi.bakeMesh; // Used to preserve public/manual Jigsaw callers that bypass scanScene.
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
        surfaceMapper: window.HobunjiSurfaceStretchUV?.snapshot?.() || null,
        perimeterFrame: window.HobunjiSurfacePerimeterFrame?.snapshot?.() || null,
        crossMesh: Object.assign({}, crossMeshStats, { recent: crossMeshStats.recent.slice() }),
        runtime: runtime.snapshot?.() || null,
        jigsaw: jigsawApi.snapshot?.() || null,
        chunks: chunkApi.snapshot?.() || null,
      });
    },
  };

  debugLog('installed: edge-preserving stretch policy lives only in HobunjiSurfaceStretchUV; this adapter now handles touching-mesa batching plus Jigsaw -> natural repair -> spatial chunk -> render ordering.');
})();