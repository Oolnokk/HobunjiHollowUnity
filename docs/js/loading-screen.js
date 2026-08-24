(() => {
  'use strict';

  // Shared editor-save key: used to preview authored entries in-game when editor and game share an origin.
  const EDITOR_STORAGE_KEY = 'hobunji.loadingScreenEditor.v1';
  // Fixed shipped spacing requested for the Tankan-script columns; older editor saves cannot override it.
  const SCRIPT_COLUMN_SPACING_EM = -0.49;
  // Procedural wilderness roots used for readiness/progress checks when the generator cannot supply its own list.
  const FALLBACK_WILDERNESS_ZONE_IDS = [
    'map_northern_cliffs',
    'map_southern_cloud_forest',
    'map_western_slope',
    'map_eastern_mire',
  ];
  // Display labels used to pre-show the overlay from an existing travel action prompt before zone construction begins.
  const WILDERNESS_LABELS = ['Northern Cliffs', 'Southern Cloud Forest', 'Western Slope', 'Eastern Mire'];
  // Loader-owned style id prevents duplicate CSS if a dev tool evaluates this module twice.
  const STYLE_ID = 'hobunjiLoadingScreenRuntimeStyle';
  // Root fallback class paints black before body exists and the real loading overlay can be created.
  const PREPAINT_CLASS = 'hobunji-loading-prepaint';
  // Readiness timeout prevents an unrelated load failure from trapping a player behind a permanent black screen.
  const READY_TIMEOUT_MS = 60000;
  // Quiet delay keeps wilderness cache/bookkeeping gaps covered after synchronous generator work yields.
  const GENERATION_QUIET_MS = 1800;

  // Reusable full-screen overlay node created as soon as body exists.
  let overlay = null;
  // Cached overlay children used by rendering and animation without repeated DOM lookups.
  let elements = null;
  // Dependencies captured from WildernessMap.init; used for current-area and zone-layout readiness checks.
  let wildernessDeps = null;
  // Active reasons keep overlapping boot/game/wilderness loads from hiding one another prematurely.
  const activeReasons = new Set();
  // Small event ring is surfaced by getDebug() and mirrored to the game's mobile-friendly Debug panel.
  const recentEvents = [];
  // Normalized editor/runtime loading-screen data used for entry selection.
  let screenData = null;
  // Last entry index prevents immediate repeats when multiple loading screens have been authored.
  let lastEntryIndex = -1;
  // Current entry drives image/lore/script rendering while the overlay is visible.
  let currentEntry = null;
  // Current composition settings mirror the editor except column spacing is always forced to -0.49em.
  let currentSettings = null;
  // Lower-right visual percentage, advanced by real wilderness steps and otherwise eased while loading.
  let progress = 0;
  // Latest show timestamp drives the indeterminate percentage easing toward a pre-completion ceiling.
  let visibleSince = performance.now();
  // Last frame timestamp keeps autonomous image/script motion frame-rate independent.
  let lastFrameTime = performance.now();
  // Autonomous image pan phase follows the editor's four-corner movement path.
  let imagePanPhase = 0;
  // Vertical Tankan-script scroll phase reveals columns taller than their viewport.
  let scriptScrollPhase = 0;
  // Animation handle ensures exactly one requestAnimationFrame loop owns loading-screen motion.
  let animationFrameId = 0;
  // Number of uncached zone generations completed in the current observed Tothal batch.
  let generatedZoneCount = 0;
  // Delayed release timer keeps the screen over asynchronous work between wilderness generator calls.
  let generationQuietTimer = 0;
  // Monotonic token invalidates stale readiness pollers when a newer operation supersedes them.
  let readinessToken = 0;
  // Last observed area provides a controller/mobile safety net for transitions that bypass DOM action events.
  let lastObservedArea = null;

  function log(message) {
    const stamp = new Date().toLocaleTimeString();
    recentEvents.unshift(`[${stamp}] ${message}`);
    if (recentEvents.length > 40) recentEvents.length = 40;
    try { window.__farmLog?.(`[loading-screen] ${message}`, 'info'); } catch (_) {}
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function defaultData() {
    return {
      settings: {
        scriptSide: 'left', imageScale: 1, panRange: 7, panSpeed: 0.055,
        loreSize: 11, scriptSize: 140, scriptY: 46,
        columnSpacing: SCRIPT_COLUMN_SPACING_EM, scriptScrollSpeed: 0.02,
      },
      entries: [{ id: 'runtime-default', name: 'Hobunji Hollow', image: '', lore: '', script: 'HOBUNJI HOLLOW' }],
    };
  }

  function normalizeData(candidate) {
    const fallback = defaultData();
    const source = candidate && typeof candidate === 'object' ? candidate : fallback;
    const entries = Array.isArray(source.entries) && source.entries.length ? source.entries : fallback.entries;
    return {
      settings: {
        ...fallback.settings,
        ...(source.settings || {}),
        columnSpacing: SCRIPT_COLUMN_SPACING_EM,
      },
      entries: entries.map((entry, index) => ({
        id: String(entry?.id || `loading-${index + 1}`),
        name: String(entry?.name || `Loading screen ${index + 1}`),
        image: String(entry?.image || ''),
        lore: String(entry?.lore || ''),
        script: String(entry?.script || ''),
      })),
    };
  }

  function loadInitialData() {
    if (window.HOBUNJI_LOADING_SCREENS) return normalizeData(window.HOBUNJI_LOADING_SCREENS);
    try {
      const raw = localStorage.getItem(EDITOR_STORAGE_KEY);
      if (raw) return normalizeData(JSON.parse(raw));
    } catch (error) {
      log(`Editor loading-screen data ignored: ${error.message}`);
    }
    return normalizeData(null);
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      @font-face { font-family:"HobunjiLoadingRoman"; src:url("assets/hud/KhymeryyanRomanLetters+Numbers.otf.ttf") format("truetype"); font-display:swap; }
      @font-face { font-family:"HobunjiLoadingTankan"; src:url("assets/hud/tankanscript_rotated_flipped_horiz.otf") format("opentype"); font-display:swap; }
      html.${PREPAINT_CLASS}::after { content:""; position:fixed; inset:0; z-index:2147483000; background:#000; pointer-events:auto; }
      #hobunjiLoadingScreen { --hobunji-loading-script-column-spacing:${SCRIPT_COLUMN_SPACING_EM}em; position:fixed; inset:0; z-index:2147483001; overflow:hidden; isolation:isolate; background:#000; color:#fff; opacity:1; visibility:visible; pointer-events:auto; transition:opacity 140ms linear,visibility 0s linear 140ms; touch-action:none; }
      #hobunjiLoadingScreen.hls-hidden { opacity:0; visibility:hidden; pointer-events:none; }
      #hobunjiLoadingImage { position:absolute; left:50%; top:48%; width:auto; height:auto; max-width:78vw; max-height:70vh; object-fit:contain; object-position:center; pointer-events:none; user-select:none; -webkit-user-drag:none; will-change:transform; transform-origin:center center; }
      #hobunjiLoadingLore { position:absolute; left:50%; bottom:max(5.5vh,28px); transform:translateX(-50%); width:min(78vw,980px); text-align:center; color:#fff; font-family:"HobunjiLoadingRoman",serif; font-size:11px; line-height:1.24; text-wrap:balance; text-shadow:0 2px 8px rgba(0,0,0,.9); pointer-events:none; }
      #hobunjiLoadingPercent { position:absolute; right:max(4vw,24px); bottom:max(5.5vh,28px); color:#fff; font-family:"HobunjiLoadingRoman",serif; font-size:18px; line-height:1; text-shadow:0 2px 8px rgba(0,0,0,.9); pointer-events:none; white-space:nowrap; }
      #hobunjiLoadingScriptViewport { position:absolute; top:46%; left:25%; width:min(42vw,540px); height:min(72vh,880px); overflow:hidden; pointer-events:none; transform:translate(-50%,-50%); }
      #hobunjiLoadingScriptFloat { position:absolute; left:50%; top:0; color:#fff; pointer-events:none; will-change:transform; }
      #hobunjiLoadingScriptWords { display:flex; flex-direction:row; align-items:flex-start; justify-content:center; gap:0; width:max-content; color:#fff; }
      #hobunjiLoadingScriptWords .hls-word + .hls-word { margin-left:var(--hobunji-loading-script-column-spacing); }
      #hobunjiLoadingScriptWords .hls-word { display:flex; flex-direction:column; align-items:center; justify-content:flex-start; gap:0; font-family:"HobunjiLoadingTankan",sans-serif; font-size:140px; line-height:.56; color:#fff; white-space:nowrap; }
      #hobunjiLoadingScriptWords .hls-glyph { display:block; width:1em; height:.56em; line-height:.56em; text-align:center; color:#fff; letter-spacing:0; }
      @media (max-width:720px) {
        #hobunjiLoadingImage { max-width:92vw; max-height:62vh; top:45%; }
        #hobunjiLoadingLore { width:90vw; bottom:max(4.5vh,22px); }
        #hobunjiLoadingPercent { right:max(3vw,18px); bottom:max(4.5vh,22px); font-size:16px; }
        #hobunjiLoadingScriptViewport { width:46vw; height:min(68vh,780px); }
        #hobunjiLoadingScriptWords .hls-word { font-size:112px; }
      }
    `;
    document.head.appendChild(style);
  }

  function buildOverlay() {
    if (overlay || !document.body) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'hobunjiLoadingScreen';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.setAttribute('aria-label', 'Loading Hobunji Hollow');
    overlay.innerHTML = `
      <img id="hobunjiLoadingImage" alt="" draggable="false">
      <div id="hobunjiLoadingScriptViewport"><div id="hobunjiLoadingScriptFloat"><div id="hobunjiLoadingScriptWords"></div></div></div>
      <div id="hobunjiLoadingLore"></div>
      <div id="hobunjiLoadingPercent">0%</div>
    `;
    document.body.appendChild(overlay);
    elements = {
      image: document.getElementById('hobunjiLoadingImage'),
      lore: document.getElementById('hobunjiLoadingLore'),
      percent: document.getElementById('hobunjiLoadingPercent'),
      scriptViewport: document.getElementById('hobunjiLoadingScriptViewport'),
      scriptFloat: document.getElementById('hobunjiLoadingScriptFloat'),
      scriptWords: document.getElementById('hobunjiLoadingScriptWords'),
    };
    elements.image.addEventListener('load', () => log(`Loading art ready: ${elements.image.naturalWidth}x${elements.image.naturalHeight}`));
    elements.image.addEventListener('error', () => log(`Loading art failed: ${elements.image.getAttribute('src') || '(empty)'}`));
    document.documentElement.classList.remove(PREPAINT_CLASS);
    renderEntry(pickEntry());
    startAnimation();
    log(`Overlay created; script column spacing=${SCRIPT_COLUMN_SPACING_EM.toFixed(2)}em`);
    return overlay;
  }

  function pickEntry() {
    const entries = screenData?.entries || defaultData().entries;
    if (entries.length <= 1) {
      lastEntryIndex = 0;
      return entries[0];
    }
    let index = Math.floor(Math.random() * entries.length);
    if (index === lastEntryIndex) index = (index + 1) % entries.length;
    lastEntryIndex = index;
    return entries[index];
  }

  function renderScript(text) {
    if (!elements) return;
    elements.scriptWords.replaceChildren();
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    for (const word of words) {
      const column = document.createElement('div');
      column.className = 'hls-word';
      column.style.fontSize = `${Number(currentSettings?.scriptSize || 140)}px`;
      for (const char of Array.from(word)) {
        const glyph = document.createElement('span');
        glyph.className = 'hls-glyph';
        glyph.textContent = char;
        column.appendChild(glyph);
      }
      elements.scriptWords.appendChild(column);
    }
  }

  function renderEntry(entry) {
    if (!elements || !entry) return;
    currentEntry = entry;
    currentSettings = { ...screenData.settings, columnSpacing: SCRIPT_COLUMN_SPACING_EM };
    const image = entry.image || '';
    elements.image.style.display = image ? '' : 'none';
    if (image && elements.image.getAttribute('src') !== image) elements.image.src = image;
    elements.lore.textContent = entry.lore || '';
    elements.lore.style.fontSize = `${Number(currentSettings.loreSize || 11)}px`;
    elements.scriptViewport.style.left = currentSettings.scriptSide === 'right' ? '75%' : '25%';
    elements.scriptViewport.style.top = `${Number(currentSettings.scriptY || 46)}%`;
    elements.scriptWords.style.setProperty('--hobunji-loading-script-column-spacing', `${SCRIPT_COLUMN_SPACING_EM}em`);
    renderScript(entry.script);
    imagePanPhase = Math.random() * 4;
    scriptScrollPhase = 0;
  }

  function cornerPan(phase, rangePx) {
    const corners = [[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]];
    const wrapped = ((phase % 4) + 4) % 4;
    const index = Math.floor(wrapped);
    const local = wrapped - index;
    const eased = local * local * (3 - 2 * local);
    const from = corners[index];
    const to = corners[index + 1];
    return {
      x: (from[0] + (to[0] - from[0]) * eased) * rangePx,
      y: (from[1] + (to[1] - from[1]) * eased) * rangePx,
    };
  }

  function updateFrame(now) {
    const dt = Math.min(.05, Math.max(0, (now - lastFrameTime) / 1000));
    lastFrameTime = now;
    if (elements && activeReasons.size) {
      const settings = currentSettings || defaultData().settings;
      imagePanPhase += dt * Number(settings.panSpeed || 0.055);
      const rangePx = Math.min(innerWidth, innerHeight) * (Number(settings.panRange || 7) / 100);
      const pan = cornerPan(imagePanPhase, rangePx);
      elements.image.style.transform = `translate(calc(-50% + ${pan.x}px),calc(-50% + ${pan.y}px)) scale(${Number(settings.imageScale || 1)})`;
      scriptScrollPhase = (scriptScrollPhase + dt * Number(settings.scriptScrollSpeed || 0.02)) % 1;
      const viewportHeight = elements.scriptViewport.clientHeight || 0;
      const contentHeight = elements.scriptFloat.offsetHeight || 0;
      const maxScroll = Math.max(0, contentHeight - viewportHeight);
      elements.scriptFloat.style.transform = `translateX(-50%) translateY(${-maxScroll * scriptScrollPhase}px)`;
      const elapsed = Math.max(0, now - visibleSince);
      const cosmeticTarget = Math.min(92, 18 + 74 * (1 - Math.exp(-elapsed / 5200)));
      if (progress < cosmeticTarget) progress = Math.min(cosmeticTarget, progress + 0.18);
      elements.percent.textContent = `${Math.round(progress)}%`;
    }
    animationFrameId = requestAnimationFrame(updateFrame);
  }

  function startAnimation() {
    if (animationFrameId) return;
    lastFrameTime = performance.now();
    animationFrameId = requestAnimationFrame(updateFrame);
  }

  function setProgress(value) {
    progress = clamp(Number(value) || 0, 0, 100);
    if (elements) elements.percent.textContent = `${Math.round(progress)}%`;
  }

  function show(reason = 'manual', options = {}) {
    const wasEmpty = activeReasons.size === 0;
    activeReasons.add(reason);
    visibleSince = performance.now();
    if (options.resetProgress !== false && wasEmpty) setProgress(0);
    if (!overlay) buildOverlay();
    if (overlay && options.newEntry !== false) renderEntry(pickEntry());
    overlay?.classList.remove('hls-hidden');
    document.documentElement.classList.remove(PREPAINT_CLASS);
    startAnimation();
    log(`Show: ${reason}; active=${Array.from(activeReasons).join(',')}`);
  }

  function hide(reason = 'manual') {
    activeReasons.delete(reason);
    if (activeReasons.size) {
      log(`Release: ${reason}; still active=${Array.from(activeReasons).join(',')}`);
      return;
    }
    setProgress(100);
    const token = ++readinessToken;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (token !== readinessToken || activeReasons.size) return;
      overlay?.classList.add('hls-hidden');
      log(`Hidden after: ${reason}`);
    }));
  }

  function wildernessZoneIds() {
    try {
      const ids = window.WildernessMapGenerator?.zoneMapIds?.();
      if (Array.isArray(ids) && ids.length) return ids;
    } catch (_) {}
    return FALLBACK_WILDERNESS_ZONE_IDS.slice();
  }

  function zoneLayoutsReady() {
    const layouts = wildernessDeps?._zoneLayouts || window._zoneLayouts;
    if (!layouts || typeof layouts.has !== 'function') return false;
    return wildernessZoneIds().every(zoneId => layouts.has(zoneId));
  }

  function currentArea() {
    try { return wildernessDeps?.getCurrentArea?.() || null; } catch (_) { return null; }
  }

  function isWildernessArea(area) {
    if (!area) return false;
    try { if (wildernessDeps?._isZoneArea?.(area)) return true; } catch (_) {}
    return wildernessZoneIds().includes(area);
  }

  function waitForGameReady(reason) {
    const token = ++readinessToken;
    const startedAt = performance.now();
    const poll = () => {
      if (token !== readinessToken || !activeReasons.has(reason)) return;
      const bodyReady = document.readyState === 'complete';
      const canvasReady = !!document.querySelector('#threeContainer canvas');
      const wildernessReady = zoneLayoutsReady() || !window.WildernessMapGenerator;
      if (bodyReady && canvasReady && wildernessReady) {
        hide(reason);
        return;
      }
      if (performance.now() - startedAt >= READY_TIMEOUT_MS) {
        log(`Readiness timeout for ${reason}; releasing overlay to avoid lockout`);
        hide(reason);
        return;
      }
      setTimeout(poll, 100);
    };
    setTimeout(poll, 0);
  }

  function scheduleGenerationRelease() {
    clearTimeout(generationQuietTimer);
    generationQuietTimer = setTimeout(() => {
      generationQuietTimer = 0;
      if (activeReasons.has('wilderness-generation')) hide('wilderness-generation');
    }, GENERATION_QUIET_MS);
  }

  function wrapWildernessGenerator() {
    const generator = window.WildernessMapGenerator;
    if (!generator?.generateZoneWorkspace || generator.__hobunjiLoadingWrapped) return;
    const originalGenerate = generator.generateZoneWorkspace.bind(generator);
    generator.generateZoneWorkspace = function wrappedGenerateZoneWorkspace(...args) {
      if (!activeReasons.has('wilderness-generation')) {
        generatedZoneCount = 0;
        show('wilderness-generation');
        setProgress(8);
      }
      try {
        return originalGenerate(...args);
      } finally {
        generatedZoneCount += 1;
        const total = Math.max(1, wildernessZoneIds().length);
        setProgress(8 + Math.min(1, generatedZoneCount / total) * 82);
        log(`Wilderness generation step ${generatedZoneCount}/${total}: ${String(args[0] || 'zone')}`);
        scheduleGenerationRelease();
      }
    };
    generator.__hobunjiLoadingWrapped = true;
    log('Wrapped WildernessMapGenerator.generateZoneWorkspace');
  }

  function attachWildernessMapHook() {
    wrapWildernessGenerator();
    const mapModule = window.WildernessMap;
    if (!mapModule?.init || mapModule.__hobunjiLoadingWrapped) return false;
    const originalInit = mapModule.init.bind(mapModule);
    mapModule.init = function loadingAwareWildernessMapInit(injectedDeps) {
      wildernessDeps = injectedDeps || null;
      const result = originalInit(injectedDeps);
      log('Captured WildernessMap runtime dependencies');
      return result;
    };
    mapModule.__hobunjiLoadingWrapped = true;
    return true;
  }

  function promptNamesWilderness() {
    const text = String(document.getElementById('actionPrompt')?.textContent || '');
    return WILDERNESS_LABELS.some(label => text.includes(label));
  }

  function preShowWildernessEntry() {
    if (!promptNamesWilderness()) return;
    show('wilderness-entry');
    setProgress(10);
    const token = ++readinessToken;
    const startedAt = performance.now();
    const poll = () => {
      if (token !== readinessToken || !activeReasons.has('wilderness-entry')) return;
      const area = currentArea();
      const minimap = document.getElementById('minimapWidget');
      const mapPresented = isWildernessArea(area) && !!minimap && getComputedStyle(minimap).display !== 'none';
      if (mapPresented) {
        hide('wilderness-entry');
        return;
      }
      if (performance.now() - startedAt >= READY_TIMEOUT_MS) {
        log('Wilderness-entry readiness timed out; releasing overlay');
        hide('wilderness-entry');
        return;
      }
      setTimeout(poll, 80);
    };
    setTimeout(poll, 0);
  }

  function installLifecycleHooks() {
    window.addEventListener('hobunjiPlayerReady', () => {
      show('game-load');
      waitForGameReady('game-load');
    }, true);

    window.addEventListener('load', () => {
      hide('page-boot');
      if (window.__hobunjiCutscenePreview) {
        show('game-load');
        waitForGameReady('game-load');
      }
    }, { once: true });

    document.addEventListener('pointerdown', event => {
      const target = event.target instanceof Element ? event.target.closest('button') : null;
      if (target?.id === 'wildlifeShiftBtn') {
        show('wilderness-generation');
        setProgress(4);
        scheduleGenerationRelease();
        return;
      }
      if (target?.id === 'btnAction1' || target?.id === 'btnAction2' || target?.id === 'btnAction3') preShowWildernessEntry();
    }, true);

    window.addEventListener('keydown', event => {
      if (event.repeat) return;
      if (event.key === 'Enter' || event.key === 'e' || event.key === 'E') preShowWildernessEntry();
    }, true);

    setInterval(() => {
      const area = currentArea();
      if (!area || area === lastObservedArea) return;
      const previous = lastObservedArea;
      lastObservedArea = area;
      if (!isWildernessArea(area)) return;
      log(`Observed wilderness area change: ${previous || '(none)'} -> ${area}`);
      if (activeReasons.has('wilderness-generation')) return;
      if (!zoneLayoutsReady()) {
        show('wilderness-entry', { newEntry: false });
        waitForGameReady('wilderness-entry');
      }
    }, 120);
  }

  function getDebug() {
    const layouts = wildernessDeps?._zoneLayouts || window._zoneLayouts;
    return {
      visible: !!overlay && !overlay.classList.contains('hls-hidden'),
      activeReasons: Array.from(activeReasons),
      progress: Math.round(progress),
      scriptColumnSpacingEm: SCRIPT_COLUMN_SPACING_EM,
      currentEntry: currentEntry?.name || null,
      currentArea: currentArea(),
      zoneLayoutsReady: zoneLayoutsReady(),
      loadedZoneIds: layouts && typeof layouts.keys === 'function' ? Array.from(layouts.keys()).filter(id => wildernessZoneIds().includes(id)) : [],
      generatorWrapped: !!window.WildernessMapGenerator?.__hobunjiLoadingWrapped,
      wildernessMapWrapped: !!window.WildernessMap?.__hobunjiLoadingWrapped,
      recentEvents: recentEvents.slice(0, 20),
    };
  }

  function setData(nextData) {
    screenData = normalizeData(nextData);
    if (overlay && activeReasons.size) renderEntry(pickEntry());
    log(`Runtime loading-screen data replaced (${screenData.entries.length} entries)`);
  }

  screenData = loadInitialData();
  installStyles();
  document.documentElement.classList.add(PREPAINT_CLASS);
  activeReasons.add('page-boot');
  installLifecycleHooks();
  wrapWildernessGenerator();

  if (document.body) buildOverlay();
  else document.addEventListener('DOMContentLoaded', buildOverlay, { once: true });

  window.HobunjiLoadingScreen = {
    show,
    hide,
    setProgress,
    setData,
    attachWildernessMapHook,
    getDebug,
    isVisible: () => !!overlay && !overlay.classList.contains('hls-hidden'),
    SCRIPT_COLUMN_SPACING_EM,
  };

  log('Loading-screen runtime initialized; recent change: game boot + wilderness loading coverage with -0.49em Tankan column spacing.');
})();