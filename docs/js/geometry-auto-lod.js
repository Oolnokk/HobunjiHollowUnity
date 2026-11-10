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

  const cache = new WeakMap(); // Procedural source geometry -> once-simplified cached geometry.
  const precomputed = new WeakMap(); // Original or cloned GLB BufferGeometry -> render-only entry.
  const precomputedBySourceUid = new Map(); // Immutable GLB source UUID -> precomputed entry, reused by runtime-owned visual clones.
  const readyMeshes = new Map(); // Mesh -> geometry entry; sampled only during actual renderer.render().
  const knownCached = new Set(); // Track owned cache allocations for explicit GPU disposal on zone unload.
  const queue = []; // Unique pending geometries processed outside the render/physics frame.
  const counters = {
    scanned: 0, submitted: 0, processed: 0, skipped: 0, cached: 0,
    sourceTriangles: 0, optimizedTriangles: 0, prebakedRegistered: 0, lastDrawSaved: 0,
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
      ' · ' + counters.processed + ' procedural geometries optimized' +
      ' · ' + counters.prebakedRegistered + ' precomputed geometry buffers ready' +
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
    if (entry.fromBaked) {
      precomputed.delete(entry.source);
      if (entry.parentBaked) { entry.variant = null; entry.status = 'retired'; return; }
      if (entry.sourceUid && precomputedBySourceUid.get(entry.sourceUid) === entry)
        precomputedBySourceUid.delete(entry.sourceUid);
      for (const derived of entry.derivedUvs?.values?.() || []) derived.dispose?.(); // Derived stretch-fit UV buffers are owned by the base GLB entry.
    } else cache.delete(entry.source); // Future re-entry will build a fresh LOD for procedural meshes.
    entry.variant = null;
    entry.status = 'retired';
  }
  function geometryStamp(geo) {
    // A texture/UV/normal rewrite can make the baked source geometry obsolete
    // without moving its POSITIONs. Include every attribute's identity/version.
    const attributes = geo?.attributes || {};
    const parts = Object.keys(attributes).sort().map(name => {
      const a = attributes[name];
      return name + ':' + String(a?.version || 0) + ':' + String(a?.count || 0) + ':' + String(a?.itemSize || 0);
    });
    return parts.join('|') + ';indices=' + String(geo?.index?.version || 0) +
      ':' + String(geo?.index?.count || 0);
  }
  function supportsClonedGeometry(source, clone) {
    if (!source || !clone?.isBufferGeometry || !source.isBufferGeometry) return false;
    const baseline = source.getAttribute?.('position'), current = clone.getAttribute?.('position');
    if (!baseline || !current || baseline.count !== current.count) return false;
    const baselineKeys = Object.keys(source.attributes || {}).sort();
    const currentKeys = Object.keys(clone.attributes || {}).sort();
    const extraKeys = currentKeys.filter(name => !baselineKeys.includes(name));
    if (extraKeys.length && !(extraKeys.length === 1 && extraKeys[0] === 'uv' &&
      /^[xyz]{2}$/.test(clone.userData?.hobunjiStretchFitUvAxes || ''))) return false;
    if (baselineKeys.some(name => {
      const a = source.getAttribute(name), b = clone.getAttribute?.(name);
      return !b || a.count !== b.count || a.itemSize !== b.itemSize || a.normalized !== b.normalized;
    })) return false;
    // A clone may have been reshaped by rock contacts, physics, authoring or
    // stylized props. Sample its coordinates before allowing an original LOD
    // to replace its independently edited geometry.
    const n = current.count, probes = Math.min(24, n);
    for (let k = 0; k < probes; k++) {
      const i = Math.floor(k * (n - 1) / Math.max(1, probes - 1));
      if (baseline.getX(i) !== current.getX(i) || baseline.getY(i) !== current.getY(i) ||
        baseline.getZ(i) !== current.getZ(i)) return false;
    }
    return true;
  }
  function stretchFitVariant(entry, sourceClone) {
    const axes = sourceClone.userData?.hobunjiStretchFitUvAxes;
    if (!/^[xyz]{2}$/.test(axes || '')) return null;
    const cached = entry.derivedUvs?.get(axes);
    if (cached) return cached;
    const position = entry.variant.getAttribute?.('position');
    const bounds = sourceClone.boundingBox || (sourceClone.computeBoundingBox?.(), sourceClone.boundingBox);
    if (!bounds || !position || !root.THREE?.BufferAttribute) return null;
    const boundsAxis = key => ({min:bounds.min[key],
      span:Math.max(1e-6,bounds.max[key]-bounds.min[key])});
    const u = boundsAxis(axes[0]), v = boundsAxis(axes[1]);
    const read = (key,i) => key === 'x' ? position.getX(i) : key === 'y' ? position.getY(i) : position.getZ(i);
    const array = new Float32Array(position.count * 2); // Uses the game's whole-model stretch-fit UV convention.
    for (let i = 0; i < position.count; i++) {
      array[2 * i] = Math.max(0,Math.min(1,(read(axes[0],i)-u.min)/u.span));
      array[2 * i + 1] = Math.max(0,Math.min(1,(read(axes[1],i)-v.min)/v.span));
    }
    const variant = entry.variant.clone(); // Never mutate the author's shared baked data.
    variant.setAttribute('uv',new root.THREE.BufferAttribute(array,2));
    if (!entry.derivedUvs) entry.derivedUvs = new Map();
    entry.derivedUvs.set(axes,variant);
    return variant;
  }
  function lookupPrebaked(mesh) {
    const geometry = mesh?.geometry;
    const exact = precomputed.get(geometry);
    if (exact?.status === 'done') return exact;
    const uid = geometry?.userData?.geometryQualitySourceUid;
    const base = uid && precomputedBySourceUid.get(uid);
    if (!base || base.status !== 'done' || !supportsClonedGeometry(base.source,geometry)) return null;
    const changedUV = !!geometry.getAttribute?.('uv') && !base.source.getAttribute?.('uv');
    const variant = changedUV ? stretchFitVariant(base,geometry) : base.variant;
    if (!variant) return null;
    const sourceCount = triangles(geometry);
    if (triangles(variant) >= sourceCount) return null;
    const cloneEntry = { source:geometry, variant, stamp:geometryStamp(geometry),
      triangles:sourceCount, optimizedTriangles:triangles(variant), status:'done',
      fromBaked:true, parentBaked:base, targets:new Set() }; // Shared derived LOD is owned by base entry, not this clone.
    precomputed.set(geometry,cloneEntry);
    return cloneEntry;
  }
  function registerPrebaked(originalGLTF, optimizedGLTF) {
    if (!enabled) return 0;
    const originals = [], optimized = []; // Corresponding source/optimized mesh traversal order.
    const visit = (asset, output) => {
      const scene = asset?.scene || asset?.scenes?.[0] || asset;
      scene?.traverse?.(node => { if (node.isMesh) output.push(node); });
    };
    visit(originalGLTF, originals);
    visit(optimizedGLTF, optimized);
    if (!originals.length || originals.length !== optimized.length) return 0;
    let installed = 0; // Number of compatible authored mesh buffers registered for render-only substitution.
    for (let i = 0; i < originals.length; i++) {
      const sourceMesh = originals[i], variantMesh = optimized[i];
      const source = sourceMesh.geometry, variant = variantMesh.geometry;
      if (!source?.isBufferGeometry || !variant?.isBufferGeometry ||
        sourceMesh.isSkinnedMesh || variantMesh.isSkinnedMesh) continue;
      const sourceNames = Object.keys(source.attributes || {}).sort();
      const candidateNames = Object.keys(variant.attributes || {}).sort();
      if (sourceNames.join(',') !== candidateNames.join(',')) continue;
      if (sourceNames.some(name => source.attributes[name].itemSize !== variant.attributes[name].itemSize ||
        source.attributes[name].normalized !== variant.attributes[name].normalized)) continue;
      const groupsA = (source.groups || []).map(g => g.materialIndex).join(',');
      const groupsB = (variant.groups || []).map(g => g.materialIndex).join(',');
      if (groupsA !== groupsB) continue;
      const originalMats = Array.isArray(sourceMesh.material) ? sourceMesh.material.length : 1;
      const optimizedMats = Array.isArray(variantMesh.material) ? variantMesh.material.length : 1;
      if (originalMats !== optimizedMats) continue;
      const sourceCount = triangles(source), targetCount = triangles(variant);
      if (!(sourceCount > targetCount && targetCount > 0)) continue;
      if (activeGeometries >= MAX_CACHED_GEOMETRIES ||
        activeSourceBudget + sourceCount > MAX_CACHED_SOURCE_TRIANGLES) break;
      if (precomputed.has(source)) continue;
      const entry = {
        source, variant, stamp: geometryStamp(source), triangles: sourceCount,
        optimizedTriangles: targetCount, status: 'done', fromBaked: true, targets: new Set(),
      }; // The offline-baked BufferGeometry is only swapped into scene meshes while renderer.render executes.
      precomputed.set(source, entry);
      entry.sourceUid = source.userData?.geometryQualitySourceUid || source.uuid || null;
      if (entry.sourceUid) precomputedBySourceUid.set(entry.sourceUid,entry);
      knownCached.add(entry);
      activeGeometries++;
      activeSourceBudget += sourceCount;
      counters.sourceTriangles += sourceCount;
      counters.optimizedTriangles += targetCount;
      counters.prebakedRegistered++;
      installed++;
    }
    if (installed) {
      lastScanAt = 0; // New variant can apply to existing clones at next bounded idle scan.
      status('Precomputed render geometry registered; original source kept for collision/raycast.');
    }
    return installed;
  }
  function scheduleIdle(fn) {
    if (typeof root.requestIdleCallback === 'function') root.requestIdleCallback(fn, { timeout: 1000 });
    else root.setTimeout?.(() => fn({ timeRemaining: () => 5 }), 30);
  }
  function track(mesh) {
    const baked = lookupPrebaked(mesh);
    if (baked && baked.status === 'done') {
      const flags = mesh.userData || {};
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const isStretchFitRig = !!mesh.geometry?.userData?.hobunjiStretchFitUvAxes &&
        materials.every(m => m?.userData?.hobunjiHandRole || m?.userData?.hobunjiFootRole);
      if (mesh.isSkinnedMesh || [
        'isCollisionMesh', 'isCollisionHelper', 'isInteractionTrigger',
        'physicsProxy', 'geometryAutoLODExclude', 'isClimbBranch', 'isClimbable',
        'hobunjiOutlineOccluderDepthReplay', 'hobunjiPortraitOccludedWingLayer',
      ].some(key => flags[key]) ||
        (!isStretchFitRig && materials.some(m => m?.transparent || m?.alphaTest > 0 || m?.alphaMap))) return;
      // Authored hands/feet are true 3D rigs with the game's stretch-fit PNG
      // UVs; transparent alpha-cutout CARD geometry is still never simplified.
      if (geometryStamp(baked.source) !== baked.stamp) {
        // A visual mesh re-authored its UV/normal/position after load. The
        // offline GLB must not overwrite that edit or its collision geometry.
        retire(baked);
        knownCached.delete(baked);
        return;
      }
      readyMeshes.set(mesh, baked);
      return;
    }
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
        for (const entry of knownCached) if (!used.has(entry) && !entry.fromBaked) {
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
  root.GeometryAutoLOD = Object.freeze({ setEnabled, isEnabled: () => enabled, snapshot, bindSettings, protectedMesh, geometryStamp, registerPrebaked });
})(typeof window !== 'undefined' ? window : null);
