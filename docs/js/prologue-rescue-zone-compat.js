(() => {
  'use strict';

  // The prologue rescue clearing is authored through the ordinary map database,
  // but enterZone() and the active-grid helpers only treat ids present in the
  // game's EXTERIOR_ZONES object as wilderness zones. Registering this id too
  // early is also wrong: _loadTownFromWorkspace deliberately skips authored
  // map-file layouts for EXTERIOR_ZONES ids because the permanent wilderness
  // zones are procedurally generated. Therefore this adapter waits until the
  // authored rescue layout is already present in the private _zoneLayouts Map,
  // then adds a session-only EXTERIOR_ZONES profile cloned from the Southern
  // Cloud Forest. The existing normal enterZone/buildZoneScene path can then
  // consume the authored 10x10 layout without ever regenerating or skipping it.

  const RESCUE_MAP_ID = 'map_prologue_rescue'; // Used as the authored map that becomes a session-only zone after its layout loads.
  const CLOUD_FOREST_MAP_ID = 'map_southern_cloud_forest'; // Used as the biome/runtime profile cloned for the rescue clearing.
  const RESCUE_COLS = 10; // Used to override the cloned wilderness dimensions with the authored clearing width.
  const RESCUE_ROWS = 10; // Used to override the cloned wilderness dimensions with the authored clearing height.
  const RESCUE_ENTRY_COL = 4; // Used as the normal zone-entry column inside the central walkable clearing.
  const RESCUE_ENTRY_ROW = 4; // Used as the normal zone-entry row inside the central walkable clearing.
  const RETRY_MS = 80; // Used to wait for _loadTownFromWorkspace to finish loading the authored map before classification.
  const LOG_EVERY_ATTEMPTS = 25; // Used to rate-limit mobile-visible diagnostics while waiting on startup dependencies.
  const SAVE_META_KEY = 'hobunjiSaveMeta'; // Used to distinguish an owner rescue from ordinary worlds before polling.

  let gridDeps = null; // Captured from GridTileAccessors.init; gives access to the exact _zoneLayouts and EXTERIOR_ZONES objects game.js uses.
  let activeProfile = null; // Captured from hobunjiPlayerReady; scopes registration to a real owner rescue session.
  let retryTimer = 0; // Holds the single outstanding readiness poll so repeated lifecycle events cannot stack timers.
  let attempts = 0; // Counts readiness checks for mobile diagnostics and regression visibility.
  let registered = false; // Records whether the rescue id has been added to the live EXTERIOR_ZONES object.
  let lastStatus = 'waiting-grid-init'; // Exposes the most recent registration gate through debugSnapshot/debugText.
  let lastLoggedAttempt = 0; // Rate-limits repeated startup wait messages in the existing mobile-visible game log.

  function debugLog(message, level = 'info') {
    const logger = window.__farmLog; // Reuses the game's mobile-visible debug log instead of requiring a browser console.
    if (typeof logger === 'function') {
      try { logger(`[prologue-zone] ${message}`, level); return; } catch (_) {}
    }
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`[prologue-zone] ${message}`);
  }

  function loadMeta() {
    const raw = localStorage.getItem(SAVE_META_KEY); // Reads the selected world's persisted prologue state without depending on PrologueSystem load order.
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  function worldPrologue(worldId) {
    const meta = loadMeta(); // Used to find only the currently selected world's prologue record.
    return (meta?.worlds || []).find(world => world.id === worldId)?.prologue || null;
  }

  function profileNeedsRescue() {
    const profile = activeProfile || window.__hobunjiPlayerProfile; // Uses the event profile first, then the game's retained profile during retries.
    if (!profile?.worldId || !profile?.characterId || !profile?.isWorldOwner) return false;
    if (profile.isNewWorld) return true;
    const state = worldPrologue(profile.worldId); // Used for interrupted/reloaded owner prologues.
    return !!state && !state.completed && state.stage === 'rescue';
  }

  function liveZoneRegistry() {
    return gridDeps?.EXTERIOR_ZONES || null; // This is the same mutable object referenced by game.js's _isZoneArea/enterZone helpers.
  }

  function authoredLayoutPresent() {
    const layouts = gridDeps?._zoneLayouts; // This private Map is authoritative proof _loadTownFromWorkspace did not skip the rescue file.
    return !!layouts?.has?.(RESCUE_MAP_ID);
  }

  function clearRetry() {
    if (!retryTimer) return;
    clearTimeout(retryTimer);
    retryTimer = 0;
  }

  function scheduleRetry(delayMs = RETRY_MS) {
    clearRetry();
    retryTimer = setTimeout(() => {
      retryTimer = 0;
      prepareZoneTransport();
    }, Math.max(0, Number(delayMs) || 0));
  }

  function wait(status) {
    lastStatus = status;
    if (attempts === 1 || attempts - lastLoggedAttempt >= LOG_EVERY_ATTEMPTS) {
      lastLoggedAttempt = attempts;
      debugLog(`${status}; waiting before rescue enterZone`, 'warn');
    }
    scheduleRetry(RETRY_MS);
    return false;
  }

  function cloneCloudForestProfile(registry) {
    const cloud = registry?.[CLOUD_FOREST_MAP_ID]; // Supplies the exact normal Cloud Forest material/fog/vegetation runtime profile.
    if (!cloud) return null;
    return {
      ...cloud,
      id: RESCUE_MAP_ID,
      name: 'Prologue — Cloud Forest Rescue Clearing',
      label: 'Prologue — Cloud Forest Rescue Clearing',
      cols: RESCUE_COLS,
      rows: RESCUE_ROWS,
      entryCol: RESCUE_ENTRY_COL,
      entryRow: RESCUE_ENTRY_ROW,
      packSpecies: [],
      herbivoreSpecies: [],
    };
  }

  function prepareZoneTransport() {
    attempts += 1;
    if (registered) {
      lastStatus = 'ready';
      return true;
    }
    if (!profileNeedsRescue()) {
      lastStatus = 'not-rescue-owner';
      clearRetry();
      return false;
    }
    if (!gridDeps) return wait('waiting-grid-init');
    if (!authoredLayoutPresent()) return wait('waiting-authored-layout');

    const registry = liveZoneRegistry(); // Used only after the authored layout exists so workspace loading cannot mistake it for a generated zone.
    if (!registry) return wait('waiting-zone-registry');
    if (registry[RESCUE_MAP_ID]) {
      registered = true;
      lastStatus = 'ready-existing-registration';
      clearRetry();
      return true;
    }

    const profile = cloneCloudForestProfile(registry); // Creates the minimum session-only classification needed by normal zone transport/rendering.
    if (!profile) return wait('waiting-cloud-forest-profile');

    try {
      registry[RESCUE_MAP_ID] = profile;
    } catch (error) {
      lastStatus = `registration-error:${error?.message || error}`;
      debugLog(`could not register ${RESCUE_MAP_ID}: ${error?.message || error}`, 'error');
      scheduleRetry(RETRY_MS);
      return false;
    }

    if (registry[RESCUE_MAP_ID] !== profile) return wait('registration-did-not-stick');
    registered = true;
    lastStatus = 'ready';
    clearRetry();
    debugLog(`registered ${RESCUE_MAP_ID} as a ${RESCUE_COLS}x${RESCUE_ROWS} Cloud Forest zone after its authored layout loaded`);
    try {
      window.dispatchEvent(new CustomEvent('hobunjiPrologueRescueZoneReady', {
        detail: { mapId: RESCUE_MAP_ID, cols: RESCUE_COLS, rows: RESCUE_ROWS },
      }));
    } catch (_) {}
    window.PrologueStartupEntryBridge?.retryNow?.();
    window.PrologueSystem?.enterCurrentStage?.();
    return true;
  }

  function wrapGridTileAccessors(api) {
    if (!api?.init || api.__prologueRescueZoneCompatWrapped) return api;
    const originalInit = api.init.bind(api); // Preserves the ordinary accessor initialization while capturing its exact private runtime references.
    const wrapped = Object.assign(Object.create(Object.getPrototypeOf(api) || null), api); // Avoids mutating a future-frozen accessor export in place.
    wrapped.init = function prologueRescueZoneCompatInit(injectedDeps) {
      gridDeps = injectedDeps || null; // Used later, after workspace loading, to inspect _zoneLayouts and mutate the shared EXTERIOR_ZONES registry.
      const result = originalInit(injectedDeps);
      if (profileNeedsRescue()) scheduleRetry(0);
      return result;
    };
    Object.defineProperty(wrapped, '__prologueRescueZoneCompatWrapped', { value: true });
    return wrapped;
  }

  function installGridAccessorHook() {
    if (window.GridTileAccessors) {
      window.GridTileAccessors = wrapGridTileAccessors(window.GridTileAccessors);
      return;
    }
    let value = null; // Used only if script ordering changes and GridTileAccessors has not been assigned yet.
    Object.defineProperty(window, 'GridTileAccessors', {
      configurable: true,
      enumerable: true,
      get() { return value; },
      set(next) { value = wrapGridTileAccessors(next); },
    });
  }

  function onPlayerReady(event) {
    if (window.__hobunjiCutscenePreview) return;
    const playerData = event?.detail; // Used to scope registration to the selected real owner/world.
    if (!playerData?.worldId || !playerData?.characterId) return;
    activeProfile = playerData;
    attempts = 0;
    lastLoggedAttempt = 0;
    registered = !!liveZoneRegistry()?.[RESCUE_MAP_ID];
    lastStatus = registered ? 'ready-existing-registration' : 'player-ready';
    if (profileNeedsRescue()) scheduleRetry(0);
  }

  function debugSnapshot() {
    const registry = liveZoneRegistry(); // Used to expose classification state without devtools on mobile.
    return {
      profileNeedsRescue: profileNeedsRescue(),
      gridDepsReady: !!gridDeps,
      authoredLayoutPresent: authoredLayoutPresent(),
      rescueZoneRegistered: !!registry?.[RESCUE_MAP_ID],
      cloudForestProfilePresent: !!registry?.[CLOUD_FOREST_MAP_ID],
      registered,
      attempts,
      lastStatus,
    };
  }

  installGridAccessorHook();
  document.addEventListener('hobunjiPlayerReady', onPlayerReady, true);

  window.PrologueRescueZoneCompat = Object.freeze({
    prepareZoneTransport,
    isReady: () => registered || !!liveZoneRegistry()?.[RESCUE_MAP_ID],
    debugSnapshot,
    debugText: () => JSON.stringify(debugSnapshot(), null, 2),
  });
})();
