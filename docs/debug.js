// Early debug bootstrap: installed before game code so startup crashes are captured.
(function () {
  'use strict';

  // Seasonal vegetation must patch THREE's texture/material constructors before
  // terrain and foliage assets start loading. Keep it parser-synchronous.
  (function loadSeasonalVegetationTintEarly() {
    const src = 'js/seasonal-vegetation-tint.js?v=20260901d';
    if (window.SeasonalVegetationTint || document.querySelector('script[data-seasonal-vegetation-tint]')) return;
    if (document.readyState === 'loading') {
      document.write(`<script src="${src}" data-seasonal-vegetation-tint="1"><\/script>`);
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.dataset.seasonalVegetationTint = '1';
    document.head.appendChild(script);
  })();

  // Cloud Forest boundary options must arm their WildernessMapGenerator guard
  // before wilderness-map-generator.js and border-terrain.js execute. Because
  // debug.js is parser-loaded near the top of index.html, document.write keeps
  // this small compatibility hook synchronous without changing the large HTML
  // boot manifest. Outside initial parsing, fall back to a normal script tag.
  (function loadCloudForestSceneryOptionsEarly() {
    const src = 'js/cloud-forest-scenery-options.js?v=20260818b';
    if (window.CloudForestSceneryOptions || document.querySelector('script[data-cloud-forest-scenery-options]')) return;
    if (document.readyState === 'loading') {
      document.write(`<script src="${src}" data-cloud-forest-scenery-options="1"><\/script>`);
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.dataset.cloudForestSceneryOptions = '1';
    document.head.appendChild(script);
  })();

  // The Cloud Forest tree batcher must load before cloud-forest-fog.js so it
  // can wrap that module's init() and capture the existing player/scene deps.
  // Keep this parser-synchronous for the same reason as the scenery guard above.
  (function loadCloudForestTreeBatcherEarly() {
    const src = 'js/cloud-forest-tree-batcher.js?v=20260824a';
    if (window.CloudForestTreeBatcher || document.querySelector('script[data-cloud-forest-tree-batcher]')) return;
    if (document.readyState === 'loading') {
      document.write(`<script src="${src}" data-cloud-forest-tree-batcher="1"><\/script>`);
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.dataset.cloudForestTreeBatcher = '1';
    document.head.appendChild(script);
  })();

  const DEBUG_PREFS_KEY = 'hobunji_debug_categories_v1';
  const DEBUG_CATEGORIES = Object.freeze(['general','render','assets','world','foliage','wildlife','chunks','combat','interaction','items','ui','audio','storage']);

  function readPrefs() {
    const defaults = Object.fromEntries(DEBUG_CATEGORIES.map(category => [category, true]));
    try {
      const raw = window.localStorage?.getItem(DEBUG_PREFS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed) return { master: true, categories: defaults };
      for (const category of DEBUG_CATEGORIES) {
        if (typeof parsed?.categories?.[category] === 'boolean') defaults[category] = parsed.categories[category];
      }
      return { master: parsed.master !== false, categories: defaults };
    } catch (_) {
      return { master: true, categories: defaults };
    }
  }

  let debugPrefs = readPrefs();
  function savePrefs() {
    try { window.localStorage?.setItem(DEBUG_PREFS_KEY, JSON.stringify(debugPrefs)); } catch (_) {}
  }

  function inferCategory(message, level = 'info') {
    const lvl = String(level || 'info').toLowerCase();
    const msg = String(message || '').toLowerCase();
    if (['audio','bgm','cue','bgs'].includes(lvl) || /\b(audio|music|bgm|bgs|sfx|sound)\b/.test(msg)) return 'audio';
    if (/\b(wilderness-chunks?|chunk streamer|chunk residency|loaded chunk|unloaded chunk)\b/.test(msg)) return 'chunks';
    if (/\b(wildlife|creature|animal|den-mother|nestmother|gar-wolf|grehlr|drenkirra|bandit camp)\b/.test(msg)) return 'wildlife';
    if (/\b(interaction|interactible|raycast|action prompt|corpse loot|nest interaction)\b/.test(msg)) return 'interaction';
    if (/\b(item|inventory|held-item|item-icon|loot|reagent|potion)\b/.test(msg)) return 'items';
    if (/\b(tree|shadewood|crowned pine|foliage|grass|bush|plant|forest|crop)\b/.test(msg)) return 'foliage';
    if (/\b(combat|attack|damage|weapon|bandit|bounty|enemy|footing|stamina)\b/.test(msg)) return 'combat';
    if (/\b(render|renderer|shader|mesh|geometry|triangle|texture|three|webgl|outline|draw call)\b/.test(msg)) return 'render';
    if (/\b(asset|gltf|glb|model|loader|load failed|recipe)\b/.test(msg)) return 'assets';
    if (/\b(map|zone|terrain|plateau|path|road|river|scenery|schedule|wilderness|town|farm)\b/.test(msg)) return 'world';
    if (/\b(ui|hud|panel|menu|inventory|popup|dialog|tooltip|button)\b/.test(msg)) return 'ui';
    if (/\b(save|localstorage|database|db|storage)\b/.test(msg)) return 'storage';
    return 'general';
  }

  function categoryEnabled(category) {
    const cat = DEBUG_CATEGORIES.includes(category) ? category : 'general';
    return debugPrefs.master !== false && debugPrefs.categories[cat] !== false;
  }

  window.__farmDebugLog = window.__farmDebugLog || [];
  window.__farmLog = function farmLog(message, level, category) {
    const lvl = level || 'info';
    const cat = DEBUG_CATEGORIES.includes(category) ? category : inferCategory(message, lvl);
    // Gate before retaining strings or rebuilding the debug DOM. Chatty hot-loop
    // diagnostics can otherwise become a performance problem by themselves.
    if (!categoryEnabled(cat)) return false;
    const stamp = new Date().toLocaleTimeString();
    window.__farmDebugLog.push({ t: stamp, lvl, cat, msg: String(message) });
    if (window.__farmDebugLog.length > 200) window.__farmDebugLog.shift();
    _renderDebugPanel();
    return true;
  };

  // ── Cache audit registry ───────────────────────────────────────────
  // A one-line opt-in registry: any module with a long-lived Map/Set it
  // wants visibility into calls HobunjiCacheAudit.register('name', () =>
  // theMap.size) once, near the cache's own declaration. Exists so a leak
  // shaped like the farm-animal genotype-texture one (a cache quietly
  // growing forever because nothing ever evicted it) can be spotted
  // empirically — by snapshotting every registered cache's current size —
  // instead of only by reading through every module by hand looking for
  // the next one. js/performance-debug.js's low-FPS watcher uses this to
  // auto-capture a snapshot the moment the game gets close to unplayable.
  const _cacheRegistry = new Map(); // name -> () => number
  window.HobunjiCacheAudit = {
    register(name, sizeFn) {
      if (typeof name !== 'string' || typeof sizeFn !== 'function') return;
      _cacheRegistry.set(name, sizeFn);
    },
    unregister(name) { _cacheRegistry.delete(name); },
    snapshot() {
      const caches = [];
      for (const [name, sizeFn] of _cacheRegistry) {
        let size;
        try { size = sizeFn(); } catch (_) { size = null; }
        caches.push({ name, size });
      }
      caches.sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0));
      let localStorageBytes = null;
      try {
        let bytes = 0;
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          bytes += k.length + (localStorage.getItem(k) || '').length;
        }
        localStorageBytes = bytes * 2; // UTF-16 code units
      } catch (_) {}
      return {
        takenAt: new Date().toISOString(),
        gpu: window.PerfProfiler?.getLiveGpuInfo?.() || null,
        localStorageBytes,
        caches,
      };
    },
    print() {
      const snap = this.snapshot();
      console.log(`[cache-audit] ${snap.takenAt}`);
      if (snap.gpu) console.log(`  GPU live refs: geometries=${snap.gpu.geometries} textures=${snap.gpu.textures} drawCalls=${snap.gpu.calls} triangles=${snap.gpu.triangles}`);
      if (snap.localStorageBytes != null) console.log(`  localStorage ~${(snap.localStorageBytes / 1024).toFixed(1)} KB`);
      if (console.table) console.table(snap.caches); else console.log(snap.caches);
      return snap;
    },
  };

  window.__debugLogFilter = window.__debugLogFilter || 'all';
  const AUDIO_LEVELS = { audio: true, bgm: true, cue: true, bgs: true };
  const NAMED_LEVELS = { audio: true, bgm: true, cue: true, bgs: true, error: true, warn: true, info: true };
  function _isScheduleEntry(e) { return e.msg.startsWith('[schedule]'); }
  function _matchesDebugFilter(e, filter) {
    switch (filter) {
      case 'all':      return true;
      case 'schedule': return _isScheduleEntry(e);
      case 'audio':    return !!AUDIO_LEVELS[e.lvl];
      case 'warn':
      case 'info':     return e.lvl === filter && !_isScheduleEntry(e);
      case 'error':    return e.lvl === 'error';
      case 'other':    return !NAMED_LEVELS[e.lvl];
      default:         return filter.startsWith('cat:') ? e.cat === filter.slice(4) : true;
    }
  }

  function _renderDebugPanel() {
    const panel = document.getElementById('debugLog');
    if (!panel) return;
    // debugLog() fires continuously during normal play (audio waits, NPC
    // schedule fallbacks, etc.), not just while a developer has the Debug
    // tab open. Rebuilding this innerHTML from up to 200 entries on every
    // one of those calls — and the DOM mutation that rebuild causes — was
    // showing up as a steady background cost even with the menu fully
    // closed. Skip the rebuild while the tab isn't visible; switchMenuPanel
    // already calls this explicitly the moment the Debug tab becomes
    // active, so nothing is lost, just deferred until it's actually shown.
    const debugPane = document.getElementById('mpDebug');
    if (!document.getElementById('menuPanel')?.classList.contains('open') || !debugPane?.classList.contains('active')) {
      return;
    }
    const COLOR = { error: '#f87171', warn: '#fb923c', promise: '#c084fc', info: '#d1d5db', fish: '#60a5fa', audio: '#ff66cc', bgm: '#4ade80', cue: '#4ade80', bgs: '#fada5e', wildlife: '#22d3ee' };
    const stuckToBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 16;
    const prevScrollTop = panel.scrollTop;
    const filter = window.__debugLogFilter || 'all';
    panel.innerHTML = window.__farmDebugLog
      .filter(e => categoryEnabled(e.cat || inferCategory(e.msg, e.lvl)))
      .filter(e => _matchesDebugFilter(e, filter))
      .map(e => {
        const c = COLOR[e.lvl] || COLOR.info;
        const safe = e.msg.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
          .replace(/fallback/gi, m => `<span style="color:#f87171;font-weight:bold">${m}</span>`);
        return `<span style="color:#6b7280">[${e.t}]</span> <span style="color:#64748b">[${e.cat || 'general'}]</span> <span style="color:${c}">${safe}</span>`;
      }).join('\n');
    panel.scrollTop = stuckToBottom ? panel.scrollHeight : prevScrollTop;
  }

  window._renderDebugPanel = _renderDebugPanel;
  window.__debugLogMatchesFilter = _matchesDebugFilter;
  window.DebugCategories = Object.freeze({
    categories: DEBUG_CATEGORIES,
    infer: inferCategory,
    isEnabled: categoryEnabled,
    getState: () => ({ master: debugPrefs.master, categories: { ...debugPrefs.categories } }),
    setMaster(enabled) {
      debugPrefs.master = !!enabled;
      savePrefs();
      _renderDebugPanel();
    },
    setEnabled(category, enabled) {
      if (!DEBUG_CATEGORIES.includes(category)) return false;
      debugPrefs.categories[category] = !!enabled;
      savePrefs();
      _renderDebugPanel();
      return true;
    },
    enableAll() {
      debugPrefs.master = true;
      for (const category of DEBUG_CATEGORIES) debugPrefs.categories[category] = true;
      savePrefs();
      _renderDebugPanel();
    },
    disableAll() {
      for (const category of DEBUG_CATEGORIES) debugPrefs.categories[category] = false;
      savePrefs();
      _renderDebugPanel();
    }
  });

  const TOOL_METAL_DEBUG_KEY = 'toolMetalRecolorDebug';
  function _toolMetalDebugEnabled() {
    if (window.ToolMetalRecolorDebug === true) return true;
    try { return window.localStorage?.getItem(TOOL_METAL_DEBUG_KEY) === '1'; }
    catch { return false; }
  }

  function _setToolMetalDebugEnabled(enabled) {
    const on = !!enabled;
    window.ToolMetalRecolorDebug = on;
    try { window.localStorage?.setItem(TOOL_METAL_DEBUG_KEY, on ? '1' : '0'); } catch {}
    const btn = document.getElementById('debugVerdigrisBtn');
    if (btn) _renderToolMetalDebugButton(btn);
    if (on) {
      window.ToolMetalRecolor?.clearCache?.();
      const requested = window.MetalCraftShop?.refreshAllMetalToolWorldTextures?.('debug-toggle') || 0;
      window.__farmLog(`[MetalToolBridge] debug toggle requested ${requested} owned metal tool texture refresh(es).`, 'info', 'assets');
    }
    window.__farmLog(`Tool verdigris diagnostics ${on ? 'enabled' : 'disabled'}.`, 'info', 'assets');
  }

  function _renderToolMetalDebugButton(btn) {
    const on = _toolMetalDebugEnabled();
    btn.textContent = `Verdigris logs: ${on ? 'On' : 'Off'}`;
    btn.setAttribute('aria-pressed', String(on));
    btn.style.fontSize = '11px';
    btn.style.padding = '3px 10px';
    btn.style.borderRadius = '6px';
    btn.style.cursor = 'pointer';
    btn.style.background = on ? 'rgba(52,211,153,.18)' : 'rgba(255,255,255,.08)';
    btn.style.border = on ? '1px solid rgba(52,211,153,.45)' : '1px solid rgba(255,255,255,.2)';
    btn.style.color = on ? '#34d399' : '#d1d5db';
  }

  function _installToolMetalDebugToggle() {
    if (document.getElementById('debugVerdigrisBtn')) return;
    const anchor = document.getElementById('debugProbeArmBtn');
    const controls = anchor?.parentElement;
    if (!controls) return;
    const btn = document.createElement('button');
    btn.id = 'debugVerdigrisBtn';
    btn.type = 'button';
    btn.title = 'Toggle detailed tool recolor / mastery verdigris diagnostics. This setting persists across reloads.';
    _renderToolMetalDebugButton(btn);
    btn.addEventListener('click', () => _setToolMetalDebugEnabled(!_toolMetalDebugEnabled()));
    controls.insertBefore(btn, anchor);
  }

  function _syncCloudForestDevTuningVisibility() {
    const devModeToggle = document.getElementById('settingDevMode'); // Authoritative Dev Mode checkbox used to gate the Cloud Forest tuning panel.
    const tuningPanel = document.getElementById('cloudForestDevTuning'); // Injected by performance-debug.js and hidden outside Dev Mode.
    if (!devModeToggle || !tuningPanel) return;
    const devModeEnabled = !!devModeToggle.checked;
    tuningPanel.style.display = devModeEnabled ? '' : 'none';
    if (!devModeEnabled) {
      // Do not leave an invisible performance override active after Dev Mode is disabled.
      const resetButton = [...tuningPanel.querySelectorAll('button')]
        .find(button => button.textContent?.trim() === 'Reset authored values');
      resetButton?.click();
    }
  }

  function _installCloudForestDevModeGate() {
    const devModeToggle = document.getElementById('settingDevMode');
    if (!devModeToggle) return;
    if (!devModeToggle.dataset.cloudForestTuningBound) {
      devModeToggle.dataset.cloudForestTuningBound = '1';
      devModeToggle.addEventListener('change', _syncCloudForestDevTuningVisibility);
    }
    _syncCloudForestDevTuningVisibility();
  }

  function _loadPerformanceDebug() {
    if (window.PerfProfiler || document.querySelector('script[data-hobunji-performance-debug]')) {
      _installCloudForestDevModeGate();
      return;
    }
    const script = document.createElement('script');
    script.src = 'js/performance-debug.js?v=20260905cacheaudit2';
    script.async = true;
    script.dataset.hobunjiPerformanceDebug = '1';
    script.onload = _installCloudForestDevModeGate;
    script.onerror = () => window.__farmLog('Performance diagnostics module failed to load.', 'warn', 'assets');
    document.head.appendChild(script);
  }

  function installDebugUI() {
    _installToolMetalDebugToggle();
    _loadPerformanceDebug();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installDebugUI, { once: true });
  else installDebugUI();

  window.setToolMetalRecolorDebug = _setToolMetalDebugEnabled;
  window.addEventListener('error', function (event) {
    window.__farmLog(`${event.message} @ ${event.filename || 'inline'}:${event.lineno || '?'}:${event.colno || '?'}`, 'error', 'general');
  });
  window.addEventListener('unhandledrejection', function (event) {
    window.__farmLog(event.reason && event.reason.stack ? event.reason.stack : String(event.reason), 'promise', 'general');
  });
  window.__farmLog('early debug hooks installed', 'info', 'general');
})();
