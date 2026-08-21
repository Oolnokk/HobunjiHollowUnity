// Optional FPS/performance diagnostics and tree-source comparison controls.
// Loaded by debug.js. Heavy profiling work is disabled by default.
(function (root) {
  'use strict';
  if (!root || root.PerfProfiler) return;

  const FPS_PREF_KEY = 'hobunji_fps_counter_v1';
  const PROFILER_PREF_KEY = 'hobunji_perf_profiler_v1';
  const TREE_MODE_KEY = 'hobunji_tree_asset_mode_v1';

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

  function installRendererProfiler() {
    const proto = root.THREE?.WebGLRenderer?.prototype;
    if (!proto || proto.__hobunjiPerfWrapped) return false;
    const original = proto.render;
    if (typeof original !== 'function') return false;
    Object.defineProperty(proto, '__hobunjiPerfWrapped', { value: true, configurable: true });
    proto.render = function hobunjiProfiledRender(scene, camera) {
      if (!profilerEnabled) return original.call(this, scene, camera);
      const start = performance.now();
      const result = original.call(this, scene, camera);
      const elapsed = performance.now() - start;
      perfState.renderCpuMs += elapsed;
      perfState.renderSamples += 1;
      perfState.renderer = this;
      perfState.scene = scene;
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
    proto.render.__hobunjiPerfDebugOriginal = original;
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

  function profilerText() {
    const avgRender = perfState.renderSamples ? perfState.renderCpuMs / perfState.renderSamples : 0;
    const geom = Object.entries(perfState.geometryCategories).sort((a,b) => b[1] - a[1]);
    const totalGeom = geom.reduce((sum, pair) => sum + pair[1], 0);
    const topGeom = geom[0];
    const subsystem = [...perfState.subsystem.entries()].sort((a,b) => b[1].avg - a[1].avg)[0];
    const topLine = topGeom
      ? `${topGeom[0]} ${formatCount(topGeom[1])} tris (${totalGeom ? Math.round(topGeom[1] / totalGeom * 100) : 0}%)`
      : 'not scanned yet';
    return [
      `FPS ${perfState.fps.toFixed(1)}   frame ${perfState.frameMs.toFixed(2)} ms`,
      `Render CPU ${avgRender.toFixed(2)} ms`,
      `Draw calls ${formatCount(perfState.calls)}   tris ${formatCount(perfState.triangles)}`,
      `GPU refs  geom ${formatCount(perfState.geometries)}   tex ${formatCount(perfState.textures)}`,
      `Top visible geometry: ${topLine}`,
      subsystem ? `Top timed subsystem: ${subsystem[0]} ${subsystem[1].avg.toFixed(2)} ms` : 'Timed subsystems: none instrumented',
      `Long tasks: ${perfState.longTasks}   profiler scan ${perfState.scanMs.toFixed(2)} ms`,
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

  root.PerfProfiler = Object.freeze({
    isEnabled: () => profilerEnabled,
    setEnabled: setProfilerEnabled,
    setFpsEnabled,
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

  function install() {
    installRendererProfiler();
    installSettingsUI();
    setFpsEnabled(fpsEnabled);
    setProfilerEnabled(profilerEnabled);
    setTimeout(checkBakedTreeHealth, 4000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(typeof window !== 'undefined' ? window : null);