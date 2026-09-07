(() => {
  'use strict';

  // Prologue rescue-map adapter.
  //
  // The rescue scene is a real authored 10x10 exterior map, but it should not
  // become a permanent ordinary wilderness destination. This adapter injects
  // that authored map into the town workspace only at runtime, lets the normal
  // zone renderer build its seasonal ground, then layers the Southern Cloud
  // Forest's fog and Shadewood boundary generation onto it.
  //
  // It also owns the prologue's visual loading hold. New-world game startup is
  // still allowed to initialize its real calendar/material/map systems behind
  // the loading screen, but the loader is not permitted to expose the farm for
  // even one painted frame before the rescue clearing is fully built.

  const RESCUE_MAP_ID = 'map_prologue_rescue'; // Used as the dedicated authored first-prologue area.
  const HUNUNDI_MAP_ID = 'map_i_temple_basement_hunundi'; // Used to keep the same loading hold across the second real-map transition.
  const SAVE_META_KEY = 'hobunjiSaveMeta'; // Used to read the current world's persisted prologue stage without reaching into PrologueSystem internals.
  const RESCUE_COLS = 10; // Used by readiness checks so the loader cannot release onto a fallback/farm scene.
  const RESCUE_ROWS = 10; // Used with RESCUE_COLS to verify the authored clearing is the active grid.
  const RESCUE_FOG_COLOR = 0xffffff; // Used to match Southern Cloud Forest's authored white scene fog.
  const RESCUE_FOG_DENSITY = 0.055; // Used to match EXTERIOR_ZONES.map_southern_cloud_forest.
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
  }); // Used only to make _loadTownFromWorkspace include this standalone indexed map in resolvedMaps.

  const runtime = {
    profile: null, // Used to scope loader holding to the selected owner/world only.
    loaderHeld: false, // Used to suppress every attempted loader hide until the expected stage map is paint-ready.
    loaderReason: '', // Used by mobile/debug output to explain why the loader is still being held.
    loaderRootObserver: null, // Used to immediately undo class removal before the browser can paint the hidden loader.
    loaderFindObserver: null, // Used only if the loading-screen DOM has not been constructed yet.
    monitorTimer: 0, // Used to watch current prologue stage/current area without patching private game.js transition state.
    readyToken: 0, // Used to invalidate stale two-frame readiness releases after a stage changes.
    rescueScene: null, // Used to avoid generating the Shadewood boundary twice for one cached rescue scene.
    lastStage: null, // Used to detect rescue -> Hunundi stage changes and begin the next map hold before exposure.
    lastReadyArea: null, // Used by debug output to show which fully rendered map most recently released the loader.
  };

  function debugLog(message, level = 'info') {
    const logger = window.__farmLog; // Used to surface rescue-map diagnostics in the existing mobile-visible log.
    if (typeof logger === 'function') {
      try { logger(`[prologue-map] ${message}`, level); return; } catch (_) {}
    }
    console[level === 'error' ? 'error' : 'log'](`[prologue-map] ${message}`);
  }

  function loadMeta() {
    const raw = localStorage.getItem(SAVE_META_KEY); // Used as the persisted world metadata payload inspected by the loading guard.
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  function worldState(worldId) {
    const meta = loadMeta(); // Used to resolve the selected world's prologue record on every monitor tick.
    return (meta?.worlds || []).find(world => world.id === worldId)?.prologue || null;
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
    const originalLoadDatabase = api.loadDatabase.bind(api); // Used to preserve the selected repo/local source before adding the private prologue map stub.
    const wrapped = Object.assign(Object.create(Object.getPrototypeOf(api) || null), api); // Used as a non-mutating facade even if LocalDBOverrides itself becomes frozen later.
    wrapped.loadDatabase = async function prologueAwareLoadDatabase(id, ...args) {
      const data = await originalLoadDatabase(id, ...args); // Used as the normal database result for every source mode.
      return id === 'townWorkspace' ? augmentTownWorkspace(data) : data;
    };
    Object.defineProperty(wrapped, '__prologueRescueMapWrapped', { value: true });
    return wrapped;
  }

  function wrapCloudForestFog(api) {
    if (!api?.init || api.__prologueRescueFogWrapped) return api;
    const originalInit = api.init.bind(api); // Used to preserve every existing Southern Cloud Forest fog dependency.
    const wrapped = Object.assign(Object.create(Object.getPrototypeOf(api) || null), api); // Used so the base fog module remains otherwise unchanged.
    wrapped.init = function prologueAwareCloudForestFogInit(deps) {
      const ordinaryCloudForestCheck = deps?.isCloudForestArea; // Used as the canonical predicate for the real Southern Cloud Forest.
      return originalInit({
        ...deps,
        isCloudForestArea: () => {
          let ordinary = false; // Used to preserve normal fog behavior even if its predicate throws during early boot.
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
    let value; // Used as transparent backing storage until the later parser-time module assigns this global.
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
    const root = loaderRoot(); // Used as the actual existing loading-screen surface instead of creating a second fake overlay.
    if (!root) return;
    if (!root.classList.contains('visible')) root.classList.add('visible');
  }

  function observeLoaderRoot(root) {
    if (!root || runtime.loaderRootObserver || typeof MutationObserver !== 'function') return;
    runtime.loaderRootObserver = new MutationObserver(() => forceLoaderVisible());
    runtime.loaderRootObserver.observe(root, { attributes: true, attributeFilter: ['class'] });
  }

  function installLoaderHoldObserver() {
    const root = loaderRoot(); // Used to attach the no-farm-flash guard directly to the real loader when already built.
    if (root) {
      observeLoaderRoot(root);
      forceLoaderVisible();
      return;
    }
    if (runtime.loaderFindObserver || typeof MutationObserver !== 'function') return;
    runtime.loaderFindObserver = new MutationObserver(() => {
      const found = loaderRoot(); // Used to transfer from the document observer to the narrower class observer once loading-screen-runtime builds its DOM.
      if (!found) return;
      runtime.loaderFindObserver.disconnect();
      runtime.loaderFindObserver = null;
      observeLoaderRoot(found);
      forceLoaderVisible();
    });
    runtime.loaderFindObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function beginLoadingHold(reason) {
    runtime.loaderHeld = true;
    runtime.loaderReason = String(reason || 'prologue-map');
    runtime.readyToken += 1;
    installLoaderHoldObserver();
    try {
      window.LoadingScreenRuntime?.show?.({ reason: runtime.loaderReason });
      window.LoadingScreenRuntime?.setProgress?.(92, 'prologue-map-preparing');
    } catch (error) {
      debugLog(`loading screen show failed: ${error?.message || error}`, 'error');
    }
    forceLoaderVisible();
  }

  async function releaseLoadingHold(area) {
    if (!runtime.loaderHeld) return;
    runtime.loaderHeld = false;
    runtime.loaderReason = '';
    runtime.lastReadyArea = area || currentArea();
    runtime.loaderRootObserver?.disconnect();
    runtime.loaderRootObserver = null;
    runtime.loaderFindObserver?.disconnect();
    runtime.loaderFindObserver = null;
    try {
      window.LoadingScreenRuntime?.setProgress?.(100, 'prologue-map-ready');
      await window.LoadingScreenRuntime?.hide?.();
    } catch (error) {
      debugLog(`loading screen hide failed: ${error?.message || error}`, 'error');
    } finally {
      // LoadingScreenRuntime may already consider itself hidden because its
      // boot hide fired while our MutationObserver kept the DOM class alive.
      // Remove the held class only now, after the intended map has rendered.
      loaderRoot()?.classList.remove('visible');
    }
    debugLog(`${runtime.lastReadyArea || 'prologue map'} fully ready; loading screen released`);
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
    const generated = []; // Used to keep the dedicated Shadewood boundary identifiable for debug and future cleanup/editing.
    for (let row = 0; row < RESCUE_ROWS; row++) {
      for (let col = 0; col < RESCUE_COLS; col++) {
        if (!isOutermostTile(col, row)) continue;
        const tile = grid[row]?.[col]; // Used to guarantee trees are generated only on the authored non-walkable copse ring.
        if (!tile || tile.type !== 'shrub') continue;
        const tree = window.FoliageGenerator.buildShadewoodMesh(col, row); // Reuses the exact Cloud Forest tree generator rather than a prologue-only approximation.
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
    const access = window.GridTileAccessors; // Used as the authoritative active-area readiness source after normal enterZone completes.
    if (!access?.getActiveScene || !access?.getActiveGrid) return false;
    if (access.getActiveCols?.() !== RESCUE_COLS || access.getActiveRows?.() !== RESCUE_ROWS) return false;
    const scene = access.getActiveScene(); // Used as the actual rendered rescue scene receiving fog/boundary foliage.
    const grid = access.getActiveGrid(); // Used to verify the authored 10x10 map and its non-walkable border exist.
    if (!scene || !grid?.[4]?.[4]) return false;
    applyRescueSceneFog(scene);
    return decorateRescueBoundary(scene, grid);
  }

  function genericStageReady(expectedMap) {
    if (!expectedMap || currentArea() !== expectedMap) return false;
    try {
      return !!window.GridTileAccessors?.getActiveScene?.() && !!window.GridTileAccessors?.getActiveGrid?.();
    } catch (_) {
      return false;
    }
  }

  function releaseAfterPaint(expectedMap) {
    const token = ++runtime.readyToken; // Used to invalidate this release if another stage/hold begins during the two-frame paint barrier.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (token !== runtime.readyToken || !runtime.loaderHeld) return;
      const ready = expectedMap === RESCUE_MAP_ID ? rescueMapReady() : genericStageReady(expectedMap); // Used to recheck the exact area after both paint opportunities.
      if (!ready) return;
      releaseLoadingHold(expectedMap);
    }));
  }

  function monitorStage() {
    const profile = runtime.profile || window.__hobunjiPlayerProfile; // Used to follow only the currently selected real world/character.
    if (!profile?.worldId) return;
    const state = worldState(profile.worldId); // Used to detect stage advancement performed by PrologueSystem's persistent controller.
    if (!isIncomplete(state)) {
      if (runtime.loaderHeld) releaseLoadingHold(currentArea());
      runtime.lastStage = state?.stage || 'complete';
      return;
    }
    const expectedMap = expectedMapForStage(state.stage); // Used as the only map allowed to become visible for this prologue stage.
    if (!expectedMap) return;
    if (runtime.lastStage !== state.stage) {
      runtime.lastStage = state.stage;
      beginLoadingHold(`prologue-${state.stage}`);
    }
    const ready = expectedMap === RESCUE_MAP_ID ? rescueMapReady() : genericStageReady(expectedMap); // Used to keep the loader up through actual map construction, not merely transition start.
    if (ready && runtime.loaderHeld) releaseAfterPaint(expectedMap);
    else if (!ready && runtime.loaderHeld) forceLoaderVisible();
  }

  function startMonitor() {
    if (runtime.monitorTimer) return;
    runtime.monitorTimer = setInterval(monitorStage, 80);
    monitorStage();
  }

  function onPlayerReady(event) {
    const playerData = event?.detail; // Used to decide synchronously whether boot must remain covered before game.js can paint its default farm scene.
    if (!playerData?.worldId || !playerData?.characterId || window.__hobunjiCutscenePreview) return;
    runtime.profile = playerData;
    const state = worldState(playerData.worldId); // Used for interrupted-prologue relogins; brand-new worlds have not been initialized by PrologueSystem yet.
    const ownerNeedsPrologue = (playerData.isNewWorld && playerData.isWorldOwner) || (playerData.isWorldOwner && isIncomplete(state)); // Used to avoid touching ordinary/existing worlds.
    if (!ownerNeedsPrologue) return;
    runtime.lastStage = state?.stage || 'rescue';
    beginLoadingHold(`prologue-${runtime.lastStage}`);
    startMonitor();
  }

  function debugSnapshot() {
    const profile = runtime.profile || window.__hobunjiPlayerProfile; // Used to include selected-world context in the mobile-readable snapshot.
    const state = profile?.worldId ? worldState(profile.worldId) : null; // Used to report the current persisted prologue stage.
    const scene = currentArea() === RESCUE_MAP_ID ? window.GridTileAccessors?.getActiveScene?.() : null; // Used to expose rescue decoration counts only while relevant.
    return {
      rescueMapId: RESCUE_MAP_ID,
      rescueSize: `${RESCUE_COLS}x${RESCUE_ROWS}`,
      walkableClearing: '6x6 (cols/rows 2-7)',
      currentArea: currentArea(),
      stage: state?.stage || null,
      loaderHeld: runtime.loaderHeld,
      loaderReason: runtime.loaderReason,
      lastReadyArea: runtime.lastReadyArea,
      boundaryTrees: scene?.userData?.prologueRescueBoundaryTreeCount ?? 0,
      fogDensity: scene?.fog?.density ?? null,
      loader: window.LoadingScreenRuntime?.getDebug?.() || null,
    };
  }

  installAssignmentHook('LocalDBOverrides', wrapLocalDbOverrides);
  installAssignmentHook('CloudForestFog', wrapCloudForestFog);
  document.addEventListener('hobunjiPlayerReady', onPlayerReady, true);

  // Begin the loader before PrologueSystem's temporary Continue button advances
  // rescue -> Hunundi, so even the second map swap stays visually atomic.
  document.addEventListener('click', event => {
    if (!event.target?.closest?.('#prologueMapFlowContinue')) return;
    const profile = runtime.profile || window.__hobunjiPlayerProfile; // Used to scope this early hold to an actually-active prologue world.
    const state = profile?.worldId ? worldState(profile.worldId) : null; // Used to avoid showing a loader after the test prologue is already complete.
    if (isIncomplete(state)) beginLoadingHold(`prologue-${state.stage}-advance`);
  }, true);

  window.PrologueRescueMapRuntime = Object.freeze({
    RESCUE_MAP_ID,
    augmentTownWorkspace,
    beginLoadingHold,
    rescueMapReady,
    debugSnapshot,
  });
})();
