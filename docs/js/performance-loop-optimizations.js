// Runtime cadence cleanup for systems that historically owned unconditional
// per-frame loops. Loaded before game.js so it can wrap late-created systems
// without reaching into game.js's closure-private state.
(() => {
  'use strict';

  if (window.HobunjiPerformanceLoopOptimizations) return;

  const nativeRAF = window.requestAnimationFrame.bind(window);
  const FARM_AI_INTERVAL_S = 0.2;       // 5 Hz decisions; visual interpolation remains per-frame.
  const EXTERIOR_TRACK_INTERVAL_MS = 250; // 4 Hz blackout recovery anchor tracking.
  const NPC_ALCOHOL_INTERVAL_MS = 50;  // Existing bridge clamps dt to 0.05, so 20 Hz preserves recovery rate.
  const NPC_STATE_RECHECK_MS = 1000;

  const stats = {
    farmVisualFrames: 0,
    farmAiTicks: 0,
    exteriorTicks: 0,
    alcoholFrames: 0,
    alcoholIdleStops: 0,
    profilerUnwraps: 0,
  };

  function functionSourceIncludes(fn, ...needles) {
    if (typeof fn !== 'function') return false;
    let source = '';
    try { source = Function.prototype.toString.call(fn); } catch (_) { return false; }
    return needles.every(needle => source.includes(needle));
  }

  function chainFutureGlobal(name, afterSet) {
    if (window[name]) {
      afterSet(window[name]);
      return;
    }
    const desc = Object.getOwnPropertyDescriptor(window, name);
    if (desc && typeof desc.set === 'function') {
      const previousSet = desc.set;
      Object.defineProperty(window, name, {
        configurable: desc.configurable !== false,
        enumerable: desc.enumerable !== false,
        get: desc.get,
        set(value) {
          previousSet.call(window, value);
          afterSet(value);
        },
      });
      return;
    }
    if (desc && !desc.configurable) return;
    let value;
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get() { return value; },
      set(next) {
        value = next;
        afterSet(next);
      },
    });
  }

  // ── Farm livestock: 5 Hz decision AI, frame-rate visual interpolation ──
  let farmDeps = null;
  let farmClockS = 0;
  const farmAiState = new WeakMap();

  function stablePhase01(animal) {
    const text = String(animal?.id || animal?.livestockId || 'animal');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967296;
  }

  function patchFarmAnimals(api) {
    if (!api?.init || api.__hobunjiCadenceOptimized) return;
    const originalInit = api.init.bind(api);
    api.init = function optimizedFarmAnimalsInit(injectedDeps) {
      farmDeps = injectedDeps;
      return originalInit(injectedDeps);
    };

    api.updateAnimalMeshes = function optimizedUpdateAnimalMeshes(dt) {
      const deps = farmDeps;
      if (!deps?.animalObjects) return;
      const frameDt = Math.max(0, Math.min(0.25, Number(dt) || 0));
      farmClockS += frameDt;
      stats.farmVisualFrames++;

      const due = [];
      for (const animal of deps.animalObjects) {
        if (typeof animal?.tick !== 'function') continue;
        let state = farmAiState.get(animal);
        if (!state) {
          state = {
            lastAt: farmClockS,
            nextAt: farmClockS + stablePhase01(animal) * FARM_AI_INTERVAL_S,
          };
          farmAiState.set(animal, state);
        }
        if (farmClockS + 1e-6 < state.nextAt) continue;
        const elapsed = Math.max(FARM_AI_INTERVAL_S, Math.min(0.5, farmClockS - state.lastAt));
        state.lastAt = farmClockS;
        state.nextAt = farmClockS + FARM_AI_INTERVAL_S;
        due.push([animal, elapsed]);
      }

      let cacheSet = false;
      try {
        if (due.length) {
          deps.setWorldLivestockFrameCache?.(deps.loadWorldLivestock?.());
          cacheSet = true;
          for (const [animal, elapsed] of due) {
            animal.tick(elapsed);
            stats.farmAiTicks++;
          }
        }
        for (const animal of deps.animalObjects) animal?.update?.(frameDt);
      } finally {
        if (cacheSet) deps.setWorldLivestockFrameCache?.(null);
      }
    };

    api.__hobunjiCadenceOptimized = true;
  }

  chainFutureGlobal('FarmAnimals', patchFarmAnimals);

  // ── Corpses: skip the persistent corpse registry when nothing is tumbling ──
  const activeDyingCorpses = new Set();

  function patchCreatureDeath(api) {
    if (!api?.begin || !api?.updateCorpses || api.__hobunjiActiveDeathOptimized) return;
    const originalBegin = api.begin;
    const originalUpdate = api.updateCorpses;
    api.begin = function optimizedCreatureDeathBegin(creature, ...args) {
      const result = originalBegin.call(this, creature, ...args);
      if (creature?.state === 'dying') activeDyingCorpses.add(creature);
      return result;
    };
    api.updateCorpses = function optimizedCreatureDeathUpdate(dt) {
      if (!activeDyingCorpses.size) return;
      const result = originalUpdate.call(this, dt);
      for (const creature of activeDyingCorpses) {
        if (creature?.state !== 'dying') activeDyingCorpses.delete(creature);
      }
      return result;
    };
    api.__hobunjiActiveDeathOptimized = true;
  }

  chainFutureGlobal('CreatureDeath', patchCreatureDeath);

  // ── Combat blackout recovery anchor: keep private closure, throttle its rAF ──
  let exteriorCallback = null;
  let exteriorTimer = 0;

  function isExteriorTrackerCallback(callback) {
    return functionSourceIncludes(callback, 'lastExteriorAnchor', 'getCurrentArea');
  }

  function scheduleExterior(delay = EXTERIOR_TRACK_INTERVAL_MS) {
    if (!exteriorCallback || exteriorTimer) return;
    exteriorTimer = window.setTimeout(() => {
      exteriorTimer = 0;
      runExteriorTracker();
    }, Math.max(0, delay));
  }

  function runExteriorTracker() {
    const callback = exteriorCallback;
    if (!callback) return;
    const previousRAF = window.requestAnimationFrame;
    window.requestAnimationFrame = function interceptExteriorReschedule(next) {
      if (next === callback || isExteriorTrackerCallback(next)) {
        exteriorCallback = next;
        return 0;
      }
      return previousRAF.call(window, next);
    };
    try {
      callback(performance.now());
      stats.exteriorTicks++;
    } finally {
      window.requestAnimationFrame = previousRAF;
      scheduleExterior();
    }
  }

  function patchDevSpawner(api) {
    if (!api?.init || api.__hobunjiExteriorCadenceWrapped) return;
    const originalInit = api.init;
    api.init = function optimizedDevSpawnerInit(...args) {
      const previousRAF = window.requestAnimationFrame;
      window.requestAnimationFrame = function interceptExteriorStart(callback) {
        if (isExteriorTrackerCallback(callback)) {
          exteriorCallback = callback;
          scheduleExterior(0);
          return 0;
        }
        return previousRAF.call(window, callback);
      };
      try {
        return originalInit.apply(this, args);
      } finally {
        window.requestAnimationFrame = previousRAF;
      }
    };
    api.__hobunjiExteriorCadenceWrapped = true;
  }

  chainFutureGlobal('DevSpawner', patchDevSpawner);

  // ── Alcohol bridge: run full-frame only while player drunken inertia needs it ──
  let alcoholCallback = null;
  let alcoholRAF = 0;
  let alcoholTimer = 0;
  let npcActiveCached = false;
  let lastNpcCheckAt = -Infinity;
  let npcWakeUntil = 0;

  function isAlcoholPostFrameCallback(callback) {
    return functionSourceIncludes(callback, 'updateDrunkMomentum', 'npcAlcoholState');
  }

  function playerNeedsDrunkFrames() {
    const player = window.Combat?.deps?.player;
    const max = Math.max(0, Number(player?.maxFooting) || 0);
    const amount = Math.max(0, Number(player?.afflictions?.drunkenFooting) || 0);
    return max > 0 && amount > 0;
  }

  function refreshNpcActive(now, force = false) {
    if (!force && now - lastNpcCheckAt < NPC_STATE_RECHECK_MS) return npcActiveCached;
    lastNpcCheckAt = now;
    try {
      const state = window.HobunjiDrunkGameplayBridge?.getDebug?.()?.npcAlcoholState || {};
      npcActiveCached = Object.keys(state).length > 0;
    } catch (_) {}
    return npcActiveCached;
  }

  function cancelAlcoholSchedule() {
    if (alcoholRAF) cancelAnimationFrame(alcoholRAF);
    if (alcoholTimer) clearTimeout(alcoholTimer);
    alcoholRAF = 0;
    alcoholTimer = 0;
  }

  function scheduleAlcohol(forceCheck = false) {
    if (!alcoholCallback || alcoholRAF || alcoholTimer) return;
    const now = performance.now();
    const playerActive = playerNeedsDrunkFrames();
    const npcActive = refreshNpcActive(now, forceCheck) || now < npcWakeUntil;
    if (playerActive) {
      alcoholRAF = nativeRAF(ts => {
        alcoholRAF = 0;
        runAlcoholFrame(ts);
      });
      return;
    }
    if (npcActive) {
      alcoholTimer = window.setTimeout(() => {
        alcoholTimer = 0;
        runAlcoholFrame(performance.now());
      }, NPC_ALCOHOL_INTERVAL_MS);
      return;
    }
    stats.alcoholIdleStops++;
  }

  function runAlcoholFrame(now) {
    const callback = alcoholCallback;
    if (!callback) return;
    const previousRAF = window.requestAnimationFrame;
    window.requestAnimationFrame = function interceptAlcoholReschedule(next) {
      if (next === callback || isAlcoholPostFrameCallback(next)) {
        alcoholCallback = next;
        return 0;
      }
      return previousRAF.call(window, next);
    };
    try {
      callback(now);
      stats.alcoholFrames++;
    } finally {
      window.requestAnimationFrame = previousRAF;
      scheduleAlcohol();
    }
  }

  function captureAlcoholLoop(callback) {
    alcoholCallback = callback;
    cancelAlcoholSchedule();
    scheduleAlcohol(true);
  }

  // alcohol-gameplay-bridge registers its start handler on window.load while
  // this file is parser-loaded. A capture listener gets first chance to replace
  // rAF during that synchronous handler, then restores it in a microtask.
  window.addEventListener('load', () => {
    const previousRAF = window.requestAnimationFrame;
    const interceptor = function interceptAlcoholStart(callback) {
      if (isAlcoholPostFrameCallback(callback)) {
        captureAlcoholLoop(callback);
        return 0;
      }
      return previousRAF.call(window, callback);
    };
    window.requestAnimationFrame = interceptor;
    queueMicrotask(() => {
      if (window.requestAnimationFrame === interceptor) window.requestAnimationFrame = previousRAF;
    });
  }, true);

  function wakeAlcohol({ npc = false } = {}) {
    if (npc) {
      npcWakeUntil = Math.max(npcWakeUntil, performance.now() + 5000);
      lastNpcCheckAt = -Infinity;
    }
    cancelAlcoholSchedule();
    scheduleAlcohol(true);
  }

  // Player drinks go through ResourceSystem; wake a dormant loop immediately.
  const resourceSystem = window.ResourceSystem;
  if (resourceSystem?.addDrunkenness && !resourceSystem.__hobunjiCadenceWakeWrapped) {
    const originalAddDrunkenness = resourceSystem.addDrunkenness;
    resourceSystem.addDrunkenness = function optimizedCadenceAddDrunkenness(...args) {
      const result = originalAddDrunkenness.apply(this, args);
      wakeAlcohol();
      return result;
    };
    resourceSystem.__hobunjiCadenceWakeWrapped = true;
  }

  function patchAlcoholBridge(api) {
    if (!api || api.__hobunjiCadenceWakeWrapped) return;
    if (typeof api.restoreNpcAlcoholState === 'function') {
      const originalRestore = api.restoreNpcAlcoholState;
      api.restoreNpcAlcoholState = function optimizedRestoreNpcAlcoholState(...args) {
        const result = originalRestore.apply(this, args);
        npcActiveCached = Object.keys(result || {}).length > 0;
        wakeAlcohol({ npc: npcActiveCached });
        return result;
      };
    }
    if (typeof api.offerNpcSwig === 'function') {
      const originalOffer = api.offerNpcSwig;
      api.offerNpcSwig = function optimizedOfferNpcSwig(...args) {
        const result = originalOffer.apply(this, args);
        if (result) wakeAlcohol({ npc: true });
        return result;
      };
    }
    api.__hobunjiCadenceWakeWrapped = true;
  }

  patchAlcoholBridge(window.HobunjiDrunkGameplayBridge);

  // ── Optional profiler: don't leave its renderer wrapper installed while off ──
  let renderWithoutProfiler = null;

  function profilerPreferenceEnabled() {
    try { return window.localStorage?.getItem('hobunji_perf_profiler_v1') === '1'; }
    catch (_) { return false; }
  }

  function unwrapDisabledProfiler() {
    if (profilerPreferenceEnabled()) return false;
    const proto = window.THREE?.WebGLRenderer?.prototype;
    if (!proto || !renderWithoutProfiler || !proto.__hobunjiPerfWrapped) return false;
    const current = proto.render;
    const isOwnProfilerWrapper = current?.name === 'hobunjiProfiledRender'
      || functionSourceIncludes(current, 'perfState.renderCpuMs', 'profilerEnabled');
    if (!isOwnProfilerWrapper) return false;
    proto.render = renderWithoutProfiler;
    try { delete proto.__hobunjiPerfWrapped; } catch (_) {}
    stats.profilerUnwraps++;
    return true;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const proto = window.THREE?.WebGLRenderer?.prototype;
    if (proto && typeof proto.render === 'function') renderWithoutProfiler = proto.render;
    const script = document.querySelector('script[data-hobunji-performance-debug]');
    if (script) script.addEventListener('load', () => queueMicrotask(unwrapDisabledProfiler), { once: true });
    else {
      const observer = new MutationObserver(() => {
        const found = document.querySelector('script[data-hobunji-performance-debug]');
        if (!found) return;
        observer.disconnect();
        found.addEventListener('load', () => queueMicrotask(unwrapDisabledProfiler), { once: true });
      });
      observer.observe(document.head, { childList: true });
    }
  });

  document.addEventListener('change', event => {
    if (event.target?.id !== 'settingPerfProfiler' || event.target.checked) return;
    queueMicrotask(unwrapDisabledProfiler);
  }, true);

  window.HobunjiPerformanceLoopOptimizations = Object.freeze({
    FARM_AI_HZ: 1 / FARM_AI_INTERVAL_S,
    EXTERIOR_TRACK_HZ: 1000 / EXTERIOR_TRACK_INTERVAL_MS,
    NPC_ALCOHOL_HZ: 1000 / NPC_ALCOHOL_INTERVAL_MS,
    wakeAlcohol,
    getDebug: () => ({
      ...stats,
      farmAiHz: 1 / FARM_AI_INTERVAL_S,
      exteriorTrackHz: 1000 / EXTERIOR_TRACK_INTERVAL_MS,
      npcAlcoholHz: 1000 / NPC_ALCOHOL_INTERVAL_MS,
      alcoholCaptured: !!alcoholCallback,
      exteriorCaptured: !!exteriorCallback,
      profilerWrapperInstalled: !!window.THREE?.WebGLRenderer?.prototype?.__hobunjiPerfWrapped,
    }),
  });
})();
