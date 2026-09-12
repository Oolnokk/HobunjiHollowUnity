// Optional FPS/performance diagnostics and tree-source comparison controls.
// Loaded by debug.js. Heavy profiling work is disabled by default.
(function (root) {
  'use strict';
  if (!root || root.PerfProfiler) return;

  const FPS_PREF_KEY = 'hobunji_fps_counter_v1';
  const PROFILER_PREF_KEY = 'hobunji_perf_profiler_v1';
  const TREE_MODE_KEY = 'hobunji_tree_asset_mode_v1';
  const BACKDROP_BLUR_DIAGNOSTIC_KEY = 'hobunji_disable_backdrop_blur_v1';
  const FORCE_HIDDEN_PANELS_KEY = 'hobunji_force_hidden_panels_v1';

  const readStorage = (key, fallback = null) => {
    try {
      const value = root.localStorage?.getItem(key);
      return value == null ? fallback : value;
    } catch (_) { return fallback; }
  };
  const writeStorage = (key, value) => {
    try { root.localStorage?.setItem(key, String(value)); } catch (_) {}
  };
  const log = (message, level = 'info', category = 'render') => {
    if (typeof root.__farmLog === 'function') root.__farmLog(message, level, category);
    else if (level === 'warn' || level === 'error') console.warn(message);
  };

  let fpsEnabled = readStorage(FPS_PREF_KEY, '0') === '1';
  let profilerEnabled = readStorage(PROFILER_PREF_KEY, '0') === '1';
  let backdropBlurDisabled = readStorage(BACKDROP_BLUR_DIAGNOSTIC_KEY, '0') === '1';
  let forceHiddenPanelsEnabled = readStorage(FORCE_HIDDEN_PANELS_KEY, '0') === '1';
  const perfState = {
    raf: 0,
    lastFrameTs: 0,
    sampleStart: 0,
    sampleFrames: 0,
    fps: 0,
    frameMs: 0,
    renderCpuMs: 0,
    renderSamples: 0,
    renderer: null,
    scene: null,
    calls: 0,
    triangles: 0,
    points: 0,
    lines: 0,
    geometries: 0,
    textures: 0,
    lastScanTs: 0,
    scanMs: 0,
    geometryCategories: {},
    subsystem: new Map(),
    longTasks: 0,
    longTaskObserver: null,
    lastHeapBytes: 0,
    heapDeltaMbPerSec: 0,
    domNodeCount: 0,
  };

  function formatCount(value) {
    const n = Number(value) || 0;
    if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 1 : 2)}k`;
    return String(Math.round(n));
  }

  function ensureProfilerOverlay() {
    let el = document.getElementById('perfProfilerOverlay');
    if (el) return el;
    el = document.createElement('pre');
    el.id = 'perfProfilerOverlay';
    Object.assign(el.style, {
      position: 'fixed', right: '10px', top: '10px', zIndex: '1000000', margin: '0',
      padding: '8px 10px', borderRadius: '8px', pointerEvents: 'none',
      background: 'rgba(3,8,16,.82)', color: '#dbeafe', border: '1px solid rgba(125,211,252,.3)',
      font: '11px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
      whiteSpace: 'pre', textShadow: '0 1px 2px #000', minWidth: '230px'
    });
    document.body.appendChild(el);
    return el;
  }

  function objectPerfCategory(obj) {
    const u = obj?.userData || {};
    const text = [obj?.name, u.kind, u.type, u.category, u.furnitureKey, u.treeSpecies, u.sourceObjectType]
      .filter(Boolean).join(' ').toLowerCase();
    if (/tree|shadewood|crowned|foliage|grass|bush|plant|crop|forest/.test(text)) return 'foliage';
    if (/terrain|ground|plateau|cliff|hill|river|water/.test(text)) return 'terrain';
    if (/path|road|brick/.test(text)) return 'paths';
    if (/player|npc|animal|creature|bandit|enemy|avatar|mount|pet/.test(text)) return 'characters';
    if (/house|building|furniture|wall|door|roof|stump|log/.test(text)) return 'structures';
    if (/particle|effect|vfx|trail|rain|snow/.test(text)) return 'effects';
    return 'other';
  }

  function meshTriangleCount(obj) {
    if (!obj?.isMesh || !obj.geometry) return 0;
    const geometry = obj.geometry;
    const count = geometry.index?.count ?? geometry.attributes?.position?.count ?? 0;
    let tris = count / 3;
    if (obj.isInstancedMesh) tris *= Math.max(0, Number(obj.count) || 0);
    return Number.isFinite(tris) ? tris : 0;
  }

  function scanVisibleGeometry(scene) {
    if (!scene) return;
    const start = performance.now();
    const categories = Object.create(null);
    const visit = obj => {
      if (!obj?.isMesh || obj.visible === false) return;
      const tris = meshTriangleCount(obj);
      if (!tris) return;
      const category = objectPerfCategory(obj);
      categories[category] = (categories[category] || 0) + tris;
    };
    if (typeof scene.traverseVisible === 'function') scene.traverseVisible(visit);
    else scene.traverse?.(visit);
    perfState.geometryCategories = categories;
    perfState.scanMs = performance.now() - start;
  }

  // Patching THREE.WebGLRenderer.prototype.render doesn't reach the game's
  // actual renderer: r128 defines render() as an own instance property set
  // inside the constructor closure, not on the shared prototype, and this
  // codebase also constructs several OTHER independent WebGLRenderer
  // instances (character-creation preview, farm-panel-core's 3D preview, …)
  // whose own construction-order relative to the r128 compatibility bridge
  // (js/social-action-r128-render-bridge.js) isn't guaranteed — so a
  // prototype patch here could silently attach to the wrong instance, or
  // none at all, while never erroring. game.js instead hands this module
  // its one real gameplay renderer directly via attachRenderer() right
  // after constructing it, and this patches that exact instance.
  let rendererProfilerRetries = 0;
  function installRendererProfiler() {
    const renderer = root.__hobunjiGameRenderer;
    if (!renderer) {
      // game.js may not have reached renderer creation yet if this module's
      // own (async-loaded) script happens to run unusually early — retry
      // for a few seconds rather than permanently giving up.
      if (rendererProfilerRetries++ < 40) setTimeout(installRendererProfiler, 250);
      return false;
    }
    if (renderer.__hobunjiPerfWrapped) return true;
    const original = renderer.render;
    if (typeof original !== 'function') return false;
    renderer.__hobunjiPerfWrapped = true;
    renderer.render = function hobunjiProfiledRender(scene, camera) {
      // Captured unconditionally (cheap: two reference assignments) so
      // getLiveGpuInfo() below can report real-time renderer.info numbers
      // — and the low-FPS auto-snapshot watcher can trigger a cache audit
      // — without requiring the user to have opted into the (heavier)
      // Performance Profiler overlay first.
      perfState.renderer = this;
      perfState.scene = scene;
      if (!profilerEnabled) return original.call(this, scene, camera);
      const start = performance.now();
      const result = original.call(this, scene, camera);
      const elapsed = performance.now() - start;
      perfState.renderCpuMs += elapsed;
      perfState.renderSamples += 1;
      const info = this.info;
      if (info) {
        perfState.calls = Number(info.render?.calls) || 0;
        perfState.triangles = Number(info.render?.triangles) || 0;
        perfState.points = Number(info.render?.points) || 0;
        perfState.lines = Number(info.render?.lines) || 0;
        perfState.geometries = Number(info.memory?.geometries) || 0;
        perfState.textures = Number(info.memory?.textures) || 0;
      }
      return result;
    };
    // held-object-render-order.js's internal depth-replay passes look for the
    // TRUE, undecorated render() by walking a chain of __hobunji*Original
    // markers (see its unwrapRendererRender) — without this marker those
    // replay passes stop unwrapping here instead of reaching the real render.
    renderer.render.__hobunjiPerfDebugOriginal = original;
    return true;
  }

  function ensureLongTaskObserver() {
    if (!profilerEnabled || perfState.longTaskObserver || !root.PerformanceObserver) return;
    try {
      const observer = new root.PerformanceObserver(list => { perfState.longTasks += list.getEntries().length; });
      observer.observe({ entryTypes: ['longtask'] });
      perfState.longTaskObserver = observer;
    } catch (_) {}
  }

  function stopLongTaskObserver() {
    try { perfState.longTaskObserver?.disconnect?.(); } catch (_) {}
    perfState.longTaskObserver = null;
  }

  // js/outline-render-performance.js already wraps the renderer one layer
  // closer to the true native render than held-object-render-order.js does
  // (it loads earlier, via house-pieces.js's script chain, so everything
  // else installed after it -- terrain-render-chunks.js,
  // natural-surface-stretch-post-jigsaw.js, held-object-render-order.js --
  // wraps AROUND it, not the reverse). Its own lifetime per-pass CPU-ms
  // average therefore isolates "this layer plus everything below it" from
  // the outer layers' overhead, without needing a second timing system —
  // reuses its existing snapshot() instead of re-instrumenting the same
  // render() calls a third time.
  function outlineRenderPerfLine() {
    const snap = root.OutlineRenderPerformance?.snapshot?.();
    const lifetime = snap?.lifetime;
    if (!lifetime) return null;
    const order = ['base', 'pngDepth', 'shell', 'target', 'materialId', 'postOrDirect'];
    const parts = order
      .map(name => {
        const b = lifetime[name];
        if (!b?.renders) return null;
        return `${name} ${(b.cpuMs / b.renders).toFixed(2)}ms`;
      })
      .filter(Boolean);
    return parts.length ? `Outline-perf layer (native-ward of held-overlay): ${parts.join('  ')}` : null;
  }

  // Below this, a bucket rarely if ever mattered across every real snapshot
  // taken while chasing the "severe framerate" investigation (all
  // consistently well under 1ms) -- hidden so the overlay's fixed height
  // keeps showing the buckets that actually move, instead of scrolling them
  // off past the visible screen area under a wall of confirmed-boring ones.
  // 'gameLoop total' and 'render passes' are always shown regardless (see
  // profilerText) since they're the two top-level bars everything else
  // should be read against.
  const SUBSYSTEM_DISPLAY_FLOOR_MS = 0.5;

  function profilerText() {
    const avgRender = perfState.renderSamples ? perfState.renderCpuMs / perfState.renderSamples : 0;
    const geom = Object.entries(perfState.geometryCategories).sort((a,b) => b[1] - a[1]);
    const totalGeom = geom.reduce((sum, pair) => sum + pair[1], 0);
    const topGeom = geom[0];
    const allSubsystems = [...perfState.subsystem.entries()].sort((a,b) => b[1].avg - a[1].avg);
    const gameLoopTotal = perfState.subsystem.get('gameLoop total');
    const subsystems = allSubsystems.filter(([name, value]) => name !== 'gameLoop total' && value.avg >= SUBSYSTEM_DISPLAY_FLOOR_MS);
    const wildlifeLod = root.WildernessSimulationLOD?.snapshot?.(); // Adds active/sleeping creature counts to the same mobile-visible overlay.
    const outlinePerfLine = outlineRenderPerfLine();
    const topLine = topGeom
      ? `${topGeom[0]} ${formatCount(topGeom[1])} tris (${totalGeom ? Math.round(topGeom[1] / totalGeom * 100) : 0}%)`
      : 'not scanned yet';
    return [
      `FPS ${perfState.fps.toFixed(1)}   frame ${perfState.frameMs.toFixed(2)} ms`,
      // The gap between these two (when positive) is time spent between one
      // gameLoop() call finishing and the next one starting -- i.e. some
      // OTHER requestAnimationFrame loop, a MutationObserver callback, or GC,
      // not anything wrapped above. A near-zero or negative gap means the
      // cost really is inside gameLoop's own call graph.
      gameLoopTotal ? `gameLoop total ${gameLoopTotal.avg.toFixed(2)} ms   (outside gameLoop: ${(perfState.frameMs - gameLoopTotal.avg).toFixed(2)} ms)` : 'gameLoop total: not sampled yet',
      ...(outlinePerfLine ? [outlinePerfLine] : []),
      `Render CPU ${avgRender.toFixed(2)} ms`,
      `Draw calls ${formatCount(perfState.calls)}   tris ${formatCount(perfState.triangles)}`,
      `GPU refs  geom ${formatCount(perfState.geometries)}   tex ${formatCount(perfState.textures)}`,
      `Top visible geometry: ${topLine}`,
      // ×N (samples) matters most for the rAF: call-site buckets: a call
      // site averaging 2ms that only ever fired once is a one-time cost, but
      // the same 2ms average firing hundreds of times is a real per-second
      // budget problem the plain average alone can't distinguish.
      subsystems.length
        ? `Timed (≥${SUBSYSTEM_DISPLAY_FLOOR_MS}ms):\n${subsystems.map(([name, value]) => `  ${name} ${value.avg.toFixed(2)} ms  ×${value.samples}`).join('\n')}`
        : 'Timed subsystems: none above the display floor',
      wildlifeLod ? `LOD bandits ${wildlifeLod.activeBandits}/${wildlifeLod.totalBandits} active · wildlife ${wildlifeLod.visuallyActiveWildlife}/${wildlifeLod.totalWildlife} visible` : 'LOD counts unavailable',
      `Long tasks: ${perfState.longTasks}   profiler scan ${perfState.scanMs.toFixed(2)} ms`,
      // Chrome-only. A large sustained value here (tens of MB/sec) points at
      // GC pauses as a real candidate for time that isn't inside gameLoop
      // and wasn't caught by the rAF/MutationObserver instrumentation --
      // neither of those can see GC time, since it doesn't belong to any
      // one JS callback's own measured duration.
      perfState.lastHeapBytes
        ? `JS heap: ${(perfState.lastHeapBytes / 1e6).toFixed(1)} MB   Δ ${perfState.heapDeltaMbPerSec >= 0 ? '+' : ''}${perfState.heapDeltaMbPerSec.toFixed(1)} MB/s`
        : 'JS heap: unavailable (non-Chromium browser)',
      // A large, growing count here (thousands+) is circumstantial evidence
      // for the "outside gameLoop" cost being browser-internal style/layout
      // recalculation of DOM subtrees that stay mounted (at opacity:0) while
      // "closed" -- see setForceHiddenPanelsEnabled below for the toggle
      // that tests this directly.
      `DOM nodes: ${formatCount(perfState.domNodeCount)}`,
    ].join('\n');
  }

  function updatePerformanceUI(now) {
    const fpsEl = document.getElementById('fpsCounter');
    if (fpsEl) {
      fpsEl.style.display = fpsEnabled ? 'block' : 'none';
      if (fpsEnabled) fpsEl.textContent = `FPS: ${perfState.fps ? perfState.fps.toFixed(0) : '--'}`;
    }
    const overlay = document.getElementById('perfProfilerOverlay');
    if (profilerEnabled) {
      if (now - perfState.lastScanTs >= 1000) {
        perfState.lastScanTs = now;
        scanVisibleGeometry(perfState.scene);
      }
      const target = overlay || ensureProfilerOverlay();
      target.style.display = 'block';
      target.textContent = profilerText();
      perfState.renderCpuMs = 0;
      perfState.renderSamples = 0;
      perfState.longTasks = 0;
    } else if (overlay) overlay.style.display = 'none';
  }

  function frameLoop(ts) {
    perfState.raf = 0;
    if (!fpsEnabled && !profilerEnabled) return;
    if (!perfState.lastFrameTs) perfState.lastFrameTs = ts;
    const delta = Math.max(0, ts - perfState.lastFrameTs);
    perfState.lastFrameTs = ts;
    if (delta > 0 && delta < 1000) perfState.frameMs = perfState.frameMs ? perfState.frameMs * 0.9 + delta * 0.1 : delta;
    if (!perfState.sampleStart) perfState.sampleStart = ts;
    perfState.sampleFrames += 1;
    const elapsed = ts - perfState.sampleStart;
    if (elapsed >= 500) {
      perfState.fps = perfState.sampleFrames * 1000 / Math.max(1, elapsed);
      perfState.sampleFrames = 0;
      perfState.sampleStart = ts;
      // Chrome-only (root.performance.memory doesn't exist in Firefox/Safari).
      // A sustained high allocation rate here would point at GC pauses as the
      // 'outside gameLoop' cost -- several hot-path functions across this
      // codebase build a fresh array every single frame ([...pending],
      // [...managed], [...ground, ...held], etc.), and unlike the rAF/
      // MutationObserver work already ruled out, GC time doesn't belong to
      // any specific JS callback's own measured duration, so neither of
      // those wrappers could have shown it even in principle.
      const heapBytes = root.performance?.memory?.usedJSHeapSize;
      if (Number.isFinite(heapBytes)) {
        if (perfState.lastHeapBytes) {
          const deltaBytes = heapBytes - perfState.lastHeapBytes;
          perfState.heapDeltaMbPerSec = (deltaBytes / 1e6) / (elapsed / 1000);
        }
        perfState.lastHeapBytes = heapBytes;
      }
      // Cheap enough (a single querySelectorAll pass) only because it's
      // gated to this same 500ms tick rather than running every frame.
      if (profilerEnabled) perfState.domNodeCount = document.querySelectorAll('*').length;
      updatePerformanceUI(ts);
    }
    perfState.raf = requestAnimationFrame(frameLoop);
  }

  function startFrameLoopIfNeeded() {
    if ((!fpsEnabled && !profilerEnabled) || perfState.raf) return;
    perfState.lastFrameTs = 0;
    perfState.sampleStart = 0;
    perfState.sampleFrames = 0;
    perfState.raf = requestAnimationFrame(frameLoop);
  }

  function setFpsEnabled(enabled) {
    fpsEnabled = !!enabled;
    writeStorage(FPS_PREF_KEY, fpsEnabled ? '1' : '0');
    const input = document.getElementById('settingFpsCounter');
    if (input) input.checked = fpsEnabled;
    const el = document.getElementById('fpsCounter');
    if (el) el.style.display = fpsEnabled ? 'block' : 'none';
    startFrameLoopIfNeeded();
  }

  function setProfilerEnabled(enabled) {
    profilerEnabled = !!enabled;
    writeStorage(PROFILER_PREF_KEY, profilerEnabled ? '1' : '0');
    const input = document.getElementById('settingPerfProfiler');
    if (input) input.checked = profilerEnabled;
    if (profilerEnabled) {
      installRendererProfiler();
      ensureLongTaskObserver();
      ensureProfilerOverlay();
    } else {
      stopLongTaskObserver();
      const overlay = document.getElementById('perfProfilerOverlay');
      if (overlay) overlay.style.display = 'none';
    }
    startFrameLoopIfNeeded();
  }

  // Diagnostic toggle, not a real fix: this codebase uses backdrop-filter:
  // blur() in 30+ places (docs/style.css, docs/onboarding.css,
  // docs/cooking-ui.css), including #menuPanel at blur(24px) -- the single
  // largest radius in the file. #menuPanel and several other panels stay
  // mounted at opacity:0 rather than display:none while "closed" (so their
  // open/close CSS transition has something to animate), but opacity does
  // NOT let a browser skip the backdrop-filter compositing cost the way
  // display:none would -- the compositor still has to keep re-sampling and
  // blurring whatever's behind the panel (the animating 3D scene) every
  // single frame, for as long as the panel is mounted, whether or not it's
  // actually visible. That cost happens entirely in the browser's own
  // paint/composite pipeline, never inside any JS callback -- which is
  // exactly why it wouldn't show up in either the requestAnimationFrame or
  // MutationObserver auto-instrumentation above; JS-side timing has no way
  // to see it. This toggle removes every backdrop-filter on the page via one
  // !important override, so its FPS impact (if any) can be checked directly
  // instead of guessed at from the outside.
  function setBackdropBlurDisabled(disabled) {
    backdropBlurDisabled = !!disabled;
    writeStorage(BACKDROP_BLUR_DIAGNOSTIC_KEY, backdropBlurDisabled ? '1' : '0');
    const input = document.getElementById('settingDisableBackdropBlur');
    if (input) input.checked = backdropBlurDisabled;
    const STYLE_ID = 'hobunjiDisableBackdropBlurStyle';
    let styleEl = document.getElementById(STYLE_ID);
    if (backdropBlurDisabled) {
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = STYLE_ID;
        styleEl.textContent = '*, *::before, *::after { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }';
        document.head.appendChild(styleEl);
      }
    } else if (styleEl) {
      styleEl.remove();
    }
  }

  // Diagnostic toggle, not a real fix: even with backdrop-filter removed
  // (the toggle above), #menuPanel and #houseLayoutModal stay mounted in the
  // page at opacity:0 (not display:none) while "closed", specifically so
  // their open/close transition has something to animate. But opacity:0
  // does NOT let the browser skip recalculating style and layout for that
  // subtree the way display:none would -- #menuPanel in particular carries
  // the full inventory/farm/compendium/etc. content, a large and complex DOM
  // tree, and any mutation inside it (even one driven by gameplay code that
  // has no idea the panel is closed) can force the browser to redo
  // style/layout work for the whole thing. That recalculation happens in a
  // browser-internal phase between JS execution and paint -- structurally
  // invisible to both the requestAnimationFrame and MutationObserver
  // auto-instrumentation above, for the same underlying reason
  // backdrop-filter's composite cost was invisible to them: it isn't JS
  // execution time at all. This toggle forces a real display:none on these
  // two known opacity-based panels while they're closed, so their DOM
  // subtree drops out of layout entirely until reopened -- a harder, uglier
  // version of "closed" than the game normally uses (no fade transition
  // while this is on), but useful to isolate whether this is a real cost
  // before touching anything.
  function setForceHiddenPanelsEnabled(enabled) {
    forceHiddenPanelsEnabled = !!enabled;
    writeStorage(FORCE_HIDDEN_PANELS_KEY, forceHiddenPanelsEnabled ? '1' : '0');
    const input = document.getElementById('settingForceHiddenPanels');
    if (input) input.checked = forceHiddenPanelsEnabled;
    const STYLE_ID = 'hobunjiForceHiddenPanelsStyle';
    let styleEl = document.getElementById(STYLE_ID);
    if (forceHiddenPanelsEnabled) {
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = STYLE_ID;
        styleEl.textContent = '#menuPanel:not(.open), #houseLayoutModal:not(.open) { display: none !important; }';
        document.head.appendChild(styleEl);
      }
    } else if (styleEl) {
      styleEl.remove();
    }
  }

  function recordSubsystem(name, elapsedMs) {
    const key = String(name || 'unnamed');
    const value = Math.max(0, Number(elapsedMs) || 0);
    const prev = perfState.subsystem.get(key) || { avg: value, max: value, samples: 0 };
    prev.avg = prev.samples ? prev.avg * 0.9 + value * 0.1 : value;
    prev.max = Math.max(prev.max, value);
    prev.samples += 1;
    perfState.subsystem.set(key, prev);
    return value;
  }

  // A real snapshot showed 'gameLoop total' at 31.77ms against an 82.45ms
  // frame -- more than half the per-frame cost happens somewhere OUTSIDE
  // gameLoop's own call graph entirely. This codebase has ~70 other files
  // that each run their own independent, self-perpetuating
  // requestAnimationFrame loop, any of which could be that missing time.
  // Rather than instrument each candidate by hand one at a time, wrap
  // requestAnimationFrame itself so every callback's own cost shows up
  // automatically.
  //
  // First version of this grouped by callback FUNCTION IDENTITY (a WeakMap
  // keyed on the callback itself). That backfired: real snapshots showed
  // dozens of distinct "rAF: anonymous#1240", "anonymous#3376", etc. --
  // something is creating a BRAND NEW anonymous closure and scheduling it
  // fresh very often (a "schedule the next tick with a throwaway arrow
  // function" pattern, common across this codebase's many debounced
  // "queueRefresh"-style helpers), so identity-based grouping just gives
  // every single occurrence its own one-sample bucket -- exactly the
  // opposite of useful, since it can't tell us whether 40 different call
  // sites each fired once, or one call site fired 40 times.
  //
  // Group by CALL SITE instead: capture a stack trace at the moment
  // requestAnimationFrame(callback) is invoked (not when the callback later
  // runs), and key on the first stack frame outside this file. That's
  // stable across every distinct closure a given line of code produces, so
  // the overlay now answers "which file/line is responsible" directly
  // instead of "here are N unrelated-looking one-off timings."
  function callSiteLabel() {
    const stack = new Error().stack;
    if (!stack) return 'unknown call site';
    const lines = stack.split('\n').slice(1); // Drop the "Error" header line.
    for (const line of lines) {
      if (line.includes('js/performance-debug.js')) continue; // Skip this module's own frames.
      // Script URLs here carry a cache-busting query string (e.g.
      // ".../item-arch-category-colors.js?v=20260910review1:453:23"), so the
      // line:column numbers sit after "?...", not immediately after ".js".
      const match = line.match(/([\w-]+\.js)(?:\?[^:()\s]*)?:(\d+):(\d+)/);
      if (match) return `${match[1]}:${match[2]}`;
      const trimmed = line.trim();
      if (trimmed) return trimmed.slice(0, 60);
    }
    return 'unknown call site';
  }

  function installRafProfiler() {
    const nativeRaf = root.requestAnimationFrame;
    if (typeof nativeRaf !== 'function' || nativeRaf.__hobunjiRafProfiled) return;
    const boundNativeRaf = nativeRaf.bind(root);
    function profiledRequestAnimationFrame(callback) {
      if (typeof callback !== 'function') return boundNativeRaf(callback);
      if (!profilerEnabled) return boundNativeRaf(callback);
      const label = callSiteLabel(); // Captured HERE (scheduling time), not inside the callback below (run time) -- the stack only shows the real caller before requestAnimationFrame returns.
      return boundNativeRaf(function hobunjiTimedRafCallback(...args) {
        const start = performance.now();
        const result = callback.apply(this, args);
        recordSubsystem('rAF: ' + label, performance.now() - start);
        return result;
      });
    }
    profiledRequestAnimationFrame.__hobunjiRafProfiled = true;
    root.requestAnimationFrame = profiledRequestAnimationFrame;
  }

  // A real snapshot showed 'gameLoop total' fully explained by its own
  // nested breakdown, and every rAF: call site combined added up to under
  // 10ms -- yet 'outside gameLoop' was still ~59ms. That rules out
  // requestAnimationFrame-scheduled work as the remaining cost. This
  // codebase has ~24 separate files that each attach their own
  // MutationObserver to document.body or document.documentElement with
  // subtree:true (catalogued earlier in this investigation; two of them --
  // inventory-ui.js's menu-readability scan and controller-ui-nav.js's
  // per-frame panel-visibility check -- were already confirmed and fixed as
  // real bugs). MutationObserver callbacks run as microtasks, not through
  // requestAnimationFrame, so installRafProfiler above can't see them at
  // all. Same fix, same reasoning: wrap the MutationObserver constructor
  // itself so every observer's callback is timed automatically and
  // attributed to whichever file constructed it, instead of auditing the
  // remaining ~22 files one at a time.
  function installMutationObserverProfiler() {
    const NativeMutationObserver = root.MutationObserver;
    if (typeof NativeMutationObserver !== 'function' || NativeMutationObserver.__hobunjiMoProfiled) return;
    function ProfiledMutationObserver(callback) {
      if (typeof callback !== 'function') return new NativeMutationObserver(callback);
      const label = callSiteLabel(); // Captured at construction time -- stable for this observer's entire lifetime, unlike the per-call rAF label.
      return new NativeMutationObserver(function hobunjiTimedMutationCallback(...args) {
        if (!profilerEnabled) return callback.apply(this, args);
        const start = performance.now();
        const result = callback.apply(this, args);
        recordSubsystem('MutationObserver: ' + label, performance.now() - start);
        return result;
      });
    }
    ProfiledMutationObserver.prototype = NativeMutationObserver.prototype;
    Object.setPrototypeOf(ProfiledMutationObserver, NativeMutationObserver);
    Object.defineProperty(ProfiledMutationObserver, '__hobunjiMoProfiled', { value: true });
    root.MutationObserver = ProfiledMutationObserver;
  }

  // requestAnimationFrame and MutationObserver were both ruled out as the
  // dominant "outside gameLoop" cost (their combined totals never exceeded
  // ~20-25ms even on the worst real samples), but there's a third,
  // completely separate scheduling mechanism neither of those wrappers can
  // see: setInterval. A repo-wide search turned up 71 setInterval call
  // sites across 63 files -- periodic polling loops, retry timers, UI
  // refreshers -- none of them requestAnimationFrame-based, so none of them
  // were ever instrumented. Several fire as often as every 50-100ms, which
  // at this game's actual frame times (100-190ms on the worst samples) is
  // effectively "every frame or two." Same call-site-labeling approach as
  // MutationObserver above: each setInterval() call creates one persistent
  // timer reusing the same callback forever, so labeling at the scheduling
  // call site (not per-invocation) is both stable and cheap.
  function installSetIntervalProfiler() {
    const nativeSetInterval = root.setInterval;
    if (typeof nativeSetInterval !== 'function' || nativeSetInterval.__hobunjiIntervalProfiled) return;
    const boundNativeSetInterval = nativeSetInterval.bind(root);
    function profiledSetInterval(callback, delay, ...args) {
      if (typeof callback !== 'function') return boundNativeSetInterval(callback, delay, ...args);
      const label = callSiteLabel();
      return boundNativeSetInterval(function hobunjiTimedIntervalCallback(...cbArgs) {
        if (!profilerEnabled) return callback.apply(this, cbArgs);
        const start = performance.now();
        const result = callback.apply(this, cbArgs);
        recordSubsystem('setInterval: ' + label, performance.now() - start);
        return result;
      }, delay, ...args);
    }
    profiledSetInterval.__hobunjiIntervalProfiled = true;
    root.setInterval = profiledSetInterval;
  }

  function makeCheckboxRow(id, labelText, checked, title = '') {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0;cursor:pointer;font-size:12px';
    if (title) row.title = title;
    const text = document.createElement('span');
    text.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = !!checked;
    row.append(text, input);
    return { row, input };
  }

  // Live Southern Cloud Forest tuning lives entirely inside the Debug pane.
  // Nothing is persisted: a reload always returns to the authored game values.
  const CLOUD_FOREST_FALLBACKS = Object.freeze({
    cullRadius: 34,
    fogDensity: 0.055,
    mistRadius: 34,
    innerOpacity: 0.14,
    middleOpacity: 0.26,
    outerOpacity: 0.46,
  });
  const cloudForestDev = {
    enabled: false,
    originals: null,
    values: { ...CLOUD_FOREST_FALLBACKS }, // Used by the live override hook and slider labels.
    hookRetries: 0,
  };

  function getCloudForestZone() {
    try {
      if (typeof EXTERIOR_ZONES !== 'undefined') return EXTERIOR_ZONES?.map_southern_cloud_forest || null;
    } catch (_) {}
    return root.EXTERIOR_ZONES?.map_southern_cloud_forest || null;
  }

  function getDevActiveScene() {
    try {
      if (typeof getActiveScene === 'function') return getActiveScene();
    } catch (_) {}
    return perfState.scene || null;
  }

  function getCloudForestMistLayers(scene = getDevActiveScene()) {
    const group = scene?.getObjectByName?.('cloud_forest_mist_cylinders');
    if (!group) return [];
    return [...group.children]
      .filter(child => /^cloud_forest_mist_\d+$/.test(child?.name || ''))
      .sort((a, b) => Number(a.name.split('_').pop()) - Number(b.name.split('_').pop()));
  }

  function captureCloudForestOriginals() {
    if (cloudForestDev.originals) return cloudForestDev.originals;
    const zone = getCloudForestZone();
    const cullRadius = Number(zone?.vegCullRadiusTiles);
    const fogDensity = Number(zone?.fogDensity);
    cloudForestDev.originals = {
      cullRadius: Number.isFinite(cullRadius) ? cullRadius : CLOUD_FOREST_FALLBACKS.cullRadius,
      fogDensity: Number.isFinite(fogDensity) ? fogDensity : CLOUD_FOREST_FALLBACKS.fogDensity,
      mistRadius: Number.isFinite(cullRadius) ? cullRadius : CLOUD_FOREST_FALLBACKS.mistRadius,
      innerOpacity: CLOUD_FOREST_FALLBACKS.innerOpacity,
      middleOpacity: CLOUD_FOREST_FALLBACKS.middleOpacity,
      outerOpacity: CLOUD_FOREST_FALLBACKS.outerOpacity,
    };
    cloudForestDev.values = { ...cloudForestDev.originals };
    return cloudForestDev.originals;
  }

  function cloudForestIsActive() {
    try { return root.CloudForestFog?.getDebugState?.().active === true; }
    catch (_) { return false; }
  }

  function applyCloudForestDevOverrides() {
    if (!cloudForestDev.enabled) return;
    const values = cloudForestDev.values;
    const zone = getCloudForestZone();
    if (zone) {
      zone.vegCullRadiusTiles = values.cullRadius;
      zone.fogDensity = values.fogDensity;
    }
    if (!cloudForestIsActive()) return;
    const scene = getDevActiveScene();
    if (scene?.fog?.isFogExp2) scene.fog.density = values.fogDensity;
    const layers = getCloudForestMistLayers(scene);
    if (layers[0]?.material) layers[0].material.opacity = values.innerOpacity;
    if (layers[1]?.material) layers[1].material.opacity = values.middleOpacity;
    if (layers[2]?.material) {
      layers[2].material.opacity = values.outerOpacity;
      layers[2].scale.x = values.mistRadius;
      layers[2].scale.z = values.mistRadius;
    }
  }

  function installCloudForestFogHook() {
    const api = root.CloudForestFog;
    if (!api || typeof api.update !== 'function') {
      if (cloudForestDev.hookRetries++ < 40) setTimeout(installCloudForestFogHook, 250);
      return false;
    }
    if (api.update.__hobunjiCloudForestDevOriginal) return true;
    const original = api.update;
    api.update = function hobunjiCloudForestDevUpdate(...args) {
      const result = original.apply(this, args);
      applyCloudForestDevOverrides();
      return result;
    };
    api.update.__hobunjiCloudForestDevOriginal = original;
    return true;
  }

  function cloudForestValueText(key, value) {
    if (key === 'fogDensity') return Number(value).toFixed(3);
    if (key.endsWith('Opacity')) return Number(value).toFixed(2);
    return `${Number(value).toFixed(0)} tiles`;
  }

  function updateCloudForestDevStatus() {
    const status = document.getElementById('cloudForestDevStatus');
    if (!status) return;
    if (!cloudForestDev.enabled) {
      status.textContent = 'Using authored game values. Move any slider to enable a temporary live override.';
      return;
    }
    const originalRadius = Math.max(0.001, cloudForestDev.originals?.cullRadius || CLOUD_FOREST_FALLBACKS.cullRadius);
    const areaPct = Math.round((cloudForestDev.values.cullRadius ** 2) / (originalRadius ** 2) * 100);
    status.textContent = `Live override active · tree-load circle ≈ ${areaPct}% of the authored area.`;
  }

  function makeCloudForestRangeRow(key, labelText, min, max, step) {
    const row = document.createElement('label');
    row.style.cssText = 'display:grid;grid-template-columns:minmax(112px,1fr) minmax(120px,1.5fr) 62px;align-items:center;gap:8px;padding:5px 0;font-size:11px';
    const label = document.createElement('span');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(cloudForestDev.values[key]);
    input.id = `cloudForestDev_${key}`;
    input.style.cssText = 'width:100%;min-width:0;touch-action:pan-y';
    const value = document.createElement('span');
    value.id = `cloudForestDev_${key}_value`;
    value.style.cssText = 'text-align:right;font:10px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;opacity:.82';
    value.textContent = cloudForestValueText(key, cloudForestDev.values[key]);
    input.addEventListener('input', () => {
      cloudForestDev.values[key] = Number(input.value); // Read by applyCloudForestDevOverrides after each fog update.
      cloudForestDev.enabled = true;
      value.textContent = cloudForestValueText(key, cloudForestDev.values[key]);
      installCloudForestFogHook();
      applyCloudForestDevOverrides();
      updateCloudForestDevStatus();
    });
    row.append(label, input, value);
    return row;
  }

  function syncCloudForestDevInputs() {
    for (const key of Object.keys(cloudForestDev.values)) {
      const input = document.getElementById(`cloudForestDev_${key}`);
      const value = document.getElementById(`cloudForestDev_${key}_value`);
      if (input) input.value = String(cloudForestDev.values[key]);
      if (value) value.textContent = cloudForestValueText(key, cloudForestDev.values[key]);
    }
    updateCloudForestDevStatus();
  }

  function resetCloudForestDevOverrides() {
    const originals = captureCloudForestOriginals();
    cloudForestDev.enabled = false;
    cloudForestDev.values = { ...originals };
    const zone = getCloudForestZone();
    if (zone) {
      zone.vegCullRadiusTiles = originals.cullRadius;
      zone.fogDensity = originals.fogDensity;
    }
    if (cloudForestIsActive()) {
      const scene = getDevActiveScene();
      if (scene?.fog?.isFogExp2) scene.fog.density = originals.fogDensity;
      const layers = getCloudForestMistLayers(scene);
      if (layers[0]?.material) layers[0].material.opacity = originals.innerOpacity;
      if (layers[1]?.material) layers[1].material.opacity = originals.middleOpacity;
      if (layers[2]?.material) {
        layers[2].material.opacity = originals.outerOpacity;
        layers[2].scale.x = originals.mistRadius;
        layers[2].scale.z = originals.mistRadius;
      }
    }
    syncCloudForestDevInputs();
    log('[CloudForestDev] Restored authored fog and vegetation-cull values.', 'info', 'foliage');
  }

  function installCloudForestTuningUI() {
    if (document.getElementById('cloudForestDevTuning')) return;
    const pane = document.getElementById('mpDebug');
    const column = pane?.firstElementChild;
    if (!column) return;
    captureCloudForestOriginals();

    const details = document.createElement('details');
    details.id = 'cloudForestDevTuning';
    details.style.cssText = 'flex:0 0 auto;margin:0 12px 6px;padding:7px 10px;border:1px solid rgba(125,211,252,.24);border-radius:8px;background:rgba(2,10,18,.34);max-height:42vh;overflow:auto';
    const summary = document.createElement('summary');
    summary.textContent = '☁ Cloud Forest performance tuning';
    summary.style.cssText = 'cursor:pointer;font-size:11px;font-weight:800;color:#bae6fd;user-select:none';
    details.appendChild(summary);

    const status = document.createElement('div');
    status.id = 'cloudForestDevStatus';
    status.style.cssText = 'font-size:10px;line-height:1.35;opacity:.68;margin:7px 0 4px';
    details.appendChild(status);
    details.appendChild(makeCloudForestRangeRow('cullRadius', 'Vegetation load radius', 10, 40, 1));
    details.appendChild(makeCloudForestRangeRow('fogDensity', 'FogExp2 density', 0.015, 0.120, 0.001));
    details.appendChild(makeCloudForestRangeRow('mistRadius', 'Outer mist radius', 8, 40, 1));
    details.appendChild(makeCloudForestRangeRow('innerOpacity', 'Inner mist opacity', 0, 1, 0.01));
    details.appendChild(makeCloudForestRangeRow('middleOpacity', 'Middle mist opacity', 0, 1, 0.01));
    details.appendChild(makeCloudForestRangeRow('outerOpacity', 'Outer mist opacity', 0, 1, 0.01));

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;justify-content:flex-end;gap:6px;margin-top:6px';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Reset authored values';
    reset.style.cssText = 'font-size:10px;padding:3px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.07);color:#d1d5db;cursor:pointer';
    reset.addEventListener('click', resetCloudForestDevOverrides);
    actions.appendChild(reset);
    details.appendChild(actions);

    const header = column.firstElementChild;
    if (header?.nextSibling) column.insertBefore(details, header.nextSibling);
    else column.appendChild(details);
    updateCloudForestDevStatus();
  }

  function syncDebugSettingsUI() {
    const state = root.DebugCategories?.getState?.();
    if (!state) return;
    const master = document.getElementById('settingDebugMaster');
    if (master) master.checked = state.master !== false;
    for (const category of root.DebugCategories.categories || []) {
      const input = document.getElementById(`settingDebugCat_${category}`);
      if (input) input.checked = state.categories[category] !== false;
    }
  }

  function installSettingsUI() {
    const fpsInput = document.getElementById('settingFpsCounter');
    if (fpsInput && !fpsInput.dataset.hobunjiPerfBound) {
      fpsInput.dataset.hobunjiPerfBound = '1';
      fpsInput.checked = fpsEnabled;
      fpsInput.addEventListener('change', () => setFpsEnabled(fpsInput.checked));
    }
    const fpsCounter = document.getElementById('fpsCounter');
    if (fpsCounter) fpsCounter.style.display = fpsEnabled ? 'block' : 'none';
    if (document.getElementById('hobunjiPerfDebugSettings')) return;
    const anchor = fpsInput?.closest('label') || fpsInput?.parentElement;
    if (!anchor?.parentElement) return;

    const box = document.createElement('div');
    box.id = 'hobunjiPerfDebugSettings';
    box.style.cssText = 'margin:8px 0 4px;padding:9px 10px;border:1px solid rgba(255,255,255,.13);border-radius:8px;background:rgba(0,0,0,.12)';
    const title = document.createElement('div');
    title.textContent = 'Performance & diagnostics';
    title.style.cssText = 'font-size:11px;font-weight:800;letter-spacing:.35px;text-transform:uppercase;opacity:.72;margin-bottom:4px';
    box.appendChild(title);

    const perf = makeCheckboxRow('settingPerfProfiler', 'Performance Profiler', profilerEnabled,
      'Renderer CPU time, draw calls, triangles, resource counts, long tasks, and a once-per-second visible-geometry breakdown. Profiling has overhead, so this is off by default.');
    perf.input.addEventListener('change', () => setProfilerEnabled(perf.input.checked));
    box.appendChild(perf.row);

    const backdropBlur = makeCheckboxRow('settingDisableBackdropBlur', 'Disable backdrop blur (diagnostic)', backdropBlurDisabled,
      'Menus use backdrop-filter: blur() to frost the game world behind them, including #menuPanel at blur(24px). Closed panels stay in the page at opacity:0 rather than display:none (so they can fade in/out), and opacity does not let the browser skip the blur\'s compositing cost -- it can keep re-blurring the animating scene behind an invisible panel every frame. This removes every blur on the page so you can check its real FPS impact directly. Visual-only: menus still work, they just render sharp instead of frosted.');
    backdropBlur.input.addEventListener('change', () => setBackdropBlurDisabled(backdropBlur.input.checked));
    box.appendChild(backdropBlur.row);

    const forceHiddenPanels = makeCheckboxRow('settingForceHiddenPanels', 'Force display:none on closed panels (diagnostic)', forceHiddenPanelsEnabled,
      '#menuPanel and #houseLayoutModal stay mounted at opacity:0 (not display:none) while closed, so their open/close animation has something to transition. Unlike the blur toggle above, this tests DOM style/layout recalculation cost rather than paint/composite cost: a large closed panel\'s subtree can still force the browser to redo layout work whenever anything inside it mutates, even fully invisible and unblurred. This forces real display:none on those two panels while closed (no fade transition while it\'s on) so you can check the FPS impact directly.');
    forceHiddenPanels.input.addEventListener('change', () => setForceHiddenPanelsEnabled(forceHiddenPanels.input.checked));
    box.appendChild(forceHiddenPanels.row);

    // Flashes a button's own label as inline feedback (e.g. "Copied!") and
    // reverts it after a moment — deliberate alternative to log()/__farmLog
    // for this whole cache-snapshot section, so neither a manual snapshot
    // nor an automatic low-FPS one ever spams the regular in-game
    // diagnostic log; see updateLagSnapshotStatusUI for the other feedback
    // channel (the status line below).
    function flashButtonLabel(btn, text, revertMs = 1500) {
      const original = btn.dataset.originalLabel || btn.textContent;
      btn.dataset.originalLabel = original;
      btn.textContent = text;
      setTimeout(() => { btn.textContent = btn.dataset.originalLabel || original; }, revertMs);
    }

    const cacheBtnRow = document.createElement('div');
    cacheBtnRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0';
    const cacheBtnLabel = document.createElement('span');
    cacheBtnLabel.textContent = 'Cache snapshot';
    cacheBtnLabel.style.fontSize = '12px';
    cacheBtnLabel.title = 'Lists every registered cache\'s current size (console.table) plus live GPU geometry/texture counts and localStorage size. Also captured automatically whenever FPS drops to 3 or below (20s cooldown) — see window.__hobunjiLagSnapshots.';
    const cacheBtn = document.createElement('button');
    cacheBtn.type = 'button';
    cacheBtn.textContent = 'Snapshot now';
    cacheBtn.style.cssText = 'font-size:11px;padding:3px 10px;border-radius:6px;cursor:pointer;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);color:#d1d5db';
    cacheBtn.addEventListener('click', () => {
      const snap = root.HobunjiCacheAudit?.print?.();
      flashButtonLabel(cacheBtn, snap ? 'Captured (see console)' : 'Unavailable');
    });
    cacheBtnRow.append(cacheBtnLabel, cacheBtn);
    box.appendChild(cacheBtnRow);

    const lagBtnRow = document.createElement('div');
    lagBtnRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0';
    const lagBtnLabel = document.createElement('span');
    lagBtnLabel.textContent = 'Copy last auto-snapshot';
    lagBtnLabel.style.fontSize = '12px';
    lagBtnLabel.title = 'Copies the most recent automatic low-FPS cache snapshot to the clipboard as JSON, ready to paste elsewhere.';
    const lagBtn = document.createElement('button');
    lagBtn.type = 'button';
    lagBtn.textContent = 'Copy';
    lagBtn.style.cssText = 'font-size:11px;padding:3px 10px;border-radius:6px;cursor:pointer;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);color:#d1d5db';
    lagBtn.addEventListener('click', async () => {
      const last = root.__hobunjiLagSnapshots[root.__hobunjiLagSnapshots.length - 1];
      if (!last) { flashButtonLabel(lagBtn, 'None yet'); return; }
      try {
        await navigator.clipboard.writeText(JSON.stringify(last, null, 2));
        flashButtonLabel(lagBtn, 'Copied!');
      } catch (_) {
        flashButtonLabel(lagBtn, 'Copy failed');
      }
    });
    lagBtnRow.append(lagBtnLabel, lagBtn);
    box.appendChild(lagBtnRow);

    const lagStatus = document.createElement('div');
    lagStatus.id = 'lagSnapshotStatus';
    lagStatus.style.cssText = 'font-size:10px;opacity:.65;margin:-2px 0 5px';
    box.appendChild(lagStatus);
    updateLagSnapshotStatusUI();

    const baked = readStorage(TREE_MODE_KEY, 'baked') !== 'procedural';
    const tree = makeCheckboxRow('settingBakedTrees', 'Baked GLB Trees', baked,
      'On: use docs/assets/models/trees/*.glb. Off: use runtime procedural tree geometry. Changing this reloads the game for a clean comparison.');
    const treeStatus = document.createElement('span');
    treeStatus.id = 'settingBakedTreesStatus';
    treeStatus.style.cssText = 'display:block;font-size:10px;opacity:.65;margin:-2px 0 5px';
    treeStatus.textContent = baked ? 'Mode: baked GLB (procedural fallback on error)' : 'Mode: procedural runtime trees';
    tree.input.addEventListener('change', () => {
      const mode = tree.input.checked ? 'baked' : 'procedural';
      writeStorage(TREE_MODE_KEY, mode);
      try { root.TreeAssetLibrary?.setMode?.(mode); } catch (_) {}
      log(`Tree rendering mode changed to ${mode}; reloading for a clean wilderness rebuild.`, 'info', 'assets');
      treeStatus.textContent = `Mode: ${mode}; reloading…`;
      setTimeout(() => root.location.reload(), 120);
    });
    box.append(tree.row, treeStatus);

    const categoriesApi = root.DebugCategories;
    if (categoriesApi) {
      const details = document.createElement('details');
      details.style.cssText = 'border-top:1px solid rgba(255,255,255,.09);padding-top:6px;margin-top:4px';
      const summary = document.createElement('summary');
      summary.textContent = 'Debug log categories';
      summary.style.cssText = 'cursor:pointer;font-size:12px;font-weight:700';
      details.appendChild(summary);
      const state = categoriesApi.getState();
      const master = makeCheckboxRow('settingDebugMaster', 'Debug logging master', state.master !== false,
        'Stops in-game debug messages before they are retained or rendered. Runtime exceptions still occur normally.');
      master.input.addEventListener('change', () => { categoriesApi.setMaster(master.input.checked); syncDebugSettingsUI(); });
      details.appendChild(master.row);
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 12px';
      for (const category of categoriesApi.categories || []) {
        const item = makeCheckboxRow(`settingDebugCat_${category}`, category[0].toUpperCase() + category.slice(1), state.categories[category] !== false);
        item.input.addEventListener('change', () => { categoriesApi.setEnabled(category, item.input.checked); syncDebugSettingsUI(); });
        grid.appendChild(item.row);
      }
      details.appendChild(grid);
      box.appendChild(details);
    }

    anchor.insertAdjacentElement('afterend', box);
    syncDebugSettingsUI();
  }

  function checkBakedTreeHealth() {
    if (readStorage(TREE_MODE_KEY, 'baked') === 'procedural') return;
    const library = root.TreeAssetLibrary;
    if (!library) {
      log('[TreeAssets] Baked GLB mode is selected but TreeAssetLibrary did not initialize; procedural trees will be used.', 'warn', 'assets');
      return;
    }
    Promise.resolve(library.preload?.()).then(() => {
      const status = library.status?.();
      if (!status) return;
      const statusEl = document.getElementById('settingBakedTreesStatus');
      if (statusEl) statusEl.textContent = `Mode: baked GLB · ${status.loaded}/${status.expected} loaded${status.failed ? ` · ${status.failed} fallback` : ''}`;
      if (status.failed > 0) log(`[TreeAssets] ${status.failed}/${status.expected} baked tree asset(s) failed; affected variants use procedural fallback.`, 'warn', 'assets');
      else if (status.loaded === status.expected) log(`[TreeAssets] Baked tree mode ready: ${status.loaded}/${status.expected} GLB variants loaded.`, 'info', 'assets');
    }).catch(error => log(`[TreeAssets] Baked tree preload failed: ${error?.message || error}; procedural fallback remains active.`, 'warn', 'assets'));
  }

  // Live renderer.info numbers, independent of whether the (heavier,
  // opt-in) Performance Profiler overlay is turned on — installRendererProfiler
  // above always captures perfState.renderer, so this works from boot.
  function getLiveGpuInfo() {
    const info = perfState.renderer?.info;
    if (!info) return null;
    return {
      geometries: Number(info.memory?.geometries) || 0,
      textures: Number(info.memory?.textures) || 0,
      calls: Number(info.render?.calls) || 0,
      triangles: Number(info.render?.triangles) || 0,
    };
  }

  root.PerfProfiler = Object.freeze({
    isEnabled: () => profilerEnabled,
    setEnabled: setProfilerEnabled,
    setFpsEnabled,
    getLiveGpuInfo,
    begin(name) { return profilerEnabled ? { name: String(name || 'unnamed'), t: performance.now() } : null; },
    end(token) { return token ? recordSubsystem(token.name, performance.now() - token.t) : 0; },
    measure(name, fn) {
      if (!profilerEnabled) return fn();
      const start = performance.now();
      try { return fn(); }
      finally { recordSubsystem(name, performance.now() - start); }
    },
    record: recordSubsystem,
    snapshot() {
      return {
        fps: perfState.fps,
        frameMs: perfState.frameMs,
        renderCpuMs: perfState.renderSamples ? perfState.renderCpuMs / perfState.renderSamples : 0,
        calls: perfState.calls,
        triangles: perfState.triangles,
        geometries: perfState.geometries,
        textures: perfState.textures,
        geometryCategories: { ...perfState.geometryCategories },
        scanMs: perfState.scanMs,
        subsystems: Object.fromEntries([...perfState.subsystem.entries()].map(([key,value]) => [key,{...value}]))
      };
    }
  });

  // ── Low-FPS auto cache-snapshot ──────────────────────────────────────
  // Runs unconditionally from boot (not gated behind the FPS counter or
  // Performance Profiler opt-ins above) so a near-freeze gets captured
  // automatically instead of only when a developer happened to have
  // diagnostics already turned on. Deliberately its own tiny rAF loop
  // rather than reusing frameLoop, which only runs while fpsEnabled or
  // profilerEnabled is true.
  const LAG_SNAPSHOT_FPS_THRESHOLD = 3;
  const LAG_SNAPSHOT_COOLDOWN_MS = 20000; // Keeps a sustained lag spell from spamming a snapshot every sample window.
  const LAG_SNAPSHOT_SAMPLE_MS = 500;
  const lagWatch = { raf: 0, sampleStart: 0, sampleFrames: 0, lastSnapshotAt: -Infinity };
  root.__hobunjiLagSnapshots = root.__hobunjiLagSnapshots || []; // Ring buffer of recent auto-captures, newest last.
  const LAG_SNAPSHOT_HISTORY_LIMIT = 10;

  function updateLagSnapshotStatusUI() {
    const el = document.getElementById('lagSnapshotStatus');
    if (!el) return;
    const last = root.__hobunjiLagSnapshots[root.__hobunjiLagSnapshots.length - 1];
    el.textContent = last
      ? `Last auto-snapshot: ${new Date(last.takenAt).toLocaleTimeString()} at ${last.triggerFps.toFixed(1)} FPS (${last.caches.length} caches).`
      : 'No automatic snapshot yet — captured whenever FPS drops to 3 or below.';
  }

  function captureLagSnapshot(fps) {
    // print() logs a console.table (devtools only) — deliberately NOT routed
    // through __farmLog/log() here, so a lag spell doesn't spam the regular
    // in-game diagnostic log; the "Copy last auto-snapshot" button below
    // reads root.__hobunjiLagSnapshots directly instead.
    const snap = root.HobunjiCacheAudit?.print?.();
    if (!snap) return;
    snap.triggerFps = fps;
    root.__hobunjiLagSnapshots.push(snap);
    if (root.__hobunjiLagSnapshots.length > LAG_SNAPSHOT_HISTORY_LIMIT) root.__hobunjiLagSnapshots.shift();
    updateLagSnapshotStatusUI();
  }

  function lagWatchLoop(ts) {
    lagWatch.raf = requestAnimationFrame(lagWatchLoop);
    if (!lagWatch.sampleStart) lagWatch.sampleStart = ts;
    lagWatch.sampleFrames += 1;
    const elapsed = ts - lagWatch.sampleStart;
    if (elapsed < LAG_SNAPSHOT_SAMPLE_MS) return;
    const fps = lagWatch.sampleFrames * 1000 / Math.max(1, elapsed);
    lagWatch.sampleFrames = 0;
    lagWatch.sampleStart = ts;
    if (fps <= LAG_SNAPSHOT_FPS_THRESHOLD && (ts - lagWatch.lastSnapshotAt) >= LAG_SNAPSHOT_COOLDOWN_MS) {
      lagWatch.lastSnapshotAt = ts;
      captureLagSnapshot(fps);
    }
  }

  function startLagWatch() {
    if (lagWatch.raf) return;
    lagWatch.raf = requestAnimationFrame(lagWatchLoop);
  }

  function install() {
    installRafProfiler(); // Before anything else below schedules its own requestAnimationFrame loop, so those get timed consistently too.
    installMutationObserverProfiler(); // Same reasoning, for the ~24 files that instead react to DOM mutations rather than polling every frame.
    installSetIntervalProfiler(); // Same reasoning again, for the ~63 files that poll on a plain setInterval timer instead of rAF or MutationObserver.
    installRendererProfiler();
    installSettingsUI();
    installCloudForestTuningUI();
    installCloudForestFogHook();
    setFpsEnabled(fpsEnabled);
    setProfilerEnabled(profilerEnabled);
    setBackdropBlurDisabled(backdropBlurDisabled);
    setForceHiddenPanelsEnabled(forceHiddenPanelsEnabled);
    startLagWatch();
    setTimeout(checkBakedTreeHealth, 4000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(typeof window !== 'undefined' ? window : null);
