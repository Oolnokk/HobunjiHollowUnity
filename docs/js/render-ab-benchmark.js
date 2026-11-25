// On-device render A/B benchmark (window.RenderABBenchmark).
//
// Headless measurements cannot say how fast a real phone/GPU is. This runs the
// live game in interleaved windows per variant and reports, on the device that
// matters:
//   default         everything as shipped
//   frameScopeOff   RenderHooks 'frame' hooks run on every render call again
//   outlinesOff     no outline passes (PNG depth, shell, composite) — note this
//                   also drops the painterly filter and lets the canvas MSAA
//                   apply to the world, so it is not a pure "outline cost"
//   painterlyOff    painterly-postprocess.js mode 'off' (its full-res filter
//                   passes run inside the outline composite)
//   halfResolution  Settings resolution 0.5 — if this is much faster, the GPU's
//                   pixel fill rate is the limit, not JavaScript
//   nearForest      Cloud Forest only: vegetation cull radius halved (fewer
//                   dense shadewood chunks — most of that zone's triangles)
//   skinnedScissorOff
//                   held/x-ray replays treat neck-rigged bodies as unboundable
//                   again (the old full-screen fallback, reason skinned-mesh)
//   fadedTreesDrawn wilderness trees the corridor-edge fade has taken to
//                   opacity 0 are drawn again (they only drew depth ghosts)
//   treeInstancingOn / treeInstancingOff
//                   procedural wilderness trees as instanced batches per
//                   variant part, or one mesh at a time (instancing is off by
//                   default: it measured as a net loss on a GTX 1060)
//   propBatchesOff  still wilderness props (tents, camp furniture, berry
//                   bushes, ore-rock stones...) drawn one mesh at a time
//                   instead of merged per 8x8 cell (zone-prop-render-batches.js)
//   brickLodOff     far brick walls/path chunks drawn with the full 70-triangle
//                   brick again (instanced-brick-lod.js)
//   denseWallBatchesOff
//                   the Cloud Forest dense wall drawn as one instanced mesh per
//                   chunk part again (dense-forest-wall-batches.js)
//   denseWallLodOff
//                   far Cloud Forest wall chunks drawn with full-detail bark
//                   and vines again (dense-forest-wall-batches.js distance LOD)
//   denCollisionEveryTile
//                   creature pathfinding looks up every den's collision shape
//                   for every tile again, instead of once per game-loop tick
//                   (GridTileAccessors.setDenStateMemoEnabled)
//   wheelListEveryFrame
//                   the item wheel's list rebuilt (all eligibility checks)
//                   every frame again (InventoryWheelList.setCrossFrameEnabled)
//   dualWieldFullSync
//                   dual-wield weapon copies (and NPCs' invisible offhand
//                   copies) fully re-synced three times per hand again
//                   (HobunjiDualWieldWeaponVisuals.setLeanSyncEnabled(false))
//   gearParticlesEveryPass
//                   particles on held gear (enchantment motes, weapon fire)
//                   are drawn in the base pass and every replay group again
//   npcWeaponsXray / npcWeaponsBasePass
//                   other characters' weapons x-ray again (the old fail-safe
//                   replay group per armed hostile), or, when Settings has
//                   switched that back on, draw in the base pass with their
//                   bearer (the default: HeldObjectRenderOrder owner link on,
//                   setOtherWeaponXrayLimit(0)). Compare while armed enemies
//                   are on screen.
//   mistOff / rainOff / cloudsOff
//                   hide the Cloud Forest mist, rain/blizzard planes or sky
//                   cloud layers while drawing (only offered when present)
// For every variant: fps, p90 frame time, CPU time inside the world render,
// and GPU time of the world render where the browser exposes
// EXT_disjoint_timer_query_webgl2. For the default variant it also breaks the
// render down per pass (base draw vs held-object/x-ray replays, PNG depth,
// shell, mist, composite...) with draw counts, plus the JS spent between draws
// (render scopes, presentation hooks, replay bookkeeping). Where timer queries
// are missing (Safari, many phones) one extra default window times each pass
// with a readPixels sync before/after it (CPU + GPU per pass; not used for fps;
// options.syncPasses true/false forces it on/off).
// Stand still in the view you care about while it runs (~45 s at 15 fps).
// options.variants: array of ids to run (default: all available except frameScopeOff).
//
//   RenderABBenchmark.run({ rounds, framesPerWindow }) -> Promise<report>
//   RenderABBenchmark.lastReport() / .lastText()
// Also: Settings → Dev Tools → "Render A/B benchmark" (copies the text report),
// and the Dev Companion command 'render-ab-benchmark'.
(() => {
  'use strict';

  if (window.RenderABBenchmark) return;

  let running = false;
  let lastReport = null;
  let lastText = '';

  const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const round2 = value => Number((Number(value) || 0).toFixed(2));

  function percentile(values, p) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  }

  // ── GPU timing of one world render (optional) ──────────────────────────
  function makeGpuTimer(renderer) {
    const gl = renderer?.getContext?.();
    const ext = gl && typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext
      ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
    if (!ext) return null;
    const pending = []; // { query, sink }
    return {
      begin() { const query = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, query); return query; },
      end(query, sink) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push({ query, sink }); },
      poll() {
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
        for (let i = pending.length - 1; i >= 0; i--) {
          const entry = pending[i];
          if (!gl.getQueryParameter(entry.query, gl.QUERY_RESULT_AVAILABLE)) continue;
          if (!disjoint) entry.sink.push(gl.getQueryParameter(entry.query, gl.QUERY_RESULT) / 1e6);
          gl.deleteQuery(entry.query);
          pending.splice(i, 1);
        }
      },
      dispose() { for (const entry of pending) gl.deleteQuery(entry.query); pending.length = 0; },
    };
  }

  // ── Synced pass timing (fallback when the browser has no timer queries) ──
  // A 1x1 readPixels cannot return until the GPU has finished everything
  // queued before it, so syncing before and after a pass and timing the gap
  // gives that pass's CPU + GPU cost. It defeats CPU/GPU overlap, so it runs
  // in its own window that never counts toward any variant's fps.
  function makeGpuSync(renderer) {
    const gl = renderer?.getContext?.();
    if (!gl?.readPixels) return null;
    const pixel = new Uint8Array(4);
    return () => {
      try {
        const target = renderer.getRenderTarget?.();
        const texture = target?.texture;
        const THREE = window.THREE;
        if (!target || (THREE && texture?.type === THREE.UnsignedByteType && texture?.format === THREE.RGBAFormat)) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        else gl.finish();
      } catch (_) {
        try { gl.finish(); } catch (__) {}
      }
    };
  }

  // ── Who the draws are (one sampled default frame) ───────────────────────
  // Groups each native render's render-list items by their named ancestry
  // (digits collapsed), so a report says *what* fills a pass, not just how many.
  function drawLabel(object) {
    const parts = [];
    for (let node = object; node && parts.length < 3; node = node.parent) {
      if (node.name && !node.isScene) parts.push(node.name.replace(/\d+/g, '#'));
    }
    return (parts.join('<') || object?.type || '?').slice(0, 90);
  }
  function addDrawContributors(sink, key, ctx) {
    const list = ctx?.renderer?.renderLists?.get?.(ctx.scene, ctx.depth || 0);
    if (!list) return;
    const counts = sink[key] || (sink[key] = new Map());
    for (const items of [list.opaque, list.transmissive, list.transparent]) {
      if (!items) continue;
      for (const item of items) {
        const label = drawLabel(item.object);
        counts.set(label, (counts.get(label) || 0) + 1);
      }
    }
  }

  // Held-object / x-ray replay counters (js/held-object-render-order.js). A
  // replay that cannot be scissored redraws the whole scene.
  const HELD_COUNTERS = ['scissoredReplays', 'fullscreenReplays'];
  function heldReplaySnapshot() {
    try { return window.HeldObjectRenderOrder?.snapshot?.() || null; } catch (_) { return null; }
  }

  // painterly-postprocess.js renders its filter passes from inside the
  // composite draw; label them by scene so they are not lumped in with it.
  function passLabel(pipeline, scene) {
    const pass = pipeline.currentPass?.() || 'unknown';
    if (pass === 'composite' && scene && scene.name !== 'world_render_composite') return 'painterly filter';
    return pass;
  }

  async function measureWindow(frames, sample, gpuTimer) {
    const intervals = [];
    sample.cpu.length = 0;
    let previous = await nextFrame();
    for (let i = 0; i < frames; i++) {
      const now = await nextFrame();
      intervals.push(now - previous);
      previous = now;
      gpuTimer?.poll();
    }
    return { intervals, cpuMs: mean(sample.cpu) };
  }

  function resolutionSelect() {
    const select = document.getElementById('settingResolution');
    if (!select || ![...select.options].some(option => option.value === '0.5')) return null;
    return select;
  }
  function setResolution(select, value) {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // Cloud Forest corridor reach (Settings slider, not persisted): fewer dense
  // shadewood chunks drawn. Forces a corridor pass so the change is immediate.
  function setForestRadius(input, value) {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    window.ZoneVegetationCull?.update?.(true);
  }

  async function run(options = {}) {
    if (running) throw new Error('Render A/B benchmark already running.');
    const hooks = window.RenderHooks;
    const pipeline = window.WorldRenderPipeline;
    if (!hooks?.setFrameScopeEnabled || !pipeline?.renderFrame) throw new Error('RenderHooks / WorldRenderPipeline not loaded.');
    const rounds = Math.max(1, Math.min(10, Number(options.rounds) || 2));
    const framesPerWindow = Math.max(20, Math.min(600, Number(options.framesPerWindow) || 45));
    const warmupFrames = 15;
    running = true;
    const renderer = window.__hobunjiGameRenderer;
    const gpuTimer = options.gpu === false ? null : makeGpuTimer(renderer);
    // Synced per-pass timing: on by default only where timer queries are missing.
    const gpuSync = options.syncPasses === false ? null : (options.syncPasses === true || !gpuTimer) ? makeGpuSync(renderer) : null;
    const originalRenderFrame = pipeline.renderFrame;
    let current = null; // { cpu: [], gpu: [] } of the variant being measured.
    let breakdown = null; // Per-pass accounting, active only for the default variant.
    let synced = null; // Synced per-pass accounting, active only in the extra synced window.
    let contributorFrame = null; // pass key -> Map(label -> draws) while sampling one default frame.
    let contributorsSampled = null;
    let defaultFramesSeen = 0;
    const heldDeltas = { frames: 0, scissoredReplays: 0, fullscreenReplays: 0 };
    let heldLast = null;
    let nativeMsThisFrame = 0;
    const passSeenThisFrame = new Set();
    pipeline.renderFrame = function timedRenderFrame(now) {
      const query = current && gpuTimer && !breakdown ? gpuTimer.begin() : null; // The default variant times each pass instead (queries cannot nest).
      nativeMsThisFrame = 0;
      passSeenThisFrame.clear();
      if (synced) synced.frames++;
      if (breakdown && !contributorsSampled && !contributorFrame && ++defaultFramesSeen >= 5) contributorFrame = {};
      const start = performance.now();
      try { return originalRenderFrame.call(this, now); }
      finally {
        const elapsed = performance.now() - start;
        if (query) gpuTimer.end(query, current.gpu);
        if (current) current.cpu.push(elapsed);
        if (breakdown) { breakdown.frames++; breakdown.betweenDrawsMs += Math.max(0, elapsed - nativeMsThisFrame); }
        if (contributorFrame) { contributorsSampled = contributorFrame; contributorFrame = null; }
      }
    };
    // Innermost render hook: times every native render and labels it with the
    // pipeline's pass. The first render of a pass in a frame is its base draw;
    // further ones in the same pass are replays (held-object, x-ray, quads).
    const passKey = pass => {
      if (pass === 'painterly filter') return pass;
      const key = passSeenThisFrame.has(pass) ? pass + ' (replays/extra)' : pass;
      passSeenThisFrame.add(pass);
      return key;
    };
    const passHookOff = hooks.register({
      id: 'render-ab-benchmark-passes', owner: 'render-ab-benchmark.js', order: 1e9,
      before: ctx => {
        if (synced) {
          gpuSync(); // Drain everything queued before this pass.
          const idleStart = performance.now();
          gpuSync(); // An idle round trip: the overhead each synced measurement carries.
          const start = performance.now();
          synced.overheadMs += start - idleStart;
          synced.syncs++;
          const key = passKey(passLabel(pipeline, ctx?.scene));
          const syncedEntry = synced.passes[key] || (synced.passes[key] = { ms: 0, renders: 0 });
          return { start, syncedEntry };
        }
        if (!breakdown) return { start: performance.now() };
        const key = passKey(passLabel(pipeline, ctx?.scene));
        const entry = breakdown.passes[key] || (breakdown.passes[key] = { ms: 0, draws: 0, triangles: 0, renders: 0, gpu: [] });
        return { start: performance.now(), entry, key, query: gpuTimer && !(ctx?.depth > 0) ? gpuTimer.begin() : null }; // Timer queries cannot nest: a render inside a render is CPU-timed only.
      },
      afterRender: (ctx, state) => {
        if (state.syncedEntry) {
          gpuSync();
          state.syncedEntry.ms += performance.now() - state.start;
          state.syncedEntry.renders++;
          return;
        }
        const ms = performance.now() - state.start;
        nativeMsThisFrame += ms;
        if (current) current.triangles += Number(ctx.renderer?.info?.render?.triangles) || 0;
        if (!state.entry) return;
        if (state.query) gpuTimer.end(state.query, state.entry.gpu);
        state.entry.ms += ms;
        state.entry.draws += Number(ctx.renderer?.info?.render?.calls) || 0;
        state.entry.triangles += Number(ctx.renderer?.info?.render?.triangles) || 0;
        state.entry.renders++;
        if (contributorFrame) addDrawContributors(contributorFrame, state.key, ctx);
      },
    });

    const debug = window.__hobunjiFurnitureDebug;
    const outlinesBefore = debug && 'outlinesSetting' in debug ? debug.outlinesSetting : null;
    const resolution = resolutionSelect();
    const resolutionBefore = resolution?.value ?? null;
    const variants = [
      { id: 'default', apply() {}, undo() {} },
    ];
    if (hooks.getDebug?.()?.frameScopeEnabled !== false) { // Settings can turn it off; never switch it back on behind the user's choice.
      variants.push({ id: 'frameScopeOff', apply: () => hooks.setFrameScopeEnabled(false), undo: () => hooks.setFrameScopeEnabled(true) });
    }
    if (typeof debug?.setOutlines === 'function' && outlinesBefore === true) {
      variants.push({ id: 'outlinesOff', apply: () => debug.setOutlines(false), undo: () => debug.setOutlines(true) });
    }
    const painterly = window.PainterlyPostprocess;
    const painterlyBefore = painterly?.getMode?.() ?? null;
    if (typeof painterly?.setMode === 'function' && painterlyBefore && painterlyBefore !== 'off' && outlinesBefore === true) {
      // The paint filter only runs on the outline composite, so outlinesOff also drops it;
      // this isolates its own cost.
      variants.push({ id: 'painterlyOff', apply: () => painterly.setMode('off'), undo: () => painterly.setMode(painterlyBefore) });
    }
    if (resolution && resolutionBefore !== '0.5') {
      variants.push({ id: 'halfResolution', apply: () => setResolution(resolution, '0.5'), undo: () => setResolution(resolution, resolutionBefore) });
    }
    const activeScene = window.GridTileAccessors?.getActiveScene?.();
    const forestRadius = document.getElementById('settingCloudForestCullRadius');
    const forestRadiusBefore = forestRadius ? Number(forestRadius.value) : NaN;
    if (forestRadius && Number.isFinite(forestRadiusBefore) && forestRadiusBefore > 10 && activeScene?.getObjectByName?.('AuthoredCloudForestDenseChunk_0')) {
      const near = Math.max(5, Math.round(forestRadiusBefore / 2));
      variants.push({ id: 'nearForest', apply: () => setForestRadius(forestRadius, near), undo: () => setForestRadius(forestRadius, forestRadiusBefore) });
    }
    const vegetationCull = window.ZoneVegetationCull;
    if (typeof vegetationCull?.setHideFadedOut === 'function' && vegetationCull.snapshot?.().hideFadedOut === true
        && vegetationCull.snapshot().lastCullables > 0) {
      variants.push({ id: 'fadedTreesDrawn', apply: () => vegetationCull.setHideFadedOut(false), undo: () => vegetationCull.setHideFadedOut(true) });
    }
    const treeInstancer = window.WildernessTreeInstancer;
    if (typeof treeInstancer?.setEnabled === 'function' && vegetationCull?.snapshot?.().lastCullables > 0) {
      const instancingBefore = treeInstancer.enabled?.() === true; // Toggled per window without persisting.
      variants.push(instancingBefore
        ? { id: 'treeInstancingOff', apply: () => treeInstancer.setEnabled(false), undo: () => treeInstancer.setEnabled(true) }
        : { id: 'treeInstancingOn', apply: () => treeInstancer.setEnabled(true), undo: () => treeInstancer.setEnabled(false) });
    }
    const propBatches = window.ZonePropRenderBatches;
    if (typeof propBatches?.setEnabled === 'function' && propBatches.snapshot?.().enabled === true && propBatches.snapshot().batches > 0) {
      variants.push({ id: 'propBatchesOff', apply: () => propBatches.setEnabled(false), undo: () => propBatches.setEnabled(true) });
    }
    const brickLod = window.InstancedBrickLod;
    if (typeof brickLod?.setEnabled === 'function' && brickLod.enabled() && brickLod.snapshot().farMeshes > 0) {
      variants.push({ id: 'brickLodOff', apply: () => brickLod.setEnabled(false), undo: () => brickLod.setEnabled(true) });
    }
    const wallBatches = window.DenseForestWallBatches;
    if (typeof wallBatches?.setEnabled === 'function' && wallBatches.snapshot?.().enabled === true && wallBatches.snapshot().batches > 0) {
      variants.push({ id: 'denseWallBatchesOff', apply: () => wallBatches.setEnabled(false), undo: () => wallBatches.setEnabled(true) });
      if (wallBatches.snapshot().lodEnabled === true && wallBatches.snapshot().lodFarTrees > 0) {
        variants.push({ id: 'denseWallLodOff', apply: () => wallBatches.setLodEnabled(false), undo: () => wallBatches.setLodEnabled(true) });
      }
    }
    const tiles = window.GridTileAccessors;
    if (typeof tiles?.setDenStateMemoEnabled === 'function' && tiles.denStateMemoEnabled?.() === true) {
      variants.push({ id: 'denCollisionEveryTile', apply: () => tiles.setDenStateMemoEnabled(false), undo: () => tiles.setDenStateMemoEnabled(true) });
    }
    const wheelList = window.InventoryWheelList;
    if (typeof wheelList?.setCrossFrameEnabled === 'function' && wheelList.crossFrameEnabled?.() === true) {
      variants.push({ id: 'wheelListEveryFrame', apply: () => wheelList.setCrossFrameEnabled(false), undo: () => wheelList.setCrossFrameEnabled(true) });
    }
    const dualWield = window.HobunjiDualWieldWeaponVisuals;
    if (typeof dualWield?.setLeanSyncEnabled === 'function' && dualWield.leanSyncEnabled?.() === true) {
      variants.push({ id: 'dualWieldFullSync', apply: () => dualWield.setLeanSyncEnabled(false), undo: () => dualWield.setLeanSyncEnabled(true) });
    }
    // Compare all three generated-outline modes while keeping the offscreen
    // composite, painterly, X-ray color and target highlights unchanged.
    if (debug?.outlinesSetting !== false && typeof pipeline?.setGeneratedOutlineMode === 'function') {
      const outlineBefore = pipeline.getGeneratedOutlineMode();
      for (const [id, mode] of [['shellOutlines','shell'],['screenDepthOutlines','screen'],['generatedOutlinesOff','none']]) {
        variants.push({ id, apply: () => pipeline.setGeneratedOutlineMode(mode), undo: () => pipeline.setGeneratedOutlineMode(outlineBefore) });
      }
    }
    const heldOrder = window.HeldObjectRenderOrder;
    if (typeof heldOrder?.setLocalReplayRingEnabled === 'function') {
      const localBefore = heldOrder.snapshot?.().localReplayRingEnabled !== false; // Restore the user's exact policy after each sample window.
      variants.push({ id: localBefore ? 'fullXrayRange' : 'localXrayRing', apply: () => heldOrder.setLocalReplayRingEnabled(!localBefore), undo: () => heldOrder.setLocalReplayRingEnabled(localBefore) });
    }
    const shadowPolicy = window.ShadowMapRefreshThrottle;
    if (typeof shadowPolicy?.setShadowRenderingEnabled === 'function') {
      const shadowBefore = shadowPolicy.snapshot().shadowRenderingEnabled;
      variants.push({ id: shadowBefore ? 'shadowsOff' : 'shadowsOn', apply: () => shadowPolicy.setShadowRenderingEnabled(!shadowBefore), undo: () => shadowPolicy.setShadowRenderingEnabled(shadowBefore) });
    }
    if (typeof heldOrder?.setGearParticlesOnceEnabled === 'function' && heldOrder.snapshot?.().gearParticlesOnceEnabled !== false) {
      variants.push({ id: 'gearParticlesEveryPass', apply: () => heldOrder.setGearParticlesOnceEnabled(false), undo: () => heldOrder.setGearParticlesOnceEnabled(true) });
    }
    if (typeof heldOrder?.setHeldOwnerLinkEnabled === 'function' && typeof heldOrder.setOtherWeaponXrayLimit === 'function') {
      const linkBefore = heldOrder.snapshot?.().heldOwnerLinkEnabled === true;
      const limitBefore = heldOrder.snapshot?.().otherWeaponXrayLimit ?? Infinity;
      const basePass = linkBefore && limitBefore === 0; // The default; Settings can switch it off.
      variants.push(basePass
        ? { id: 'npcWeaponsXray', apply: () => { heldOrder.setHeldOwnerLinkEnabled(false); heldOrder.setOtherWeaponXrayLimit(Infinity); },
          undo: () => { heldOrder.setHeldOwnerLinkEnabled(linkBefore); heldOrder.setOtherWeaponXrayLimit(limitBefore); } }
        : { id: 'npcWeaponsBasePass', apply: () => { heldOrder.setHeldOwnerLinkEnabled(true); heldOrder.setOtherWeaponXrayLimit(0); },
          undo: () => { heldOrder.setHeldOwnerLinkEnabled(linkBefore); heldOrder.setOtherWeaponXrayLimit(limitBefore); } });
    }
    if (typeof heldOrder?.setSkinnedScissorEnabled === 'function' && heldOrder.snapshot?.().skinnedScissorEnabled !== false) {
      variants.push({ id: 'skinnedScissorOff', apply: () => heldOrder.setSkinnedScissorEnabled(false), undo: () => heldOrder.setSkinnedScissorEnabled(true) });
    }
    const hideWhileDrawing = (id, groupName) => {
      const group = activeScene?.getObjectByName?.(groupName);
      if (!group || group.visible === false) return null;
      let off = null;
      return {
        id,
        apply: () => {
          off = hooks.register({
            id: 'render-ab-benchmark-' + id, owner: 'render-ab-benchmark.js', order: 1, scope: 'frame',
            before: () => { const target = activeScene.getObjectByName(groupName); const was = target?.visible; if (target) target.visible = false; return { target, was }; },
            after: (_ctx, state) => { if (state?.target) state.target.visible = state.was; },
          });
        },
        undo: () => { off?.(); off = null; },
      };
    };
    for (const extra of [hideWhileDrawing('mistOff', 'cloud_forest_mist_cylinders'), hideWhileDrawing('rainOff', 'world_rain_planes'), hideWhileDrawing('cloudsOff', 'hobunji_cloud_domes')]) {
      if (extra) variants.push(extra);
    }
    const wanted = Array.isArray(options.variants) ? options.variants : variants.map(v => v.id).filter(id => id !== 'frameScopeOff');
    for (let i = variants.length - 1; i >= 0; i--) if (variants[i].id !== 'default' && !wanted.includes(variants[i].id)) variants.splice(i, 1);
    const results = {};
    for (const variant of variants) results[variant.id] = { intervals: [], cpu: [], gpu: [], triangles: 0 };
    const passBreakdown = { frames: 0, betweenDrawsMs: 0, passes: {} };
    const syncedPasses = { frames: 0, syncs: 0, overheadMs: 0, passes: {} };
    try {
      for (let round = 0; round < rounds; round++) {
        // Rotate the order each round so thermal/background drift hits every variant equally.
        const order = variants.map((_, i) => variants[(i + round) % variants.length]);
        for (const variant of order) {
          variant.apply();
          try {
            current = null;
            breakdown = null;
            for (let i = 0; i < warmupFrames; i++) { await nextFrame(); gpuTimer?.poll(); }
            const sink = { cpu: [], gpu: results[variant.id].gpu, triangles: 0 };
            current = sink;
            if (variant.id === 'default') breakdown = passBreakdown;
            const heldBefore = variant.id === 'default' ? heldReplaySnapshot() : null;
            const framesBefore = passBreakdown.frames;
            const sample = await measureWindow(framesPerWindow, sink, gpuTimer);
            if (heldBefore) {
              heldLast = heldReplaySnapshot();
              if (heldLast) {
                for (const name of HELD_COUNTERS) heldDeltas[name] += Math.max(0, (Number(heldLast[name]) || 0) - (Number(heldBefore[name]) || 0));
                heldDeltas.frames += passBreakdown.frames - framesBefore;
              }
            }
            results[variant.id].intervals.push(...sample.intervals);
            results[variant.id].cpu.push(...sink.cpu);
            results[variant.id].triangles += sink.triangles;
          } finally {
            current = null;
            breakdown = null;
            variant.undo();
          }
        }
      }
      for (let i = 0; i < 10; i++) { await nextFrame(); gpuTimer?.poll(); } // Collect late GPU results.
      if (gpuSync) {
        for (let i = 0; i < warmupFrames; i++) await nextFrame();
        synced = syncedPasses;
        await measureWindow(Math.min(framesPerWindow, 30), { cpu: [], gpu: [] }, null);
        synced = null;
      }
    } finally {
      synced = null;
      passHookOff();
      gpuTimer?.dispose();
      hooks.setFrameScopeEnabled(true);
      if (outlinesBefore !== null && typeof debug?.setOutlines === 'function') debug.setOutlines(outlinesBefore);
      if (resolution && resolution.value !== resolutionBefore) setResolution(resolution, resolutionBefore);
      if (painterlyBefore && painterly?.getMode?.() !== painterlyBefore) painterly.setMode(painterlyBefore);
      if (forestRadius && Number(forestRadius.value) !== forestRadiusBefore) setForestRadius(forestRadius, forestRadiusBefore);
      pipeline.renderFrame = originalRenderFrame;
      running = false;
    }

    const summarize = data => {
      const avg = mean(data.intervals);
      return {
        frames: data.intervals.length,
        avgFrameMs: round2(avg),
        p90FrameMs: round2(percentile(data.intervals, 0.9)),
        fps: Number((1000 / Math.max(0.001, avg)).toFixed(1)),
        renderCpuMs: round2(mean(data.cpu)),
        renderGpuMs: data.gpu.length ? round2(mean(data.gpu)) : null,
        trianglesPerFrame: data.cpu.length ? Math.round(data.triangles / data.cpu.length) : null,
      };
    };
    const frames = Math.max(1, passBreakdown.frames);
    const passes = Object.entries(passBreakdown.passes)
      .map(([pass, entry]) => ({
        pass,
        msPerFrame: round2(entry.ms / frames),
        gpuMsPerFrame: entry.gpu.length ? round2(entry.gpu.reduce((a, b) => a + b, 0) / Math.max(1, entry.gpu.length) * (entry.renders / frames)) : null,
        drawsPerFrame: round2(entry.draws / frames),
        trianglesPerFrame: Math.round(entry.triangles / frames),
        rendersPerFrame: round2(entry.renders / frames),
      }))
      .sort((a, b) => (b.gpuMsPerFrame ?? b.msPerFrame) - (a.gpuMsPerFrame ?? a.msPerFrame));
    const syncFrames = Math.max(1, syncedPasses.frames);
    const syncOverheadMs = syncedPasses.syncs ? syncedPasses.overheadMs / syncedPasses.syncs : 0;
    const syncedRows = gpuSync && syncedPasses.frames ? Object.entries(syncedPasses.passes)
      .map(([pass, entry]) => ({
        pass,
        msPerFrame: round2(Math.max(0, entry.ms - entry.renders * syncOverheadMs) / syncFrames), // CPU + GPU, minus one idle sync per render.
        rendersPerFrame: round2(entry.renders / syncFrames),
      }))
      .sort((a, b) => b.msPerFrame - a.msPerFrame) : null;
    const variantSummaries = Object.fromEntries(Object.entries(results).map(([id, data]) => [id, summarize(data)]));
    if (variantSummaries.default && variantSummaries.default.renderGpuMs == null && passes.some(p => p.gpuMsPerFrame != null)) {
      variantSummaries.default.renderGpuMs = round2(passes.reduce((sum, p) => sum + (p.gpuMsPerFrame || 0), 0)); // Sum of per-pass GPU time.
    }
    const area = window.__hobunjiFurnitureDebug?.currentArea?.() || window.GridTileAccessors?.getCurrentArea?.() || null;
    const gl = renderer?.getContext?.();
    const debugInfo = gl?.getExtension?.('WEBGL_debug_renderer_info');
    lastReport = {
      at: new Date().toISOString(),
      area,
      variants: variantSummaries,
      weather: { raining: !!activeScene?.getObjectByName?.('world_rain_planes')?.visible, mist: !!window.CloudForestFog?.isActive?.() },
      passes,
      betweenDrawsMsPerFrame: round2(passBreakdown.betweenDrawsMs / frames),
      gpuTiming: !!gpuTimer,
      syncedPasses: syncedRows,
      syncedTotalMsPerFrame: syncedRows ? round2(syncedRows.reduce((sum, p) => sum + p.msPerFrame, 0)) : null,
      syncOverheadMs: syncedRows ? round2(syncOverheadMs) : null,
      painterly: painterly?.snapshot ? (({ mode, internalSize }) => ({ mode, internalSize }))(painterly.snapshot() || {}) : null,
      rounds,
      framesPerWindow,
      device: {
        userAgent: navigator.userAgent,
        gpu: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : null,
        devicePixelRatio: window.devicePixelRatio,
        drawingBuffer: gl ? [gl.drawingBufferWidth, gl.drawingBufferHeight] : null,
        context: gl?.getContextAttributes ? (({ antialias, preserveDrawingBuffer }) => ({ antialias, preserveDrawingBuffer }))(gl.getContextAttributes() || {}) : null,
      },
      lastFrame: pipeline.snapshot?.().lastFrame || null,
      characters: area && window.CharacterVisuals ? window.CharacterVisuals.audit(area).characters : null,
      drawContributors: contributorsSampled ? Object.fromEntries(Object.entries(contributorsSampled).map(([key, counts]) => [key,
        [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)])) : null,
      heldReplays: heldLast ? {
        scissoredPerFrame: round2(heldDeltas.scissoredReplays / Math.max(1, heldDeltas.frames)),
        fullscreenPerFrame: round2(heldDeltas.fullscreenReplays / Math.max(1, heldDeltas.frames)),
        lastHeldFullscreenReason: heldLast.lastHeldFullscreenReason ?? null,
        lastShellFullscreenReason: heldLast.lastShellFullscreenReason ?? null,
        lastCoverage: heldLast.lastReplayScissorCoverage ?? null,
        lastCulled: heldLast.lastReplayCulled ?? null,
        lastKept: heldLast.lastReplayKept ?? null,
        heldMeshes: heldLast.heldMeshes ?? null,
      } : null,
    };
    lastText = [
      `Render A/B benchmark — ${lastReport.at} — area ${area}`,
      ...Object.entries(lastReport.variants).map(([id, v]) => `${id.padEnd(14)}: ${v.fps} fps (avg ${v.avgFrameMs} ms, p90 ${v.p90FrameMs} ms), render CPU ${v.renderCpuMs} ms${v.renderGpuMs != null ? `, GPU ${v.renderGpuMs} ms` : ''}${v.trianglesPerFrame != null ? `, ${Math.round(v.trianglesPerFrame / 1000)}k tris` : ''}`),
      `default render by pass (CPU ms${gpuTimer ? ' | GPU ms' : ''} / draws / k triangles per frame): ${passes.map(p => `${p.pass} ${p.msPerFrame}${p.gpuMsPerFrame != null ? `|${p.gpuMsPerFrame}` : ''}ms/${p.drawsPerFrame}d/${(p.trianglesPerFrame / 1000).toFixed(1)}kt`).join('; ')}; between draws (scopes, hooks, replay bookkeeping) ${lastReport.betweenDrawsMsPerFrame}ms`,
      ...(syncedRows ? [`default render by pass, synced CPU+GPU ms per frame (own window, total ${lastReport.syncedTotalMsPerFrame} ms, sync overhead ${lastReport.syncOverheadMs} ms removed): ${syncedRows.map(p => `${p.pass} ${p.msPerFrame}ms`).join('; ')}`] : []),
      `weather: rain planes ${lastReport.weather.raining ? 'on' : 'off'}, mist ${lastReport.weather.mist ? 'on' : 'off'}; painterly ${lastReport.painterly?.mode ?? 'n/a'}${lastReport.painterly?.internalSize ? ` @ ${lastReport.painterly.internalSize}` : ''}`,
      `native renders/frame ${lastReport.lastFrame?.nativeRenders ?? '?'}, buffer ${lastReport.device.drawingBuffer?.join('x') ?? '?'} @ dpr ${lastReport.device.devicePixelRatio}, context antialias=${lastReport.device.context?.antialias} preserveDrawingBuffer=${lastReport.device.context?.preserveDrawingBuffer}, GPU timing ${gpuTimer ? 'on' : 'unavailable'}${lastReport.device.gpu ? `, ${lastReport.device.gpu}` : ''}`,
      `characters ${JSON.stringify(Object.fromEntries(Object.entries(lastReport.characters || {}).filter(([, n]) => n)))}`,
      ...(lastReport.heldReplays ? [(h => `held/x-ray replays per frame: scissored ${h.scissoredPerFrame}, fullscreen ${h.fullscreenPerFrame} (last reasons held=${h.lastHeldFullscreenReason} shell=${h.lastShellFullscreenReason}); last scissor coverage ${h.lastCoverage}, culled/kept ${h.lastCulled}/${h.lastKept}, held meshes ${h.heldMeshes}`)(lastReport.heldReplays)] : []),
      ...(lastReport.drawContributors ? Object.entries(lastReport.drawContributors)
        .map(([key, rows]) => [key, rows, rows.reduce((sum, [, n]) => sum + n, 0)])
        .sort((a, b) => b[2] - a[2]).slice(0, 4)
        .map(([key, rows]) => `top draws in ${key} (one frame): ${rows.slice(0, 8).map(([label, n]) => `${label} x${n}`).join('; ')}`) : []),
      `${rounds} rounds x ${framesPerWindow} frames per variant; ${navigator.userAgent}`,
    ].join('\n');
    return lastReport;
  }

  function installSettingsRow() {
    if (document.getElementById('renderAbBenchmarkBtn')) return true;
    const anchor = document.getElementById('devTeleportArenaBtn')?.closest('.settings-row');
    if (!anchor) return false;
    const row = document.createElement('div');
    row.className = 'settings-row';
    row.setAttribute('data-dev-only', '');
    const label = document.createElement('div');
    label.className = 'settings-label';
    const name = document.createElement('div');
    name.className = 'settings-name';
    name.textContent = 'Render A/B benchmark';
    const desc = document.createElement('div');
    desc.className = 'settings-desc';
    desc.textContent = 'Stand still and close the menu: measures this device for ~45 s (as shipped, outlines off, painterly filter off, half resolution, and in the Cloud Forest a shorter tree radius and mist/rain/clouds hidden), breaks render time down per pass, then copies the report.';
    label.append(name, desc);
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'renderAbBenchmarkBtn';
    button.className = 'settings-small-btn';
    button.textContent = 'Run';
    button.addEventListener('click', async () => {
      if (running) return;
      button.textContent = 'Running…';
      try {
        await new Promise(resolve => setTimeout(resolve, 1500)); // Time to close the menu.
        await run();
        try { await navigator.clipboard?.writeText?.(lastText); button.textContent = 'Copied'; }
        catch (_) { button.textContent = 'Done'; }
        window.__farmLog?.(lastText, 'info');
      } catch (error) {
        button.textContent = 'Failed';
        window.__farmLog?.(`[RenderABBenchmark] ${error?.message || error}`, 'warn');
      }
      setTimeout(() => { button.textContent = 'Run'; }, 4000);
    });
    row.append(label, button);
    anchor.insertAdjacentElement('afterend', row);
    installVisibilityReportRow(row);
    return true;
  }

  // "A character is invisible": one click captures what the next frame's main
  // pass drew and why each character part was or wasn't in it
  // (CharacterVisuals.captureVisibilityReport, js/character-visuals.js).
  function installVisibilityReportRow(after) {
    if (typeof after?.insertAdjacentElement !== 'function' || document.getElementById('characterVisibilityReportBtn')) return;
    const row = document.createElement('div');
    row.className = 'settings-row';
    row.setAttribute('data-dev-only', '');
    const label = document.createElement('div');
    label.className = 'settings-label';
    const name = document.createElement('div');
    name.className = 'settings-name';
    name.textContent = 'Character visibility report';
    const desc = document.createElement('div');
    desc.className = 'settings-desc';
    desc.textContent = 'If you, an NPC or an enemy is invisible: close the menu, then this copies why for every character here (hidden parents, position, layers, materials, whether the last frame drew it, render errors).';
    label.append(name, desc);
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'characterVisibilityReportBtn';
    button.className = 'settings-small-btn';
    button.textContent = 'Copy';
    button.addEventListener('click', async () => {
      button.textContent = 'Capturing…';
      try {
        await new Promise(resolve => setTimeout(resolve, 1500)); // Time to close the menu.
        const report = await window.CharacterVisuals.captureVisibilityReport();
        try { await navigator.clipboard?.writeText?.(report.text); button.textContent = 'Copied'; }
        catch (_) { button.textContent = 'Done'; }
        window.__farmLog?.(report.text, 'info');
      } catch (error) {
        button.textContent = 'Failed';
        window.__farmLog?.(`[CharacterVisibilityReport] ${error?.message || error}`, 'warn');
      }
      setTimeout(() => { button.textContent = 'Copy'; }, 4000);
    });
    row.append(label, button);
    after.insertAdjacentElement('afterend', row);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installSettingsRow, { once: true });
  else installSettingsRow();

  window.DevCompanion?.registerCommand?.('render-ab-benchmark', options => run(options).then(() => ({ report: lastReport, text: lastText })));

  window.RenderABBenchmark = Object.freeze({
    run,
    isRunning: () => running,
    lastReport: () => lastReport,
    lastText: () => lastText,
  });
})();
