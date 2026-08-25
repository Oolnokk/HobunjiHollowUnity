// Optional FPS/performance diagnostics and tree-source comparison controls.
// Loaded by debug.js. Heavy profiling work is disabled by default.
(function (root) {
  'use strict';
  if (!root || root.PerfProfiler) return;

  const FPS_PREF_KEY = 'hobunji_fps_counter_v1';
  const PROFILER_PREF_KEY = 'hobunji_perf_profiler_v1';
  const WATCHDOG_PREF_KEY = 'hobunji_perf_watchdog_v1';
  const TREE_MODE_KEY = 'hobunji_tree_asset_mode_v1';

  // Freeze watchdog tuning. Unlike the Performance Profiler (opt-in, has real
  // per-call overhead from its measure()/begin()/end() instrumentation), this
  // is meant to run always: a renderer-stat readout, a native `longtask`
  // observer, and a frame-delta check are all effectively free until a freeze
  // actually happens, so there's no reason to gate freeze detection behind a
  // toggle most players will never enable.
  const LONGTASK_DUMP_MS = 150; // Below this, still counted (perfState.longTasks) but not worth a full dump.
  const HARD_FREEZE_MS = 1000; // A single frame gap this large is a freeze on its own, dumped immediately.
  const SUSTAINED_SLOW_MS = 200; // ~5fps or worse.
  const SUSTAINED_SLOW_FRAMES = 8; // ...for this many consecutive frames counts as a freeze even without one giant gap.
  const MIN_DUMP_INTERVAL_MS = 2000; // Rate limit so a prolonged stall/recovery doesn't spam dozens of near-identical dumps.
  const MAX_FREEZE_DUMPS = 20;

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
  let watchdogEnabled = readStorage(WATCHDOG_PREF_KEY, '1') === '1';
  const perfState = {
    raf: 0,
    lastFrameTs: 0,
    sampleStart: 0,
    sampleFrames: 0,
    fps: 0,
    frameMs: 0,
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
    slowFrameStreak: 0,
    lastDumpTs: 0,
    dumpSeq: 0,
    freezeDumps: [],
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
    const totalCount = geometry.index?.count ?? geometry.attributes?.position?.count ?? 0;
    // Several meshes (see terrain-render-chunks.js's spatial chunking) share
    // ONE big index buffer across many sibling meshes, each drawing only its
    // own drawRange slice of it. geometry.index.count is that whole shared
    // buffer's size, not this particular mesh's share — reading it directly
    // over-counts by roughly (number of sibling chunks) for every one of
    // them, compounding into an absurd total (a real ~1M-triangle terrain
    // surface split into hundreds of chunks was reported as several hundred
    // million). Clamp to drawRange when it's actually restricting output.
    const range = geometry.drawRange;
    const count = range && Number.isFinite(range.count)
      ? Math.max(0, Math.min(range.count, totalCount - (range.start || 0)))
      : totalCount;
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

  // Captures a snapshot of what the game was doing right around a detected
  // freeze — draw calls/triangles, a one-off visible-geometry breakdown (the
  // expensive full-scene traversal that only makes sense to pay for right
  // here, at dump time, not every frame), whatever per-subsystem timings the
  // Performance Profiler has recorded (empty unless that's also enabled —
  // measure()/begin()/end() stay opt-in since those DO have real per-call
  // overhead at hot instrumented sites), and Cloud Forest's own debug state
  // when present, since that's the zone most reports of freezing point to.
  // Rate-limited so a prolonged stall/recovery doesn't produce a dozen
  // near-identical dumps.
  function captureFreezeDump(reason, extra = {}) {
    if (!watchdogEnabled) return null;
    const now = performance.now();
    if (now - perfState.lastDumpTs < MIN_DUMP_INTERVAL_MS) return null;
    perfState.lastDumpTs = now;

    const scene = perfState.scene || getDevActiveScene();
    if (scene) scanVisibleGeometry(scene);
    const geom = Object.entries(perfState.geometryCategories).sort((a, b) => b[1] - a[1]);

    const dump = {
      id: ++perfState.dumpSeq,
      atMs: now,
      atIso: new Date().toISOString(),
      reason: String(reason || 'unknown'),
      fps: perfState.fps,
      frameMs: perfState.frameMs,
      calls: perfState.calls,
      triangles: perfState.triangles,
      geometries: perfState.geometries,
      textures: perfState.textures,
      topGeometry: geom[0] || null,
      geometryCategories: { ...perfState.geometryCategories },
      subsystems: Object.fromEntries([...perfState.subsystem.entries()].map(([key, value]) => [key, { ...value }])),
      ...extra,
    };
    try {
      dump.cloudForest = {
        batcher: root.CloudForestTreeBatcher?.getDebugState?.() || null,
        fog: root.CloudForestFog?.getDebugState?.() || null,
        treeAssets: root.TreeAssetLibrary?.status?.() || null,
      };
    } catch (_) {}

    perfState.freezeDumps.push(dump);
    if (perfState.freezeDumps.length > MAX_FREEZE_DUMPS) perfState.freezeDumps.shift();

    const topLine = dump.topGeometry ? `${dump.topGeometry[0]} ${formatCount(dump.topGeometry[1])} tris` : 'no scene to scan';
    log(`[PerfWatchdog] ${dump.reason} — dump #${dump.id} (draw calls ${formatCount(dump.calls)}, top geometry: ${topLine})`, 'warn', 'render');
    updateWatchdogStatusUI();
    return dump;
  }

  // Renderer stats are polled directly off the live renderer's own `.info`
  // (which three.js maintains internally regardless of who reads it) rather
  // than by wrapping render() to time it. Wrapping doesn't work here: this
  // script is injected lazily/async by debug.js, long after game.js has
  // already constructed the one WebGLRenderer instance it ever will — a
  // prototype patch is a no-op in this game's vendored r128 (render() is set
  // as an own property inside the constructor closure, not on the prototype;
  // held-object-render-order.js hits the same wall and disables itself for
  // exactly this reason), and a constructor patch is simply too late to catch
  // an instance that already exists. Polling `.info` sidesteps the timing
  // problem entirely and needs no game.js render-loop changes beyond the
  // one-line `window.__hobunjiRenderer` exposure added alongside it.
  function pollRendererStats() {
    const renderer = root.__hobunjiRenderer;
    const info = renderer?.info;
    if (!info) return;
    perfState.renderer = renderer;
    perfState.scene = getDevActiveScene();
    perfState.calls = Number(info.render?.calls) || 0;
    perfState.triangles = Number(info.render?.triangles) || 0;
    perfState.points = Number(info.render?.points) || 0;
    perfState.lines = Number(info.render?.lines) || 0;
    perfState.geometries = Number(info.memory?.geometries) || 0;
    perfState.textures = Number(info.memory?.textures) || 0;
  }

  // The `longtask` observer runs independent of the Performance Profiler
  // toggle: it's what actually catches a freeze as it happens (any task
  // >=50ms fires it), while the profiler overlay is just a display of
  // already-cheap-to-collect numbers. Below LONGTASK_DUMP_MS it only feeds
  // the profiler overlay's counter; at/above it, it's worth a full dump.
  function ensureLongTaskObserver() {
    if (!watchdogEnabled || perfState.longTaskObserver || !root.PerformanceObserver) return;
    try {
      const observer = new root.PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          perfState.longTasks += 1;
          if (entry.duration >= LONGTASK_DUMP_MS) captureFreezeDump(`Long task ${entry.duration.toFixed(0)}ms`, { longTaskMs: entry.duration });
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
      perfState.longTaskObserver = observer;
    } catch (_) {}
  }

  function stopLongTaskObserver() {
    try { perfState.longTaskObserver?.disconnect?.(); } catch (_) {}
    perfState.longTaskObserver = null;
  }

  function profilerText() {
    const geom = Object.entries(perfState.geometryCategories).sort((a,b) => b[1] - a[1]);
    const totalGeom = geom.reduce((sum, pair) => sum + pair[1], 0);
    const topGeom = geom[0];
    const subsystem = [...perfState.subsystem.entries()].sort((a,b) => b[1].avg - a[1].avg)[0];
    const topLine = topGeom
      ? `${topGeom[0]} ${formatCount(topGeom[1])} tris (${totalGeom ? Math.round(topGeom[1] / totalGeom * 100) : 0}%)`
      : 'not scanned yet';
    const lastDump = perfState.freezeDumps[perfState.freezeDumps.length - 1];
    return [
      `FPS ${perfState.fps.toFixed(1)}   frame ${perfState.frameMs.toFixed(2)} ms`,
      `Draw calls ${formatCount(perfState.calls)}   tris ${formatCount(perfState.triangles)}`,
      `GPU refs  geom ${formatCount(perfState.geometries)}   tex ${formatCount(perfState.textures)}`,
      `Top visible geometry: ${topLine}`,
      subsystem ? `Top timed subsystem: ${subsystem[0]} ${subsystem[1].avg.toFixed(2)} ms` : 'Timed subsystems: none instrumented',
      `Long tasks: ${perfState.longTasks}   profiler scan ${perfState.scanMs.toFixed(2)} ms`,
      lastDump ? `Freeze dumps: ${perfState.freezeDumps.length} (latest: ${lastDump.reason})` : 'Freeze dumps: none',
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
      perfState.longTasks = 0;
    } else if (overlay) overlay.style.display = 'none';
  }

  function frameLoop(ts) {
    perfState.raf = 0;
    if (!fpsEnabled && !profilerEnabled && !watchdogEnabled) return;
    pollRendererStats();
    if (!perfState.lastFrameTs) perfState.lastFrameTs = ts;
    const delta = Math.max(0, ts - perfState.lastFrameTs);
    perfState.lastFrameTs = ts;
    if (delta > 0 && delta < 1000) perfState.frameMs = perfState.frameMs ? perfState.frameMs * 0.9 + delta * 0.1 : delta;

    if (watchdogEnabled) {
      if (delta >= HARD_FREEZE_MS) {
        captureFreezeDump(`Frame stall ${delta.toFixed(0)}ms`, { frameStallMs: delta });
        perfState.slowFrameStreak = 0;
      } else if (delta >= SUSTAINED_SLOW_MS) {
        perfState.slowFrameStreak += 1;
        if (perfState.slowFrameStreak >= SUSTAINED_SLOW_FRAMES) {
          // Reset on every attempt (not just a successful one) so a slowdown
          // that lasts many seconds retries roughly every SUSTAINED_SLOW_FRAMES
          // frames instead of calling captureFreezeDump (and its rate-limit
          // check) on literally every frame while it's ongoing.
          perfState.slowFrameStreak = 0;
          captureFreezeDump(`Sustained slow frames (~${(1000 / delta).toFixed(1)}fps over ${SUSTAINED_SLOW_FRAMES}+ frames)`, { frameMs: delta });
        }
      } else {
        perfState.slowFrameStreak = 0;
      }
    }

    if (!perfState.sampleStart) perfState.sampleStart = ts;
    perfState.sampleFrames += 1;
    const elapsed = ts - perfState.sampleStart;
    if (elapsed >= 500) {
      perfState.fps = perfState.sampleFrames * 1000 / Math.max(1, elapsed);
      perfState.sampleFrames = 0;
      perfState.sampleStart = ts;
      updatePerformanceUI(ts);
    }
    perfState.raf = requestAnimationFrame(frameLoop);
  }

  function startFrameLoopIfNeeded() {
    if ((!fpsEnabled && !profilerEnabled && !watchdogEnabled) || perfState.raf) return;
    perfState.lastFrameTs = 0;
    perfState.sampleStart = 0;
    perfState.sampleFrames = 0;
    perfState.slowFrameStreak = 0;
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
      ensureProfilerOverlay();
    } else {
      const overlay = document.getElementById('perfProfilerOverlay');
      if (overlay) overlay.style.display = 'none';
    }
    startFrameLoopIfNeeded();
  }

  function setWatchdogEnabled(enabled) {
    watchdogEnabled = !!enabled;
    writeStorage(WATCHDOG_PREF_KEY, watchdogEnabled ? '1' : '0');
    const input = document.getElementById('settingPerfWatchdog');
    if (input) input.checked = watchdogEnabled;
    if (watchdogEnabled) ensureLongTaskObserver();
    else stopLongTaskObserver();
    startFrameLoopIfNeeded();
    updateWatchdogStatusUI();
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

  function getDevActiveScene() {
    // `getActiveScene` itself lives inside game.js's own IIFE closure — a bare
    // reference to it from this separately-loaded script would throw (always
    // fell through to the perfState.scene fallback below, which was in turn
    // never populated until pollRendererStats started setting it). game.js
    // exposes it explicitly as window.__hobunjiGetActiveScene for exactly
    // this kind of tooling.
    try {
      if (typeof root.__hobunjiGetActiveScene === 'function') return root.__hobunjiGetActiveScene();
    } catch (_) {}
    return perfState.scene || null;
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
      'Draw calls, triangles, resource counts, long tasks, and a once-per-second visible-geometry breakdown. The overlay text and manual measure()/begin()/end() instrumentation have real overhead, so this stays off by default.');
    perf.input.addEventListener('change', () => setProfilerEnabled(perf.input.checked));
    box.appendChild(perf.row);

    const watchdog = makeCheckboxRow('settingPerfWatchdog', 'Freeze Watchdog', watchdogEnabled,
      'Watches for browser long-tasks and stalled/sustained-slow frames and captures a diagnostic snapshot (draw calls, top visible geometry, Cloud Forest state) the moment one happens — independent of the Performance Profiler overlay above, and cheap enough to leave on. Read captured dumps via window.PerfProfiler.getFreezeDumps() in the console.');
    watchdog.input.addEventListener('change', () => setWatchdogEnabled(watchdog.input.checked));
    const watchdogStatus = document.createElement('span');
    watchdogStatus.id = 'settingPerfWatchdogStatus';
    watchdogStatus.style.cssText = 'display:block;font-size:10px;opacity:.65;margin:-2px 0 5px';
    box.append(watchdog.row, watchdogStatus);

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
    updateWatchdogStatusUI();
  }

  function updateWatchdogStatusUI() {
    const el = document.getElementById('settingPerfWatchdogStatus');
    if (!el) return;
    if (!watchdogEnabled) { el.textContent = 'Disabled.'; return; }
    const count = perfState.freezeDumps.length;
    if (!count) { el.textContent = 'Watching — no freezes captured yet.'; return; }
    const last = perfState.freezeDumps[count - 1];
    el.textContent = `${count} freeze(s) captured · latest: ${last.reason}`;
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

  root.PerfProfiler = Object.freeze({
    isEnabled: () => profilerEnabled,
    setEnabled: setProfilerEnabled,
    setFpsEnabled,
    isWatchdogEnabled: () => watchdogEnabled,
    setWatchdogEnabled,
    getFreezeDumps: () => perfState.freezeDumps.map(dump => ({ ...dump })),
    clearFreezeDumps: () => { perfState.freezeDumps.length = 0; updateWatchdogStatusUI(); },
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
        calls: perfState.calls,
        triangles: perfState.triangles,
        geometries: perfState.geometries,
        textures: perfState.textures,
        geometryCategories: { ...perfState.geometryCategories },
        scanMs: perfState.scanMs,
        subsystems: Object.fromEntries([...perfState.subsystem.entries()].map(([key,value]) => [key,{...value}])),
        freezeDumpCount: perfState.freezeDumps.length,
      };
    }
  });

  function install() {
    installSettingsUI();
    setFpsEnabled(fpsEnabled);
    setProfilerEnabled(profilerEnabled);
    setWatchdogEnabled(watchdogEnabled);
    setTimeout(checkBakedTreeHealth, 4000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(typeof window !== 'undefined' ? window : null);