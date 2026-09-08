(() => {
  'use strict';

  // The rescue clearing is classified as an EXTERIOR_ZONES area only so it
  // can use the game's normal zone renderer. It is still a scripted prologue
  // set, not a wilderness sandbox: no bandit camps, road ambushes, den packs,
  // nest guards, or other ambient hostile population may be introduced there.
  const RESCUE_MAP_ID = 'map_prologue_rescue'; // Used as the only scripted exterior currently protected by this adapter.

  let banditDeps = null; // Captured from BanditCamps.init so already-created camp hostiles can be removed safely.
  let wildlifeDeps = null; // Captured from WildlifeSpawn.init so ambient wildlife spawned during a race can be removed safely.
  let purges = 0; // Used by the mobile-visible debug snapshot to prove suppression actually ran.
  let removedHostiles = 0; // Counts non-authored hostile entities removed from the rescue map.
  let banditCallsBlocked = 0; // Counts bandit camp/encounter update calls rejected in the rescue area.
  let wildlifeCallsBlocked = 0; // Counts wildlife spawning ticks rejected in the rescue area.

  function debugLog(message, level = 'info') {
    const logger = window.__farmLog; // Reuses the existing mobile-visible log rather than relying on devtools.
    if (typeof logger === 'function') {
      try { logger(`[prologue-safe] ${message}`, level); return; } catch (_) {}
    }
    console[level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'log'](`[prologue-safe] ${message}`);
  }

  function currentArea() {
    try {
      return banditDeps?.getCurrentArea?.()
        || wildlifeDeps?.getCurrentArea?.()
        || window.GridTileAccessors?.getCurrentArea?.()
        || null;
    } catch (_) { return null; }
  }

  function isSuppressedArea(area = currentArea()) {
    if (area !== RESCUE_MAP_ID) return false;
    const profileSuppressed = window.PrologueRescueZoneCompat?.debugSnapshot?.()?.suppressProceduralPopulation;
    return profileSuppressed !== false; // Rescue remains safe even during the tiny registration/readiness window before the flag is readable.
  }

  function removeHostilesFrom(deps) {
    const hostileObjects = deps?.hostileObjects; // Used as the shared hostile entity set populated by both wildlife and bandit systems.
    if (!hostileObjects?.[Symbol.iterator]) return 0;
    let removed = 0;
    for (const creature of [...hostileObjects]) {
      if (creature?.areaId !== RESCUE_MAP_ID || creature?.prologueAuthored === true) continue;
      hostileObjects.delete?.(creature);
      try { deps?.despawnCreature?.(creature); } catch (_) {}
      removed++;
    }
    removedHostiles += removed;
    return removed;
  }

  function purgeRescuePopulation() {
    if (!isSuppressedArea(RESCUE_MAP_ID)) return 0;
    const removed = removeHostilesFrom(banditDeps) + removeHostilesFrom(wildlifeDeps);
    try { window.BanditCamps?.forgetZoneState?.(RESCUE_MAP_ID); } catch (_) {}
    purges++;
    if (removed) debugLog(`removed ${removed} procedural hostile${removed === 1 ? '' : 's'} from scripted rescue area`, 'warn');
    return removed;
  }

  function wrapBanditCamps(api) {
    if (!api?.init || api.__prologueSafeAreaWrapped) return api;
    const originalInit = api.init.bind(api); // Preserves ordinary BanditCamps initialization while capturing its dependency bag.
    const originalEnsure = api.ensureCurrentZoneCamps?.bind(api);
    const originalEncounters = api.updateRandomEncounters?.bind(api);
    const originalTentUpdate = api.updateTentInteraction?.bind(api);
    const originalPerception = api.updateCompanionPerception?.bind(api);
    const originalMarkEntered = api.markZoneEntered?.bind(api);

    api.init = function prologueSafeBanditInit(injectedDeps) {
      banditDeps = injectedDeps || null;
      return originalInit(injectedDeps);
    };
    if (originalEnsure) api.ensureCurrentZoneCamps = function prologueSafeEnsureCamps(...args) {
      if (isSuppressedArea()) { banditCallsBlocked++; purgeRescuePopulation(); return; }
      return originalEnsure(...args);
    };
    if (originalEncounters) api.updateRandomEncounters = function prologueSafeRandomEncounters(...args) {
      if (isSuppressedArea()) { banditCallsBlocked++; purgeRescuePopulation(); return; }
      return originalEncounters(...args);
    };
    if (originalTentUpdate) api.updateTentInteraction = function prologueSafeTentUpdate(...args) {
      if (isSuppressedArea()) { banditCallsBlocked++; purgeRescuePopulation(); return; }
      return originalTentUpdate(...args);
    };
    if (originalPerception) api.updateCompanionPerception = function prologueSafeBanditPerception(...args) {
      if (isSuppressedArea()) { banditCallsBlocked++; return; }
      return originalPerception(...args);
    };
    if (originalMarkEntered) api.markZoneEntered = function prologueSafeMarkZoneEntered(zoneId, ...args) {
      if (isSuppressedArea(zoneId)) { banditCallsBlocked++; purgeRescuePopulation(); return; }
      return originalMarkEntered(zoneId, ...args);
    };
    Object.defineProperty(api, '__prologueSafeAreaWrapped', { value: true, configurable: true });
    return api;
  }

  function wrapWildlifeSpawn(api) {
    if (!api?.init || api.__prologueSafeAreaWrapped) return api;
    const originalInit = api.init.bind(api); // Preserves ordinary wildlife initialization while capturing hostileObjects/getCurrentArea.
    const originalUpdate = api.updateHostileSpawning?.bind(api);
    const originalEntered = api.onZoneEntered?.bind(api);

    api.init = function prologueSafeWildlifeInit(injectedDeps) {
      wildlifeDeps = injectedDeps || null;
      return originalInit(injectedDeps);
    };
    if (originalUpdate) api.updateHostileSpawning = function prologueSafeHostileSpawning(...args) {
      if (isSuppressedArea()) { wildlifeCallsBlocked++; purgeRescuePopulation(); return; }
      return originalUpdate(...args);
    };
    if (originalEntered) api.onZoneEntered = function prologueSafeWildlifeZoneEntered(mapId, ...args) {
      if (isSuppressedArea(mapId)) { wildlifeCallsBlocked++; purgeRescuePopulation(); return; }
      return originalEntered(mapId, ...args);
    };
    Object.defineProperty(api, '__prologueSafeAreaWrapped', { value: true, configurable: true });
    return api;
  }

  function chainGlobal(name, wrapper) {
    const descriptor = Object.getOwnPropertyDescriptor(window, name); // Used to compose with existing early assignment hooks such as LivestockDialogue.
    if (descriptor?.get && descriptor?.set && descriptor.configurable) {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: descriptor.enumerable !== false,
        get() { return descriptor.get.call(window); },
        set(value) {
          descriptor.set.call(window, value);
          const installed = descriptor.get.call(window);
          if (installed) wrapper(installed);
        },
      });
      const existing = descriptor.get.call(window);
      if (existing) wrapper(existing);
      return;
    }
    if (window[name]) { wrapper(window[name]); return; }
    let value = null; // Used only if the protected runtime has not assigned its namespace yet.
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get() { return value; },
      set(next) { value = wrapper(next); },
    });
  }

  chainGlobal('BanditCamps', wrapBanditCamps);
  chainGlobal('WildlifeSpawn', wrapWildlifeSpawn);

  window.PrologueSafeAreaRuntime = Object.freeze({
    RESCUE_MAP_ID,
    isSuppressedArea,
    purgeRescuePopulation,
    debugSnapshot: () => ({
      currentArea: currentArea(),
      suppressed: isSuppressedArea(),
      banditDepsReady: !!banditDeps,
      wildlifeDepsReady: !!wildlifeDeps,
      purges,
      removedHostiles,
      banditCallsBlocked,
      wildlifeCallsBlocked,
    }),
  });
})();
