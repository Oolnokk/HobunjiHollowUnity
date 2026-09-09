(() => {
  'use strict';

  // Prologue rescue-map adapter.
  //
  // This is the ONLY owner of the prologue loading-screen hold. Other
  // prologue runtimes report readiness, but they never add/remove the loader's
  // visible class and never call LoadingScreenRuntime.show()/hide().
  //
  // The rescue scene is a real authored 25x25 exterior map. It is injected
  // into the normal map workspace, rendered through the normal zone runtime,
  // then decorated with Southern Cloud Forest fog and Shadewood boundary trees.
  // Reveal waits for the real map plus scripted NPC WORLD ACTORS. Gameplay
  // dialogue/camera readiness happens after reveal and can never pin this loader.
  const RESCUE_MAP_ID = 'map_prologue_rescue'; // Dedicated authored first-prologue area.
  const HUNUNDI_MAP_ID = 'map_i_temple_basement_hunundi'; // Existing authored second-stage room.
  const SAVE_META_KEY = 'hobunjiSaveMeta'; // Reads the selected world's persisted prologue stage.
  const RESCUE_COLS = 25; // Expected authored rescue width.
  const RESCUE_ROWS = 25; // Expected authored rescue height.
  const RESCUE_CENTER_COL = 12; // Stable interior readiness probe.
  const RESCUE_CENTER_ROW = 12; // Stable interior readiness probe.
  const RESCUE_FOG_COLOR = 0xffffff; // Southern Cloud Forest fog color.
  const RESCUE_FOG_DENSITY = 0.055; // Southern Cloud Forest fog density.
  const WORKSPACE_STUB = Object.freeze({
    schema: 'hobunji_map.v1',
    id: RESCUE_MAP_ID,
    name: 'Prologue — Cloud Forest Rescue Clearing',
    category: 'exterior',
    cols: RESCUE_COLS,
    rows: RESCUE_ROWS,
    tiles: [],
    transitions: [],
    npcStations: [],
    npcPaths: [],
    routes: [],
    buildings: [],
    decor: [],
    furniture: [],
  }); // Allows _loadTownFromWorkspace to discover the standalone indexed map.

  const runtime = {
    profile: null, // Selected owner/world used by stage monitoring.
    loaderHeld: false, // True while this runtime alone owns loader visibility.
    loaderReason: '', // Mobile-readable reason for the active hold.
    loaderRootObserver: null, // Reasserts visibility while the authoritative hold is active.
    loaderFindObserver: null, // Waits for loading-screen DOM creation during early boot.
    monitorTimer: 0, // Single stage/readiness monitor.
    readyToken: 0, // Invalidates stale two-frame release attempts.
    rescueScene: null, // Prevents duplicate boundary generation for a cached scene.
    lastStage: null, // Detects persisted stage changes.
    lastReadyArea: null, // Most recently revealed fully-ready prologue map.
    showCalls: 0, // Diagnostics: prologue-created loader generations.
    releaseAttempts: 0, // Diagnostics: release requests that reached the paint barrier.
  };

  function debugLog(message, level = 'info') {
    const logger = window.__farmLog; // Reuses existing mobile-visible logging.
    if (typeof logger === 'function') {
      try { logger(`[prologue-map] ${message}`, level); return; } catch (_) {}
    }
    console[level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'log'](`[prologue-map] ${message}`);
  }

  function loadMeta() {
    const raw = localStorage.getItem(SAVE_META_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  function worldState(worldId) {
    return (loadMeta()?.worlds || []).find(world => world.id === worldId)?.prologue || null;
  }

  function isIncomplete(state) {
    return !!state && !state.completed && state.stage !== 'complete';
  }

  function currentArea() {
    try { return window.GridTileAccessors?.getCurrentArea?.() || null; }
    catch (_) { return null; }
  }

  function expectedMapForStage(stage) {
    if (stage === 'rescue') return RESCUE_MAP_ID;
    if (stage === 'hunundi_room') return HUNUNDI_MAP_ID;
    return null;
  }

  function augmentTownWorkspace(workspace) {
    if (!workspace || !Array.isArray(workspace.maps)) return workspace;
    if (workspace.maps.some(map => map?.id === RESCUE_MAP_ID)) return workspace;
    return { ...workspace, maps: [...workspace.maps, { ...WORKSPACE_STUB }] };
  }

  function wrapLocalDbOverrides(api) {
    if (!api?.loadDatabase || api.__prologueRescueMapWrapped) return api;
    const originalLoadDatabase = api.loadDatabase.bind(api);
    const wrapped = Object.assign(Object.create(Object.getPrototypeOf(api) || null), api);
    wrapped.loadDatabase = async function prologueAwareLoadDatabase(id, ...args) {
      const data = await originalLoadDatabase(id, ...args);
      return id === 'townWorkspace' ? augmentTownWorkspace(data) : data;
    };
    Object.defineProperty(wrapped, '__prologueRescueMapWrapped', { value: true });
    return wrapped;
  }

  function wrapCloudForestFog(api) {
    if (!api?.init || api.__prologueRescueFogWrapped) return api;
    const originalInit = api.init.bind(api);
    const wrapped = Object.assign(Object.create(Object.getPrototypeOf(api) || null), api);
    wrapped.init = function prologueAwareCloudForestFogInit(deps) {
      const ordinaryCloudForestCheck = deps?.isCloudForestArea;
      return originalInit({
        ...deps,
        isCloudForestArea: () => {
          let ordinary = false;
          try { ordinary = !!ordinaryCloudForestCheck?.(); } catch (_) {}
          return ordinary || currentArea() === RESCUE_MAP_ID;
        },
      });
    };
    Object.defineProperty(wrapped, '__prologueRescueFogWrapped', { value: true });
    return wrapped;
  }

  function installAssignmentHook(name, wrapper) {
    if (window[name]) {
      window[name] = wrapper(window[name]);
      return;
    }
    let value; // Backing storage until the parser-time module assigns the namespace.
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get() { return value; },
      set(next) { value = wrapper(next); },
    });
  }

  function loaderRoot() {
    return document.getElementById('hobunjiLoadScreen');
  }

  function forceLoaderVisible() {
    if (!runtime.loaderHeld) return;
    const root = loaderRoot();
    if (root && !root.classList.contains('visible')) root.classList.add('visible');
  }

  function disconnectLoaderObservers() {
    runtime.loaderRootObserver?.disconnect();
    runtime.loaderRootObserver = null;
    runtime.loaderFindObserver?.disconnect();
    runtime.loaderFindObserver = null;
  }

  function observeLoaderRoot(root) {
    if (!root || runtime.loaderRootObserver || typeof MutationObserver !== 'function') return;
    runtime.loaderRootObserver = new MutationObserver(forceLoaderVisible);
    runtime.loaderRootObserver.observe(root, { attributes: true, attributeFilter: ['class'] });
  }

  function installLoaderHoldObserver() {
    const root = loaderRoot();
    if (root) {
      observeLoaderRoot(root);
      forceLoaderVisible();
      return;
    }
    if (runtime.loaderFindObserver || typeof MutationObserver !== 'function') return;
    runtime.loaderFindObserver = new MutationObserver(() => {
      const found = loaderRoot();
      if (!found) return;
      runtime.loaderFindObserver.disconnect();
      runtime.loaderFindObserver = null;
      observeLoaderRoot(found);
      forceLoaderVisible();
    });
    runtime.loaderFindObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function beginLoadingHold(reason) {
    const nextReason = String(reason || 'prologue-map');
    if (runtime.loaderHeld) {
      runtime.loaderReason = nextReason;
      installLoaderHoldObserver();
      forceLoaderVisible();
      return false;
    }

    runtime.loaderHeld = true;
    runtime.loaderReason = nextReason;
    runtime.readyToken += 1;
    window.__hobunjiPrologueHiddenSetup = true; // Audio suppression remains active until the real DOM overlay is gone.
    installLoaderHoldObserver();

    try {
      const loaderDebug = window.LoadingScreenRuntime?.getDebug?.();
      if (!loaderDebug?.visible) {
        runtime.showCalls += 1;
        window.LoadingScreenRuntime?.show?.({ reason: runtime.loaderReason });
      }
      window.LoadingScreenRuntime?.setProgress?.(92, 'prologue-map-preparing');
    } catch (error) {
      debugLog(`loading screen show failed: ${error?.message || error}`, 'error');
    }

    forceLoaderVisible();
    return true;
  }

  async function releaseLoadingHold(area) {
    if (!runtime.loaderHeld) return false;

    runtime.loaderHeld = false; // Disable reassertion before requesting the canonical hide.
    runtime.loaderReason = '';
    runtime.lastReadyArea = area || currentArea();
    disconnectLoaderObservers();

    try {
      window.LoadingScreenRuntime?.setProgress?.(100, 'prologue-ready');
      await window.LoadingScreenRuntime?.hide?.('prologue-ready');
    } catch (error) {
      debugLog(`loading screen hide failed: ${error?.message || error}`, 'error');
    } finally {
      // This is the single final DOM removal. Dialogue readiness does not own
      // this class, so a late dialogue bridge cannot keep the map covered.
      loaderRoot()?.classList.remove('visible');
      window.__hobunjiPrologueHiddenSetup = false;
    }

    debugLog(`${runtime.lastReadyArea || 'prologue map'} map + scripted actors ready; loading screen released`);
    return true;
  }

  function applyRescueSceneFog(scene) {
    if (!scene || !window.THREE?.FogExp2) return;
    if (scene.fog?.isFogExp2) {
      scene.fog.color?.setHex?.(RESCUE_FOG_COLOR);
      scene.fog.density = RESCUE_FOG_DENSITY;
      return;
    }
    scene.fog = new window.THREE.FogExp2(RESCUE_FOG_COLOR, RESCUE_FOG_DENSITY);
  }

  function isOutermostTile(col, row) {
    return col === 0 || row === 0 || col === RESCUE_COLS - 1 || row === RESCUE_ROWS - 1;
  }

  function decorateRescueBoundary(scene, grid) {
    if (!scene || !grid || runtime.rescueScene === scene || scene.userData?.prologueRescueBoundaryReady) return true;
    if (!window.FoliageGenerator?.buildShadewoodMesh) return false;

    const generated = []; // Identifies boundary trees for debug/future cleanup.
    for (let row = 0; row < RESCUE_ROWS; row++) {
      for (let col = 0; col < RESCUE_COLS; col++) {
        if (!isOutermostTile(col, row)) continue;
        const tile = grid[row]?.[col];
        if (!tile || tile.type !== 'shrub') continue;
        const tree = window.FoliageGenerator.buildShadewoodMesh(col, row);
        if (!tree) continue;
        tree.position.set(col + 0.5, 0, row + 0.5);
        tree.userData.prologueBoundaryTree = true;
        scene.add(tree);
        generated.push(tree);
      }
    }

    scene.userData ||= {};
    scene.userData.prologueRescueBoundaryReady = true;
    scene.userData.prologueRescueBoundaryTreeCount = generated.length;
    runtime.rescueScene = scene;
    debugLog(`generated ${generated.length} Shadewood boundary trees around ${RESCUE_COLS}x${RESCUE_ROWS} rescue clearing`);
    return generated.length > 0;
  }

  function rescueMapReady() {
    if (currentArea() !== RESCUE_MAP_ID) return false;
    const access = window.GridTileAccessors;
    if (!access?.getActiveScene || !access?.getActiveGrid) return false;

    const scene = access.getActiveScene();
    const grid = access.getActiveGrid();
    if (!scene || !Array.isArray(grid)) return false;

    // Check both canonical accessors and the actual grid shape. The grid is the
    // final authority if an accessor is temporarily late during startup.
    const cols = Number(access.getActiveCols?.()) || grid[0]?.length || 0;
    const rows = Number(access.getActiveRows?.()) || grid.length || 0;
    if (cols !== RESCUE_COLS || rows !== RESCUE_ROWS) return false;
    if (!grid?.[RESCUE_CENTER_ROW]?.[RESCUE_CENTER_COL]) return false;

    applyRescueSceneFog(scene);
    return decorateRescueBoundary(scene, grid);
  }

  function rescueActorsReady() {
    try { return window.PrologueDialogueRuntime?.isRescueActorsReady?.() === true; }
    catch (_) { return false; }
  }

  function rescueRevealReady() {
    return rescueMapReady() && rescueActorsReady();
  }

  function genericStageReady(expectedMap) {
    if (!expectedMap || currentArea() !== expectedMap) return false;
    try {
      return !!window.GridTileAccessors?.getActiveScene?.() && !!window.GridTileAccessors?.getActiveGrid?.();
    } catch (_) {
      return false;
    }
  }

  function stageReadyForReveal(expectedMap) {
    return expectedMap === RESCUE_MAP_ID ? rescueRevealReady() : genericStageReady(expectedMap);
  }

  function releaseAfterPaint(expectedMap) {
    const token = ++runtime.readyToken;
    runtime.releaseAttempts += 1;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (token !== runtime.readyToken || !runtime.loaderHeld) return;
      if (!stageReadyForReveal(expectedMap)) return;
      void releaseLoadingHold(expectedMap);
    }));
  }

  function monitorStage() {
    const profile = runtime.profile || window.__hobunjiPlayerProfile;
    if (!profile?.worldId) return;

    const state = worldState(profile.worldId);
    const pendingNewOwnerRescue = !state && profile.isNewWorld && profile.isWorldOwner;

    if (!pendingNewOwnerRescue && !isIncomplete(state)) {
      if (runtime.loaderHeld) void releaseLoadingHold(currentArea());
      runtime.lastStage = state?.stage || 'complete';
      return;
    }

    const stage = pendingNewOwnerRescue ? 'rescue' : state.stage;
    const expectedMap = expectedMapForStage(stage);
    if (!expectedMap) return;

    if (runtime.lastStage !== stage) {
      runtime.lastStage = stage;
      beginLoadingHold(`prologue-${stage}`);
    }

    const ready = stageReadyForReveal(expectedMap);
    if (ready && runtime.loaderHeld) releaseAfterPaint(expectedMap);
    else if (runtime.loaderHeld) forceLoaderVisible();
  }

  function startMonitor() {
    if (runtime.monitorTimer) return;
    runtime.monitorTimer = setInterval(monitorStage, 80);
    monitorStage();
  }

  function onPlayerReady(event) {
    const playerData = event?.detail;
    if (!playerData?.worldId || !playerData?.characterId || window.__hobunjiCutscenePreview) return;

    runtime.profile = playerData;
    const state = worldState(playerData.worldId);
    const ownerNeedsPrologue =
      (playerData.isNewWorld && playerData.isWorldOwner)
      || (playerData.isWorldOwner && isIncomplete(state));
    if (!ownerNeedsPrologue) return;

    runtime.lastStage = state?.stage || 'rescue';
    beginLoadingHold(`prologue-${runtime.lastStage}`);
    startMonitor();
  }

  function requestRevealCheck() {
    monitorStage();
    return runtime.loaderHeld;
  }

  function debugSnapshot() {
    const profile = runtime.profile || window.__hobunjiPlayerProfile;
    const state = profile?.worldId ? worldState(profile.worldId) : null;
    const area = currentArea();
    const scene = area === RESCUE_MAP_ID ? window.GridTileAccessors?.getActiveScene?.() : null;
    const mapReady = area === RESCUE_MAP_ID ? rescueMapReady() : null;
    const actorsReady = area === RESCUE_MAP_ID ? rescueActorsReady() : null;
    const dialogueReady = area === RESCUE_MAP_ID
      ? window.PrologueDialogueRuntime?.isRescueStageReady?.() === true
      : null;
    return {
      rescueMapId: RESCUE_MAP_ID,
      rescueSize: `${RESCUE_COLS}x${RESCUE_ROWS}`,
      walkableClearing: '15x15 (cols/rows 5-19)',
      currentArea: area,
      stage: state?.stage || (profile?.isNewWorld ? 'rescue-pending' : null),
      loaderHeld: runtime.loaderHeld,
      loaderReason: runtime.loaderReason,
      loaderShowCalls: runtime.showCalls,
      releaseAttempts: runtime.releaseAttempts,
      mapReady,
      actorsReady,
      dialogueReady,
      revealReady: area === RESCUE_MAP_ID ? !!(mapReady && actorsReady) : null,
      hiddenSetup: !!window.__hobunjiPrologueHiddenSetup,
      lastReadyArea: runtime.lastReadyArea,
      boundaryTrees: scene?.userData?.prologueRescueBoundaryTreeCount ?? 0,
      fogDensity: scene?.fog?.density ?? null,
      loader: window.LoadingScreenRuntime?.getDebug?.() || null,
    };
  }

  installAssignmentHook('LocalDBOverrides', wrapLocalDbOverrides);
  installAssignmentHook('CloudForestFog', wrapCloudForestFog);
  document.addEventListener('hobunjiPlayerReady', onPlayerReady, true);

  // Begin the next hold before the temporary map-flow control advances stage.
  document.addEventListener('click', event => {
    if (!event.target?.closest?.('#prologueMapFlowContinue')) return;
    const profile = runtime.profile || window.__hobunjiPlayerProfile;
    const state = profile?.worldId ? worldState(profile.worldId) : null;
    if (isIncomplete(state)) beginLoadingHold(`prologue-${state.stage}-advance`);
  }, true);

  window.PrologueRescueMapRuntime = Object.freeze({
    RESCUE_MAP_ID,
    augmentTownWorkspace,
    beginLoadingHold,
    rescueMapReady,
    rescueActorsReady,
    rescueRevealReady,
    requestRevealCheck,
    debugSnapshot,
  });
})();
