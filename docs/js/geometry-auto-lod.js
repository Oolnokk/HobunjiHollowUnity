// Pre-baked-first gameplay-wide optimized geometry mode (up to 60% reduction).
// Authored GLBs select precomputed variants through GeometryQuality / GLTFLoader.
// Only eligible PROCEDURAL meshes are simplified once, during idle time, into
// a session cache. Render-only swaps preserve collision, raycasts and source geometry.
(function (root) {
  'use strict';
  if (!root || root.GeometryAutoLOD) return;

  const STORAGE_KEY = 'hobunjiGlobalGeometryOptimize60.v1';
  const SIMPLIFIER_URL = 'https://cdn.jsdelivr.net/npm/meshoptimizer@0.22.0/meshopt_simplifier.js';
  const SHARED_CORE_URL = 'tools/geometry-workshop/core.js?v=20261110edgeproof2';
  const TARGET_REDUCTION = 60; // Workshop's user-tested 60% decimation; never subdivide at runtime.
  const MAX_SIMPLIFY_ERROR = 0.02; // Workshop's 2% simplification error cap.
  const MIN_TRIANGLES = 96; // Tiny billboards/props have no useful savings after per-mesh overhead.
  const MAX_MESH_TRIANGLES = 15000; // A single browser idle task must not process enormous terrain.
  const MAX_CACHED_SOURCE_TRIANGLES = 400000; // Hard cap on simultaneously retained original+LOD buffers.
  const MAX_CACHED_GEOMETRIES = 400; // Hard cap on game-wide GPU/CPU extra geometry count.
  const MAX_PENDING_GEOMETRIES = 500; // Bounds newly discovered geometry waiting for idle-time processing.
  const SCAN_INTERVAL_MS = 3500; // Incremental rescan discovers newly generated objects/zones.
  const SCAN_NODES_PER_SLICE = 220; // Bounded work per idle callback; no full-scene traversal in render().
  const SCAN_MS_PER_SLICE = 4;
  const MAX_SWAPS_PER_RENDER = 3000; // Worst-case renderer wrapper bound; deferred items remain originals.

  const cache = new WeakMap(); // Original BufferGeometry -> simplification result, owned by this module.
  const readyMeshes = new Map(); // Mesh -> geometry entry; sampled only during actual renderer.render().
  const knownCached = new Set(); // Track owned cache allocations for explicit GPU disposal on zone unload.
  const queue = []; // Unique pending geometries processed outside the render/physics frame.
  const counters = {
    scanned: 0, submitted: 0, processed: 0, skipped: 0, cached: 0,
    sourceTriangles: 0, optimizedTriangles: 0, lastDrawSaved: 0,
    lastRenderMeshes: 0, renderSwaps: 0, lastSkip: '', lastError: '',
  }; // Mobile-visible diagnostic counters, not per-frame logger output.

  let enabled = readEnabled(); // Persisted experimental graphics-quality preference.
  let ready = false; // Whether WASM and the shared Geometry Workshop reducer are ready.
  let loadingPromise = null; // Prevent duplicate optional CDN/WASM downloads.
  let optimizerFailed = false; // Avoid repeatedly loading a blocked CDN on every discovered mesh.
  let renderer = null; // Only the real __hobunjiGameRenderer, never an editor renderer.
  let originalRender = null; // Existing renderer.render chain, preserved under the wrapper.
  let renderDepth = 0; // Nested outline/occlusion passes cannot restore geometry prematurely.
  let scan = null; // Iterative object tree cursor for the current scene.
  let lastScanAt = 0;
  let scanScheduled = false;
  let workScheduled = false;
  let bootRetries = 0;
  let activeSourceBudget = 0; // Count of source triangles retained by the LOD cache.
  let activeGeometries = 0; // Number of cached geometry pairs.
  let statusAt = 0; // Throttles DOM text churn in busy scenes.

  function readEnabled() {
    try { return root.localStorage?.getItem(STORAGE_KEY) === 'true'; } catch (_) { return false; }
  }
  function now() { return root.performance?.now?.() ?? Date.now(); }
  function triangles(g) {
    const count = g?.index?.count ?? g?.getAttribute?.('position')?.count ?? 0;
    return Math.floor(count / 3);
  }
  function status(message) {
    const el = root.document?.getElementById?.('geometryAutoLODStatus');
    if (!el) return;
    const elapsed = now() - statusAt;
    if (!message && elapsed < 700) return;
    statusAt = now();
    el.textContent = (enabled ? 'Enabled' : 'Off') +
      ' · ' + counters.processed + ' mesh geometries optimized' +
      ' · ' + (counters.sourceTriangles - counters.optimizedTriangles).toLocaleString() +
      ' triangles saved across cached geometry' +
      ' · ' + counters.lastDrawSaved.toLocaleString() + ' triangle draws avoided last pass' +
      ' · ' + (root.GeometryQuality?.snapshot?.().prebakedLoads || 0) + ' pre-baked GLBs loaded' +
      ' · ' + queue.length + ' queued' +
      ' · ' + counters.skipped + ' skipped.' +
      (message ? ' ' + message : '') +
      (counters.lastError ? ' ' + counters.lastError : '') +
      ' Eligible visible objects use reduced geometry only while rendering; collision and raycasts keep originals.';
  }
  function snapshot() {
    return Object.freeze({
      enabled, ready, activeGeometries, sourceBudget: activeSourceBudget,
      queued: queue.length, trackedMeshes: readyMeshes.size,
      ...counters,
    });
  }
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (!root.document?.createElement || !root.document.head?.appendChild) return reject(new Error('Document script loader unavailable.'));
      const script = root.document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Unable to load geometry optimizer: ' + src));
      root.document.head.appendChild(script);
    });
  }
  async function ensureReducer() {
    if (ready) return;
    if (loadingPromise) return loadingPromise;
    loadingPromise = (async () => {
      if (!root.THREE?.BufferGeometry) throw new Error('Three.js geometry API unavailable.');
      if (!root.MeshoptSimplifier?.supported) await loadScript(SIMPLIFIER_URL);
      const simplifier = root.MeshoptSimplifier;
      if (!simplifier?.supported || typeof simplifier.simplify !== 'function') throw new Error('Meshoptimizer is not supported on this browser.');
      await simplifier.ready;
      if (!root.GeometryWorkshopCore?.reduceGeometry) await loadScript(SHARED_CORE_URL);
      if (!root.GeometryWorkshopCore?.reduceGeometry) throw new Error('Shared Workshop geometry reducer could not initialize.');
      ready = true;
      counters.lastError = '';
      status('Meshoptimizer ready; processing visible world geometry during browser idle time.');
    })().catch(error => {
      counters.lastError = String(error?.message || error);
      status('Optimizer unavailable. No geometry changes were made.');
      throw error;
    }).finally(() => { loadingPromise = null; });
    return loadingPromise;
  }
  function protectedMesh(mesh) {
    if (!mesh?.isMesh || !mesh.geometry?.isBufferGeometry || !mesh.visible || !mesh.parent) return true;
    if (mesh.isSkinnedMesh || mesh.isBone || mesh.isBatchedMesh) return true;
    if (mesh.userData?.geometryQualityGLBSource || mesh.geometry?.userData?.geometryQualityGLBSource) {
      return true; // Authored GLBs use pre-baked variants; never double-reduce them with the procedural idle cache.
    }
    const flags = mesh.userData || {};
    if ([
      'isCollisionMesh','isClimbBranch','noOutline','isPngPlane','isCollisionHelper',
      'isInteractionTrigger','geometryAutoLODExclude','isClimbable','physicsProxy',
    ].some(key => flags[key])) return true;
    const geo = mesh.geometry, attributes = Object.values(geo.attributes || {});
    if (!geo.getAttribute?.('position') || geo.getAttribute('position').itemSize !== 3) return true;
    if (attributes.some(a => !a?.array || a.isInterleavedBufferAttribute || a.isInstancedBufferAttribute)) return true;
    if (geo.index?.isInterleavedBufferAttribute) return true;
    if (Object.values(geo.morphAttributes || {}).some(values => values?.length)) return true;
    const count = geo.index?.count ?? geo.getAttribute('position').count;
    if (geo.drawRange && (geo.drawRange.start > 0 || (geo.drawRange.count !== Infinity && geo.drawRange.count < count))) return true;
    const tris = Math.floor(count / 3);
    if (tris < MIN_TRIANGLES || tris > MAX_MESH_TRIANGLES) return true;
    if ((geo.groups?.length || 0) > 8) return true;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    return !mats.length || mats.some(m => !m || m.visible === false ||
      m.isShaderMaterial || m.isRawShaderMaterial || m.transparent || m.alphaMap ||
      m.alphaTest > 0 || m.opacity < 1 || m.wireframe || m.skinning);
  }
  function isInScene(mesh) {
    // A detached zone can retain its own parent-child hierarchy; checking
    // mesh.parent alone leaks that entire hierarchy into the ready-mesh map.
    let current = mesh;
    for (let n = 0; current && n < 80; n++, current = current.parent) {
      if (current.isScene) return true;
    }
    return false;
  }
  function retire(entry) {
    if (!entry || entry.status !== 'done' || !entry.variant) return;
    entry.variant.dispose?.(); // This module alone owns the simplified geometry.
    activeGeometries = Math.max(0, activeGeometries - 1);
    activeSourceBudget = Math.max(0, activeSourceBudget - entry.triangles);
    counters.sourceTriangles -= entry.triangles;
    counters.optimizedTriangles -= entry.optimizedTriangles;
    cache.delete(entry.source); // Future re-entry will build a fresh LOD for this model.
    entry.variant = null;
    entry.status = 'retired';
  }
  function geometryStamp(geo) {
    // Invalidate cached LODs when a procedural mesh mutates position/index data in place.
    const pos = geo.getAttribute?.('position');
    return String(pos?.version || 0) + ':' + String(geo.index?.version || 0) +
      ':' + String(pos?.count || 0) + ':' + String(geo.index?.count || 0);
  }
  function scheduleIdle(fn) {
    if (typeof root.requestIdleCallback === 'function') root.requestIdleCallback(fn, { timeout: 1000 });
    else root.setTimeout?.(() => fn({ timeRemaining: () => 5 }), 30);
  }
  function track(mesh) {
    if (protectedMesh(mesh)) return;
    const geo = mesh.geometry, stamp = geometryStamp(geo);
    let entry = cache.get(geo);
    if (entry && entry.stamp !== stamp) {
      // Runtime has edited a once-static geometry. Never put stale triangles
      // back into the render; the previous variant is retired automatically.
      retire(entry);
      if (entry.status === 'pending') entry.status = 'stale';
      cache.delete(geo);
      entry = null;
    }
    if (!entry) {
      const count = triangles(geo);
      if (queue.length >= MAX_PENDING_GEOMETRIES ||
        activeGeometries >= MAX_CACHED_GEOMETRIES ||
        activeSourceBudget + count > MAX_CACHED_SOURCE_TRIANGLES) {
        counters.skipped++; counters.lastSkip = 'cache budget reached'; return;
      }
      entry = { source: geo, stamp, triangles: count, optimizedTriangles: count, status: 'pending', variant: null, targets: new Set() };
      cache.set(geo, entry);
      queue.push(entry);
      counters.submitted++;
    }
    if (entry.status === 'budget' && queue.length < MAX_PENDING_GEOMETRIES &&
      activeGeometries < MAX_CACHED_GEOMETRIES && activeSourceBudget + entry.triangles <= MAX_CACHED_SOURCE_TRIANGLES) {
      entry.status = 'pending'; // Retry when an abandoned zone releases GPU budget.
      queue.push(entry);
    }
    if (entry.status === 'done') readyMeshes.set(mesh, entry);
    else if (entry.status === 'pending') entry.targets.add(mesh);
    scheduleWork();
  }
  function scheduleWork() {
    if (!enabled || workScheduled || !queue.length) return;
    if (!ready) {
      if (!optimizerFailed) ensureReducer().then(() => {
        if (enabled) scheduleWork();
      }).catch(() => { optimizerFailed = true; status('Procedural optimizer unavailable; pre-baked GLBs still work.'); });
      return; // No download at startup: procedural meshes trigger it only when needed.
    }
    workScheduled = true;
    scheduleIdle(deadline => {
      workScheduled = false;
      if (!enabled || !ready) return;
      // One simplifier operation per idle callback to prevent long stalls
      // from chaining through hundreds of new wilderness meshes at once.
      let entry = queue.shift();
      while (entry && entry.status !== 'pending') entry = queue.shift();
      if (!entry) return;
      const geo = entry.source;
      try {
        if (activeGeometries >= MAX_CACHED_GEOMETRIES ||
          activeSourceBudget + entry.triangles > MAX_CACHED_SOURCE_TRIANGLES) {
          // Enforce budget at processing time too: hundreds may have queued
          // while their source budgets were not yet consumed.
          entry.status = 'budget';
          counters.lastSkip = 'LOD cache budget full; retry on later scene scan';
          return;
        }
        if (geometryStamp(geo) !== entry.stamp) {
          entry.status = 'stale';
          return;
        }
        const reduced = root.GeometryWorkshopCore.reduceGeometry(geo, TARGET_REDUCTION, MAX_SIMPLIFY_ERROR);
        const resultCount = triangles(reduced);
        if (resultCount >= entry.triangles) {
          if (reduced !== geo) reduced.dispose?.();
          entry.status = 'skipped';
          counters.skipped++;
          counters.lastSkip = 'meshoptimizer found no safe edge collapses';
        } else {
          entry.variant = reduced;
          entry.status = 'done';
          entry.optimizedTriangles = resultCount;
          activeGeometries++;
          activeSourceBudget += entry.triangles;
          knownCached.add(entry);
          counters.processed++;
          counters.sourceTriangles += entry.triangles;
          counters.optimizedTriangles += resultCount;
          for (const mesh of entry.targets) {
            if (mesh.geometry === geo) readyMeshes.set(mesh, entry);
          }
        }
      } catch (error) {
        entry.status = 'skipped';
        counters.skipped++;
        counters.lastSkip = String(error?.message || error);
      } finally {
        entry.targets.clear();
        status();
        scheduleWork();
      }
    });
  }
  function startScan(scene) {
    if (!enabled || scan || !scene?.isScene || !Array.isArray(scene.children)) return;
    scan = { root: scene, stack: [scene], seen: 0 };
    scanScheduled = false;
    scheduleScanSlice();
  }
  function scheduleScanSlice() {
    if (!enabled || !scan || scanScheduled) return; // Scan is what DISCOVERS the first procedural mesh and lazily starts WASM.
    scanScheduled = true;
    scheduleIdle(() => {
      scanScheduled = false;
      if (!enabled || !scan) return;
      const start = now();
      let count = 0;
      while (scan.stack.length && count++ < SCAN_NODES_PER_SLICE && now() - start < SCAN_MS_PER_SLICE) {
        const node = scan.stack.pop();
        if (!node || node.visible === false) continue;
        for (let i = (node.children?.length || 0) - 1; i >= 0; i--) scan.stack.push(node.children[i]);
        if (node.isMesh) { scan.seen++; track(node); }
      }
      if (scan.stack.length) scheduleScanSlice();
      else {
        counters.scanned += scan.seen;
        scan = null;
        lastScanAt = now();
        // Remove objects detached from a scene: no permanent strong references
        // to discarded zones, old meshes, or entire dungeons.
        const used = new Set(); // Cached geometries still referenced by a real live scene.
        for (const [mesh, entry] of readyMeshes) {
          if (!isInScene(mesh) || mesh.geometry !== entry.source ||
            geometryStamp(entry.source) !== entry.stamp) readyMeshes.delete(mesh);
          else used.add(entry);
        }
        // Retire only abandoned LODs; shared geometries survive as long as one live mesh references them.
        for (const entry of knownCached) if (!used.has(entry)) {
          retire(entry);
          knownCached.delete(entry);
        }
        status();
      }
    });
  }
  function wrapRenderer(actual) {
    if (!actual || renderer === actual || typeof actual.render !== 'function') return;
    renderer = actual;
    originalRender = renderer.render; // Existing render wrappers remain in the chain.
    const nativeRender = originalRender; // Per-renderer closure prevents cross-renderer chain corruption.
    renderer.render = function geometryAutoLODRender(scene, camera) {
      if (!enabled || renderDepth) return nativeRender.call(this, scene, camera);
      if (scene?.isScene && scene.children?.length > 3 && now() - lastScanAt > SCAN_INTERVAL_MS) {
        startScan(scene); // Merely SCHEDULES work; no heavy traversal within render().
      }
      const swapped = []; // Restored in finally before gameplay raycasts or physics can run.
      let trianglesAvoided = 0; // Actual triangle draw savings in this rendering pass.
      renderDepth++;
      try {
        for (const [mesh, entry] of readyMeshes) {
          if (swapped.length >= MAX_SWAPS_PER_RENDER) break;
          if (mesh.geometry !== entry.source || !entry.variant ||
            geometryStamp(entry.source) !== entry.stamp || !mesh.visible) continue;
          mesh.geometry = entry.variant;
          trianglesAvoided += entry.triangles - entry.optimizedTriangles;
          swapped.push(mesh);
        }
        counters.renderSwaps += swapped.length;
        counters.lastRenderMeshes = swapped.length;
        counters.lastDrawSaved = trianglesAvoided;
        return nativeRender.call(this, scene, camera);
      } finally {
        for (const mesh of swapped) {
          const entry = readyMeshes.get(mesh);
          if (entry && mesh.geometry === entry.variant) mesh.geometry = entry.source;
        }
        renderDepth--;
      }
    };
    status('Connected to the live game renderer.');
  }
  function attachWhenReady() {
    if (!enabled) return;
    const actual = root.__hobunjiGameRenderer;
    if (actual) { wrapRenderer(actual); return; }
    // The opening sequence can run longer than 36 seconds before the live
    // world renderer exists. Keep polling slowly instead of giving up.
    const delay = bootRetries++ < 90 ? 400 : 2000;
    if (bootRetries === 90) status('Waiting for the gameplay renderer; the optimizer will attach when the game opens.');
    root.setTimeout?.(attachWhenReady, delay);
  }
  function setEnabled(value) {
    enabled = !!value;
    try { root.localStorage?.setItem(STORAGE_KEY, String(enabled)); } catch (_) {}
    const control = root.document?.getElementById?.('settingGeometryAutoOptimize');
    if (control) control.checked = enabled;
    root.GeometryQuality?.refreshStatus?.(); // The Geometry Detail caption reflects pre-baked Low mode while this toggle is on.
    if (enabled) {
      // Attach to gameplay immediately; no optimizer download until an eligible
      // procedural mesh needs a cached variant. Precomputed GLBs start working
      // as soon as the quality loader chooses their shipped manifest paths.
      optimizerFailed = false;
      bootRetries = 0;
      attachWhenReady();
      scheduleWork();
      status('Precomputed GLB variants preferred; procedural meshes are cached when encountered.');
    } else {
      scan = null;
      scanScheduled = false;
      // Finished variants are retained for instant re-enable. Only the render
      // wrapper controls what is actually submitted to the GPU.
      status('Full-quality original meshes restored.');
    }
    return enabled;
  }
  function bindSettings() {
    const control = root.document?.getElementById?.('settingGeometryAutoOptimize');
    if (!control || control.dataset.geometryAutoLodBound) return;
    control.dataset.geometryAutoLodBound = '1'; // Avoid duplicate event listeners on settings re-mount.
    control.checked = enabled;
    control.addEventListener('change', () => setEnabled(control.checked));
    status();
  }
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', bindSettings);
    else bindSettings();
  }
  if (enabled) setEnabled(true);
  root.GeometryAutoLOD = Object.freeze({ setEnabled, isEnabled: () => enabled, snapshot, bindSettings, protectedMesh, geometryStamp });
})(typeof window !== 'undefined' ? window : null);
